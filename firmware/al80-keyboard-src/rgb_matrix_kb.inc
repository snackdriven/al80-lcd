/* Copyright 2026 snackdriven
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * AL80 custom RGB matrix effect: PALETTE_CYCLE
 *
 * Proves the "make the rainbow presets just a color or two" idea. Instead of a
 * full 0..255 hue sweep, this reads a small, editable palette array and eases
 * between its entries. The palette now lives in a runtime RAM mirror
 * (al80_palette, defined in al80.c) that can be recoloured live over raw-HID
 * (opcodes 0x43/0x44/0x45) and persisted to EEPROM, so edits take effect
 * without a recompile.
 */

// clang-format off
RGB_MATRIX_EFFECT(PALETTE_CYCLE)

#ifdef RGB_MATRIX_CUSTOM_EFFECT_IMPLS

/* Shared runtime palette (type + extern al80_palette[]). */
#include "al80.h"

#define AL80_PALETTE_SIZE (AL80_PALETTE_LEN)

static HSV al80_palette_math(HSV hsv, uint16_t phase) {
    /* phase is 0..(AL80_PALETTE_SIZE<<8)-1: high byte = index, low byte = blend */
    uint8_t idx   = (phase >> 8) % AL80_PALETTE_SIZE;
    uint8_t nxt   = (idx + 1) % AL80_PALETTE_SIZE;
    uint8_t blend = phase & 0xFF;

    uint8_t h0 = al80_palette[idx].h;
    uint8_t h1 = al80_palette[nxt].h;
    /* shortest-path hue interpolation on the 0..255 wheel */
    int16_t dh = (int16_t)h1 - (int16_t)h0;
    if (dh > 127)  dh -= 256;
    if (dh < -128) dh += 256;

    hsv.h = (uint8_t)(h0 + ((dh * blend) >> 8));
    hsv.s = (uint8_t)(al80_palette[idx].s +
                      (((int16_t)al80_palette[nxt].s - (int16_t)al80_palette[idx].s) * blend >> 8));
    return hsv;
}

static bool PALETTE_CYCLE(effect_params_t* params) {
    RGB_MATRIX_USE_LIMITS(led_min, led_max);

    HSV      hsv  = rgb_matrix_config.hsv;
    uint16_t span = AL80_PALETTE_SIZE << 8;
    /* time drives the blend position; speed scales it */
    uint16_t time = scale16by8(g_rgb_timer, rgb_matrix_config.speed / 8 + 1);

    for (uint8_t i = led_min; i < led_max; i++) {
        RGB_MATRIX_TEST_LED_FLAGS();
        /* small per-column phase offset so it reads as a gentle wave */
        uint16_t phase = (time + (g_led_config.point[i].x >> 1)) % span;
        HSV c = al80_palette_math(hsv, phase);
        RGB rgb = rgb_matrix_hsv_to_rgb(c);
        rgb_matrix_set_color(i, rgb.r, rgb.g, rgb.b);
    }
    return rgb_matrix_check_finished_leds(led_max);
}

#endif // RGB_MATRIX_CUSTOM_EFFECT_IMPLS
