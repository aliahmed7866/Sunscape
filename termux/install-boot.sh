#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

BOOT_DIR="$HOME/.termux/boot"
BOOT_SCRIPT="$BOOT_DIR/20-sunscape-services"

mkdir -p "$BOOT_DIR"
cat > "$BOOT_SCRIPT" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock >/dev/null 2>&1 || true

export SVDIR="$PREFIX/var/service"
[ ! -f "$PREFIX/etc/profile.d/start-services.sh" ] || . "$PREFIX/etc/profile.d/start-services.sh"
for attempt in {1..20}; do
  [ ! -p "$SVDIR/sunscape/supervise/ok" ] || break
  sleep 1
done

sv up sunscape >/dev/null 2>&1 || true
EOF
chmod +x "$BOOT_SCRIPT"

echo "[Sunscape] Boot hook installed at $BOOT_SCRIPT"
echo "[Sunscape] Requires the Termux:Boot companion app to launch automatically after a phone reboot."
