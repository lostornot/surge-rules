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
LIMIT_GB="${LIMIT_GB:-}"
RESET_TYPE="${RESET_TYPE:-}"
RESET_DAY="${RESET_DAY:-}"
RESET_START="${RESET_START:-}"
RESET_DAYS="${RESET_DAYS:-}"

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

prompt_value() {
  local var_name="$1"
  local prompt="$2"
  local default_value="$3"
  local current_value="${!var_name:-}"
  local answer=""

  if [ -n "$current_value" ]; then
    return
  fi

  if [ -t 0 ]; then
    read -r -p "$prompt [$default_value]: " answer
    printf -v "$var_name" '%s' "${answer:-$default_value}"
  else
    printf -v "$var_name" '%s' "$default_value"
  fi
}

configure_quota() {
  echo
  echo "VPS traffic quota setup"
  echo

  prompt_value LIMIT_GB "Monthly traffic quota in GB" "500"

  if [ -z "$RESET_TYPE" ]; then
    if [ -t 0 ]; then
      echo
      echo "Reset type:"
      echo "  1) Calendar month, resets on the 1st"
      echo "  2) Monthly billing day, for example resets on the 6th"
      echo "  3) Rolling period, for example every 30 days after activation"
      read -r -p "Choose reset type [1]: " reset_choice
    else
      reset_choice="1"
    fi

    case "${reset_choice:-1}" in
      2) RESET_TYPE="monthly" ;;
      3) RESET_TYPE="rolling" ;;
      *) RESET_TYPE="monthly" ;;
    esac
  fi

  if [ "$RESET_TYPE" = "rolling" ]; then
    prompt_value RESET_START "Rolling period start date, YYYY-MM-DD" "$(date +%F)"
    prompt_value RESET_DAYS "Rolling period length in days" "30"
    RESET_DAY="${RESET_DAY:-1}"
  else
    if [ "${reset_choice:-}" = "2" ]; then
      prompt_value RESET_DAY "Monthly reset day, 1-28" "6"
    else
      prompt_value RESET_DAY "Monthly reset day, 1-28" "1"
    fi
    RESET_START="${RESET_START:-}"
    RESET_DAYS="${RESET_DAYS:-30}"
  fi
}

require_config() {
  guess_interface
  detect_country
  configure_quota

  if [ -z "$INTERFACE" ]; then
    echo "Could not guess network interface. Re-run with INTERFACE=eth0." >&2
    exit 1
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
Environment=VPS_TRAFFIC_LIMIT_GB=$LIMIT_GB
Environment=VPS_TRAFFIC_RESET_TYPE=$RESET_TYPE
Environment=VPS_TRAFFIC_RESET_DAY=$RESET_DAY
Environment=VPS_TRAFFIC_RESET_START=$RESET_START
Environment=VPS_TRAFFIC_RESET_DAYS=$RESET_DAYS
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
  echo "Quota:     ${LIMIT_GB} GB"
  if [ "$RESET_TYPE" = "rolling" ]; then
    echo "Reset:     every ${RESET_DAYS} days from ${RESET_START}"
  else
    echo "Reset:     monthly on day ${RESET_DAY}"
  fi
  echo "Listen:    http://$HOST:$PORT/traffic"
  echo
  echo "Local test:"
  echo "curl 'http://127.0.0.1:$PORT/traffic'"
  echo
  echo "Surge fields:"
  echo "VPS1_NAME=<display-name>"
  echo "VPS1_HOST=<your-vps-ip-or-domain>"
  echo "VPS1_PORT=$PORT"
  echo
}

need_root
install_packages
require_config
install_agent
write_service
start_services
print_summary
