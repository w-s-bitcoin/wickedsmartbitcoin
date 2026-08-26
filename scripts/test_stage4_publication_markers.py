#!/usr/bin/env python3
"""Validate the Stage 4 Casascius and daily-price publication boundaries."""

from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts import sync_main_data_to_dev as syncer


def validate_daily_price() -> None:
    data = (ROOT / syncer.DAILY_PRICE_PATH).read_bytes()
    marker = (ROOT / syncer.DAILY_PRICE_MARKER_PATH).read_bytes()
    assert marker == syncer.build_daily_price_publication_marker(data)


def validate_casascius() -> None:
    tracker = (ROOT / syncer.CASASCIUS_TRACKER_PATH).read_bytes()
    right_panel = (ROOT / syncer.CASASCIUS_RIGHT_PANEL_PATH).read_bytes()
    assert right_panel == syncer.build_casascius_right_panel_marker(tracker, right_panel)


if __name__ == "__main__":
    validate_daily_price()
    validate_casascius()
    print("Stage 4 publication markers are coherent.")
