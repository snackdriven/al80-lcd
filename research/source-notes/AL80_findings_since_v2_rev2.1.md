# YUNZII AL80 — New Findings Since v2 (rev 2.1)
_Delta document, updated. All content below is post-v2. Supersedes the earlier "since v2" export and v2 itself where they overlap._

---

## A. Transaction frame (all operations)
Interface 0xFF60/0x61, reportId 0, 64-byte reports. Every operation is:
    0x40 ANNOUNCE  →  0 or more 0x41 DATA  →  0x42 FINISH
View-switch & clear commands have ZERO data packets (announce + finish only). Time = two small transactions. Image = ~548 data pkts. GIF = N frames, each its own full transaction ("保存帧 N/3" progress).

## B. Announce (0x40) layout — refined
    40 00 00 07 [f4 f5] 00 A5 5A [type] [param] [subcmd] [crc16:2]
- byte[3] = 0x07 CONSTANT across every command observed (format/version marker, NOT a length).
- bytes[4,5] = a per-command-type value (LE). Reproducible-constant PER command, but not a simple CRC or arithmetic function of the header (tested CRC16 many polys/ranges, payload CRC, header sum — no match). Treat as a fixed per-command constant: reuse the captured value. (Values: home 339, picture 566, gif 601, time-A 758, time-B 421; image frame = 758.)
- bytes[7,8] = 0xA5 0x5A magic.
- byte[9]=type, byte[10]=param(usually 0), byte[11]=subcmd.
- bytes[12,13] = CRC16-MODBUS(poly 0x8005, init 0xFFFF, refin/refout) over bytes[9,10,11], stored BIG-ENDIAN. VERIFIED on 5 distinct commands (home 0x0200, pic 0x03E0, gif 0xC341, timeA 0xC3E1, timeB 0x0150) — fully generalized.

## C. Command / view-switch table (GAP 3 — SOLVED)
Captured live from Equipment-setup buttons. Each is announce(type/subcmd) + 0x42 finish:
    Switch to homepage      : type 11, subcmd 0   [4,5]=83,1
    Switch to picture page  : type 13, subcmd 0   [4,5]=54,2
    Switch to GIF page      : type 15, subcmd 0   [4,5]=89,2
    Update device time      : two transactions ->
         txn1: type 9,  subcmd 3, data payload [0x12,0x2F]
         txn2: type 10, subcmd 4, data payload [26,3,7,1]  (date/time fields)
Not yet clicked (avoid wiping content): "Clear the picture", "Clear GIF" — same announce+finish shape expected; capture if needed.
NOTE: type 9 (subcmd 3) is a GENERIC data channel — it is reused for BOTH the image/GIF pixel transfer AND the time txn1 (both show announce 64,0,0,7,246,2,0,165,90,9,0,3,195,225). So "type 9" ≠ "image"; it is the data-write channel. This retires the old assumption that [3,4,5]=7,246,2 was an image frame-size.

## D. Data packet (0x41) — unchanged, re-confirmed
    41 [offset:2 LE] [len] [accum:2 LE] 00 [payload]
- Image/GIF: len=0x38 (56), payload = RGB565 BIG-ENDIAN pixels.
- Small commands: len = actual payload length (e.g. time txn1 len=3).
- accum[4,5] = 16-bit LE running accumulator; for pixel transfers SEED = 121 (0x79), += payload-len each packet. Re-confirmed constant seed 121 on the grayscale re-save transfer (GAP 2 answer: seed did NOT change).

## E. Time command decode (new detail)
"Update device time" sends, repeated a few times (retries/fields):
- txn type 9/subcmd 3: 1 data pkt, len 3, payload 0x12 0x2F (+1).
- txn type 10/subcmd 4: 1 data pkt, len 4, payload 26,3,7,1 (looks like packed date/time bytes).
Full field mapping of these two payloads to H/M/S/date still approximate; the working 12h sync (window.__sync12hr) already produces correct output regardless.

## F. Display attributes — CLIENT-SIDE (from prior post-v2 work, still true)
Brightness/Chroma/Saturation/Grayscale/Fuzzy/Sharpening emit ZERO HID on change; baked into pixels at "Save to the device." No opcode to reverse — transform your own RGB565 buffer before sending. Frame rate is the one save-time global (default 30 FPS).

## G. VIA keymap (GAP 4 — now exportable)
usevia.app JS exec is available again this session; window.__editedJSON holds the keymap (6571-char JSON string). Can be exported directly now (previously blocked). Alternatively use VIA's own Save button.

## H. Remaining open (smaller now)
- Exact SEMANTICS of announce [4,5] (reproducible per command, but formula unknown; not required to reproduce commands).
- Exact bit-mapping of the two time payloads (0x12,0x2F and 26,3,7,1) to H/M/S/date.
- "Clear the picture" / "Clear GIF" command bytes (not captured to avoid wiping content).
- Origin of the 121 seed (fixed constant confirmed; source in firmware unknown).

## I. Hard constraints (unchanged)
No reflash (preserve ripple lighting). VIA-only keymaps. Never touch bootloader 0xB0–0xB7. Keyboard wired. One opener of 0xFF60 at a time.
