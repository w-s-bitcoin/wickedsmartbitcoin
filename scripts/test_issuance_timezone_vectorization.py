#!/usr/bin/env python3
"""Check vectorized issuance dates against the original calendar behavior."""

from __future__ import annotations

import importlib.util
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo


SCRIPT = Path(__file__).resolve().parents[1] / "webapps/issuance_rate/issuance_rate_webapp_data_update.py"
spec = importlib.util.spec_from_file_location("issuance_updater", SCRIPT)
updater = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(updater)


def original_rows(heights: list[int], timestamps: list[int], end_date: datetime):
    """Independent reference for the producer's previous Python date loop."""
    result = {}
    for zone_name in updater.TIME_ZONE_OPTIONS:
        zone = ZoneInfo(zone_name)
        counts = {}
        end_heights = {}
        for height, timestamp in zip(heights, timestamps):
            day = datetime.fromtimestamp(timestamp, tz=timezone.utc).astimezone(zone).date().isoformat()
            counts[day] = counts.get(day, 0) + 1
            end_heights[day] = height

        rows = {}
        previous_height = 0
        day = updater.GENESIS_DATE.date()
        while day <= end_date.date():
            key = day.isoformat()
            height = end_heights.get(key, previous_height)
            supply = updater.bitcoin_supply(height)
            issuance = 0.0 if height <= previous_height else updater.bitcoin_supply(height) - updater.bitcoin_supply(previous_height)
            subsidy = updater.subsidy_for_epoch(height // updater.HALVING_INTERVAL + 1)
            target = updater.TARGET_BLOCKS_PER_DAY * subsidy
            rows[key] = [
                counts.get(key, 0),
                round(issuance, 8),
                round(target, 8),
                round(0.0 if supply <= 0 else issuance * 365 / supply, 10),
                round(0.0 if supply <= 0 else target * 365 / supply, 10),
            ]
            previous_height = height
            day += timedelta(days=1)
        result[zone_name] = rows
    return result


def utc_timestamp(year, month, day, hour=0, minute=0):
    return int(datetime(year, month, day, hour, minute, tzinfo=timezone.utc).timestamp())


class TimeZoneVectorizationTests(unittest.TestCase):
    def check_case(self, start, end, heights, timestamps):
        zones = ["UTC", "Etc/GMT+12", "America/New_York", "Europe/Berlin", "Australia/Sydney", "Pacific/Kiritimati"]
        with patch.object(updater, "GENESIS_DATE", start), patch.object(updater, "TIME_ZONE_OPTIONS", zones):
            self.assertEqual(
                updater.build_time_zone_daily_rows(heights, timestamps, end),
                original_rows(heights, timestamps, end),
            )

    def test_empty_chain(self):
        self.check_case(datetime(2009, 1, 3, tzinfo=timezone.utc), datetime(2009, 1, 5, tzinfo=timezone.utc), [], [])

    def test_genesis_boundaries_and_out_of_order_block_times(self):
        self.check_case(
            datetime(2009, 1, 3, tzinfo=timezone.utc),
            datetime(2009, 1, 5, tzinfo=timezone.utc),
            [0, 1, 2, 3],
            [utc_timestamp(2009, 1, 3, 18), utc_timestamp(2009, 1, 3, 23, 50),
             utc_timestamp(2009, 1, 4, 0, 30), utc_timestamp(2009, 1, 3, 23, 55)],
        )

    def test_spring_and_fall_dst(self):
        for month, start_day, end_day in [(3, 9, 12), (11, 2, 5)]:
            with self.subTest(month=month):
                self.check_case(
                    datetime(2024, month, start_day, tzinfo=timezone.utc),
                    datetime(2024, month, end_day, tzinfo=timezone.utc),
                    [830_000, 830_001, 830_002, 830_003],
                    [utc_timestamp(2024, month, start_day, 23, 30),
                     utc_timestamp(2024, month, start_day + 1, 6, 30),
                     utc_timestamp(2024, month, start_day + 1, 7, 30),
                     utc_timestamp(2024, month, start_day + 1, 23, 30)],
                )

    def test_zip_length_behavior(self):
        self.check_case(
            datetime(2024, 1, 1, tzinfo=timezone.utc),
            datetime(2024, 1, 3, tzinfo=timezone.utc),
            [800_000, 800_001, 800_002],
            [utc_timestamp(2024, 1, 1, 12), utc_timestamp(2024, 1, 2, 12)],
        )


if __name__ == "__main__":
    unittest.main()
