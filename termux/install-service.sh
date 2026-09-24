#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
APP_DIR="${SUNSCAPE_APP_DIR:-$HOME/sunscape}"
export SUNSCAPE_APP_DIR="$APP_DIR"
: "${PREFIX:?Run this installer in Termux}"
SERVICE_DIR="$PREFIX/var/service/sunscape"
VENV_DIR="$APP_DIR/.venv"
cd "$APP_DIR"
command -v sv >/dev/null 2>&1 || pkg install -y termux-services
# Check before changing the service. Never stop the process occupying a port.
PORT="$(python termux/configure.py select)"
[ -d "$VENV_DIR" ] || python -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install -r requirements.txt
mkdir -p "$SERVICE_DIR"
{
  printf '#!%s/bin/bash\nexec 2>&1\n' "$PREFIX"
  printf 'cd %q\nexport HOST=127.0.0.1\nexport PORT=%q\n' "$APP_DIR" "$PORT"
  printf 'exec %q --bind %q --workers 2 --threads 4 --timeout 60 --access-logfile - --error-logfile - app:app\n' "$VENV_DIR/bin/gunicorn" "127.0.0.1:$PORT"
} > "$SERVICE_DIR/run.new"
chmod +x "$SERVICE_DIR/run.new"
mv "$SERVICE_DIR/run.new" "$SERVICE_DIR/run"
export SVDIR="$PREFIX/var/service"
# Installing termux-services does not start runsv in the current shell.
if [ -f "$PREFIX/etc/profile.d/start-services.sh" ]; then
  . "$PREFIX/etc/profile.d/start-services.sh"
else
  echo 'Termux service startup hook is missing. Reinstall termux-services.' >&2
  exit 1
fi
ready=0
for attempt in {1..20}; do
  if [ -p "$SERVICE_DIR/supervise/ok" ]; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo 'Sunscape supervisor did not start. Open a new Termux session and rerun this installer.' >&2
  exit 1
fi
sv-enable sunscape
sv -w 15 restart "$SERVICE_DIR"
for attempt in {1..15}; do
  if "$VENV_DIR/bin/python" termux/configure.py save "$PORT"; then
    bash termux/install-boot.sh
    printf '[Sunscape] Ready: http://127.0.0.1:%s (Admin Hub updated)\n' "$PORT"
    exit 0
  fi
  sleep 1
done
echo 'Sunscape failed its health check. Run: sv status sunscape' >&2
exit 1
