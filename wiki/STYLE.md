# Wiki style guide

How pages in `docs/` are written. Four sources, each doing one job:

| Job | Source | In one line |
|-----|--------|-------------|
| What a page is for | [Diátaxis](https://diataxis.fr/) | Every page is one type: tutorial, how-to, reference, or explanation. |
| Readability | [W3C COGA, *Making Content Usable*](https://www.w3.org/TR/coga-usable/) | Clear words, short blocks, no guessing what we meant. |
| Procedures | [Microsoft Writing Style Guide](https://learn.microsoft.com/style-guide/procedures-instructions/writing-step-by-step-instructions) | Numbered steps, one action each, verb first. |
| Safety and precision | [ASD-STE100](https://www.asd-ste100.org/) | Strict controlled English, only where a misread costs hardware or data. |

Plain language is the default everywhere. STE is the exception, and it's scoped (see below).

## 1. Page types (Diátaxis)

Set `type:` in each page's front matter. A page is one type. If it needs another type's content,
link to the page that has it instead of mixing.

| `type:` | Reader is... | The page... | Doesn't... |
|---------|--------------|-------------|------------|
| `tutorial` | learning by doing | walks one safe path to a working result | explain alternatives or edge cases |
| `how-to` | doing a real task | gives the steps for one goal, assuming basic knowledge | teach concepts or list every option |
| `reference` | looking something up | describes facts: bytes, constants, pins, tables | tell a story or give opinions |
| `explanation` | trying to understand | explains why: history, causes, trade-offs | give step-by-step instructions |

The home page is `type: overview`. It routes readers and isn't one of the four.

Every page opens (after the title) with one sentence saying what it's for, in the reader's terms:
"Use this page to flash custom firmware" or "This page explains why frames band." The TL;DR box, if
any, comes right after.

The one tutorial is [Your first custom frame](docs/tutorials/first-custom-frame.md): stock firmware,
AL80 Studio, no flashing. Keep tutorials on a single safe path like that one.

## 2. Plain language and readability (W3C COGA)

- Use common words. Say "use", not "utilize". Use the same word for the same thing everywhere.
- Write in the active voice. Address the reader as "you". Contractions are fine.
- One idea per paragraph. Keep paragraphs to about 3–5 sentences, and keep sentences short (aim under 25 words).
- Make headings say what's in the section. A reader skimming only headings should follow the page.
- Define jargon and abbreviations on first use on each page, or link the term to the
  [glossary](docs/reference/glossary.md). Project terms like "settle", "ACK-gate" and "blast" count as jargon.
- Say it literally. No idioms or metaphors ("the killer bug" becomes "the bug that broke GIFs").
- No double negatives. Write "Keep X on", not "Don't leave X off".
- Don't rely on memory. Repeat a key value where it's needed instead of saying "the value above".
- Use lists for three or more parallel items, and tables for values people compare.
- Don't use ALL CAPS for emphasis. Use **bold**. (STE zones keep their bold **Do not**.)
- Write numbers as digits, with units: `30 ms`, `56 KB`, `96×160`.
- Keep emoji to section headings, where the existing pages already use them.

## 3. Procedures (Microsoft style)

Any sequence of actions, on any page type.

- Introduce the procedure with a heading or a short "To <goal>:" line.
- Use a numbered list for 2 or more steps. A single step is a bullet.
- One action per step. Two small actions in the same place can share a step ("Hold **Esc** and connect the cable").
- Start each step with a verb. Say where before what: "In QMK Toolbox, select **Open**".
- Mark UI labels and keys in **bold**. Mark commands, file names, bytes and code in `code`.
- Put a condition before its action: "If the LCD stays black, disconnect the cable."
- Put a warning before the step it applies to, never after.
- If a step has a visible result, put it in a plain sentence under that step, not as its own number.
- Mark optional steps "(Optional)".
- Keep a procedure to about 7 steps. Split longer ones into named stages.
- Say "select" for clicks and taps, and "enter" for typing.

## 4. STE zones (ASD-STE100, strict)

Use STE in these places, and only these places:

- `reference/safety.md`, the whole page.
- Every `!!! danger` and `!!! warning` admonition, on any page.
- Bootloader, DFU, flashing and recovery steps (mainly `how-to/flashing-and-setup.md`).
- Anything about commands `0xB0`–`0xB7`, the single-opener rule, and the mandatory ACK-gate and settle timings.

STE rules for these zones:

- Procedural sentences are 20 words or fewer. Descriptive sentences are 25 words or fewer.
- Write one instruction per sentence, in the imperative.
- Put the hazard right after the command: "Do not send `0xB0`–`0xB7`. They can brick the keyboard."
- Use simple tenses only. No contractions. No phrasal verbs ("connect", not "plug in").
- Never soften a warning or drop one of its conditions.

## 5. Things that don't change in any rewrite

- Facts, numbers, bytes, opcodes, timings, paths, URLs, link targets and dates.
- Code blocks, inline code and mermaid diagrams.
- Heading text that a link anchor points to (grep `docs/` and `mkdocs.yml` for `#anchor` first).
- **Superseded** and **correction** markers. Old theories stay, marked, on purpose.
- `history/changelog.md`. It's a dated record, so leave it as written.

Don't add AI attribution to pages, commits or PRs in this repo.
