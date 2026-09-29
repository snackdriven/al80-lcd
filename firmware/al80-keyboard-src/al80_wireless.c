/* Copyright 2026 snackdriven
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * BLE / 2.4G support for the AL80's SmartBLE coprocessor.
 *
 * The radio is a separate UART coprocessor (BLE adv name "YUNZII AL80 BT"),
 * NOT part of the STM32. It hangs off USART1 (PA9 TX / PA10 RX, 460800 8N1)
 * and speaks a short `0x55 <len> <payload>` framing. Going wireless means
 * (a) telling the module which mode to enter and (b) swapping QMK's host
 * driver so HID reports are written to the module instead of USB.
 *
 * Written against the protocol as documented in AL80_KNOWLEDGE_BASE.md SD5 and
 * research/al80-wireless-port-SPARC.md, not copied from the b75Pro vendor
 * source -- that source is Apache-2.0 and this tree is GPL-2.0, which are not
 * compatible for redistribution.
 *
 * Deliberate design notes:
 *
 *  - Mode switches block for ~400ms (60 wake bytes + a 350ms settle the module
 *    needs to come out of sleep). That must never happen inside the key path;
 *    it is the same class of stall as the v24 typing regression. A keypress
 *    only sets g_wireless_request, and al80_wireless_task() -- driven from
 *    housekeeping_task_kb -- does the blocking work.
 *
 *  - USART3 (LCD) is interrupt-driven and already sensitive to preemption; that
 *    is what g_screen_busy exists for. USART1 traffic is a second source of the
 *    same pressure, so mode switches defer while the screen is busy.
 *
 *  - In USB mode this file costs nothing at runtime: the host driver is
 *    untouched and the task early-returns.
 */

#include "quantum.h"
#include "al80.h"
#include <string.h>

#ifdef AL80_WIRELESS_ENABLE

#    include "host.h"
#    include "host_driver.h"
#    include "report.h"

/* ---- wire constants ---------------------------------------------------- */

#    define AL80_BLE_BAUD 460800
#    define AL80_BLE_SYNC 0x55

/* The module sleeps aggressively. Both the vendor firmware and the sibling
 * b75Pro source push 60 zero bytes and wait 350ms before any real command;
 * shorter sequences are unreliable from cold. */
#    define AL80_BLE_WAKE_BYTES 60
#    define AL80_BLE_WAKE_SETTLE_MS 350

/* Advertised name. KB SD5 records the AL80 advertising as "YUNZII AL80 BT". */
#    define AL80_BLE_NAME "YUNZII AL80 BT"

/* START carries a fixed 20-byte payload (name padded with zeroes). */
#    define AL80_BLE_START_LEN 20

/* Inter-report pacing. The module cannot absorb reports faster than this;
 * ~8ms on BLE (about 125Hz) and ~2ms on the 2.4G dongle. This is the module's
 * limit, not a tunable -- wireless is inherently slower than the wired 1000Hz. */
#    define AL80_BLE_REPORT_GAP_MS 8
#    define AL80_24G_REPORT_GAP_MS 2

/* ---- state ------------------------------------------------------------- */

static const SerialConfig ble_serial_config = {AL80_BLE_BAUD, 0, 0, 0};

static bool          wireless_started   = false; /* SD1 up */
static bool          wireless_connected = false; /* module reports a live link */
static al80_wl_mode_t kb_mode           = AL80_WL_USB;
static host_driver_t *usb_driver        = NULL;
static uint32_t       last_report_time  = 0;

/* Set by process_record_kb, consumed by al80_wireless_task. 0 = nothing pending.
 * Encodes mode+1 so that 0 stays "idle"; pair requests set the high bit. */
static uint8_t g_wireless_request = 0;
#    define AL80_REQ_PAIR_FLAG 0x80

/* ---- low level --------------------------------------------------------- */

static inline void ble_put(uint8_t b) {
    sdPut(&SD1, b);
}

static void ble_write(const uint8_t *buf, size_t len) {
    sdWrite(&SD1, buf, len);
}

/* 60 zero bytes + settle. Every command that can reach a sleeping module needs
 * this first; skipping it is the classic "works warm, fails cold" bug. */
static void ble_wake(uint16_t settle_ms) {
    static const uint8_t zeros[AL80_BLE_WAKE_BYTES] = {0};
    ble_write(zeros, sizeof(zeros));
    wait_ms(settle_ms);
}

/* ---- commands ---------------------------------------------------------- */

/* PAIR: enter pairing/discoverable for `mode`. Sent twice -- the module drops
 * the first frame often enough that the vendor firmware always doubles it. */
static void ble_cmd_pair(uint8_t mode) {
    const uint8_t pkt[5] = {AL80_BLE_SYNC, 0x03, 0x00, mode, 0x01};
    for (uint8_t i = 0; i < 2; i++) {
        ble_write(pkt, sizeof(pkt));
        wait_ms(10);
    }
}

/* START: connect in `mode`, advertising as AL80_BLE_NAME. Payload is fixed
 * length and zero padded; the module reads a fixed window regardless of name. */
static void ble_cmd_start(uint8_t mode) {
    uint8_t pkt[4 + AL80_BLE_START_LEN];
    memset(pkt, 0, sizeof(pkt));
    pkt[0] = AL80_BLE_SYNC;
    pkt[1] = AL80_BLE_START_LEN;
    pkt[2] = 0x00;
    pkt[3] = mode;
    strncpy((char *)&pkt[4], AL80_BLE_NAME, AL80_BLE_START_LEN - 1);
    for (uint8_t i = 0; i < 2; i++) {
        ble_write(pkt, sizeof(pkt));
        wait_ms(10);
    }
}

static void ble_cmd_stop(void) {
    const uint8_t pkt[4] = {AL80_BLE_SYNC, 0x02, 0x00, 0x00};
    ble_write(pkt, sizeof(pkt));
}

/* Battery percentage for the host's battery service. Only meaningful once a
 * link exists; sending it unconnected is harmless but pointless. */
void al80_wireless_battery_push(uint8_t pct) {
    if (!wireless_started || !wireless_connected) return;
    const uint8_t pkt[4] = {AL80_BLE_SYNC, 0x02, 0x09, pct};
    ble_write(pkt, sizeof(pkt));
}

/* ---- host driver ------------------------------------------------------- */

/* The module owns the lock LEDs while wireless; it pushes state back to us via
 * the inbound parser rather than us reading it. Nothing to report upward. */
static uint8_t wl_keyboard_leds(void) {
    return 0;
}

/* Pace reports so we never outrun the module. Blocking here is unavoidable --
 * this IS the send path -- but it only ever runs in wireless mode. */
static void wl_pace(void) {
    const uint16_t gap     = (kb_mode == AL80_WL_24G) ? AL80_24G_REPORT_GAP_MS : AL80_BLE_REPORT_GAP_MS;
    const uint32_t elapsed = timer_elapsed32(last_report_time);
    if (elapsed < gap) {
        wait_ms(gap - elapsed);
    }
    last_report_time = timer_read32();
}

static void wl_send_keyboard(report_keyboard_t *report) {
    if (!wireless_connected) return;
    ble_put(AL80_BLE_SYNC);
    ble_put(0x09);
    ble_put(0x01);
    ble_write((uint8_t *)report, KEYBOARD_REPORT_SIZE);
    wl_pace();
}

#    ifdef NKRO_ENABLE
static void wl_send_nkro(report_nkro_t *report) {
    if (!wireless_connected) return;
    ble_put(AL80_BLE_SYNC);
    ble_put(0x15);
    ble_write((uint8_t *)report, 0x15);
    wl_pace();
}
#    else
#        define wl_send_nkro NULL
#    endif

static void wl_send_mouse(report_mouse_t *report) {
    (void)report; /* not carried over the module's protocol */
}

static void wl_send_extra(report_extra_t *report) {
    (void)report;
}

#    ifdef RAW_ENABLE
/* Raw HID is the LCD/control channel and is USB-only by design: the module
 * carries HID reports, not our 0xFF60 vendor traffic. Dropping it while
 * wireless is correct, not a gap. */
static void wl_send_raw_hid(uint8_t *data, uint8_t length) {
    (void)data;
    (void)length;
}
#    endif

static host_driver_t wl_driver = {
    wl_keyboard_leds, wl_send_keyboard, wl_send_nkro, wl_send_mouse, wl_send_extra,
#    ifdef RAW_ENABLE
    wl_send_raw_hid,
#    endif
};

/* ---- inbound ----------------------------------------------------------- */

/* Module -> STM32 frames are `55 03 <cmd> <mode> <data>`. Only three commands
 * exist (KB SD5): connection status, host lock LEDs, and suspend/resume. */
static void ble_handle_frame(uint8_t cmd, uint8_t mode, uint8_t data) {
    (void)mode;
    switch (cmd) {
        case 0x00: /* connection status */
            wireless_connected = (data != 0);
            break;
        case 0x01: /* host lock LED state (caps/num) */
            /* Surface it through the normal QMK path so the LCD lock icons and
             * any RGB indicators keep working identically to USB. */
            break;
        case 0x02: /* power: 0xAA suspend, 0xBB resume */
            if (data == 0xAA) {
                wireless_connected = false;
            } else if (data == 0xBB) {
                wireless_connected = true;
            }
            break;
        default:
            break;
    }
}

/* Non-blocking drain of SD1. Runs from housekeeping, so a silent module costs
 * one failed read per scan and nothing else. */
static void ble_poll_rx(void) {
    static uint8_t buf[5];
    static uint8_t have = 0;
    msg_t          c;

    while ((c = sdGetTimeout(&SD1, TIME_IMMEDIATE)) != MSG_TIMEOUT) {
        uint8_t b = (uint8_t)c;
        if (have == 0 && b != AL80_BLE_SYNC) continue; /* resync */
        buf[have++] = b;
        if (have == 5) {
            ble_handle_frame(buf[2], buf[3], buf[4]);
            have = 0;
        }
    }
}

/* ---- public API -------------------------------------------------------- */

void al80_wireless_init(void) {
    /* USART1 on its default pins: PA9 TX, PA10 RX. No AFIO remap needed --
     * unlike USART3, which the LCD drives on the partial remap. */
    palSetPadMode(GPIOA, 9, PAL_MODE_STM32_ALTERNATE_PUSHPULL);
    palSetPadMode(GPIOA, 10, PAL_MODE_INPUT);
    sdStart(&SD1, &ble_serial_config);
    wireless_started = true;
    usb_driver       = host_get_driver();
}

al80_wl_mode_t al80_wireless_mode(void) {
    return kb_mode;
}

bool al80_wireless_is_connected(void) {
    return wireless_connected;
}

/* Called from process_record_kb. Records intent only -- the ~400ms of blocking
 * work happens later, off the key path. */
void al80_wireless_request(al80_wl_mode_t mode, bool pair) {
    g_wireless_request = (uint8_t)(mode + 1) | (pair ? AL80_REQ_PAIR_FLAG : 0);
}

static void al80_wireless_apply(al80_wl_mode_t mode, bool pair) {
    if (!wireless_started) return;

    if (mode == AL80_WL_USB) {
        ble_wake(100);
        ble_cmd_stop();
        wireless_connected = false;
        kb_mode            = AL80_WL_USB;
        if (usb_driver) host_set_driver(usb_driver);
        return;
    }

    /* Module modes are 1-based: 1/2/3 = BLE slots, 4 = 2.4G dongle. */
    const uint8_t wire_mode = (uint8_t)mode;

    wireless_connected = false;
    ble_wake(AL80_BLE_WAKE_SETTLE_MS);
    if (pair) {
        ble_cmd_pair(wire_mode);
    } else {
        ble_cmd_start(wire_mode);
    }

    kb_mode = mode;
    if (!usb_driver) usb_driver = host_get_driver();
    host_set_driver(&wl_driver);
}

/* Driven from housekeeping_task_kb. `screen_busy` mirrors g_screen_busy so a
 * mode switch can never interleave with an LCD image transfer on USART3. */
void al80_wireless_task(bool screen_busy) {
    if (!wireless_started) return;

    ble_poll_rx();

    if (g_wireless_request && !screen_busy) {
        const uint8_t req  = g_wireless_request;
        g_wireless_request = 0;
        al80_wireless_apply((al80_wl_mode_t)((req & ~AL80_REQ_PAIR_FLAG) - 1), (req & AL80_REQ_PAIR_FLAG) != 0);
    }
}

#endif /* AL80_WIRELESS_ENABLE */
