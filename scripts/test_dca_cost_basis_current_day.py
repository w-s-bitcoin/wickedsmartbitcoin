#!/usr/bin/env python3
"""Check that an intraday snapshot keeps the prior completed purchase day."""

import tempfile
from pathlib import Path
import sys

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from webapps.dca_cost_basis.dca_cost_basis_webapp_data_update import (
    compute_duration_series,
    load_price_history,
)


def check(rows, expected_dates):
    with tempfile.TemporaryDirectory(prefix="wsb-dca-day-") as directory:
        source = Path(directory) / "price.csv"
        pd.DataFrame(rows).to_csv(source, index=False)
        history, snapshot = load_price_history(source, "2026-09-26")
        assert history["date_iso"].tolist() == expected_dates
        assert snapshot["date_iso"] == expected_dates[-1]
        daily = compute_duration_series(
            history, pd.Series(True, index=history.index), 1,
            latest_snapshot=snapshot, use_current_price_for_one_day=True,
        )
        assert daily["date_iso"].tolist() == expected_dates
        return daily


def main():
    completed = [
        {"timestamp": "2026-09-26T23:59:00Z", "price": 100, "block_height": 1, "eod_utc": True},
        {"timestamp": "2026-09-27T23:59:00Z", "price": 200, "block_height": 2, "eod_utc": True},
    ]
    intraday = {"timestamp": "2026-09-28T12:00:00Z", "price": 400,
                "block_height": 3, "eod_utc": False}
    daily = check(completed + [intraday], ["2026-09-26", "2026-09-27", "2026-09-28"])
    assert abs(daily.iloc[1]["dca_basis"] - 2 / (1 / 200 + 1 / 400)) < 1e-8
    assert daily.iloc[1]["purchase_count"] == 2

    same_day = {"timestamp": "2026-09-27T23:59:30Z", "price": 250,
                "block_height": 4, "eod_utc": False}
    daily = check(completed + [same_day], ["2026-09-26", "2026-09-27"])
    assert daily.iloc[-1]["historical_price"] == 250
    print("DCA current-day source continuity passed.")


if __name__ == "__main__":
    main()
