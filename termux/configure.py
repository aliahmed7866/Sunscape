"""Persist Sunscape's endpoint outside the checkout and register it with the hub."""
import argparse
import json
import os
from pathlib import Path
import socket
import urllib.request


def available(port):
    try:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False


def healthy(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as response:
            return json.load(response).get("service") == "sunscape"
    except (OSError, ValueError):
        return False


def select_port(explicit, saved, reserved=()):
    candidates = [int(explicit)] if explicit else ([int(saved)] if saved else []) + list(range(8091, 8101))
    for port in dict.fromkeys(candidates):
        if not 1024 <= port <= 65535:
            raise ValueError("Sunscape port must be between 1024 and 65535")
        if port not in reserved and (available(port) or (port == saved and healthy(port))):
            return port
    raise ValueError("Sunscape port is occupied or reserved. Set SUNSCAPE_PORT to a free port; no other app was stopped.")


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, indent=2) + "\n")
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["select", "save"])
    parser.add_argument("port", nargs="?", type=int)
    args = parser.parse_args()
    config = Path(os.environ.get("SUNSCAPE_CONFIG_DIR", str(Path.home()/".config/sunscape"))) / "service.json"
    registry = Path(os.environ.get("AYCF_ADMIN_REGISTRY", str(Path.home()/".config/aycf/apps.json")))
    saved = json.loads(config.read_text()) if config.exists() else {}
    data = json.loads(registry.read_text()) if registry.exists() else {"apps": []}
    if args.action == "select":
        reserved = {int(row["port"]) for row in data.get("apps", []) if row.get("id") != "sunscape" and row.get("port")}
        print(select_port(os.environ.get("SUNSCAPE_PORT"), saved.get("port"), reserved))
        return
    port = args.port
    if not port or not healthy(port):
        raise SystemExit("Sunscape health verification failed; endpoint settings were not changed")
    root = str(Path(os.environ["SUNSCAPE_APP_DIR"]).resolve())
    endpoint = {"port": port, "health_url": f"http://127.0.0.1:{port}/health", "open_url": f"http://127.0.0.1:{port}"}
    write_json(config, endpoint)
    row = next((row for row in data.get("apps", []) if row.get("id") == "sunscape"), None)
    if row is None:
        row = {"id": "sunscape", "name": "Sunscape"}
        data.setdefault("apps", []).append(row)
    row.update(endpoint)
    row.update(working_dir=root, service="sunscape", update_branch="main",
               start=[str(Path(root)/".venv/bin/gunicorn"), "--bind", f"127.0.0.1:{port}", "app:app"],
               update_command=["bash", str(Path(root)/"termux/update-service.sh")])
    write_json(registry, data)


if __name__ == "__main__":
    main()
