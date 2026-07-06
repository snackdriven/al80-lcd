VIA_ENABLE = yes
VIAL_ENABLE = yes
VIALRGB_ENABLE = yes
LTO_ENABLE = yes
# Encoder handled by a hardcoded per-layer encoder_update_user() callback in
# keymap.c (works the instant it is flashed; no Vial layout entry / EEPROM
# seed needed). ENCODER_MAP must be OFF or it conflicts with the callback.
ENCODER_MAP_ENABLE = no

# v20: reclaim flash for reactive RGB effects. User does not use these Vial
# features. build_vial.mk uses ?= so these explicit "no" overrides win.
TAP_DANCE_ENABLE = no
COMBO_ENABLE = no
KEY_OVERRIDE_ENABLE = no
