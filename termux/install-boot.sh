#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

BOOT_DIR="$HOME/.termux/boot"
BOOT_SCRIPT="$BOOT_DIR/20-sunscape-services"

mkdir -p "$BOOT_DIR"
cat > "$BOOT_SCRIPT" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock >/dev/null 2>&1 || true

if ! pgrep -f "runsvdir.*var/service" >/dev/null 2>&1; then
  runsvdir-start >/dev/null 2>&1 &
  sleep 2
fi

sv up sunscape >/dev/null 2>&1 || true
EOF
chmod +x "$BOOT_SCRIPT"

echo "[Sunscape] Boot hook installed at $BOOT_SCRIPT"
echo "[Sunscape] Requires the Termux:Boot companion app to launch automatically after a phone reboot."
