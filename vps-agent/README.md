# VPS Traffic API

This tiny agent exposes current-month `vnStat` traffic as JSON for the Surge VPS traffic panel.

## 1. Install vnStat

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
python3 vps_traffic_api.py --once
```

Expected output:

```json
{"rx_bytes":40000000000,"tx_bytes":48300000000,"interface":"eth0","updated_at":"2026-06-30T11:11:00+00:00","source":"vnstat-month","country":"US"}
```

## 3. Run HTTP API

```bash
VPS_TRAFFIC_INTERFACE=eth0 \
VPS_TRAFFIC_COUNTRY=US \
VPS_TRAFFIC_TOKEN=change-me \
python3 vps_traffic_api.py --host 127.0.0.1 --port 8787
```

Request:

```bash
curl 'http://127.0.0.1:8787/traffic?token=change-me'
```

For a rolling billing period, the Surge panel automatically appends `period_start` and `period_days` to the request URL when the VPS config uses `reset.type = "rolling"`:

```bash
curl 'http://127.0.0.1:8787/traffic?token=change-me&period_start=2026-06-11&period_days=30'
```

In this mode the agent sums `vnStat` daily entries in the current rolling period.

The token may also be sent as:

```text
Authorization: Bearer change-me
```

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
Environment=VPS_TRAFFIC_TOKEN=change-me
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

The agent binds to `127.0.0.1` by default. Put it behind Caddy, Nginx, Cloudflare Tunnel, or another HTTPS reverse proxy before using it from Surge.

Example Surge config URL:

```text
https://vps1.example.com/traffic?token=change-me
```

## Notes

- `rx_bytes` is download traffic.
- `tx_bytes` is upload traffic.
- Without `period_start`, the API returns current calendar month traffic from `vnStat`.
- With `period_start` and `period_days`, the API sums `vnStat` daily entries for the current rolling period.
