#!/usr/bin/env bash
set -euo pipefail

REPO_RAW_BASE="${REPO_RAW_BASE:-https://raw.githubusercontent.com/lostornot/surge-rules/main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/vps-traffic}"
SERVICE_FILE="${SERVICE_FILE:-/etc/systemd/system/vps-traffic-api.service}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8787}"
INTERFACE="${INTERFACE:-}"
COUNTRY="${COUNTRY:-}"
FLAG="${FLAG:-}"
TOKEN="${TOKEN:-}"

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Please run as root, or prefix with sudo." >&2
    exit 1
  fi
}

install_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y vnstat python3 curl
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y vnstat python3 curl
  elif command -v yum >/dev/null 2>&1; then
    yum install -y vnstat python3 curl
  else
    echo "Unsupported package manager. Please install vnstat, python3, and curl manually." >&2
    exit 1
  fi
}

guess_interface() {
  if [ -n "$INTERFACE" ]; then
    return
  fi

  INTERFACE="$(ip route show default 2>/dev/null | awk '{print $5; exit}')"
  if [ -z "$INTERFACE" ]; then
    INTERFACE="$(vnstat --iflist 2>/dev/null | awk 'NR==1 {print $1}')"
  fi
}

detect_country() {
  if [ -n "$COUNTRY" ] || [ -n "$FLAG" ]; then
    return
  fi

  COUNTRY="$(
    curl -fsSL --max-time 5 https://ipapi.co/country/ 2>/dev/null \
      | tr -dc 'A-Za-z' \
      | tr '[:lower:]' '[:upper:]' \
      | cut -c1-2
  )"
}

require_config() {
  guess_interface
  detect_country

  if [ -z "$INTERFACE" ]; then
    echo "Could not guess network interface. Re-run with INTERFACE=eth0." >&2
    exit 1
  fi

  if [ -z "$TOKEN" ]; then
    TOKEN="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(24))
PY
)"
  fi
}

install_agent() {
  mkdir -p "$INSTALL_DIR"
  curl -fsSL \
    -o "$INSTALL_DIR/vps_traffic_api.py" \
    "$REPO_RAW_BASE/vps-agent/vps_traffic_api.py"
  chmod +x "$INSTALL_DIR/vps_traffic_api.py"
}

write_service() {
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=VPS Traffic API
After=network-online.target vnstat.service

[Service]
Type=simple
Environment=VPS_TRAFFIC_INTERFACE=$INTERFACE
Environment=VPS_TRAFFIC_COUNTRY=$COUNTRY
Environment=VPS_TRAFFIC_FLAG=$FLAG
Environment=VPS_TRAFFIC_TOKEN=$TOKEN
ExecStart=/usr/bin/python3 $INSTALL_DIR/vps_traffic_api.py --host $HOST --port $PORT
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
}

start_services() {
  systemctl enable --now vnstat || true
  vnstat --add -i "$INTERFACE" >/dev/null 2>&1 || true
  systemctl restart vnstat || true
  systemctl daemon-reload
  systemctl enable --now vps-traffic-api
}

print_summary() {
  echo
  echo "VPS Traffic API installed."
  echo
  echo "Interface: $INTERFACE"
  echo "Country:   ${COUNTRY:-"(none)"}"
  echo "Flag:      ${FLAG:-"(none)"}"
  echo "Listen:    http://$HOST:$PORT/traffic"
  echo "Token:     $TOKEN"
  echo
  echo "Local test:"
  echo "curl 'http://127.0.0.1:$PORT/traffic?token=$TOKEN'"
  echo
  echo "Surge fields:"
  echo "VPS1_HOST=<your-vps-ip-or-domain>"
  echo "VPS1_PORT=$PORT"
  echo "VPS1_TOKEN=$TOKEN"
  echo
}

need_root
install_packages
require_config
install_agent
write_service
start_services
print_summary
