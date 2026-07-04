# Custom-QMK LCD: portable from source (no logic analyzer)

**Verdict (2026-07-04, HIGH confidence):** the LCD/screen path can be ported into the custom
vial-qmk AL80 firmware **from sibling source alone — no logic analyzer.** The "B7 doubles as a
screen-control line" premise that got this filed as scope-blocked is a **misdiagnosis**: B7 is
exclusively the aw20216s LED-driver enable; the screen uses USART3 (PC10/PC11) + a separate
enable GPIO. They don't overlap.

Source read: `research/mk856-src/repo/yunzii/b75Pro/keyboards/smart_kb16/mk25047/` (+ the AL80
factory stub at `yunzii/al80/unpacked/mk856src/mk856.c`).

## The new insight vs. the prior AL80 RE (read this first)

This port plan came from reading the **b75Pro sibling source** (`mk25047/`) + the **AL80 factory
stub** (`yunzii/al80/mk856.c`). Reconcile against the earlier AL80-specific RE (memory
`al80-lcd-project.md`), which was done from the AL80's *own* RIPPLE.bin + on-device tests:

- **The genuinely new, likely-decisive finding: the LCD enable is `C9`, driven HIGH** (AL80
  factory stub `mk856.c:20-31`; `common.h:83` `LCD_SWITCH C9`). The prior custom-firmware attempts
  (v1–v6) fixated on **B7** and **never drove C9** — which plausibly explains why the screen stayed
  dark. B7 is the aw20216s LED-driver enable (`config.h:42-43`); it is *not* the screen enable.
  The "B7 is the deciding pin" note in memory was chasing the LED pin. **Drive C9 high.**
- **Baud: use 460800 for the AL80, NOT the b75Pro's 921600.** The `mk25047.c:170`
  `{ .speed = 921600 }` is the b75Pro board. The AL80's own RIPPLE.bin was RE'd at **460800 8N1**
  (confirmed earlier; the prior 921600 "hit" was flagged a false positive from a b75Pro string).
  Port at **460800**; if the screen stays blank, 921600 is the fallback to try.
- **Transport is interrupt-driven `sdWrite`, not DMA** (the DMA path is commented out — simpler).
- Semaphore flag index differs by firmware rev (26 here vs bit21 in RIPPLE.bin) — irrelevant, the
  port uses the symbolic flag, not a hard-coded bit.

## The port (straight lift from `mk25047/`)

### `rules.mk`
```
UART_DRIVER_REQUIRED = yes
SPI_DRIVER_REQUIRED  = yes      # already on for aw20216s RGB
DEFERRED_EXEC_ENABLE = yes
# + the passthrough. Either add the sibling files or inline the raw_hid block below:
# SRC += uart_mod.c keyboard_screen.c
```
Define `Screen_AP` (already `#define`d in `common.h:84`).

### `halconf.h` / `mcuconf.h`
```
// halconf.h
#define HAL_USE_SERIAL              TRUE
// mcuconf.h
#define STM32_SERIAL_USE_USART3     TRUE
```

### `keyboard_post_init_kb()` — after the existing aw20216s init
```c
static const SerialConfig uart_config = { .speed = 460800 };   // AL80 (RIPPLE.bin). 8N1. b75Pro src = 921600 → try if blank.

AFIO->MAPR |= AFIO_MAPR_USART3_REMAP_PARTIALREMAP;   // USART3 → TX=PC10, RX=PC11
palSetLineMode(C10, UART_TX_PAL_MODE);
palSetLineMode(C11, UART_RX_PAL_MODE);
sdStart(&SD3, &uart_config);

setPinOutput(C9); writePinHigh(C9);                 // LCD enable (AL80 factory = C9 high)
```

### The host→screen passthrough — in `via_command_kb()` (Vial uses the same raw-HID hook)
Report layout: `[0]`=cmd, `[3]`=payload len, `[6]`=ack echo, `+7`=payload.
```c
// mirror mk25047.c:2093-2150
switch (data[0]) {
  case 0x40: // announce
    if (R_FLAG(kb_screen.flag, PK_MOD_SEM) != NEED_UPDATE) {
      sdWrite(&SD3, data + 7, data[3]);
      SET_FLAG(kb_screen.flag, PK_MOD_SEM);
      kb_screen.ap_countdown = 100;
      data[6] = 0x55;                  // ready
    } else data[6] = 0x0f;             // busy
    raw_hid_send(data, length); break;
  case 0x41: // data
    if (R_FLAG(kb_screen.flag, PK_MOD_SEM) == NEED_UPDATE) {
      kb_screen.ap_countdown = 100;
      sdWrite(&SD3, data + 7, data[3]);
      data[6] = 0x55; wait_us(5);
    } else data[6] = 0x0f;
    raw_hid_send(data, length); break;
  case 0x42: // finish
    if (R_FLAG(kb_screen.flag, PK_MOD_SEM) == NEED_UPDATE) {
      CLEAR_FLAG(kb_screen.flag, PK_MOD_SEM);
      data[6] = 0x55;
    } else data[6] = 0x0f;
    raw_hid_send(data, length); break;
}
```

### Watchdog — in `matrix_scan_kb()` (so a dropped 0x42 can't wedge the pipe)
```c
// mirror mk25047.c:2182-2200: decrement kb_screen.ap_countdown every ~50ms;
// at zero, CLEAR_FLAG(kb_screen.flag, PK_MOD_SEM).
```

## Pin map (receipts)

| Function | Pin | Source |
|---|---|---|
| aw20216s driver EN (both ICs) | **B7** | `config.h:42-43` DRIVER_1_EN / DRIVER_2_EN |
| aw20216s SPI | SCK A5 / MISO A6 / MOSI A7 / CS1 C4 / CS2 B8 | `config.h:35-41` |
| **Screen data** | **PC10 TX / PC11 RX** | `mk25047.c:1227-1228` |
| **Screen enable** | **C9 high** (AL80) / B3 low (b75Pro) | `mk856.c:28-29` / `mk25047.h:14` |

## The one residual (verify by watching, not probing)

Which enable pin the physical AL80 rev uses (C9-high vs B3-low). Both are in source. Resolve by
**flashing + looking at the screen** — assert the enable, push a known-good `PK_ADD_PIC` frame
(al80-studio already generates these; the screen protocol is fully cracked), and see if it
renders. Observation-based, no instrument.

## Build + test loop (needs the QMK toolchain — WSL/docker where v1–v7 were built)

1. Apply the above to the custom AL80 keyboard dir.
2. Compile (same env that produced `firmware/AL80_CUSTOM_QMK_v7.bin`).
3. Flash, then from al80-studio: Connect → Picture → send a still to the main page. If it renders,
   C9-high is right and the custom firmware now lights the screen. If blank, switch the enable to
   B3-active-low and rebuild.

Source receipts: `mk25047.c` (post_init `:1215-1229`, passthrough `:1950-2177`, watchdog
`:2182-2200`), `config.h:35-43`, `mk25047.h:14`, `halconf.h:26`, `mcuconf.h:24-25`,
`common.h:83-84`, `yunzii/al80/unpacked/mk856src/mk856.c:20-31`.
