/* Copyright 2026 snackdriven
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Shared AL80 declarations. Lives here so both al80.c (raw-HID handler,
 * EEPROM load/save) and rgb_matrix_kb.inc (the PALETTE_CYCLE effect, compiled
 * into rgb_matrix.c) see the same runtime palette mirror.
 */
#pragma once

#include <stdint.h>

#ifndef AL80_PALETTE_LEN
#    define AL80_PALETTE_LEN 3
#endif

/* One palette entry: HSV hue/sat pair (value comes from user brightness). */
typedef struct {
    uint8_t h;
    uint8_t s;
} al80_palette_color_t;

/* RAM mirror of the palette. Defined in al80.c, read live by PALETTE_CYCLE.
 * raw-HID 0x44 edits it in place; 0x45 flushes it to EEPROM. */
extern al80_palette_color_t al80_palette[AL80_PALETTE_LEN];
