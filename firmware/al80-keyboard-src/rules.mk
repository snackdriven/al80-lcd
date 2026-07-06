# aw20216s RGB matrix rides on the SPI master driver
SPI_DRIVER_REQUIRED = yes

# LCD pass-through forwards raw-HID payloads over USART3 (SD3)
SERIAL_DRIVER_REQUIRED = yes
OPT_DEFS += -DAL80_LCD_ENABLE

# Custom, user-recolorable RGB matrix effect (PALETTE_CYCLE)
RGB_MATRIX_CUSTOM_KB = yes
ANALOG_DRIVER_REQUIRED = yes
DEBOUNCE_TYPE = sym_eager_pk
