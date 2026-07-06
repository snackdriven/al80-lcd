# Maintaining this wiki

Kept in the private repo on purpose — it names local paths and the deploy flow, so it doesn't
belong in the public HTML.

## The setup

- **Source** (Markdown, MkDocs Material): `al80-lcd/wiki/` — private.
- **Published** (static HTML): `al80-studio/wiki/` — public, served by GitHub Pages at
  <https://snackdriven.github.io/al80-studio/wiki/>.

Two repos because the source repo is private but Pages has to serve from a public one.

## The default: `./deploy.sh`

From `al80-lcd/wiki/`:

```bash
./deploy.sh                       # commits both with "wiki: rebuild + deploy"
./deploy.sh "wiki: fix roadmap"   # custom commit message
```

It builds MkDocs, copies `site/` into `al80-studio/wiki/`, commits the source in al80-lcd and the
built site in al80-studio (staging **only** `wiki/` + `.nojekyll` there — never `index.html`,
`src/`, `host/`, or `README.md`), and pushes both. On Windows it also stops/restarts a stray
`python -m http.server :8099` that would otherwise lock the target dir.

That's the whole chore in one command. Use it.

## Why not a GitHub Action?

A push-triggered Action in al80-lcd could build and push the site to al80-studio automatically —
but the push crosses repos, and the private repo's built-in `GITHUB_TOKEN` can't write to a
different repo. That needs a credential you have to create by hand:

1. A fine-grained PAT (or a deploy key) with **contents: write** on `snackdriven/al80-studio`.
2. Stored as a secret in al80-lcd, e.g. `STUDIO_DEPLOY_TOKEN`.

Once that secret exists, a `.github/workflows/deploy-wiki.yml` in al80-lcd that runs
`uvx --with mkdocs-material mkdocs build`, then clones al80-studio with the PAT, copies `site/` →
`wiki/`, and commits, would make deploys hands-off. Until the secret is set, don't add the
workflow — it would just fail on every push. `deploy.sh` is the supported path.
