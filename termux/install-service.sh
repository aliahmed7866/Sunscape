#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

APP_DIR="${SUNSCAPE_APP_DIR:-$HOME/sunscape}"
PORT="${SUNSCAPE_PORT:-8081}"
SERVICE_DIR="$PREFIX/var/service/sunscape"
VENV_DIR="$APP_DIR/.venv"

cd "$APP_DIR"

if ! command -v sv >/dev/null 2>&1; then
  echo "[Sunscape] Installing termux-services..."
  pkg install -y termux-services
fi

if [ ! -d "$VENV_DIR" ]; then
  echo "[Sunscape] Creating virtual environment..."
  python -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/pip" install -r requirements.txt

mkdir -p "$SERVICE_DIR"
cat > "$SERVICE_DIR/run" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
exec 2>&1
cd "$APP_DIR"
export HOST=127.0.0.1
export PORT=$PORT
exec "$VENV_DIR/bin/gunicorn" \
  --bind 127.0.0.1:$PORT \
  --workers 2 \
  --threads 4 \
  --timeout 60 \
  --access-logfile - \
  --error-logfile - \
  app:app
EOF
chmod +x "$SERVICE_DIR/run"

sv-enable sunscape >/dev/null 2>&1 || true
sv up sunscape >/dev/null 2>&1 || true

sleep 1
if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null; then
  echo "[Sunscape] Running on http://127.0.0.1:$PORT"
else
  echo "[Sunscape] Service installed, but health check is not responding yet."
  echo "Run: sv status sunscape"
  exit 1
fi
