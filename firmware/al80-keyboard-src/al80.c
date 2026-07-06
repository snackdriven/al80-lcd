/* Copyright 2026 snackdriven
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * YUNZII AL80 board support:
 *   - SWJ disable (matrix uses PA13/14/15, PB3/4)
 *   - aw20216s LED position map (recovered from RIPPLE.bin @ flash 0x080116A0)
 *   - LCD pass-through: forward raw-HID 0x40/0x41/0x42 payloads over USART3
 */
#include "quantum.h"
#include "raw_hid.h"
#include "hal.h"
#include "eeconfig.h"
#include "dynamic_keymap.h"
#include "al80.h"
#include <string.h>
#include "analog.h"

/* Set while an LCD transfer (0x40..0x42) is in flight. aw20216s_flush() checks this and
 * skips its SPI writes so they can't preempt the interrupt-driven USART3 TX and put gaps in
 * the byte stream (which shears the image). Watchdog clears it if a transfer stalls. */
volatile bool g_screen_busy = false;
static uint16_t screen_busy_wd = 0;

/* ---- battery telemetry (ported from b75Pro smart_kb16: battery.c / adc.c / keyboard_screen.c) ----
 * The homepage battery gauge is drawn by the display module but FED by the keyboard: stock sends
 * PK_BATT_QUANTITY (announce type 0x06, one % byte) + PK_BATT_STATUS (0x07, charge state) over
 * USART3. A pure passthrough never sends these, so the gauge reads empty. We read ADC1 ch9 (B1),
 * convert (mv = adc*1764/vref), map to % with b75Pro's piecewise thresholds, and emit the same
 * A5 5A packets the module expects (CRC16-MODBUS over [type,flag,len], identical to al80-studio). */
#define BATT_OFF 3200
#define BATT_5   3300
#define BATT_10  3470
#define BATT_40  3630
#define BATT_60  3760
#define BATT_80  3930
#define BATT_85  3980
#define BATT_99  4150
/* 12-bit VREFINT count on a 3.3V rail (STM32F103, ~1.20V internal ref). CALIBRATABLE: if the
 * reported % reads high, raise this; if low, lower it. */
#ifndef AL80_VREF_CAL
#    define AL80_VREF_CAL 1489
#endif
/* On-device the ADC read returned 0 (gauge empty). On USB the keyboard is charging/full, so we
 * fall back to a fixed charging+full. Real %% needs debugging why B1/ch9 reads 0. */
#define AL80_BATT_STATUS 1    /* PK_BATT_STATUS: 1 = charging */
#define AL80_BATT_FULL   100  /* PK_BATT_QUANTITY fallback */

static uint8_t al80_batt_pct(uint16_t mv) {
    if (mv >= BATT_99) return 100;
    if (mv <  BATT_OFF) return 0;
    if (mv <  BATT_5)  return ((mv - BATT_OFF) * 5)  / (BATT_5  - BATT_OFF);
    if (mv <  BATT_10) return ((mv - BATT_5)  * 5)  / (BATT_10 - BATT_5)  + 5;
    if (mv <  BATT_40) return ((mv - BATT_10) * 30) / (BATT_40 - BATT_10) + 10;
    if (mv <  BATT_60) return ((mv - BATT_40) * 20) / (BATT_60 - BATT_40) + 40;
    if (mv <  BATT_80) return ((mv - BATT_60) * 20) / (BATT_80 - BATT_60) + 60;
    if (mv <  BATT_85) return ((mv - BATT_80) * 5)  / (BATT_85 - BATT_80) + 80;
    return ((mv - BATT_85) * 14) / (BATT_99 - BATT_85) + 85;
}

/* Battery %% to report: use the ADC when plausible, else charging/full (USB). The ADC reads 0
 * on-device today, so this returns AL80_BATT_FULL until that's debugged. */
static uint8_t al80_read_batt_pct(void) {
    int16_t raw = analogReadPin(B1);
    if (raw <= 0) return AL80_BATT_FULL;
    uint8_t pct = al80_batt_pct((uint16_t)(((uint32_t)raw * 1764) / AL80_VREF_CAL));
    return pct < 10 ? AL80_BATT_FULL : pct;  /* implausibly low on USB = bad read */
}

/* CRC16-MODBUS (init 0xFFFF, poly 0xA001) — al80-studio's announce checksum "ga". */
static uint16_t al80_crc16(const uint8_t *d, uint8_t n) {
    uint16_t crc = 0xFFFF;
    for (uint8_t i = 0; i < n; i++) {
        crc ^= d[i];
        for (uint8_t b = 0; b < 8; b++) crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : (crc >> 1);
    }
    return crc;
}

/* One PK announce + 1 data byte to the module: A5 5A <type> 00 01 <crcHi> <crcLo> <val>. */
static void al80_screen_send_u8(uint8_t type, uint8_t val) {
    uint8_t  hdr[3] = { type, 0x00, 0x01 };
    uint16_t crc    = al80_crc16(hdr, 3);
    uint8_t  pkt[8] = { 0xA5, 0x5A, type, 0x00, 0x01, (uint8_t)(crc >> 8), (uint8_t)crc, val };
    sdWrite(&SD3, pkt, sizeof(pkt));
}

/* Read the battery and push PK_BATT_QUANTITY (%) + PK_BATT_STATUS to the module. Caller must
 * ensure no image transfer is in flight (checks g_screen_busy) so the bytes don't interleave. */
static void al80_battery_push(void) {
    uint8_t pct = al80_read_batt_pct();
    g_screen_busy = true;                             /* pause RGB SPI so the tiny packets don't jitter */
    al80_screen_send_u8(0x07, AL80_BATT_STATUS);      /* PK_BATT_STATUS = charging */
    wait_us(500);                                     /* let the module commit before the next packet */
    al80_screen_send_u8(0x06, pct);                   /* PK_BATT_QUANTITY */
    wait_us(500);
    g_screen_busy = false;
    screen_busy_wd = 0;
}

/* Push the full homepage widget set the display module expects at boot (ported from b75Pro
 * keyboard_screen.c screen_boot_step: conn type, OS type, lock states, battery). The module
 * initializes its homepage gauges from this batch; a lone battery packet may have no widget to
 * fill. Re-sent periodically so it self-heals after a main-page image push clears the homepage. */
static void al80_homepage_init(void) {
    uint8_t  pct  = al80_read_batt_pct();
    uint8_t  leds = host_keyboard_leds();
    g_screen_busy = true;
    al80_screen_send_u8(0x01, 0);               wait_us(500); /* PK_CONN_TYPE   = 0 (USB wired) */
    al80_screen_send_u8(0x02, 0);               wait_us(500); /* PK_OS_TYPE     = 0 (Windows)   */
    al80_screen_send_u8(0x03, (leds >> 1) & 1); wait_us(500); /* PK_CAPS_STATUS                 */
    al80_screen_send_u8(0x04, leds & 1);        wait_us(500); /* PK_NUMLOCK_STATUS              */
    al80_screen_send_u8(0x05, 0);               wait_us(500); /* PK_WINLOCK_STATUS              */
    al80_screen_send_u8(0x07, AL80_BATT_STATUS);wait_us(500); /* PK_BATT_STATUS = charging      */
    al80_screen_send_u8(0x06, pct);             wait_us(500); /* PK_BATT_QUANTITY               */
    g_screen_busy = false;
    screen_busy_wd = 0;
}

/* ---- homepage caps/num-lock icons ----
 * The display module draws the caps/num lock icons from PK_CAPS_STATUS (0x03) / PK_NUMLOCK_STATUS
 * (0x04) status packets. Stock and the b75Pro sibling push these on every real LED change
 * (b75Pro keyboard_screen.c reads host_keyboard_leds() and sets PK_CAPS/PK_NUMLOCK flags). The
 * passthrough here only sent them in the boot batch + the 30s self-heal, so a Caps/Num toggle
 * lagged up to 30s and looked dead.
 *
 * The blocking USART3 send below runs in the single-threaded main loop (~1ms: 2 packets + two
 * 500us settles), so it MUST only run on an actual caps/num transition. QMK's led_task() is
 * change-gated, but led_set() (-> led_update_kb) is ALSO called unconditionally on every layer
 * action (quantum/action.c) and in command mode, passing an UNCHANGED host_keyboard_leds(). v24
 * sent on every such call, so every layer key / layer-tap did a blocking send and stalled typing +
 * the encoder. We track last_locks and early-return when caps/num are unchanged, so the wire only
 * moves on a genuine toggle (a handful of bytes, once). If a transfer is mid-flight we defer via
 * locks_dirty. */
static volatile bool locks_dirty = false;
static uint8_t       last_locks  = 0xFF;   /* caps<<1|num; 0xFF = unknown -> first report syncs */

/* Push caps + num lock to the module. Main-loop context (like al80_battery_push), so the two 500us
 * settles are fine. Bit map matches al80_homepage_init: caps = leds bit1, num = leds bit0. */
static void al80_locks_push(void) {
    uint8_t leds = host_keyboard_leds();
    g_screen_busy = true;                          /* pause RGB SPI so the tiny packets don't jitter */
    al80_screen_send_u8(0x03, (leds >> 1) & 1);    /* PK_CAPS_STATUS    */
    wait_us(500);
    al80_screen_send_u8(0x04, leds & 1);           /* PK_NUMLOCK_STATUS */
    wait_us(500);
    g_screen_busy = false;
    screen_busy_wd = 0;
}

/* Called by QMK whenever it (re)binds host LED state - on a real change AND on every layer action.
 * Only touch the wire when caps/num actually transitioned; otherwise return immediately so plain
 * typing / layer keys / the encoder never eat a blocking USART3 send. */
bool led_update_kb(led_t led_state) {
    bool res = led_update_user(led_state);
    if (res) {
        uint8_t cur = (led_state.caps_lock ? 2 : 0) | (led_state.num_lock ? 1 : 0);
        if (cur != last_locks) {          /* real caps/num edge - everything else early-returns */
            last_locks = cur;
            if (g_screen_busy) {
                locks_dirty = true;       /* wire busy: flushed by housekeeping_task_kb when free */
            } else {
                al80_locks_push();
            }
        }
    }
    return res;
}

/* ---- user-editable RGB palette store ----
 * al80_palette is the live RAM mirror the PALETTE_CYCLE effect reads. It is
 * seeded at keyboard_post_init_kb: from EEPROM if a valid magic byte is
 * present, otherwise from the compiled default (and NOT written back, so a
 * fresh board leaves flash untouched). raw-HID 0x44 edits it live; 0x45
 * commits it to a dedicated wear-leveling KB datablock in one flash write. */
al80_palette_color_t al80_palette[AL80_PALETTE_LEN];

/* Compiled default palette: teal -> magenta -> amber. Keep AL80_PALETTE_LEN
 * (config.h) and this initializer in sync when growing the palette. */
static const al80_palette_color_t AL80_PALETTE_DEFAULT[AL80_PALETTE_LEN] = {
    {128, 255},  // teal
    {213, 255},  // magenta
    { 28, 255},  // amber
};

/* EEPROM layout of the KB datablock: a magic byte (VIA-style validity marker)
 * followed by the palette. If magic != AL80_PALETTE_MAGIC we treat the block
 * as unset and fall back to the compiled default. */
#define AL80_PALETTE_MAGIC 0x5A
typedef struct {
    uint8_t              magic;
    al80_palette_color_t colors[AL80_PALETTE_LEN];
} al80_palette_store_t;

static void al80_palette_load(void) {
#if (EECONFIG_KB_DATA_SIZE) > 0
    al80_palette_store_t store;
    /* read_kb_datablock zero-fills when the block has never been written, so a
       fresh board reads magic == 0 and falls through to the default below. */
    eeconfig_read_kb_datablock(&store, 0, sizeof(store));
    if (store.magic == AL80_PALETTE_MAGIC) {
        memcpy(al80_palette, store.colors, sizeof(al80_palette));
        return;
    }
#endif
    memcpy(al80_palette, AL80_PALETTE_DEFAULT, sizeof(al80_palette));
}

static void al80_palette_save(void) {
#if (EECONFIG_KB_DATA_SIZE) > 0
    al80_palette_store_t store;
    store.magic = AL80_PALETTE_MAGIC;
    memcpy(store.colors, al80_palette, sizeof(al80_palette));
    /* single flash write: stamps the datablock version + magic + palette. */
    eeconfig_update_kb_datablock(&store, 0, sizeof(store));
#endif
}

/* ---- independent side-LED-bar color ----
 * The side bar is RGB-matrix indices 76..78 (aw20216s driver 1). By default it
 * follows the keys (keylight flag). When bar_independent is true, the RGB-matrix
 * indicators hook overrides those three LEDs with bar_hsv every frame. The state
 * is statically initialized (valid before the first render — no boot garbage),
 * seeded from a SEPARATE EEPROM sub-block at post_init, edited live over raw-HID
 * (0x47) and persisted (0x48). It lives at its own offset so it never disturbs
 * the palette block (which keeps its own magic and layout). */
static uint8_t bar_h           = 128;   /* cyan/teal on the 0..255 wheel */
static uint8_t bar_s           = 255;
static uint8_t bar_v           = 255;
static bool    bar_independent = true;   /* default: bar shows its own color */

#define AL80_BAR_MAGIC 0x5B              /* distinct from AL80_PALETTE_MAGIC 0x5A */
/* Offset of the bar sub-block: right after the palette store (config.h reserves
 * AL80_PALETTE_STORE_SIZE + AL80_BAR_STORE_SIZE bytes total). */
#define AL80_BAR_STORE_OFFSET (sizeof(al80_palette_store_t))

typedef struct {
    uint8_t magic;
    uint8_t h;
    uint8_t s;
    uint8_t v;
    uint8_t independent;
} al80_bar_store_t;

static void al80_bar_load(void) {
#if (EECONFIG_KB_DATA_SIZE) > 0
    al80_bar_store_t store;
    eeconfig_read_kb_datablock(&store, AL80_BAR_STORE_OFFSET, sizeof(store));
    if (store.magic == AL80_BAR_MAGIC) {
        bar_h           = store.h;
        bar_s           = store.s;
        bar_v           = store.v;
        bar_independent = store.independent ? true : false;
    }
    /* else: keep the compiled defaults; leave flash untouched on a fresh board. */
#endif
}

static void al80_bar_save(void) {
#if (EECONFIG_KB_DATA_SIZE) > 0
    al80_bar_store_t store = {AL80_BAR_MAGIC, bar_h, bar_s, bar_v, bar_independent ? 1 : 0};
    eeconfig_update_kb_datablock(&store, AL80_BAR_STORE_OFFSET, sizeof(store));
#endif
}

/* Override the three side-bar LEDs (76..78) with bar_hsv when independent. The
 * RGB-matrix core calls this once per render with the current [led_min, led_max)
 * slice, so bounds-check against the slice AND RGB_MATRIX_LED_COUNT. */
bool rgb_matrix_indicators_advanced_kb(uint8_t led_min, uint8_t led_max) {
    if (bar_independent) {
        HSV hsv = {bar_h, bar_s, bar_v};
        RGB rgb = hsv_to_rgb(hsv);
        for (uint8_t i = 76; i <= 78; i++) {
            if (i >= led_min && i < led_max && i < RGB_MATRIX_LED_COUNT) {
                rgb_matrix_set_color(i, rgb.r, rgb.g, rgb.b);
            }
        }
    }
    return rgb_matrix_indicators_advanced_user(led_min, led_max);
}

/* ---- aw20216s LED map ----
 * {driver, R, G, B}. Macro naming reconciled with drivers/led/aw20216s.h,
 * which spells positions SW<row>_CS<col> (the params file used CS<col>_SW<row>;
 * converted 1:1 by swapping the pair). idx 82/83 = {0,0,0,0} unused.
 */
const aw20216s_led_t PROGMEM g_aw20216s_leds[AW20216S_LED_COUNT] = {
    {0, SW1_CS1, SW1_CS2, SW1_CS3}, {0, SW2_CS1, SW2_CS2, SW2_CS3}, {0, SW3_CS1, SW3_CS2, SW3_CS3}, {0, SW4_CS1, SW4_CS2, SW4_CS3},
    {0, SW5_CS1, SW5_CS2, SW5_CS3}, {0, SW6_CS1, SW6_CS2, SW6_CS3}, {0, SW7_CS1, SW7_CS2, SW7_CS3}, {0, SW8_CS1, SW8_CS2, SW8_CS3},
    {1, SW1_CS1, SW1_CS2, SW1_CS3}, {1, SW2_CS1, SW2_CS2, SW2_CS3}, {1, SW3_CS1, SW3_CS2, SW3_CS3}, {1, SW4_CS1, SW4_CS2, SW4_CS3},
    {1, SW5_CS1, SW5_CS2, SW5_CS3}, {1, SW6_CS1, SW6_CS2, SW6_CS3}, {0, SW1_CS4, SW1_CS5, SW1_CS6}, {0, SW2_CS4, SW2_CS5, SW2_CS6},
    {0, SW3_CS4, SW3_CS5, SW3_CS6}, {0, SW4_CS4, SW4_CS5, SW4_CS6}, {0, SW5_CS4, SW5_CS5, SW5_CS6}, {0, SW6_CS4, SW6_CS5, SW6_CS6},
    {0, SW7_CS4, SW7_CS5, SW7_CS6}, {0, SW8_CS4, SW8_CS5, SW8_CS6}, {1, SW1_CS4, SW1_CS5, SW1_CS6}, {1, SW2_CS4, SW2_CS5, SW2_CS6},
    {1, SW3_CS4, SW3_CS5, SW3_CS6}, {1, SW4_CS4, SW4_CS5, SW4_CS6}, {1, SW5_CS4, SW5_CS5, SW5_CS6}, {1, SW6_CS4, SW6_CS5, SW6_CS6},
    {1, SW7_CS4, SW7_CS5, SW7_CS6}, {0, SW1_CS7, SW1_CS8, SW1_CS9}, {0, SW2_CS7, SW2_CS8, SW2_CS9}, {0, SW3_CS7, SW3_CS8, SW3_CS9},
    {0, SW4_CS7, SW4_CS8, SW4_CS9}, {0, SW5_CS7, SW5_CS8, SW5_CS9}, {0, SW6_CS7, SW6_CS8, SW6_CS9}, {0, SW7_CS7, SW7_CS8, SW7_CS9},
    {0, SW8_CS7, SW8_CS8, SW8_CS9}, {1, SW1_CS7, SW1_CS8, SW1_CS9}, {1, SW2_CS7, SW2_CS8, SW2_CS9}, {1, SW3_CS7, SW3_CS8, SW3_CS9},
    {1, SW4_CS7, SW4_CS8, SW4_CS9}, {1, SW5_CS7, SW5_CS8, SW5_CS9}, {1, SW6_CS7, SW6_CS8, SW6_CS9}, {1, SW7_CS7, SW7_CS8, SW7_CS9},
    {0, SW1_CS10, SW1_CS11, SW1_CS12}, {0, SW2_CS10, SW2_CS11, SW2_CS12}, {0, SW3_CS10, SW3_CS11, SW3_CS12}, {0, SW4_CS10, SW4_CS11, SW4_CS12},
    {0, SW5_CS10, SW5_CS11, SW5_CS12}, {0, SW6_CS10, SW6_CS11, SW6_CS12}, {0, SW7_CS10, SW7_CS11, SW7_CS12}, {0, SW8_CS10, SW8_CS11, SW8_CS12},
    {1, SW1_CS10, SW1_CS11, SW1_CS12}, {1, SW2_CS10, SW2_CS11, SW2_CS12}, {1, SW3_CS10, SW3_CS11, SW3_CS12}, {1, SW4_CS10, SW4_CS11, SW4_CS12},
    {1, SW6_CS10, SW6_CS11, SW6_CS12}, {0, SW1_CS13, SW1_CS14, SW1_CS15}, {0, SW3_CS13, SW3_CS14, SW3_CS15}, {0, SW4_CS13, SW4_CS14, SW4_CS15},
    {0, SW5_CS13, SW5_CS14, SW5_CS15}, {0, SW6_CS13, SW6_CS14, SW6_CS15}, {0, SW7_CS13, SW7_CS14, SW7_CS15}, {0, SW8_CS13, SW8_CS14, SW8_CS15},
    {1, SW1_CS13, SW1_CS14, SW1_CS15}, {1, SW2_CS13, SW2_CS14, SW2_CS15}, {1, SW3_CS13, SW3_CS14, SW3_CS15}, {1, SW4_CS13, SW4_CS14, SW4_CS15},
    {1, SW5_CS13, SW5_CS14, SW5_CS15}, {1, SW6_CS13, SW6_CS14, SW6_CS15}, {0, SW1_CS16, SW1_CS17, SW1_CS18}, {0, SW2_CS16, SW2_CS17, SW2_CS18},
    {0, SW3_CS16, SW3_CS17, SW3_CS18}, {0, SW7_CS16, SW7_CS17, SW7_CS18}, {0, SW8_CS16, SW8_CS17, SW8_CS18}, {1, SW1_CS16, SW1_CS17, SW1_CS18},
    {1, SW2_CS16, SW2_CS17, SW2_CS18}, {1, SW3_CS16, SW3_CS17, SW3_CS18}, {1, SW4_CS16, SW4_CS17, SW4_CS18}, {1, SW5_CS16, SW5_CS17, SW5_CS18},
    {1, SW6_CS16, SW6_CS17, SW6_CS18}, {1, SW7_CS16, SW7_CS17, SW7_CS18},
    /* slots 82/83 exist in silicon but are unwired; RGB_MATRIX_LED_COUNT is 82
       so they are intentionally omitted here. */
};

/* ---- LCD pass-through over USART3 (SD3) ---- */
#if defined(AL80_LCD_ENABLE)
/* 460800 8N1, cr1/cr2/cr3 = 0 (STM32 SerialConfig) */
static const SerialConfig lcd_serial_config = {AL80_LCD_BAUD, 0, 0, 0};

static void al80_lcd_init(void) {
    /* AFIO clock: ChibiOS _pal_lld_init already enables AFIOEN, but assert it
       explicitly so the MAPR writes below can never be silently dropped. */
    RCC->APB2ENR |= RCC_APB2ENR_AFIOEN;
    (void)RCC->APB2ENR;

    /* USART3 partial remap: TX=PC10, RX=PC11.
       Single write that sets the remap AND (re)asserts the SWJ-disable in one
       shot. A plain `MAPR |= REMAP` read-modify-write reads the write-only
       SWJ_CFG field back as 0b000 and would re-enable full JTAG/SWD, reclaiming
       the matrix pins PA14/PA15/PB3/PB4. Writing the whole field keeps SWJ off
       while the remap bit sticks. This matches the stock ripple init order
       (remap set with SWJ disabled). */
    AFIO->MAPR = (AFIO->MAPR & ~AFIO_MAPR_SWJ_CFG_Msk)
               | AFIO_MAPR_SWJ_CFG_DISABLE
               | AFIO_MAPR_USART3_REMAP_PARTIALREMAP;

    palSetLineMode(C10, PAL_MODE_STM32_ALTERNATE_PUSHPULL);
    palSetLineMode(C11, PAL_MODE_INPUT);
    sdStart(&SD3, &lcd_serial_config);
}
#endif

/* First byte of the raw-HID report multiplexes: VIA/VialRGB own their own
 * command IDs and never reach here (via.c dispatches those first). Only the
 * three LCD report IDs land in raw_hid_receive_kb. Layout of the report:
 *   [0] cmd (0x40/0x41/0x42)
 *   [3] data_len
 *   [6] ack byte we write back (0x55 ok / 0x0F busy)
 *   [7..] payload forwarded verbatim to the LCD module
 */
void raw_hid_receive_kb(uint8_t *data, uint8_t length) {
    switch (data[0]) {
        case AP_W_SCREEN_INFO:   // 0x40
        case AP_W_SCREEN_DATA: { // 0x41
            uint8_t data_len = data[3];
            if (data_len > length - 7) {
                data_len = length - 7;
            }
#if defined(AL80_LCD_ENABLE)
            /* No byte-swap: the display module reads RGB565 big-endian, same as al80-studio
               sends. Confirmed on-device 2026-07-05 (forced 0xE007 -> red; swapped-to-LE -> blue). */
            sdWrite(&SD3, &data[7], data_len);
            /* Match the stock/b75Pro handler: a short settle after each block so
               the self-parsing module keeps up with back-to-back writes. */
            if (data[0] == AP_W_SCREEN_DATA) {
                wait_us(5);
            }
#endif
            g_screen_busy = true; screen_busy_wd = 200; /* pause RGB SPI during transfer */
            data[6] = 0x55; // ACK
            break;
        }
        case AP_GIVE_SCREEN_SEM: // 0x42
            g_screen_busy = false; screen_busy_wd = 0; /* transfer done - resume RGB */
            data[6] = 0x55;      // release semaphore -> ACK
            break;

        /* ---- user-editable palette protocol ----
         * The report buffer is echoed back by via.c on return, so responses
         * are written in place. See config.h for the opcode + ACK layout. */
        case AP_PALETTE_GET: { // 0x43 -> [0x43, count, h0,s0, h1,s1, ...]
            data[1] = AL80_PALETTE_LEN;
            for (uint8_t i = 0; i < AL80_PALETTE_LEN; i++) {
                data[2 + i * 2] = al80_palette[i].h;
                data[3 + i * 2] = al80_palette[i].s;
            }
            break;
        }
        case AP_PALETTE_SET: { // 0x44: data[1]=index, data[2]=h, data[3]=s (RAM only)
            uint8_t idx = data[1];
            if (idx < AL80_PALETTE_LEN) {
                al80_palette[idx].h = data[2];
                al80_palette[idx].s = data[3];
                data[6] = 0x55; // ACK (index/h/s left echoed in place)
            } else {
                data[6] = 0x0F; // out-of-range index
            }
            break;
        }
        case AP_PALETTE_SAVE: // 0x45: commit RAM mirror to EEPROM
            al80_palette_save();
            data[6] = 0x55;   // ACK
            break;

        /* ---- independent side-LED-bar protocol (mirrors the palette above) ---- */
        case AP_BAR_GET: { // 0x46 -> [0x46, h, s, v, independent]
            data[1] = bar_h;
            data[2] = bar_s;
            data[3] = bar_v;
            data[4] = bar_independent ? 1 : 0;
            break;
        }
        case AP_BAR_SET: { // 0x47: data[1]=h, data[2]=s, data[3]=v, data[4]=independent (RAM only)
            bar_h           = data[1];
            bar_s           = data[2];
            bar_v           = data[3];
            bar_independent = data[4] ? true : false;
            data[6] = 0x55; // ACK (h/s/v/independent left echoed in place)
            break;
        }
        case AP_BAR_SAVE: // 0x48: commit bar state to EEPROM
            al80_bar_save();
            data[6] = 0x55; // ACK
            break;

        default:
            break;
    }
    /* via.c calls raw_hid_send(data, length) for us on return. */
}

/* Watchdog: resume RGB if an LCD transfer stalls (0x42 lost), so lighting can't freeze. */
void matrix_scan_kb(void) {
    if (screen_busy_wd && --screen_busy_wd == 0) g_screen_busy = false;
    matrix_scan_user();
}

/* Push the battery to the module's homepage gauge every 10s (first push ~2s after boot), but
 * never while an image transfer is in flight (would interleave bytes on USART3). */
void housekeeping_task_kb(void) {
    static uint32_t batt_timer = 0;
    static uint32_t init_timer = 0;
    static uint8_t  boot_inits = 0;   /* run the homepage init a few times over the first ~6s */
    if (!g_screen_busy) {
        if (locks_dirty) {                 /* a Caps/Num toggle landed mid-transfer; flush it now */
            locks_dirty = false;
            al80_locks_push();
        }
        if (boot_inits < 4) {
            if (timer_elapsed32(init_timer) > 1500) {
                init_timer = timer_read32();
                boot_inits++;
                al80_homepage_init();
            }
        } else if (timer_elapsed32(init_timer) > 30000) {   /* self-heal the widgets */
            init_timer = timer_read32();
            al80_homepage_init();
        } else if (timer_elapsed32(batt_timer) > 3000) {   /* keep the battery fresh */
            batt_timer = timer_read32();
            al80_battery_push();
        }
    }
    housekeeping_task_user();
}

void keyboard_pre_init_kb(void) {
    /* Display-module reset pulse. B7 is shared: the aw20216s driver later
       holds it HIGH to enable the LED matrix (AW20216S_EN_PIN B7, confirmed
       on-device: B7 low = no keys). But ripple's screen-init first drives B7
       LOW as a display-module reset/enable (disasm ~0x8009FC2: GPIOB bit7
       output-PP, then BRR bit7) and our firmware never did, so the module
       never reset and stayed dark. Pulse it low here, BEFORE aw driver init
       (which runs during keyboard_init, after this). The aw driver then drives
       B7 back HIGH -> RGB matrix enabled, module already reset. */
    setPinOutput(B7);
    writePinLow(B7);      // display-module reset pulse (matches ripple screen-init)
    wait_ms(20);
    keyboard_pre_init_user();
}

/* ---- one-time dynamic-keymap fixups (version-gated) ----
 * The knob-press key sits at matrix [0,14] (the encoder-click position — the
 * 15th arg of the top LAYOUT row, col pin C13). keymaps/vial/keymap.c ships it
 * as plain KC_MUTE on all four layers. An older keymap.c seeded a tap-hold
 * keycode there into the dynamic-keymap EEPROM, and that stale value SURVIVES a
 * reflash (QMK never erases the emulated EEPROM on flash), so the mute key gets
 * a ~200ms tap-hold delay on-device. This runs once per fixups-version to
 * surgically rewrite ONLY that one key back to KC_MUTE, leaving every other
 * dynamic-keymap customization intact.
 *
 * Gating byte lives in the fixed EECONFIG_USER dword — a core eeconfig field at
 * a constant address, NOT the KB datablock and NOT the dynamic-keymap region.
 * So stamping it disturbs nothing: not the palette/side-bar sub-blocks (KB
 * datablock, magics 0x5A/0x5B) and not DYNAMIC_KEYMAP_EEPROM_START (anchored to
 * EECONFIG_SIZE = base + KB_DATA_SIZE + USER_DATA_SIZE, none of which change).
 * Growing the KB datablock instead WOULD shift EECONFIG_SIZE and scramble the
 * whole stored keymap, which is exactly why we don't. */
#define AL80_KNOB_ROW       0
#define AL80_KNOB_COL       14
#define AL80_FIXUPS_VERSION 1   /* bump to re-run fixups after a future keymap change */

static void al80_apply_dynamic_keymap_fixups(void) {
    uint32_t ecu = eeconfig_read_user();
    if ((ecu & 0xFFu) == AL80_FIXUPS_VERSION) {
        return;   /* already applied — never fight a later user remap of this key */
    }
    /* keymap.c has KC_MUTE at [0,14] on every layer; restore each one. */
    for (uint8_t layer = 0; layer < DYNAMIC_KEYMAP_LAYER_COUNT; layer++) {
        dynamic_keymap_set_keycode(layer, AL80_KNOB_ROW, AL80_KNOB_COL, KC_MUTE);
    }
    /* Preserve the upper 3 bytes of the user dword; stamp only the version byte. */
    eeconfig_update_user((ecu & 0xFFFFFF00u) | AL80_FIXUPS_VERSION);
}

void keyboard_post_init_kb(void) {
    /* Free PA13/14/15 + PB3/4 from SWD/JTAG so the matrix can use them */
    AFIO->MAPR = (AFIO->MAPR & ~AFIO_MAPR_SWJ_CFG_Msk);
    AFIO->MAPR |= AFIO_MAPR_SWJ_CFG_DISABLE;

    /* LCD module control rails (from the cert mk856.c). */
    setPinOutput(A8);
    writePinHigh(A8);   // module power/EN
    setPinOutput(C9);
    writePinHigh(C9);
    setPinInput(B9);    // plug/detect (also the unverified WS2812 bar candidate)

#if defined(AL80_LCD_ENABLE)
    al80_lcd_init();
#endif

    /* Seed the live palette mirror (EEPROM if a valid magic byte is stored,
       else the compiled default without touching flash). */
    al80_palette_load();

    /* Seed the independent side-bar color from its own EEPROM sub-block. */
    al80_bar_load();

    /* One-time: undo the stale tap-hold on the knob-press key (runs after
       via_init(), so this write to the dynamic keymap is not clobbered). */
    al80_apply_dynamic_keymap_fixups();

    keyboard_post_init_user();
}
