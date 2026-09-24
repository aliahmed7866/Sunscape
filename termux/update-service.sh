#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
APP_DIR="${SUNSCAPE_APP_DIR:-$HOME/sunscape}"
BRANCH="${SUNSCAPE_BRANCH:-main}"
cd "$APP_DIR"
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo 'Sunscape has local changes; preserve them before updating.' >&2; exit 1; }
git fetch origin "$BRANCH"
[ "$(git branch --show-current)" = "$BRANCH" ] || { echo "Expected branch $BRANCH; checkout was preserved." >&2; exit 1; }
git merge --ff-only "origin/$BRANCH"
# Reuse saved endpoint and repair missing supervision on every update.
exec bash termux/install-service.sh
