# AL80 wiki (MkDocs Material)

A browsable wiki built from `AL80_KNOWLEDGE_BASE.md` and the `research/` notes, using
[Material for MkDocs](https://squidfunk.github.io/mkdocs-material/). Content is plain Markdown under
`docs/`; `mkdocs.yml` is the whole config.

## Serve it locally (no global install)

The cleanest way — run through `uvx` (from [uv](https://docs.astral.sh/uv/)); nothing is installed
globally:

```bash
cd wiki
uvx --with mkdocs-material mkdocs serve
# open http://127.0.0.1:8000
```

`pipx` works the same way:

```bash
pipx run --spec mkdocs-material mkdocs serve
```

Or a project virtualenv:

```bash
cd wiki
python -m venv .venv && . .venv/Scripts/activate   # Windows; use .venv/bin/activate on macOS/Linux
pip install mkdocs-material
mkdocs serve
```

## Build the static site

```bash
cd wiki
uvx --with mkdocs-material mkdocs build   # outputs ./site/
```

`site/` is a self-contained static site — host it anywhere.

## Host on GitHub Pages

One command deploys the built site to the `gh-pages` branch:

```bash
cd wiki
uvx --with mkdocs-material mkdocs gh-deploy
```

Then set **Settings → Pages → Branch: `gh-pages`** in the repo. Update `site_url`, `repo_url`, and
`edit_uri` in `mkdocs.yml` if the repo owner/name changes. (For Cloudflare Pages instead: build
command `mkdocs build`, output dir `site`, and add `mkdocs-material` to the build.)

## Add mermaid diagrams

Superfences is already configured. Just write:

    ```mermaid
    sequenceDiagram
      Host->>Keyboard: 0x40 announce (PK_GUI_EVENT)
      Note over Keyboard: settle 300 ms
      Host->>Keyboard: 0x41 setup (PK_ADD_PIC, len)
    ```

## What follows the LLM-friendly-docs convention

Per `docs/llm-friendly-documentation-2026.md`: clean Markdown source, self-contained sections,
front-loaded facts, tables over prose, YAML frontmatter on every page, and a curated `llms.txt` at
the repo root. Material's admonitions carry the KB's `CORRECTION` / `SUPERSEDED` / `HEADS UP`
callouts.

## Migration status

See the checklist in the parent task report. The major sections are migrated; a few research notes
are indexed rather than inlined by design (they stay authoritative in `research/`).
