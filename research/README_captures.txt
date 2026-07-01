AL80 reverse-engineering capture archive.

captures/          - raw + annotated WebHID packet dumps (the useful part for
                     decoding the image/GIF protocol), device descriptors,
                     unique-packet frequency table.
site_assets/       - the yunzii-game.com screen app JS bundle (index-*.js contains
                     the packet-builder code and command-name constants:
                     sendScreenControlInformationPackage=0x40, ...DataPacket=0x41,
                     finish...=0x42), plus index.html and the plugin script.

Pair this with AL80_KNOWLEDGE_BASE.md and al80_12hr_clock.zip.

To decode the image protocol next: search index-*.js for the 0x40/0x41 builders and
correlate with the IMAGE @offset lines in captures/hid_captures_annotated.txt.
