/* Copyright 2026 snackdriven
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
#pragma once

#include_next <mcuconf.h>

/* SPI1 for the aw20216s RGB matrix driver */
#undef STM32_SPI_USE_SPI1
#define STM32_SPI_USE_SPI1 TRUE

/* USART3 for the LCD pass-through (partial remap PC10/PC11) */
#undef STM32_SERIAL_USE_USART3
#define STM32_SERIAL_USE_USART3 TRUE
