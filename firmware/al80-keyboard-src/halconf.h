/* Copyright 2026 snackdriven
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
#pragma once

/* SPI master for aw20216s */
#define HAL_USE_SPI TRUE
#define SPI_USE_WAIT TRUE
#define SPI_SELECT_MODE SPI_SELECT_MODE_PAD

/* Serial driver for the LCD pass-through (SD3) */
#define HAL_USE_SERIAL TRUE

#include_next <halconf.h>
