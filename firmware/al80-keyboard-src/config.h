/* Copyright 2026 snackdriven
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * YUNZII AL80 (STM32F103xB, stm32duino bootloader)
 * Hardware params recovered by RIPPLE.bin disassembly, reconciled with the
 * MK856 cert source. See research/al80-qmk-hardware-params.md.
 */
#pragma once

/* ---- aw20216s RGB matrix driver on SPI1 (no remap) ---- */
/* SPI1: SCK=A5, MISO=A6, MOSI=A7 (STM32F103 default AF, mode 0, MSB-first) */
#define SPI_DRIVER   SPID1
#define SPI_SCK_PIN  A5
#define SPI_MISO_PIN A6
#define SPI_MOSI_PIN A7

/* aw20216s chip-selects */
#define AW20216S_CS_PIN_1 B6   /* driver 0 */
#define AW20216S_CS_PIN_2 C8   /* driver 1 */
/* aw20216s hardware enable: the driver drives B7 HIGH to enable the LED matrix.
 * On-device the keys go dark when B7 is low, confirming B7 is the aw enable. */
#define AW20216S_EN_PIN B7

/* SPI mode 0, /4 divisor are the driver defaults; keep explicit for clarity */
#define AW20216S_SPI_MODE    0
#define AW20216S_SPI_DIVISOR 4

/* Per-driver LED split from the cert source (sum must equal LED count = 84) */
#define DRIVER_1_LED_TOTAL 45
#define DRIVER_2_LED_TOTAL 39

/* ---- dynamic keymap ---- */
/* Vial UID + unlock combo live in keymaps/vial/config.h */
#define DYNAMIC_KEYMAP_LAYER_COUNT 4

/* ---- LCD pass-through over USART3 (partial remap TX=PC10, RX=PC11) ---- */
/* Baud 460800, 8N1, interrupt-driven (no DMA). SD3 started in post_init. */
#define AL80_LCD_BAUD 921600

/* raw-HID endpoint/report size: vendor firmware uses 64-byte raw-HID for both
 * VIA/lighting commands and the LCD stream; usevia + our tooling assume 64. */
#define RAW_EPSIZE 64

/* raw-HID report ids used by the LCD pass-through protocol */
#define AP_W_SCREEN_INFO 0x40
#define AP_W_SCREEN_DATA 0x41
#define AP_GIVE_SCREEN_SEM 0x42

/* ---- user-editable RGB palette (PALETTE_CYCLE effect) ----
 * A RAM mirror of PALETTE_LEN {hue,sat} pairs feeds the PALETTE_CYCLE effect.
 * It is loaded at post_init from a dedicated, collision-safe KB EEPROM
 * datablock (STM32F1 wear-leveling flash) and edited live over raw-HID.
 * Grow the palette by bumping AL80_PALETTE_LEN (and AL80_PALETTE_DEFAULT
 * in al80.c); the datablock size tracks it automatically. */
#define AL80_PALETTE_LEN 3

/* Dedicated KB datablock: 1 magic byte + PALETTE_LEN {h,s} pairs.
 * QMK reserves EECONFIG_KB_DATABLOCK for us, so this never collides with
 * VIA/Vial dynamic-keymap or rgb_matrix eeconfig storage. */
#define EECONFIG_KB_DATA_SIZE (1 + AL80_PALETTE_LEN * 2)

/* raw-HID palette protocol opcodes (top-level, alongside LCD 0x40..0x42).
 * VIA command IDs top out at 0x13 (+0xFE/0xFF), so these reach the default
 * case in via.c's raw_hid_receive() -> raw_hid_receive_kb(). */
#define AP_PALETTE_GET  0x43
#define AP_PALETTE_SET  0x44
#define AP_PALETTE_SAVE 0x45

/* VialRGB effect id for the custom PALETTE_CYCLE effect. High range so it
 * cannot collide with the stock VIALRGB_EFFECT_* ids (which end < 0x40). */
#define AL80_VIALRGB_PALETTE_CYCLE_ID 0x0100

/* ---- built-in RGB matrix effects (v18: were all off -> only SOLID_COLOR + custom PALETTE_CYCLE
 * existed, so al80-studio effects no-op'd). Enable the popular non-framebuffer ones. ---- */
#define ENABLE_RGB_MATRIX_BREATHING
#define ENABLE_RGB_MATRIX_BAND_VAL
#define ENABLE_RGB_MATRIX_CYCLE_ALL
#define ENABLE_RGB_MATRIX_CYCLE_LEFT_RIGHT
#define ENABLE_RGB_MATRIX_CYCLE_UP_DOWN
#define ENABLE_RGB_MATRIX_RAINBOW_MOVING_CHEVRON
#define ENABLE_RGB_MATRIX_CYCLE_OUT_IN
#define ENABLE_RGB_MATRIX_CYCLE_PINWHEEL
#define ENABLE_RGB_MATRIX_CYCLE_SPIRAL
#define ENABLE_RGB_MATRIX_DUAL_BEACON
#define ENABLE_RGB_MATRIX_RAINBOW_BEACON
#define ENABLE_RGB_MATRIX_RAINDROPS
#define ENABLE_RGB_MATRIX_HUE_BREATHING
#define ENABLE_RGB_MATRIX_HUE_WAVE
/* framebuffer effects (need a per-frame buffer; ~90 bytes on this 6x15 matrix) */
#define RGB_MATRIX_FRAMEBUFFER_EFFECTS
#define ENABLE_RGB_MATRIX_DIGITAL_RAIN
#define ENABLE_RGB_MATRIX_PIXEL_RAIN

/* ---- v20: react-to-keypress effects (the whole point). Flash reclaimed by
 * disabling TAP_DANCE/COMBO/KEY_OVERRIDE in keymaps/vial/rules.mk. All the
 * reactive/splash effects below are gated behind RGB_MATRIX_KEYREACTIVE_ENABLED
 * which also pulls in g_last_hit_tracker. ---- */
#define RGB_MATRIX_KEYREACTIVE_ENABLED
#define ENABLE_RGB_MATRIX_SOLID_REACTIVE_SIMPLE
#define ENABLE_RGB_MATRIX_SOLID_REACTIVE
#define ENABLE_RGB_MATRIX_SOLID_REACTIVE_WIDE
#define ENABLE_RGB_MATRIX_SOLID_REACTIVE_MULTIWIDE
#define ENABLE_RGB_MATRIX_SOLID_REACTIVE_CROSS
#define ENABLE_RGB_MATRIX_SOLID_REACTIVE_MULTICROSS
#define ENABLE_RGB_MATRIX_SOLID_REACTIVE_NEXUS
#define ENABLE_RGB_MATRIX_SOLID_REACTIVE_MULTINEXUS
#define ENABLE_RGB_MATRIX_SPLASH
#define ENABLE_RGB_MATRIX_MULTISPLASH
#define ENABLE_RGB_MATRIX_SOLID_SPLASH
#define ENABLE_RGB_MATRIX_SOLID_MULTISPLASH
