/* Copyright 2026 snackdriven
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Shared AL80 declarations. Lives here so both al80.c (raw-HID handler,
 * EEPROM load/save) and rgb_matrix_kb.inc (the PALETTE_CYCLE effect, compiled
 * into rgb_matrix.c) see the same runtime palette mirror.
 */
#pragma once

#include <stdint.h>
/* For QK_KB_0 (== 0x7E00, the VIA CUSTOM(0) base) used by the keycode enum below.
 * Safe to include here: it is include-guarded and pulls only enum/macro definitions,
 * so al80.h stays self-sufficient no matter which TU includes it (al80.c after
 * quantum.h, or rgb_matrix_kb.inc from inside rgb_matrix.c). */
#include "quantum_keycodes.h"

#ifndef AL80_PALETTE_LEN
#    define AL80_PALETTE_LEN 3
#endif

/* ---- custom keycodes (VIA CUSTOM(n) == QK_KB_0 + n) ----
 * This build shipped NO process_record of any kind, so the stock vendor's view-switch
 * customs did nothing. process_record_kb (al80.c) now consumes these:
 *   VIEW_*   (22-24) — host-free LCD view switch over USART3 (home/picture/gif).
 *   PANEL_*  (25-29) — fire the local view switch AND signal the host cycler (raw-HID 0x4B).
 * Values are pinned to the Studio/VIA numbering so the existing Studio presets bind them
 * with zero code change; the 0-21 gap preserves alignment with the factory customs. */
enum al80_keycodes {
    AL80_KC_VIEW_HOME = QK_KB_0 + 22,          /* 0x7E16 CUSTOM(22) -> PK_GO home     0x0B */
    AL80_KC_VIEW_PICTURE,                       /* 0x7E17 CUSTOM(23) -> PK_TOGGLE_PIC  0x0D */
    AL80_KC_VIEW_GIF,                           /* 0x7E18 CUSTOM(24) -> PK_GO gif      0x0F */
    AL80_KC_PANEL_NOWPLAYING = QK_KB_0 + 25,    /* 0x7E19 CUSTOM(25) -> view 0x0D + panel 0x00 */
    AL80_KC_PANEL_WEATHER,                       /* 0x7E1A CUSTOM(26) -> view 0x0D + panel 0x01 */
    AL80_KC_PANEL_CLOCK,                         /* 0x7E1B CUSTOM(27) -> view 0x0B + panel 0x02 */
    AL80_KC_CYCLE_TOGGLE,                        /* 0x7E1C CUSTOM(28) -> panel 0xF0 (toggle)    */
    AL80_KC_PANEL_NEXT,                          /* 0x7E1D CUSTOM(29) -> panel 0xF1 (next)      */
};

/* One palette entry: HSV hue/sat pair (value comes from user brightness). */
typedef struct {
    uint8_t h;
    uint8_t s;
} al80_palette_color_t;

/* RAM mirror of the palette. Defined in al80.c, read live by PALETTE_CYCLE.
 * raw-HID 0x44 edits it in place; 0x45 flushes it to EEPROM. */
extern al80_palette_color_t al80_palette[AL80_PALETTE_LEN];
