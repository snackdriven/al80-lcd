/* Copyright 2026 snackdriven
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Shared AL80 declarations. Lives here so both al80.c (raw-HID handler,
 * EEPROM load/save) and rgb_matrix_kb.inc (the PALETTE_CYCLE effect, compiled
 * into rgb_matrix.c) see the same runtime palette mirror.
 */
#pragma once

#include <stdint.h>
#include <stdbool.h>
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

    /* ---- wireless ----
     * Pinned to the FACTORY numbering (KB SD5 / research/al80-feature-map.md SD7)
     * so the stock muscle memory and any existing VIA/Studio presets keep working:
     * CUSTOM(1..3) are BT slots 1-3 and CUSTOM(4) is the 2.4G dongle. Stock uses a
     * dedicated KC_USB for wired; we have no such keycode here, so USB lands after
     * the panel block rather than colliding with an unrelated factory custom.
     * Hold-to-pair is handled in process_record_kb, not by separate keycodes. */
    AL80_KC_BT1 = QK_KB_0 + 1,                   /* 0x7E01 CUSTOM(1)  -> BLE slot 1 */
    AL80_KC_BT2 = QK_KB_0 + 2,                   /* 0x7E02 CUSTOM(2)  -> BLE slot 2 */
    AL80_KC_BT3 = QK_KB_0 + 3,                   /* 0x7E03 CUSTOM(3)  -> BLE slot 3 */
    AL80_KC_24G = QK_KB_0 + 4,                   /* 0x7E04 CUSTOM(4)  -> 2.4G dongle */
    AL80_KC_USB = QK_KB_0 + 30,                  /* 0x7E1E CUSTOM(30) -> back to wired */
};

/* ---- wireless (al80_wireless.c) ----
 * Mode values are the module's own 1-based numbering: 1-3 are BLE slots, 4 is
 * the 2.4G dongle. USB is 0 and means "radio stopped, USB host driver". */
typedef enum {
    AL80_WL_USB = 0,
    AL80_WL_BT1 = 1,
    AL80_WL_BT2 = 2,
    AL80_WL_BT3 = 3,
    AL80_WL_24G = 4,
} al80_wl_mode_t;

/* Hold a BT/2.4G key this long to enter pairing instead of just connecting. */
#ifndef AL80_WL_PAIR_HOLD_MS
#    define AL80_WL_PAIR_HOLD_MS 1000
#endif

#ifdef AL80_WIRELESS_ENABLE
void           al80_wireless_init(void);
void           al80_wireless_task(bool screen_busy);
void           al80_wireless_request(al80_wl_mode_t mode, bool pair);
void           al80_wireless_battery_push(uint8_t pct);
al80_wl_mode_t al80_wireless_mode(void);
bool           al80_wireless_is_connected(void);
void           al80_wireless_debug(uint8_t *out); /* 10 bytes */
#endif

/* One palette entry: HSV hue/sat pair (value comes from user brightness). */
typedef struct {
    uint8_t h;
    uint8_t s;
} al80_palette_color_t;

/* RAM mirror of the palette. Defined in al80.c, read live by PALETTE_CYCLE.
 * raw-HID 0x44 edits it in place; 0x45 flushes it to EEPROM. */
extern al80_palette_color_t al80_palette[AL80_PALETTE_LEN];
