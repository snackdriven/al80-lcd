# Source notes (raw, superseded)

Raw session findings docs, kept for provenance — the trail of how the protocol was figured
out. **These are superseded by `AL80_KNOWLEDGE_BASE.md`, which is canonical.** They contain
a couple of claims that were later found wrong and corrected in the knowledge base; don't
treat these as authoritative.

| File | Notes |
|------|-------|
| `AL80_findings_since_v2.md` | First post-v2 delta. Cracked the announce CRC16-MODBUS. **Errors corrected in the KB:** labeled the announce type bytes backwards (said 9=image/GIF, 18=time; actually 0x09=time), and described the data-packet field as a "seed 121 / +56 accumulator" — it's really a content-dependent 16-bit additive checksum (KB §5e). |
| `AL80_findings_since_v2_rev2.1.md` | Revision. Added the view-switch command table and time-command decode. **Repeated the "seed 121 accumulator" error** (falsified against the raw captures — see `../analyze_captures.py`). Its "type 9 = generic data channel" claim conflicts with this repo's captures (image = type 0x10); recorded but unverified in the KB. |

For what's actually true and verified, read the knowledge base. For the verification itself,
run `../analyze_captures.py` against the captures.
