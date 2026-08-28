#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

APP_DIR="${SUNSCAPE_APP_DIR:-$HOME/sunscape}"
BRANCH="${SUNSCAPE_BRANCH:-main}"
PORT="${SUNSCAPE_PORT:-8081}"

cd "$APP_DIR"

echo "[Sunscape] Updating from origin/$BRANCH..."
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

if [ ! -d .venv ]; then
  python -m venv .venv
fi

.venv/bin/pip install -r requirements.txt
sv restart sunscape
sleep 1
curl -fsS "http://127.0.0.1:$PORT/health"
echo
echo "[Sunscape] Update complete."
