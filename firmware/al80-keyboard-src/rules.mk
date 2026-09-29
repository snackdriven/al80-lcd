# aw20216s RGB matrix rides on the SPI master driver
SPI_DRIVER_REQUIRED = yes

# LCD pass-through forwards raw-HID payloads over USART3 (SD3)
SERIAL_DRIVER_REQUIRED = yes
OPT_DEFS += -DAL80_LCD_ENABLE

# Custom, user-recolorable RGB matrix effect (PALETTE_CYCLE)
RGB_MATRIX_CUSTOM_KB = yes
ANALOG_DRIVER_REQUIRED = yes
DEBOUNCE_TYPE = sym_eager_pk

# The part is physically STM32F103xB (128 KB), proven by a DFU read of
# 0x08002000-0x08020000 on 2026-09-29. Without this, QMK falls back to
# mcu_selection.mk's STM32F103x8 default and caps the app at 56 KB.
MCU_LDSCRIPT = STM32F103xB_stm32duino
