# VPS Traffic API

This tiny agent exposes `vnStat` traffic and server-side quota settings as JSON for the Surge VPS traffic panel.

## Quick Install

On each VPS, run:

```bash
curl -fsSL -o /tmp/vps-traffic-install.sh https://raw.githubusercontent.com/lostornot/surge-rules/main/vps-agent/install.sh
sudo bash /tmp/vps-traffic-install.sh
```

The installer will:

- install `vnstat`, `python3`, and `curl`;
- guess the default network interface;
- try to detect the VPS country;
- ask for traffic quota and reset cycle;
- create and start the `vps-traffic-api` systemd service.

The interactive setup asks:

- traffic quota in GB, for example `500`;
- reset type:
  - calendar month, resets on the 1st;
  - monthly billing day, for example resets on the 6th;
  - rolling period, for example every 30 days after activation;
- reset day or rolling start date when needed.

Optional overrides:

```bash
sudo LIMIT_GB=500 RESET_TYPE=monthly RESET_DAY=6 INTERFACE=eth0 PORT=8787 bash /tmp/vps-traffic-install.sh
```

Most VPS only need the simple two-command install. Use the optional form only when the interface guess is wrong, or when you want to skip the prompts.

After install, test:

```bash
curl 'http://127.0.0.1:8787/traffic'
```

In the Surge module, fill the single `VPS` field:

```text
US-1446,100.79.53.68
```

For multiple VPS:

```text
US-1446,100.79.53.68|BWG DC6,bwg-dc6.tailnet.ts.net
```

The format is `name,host` or `name,host,port`. The default port is `8787`. When using Tailscale, set `host` to the Tailscale IP or MagicDNS name.

## Manual Install

### 1. Install vnStat

Debian/Ubuntu:

```bash
sudo apt update
sudo apt install -y vnstat python3
sudo systemctl enable --now vnstat
```

Check your interface name:

```bash
vnstat --iflist
vnstat --json
```

## 2. Run Once

```bash
VPS_TRAFFIC_INTERFACE=eth0 \
VPS_TRAFFIC_COUNTRY=US \
VPS_TRAFFIC_LIMIT_GB=500 \
VPS_TRAFFIC_RESET_TYPE=monthly \
VPS_TRAFFIC_RESET_DAY=6 \
python3 vps_traffic_api.py --once
```

Expected output:

```json
{"rx_bytes":40000000000,"tx_bytes":48300000000,"interface":"eth0","updated_at":"2026-06-30T11:11:00+00:00","source":"vnstat-monthly-day","limit_gb":500,"reset":{"type":"monthly","day":6},"country":"US"}
```

## 3. Run HTTP API

```bash
VPS_TRAFFIC_INTERFACE=eth0 \
VPS_TRAFFIC_COUNTRY=US \
VPS_TRAFFIC_LIMIT_GB=500 \
VPS_TRAFFIC_RESET_TYPE=monthly \
VPS_TRAFFIC_RESET_DAY=6 \
python3 vps_traffic_api.py --host 127.0.0.1 --port 8787
```

Request:

```bash
curl 'http://127.0.0.1:8787/traffic'
```

For a rolling billing period, configure the VPS service with `VPS_TRAFFIC_RESET_TYPE=rolling`, `VPS_TRAFFIC_RESET_START=YYYY-MM-DD`, and `VPS_TRAFFIC_RESET_DAYS=30`. The API calculates the current period itself:

```bash
curl 'http://127.0.0.1:8787/traffic'
```

In this mode the agent sums `vnStat` daily entries in the current rolling period.

## 4. systemd Service

Copy the script to `/opt/vps-traffic/vps_traffic_api.py`, then create `/etc/systemd/system/vps-traffic-api.service`:

```ini
[Unit]
Description=VPS Traffic API
After=network-online.target vnstat.service

[Service]
Type=simple
Environment=VPS_TRAFFIC_INTERFACE=eth0
Environment=VPS_TRAFFIC_COUNTRY=US
Environment=VPS_TRAFFIC_LIMIT_GB=500
Environment=VPS_TRAFFIC_RESET_TYPE=monthly
Environment=VPS_TRAFFIC_RESET_DAY=6
ExecStart=/usr/bin/python3 /opt/vps-traffic/vps_traffic_api.py --host 127.0.0.1 --port 8787
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vps-traffic-api
sudo systemctl status vps-traffic-api
```

## 5. Expose Safely

The installer binds to `0.0.0.0:8787` so Surge can reach it over a private network. Prefer Tailscale IP or MagicDNS names and avoid exposing this port to the public internet.

Example Surge config URL:

```text
http://vps1.tailnet.ts.net:8787/traffic
```

## Notes

- `rx_bytes` is download traffic.
- `tx_bytes` is upload traffic.
- `limit_gb` and `reset` are configured on the VPS and returned by this API.
- Calendar-month reset uses vnStat monthly data.
- Monthly billing-day and rolling-period reset use vnStat daily data for the current billing period.
