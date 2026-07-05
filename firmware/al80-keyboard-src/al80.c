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
#include "al80.h"
#include <string.h>

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
            data[6] = 0x55; // ACK
            break;
        }
        case AP_GIVE_SCREEN_SEM: // 0x42
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

        default:
            break;
    }
    /* via.c calls raw_hid_send(data, length) for us on return. */
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

    keyboard_post_init_user();
}
