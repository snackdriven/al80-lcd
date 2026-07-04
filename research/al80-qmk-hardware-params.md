# AL80 QMK hardware params (extracted from RIPPLE.bin, 2026-07)

Everything the public MK856 cert source omits, recovered by disassembly. Feeds the custom vial-qmk build. Base addr note: RIPPLE.bin links at flash **0x08002000** (8 KB stm32duino bootloader below).

## MCU / board
- STM32F103xB, bootloader stm32duino (`board STM32_F103_STM32DUINO`), DFU entry = hold **ESC + plug USB**.
- VID 0x28E9 / PID 0x30AF.
- `keyboard_post_init` must disable SWJ (matrix uses PA13/14/15, PB3/4): `AFIO->MAPR SWJ_CFG = DISABLE`.

## RGB matrix — aw20216s (CONFIRMED)
- Bus **SPI1** (0x40013000): SCK=**A5**, MISO=**A6**, MOSI=**A7** (no remap). Mode 0, MSB-first, 8-bit (QMK aw20216s defaults).
- `AW20216S_CS_PIN_1 = B6` (driver 0), `AW20216S_CS_PIN_2 = C8` (driver 1), idle-high/assert-low.
- `AW20216S_EN_PIN = B7` (reset-low then enable-high pulse).
- 84 LED slots; **82 real** (driver0=44, driver1=38); indices 82,83 = `{0,0,0,0}` unused.
- Table @ flash 0x080116A0, stride 4, `{driver, R_off, G_off, B_off}`; offset→macro `SW=off/18+1, CS=off%18+1`.
- Layout has real wiring quirks (non-clean 45/39 split, skipped SW rows at idx 56/58/73) — trust the array, not an assumed grid. Verify the exact aw20216s.h macro spelling (CSx_SWy vs SWx_CSy) against `drivers/led/aw20216s.h` in the vial-qmk tree at compile.

```c
// {driver, R, G, B}, 84 entries (@ flash 0x080116A0). idx 82/83 unused.
led_config_t g_aw20216s_leds[84] = {
  {0,CS1_SW1,CS2_SW1,CS3_SW1},{0,CS1_SW2,CS2_SW2,CS3_SW2},{0,CS1_SW3,CS2_SW3,CS3_SW3},{0,CS1_SW4,CS2_SW4,CS3_SW4},
  {0,CS1_SW5,CS2_SW5,CS3_SW5},{0,CS1_SW6,CS2_SW6,CS3_SW6},{0,CS1_SW7,CS2_SW7,CS3_SW7},{0,CS1_SW8,CS2_SW8,CS3_SW8},
  {1,CS1_SW1,CS2_SW1,CS3_SW1},{1,CS1_SW2,CS2_SW2,CS3_SW2},{1,CS1_SW3,CS2_SW3,CS3_SW3},{1,CS1_SW4,CS2_SW4,CS3_SW4},
  {1,CS1_SW5,CS2_SW5,CS3_SW5},{1,CS1_SW6,CS2_SW6,CS3_SW6},{0,CS4_SW1,CS5_SW1,CS6_SW1},{0,CS4_SW2,CS5_SW2,CS6_SW2},
  {0,CS4_SW3,CS5_SW3,CS6_SW3},{0,CS4_SW4,CS5_SW4,CS6_SW4},{0,CS4_SW5,CS5_SW5,CS6_SW5},{0,CS4_SW6,CS5_SW6,CS6_SW6},
  {0,CS4_SW7,CS5_SW7,CS6_SW7},{0,CS4_SW8,CS5_SW8,CS6_SW8},{1,CS4_SW1,CS5_SW1,CS6_SW1},{1,CS4_SW2,CS5_SW2,CS6_SW2},
  {1,CS4_SW3,CS5_SW3,CS6_SW3},{1,CS4_SW4,CS5_SW4,CS6_SW4},{1,CS4_SW5,CS5_SW5,CS6_SW5},{1,CS4_SW6,CS5_SW6,CS6_SW6},
  {1,CS4_SW7,CS5_SW7,CS6_SW7},{0,CS7_SW1,CS8_SW1,CS9_SW1},{0,CS7_SW2,CS8_SW2,CS9_SW2},{0,CS7_SW3,CS8_SW3,CS9_SW3},
  {0,CS7_SW4,CS8_SW4,CS9_SW4},{0,CS7_SW5,CS8_SW5,CS9_SW5},{0,CS7_SW6,CS8_SW6,CS9_SW6},{0,CS7_SW7,CS8_SW7,CS9_SW7},
  {0,CS7_SW8,CS8_SW8,CS9_SW8},{1,CS7_SW1,CS8_SW1,CS9_SW1},{1,CS7_SW2,CS8_SW2,CS9_SW2},{1,CS7_SW3,CS8_SW3,CS9_SW3},
  {1,CS7_SW4,CS8_SW4,CS9_SW4},{1,CS7_SW5,CS8_SW5,CS9_SW5},{1,CS7_SW6,CS8_SW6,CS9_SW6},{1,CS7_SW7,CS8_SW7,CS9_SW7},
  {0,CS10_SW1,CS11_SW1,CS12_SW1},{0,CS10_SW2,CS11_SW2,CS12_SW2},{0,CS10_SW3,CS11_SW3,CS12_SW3},{0,CS10_SW4,CS11_SW4,CS12_SW4},
  {0,CS10_SW5,CS11_SW5,CS12_SW5},{0,CS10_SW6,CS11_SW6,CS12_SW6},{0,CS10_SW7,CS11_SW7,CS12_SW7},{0,CS10_SW8,CS11_SW8,CS12_SW8},
  {1,CS10_SW1,CS11_SW1,CS12_SW1},{1,CS10_SW2,CS11_SW2,CS12_SW2},{1,CS10_SW3,CS11_SW3,CS12_SW3},{1,CS10_SW4,CS11_SW4,CS12_SW4},
  {1,CS10_SW6,CS11_SW6,CS12_SW6},{0,CS13_SW1,CS14_SW1,CS15_SW1},{0,CS13_SW3,CS14_SW3,CS15_SW3},{0,CS13_SW4,CS14_SW4,CS15_SW4},
  {0,CS13_SW5,CS14_SW5,CS15_SW5},{0,CS13_SW6,CS14_SW6,CS15_SW6},{0,CS13_SW7,CS14_SW7,CS15_SW7},{0,CS13_SW8,CS14_SW8,CS15_SW8},
  {1,CS13_SW1,CS14_SW1,CS15_SW1},{1,CS13_SW2,CS14_SW2,CS15_SW2},{1,CS13_SW3,CS14_SW3,CS15_SW3},{1,CS13_SW4,CS14_SW4,CS15_SW4},
  {1,CS13_SW5,CS14_SW5,CS15_SW5},{1,CS13_SW6,CS14_SW6,CS15_SW6},{0,CS16_SW1,CS17_SW1,CS18_SW1},{0,CS16_SW2,CS17_SW2,CS18_SW2},
  {0,CS16_SW3,CS17_SW3,CS18_SW3},{0,CS16_SW7,CS17_SW7,CS18_SW7},{0,CS16_SW8,CS17_SW8,CS18_SW8},{1,CS16_SW1,CS17_SW1,CS18_SW1},
  {1,CS16_SW2,CS17_SW2,CS18_SW2},{1,CS16_SW3,CS17_SW3,CS18_SW3},{1,CS16_SW4,CS17_SW4,CS18_SW4},{1,CS16_SW5,CS17_SW5,CS18_SW5},
  {1,CS16_SW6,CS17_SW6,CS18_SW6},{1,CS16_SW7,CS17_SW7,CS18_SW7},{0,0,0,0},{0,0,0,0},
};
```

## LCD display — USART3 pass-through (CONFIRMED)
- Transport = **USART3** (0x40004800), **NOT SPI2/DMA**. Self-parsing UART slave (consumes A5 5A / RGB565 itself).
- Baud **460800**, 8N1, interrupt-driven (no DMA). `AFIO->MAPR |= USART3_REMAP_PARTIALREMAP` → TX=**PC10**, RX=**PC11**.
- Module control GPIO: PA8 high (power/EN), PB7 low, PC9 high, PB9 input (plug/detect). (Note PB7 doubles as the aw EN above — same pin, reconcile at build.)
- QMK port = the b75Pro sibling's `via_command_kb` 0x40/0x41/0x42 handler → `sdWrite(&SD3, &report[7], data_len)`. Ref: `research/mk856-src/repo/yunzii/b75Pro/keyboards/smart_kb16/mk25047/`.
- ChibiOS: `#define STM32_SERIAL_USE_USART3 TRUE`, `SerialConfig = {460800,0,0,0}`, `sdStart(&SD3,...)`.
- Frame: 96×160 RGB565 BE, host chunks 56 B/block, ~549 blocks; semaphore flag @0x20000E10 bit21, 0x55 ACK / 0x0F busy.
- ⚠ Picture-page banding: per-scanline byte-swap fix still needs on-device confirm (lab.html candidate B).

## Side bar (3 LEDs) — RESOLVED: it's on the aw20216s, NOT WS2812 (2026-07-03 deep RE)
**There is no WS2812 anywhere in RIPPLE.bin.** The prior "no signature found" was correct because none exists. The 3-LED side bar is 3 more aw20216s LEDs on **SPI1** (same chip/bus as the keys), driven by the **rgblight** subsystem independently of rgb_matrix. That independence (separate QMK effect engine + rainbow_mood) is why keys go solid while the bar stays rainbow — NOT separate hardware.

Static proof (all confirmed from disassembly unless noted):
- **B9 is NOT a LED pin.** RIPPLE.bin sets GPIOB pin9 = input (call @0x0800A07C, `_pal_set_group_mode(GPIOB,0x200,mode2=input)`, port pool word @0x0800A1E0 = 0x40010C00). Sibling `common.h` line 52: `#define PLUG_IN B9` (LCD plug-detect). B9 candidate is dead.
- **No WS2812 output pin of any kind.** Enumerated all 82 `_pal_set_group_mode` callers (helper @0x0800E3EC, STM32F1 CRL/CRH builder). Only AF-push-pull (mode 16) pins: PA5/PA7 (SPI1 aw), PA9 (USART1 TX), PC10 (USART3 LCD TX). **Zero GPIOB pins set to AF** → no TIM4 channel output, no serial-LED pin.
- **No DMA-to-GPIO:** no GPIOx_BSRR/BRR address appears as a literal anywhere.
- **No bit-bang:** the GPIOB CRL/CRH/ODR literals live in a pin-address lookup table next to `__udivmoddi4`; no tight GPIO-toggle timing loop.
- **TIM4 PWM (PWMD4 @RAM 0x20003DDC) is started** (`pwmStart` @0x0801095C→0x800db4c; matches b75Pro `STM32_PWM_USE_TIM4 TRUE`) but with **no channel pin set to AF** → used as a timebase/refresh tick, not a WS2812 PWM line.
- **SPI2** driver object exists but PB13/PB15 are never set to AF (PB15 is a matrix col) → not used for LEDs.
- Only LED bus = **SPI1 → aw20216s** (SCK PA5, MOSI PA7, CS B6/C8, EN B7). aw LED table @0x080116A0 = 84 entries (idx 82,83 zeroed); the 3 side LEDs are extra aw channels driven by the rgblight-custom setleds, not part of this 84-entry rgb_matrix array.

Sibling-source corroboration (`yunzii/b75Pro/.../mk25047`):
- `info.json`: `rgblight {led_count:2/3, driver:"custom", rainbow_mood}` — same on AL80.
- `common.h`: side bar = "第二路灯效的RGB" (second-route RGB), separately controlled, "position uncertain per project"; `ARGB_LEFT_EN B7` (= aw EN pin).
- `mk25047.c` `rgblight_indicators_advanced_kb()` drives the side/underglow LEDs with **`rgb_matrix_set_color(i, r,g,b)` for i≥83** — i.e., aw20216s API, not ws2812. Public `rgblight_custom.c setleds_custom` is a neutered stub (`//sc_ws2812_setleds` commented out); the real impl ships only in the binary.

QMK replication:
- **Do NOT set `WS2812_DRIVER` / `RGB_DI_PIN`.** There is no ws2812.
- Keep `RGB_MATRIX_DRIVER = aw20216s` on SPI1. Add the 3 side LEDs as aw20216s entries (extend g_aw20216s_leds + `RGB_MATRIX_LED_COUNT` from 84 to 87) with their real `{driver,CS,SW}` channels, then either treat them as normal matrix LEDs or give them an independent effect in `rgb_matrix_indicators_advanced_user()`.
- The exact aw CS/SW channels for the 3 side LEDs are the ONE remaining unknown (vendor: "position uncertain per project"). Get them by either (a) extracting the rgblight-custom setleds from RIPPLE.bin, or (b) a logic-analyzer capture on **SPI1 (SCK PA5 / MOSI PA7)** while the bar animates — decode the aw20216s register writes (page-1 PWM regs) to see which channels change.

Host-reachable: no bar-only command. Vendor raw-HID opcode **`AP_RGB_TEST = 0x81`** (`ap_message_buff[7..9]=R,G,B`) tints the whole board incl. bar via `rgb_matrix_set_color_all`. VIA lighting custom-menu (0x07/0x08) also acts on rgb_matrix as a whole. No VIA custom value beyond 1-4 targets the bar alone.

## Build
- vial-qmk (branch `vial`) at `~/qmkwork/vial-qmk` (WSL). Toolchain: `PATH=~/opt/arm/bin:~/.local/bin`.
- `keyboards/yunzii/al80/`, keymap `vial`. `qmk compile -kb yunzii/al80 -km vial`.
- Per-key: VialRGB direct (auto-registers with `VIALRGB_ENABLE`). Bonus: live keymap + macros.
- Cert source (matrix/layout/encoder/rgb_matrix.layout verbatim): `research/mk856-src/repo/yunzii/al80/unpacked/mk856src/`.
