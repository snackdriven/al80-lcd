# AL80 GIF Upload Protocol — Findings

## Test input
- Hand-built animated GIF89a, 112x137, 3 solid frames: RED, GREEN, BLUE, looping.
- Site parsed it correctly (thumbnail column showed all 3 frames).

## Upload flow (UI)
- Upload GIF -> preview shows frames -> "Save to the device" opens a
  **"Frame rate setting"** dialog (default **30 FPS**) -> confirm ("Sure") -> transfer.
- KEY: frame rate is chosen at upload time via the dialog, NOT embedded per-frame.

## Transfer structure (HID)
Header/setup sequence (all carry the A5 5A magic; differs from still-image single header):
    40 00 00 09 B1 01 00 A5 5A 12 00 02 04 50 01   announce (byte11=0x02)
    41 00 00 09 24 02 00 A5 5A 13 00 02 C4 01 01   setup subcmd 0x09
    41 00 00 0A 94 01 00 A5 5A 10 00 03 04 30 02 01 setup subcmd 0x0A (frame meta? byte14=0x02)
    41 00 00 07 98 02 00 A5 5A 11 78 00 C5 03       setup subcmd 0x07 (byte10=0x78=120, as in still img)

Then per FRAME: a run of image-data blocks identical in form to the single-image protocol:
    41 [offLo] [offHi] 38 [cksum] <56 pixel bytes>   offset steps 0x00,0x38,0x70,...,0x3F0
    41 F0 03 10 [cksum] ...                          final block (len 0x10)
Each frame = ~30,688 bytes = one full 112x137 RGB565 (big-endian) image.
Frames are sent SEQUENTIALLY; each new frame is preceded by setup subcmd 0x0A + 0x07
(seen again at the 2nd-frame boundary, e.g. "...0A 95 01..." / "...07 98 02...").

## Confirmed
- Pixel format SAME as still image: RGB565 big-endian, row-major, 112x137.
- A GIF = N sequential full frames + a global frame-rate setting.
- Observed frame boundary markers: setup subcmd 0x0A then 0x07 restart the pixel stream.

## Open (for next session)
- Exact frame COUNT field: likely in the 0x40 announce (byte12,13 = 04 50) or the
  0x0A setup (byte13,14 = 04 30 02). Decode by uploading GIFs with different frame counts.
- Frame-rate encoding: capture uploads at different FPS from the dialog to find the byte.
- byte[10]=0x78 (120) recurs in both still + GIF setup — likely a fixed height/param.
- NOTE: capture contains one stray time-sync (0x41 sub3 "06 17 09") from the auto-sync
  loop firing mid-transfer; ignore those when analyzing.
