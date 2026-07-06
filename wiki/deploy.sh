#!/usr/bin/env bash
# Build the AL80 wiki and publish it. The one-command replacement for the old
# build/copy/commit-both/push chore.
#
#   ./deploy.sh
#
# What it does:
#   1. Builds the MkDocs site from wiki/ (private al80-lcd).
#   2. Copies the static site into al80-studio/wiki/ (public, served by GitHub Pages).
#   3. Commits the wiki source in al80-lcd and the built site in al80-studio.
#      In al80-studio it stages ONLY wiki/ + .nojekyll — never index.html/src/host/README.
#   4. Pushes both repos.
#
# Source stays private; only the rendered HTML lands in the public repo. Pages serves it at
# https://snackdriven.github.io/al80-studio/wiki/
set -euo pipefail

LCD="/c/Users/bette/al80-lcd"
STUDIO="/c/Users/bette/al80-studio"
WIKI="$LCD/wiki"
COMMIT_MSG="${1:-wiki: rebuild + deploy}"

# --- 0. Free the target dir on Windows -------------------------------------
# A stale `python -m http.server` whose CWD is the wiki dir can lock it against rm -rf.
# Kill any http.server on :809x (best effort), remember if :8099 was up so we can restart it.
RESTART_8099=0
if command -v netstat >/dev/null 2>&1 && command -v taskkill >/dev/null 2>&1; then
  netstat -ano 2>/dev/null | grep -q ":8099 .*LISTENING" && RESTART_8099=1 || true
  for pid in $(netstat -ano 2>/dev/null | grep -E ":809[0-9] .*LISTENING" | awk '{print $NF}' | sort -u); do
    # only kill python processes (the http.server), leave anything else alone
    if tasklist //FI "PID eq $pid" 2>/dev/null | grep -qi python; then
      taskkill //PID "$pid" //F >/dev/null 2>&1 || true
    fi
  done
fi

# --- 1. Build --------------------------------------------------------------
echo "== build mkdocs =="
cd "$WIKI"
uvx --with mkdocs-material mkdocs build --clean

# --- 2. Copy site -> public repo -------------------------------------------
echo "== copy site -> al80-studio/wiki =="
rm -rf "$STUDIO/wiki"
cp -r "$WIKI/site" "$STUDIO/wiki"

# --- 3a. Commit the wiki source (private al80-lcd) -------------------------
echo "== commit al80-lcd (source) =="
cd "$LCD"
git add wiki/
if ! git diff --cached --quiet; then
  git -c user.name="snackdriven" -c commit.gpgsign=false commit -q -m "$COMMIT_MSG"
  git push -q origin main
else
  echo "  (no wiki source changes)"
fi

# --- 3b. Commit the built site (public al80-studio) -----------------------
# Stage ONLY the wiki output + .nojekyll. Leave index.html/src/host/README untouched.
echo "== commit al80-studio (built site) =="
cd "$STUDIO"
git add wiki .nojekyll
if ! git diff --cached --quiet; then
  git -c user.name="snackdriven" -c commit.gpgsign=false commit -q -m "$COMMIT_MSG"
  git push -q origin main
else
  echo "  (no built-site changes)"
fi

# --- 4. Restart the local preview server if we stopped it ------------------
if [ "$RESTART_8099" = "1" ]; then
  echo "== restart local preview on :8099 =="
  ( cd "$STUDIO" && python -m http.server 8099 >/dev/null 2>&1 & )
fi

echo "done. live at https://snackdriven.github.io/al80-studio/wiki/"
