import importlib.util
import json
import pathlib
import unittest
from datetime import datetime, timezone


MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "vps-agent" / "vps_traffic_api.py"
spec = importlib.util.spec_from_file_location("vps_traffic_api", MODULE_PATH)
vps_traffic_api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vps_traffic_api)


class VpsTrafficApiTest(unittest.TestCase):
    def sample_vnstat(self):
        return {
            "interfaces": [
                {
                    "name": "eth0",
                    "traffic": {
                        "day": [
                            {
                                "date": {"year": 2026, "month": 6, "day": 10},
                                "rx": 10,
                                "tx": 20,
                            },
                            {
                                "date": {"year": 2026, "month": 6, "day": 11},
                                "rx": 100,
                                "tx": 200,
                            },
                            {
                                "date": {"year": 2026, "month": 6, "day": 30},
                                "rx": 300,
                                "tx": 400,
                            },
                        ],
                        "month": [
                            {
                                "date": {"year": 2026, "month": 5},
                                "rx": 1,
                                "tx": 2,
                            },
                            {
                                "date": {"year": 2026, "month": 6},
                                "rx": 40000000000,
                                "tx": 48300000000,
                            },
                        ]
                    },
                },
                {
                    "name": "ens3",
                    "traffic": {
                        "month": [
                            {
                                "date": {"year": 2026, "month": 6},
                                "rx": 10,
                                "tx": 20,
                            }
                        ]
                    },
                },
            ]
        }

    def test_build_payload_uses_current_month_for_named_interface(self):
        payload = vps_traffic_api.build_payload(
            self.sample_vnstat(),
            interface_name="eth0",
            country="US",
            flag="",
            limit_gb=500,
            reset_type="monthly",
            reset_day=1,
            now=datetime(2026, 6, 30, 11, 11, tzinfo=timezone.utc),
        )

        self.assertEqual(payload["interface"], "eth0")
        self.assertEqual(payload["rx_bytes"], 40000000000)
        self.assertEqual(payload["tx_bytes"], 48300000000)
        self.assertEqual(payload["country"], "US")
        self.assertEqual(payload["limit_gb"], 500)
        self.assertEqual(payload["reset"], {"type": "monthly", "day": 1})
        self.assertEqual(payload["updated_at"], "2026-06-30T11:11:00+00:00")
        self.assertEqual(payload["source"], "vnstat-month")

    def test_build_payload_defaults_to_first_interface(self):
        payload = vps_traffic_api.build_payload(
            self.sample_vnstat(),
            interface_name="",
            country="",
            flag="⚠️",
            limit_gb=0,
            reset_type="monthly",
            reset_day=1,
            now=datetime(2026, 6, 30, 11, 11, tzinfo=timezone.utc),
        )

        self.assertEqual(payload["interface"], "eth0")
        self.assertEqual(payload["flag"], "⚠️")

    def test_build_payload_can_sum_current_rolling_period_from_daily_entries(self):
        payload = vps_traffic_api.build_payload(
            self.sample_vnstat(),
            interface_name="eth0",
            country="US",
            flag="",
            limit_gb=500,
            reset_type="rolling",
            reset_start="2026-06-11",
            reset_days=30,
            period_start="2026-06-11",
            period_days=30,
            now=datetime(2026, 6, 30, 11, 11, tzinfo=timezone.utc),
        )

        self.assertEqual(payload["rx_bytes"], 400)
        self.assertEqual(payload["tx_bytes"], 600)
        self.assertEqual(payload["reset"], {"type": "rolling", "start": "2026-06-11", "days": 30})
        self.assertEqual(payload["source"], "vnstat-rolling")

    def test_build_payload_can_sum_monthly_reset_day_from_daily_entries(self):
        payload = vps_traffic_api.build_payload(
            self.sample_vnstat(),
            interface_name="eth0",
            country="US",
            flag="",
            limit_gb=1000,
            reset_type="monthly",
            reset_day=11,
            now=datetime(2026, 6, 30, 11, 11, tzinfo=timezone.utc),
        )

        self.assertEqual(payload["rx_bytes"], 400)
        self.assertEqual(payload["tx_bytes"], 600)
        self.assertEqual(payload["reset"], {"type": "monthly", "day": 11})
        self.assertEqual(payload["source"], "vnstat-monthly-day")

    def test_missing_current_month_returns_zero_payload_for_new_vnstat_database(self):
        payload = vps_traffic_api.build_payload(
            self.sample_vnstat(),
            interface_name="eth0",
            country="US",
            flag="",
            limit_gb=0,
            reset_type="monthly",
            reset_day=1,
            now=datetime(2026, 7, 1, tzinfo=timezone.utc),
        )

        self.assertEqual(payload["rx_bytes"], 0)
        self.assertEqual(payload["tx_bytes"], 0)
        self.assertEqual(payload["source"], "vnstat-month-empty")

    def test_json_response_is_compact_utf8(self):
        body = vps_traffic_api.json_bytes({"flag": "🇺🇸", "rx_bytes": 1})
        self.assertEqual(json.loads(body.decode("utf-8"))["flag"], "🇺🇸")

    def test_make_server_ignores_legacy_token_argument(self):
        class FakeServer:
            def __init__(self, address, handler):
                self.address = address
                self.handler = handler

        original_server = vps_traffic_api.ThreadingHTTPServer
        vps_traffic_api.ThreadingHTTPServer = FakeServer

        try:
            server = vps_traffic_api.make_server(
                "127.0.0.1",
                0,
                "eth0",
                "US",
                "",
                "legacy-token",
                500,
                "monthly",
                1,
                "",
                30,
            )
        finally:
            vps_traffic_api.ThreadingHTTPServer = original_server

        self.assertFalse(hasattr(server, "token"))
        self.assertEqual(server.interface, "eth0")
        self.assertEqual(server.limit_gb, 500)


if __name__ == "__main__":
    unittest.main()
