---
title: Writing LLM-Friendly Documentation (mid-2026)
status: reference
updated: 2026-07-01
scope: How to structure docs so both people and AI agents can use them
applies_to: READMEs, knowledge bases, API docs, internal wikis, any markdown a model might read
---

# Writing LLM-Friendly Documentation (mid-2026)

Docs now get read two ways: by a person scrolling top to bottom, and by a model that
retrieves a few hundred tokens out of the middle and answers from just that slice. The
second reader changed what "well-organized" means. This is what holds up as of mid-2026,
pulled from current guidance (Fern, Mintlify's GEO guide, Hygraph, the llms.txt project) and
from applying it to a real reverse-engineering knowledge base.

The one-line version: **write so any single section still makes sense when it's the only
thing the reader sees.**

## Quick checklist

| Do | Why |
|----|-----|
| Ship clean Markdown, not HTML | Models read it at a fraction of the tokens; headings/tables/code map to structure directly |
| Make each section self-contained | Retrieval pulls passages, not whole pages — a chunk that leans on "as above" breaks |
| Front-load the answer | Put the fact/definition first, the derivation after. The first sentence carries the payload |
| One clear heading hierarchy | Descriptive headings act as retrieval anchors; a chunk should be readable from its heading alone |
| Define terms and entities on first use | No bare "it"/"this"/"the above" — the referent may not be in the chunk |
| Prefer tables and lists to prose | Structured data survives chunking and is easy to extract |
| Add a `llms.txt` index | A curated map of the high-value docs, in the [llms.txt](https://llmstxt.org/) format |
| Add YAML frontmatter | Machine-readable title/status/date/scope at the top |
| State numbers with their units and source | "30,688 bytes (548 blocks x 56)" beats "about 30k" |

## The principles, with the reasoning

### 1. Markdown over HTML
Plain Markdown costs a model far fewer tokens than the equivalent HTML, and its structure
(headings, lists, tables, fenced code) maps straight onto meaning. HTML wraps the same
content in markup the model has to wade through. If your source is HTML, serve a Markdown
version too.

### 2. Self-contained, chunkable sections
This is the big one. AI search retrieves passages, not pages. Whatever the model pulls has
to stand on its own, because it may never see the paragraph before or after it. So:
- Don't open a section with "As mentioned above…" or "This means that…". Name the thing.
- Repeat a small amount of context rather than pointing back. A little redundancy is cheap;
  a broken reference is expensive.
- Cross-references should carry their own label: "see the checksum rule in section 5e," not
  "see 5e." The number is meaningless out of context; the label survives.

### 3. Front-load the answer
Inverted pyramid. Lead with the conclusion, the constant, the formula. Put the derivation,
caveats, and history underneath. A reader (human or model) who only gets the first chunk of a
section should still walk away with the answer.

### 4. Headings as anchors
Use one `#` H1, then a logical H2/H3 nest. Write headings that describe content, not cute
labels ("Data-packet checksum," not "The tricky part"). A good heading tells the retriever
and the reader what lives underneath before they read a word of it.

### 5. Kill ambiguity
Define acronyms and entities the first time they appear, ideally in a short glossary near the
top. Avoid pronouns whose antecedent sits in another paragraph. Every "it" is a small bet
that the reader has the previous sentence — a bet you lose under chunking.

### 6. Structure over prose
Tables, bullet lists, and fenced code blocks chunk cleanly and extract cleanly. A five-row
table beats a paragraph that buries five facts in commas. Reserve prose for the reasoning
that genuinely needs sentences.

### 7. A `llms.txt` file
A root-level `llms.txt` is a curated index for agents: an H1, a one-paragraph summary in a
blockquote, then linked sections pointing at your highest-value docs. Keep it curated (a
couple dozen good links, not a dump). Optionally a `llms-full.txt` with the expanded content.
It tells an agent where to look instead of making it crawl.

### 8. Frontmatter and provenance
A small YAML block (title, status, updated date, scope) gives machines something clean to
parse and gives humans a status line. When you state a fact that was measured or has a
source, say where it came from — "verified 4288/4288 against the raw capture" is worth more
to a later reader than an unqualified "confirmed."

## Anti-patterns

- **Walls of prose** with the key fact in sentence four. Move it to sentence one.
- **Reference-by-number** ("see 10.3") with no label. Add the label.
- **Orphaned pronouns** at the top of a section. Name the subject.
- **HTML tables / nested divs** where a Markdown table would do.
- **Synonym-cycling** to avoid repeating a term. Repeat the term; models match on it.
- **A dump masquerading as an index.** An `llms.txt` with 400 links helps no one. Curate.
- **Silent truncation.** If you summarize or cap something, say so, or a reader treats partial
  coverage as complete.

## A worked example

The `AL80_KNOWLEDGE_BASE.md` in this repo applies all of the above: frontmatter, a
Quick Reference constants table and a Glossary at the very top (front-loading), self-labeled
cross-references, tables for every structured fact, measured numbers with their verification
source, and a companion `llms.txt` at the repo root. It started as prose-heavy session notes
and got restructured against this checklist.

## Sources

- Fern — "Write LLM-friendly docs" (March 2026): Markdown over HTML, `llms.txt`, token savings.
- Mintlify — GEO guide to writing for LLMs: retrieval, structure, disambiguation.
- Hygraph — checklist for structuring content for LLMs: self-contained chunkable sections.
- llmstxt.org — the `llms.txt` specification.

## Portability

This file is project-agnostic. Copy it into any repo's `docs/`, or into `~/.claude/rules/` to
apply it across projects.
