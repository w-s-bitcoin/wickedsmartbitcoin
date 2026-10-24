"""Keep published node observations when the upstream history is rewritten.

The October 2026 upstream replacement both truncated the historical series and
changed old sample timestamps and counts. Published observations therefore form
an archive through their latest UTC day; fetched history only extends it.
"""

from datetime import date, datetime, timezone
from math import isfinite
from typing import Any, Iterable


def _timestamped_rows(
    rows: Iterable[dict[str, Any]], source: str
) -> list[tuple[float, date, dict[str, Any]]]:
    """Validate the archive boundary without changing observations or counts."""
    result = []
    for index, row in enumerate(rows):
        try:
            value = row["timestamp"]
            if isinstance(value, bool):
                raise ValueError("boolean timestamp")
            timestamp = float(value)
            if not isfinite(timestamp):
                raise ValueError("non-finite timestamp")
            day = datetime.fromtimestamp(timestamp, timezone.utc).date()
        except (KeyError, TypeError, ValueError, OverflowError, OSError) as exc:
            raise ValueError(
                f"Invalid {source} timestamp at row {index + 1}"
            ) from exc
        result.append((timestamp, day, row))
    return result


def merge_history_rows(
    published_rows: Iterable[dict[str, Any]],
    fetched_rows: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Retain published rows and append fetched observations on later UTC days.

    Timestamp seconds can change during upstream recalculation, so the archive
    cutoff includes the entire latest published UTC day. Distinct observations
    on one archived day, including samples sharing a collection second, are all
    retained. Values, missing optional counts, and row objects are preserved;
    this function neither estimates nor smooths data.

    An empty archive initializes from the fetched series. An empty fetch or an
    invalid timestamp raises instead of silently replacing a damaged archive.
    Callers remain responsible for validating the count schema before merging.
    """
    published = _timestamped_rows(published_rows, "published")
    fetched = _timestamped_rows(fetched_rows, "fetched")
    if not fetched:
        raise ValueError("Fetched node history is empty")

    if published:
        cutoff = max(day for _, day, _ in published)
        merged = published + [entry for entry in fetched if entry[1] > cutoff]
    else:
        merged = fetched
    return [row for _, _, row in sorted(merged, key=lambda entry: entry[0])]
