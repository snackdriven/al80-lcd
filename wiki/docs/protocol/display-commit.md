---
title: Display commit (PK_* protocol)
status: confirmed
updated: 2026-07-06
scope: How the display module actually SHOWS a picture — PK_ADD_PIC commit, mandatory settles, banding root cause, homepage widget protocol
---

# Display commit (PK_* protocol)

The 2026-07-04 unlock: **how to SHOW a written picture.** Each prior session could *write* a still
image (549/549 blocks ACKed, transport perfect), but the panel continued to show an OLD picture.
The cause was never a pixel problem. It is a **display/commit protocol** problem.

!!! tip "TL;DR"

    - The STM32 MCU is a **dumb USART3 passthrough**. A separate smart display module runs the `PK_*` command set (wire opcode = PK enum ordinal).
    - **`PK_ADD_PIC` (0x0C) commits AND displays.** Both settles (300 ms / 30 ms) are mandatory. Do NOT send a trailing view switch (`0x0D PK_TOGGLE_PIC` advances past your frame).
    - The banding root cause = **dropped USART3 bytes**, not geometry. The fix is to **ACK-gate each 56-byte block** (wait for `byte[6]=0x55`).

## 📟 The display module speaks `PK_*` over USART3

The STM32F103 keyboard MCU does **not** render pixels. It sends the HID stream to a **separate
smart display module** over **USART3** (460800 8N1, TX PC10 / RX PC11). The module runs its own
`PK_*` command set, and **the wire opcode = the PK enum ordinal**. (This was reverse-engineered
from `RIPPLE.bin` and the sibling b75Pro QMK source.)

| Op | Name | Meaning |
|---|---|---|
| `0x0B` | `PK_GO_HOME` | switch to the clock/home view |
| `0x0C` | **`PK_ADD_PIC`** | **commit the received scratch buffer to a slot AND display it** ← the key one |
| `0x0D` | `PK_TOGGLE_PIC` | advance to the NEXT stored slot (**not** "show this frame") |
| `0x0E` | `PK_DEL_PIC` | delete a stored picture slot |
| `0x0F` | `PK_GO_GIF` | switch to the GIF view |
| `0x10` | `PK_GUI_EVENT` | GUI / view-state event (the still-image "announce" uses this op) |
| `0x12` | `PK_GIF_NUM` | GIF slot/count select |
| `0x13` | `PK_GIF_FRAME` | GIF per-frame op |

Pictures are **slot-based and cyclic**. There is no random-access "show slot N" opcode. A "switch
to picture page" keypress shows *the slot at the cursor*. This is not necessarily the frame that
you wrote last.

## ✅ Working still-image DISPLAY sequence (confirmed end-to-end)

    announce   PK_GUI_EVENT   (0x40, type 0x10)     40 00 00 08 CF 02 00 A5 5A 10 00 01 C5 B1 01
    --- settle 300 ms ---   (module must process the announce)
    setup      PK_ADD_PIC     (0x41, type 0x0C,len) 41 00 00 07 21 03 00 A5 5A 0C 78 00 C3 93   ; 0x7800
    --- settle 30 ms ---    (module must arm the ADD_PIC commit)
    data                     549 × 56-byte blocks, ACK-GATED   ; 548×56 + 1×32 tail
    finish                   (0x42)                 42 00 00 38 7A
    --- NO trailing view switch ---

!!! danger "Both settles are MANDATORY. A trailing view switch BREAKS the sequence"
    If you send the announce and the setup back-to-back, the frame goes into scratch and the device
    ACKs 549/549. But the frame **never commits or displays** (the old picture stays). Do **NOT**
    send a trailing `buildView(PICTURE)` (`0x0D` = `PK_TOGGLE_PIC`). It advances *past* the frame
    that was just committed, to the next stored slot. This causes the symptom "shows the new card
    for half a second, then flips to an old picture". `PK_ADD_PIC` already displays the committed
    frame, and the frame stays. The values 300 ms / 30 ms are empirical. Smaller values can
    possibly work; they are not tuned.

**Evidence (flash-address citations):**

- The Ripple raw-HID handler = a **dumb USART passthrough @ `0x08007FE8`**. It takes a semaphore,
  `sdWrite`s the report body to SD3 (USART3), and acks with `0x55`/`0x0F` ready/busy bytes. It does
  not parse A5 5A or RGB565. The display module does this.
- `PK_ADD_PIC` is a **non-transmitting stub @ `0x08004ECA`** in the STM32 (host-originated only).
- The sibling b75Pro source (`mk25047.c` / `keyboard_screen.c` / `uart_mod.h`) has the same `PK_*`
  enum. The strings in the AL80 binary agree with it.

## ⚠️ Banding root cause — dropped bytes, not geometry

The AL80 picture stream is **ROW-MAJOR**. (A column-major render put the image sideways. The
column-major layout came from the AttackShark K86/X85 sibling and is wrong here.)

!!! warning "Two earlier theories retired"
    The red/blue banding was **not** a per-scanline parity slip and **not** a byte-swap (each of
    these would also band a *solid* color). The real cause: **dropped bytes, because the USART3
    stream was sent at full speed with no flow control**. An RX overrun drops a byte. This flips
    the hi/lo alignment of each subsequent RGB565 pixel (`F8 00` ↔ `00 F8` = red ↔ blue). The band
    moved from run to run: this is the textbook dropped-byte signature.

**The fix = ACK-gate each block** (`hid.sendAckGated`, confirmed clean on the device):

- After each 56-byte `0x41` block, wait for the ready echo of the module (`byte[6] = 0x55`). Then
  send the next block.
- Match the op **and the full offset (lo + hi)**.
- If the ack does not come, send the block again, up to 4×. Each block is idempotent: it carries
  its own destination offset.

Generous settles (300 ms / 30 ms) prevent slips in the first blocks. **Do NOT add an artificial
inter-block floor delay**: gaps between blocks that already have an ack desync the module and make
banding *worse*. See [Chunking & pacing](chunking-and-pacing.md).

## 🔋 Homepage widget protocol + boot handshake

The display module draws the homepage gauges (connection, OS, caps/num/win lock, **battery**). But
the **keyboard feeds the gauges** with 1-byte `PK_*` status packets. b75Pro `keyboard_screen.c`
runs a `screen_boot_step` state machine. At boot, it pings `PK_CONN_TYPE` while the screen powers
up. Then it sends the full widget batch to initialize the homepage. **The battery is initialized as
part of that batch.** A lone `PK_BATT_QUANTITY` possibly has no widget to fill. (This is why the
gauge went empty on custom after the first image push.)

Full `PK_*` opcode map (b75Pro `uart_mod.h`, cross-validated against the announces of al80-studio):

| Op | Name | Payload |
|---|---|---|
| `0x00` | PK_PROTOCOL_RET | module→kb handshake |
| `0x01` | PK_CONN_TYPE | 0=USB, else wireless mode |
| `0x02` | PK_OS_TYPE | 0=Win, 1=Mac |
| `0x03` | PK_CAPS_STATUS | 0/1 |
| `0x04` | PK_NUMLOCK_STATUS | 0/1 |
| `0x05` | PK_WINLOCK_STATUS | 0/1 |
| `0x06` | PK_BATT_QUANTITY | 0–100 % |
| `0x07` | PK_BATT_STATUS | 0=not-charging/full, 1=charging |
| `0x08` | PK_LIGHT_MODE | |
| `0x09` | PK_TIME | [hh,mm,ss] |
| `0x0A` | PK_DATE | [yy,dow,mo,day] |
| `0x0B` | PK_GO_HOME | view→homepage |
| `0x0C` | PK_ADD_PIC / 0x0D TOGGLE / 0x0E DEL | picture ops |
| `0x0F` | PK_GO_GIF | view→gif |
| `0x10` | PK_GUI_EVENT · 0x11 ADD_GIF · 0x12 GIF_NUM | image/gif upload |

**Packet:** each 1-byte status = `A5 5A <op> 00 01 <crcHi> <crcLo> <val>` (CRC16-MODBUS over
`[op,00,01]`). The `yne` checksum is host-only. It is removed before the packet gets to the module.
The firmware `AL80_CUSTOM_QMK_v16_homepage.bin` ports this init batch. See
[Homepage widgets](../firmware/homepage-widgets.md).
