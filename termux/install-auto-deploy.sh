#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

APP_DIR="${SUNSCAPE_APP_DIR:-$HOME/sunscape}"
SERVICE_DIR="$PREFIX/var/service/sunscape-deploy"

cd "$APP_DIR"

if ! command -v sv >/dev/null 2>&1; then
  pkg install -y termux-services
fi

chmod +x "$APP_DIR/termux/auto-deploy.sh"
mkdir -p "$SERVICE_DIR"
cat > "$SERVICE_DIR/run" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
exec 2>&1
cd "$APP_DIR"
exec "$APP_DIR/termux/auto-deploy.sh"
EOF
chmod +x "$SERVICE_DIR/run"

sv-enable sunscape-deploy >/dev/null 2>&1 || true
sv up sunscape-deploy >/dev/null 2>&1 || true

echo "[Sunscape] Auto-deploy watcher installed."
sv status sunscape-deploy || true
