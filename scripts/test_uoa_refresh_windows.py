#!/usr/bin/env python3

import csv
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from webapps.uoa import uoa_webapp_data_update as updater


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
