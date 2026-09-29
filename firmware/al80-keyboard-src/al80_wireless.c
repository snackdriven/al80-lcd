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

/* Diagnostics. The module is a black box and this is the first firmware that has
 * ever spoken to it, so count both directions and keep the last frame seen --
 * without this there is no way to tell "we never transmitted" from "we
 * transmitted and it ignored us". Readable over raw HID 0x4C. */
static uint16_t dbg_tx_bytes = 0;
static uint16_t dbg_rx_bytes = 0;
static uint8_t  dbg_last_rx[4] = {0, 0, 0, 0};

/* Ring of the last 6 COMPLETE frames (cmd, mode, data). The 4-byte peephole
 * above showed the module was alive but not what it was saying. */
#    define AL80_WL_FRAME_LOG 6
static uint8_t dbg_frames[AL80_WL_FRAME_LOG][3];
static uint8_t dbg_frame_head  = 0;
static uint8_t dbg_frame_count = 0;

/* If a mode switch never produces a connection, fall back to USB rather than
 * leaving the keyboard mute. Shipping without this was a mistake: a failed
 * switch silently killed typing with no indication and no way back except a
 * keycode the user had to know about. */
#    ifndef AL80_WL_CONNECT_TIMEOUT_MS
#        define AL80_WL_CONNECT_TIMEOUT_MS 6000
#    endif
static uint32_t wl_switch_time = 0;

/* Optimistic mode.
 *
 * Observed 2026-09-29: on stock firmware the module auto-connects to a
 * previously-paired 2.4G dongle the moment it powers up -- no pairing action,
 * no handshake from the MCU. If it does that, it has no reason to send us a
 * connection frame, and gating reports on wireless_connected means we throw
 * away every keystroke while the radio is perfectly healthy. That matches our
 * symptoms exactly: TX fine, RX zero, nothing types, hardware demonstrably OK.
 *
 * Optimistic mode sends reports whenever we're in a wireless mode, whether or
 * not the module ever announced itself. Auto-revert is disabled here because
 * there is no connection signal to wait for -- Fn+T returns to USB, and
 * unplug/replug always boots to USB. */
#    ifndef AL80_WL_OPTIMISTIC
#        define AL80_WL_OPTIMISTIC 1
#    endif

/* ---- low level --------------------------------------------------------- */

/* Count what the driver ACCEPTED, not what we asked it to send. sdWrite returns
 * 0 immediately when the driver is not in SD_READY, so incrementing by `len`
 * unconditionally produces a counter that happily reports thousands of bytes
 * while nothing reaches the wire. That mistake cost a whole debugging round. */
static inline void ble_put(uint8_t b) {
    dbg_tx_bytes += (uint16_t)sdWrite(&SD1, &b, 1);
}

static void ble_write(const uint8_t *buf, size_t len) {
    dbg_tx_bytes += (uint16_t)sdWrite(&SD1, buf, len);
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
/* 22 bytes total: `55 14` then exactly 20 payload bytes. The length byte counts
 * what follows it, so the buffer is 2 + 20, not 4 + 20. Stock also stamps the
 * mode digit over the string's NUL at [18]. Confirmed byte-for-byte against
 * stock's CONNECT at 0x08006740. */
static void ble_cmd_start(uint8_t mode) {
    uint8_t pkt[2 + AL80_BLE_START_LEN];
    memset(pkt, 0, sizeof(pkt));
    pkt[0] = AL80_BLE_SYNC;
    pkt[1] = AL80_BLE_START_LEN;   /* 0x14 = 20 bytes follow */
    pkt[2] = 0x00;                 /* command */
    pkt[3] = mode;
    memcpy(&pkt[4], AL80_BLE_NAME, sizeof(AL80_BLE_NAME) - 1); /* 14 chars, no NUL */
    pkt[18] = (uint8_t)('0' + mode);
    /* pkt[19..21] stay zero */
    for (uint8_t i = 0; i < 2; i++) {
        ble_write(pkt, sizeof(pkt));
        wait_ms(10);
    }
}

static void ble_cmd_stop(void) {
    const uint8_t pkt[4] = {AL80_BLE_SYNC, 0x02, 0x00, 0x00};
    ble_write(pkt, sizeof(pkt));
}

/* Should we hand this report to the module? In optimistic mode, being in a
 * wireless mode is enough. */
static inline bool wl_should_send(void) {
#    if AL80_WL_OPTIMISTIC
    return kb_mode != AL80_WL_USB;
#    else
    return wireless_connected;
#    endif
}

/* Battery percentage for the host's battery service. Only meaningful once a
 * link exists; sending it unconnected is harmless but pointless. */
void al80_wireless_battery_push(uint8_t pct) {
    if (!wireless_started || !wl_should_send()) return;
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
    if (!wl_should_send()) return;
    ble_put(AL80_BLE_SYNC);
    ble_put(0x09);
    ble_put(0x01);
    ble_write((uint8_t *)report, KEYBOARD_REPORT_SIZE);
    wl_pace();
}

#    ifdef NKRO_ENABLE
static void wl_send_nkro(report_nkro_t *report) {
    if (!wl_should_send()) return;
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
    dbg_frames[dbg_frame_head][0] = cmd;
    dbg_frames[dbg_frame_head][1] = mode;
    dbg_frames[dbg_frame_head][2] = data;
    dbg_frame_head = (uint8_t)((dbg_frame_head + 1) % AL80_WL_FRAME_LOG);
    if (dbg_frame_count < AL80_WL_FRAME_LOG) dbg_frame_count++;

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

    while ((c = sdGetTimeout(&SD1, TIME_IMMEDIATE)) >= 0) {
        uint8_t b = (uint8_t)c;
        dbg_rx_bytes++;
        dbg_last_rx[0] = dbg_last_rx[1];
        dbg_last_rx[1] = dbg_last_rx[2];
        dbg_last_rx[2] = dbg_last_rx[3];
        dbg_last_rx[3] = b;
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

/* Snapshot for the raw-HID diagnostic (0x4C).
 *
 * Reports the PERIPHERAL's own state, not our beliefs about it. Stock's values
 * (read out of RIPPLE.bin) are BRR=0x004E, CR1=0x212C, CR2=0x0040, CR3=0x0001,
 * and GPIOA->CRH nibble 9 = 0xB (AF push-pull 50MHz). Anything else is the bug. */
void al80_wireless_debug(uint8_t *out) {
    out[0] = (uint8_t)kb_mode;
    out[1] = wireless_connected ? 1 : 0;
    out[2] = (uint8_t)(dbg_tx_bytes >> 8);
    out[3] = (uint8_t)(dbg_tx_bytes & 0xFF);
    out[4] = (uint8_t)(dbg_rx_bytes >> 8);
    out[5] = (uint8_t)(dbg_rx_bytes & 0xFF);
    out[6] = dbg_last_rx[0];
    out[7] = dbg_last_rx[1];
    out[8] = dbg_last_rx[2];
    out[9] = dbg_last_rx[3];

    out[10] = (uint8_t)SD1.state;                       /* 3 = SD_READY */
    const uint16_t brr = (uint16_t)USART1->BRR;
    const uint16_t cr1 = (uint16_t)USART1->CR1;
    const uint16_t cr2 = (uint16_t)USART1->CR2;
    const uint16_t cr3 = (uint16_t)USART1->CR3;
    const uint16_t sr  = (uint16_t)USART1->SR;
    out[11] = (uint8_t)(brr >> 8);  out[12] = (uint8_t)brr;
    out[13] = (uint8_t)(cr1 >> 8);  out[14] = (uint8_t)cr1;
    out[15] = (uint8_t)(cr2 >> 8);  out[16] = (uint8_t)cr2;
    out[17] = (uint8_t)(cr3 >> 8);  out[18] = (uint8_t)cr3;
    out[19] = (uint8_t)(sr >> 8);   out[20] = (uint8_t)sr;

    const uint32_t crh = GPIOA->CRH;                    /* PA8..PA15 */
    out[21] = (uint8_t)(crh >> 24); out[22] = (uint8_t)(crh >> 16);
    out[23] = (uint8_t)(crh >> 8);  out[24] = (uint8_t)crh;

    /* frame ring: count, head, then 6 x (cmd, mode, data) */
    out[25] = dbg_frame_count;
    out[26] = dbg_frame_head;
    for (uint8_t i = 0; i < AL80_WL_FRAME_LOG; i++) {
        out[27 + i * 3 + 0] = dbg_frames[i][0];
        out[27 + i * 3 + 1] = dbg_frames[i][1];
        out[27 + i * 3 + 2] = dbg_frames[i][2];
    }
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

    kb_mode        = mode;
    wl_switch_time = timer_read32();
    if (!usb_driver) usb_driver = host_get_driver();
    host_set_driver(&wl_driver);
}

/* Driven from housekeeping_task_kb. `screen_busy` mirrors g_screen_busy so a
 * mode switch can never interleave with an LCD image transfer on USART3. */
void al80_wireless_task(bool screen_busy) {
    if (!wireless_started) return;

    ble_poll_rx();

    /* Failsafe: a switch that never connects reverts to USB so the keyboard is
     * never left mute. */
#    if !AL80_WL_OPTIMISTIC
    if (kb_mode != AL80_WL_USB && !wireless_connected && wl_switch_time &&
        timer_elapsed32(wl_switch_time) > AL80_WL_CONNECT_TIMEOUT_MS) {
        wl_switch_time = 0;
        kb_mode        = AL80_WL_USB;
        if (usb_driver) host_set_driver(usb_driver);
        clear_keyboard();
    }
#    endif

    if (g_wireless_request && !screen_busy) {
        const uint8_t req  = g_wireless_request;
        g_wireless_request = 0;
        al80_wireless_apply((al80_wl_mode_t)((req & ~AL80_REQ_PAIR_FLAG) - 1), (req & AL80_REQ_PAIR_FLAG) != 0);
    }
}

#endif /* AL80_WIRELESS_ENABLE */
