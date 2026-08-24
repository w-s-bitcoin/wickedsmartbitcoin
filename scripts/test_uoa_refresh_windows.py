#!/usr/bin/env python3

import unittest

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


if __name__ == "__main__":
    unittest.main()
