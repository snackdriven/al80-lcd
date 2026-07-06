VIA_ENABLE = yes
VIAL_ENABLE = yes
VIALRGB_ENABLE = yes
LTO_ENABLE = yes
ENCODER_MAP_ENABLE = yes

# v20: reclaim flash for reactive RGB effects. User does not use these Vial
# features. build_vial.mk uses ?= so these explicit "no" overrides win.
TAP_DANCE_ENABLE = no
COMBO_ENABLE = no
KEY_OVERRIDE_ENABLE = no
