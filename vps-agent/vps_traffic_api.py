#!/usr/bin/env python3
"""Tiny vnStat-backed traffic API for the Surge VPS traffic panel."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse


def json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def read_vnstat_json() -> dict[str, Any]:
    output = subprocess.check_output(["vnstat", "--json"], text=True)
    return json.loads(output)


def select_interface(vnstat_data: dict[str, Any], interface_name: str) -> dict[str, Any]:
    interfaces = vnstat_data.get("interfaces")
    if not isinstance(interfaces, list) or not interfaces:
        raise ValueError("vnStat returned no interfaces")

    if not interface_name:
        return interfaces[0]

    for item in interfaces:
        if item.get("name") == interface_name:
            return item

    raise ValueError(f"Interface not found in vnStat data: {interface_name}")


def current_month_entry(interface: dict[str, Any], now: datetime) -> dict[str, Any]:
    months = interface.get("traffic", {}).get("month")
    if not isinstance(months, list):
        raise ValueError("vnStat returned no monthly traffic data")

    for item in months:
        date = item.get("date", {})
        if date.get("year") == now.year and date.get("month") == now.month:
            return item

    return {"rx": 0, "tx": 0, "empty": True}


def parse_ymd(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)


def rolling_period_bounds(start: str, days: int, now: datetime) -> tuple[datetime, datetime]:
    period_days = max(1, int(days or 30))
    current_start = parse_ymd(start)
    while current_start + timedelta(days=period_days) <= now:
      current_start = current_start + timedelta(days=period_days)
    return current_start, current_start + timedelta(days=period_days)


def day_entry_date(entry: dict[str, Any]) -> datetime:
    date = entry.get("date", {})
    return datetime(int(date["year"]), int(date["month"]), int(date["day"]), tzinfo=timezone.utc)


def rolling_period_entry(interface: dict[str, Any], period_start: str, period_days: int, now: datetime) -> dict[str, int]:
    days = interface.get("traffic", {}).get("day")
    if not isinstance(days, list):
        raise ValueError("vnStat returned no daily traffic data")

    start, end = rolling_period_bounds(period_start, period_days, now)
    rx = 0
    tx = 0
    matched = False

    for item in days:
        item_date = day_entry_date(item)
        if start <= item_date < end:
            rx += int(item.get("rx", 0))
            tx += int(item.get("tx", 0))
            matched = True

    if not matched:
        raise ValueError(f"No vnStat day entries for rolling period starting {start.date().isoformat()}")

    return {"rx": rx, "tx": tx}


def monthly_day_period_bounds(reset_day: int, now: datetime) -> tuple[datetime, datetime]:
    day = max(1, min(28, int(reset_day or 1)))
    current_start = datetime(now.year, now.month, day, tzinfo=timezone.utc)
    if current_start > now:
        previous_month = now.month - 1
        previous_year = now.year
        if previous_month == 0:
            previous_month = 12
            previous_year -= 1
        current_start = datetime(previous_year, previous_month, day, tzinfo=timezone.utc)

    next_month = current_start.month + 1
    next_year = current_start.year
    if next_month == 13:
        next_month = 1
        next_year += 1
    return current_start, datetime(next_year, next_month, day, tzinfo=timezone.utc)


def period_entry_from_days(interface: dict[str, Any], start: datetime, end: datetime, source_name: str) -> dict[str, int]:
    days = interface.get("traffic", {}).get("day")
    if not isinstance(days, list):
        raise ValueError("vnStat returned no daily traffic data")

    rx = 0
    tx = 0
    matched = False

    for item in days:
        item_date = day_entry_date(item)
        if start <= item_date < end:
            rx += int(item.get("rx", 0))
            tx += int(item.get("tx", 0))
            matched = True

    if not matched:
        raise ValueError(f"No vnStat day entries for {source_name} period starting {start.date().isoformat()}")

    return {"rx": rx, "tx": tx}


def build_payload(
    vnstat_data: dict[str, Any],
    interface_name: str,
    country: str,
    flag: str,
    limit_gb: float = 0,
    reset_type: str = "monthly",
    reset_day: int = 1,
    reset_start: str = "",
    reset_days: int = 30,
    period_start: str = "",
    period_days: int = 0,
    now: datetime | None = None,
) -> dict[str, Any]:
    current_time = now or datetime.now(timezone.utc).astimezone()
    interface = select_interface(vnstat_data, interface_name)
    if period_start:
        traffic = rolling_period_entry(interface, period_start, period_days, current_time)
        source = "vnstat-rolling"
    elif reset_type == "rolling" and reset_start:
        traffic = rolling_period_entry(interface, reset_start, reset_days, current_time)
        source = "vnstat-rolling"
    elif reset_type == "monthly" and int(reset_day or 1) != 1:
        start, end = monthly_day_period_bounds(reset_day, current_time)
        traffic = period_entry_from_days(interface, start, end, "monthly-day")
        source = "vnstat-monthly-day"
    else:
        traffic = current_month_entry(interface, current_time)
        source = "vnstat-month-empty" if traffic.get("empty") else "vnstat-month"

    payload: dict[str, Any] = {
        "rx_bytes": int(traffic.get("rx", 0)),
        "tx_bytes": int(traffic.get("tx", 0)),
        "interface": interface.get("name", ""),
        "updated_at": current_time.isoformat(timespec="seconds"),
        "source": source,
    }

    if limit_gb:
        payload["limit_gb"] = limit_gb
    if reset_type == "rolling":
        payload["reset"] = {"type": "rolling", "start": reset_start, "days": reset_days or 30}
    else:
        payload["reset"] = {"type": "monthly", "day": reset_day or 1}

    if country:
        payload["country"] = country.upper()
    if flag:
        payload["flag"] = flag

    return payload


class TrafficHandler(BaseHTTPRequestHandler):
    server_version = "VpsTrafficApi/1.0"

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        parsed = urlparse(self.path)
        if parsed.path != "/traffic":
            self.send_json(404, {"error": "not found"})
            return

        query = parse_qs(parsed.query)

        try:
            payload = build_payload(
                read_vnstat_json(),
                self.server.interface,  # type: ignore[attr-defined]
                self.server.country,  # type: ignore[attr-defined]
                self.server.flag,  # type: ignore[attr-defined]
                self.server.limit_gb,  # type: ignore[attr-defined]
                self.server.reset_type,  # type: ignore[attr-defined]
                self.server.reset_day,  # type: ignore[attr-defined]
                self.server.reset_start,  # type: ignore[attr-defined]
                self.server.reset_days,  # type: ignore[attr-defined]
                query.get("period_start", [""])[0],
                int(query.get("period_days", ["0"])[0] or 0),
            )
        except Exception as exc:  # pragma: no cover - exercised on real VPS
            self.send_json(500, {"error": str(exc)})
            return

        self.send_json(200, payload)

    def log_message(self, fmt: str, *args: Any) -> None:
        if os.environ.get("VPS_TRAFFIC_LOG") == "1":
            super().log_message(fmt, *args)


def make_server(
    host: str,
    port: int,
    interface: str,
    country: str,
    flag: str,
    token: str,
    limit_gb: float,
    reset_type: str,
    reset_day: int,
    reset_start: str,
    reset_days: int,
) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), TrafficHandler)
    server.interface = interface  # type: ignore[attr-defined]
    server.country = country  # type: ignore[attr-defined]
    server.flag = flag  # type: ignore[attr-defined]
    server.limit_gb = limit_gb  # type: ignore[attr-defined]
    server.reset_type = reset_type  # type: ignore[attr-defined]
    server.reset_day = reset_day  # type: ignore[attr-defined]
    server.reset_start = reset_start  # type: ignore[attr-defined]
    server.reset_days = reset_days  # type: ignore[attr-defined]
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description="Expose current-month vnStat traffic as JSON.")
    parser.add_argument("--host", default=os.environ.get("VPS_TRAFFIC_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("VPS_TRAFFIC_PORT", "8787")))
    parser.add_argument("--interface", default=os.environ.get("VPS_TRAFFIC_INTERFACE", ""))
    parser.add_argument("--country", default=os.environ.get("VPS_TRAFFIC_COUNTRY", ""))
    parser.add_argument("--flag", default=os.environ.get("VPS_TRAFFIC_FLAG", ""))
    parser.add_argument("--token", default=os.environ.get("VPS_TRAFFIC_TOKEN", ""))
    parser.add_argument("--limit-gb", type=float, default=float(os.environ.get("VPS_TRAFFIC_LIMIT_GB", "0") or 0))
    parser.add_argument("--reset-type", default=os.environ.get("VPS_TRAFFIC_RESET_TYPE", "monthly"))
    parser.add_argument("--reset-day", type=int, default=int(os.environ.get("VPS_TRAFFIC_RESET_DAY", "1") or 1))
    parser.add_argument("--reset-start", default=os.environ.get("VPS_TRAFFIC_RESET_START", ""))
    parser.add_argument("--reset-days", type=int, default=int(os.environ.get("VPS_TRAFFIC_RESET_DAYS", "30") or 30))
    parser.add_argument("--once", action="store_true", help="Print one JSON payload and exit.")
    args = parser.parse_args()

    if args.once:
        payload = build_payload(
            read_vnstat_json(),
            args.interface,
            args.country,
            args.flag,
            args.limit_gb,
            args.reset_type,
            args.reset_day,
            args.reset_start,
            args.reset_days,
        )
        print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        return

    server = make_server(
        args.host,
        args.port,
        args.interface,
        args.country,
        args.flag,
        args.token,
        args.limit_gb,
        args.reset_type,
        args.reset_day,
        args.reset_start,
        args.reset_days,
    )
    print(f"Serving VPS traffic API on http://{args.host}:{args.port}/traffic")
    server.serve_forever()


if __name__ == "__main__":
    main()
