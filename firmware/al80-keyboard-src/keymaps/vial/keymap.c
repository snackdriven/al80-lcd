/* Copyright 2026 snackdriven
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
#include QMK_KEYBOARD_H

/* Hardcoded per-layer encoder (knob). Runs the instant the firmware is flashed:
 * no Vial layout entry, no ENCODER_MAP, no dynamic-keymap EEPROM seed, so it
 * can never fall back to KC_NO. Knob-right = clockwise.
 *   L0 volume, L1 RGB brightness, L2 RGB hue, L3 media prev/next.
 * RGB layers call the rgb_matrix API directly (RGB_* keycodes do NOT work via
 * tap_code16 -- they need process_record, not the HID report). */
bool encoder_update_user(uint8_t index, bool clockwise) {
    if (index != 0) {
        return false;
    }
    switch (get_highest_layer(layer_state)) {
        case 1:  // RGB brightness
            if (clockwise) {
                rgb_matrix_increase_val();
            } else {
                rgb_matrix_decrease_val();
            }
            break;
        case 2:  // RGB hue
            if (clockwise) {
                rgb_matrix_increase_hue();
            } else {
                rgb_matrix_decrease_hue();
            }
            break;
        case 3:  // media previous / next
            tap_code16(clockwise ? KC_MNXT : KC_MPRV);
            break;
        case 0:
        default:  // volume
            tap_code16(clockwise ? KC_VOLU : KC_VOLD);
            break;
    }
    return false;
}

const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {
    [0] = LAYOUT(
        KC_ESC,  KC_F1,   KC_F2,   KC_F3,   KC_F4,   KC_F5,   KC_F6,   KC_F7,   KC_F8,   KC_F9,   KC_F10,  KC_F11,  KC_F12,  KC_DEL,  KC_MUTE,
        KC_GRV,  KC_1,    KC_2,    KC_3,    KC_4,    KC_5,    KC_6,    KC_7,    KC_8,    KC_9,    KC_0,    KC_MINS, KC_EQL,  KC_BSPC, KC_PGUP,
        KC_TAB,  KC_Q,    KC_W,    KC_E,    KC_R,    KC_T,    KC_Y,    KC_U,    KC_I,    KC_O,    KC_P,    KC_LBRC, KC_RBRC, KC_BSLS, KC_PGDN,
        KC_CAPS, KC_A,    KC_S,    KC_D,    KC_F,    KC_G,    KC_H,    KC_J,    KC_K,    KC_L,    KC_SCLN, KC_QUOT,          KC_ENT,
        KC_LSFT, KC_Z,    KC_X,    KC_C,    KC_V,    KC_B,    KC_N,    KC_M,    KC_COMM, KC_DOT,  KC_SLSH,          KC_RSFT, KC_UP,
        KC_LCTL, KC_LGUI, KC_LALT,                   KC_SPC,                   MO(1),   KC_RCTL, KC_LEFT, KC_DOWN,          KC_RGHT
    ),
    [1] = LAYOUT(
        _______, KC_BRID, KC_BRIU, LGUI(KC_TAB), KC_MYCM, KC_MAIL, KC_WHOM, KC_MPRV, KC_MPLY, KC_MNXT, KC_MUTE, KC_VOLD, KC_VOLU, _______, KC_MUTE,
        /* host-free LCD view keys (fresh-board defaults; existing users bind via Studio/Vial):
           Fn+8 = picture, Fn+9 = home/clock, Fn+0 = gif */
        _______, _______, _______, _______, _______, _______, _______, _______, AL80_KC_VIEW_PICTURE, AL80_KC_VIEW_HOME, AL80_KC_VIEW_GIF, _______, _______, _______, _______,
        _______, _______, _______, _______, _______, _______, _______, _______, _______, _______, _______, _______, _______, RGB_MOD, _______,
        _______, _______, _______, _______, _______, _______, _______, _______, _______, _______, _______, _______,          RGB_HUI,
        _______, _______, _______, _______, _______, _______, _______, _______, _______, _______, _______,          _______, RGB_VAI,
        _______, _______, _______,                   _______,                   _______, _______, RGB_SPD, RGB_VAD,          RGB_SPI
    ),
    [2] = LAYOUT(
        KC_ESC,  KC_F1,   KC_F2,   KC_F3,   KC_F4,   KC_F5,   KC_F6,   KC_F7,   KC_F8,   KC_F9,   KC_F10,  KC_F11,  KC_F12,  KC_DEL,  KC_MUTE,
        KC_GRV,  KC_1,    KC_2,    KC_3,    KC_4,    KC_5,    KC_6,    KC_7,    KC_8,    KC_9,    KC_0,    KC_MINS, KC_EQL,  KC_BSPC, KC_PGUP,
        KC_TAB,  KC_Q,    KC_W,    KC_E,    KC_R,    KC_T,    KC_Y,    KC_U,    KC_I,    KC_O,    KC_P,    KC_LBRC, KC_RBRC, KC_BSLS, KC_PGDN,
        KC_CAPS, KC_A,    KC_S,    KC_D,    KC_F,    KC_G,    KC_H,    KC_J,    KC_K,    KC_L,    KC_SCLN, KC_QUOT,          KC_ENT,
        KC_LSFT, KC_Z,    KC_X,    KC_C,    KC_V,    KC_B,    KC_N,    KC_M,    KC_COMM, KC_DOT,  KC_SLSH,          KC_RSFT, KC_UP,
        KC_LCTL, KC_LALT, KC_LGUI,                   KC_SPC,                   MO(3),   KC_RCTL, KC_LEFT, KC_DOWN,          KC_RGHT
    ),
    [3] = LAYOUT(
        _______, KC_BRID, KC_BRIU, LCTL(KC_UP), _______, _______, _______, KC_MPRV, KC_MPLY, KC_MNXT, KC_MUTE, KC_VOLD, KC_VOLU, _______, KC_MUTE,
        _______, _______, _______, _______, _______, _______, _______, _______, _______, _______, _______, _______, _______, _______, _______,
        _______, _______, _______, _______, _______, _______, _______, _______, _______, _______, _______, _______, _______, RGB_MOD, _______,
        _______, _______, _______, _______, _______, _______, _______, _______, _______, _______, _______, _______,          RGB_HUI,
        _______, _______, _______, _______, _______, _______, _______, _______, _______, _______, _______,          _______, RGB_VAI,
        _______, _______, _______,                   _______,                   _______, _______, RGB_SPD, RGB_VAD,          RGB_SPI
    )
};
