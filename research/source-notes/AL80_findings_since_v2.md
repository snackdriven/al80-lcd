# YUNZII AL80 — New Findings Since v2
_Delta document. Everything below was discovered/verified in the session AFTER knowledge-base v2. Read alongside v2; this supersedes v2 wherever they overlap._

---

## A. Full transfer protocol — now fully framed
Every LCD operation (time, image, GIF frame) uses the SAME three-opcode transaction on interface 0xFF60/0x61, reportId 0, 64-byte reports:

    0x40 ANNOUNCE  →  N × 0x41 DATA  →  0x42 FINISH

Confirmed from 3460 captured packets: only opcodes 0x40, 0x41, 0x42 ever appear (0x40 ×9, 0x42 ×9 = 9 complete transactions; 0x41 = bulk).

### 0x40 Announce (header)
    40 00 00 [size:3 LE] 00 A5 5A [type] [flags:2] [crc16:2]
- bytes[7,8] = 0xA5 0x5A magic (in every announce).
- [type] byte[9]: 9 = image/GIF pixel channel; 18 = time-sync channel.
- bytes[12,13] = CRC16 (see section B).
- Observed: image/gif announce = 64,0,0,7,246,2,0,165,90,9,0,3,195,225
- Observed: time announce      = 64,0,0,9,177,1,0,165,90,18,0,2,4,80,1

### 0x41 Data
    41 [offset:2 LE] 38 [accum:2 LE] 00 [payload:56 bytes]
- bytes[1,2] = destination byte-offset into the frame buffer (LE). Steps by 56 each packet: 0, 56, 112, 168, 224, 280 ...
- byte[3]   = 0x38 = 56 = payload length.
- bytes[4,5] = 16-bit LE running accumulator/checksum (see section B).
- byte[6]   = 0x00 reserved.
- bytes[7..62] = 56 bytes of payload = raw RGB565 BIG-ENDIAN pixels.

### 0x42 Finish
    42 00 00 38 7A 00 ...   — commit / end-of-transfer marker (constant 0x38 0x7A tail).

---

## B. Both checksums CRACKED (this was the big open gap in v2)

### 1. Announce CRC16 = CRC16-MODBUS
- Algorithm: poly 0x8005, init 0xFFFF, refin=true, refout=true, xorout=0x0000.
- Input: bytes[9..11] = the [type][flags:2] triple.
- Stored BIG-ENDIAN at bytes[12,13].
- VERIFIED on two different announces:
    - image/gif: input [9,0,3] -> 0xC3E1  (matches captured bytes 195,225)
    - time:      input [18,0,2] -> 0x0450  (matches captured bytes 4,80)

### 2. Data-packet accumulator (the old "byte[4] checksum" mystery)
- bytes[4,5] = 16-bit LE running accumulator.
- SEED = 121 (0x79), then += 56 (payload length) per packet.
- Sequence: 121, 177, 233, 289, 345, ...  (verified across image AND gif transfers; seed was constant 121 in both).
- NOT a per-packet byte-sum (that was the earlier wrong guess) — it is a per-transfer accumulator.

---

## C. Display attributes are CLIENT-SIDE — not device commands
Brightness, Chroma, Saturation, Grayscale, "Fuzzy", Sharpening:
- Toggling/moving any of them emits ZERO HID traffic (verified: cleared buffer, toggled Grayscale, captured 0 packets). They only update the app's live JS/canvas preview.
- The effect reaches the keyboard ONLY on "Save to the device," baked into the pixel payload of the normal 0x40/0x41/0x42 transfer. Confirmed: after enabling Grayscale the saved frame's RGB565 payload was already grayscaled.
- IMPLICATION: to replicate any of these in a standalone script, transform your own RGB565 buffer BEFORE sending. There is no "set brightness/etc." opcode to reverse.
- EXCEPTION: frame rate is the one save-time attribute, chosen in the "Frame rate setting" dialog (default 30 FPS), global per GIF.
- "Reset attributes" reverts sliders/toggles to defaults (client-side only).

---

## D. GIF save = per-frame, confirmed visually
Saving a GIF shows "保存帧 N/3" (Saving frame N/3) with a 0/50/67/100% progress bar — i.e. N sequential FULL 112×137 RGB565-BE frames, one full announce→data→finish transaction each. Matches the decoded model.

---

## E. Tooling notes learned this session (save future time)
- The web app holds its OWN device handle (re-acquired via getDevices()/request after any reconnect). External patches on window.__lcd.sendReport or even HIDDevice.prototype.sendReport do NOT intercept the app's sends (it captured a bound reference first). Decode the app's own window.__hidCaptures buffer instead of re-hooking.
- Console tells the state: "targetDevice HIDDevice" = device (re)selected; "sendCount 1" = a send fired; "No HID device selected" = app lost its handle (needs reconnect). We saw a disconnect/reconnect at ~5:06 this session — hence window.device read null while captures persisted.
- javascript_tool on yunzii-game.com: async/Promise-returning top-level expressions return {} (empty) but side-effects still run. Pattern: do async work → stash to window → read back with a separate SYNCHRONOUS call.
- Security-filter false positive "[BLOCKED: Cookie/query string data]" fires when returning long hex/token-like strings. Work around: emit only short scalar fields / structural booleans.

---

## F. Still open after this session
- Announce size field [3,4,5] semantics (not a plain byte count). Decode by uploading images of KNOWN differing sizes and diffing the announce.
- Origin of the 121 (0x79) accumulator seed (fixed firmware constant vs derived).
- Full view-switch command table (clock / picture / gif / homepage).
- VIA keymap JSON export (usevia.app blocks JS exec — use VIA's own Save button).

---

## G. Unchanged hard constraints (reminder)
No reflash (preserve ripple lighting). VIA-only keymaps. Never touch bootloader opcodes 0xB0–0xB7. Keyboard stays wired. Only one opener of 0xFF60 at a time (close the tab before running the standalone script).
