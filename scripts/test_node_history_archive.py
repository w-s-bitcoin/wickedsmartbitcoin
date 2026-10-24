"""Node history reconciliation regressions; no network or producer execution."""

from copy import deepcopy
from datetime import datetime, timezone
import unittest

from webapps.node_count.node_history_archive import merge_history_rows


def observation(instant, knots=None, **fields):
    timestamp = int(datetime.fromisoformat(instant).replace(tzinfo=timezone.utc).timestamp())
    return {"timestamp": str(timestamp), "knots_count": knots, **fields}


class NodeHistoryArchiveTests(unittest.TestCase):
    def test_truncated_rewritten_feed_preserves_complete_published_rows(self):
        published = [
            observation("2017-04-27T23:06:00", "", listening="7449"),
            observation("2025-11-25T00:00:03", "19892", total_count="90000"),
            observation("2026-10-22T00:00:04", "13040", total_count="102386"),
        ]
        fetched = [
            observation("2025-11-25T00:00:00", "97298", total_count="160000"),
            observation("2026-10-22T00:00:00", "14057", total_count="96902"),
            observation("2026-10-23T00:00:00", "13764", total_count="96505"),
        ]
        before = deepcopy((published, fetched))

        merged = merge_history_rows(published, fetched)

        self.assertEqual(merged, published + [fetched[-1]])
        for actual, original in zip(merged, published + [fetched[-1]]):
            self.assertIs(actual, original)
        self.assertEqual((published, fetched), before)

    def test_distinct_observations_on_same_published_day_survive(self):
        first = observation("2026-04-28T00:00:04", "24000")
        second = observation("2026-04-28T12:00:00", "47445")
        fetched = [
            observation("2026-04-28T00:00:00", "90000"),
            observation("2026-04-28T23:59:59", "91000"),
            observation("2026-04-29T00:00:00", "25000"),
        ]

        self.assertEqual(
            merge_history_rows([second, first], fetched),
            [first, second, fetched[-1]],
        )

    def test_new_days_append_in_timestamp_order_without_filling_missing_counts(self):
        published = [observation("2026-10-22T23:59:59", "13040")]
        newest = observation("2026-10-24T00:00:00", "13838", bip110_count="")
        next_day = observation("2026-10-23T00:00:00", None)
        next_day.pop("knots_count")
        # The timestamp defines the UTC cutoff, even if a stale date field disagrees.
        same_day = observation("2026-10-22T12:00:00", "99999", date="2099-01-01")

        merged = merge_history_rows(published, [newest, same_day, next_day])

        self.assertEqual(merged, published + [next_day, newest])
        self.assertNotIn("knots_count", merged[1])
        self.assertEqual(merged[2]["bip110_count"], "")

    def test_replaying_same_fetch_is_idempotent(self):
        published = [observation("2026-10-22T00:00:04", "13040")]
        fetched = [
            observation("2026-10-22T00:00:00", "14057"),
            observation("2026-10-23T00:00:00", "13764"),
            observation("2026-10-24T00:00:00", "13838"),
        ]
        first = merge_history_rows(published, fetched)
        self.assertEqual(merge_history_rows(first, fetched), first)

    def test_shorter_feed_does_not_remove_or_regress_published_history(self):
        published = [
            observation("2026-10-22T00:00:04", "13040"),
            observation("2026-10-23T00:00:00", "13764"),
        ]
        fetched = [observation("2026-10-22T00:00:00", "90000")]
        self.assertEqual(merge_history_rows(published, fetched), published)

    def test_empty_baseline_initializes_from_sorted_fetched_observations(self):
        earlier = observation("2026-10-22T00:00:00", None)
        later = observation("2026-10-23T00:00:00", "13764")
        self.assertEqual(merge_history_rows([], [later, earlier]), [earlier, later])

    def test_empty_fetch_fails_even_with_published_observations(self):
        for published in ([], [observation("2026-10-22T00:00:04", "13040")]):
            with self.subTest(published=published):
                with self.assertRaisesRegex(ValueError, "Fetched node history is empty"):
                    merge_history_rows(published, [])

    def test_malformed_published_timestamp_never_falls_back_to_fetched_history(self):
        fetched = [observation("2026-10-23T00:00:00", "13764")]
        invalid_rows = [
            {},
            {"timestamp": None},
            {"timestamp": True},
            {"timestamp": "not-a-timestamp"},
            {"timestamp": "nan"},
            {"timestamp": float("inf")},
            {"timestamp": "1e100"},
        ]
        for invalid in invalid_rows:
            with self.subTest(invalid=invalid):
                with self.assertRaisesRegex(ValueError, "Invalid published timestamp"):
                    merge_history_rows([invalid], fetched)

    def test_equal_timestamps_preserve_all_published_and_new_observations(self):
        published = [
            {"timestamp": "1792627204", "knots_count": "13040"},
            {"timestamp": 1792627204, "knots_count": "14057"},
        ]
        fetched = [
            observation("2026-10-23T00:00:00", "13764"),
            observation("2026-10-23T00:00:00", "13765"),
        ]
        self.assertEqual(merge_history_rows(published, fetched), published + fetched)

    def test_invalid_fetched_timestamp_is_rejected(self):
        published = [observation("2026-10-22T00:00:04", "13040")]
        with self.assertRaisesRegex(ValueError, "Invalid fetched timestamp"):
            merge_history_rows(published, [{"timestamp": "nan"}])


if __name__ == "__main__":
    unittest.main()
