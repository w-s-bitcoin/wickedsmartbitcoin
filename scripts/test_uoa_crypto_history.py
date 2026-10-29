"""Isolated history refresh contracts; never run production feeds or jobs."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from webapps.uoa import uoa_crypto_history as history
from webapps.uoa import uoa_webapp_data_update as updater


class CryptoHistoryTests(unittest.TestCase):
    def test_fx_discovery_does_not_silently_admit_crypto(self):
        class Response:
            def raise_for_status(self):
                pass

            def json(self):
                return [{"iso_code": "EUR", "iso_numeric": "978", "name": "Euro"},
                        {"iso_code": "XAU", "iso_numeric": "959", "name": "Gold"},
                        {"iso_code": "ETH", "iso_numeric": None, "name": "Ethereum"},
                        {"iso_code": "NEW", "iso_numeric": None, "name": "Future Token"},
                        {"iso_code": "JEP", "iso_numeric": None, "name": "Jersey Pound"}]
        with patch.object(updater.requests, "get", return_value=Response()):
            self.assertEqual(set(updater.fetch_supported_currencies()), {"EUR", "XAU", "JEP"})

    def test_full_history_replaces_short_fx_series_and_preserves_other_rates(self):
        rows = [{"date": f"2026-01-0{i}", "eurusd": "1.12345678901234567", "ethusd": "999"} for i in range(1, 6)]
        original = json.dumps(rows)
        meta = {"currencies": {"USD": {"name": "US Dollar"}}, "pairs": [], "currency_groups": []}
        def fetch(url):
            if url.startswith(history.CM):
                return {"data": [{"asset": "eth", "time": "2026-01-03T00:00:00Z", "PriceUSD": "3.141592653589793"},
                                  {"asset": "eth", "time": "2026-01-04T00:00:00Z", "PriceUSD": "4"}]}
            return {"coins": {"coingecko:ethereum": {"symbol": "ETH", "prices": [
                {"timestamp": 1767312000, "price": 2},  # Jan 2
                {"timestamp": 1767398400, "price": 333},  # Beyond the requested early window
            ]}}}
        with patch.dict(history.COINS, {"ETH": ("Ethereum", "ethereum", 2026)}, clear=True):
            out, metadata = history.prepare(rows, meta, full=True, fetch=fetch, today="2026-01-05")
        self.assertEqual([r["ethusd"] for r in out], ["", "2", "3.141592653589793", "4", ""])
        self.assertEqual([r["eurusd"] for r in out], [r["eurusd"] for r in rows])
        self.assertEqual(json.dumps(rows), original)
        self.assertEqual(metadata["currencies"]["ETH"]["groups"], [history.GROUP])
        self.assertEqual(metadata["alternative_crypto_history"]["ETH"]["first_observation"], "2026-01-02")
        self.assertEqual(meta["currencies"], {"USD": {"name": "US Dollar"}})

    def test_incremental_refresh_retains_old_history_without_forward_fill(self):
        rows = [{"date": "2020-01-01", "ethusd": "1"}, {"date": "2026-01-04", "ethusd": "4"}, {"date": "2026-01-05", "ethusd": ""}]
        meta = {"alternative_crypto_history": {"ETH": {"full_history": True, "last_observation": "2026-01-04"}}}
        def fetch(url):
            if "batchHistorical" in url:
                return {"coins": {}}
            self.assertTrue(url.startswith(history.CM))
            self.assertEqual(parse_qs(urlparse(url).query)["start_time"], ["2025-11-30"])
            return {"data": [{"asset": "eth", "time": "2026-01-04T00:00:00Z", "PriceUSD": "5"}]}
        with patch.dict(history.COINS, {"ETH": ("Ethereum", "ethereum", 2015)}, clear=True):
            out, _ = history.prepare(rows, meta, fetch=fetch, today="2026-01-05")
        self.assertEqual([r["ethusd"] for r in out], ["1", "5", ""])

    def test_api_pagination_and_early_window_limits(self):
        calls = []
        def fetch(url):
            calls.append(url)
            return {"coins": {}}
        history.earlier_history("ETH", "2015-01-01", "2017-01-01", fetch)
        self.assertEqual(len(calls), 2)
        self.assertTrue(all(int(parse_qs(urlparse(url).query)["span"][0]) <= 500 for url in calls))
        responses = iter([{"data": [{"asset": "eth", "time": "2026-01-01", "PriceUSD": "1"}], "next_page_url": history.CM + "?next_page_token=2"},
                          {"data": [{"asset": "eth", "time": "2026-01-02", "PriceUSD": "2"}]}])
        self.assertEqual(len(history.coinmetrics_history("ETH", fetch=lambda url: next(responses))), 2)

    def test_gap_recovery_uses_actual_quote_dates_and_preserves_observations(self):
        values = {"2026-01-01": "1", "2026-01-04": "4"}
        def fetch(url):
            self.assertIn("batchHistorical", url)
            return {"coins": {"coingecko:ethereum": {"prices": [
                {"timestamp": 1767355200, "price": 2, "confidence": .99},  # Jan 2 noon
                {"timestamp": 1767268800, "price": 999, "confidence": .99},  # Existing Jan 1
                {"timestamp": 1767441600, "price": 3, "confidence": .1},  # Unreliable Jan 3
            ]}}}
        recovered = history.recover_missing_observations("ETH", values, fetch=fetch)
        self.assertEqual(recovered, {"2026-01-01": "1", "2026-01-02": "2", "2026-01-04": "4"})
        self.assertEqual(values, {"2026-01-01": "1", "2026-01-04": "4"})

    def test_failed_or_stale_history_never_installs_a_generation(self):
        rows = [{"date": "2026-01-01", "ethusd": "1"}]
        with patch.dict(history.COINS, {"ETH": ("Ethereum", "ethereum", 2015)}, clear=True):
            with self.assertRaises(ValueError):
                history.prepare(rows, {}, fetch=lambda url: {"data": []}, today="2026-01-05")
            with patch.object(history, "coinmetrics_history", return_value={"2015-08-08": "1"}), patch.object(history, "earlier_history", return_value={}):
                with self.assertRaisesRegex(ValueError, "Stale history"):
                    history.prepare(rows, {}, today="2026-01-05")

    def test_payloads_exist_before_marker_is_published(self):
        with tempfile.TemporaryDirectory() as directory:
            def marker(path):
                self.assertEqual((path / "daily_fx_rates.csv").read_text(), "date,ethusd\n2026-01-01,1\n")
                self.assertEqual(json.loads((path / "uoa_pairs.json").read_text()), {"currencies": {}})
                (path / "last_updated.txt").write_text("fixture generation")
            history.install(directory, [{"date": "2026-01-01", "ethusd": "1"}], {"currencies": {}}, marker)
            self.assertTrue((Path(directory) / "last_updated.txt").exists())


if __name__ == "__main__":
    unittest.main()
