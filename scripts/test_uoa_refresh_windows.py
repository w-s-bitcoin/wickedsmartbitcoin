#!/usr/bin/env python3

import csv
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from webapps.uoa import uoa_webapp_data_update as updater


class CupRequestTests(unittest.TestCase):
    def response(self, data):
        response = Mock()
        response.json.return_value = data
        return response

    def test_normal_refresh_requests_three_months_with_short_timeout(self):
        response = self.response([{"_id": "2026-11-14", "median": 910}])
        with patch.object(updater.requests, "get", return_value=response) as get:
            self.assertEqual(updater.fetch_cup_informal_usd_rates(), [("2026-11-14", 1 / 910)])
        get.assert_called_once_with(updater.CUP_INFORMAL_API_URL,
                                    params={"trmi": "true", "period": "3M", "cur": "USD"},
                                    timeout=20)
        response.raise_for_status.assert_called_once()

    def test_timeout_http_and_invalid_payload_retry_one_month(self):
        http_failure = self.response([])
        http_failure.raise_for_status.side_effect = RuntimeError("HTTP 503")
        for failure in [TimeoutError(), http_failure, self.response({}), self.response([]),
                        self.response([{"_id": "2026-11-14", "median": float("nan")}])]:
            with self.subTest(failure=failure):
                with patch.object(updater.requests, "get", side_effect=[
                    failure, self.response([{"_id": "2026-11-14", "median": 910}])
                ]) as get:
                    self.assertEqual(updater.fetch_cup_informal_usd_rates(), [("2026-11-14", 1 / 910)])
                self.assertEqual([call.kwargs["params"]["period"] for call in get.call_args_list],
                                 ["3M", "1M"])
                self.assertEqual([call.kwargs["timeout"] for call in get.call_args_list], [20, 20])

    def test_both_failures_propagate_after_two_requests(self):
        with patch.object(updater.requests, "get", side_effect=TimeoutError) as get:
            with self.assertRaises(TimeoutError):
                updater.fetch_cup_informal_usd_rates()
        self.assertEqual(get.call_count, 2)

    def test_explicit_one_month_request_does_not_retry_same_window(self):
        with patch.object(updater.requests, "get", side_effect=TimeoutError) as get:
            with self.assertRaises(TimeoutError):
                updater.fetch_cup_informal_usd_rates(period="1M")
        self.assertEqual(get.call_count, 1)

    def test_parser_sorts_deduplicates_and_rejects_invalid_observations(self):
        valid = [{"_id": "2026-11-14", "median": 910},
                 {"date": "2026-11-13", "median": 900},
                 {"_id": "2026-11-14", "median": 910}]
        invalid = [None, {}, {"_id": "2026-02-30", "median": 910}]
        invalid.extend({"_id": "2026-11-12", "median": value}
                       for value in [True, 0, -1, float("nan"), float("inf"), "910"])
        self.assertEqual(updater.parse_cup_informal_usd_rates(valid + invalid),
                         [("2026-11-13", 1 / 900), ("2026-11-14", 1 / 910)])
        with self.assertRaises(ValueError):
            updater.parse_cup_informal_usd_rates(invalid)
        with self.assertRaises(ValueError):
            updater.parse_cup_informal_usd_rates(valid + [{"_id": "2026-11-14", "median": 920}])


@unittest.skipIf(updater.pd is None, "pandas is required for UOA refresh-window tests")
class UoaRefreshWindowTests(unittest.TestCase):
    def test_terminal_weekend_is_filled_from_refreshed_friday(self):
        frame = updater.pd.DataFrame(
            {
                "date": [
                    "2026-08-19",
                    "2026-08-20",
                    "2026-08-21",
                    "2026-08-22",
                    "2026-08-23",
                    "2026-08-24",
                ],
                # Reproduce the stale value previously carried from the old
                # end of the dataset into every newly appended calendar row.
                "xauusd": [4054.66] * 6,
                "unavailableusd": [1.0, 1.1, 1.2, 1.3, 1.4, 1.5],
            }
        )
        refresh_map = {
            "xauusd": {
                "2026-08-19": 4389.09,
                "2026-08-20": 4435.71,
                "2026-08-21": 4497.42,
                "2026-08-24": 4580.10,
            }
        }

        refreshed = updater.replace_refreshed_rate_windows(
            frame,
            refresh_map,
            {"xauusd": "2026-08-19"},
        )

        self.assertTrue(updater.pd.isna(refreshed.loc[3, "xauusd"]))
        self.assertTrue(updater.pd.isna(refreshed.loc[4, "xauusd"]))
        refreshed["xauusd"] = refreshed["xauusd"].ffill()
        self.assertEqual(
            refreshed["xauusd"].tolist(),
            [4389.09, 4435.71, 4497.42, 4497.42, 4497.42, 4580.10],
        )
        # A source that did not refresh must not be cleared or rewritten.
        self.assertEqual(
            refreshed["unavailableusd"].tolist(),
            frame["unavailableusd"].tolist(),
        )

    def test_rows_before_the_refresh_window_are_preserved(self):
        frame = updater.pd.DataFrame(
            {
                "date": ["2026-08-18", "2026-08-19", "2026-08-20"],
                "xauusd": [4394.21, 4000.0, 4000.0],
            }
        )

        refreshed = updater.replace_refreshed_rate_windows(
            frame,
            {"xauusd": {"2026-08-20": 4435.71}},
            {"xauusd": "2026-08-20"},
        )

        self.assertEqual(refreshed["xauusd"].tolist(), [4394.21, 4000.0, 4435.71])

    def test_cup_informal_rate_carries_into_unreported_day(self):
        frame = updater.pd.DataFrame({
            "date": ["2026-10-01", "2026-10-02", "2026-10-03"],
            "cupusd": [0.04167, 0.04167, 0.04167],
            "eurusd": [1.1, 1.2, 1.3],
        })
        rates = [("2026-10-01", 1 / 760), ("2026-10-02", 1 / 770)]
        with patch.object(updater, "fetch_cup_informal_usd_rates", return_value=rates):
            refreshed, count, start, end = updater.apply_cup_informal_rates(frame)
        self.assertEqual(refreshed["cupusd"].tolist(), [1 / 760, 1 / 770, 1 / 770])
        self.assertEqual(refreshed["eurusd"].tolist(), [1.1, 1.2, 1.3])
        self.assertEqual((count, start, end), (2, "2026-10-01", "2026-10-02"))

    def test_cup_source_failure_repairs_recent_official_rate_tail(self):
        existing = updater.pd.DataFrame({
            "date": ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"],
            "cupusd": [1 / 760, 1 / 770, 0.04167, 0.04167],
        })
        restored = updater.restore_existing_cup_rates(existing, existing)
        self.assertEqual(restored["cupusd"].tolist(),
                         [1 / 760, 1 / 770, 1 / 770, 1 / 770])

    def test_short_fallback_preserves_informal_history_before_response_window(self):
        dates = updater.pd.date_range("2026-10-01", "2026-11-15").strftime("%Y-%m-%d")
        frame = updater.pd.DataFrame({"date": dates, "cupusd": 1 / 24, "eurusd": 1.2})
        existing = frame.iloc[:-2].copy()
        existing["cupusd"] = 1 / 800
        response = Mock()
        response.json.return_value = [{"_id": "2026-10-15", "median": 850},
                                      {"_id": "2026-11-14", "median": 910}]
        with patch.object(updater.requests, "get", side_effect=[TimeoutError(), response]):
            refreshed, count, start, end = updater.apply_cup_informal_rates_best_effort(frame, existing)
        self.assertEqual(refreshed["cupusd"].tolist(), [1 / 800] * 14 + [1 / 850] * 30 + [1 / 910] * 2)
        self.assertEqual((count, start, end), (2, "2026-10-15", "2026-11-14"))
        updater.pd.testing.assert_frame_equal(refreshed.drop(columns="cupusd"), frame.drop(columns="cupusd"))

    def test_failed_requests_preserve_and_carry_last_published_informal_rate(self):
        frame = updater.pd.DataFrame({"date": ["2026-11-12", "2026-11-13", "2026-11-14"],
                                      "cupusd": [1 / 24] * 3, "eurusd": [1.1, 1.2, 1.3]})
        existing = frame.iloc[:2].copy()
        existing["cupusd"] = [1 / 900, 1 / 910]
        with patch.object(updater.requests, "get", side_effect=TimeoutError):
            refreshed, count, start, end = updater.apply_cup_informal_rates_best_effort(frame, existing)
        self.assertEqual(refreshed["cupusd"].tolist(), [1 / 900, 1 / 910, 1 / 910])
        self.assertEqual((count, start, end), (0, None, None))
        updater.pd.testing.assert_frame_equal(refreshed.drop(columns="cupusd"), frame.drop(columns="cupusd"))

    def test_cup_only_repairs_staged_tail_when_source_is_down(self):
        with tempfile.TemporaryDirectory(prefix="wsb-cup-tail-") as directory:
            data_dir = Path(directory)
            with (data_dir / "daily_fx_rates.csv").open("w", newline="") as stream:
                writer = csv.writer(stream)
                writer.writerow(["date", "cupusd", "eurusd"])
                writer.writerow(["2026-10-01", str(1 / 760), "1.1"])
                writer.writerow(["2026-10-02", str(1 / 770), "1.2"])
                writer.writerow(["2026-10-03", "0.04167", "1.3"])
            (data_dir / "uoa_pairs.json").write_text(json.dumps({"pairs": []}))
            (data_dir / "last_updated.txt").write_text("old marker\n")
            with patch.object(updater, "output_data_dir", return_value=data_dir), \
                    patch.object(updater, "fetch_cup_informal_usd_rates", side_effect=TimeoutError):
                updater.refresh_cup_only()
            with (data_dir / "daily_fx_rates.csv").open(newline="") as stream:
                rows = list(csv.DictReader(stream))
            self.assertEqual(float(rows[-1]["cupusd"]), 1 / 770)
            self.assertEqual([row["eurusd"] for row in rows], ["1.1", "1.2", "1.3"])
            self.assertNotEqual((data_dir / "last_updated.txt").read_text(), "old marker\n")


if __name__ == "__main__":
    unittest.main()
