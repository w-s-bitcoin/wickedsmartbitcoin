#!/usr/bin/env python3
"""Rebuild generated static assets used by casascius_explorer.html."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STEPS = [
    ("embedded face data", [sys.executable, "scripts/update_casascius_data_images.py"]),
    ("all-mode atlas images", [sys.executable, "scripts/generate_all_atlas.py"]),
    ("right panel summary data", [sys.executable, "scripts/generate_right_panel_data.py"]),
]


def main() -> int:
    for label, command in STEPS:
        print(f"==> Rebuilding {label}")
        subprocess.run(command, cwd=ROOT, check=True)
    print("Static assets rebuilt.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
