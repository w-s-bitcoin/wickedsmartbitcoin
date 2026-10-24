#!/usr/bin/env python3
"""Build compact EOE reference chunks from existing CSVs; never query a service.

Each 16-byte little-endian record is (block UTC seconds, matched price UTC
seconds, float64 USD/BTC). Height is chunk.start + record offset. A zero matched
timestamp and zero price mean unavailable; a nonzero timestamp with zero price
retains the source's unvalued history. Nearest-time ties choose the earlier row.
"""

from array import array
from bisect import bisect_left
import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
CHUNK_SIZE = 4096
RECORD = struct.Struct("<IId")
MAX_UINT32 = 2**32 - 1
BLOCK_FILENAME = re.compile(r"block_data_(\d+)_(\d+)\.csv\Z")


def csv_rows(path, required):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.reader(stream)
        headers = next(reader, [])
        if len(headers) != len(set(headers)) or not set(required).issubset(headers):
            raise ValueError(f"{path.name}: missing or duplicate required columns")
        columns = [headers.index(name) for name in required]
        for line, row in enumerate(reader, 2):
            if len(row) != len(headers):
                raise ValueError(f"{path.name}:{line}: invalid CSV field count")
            yield line, [row[column].strip() for column in columns]


def uint32(text, label, *, positive=False):
    if not re.fullmatch(r"\d+", text):
        raise ValueError(f"{label}: invalid integer")
    value = int(text)
    if value > MAX_UINT32 or (positive and value == 0):
        raise ValueError(f"{label}: integer outside supported range")
    return value


def read_prices(path):
    timestamps, prices = array("I"), array("d")
    for line, (timestamp_text, price_text, height_text) in csv_rows(path, ("timestamp", "price", "price_height")):
        label = f"{path.name}:{line}"
        timestamp = uint32(timestamp_text, label, positive=True)
        uint32(height_text, label)
        try:
            price = float(price_text)
        except ValueError as exc:
            raise ValueError(f"{label}: invalid price") from exc
        if not math.isfinite(price) or price < 0:
            raise ValueError(f"{label}: price must be finite and nonnegative")
        if timestamps and timestamp <= timestamps[-1]:
            raise ValueError(f"{label}: price timestamps must be unique and increasing")
        timestamps.append(timestamp)
        prices.append(price)
    if not timestamps:
        raise ValueError(f"{path.name}: price history is empty")
    return timestamps, prices


def nearest_price(timestamp, timestamps, prices):
    if timestamp < timestamps[0] or timestamp > timestamps[-1]:
        return 0, 0.0
    index = bisect_left(timestamps, timestamp)
    if index and timestamp - timestamps[index - 1] <= timestamps[index] - timestamp:
        index -= 1
    return timestamps[index], prices[index]


def atomic_write(path, payload):
    if path.exists() and path.read_bytes() == payload:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def build_reference(source_root=ROOT, output_dir=None):
    source_root = Path(source_root)
    output_dir = Path(output_dir) if output_dir is not None else source_root / "webapps/eoe_growth/webapp_data/reference"
    assets = source_root / "assets"
    timestamps, prices = read_prices(assets / "btcusd_10m_prices.csv")
    paths = []
    for path in assets.glob("block_data_*_*.csv"):
        match = BLOCK_FILENAME.fullmatch(path.name)
        if match:
            lower, upper = map(int, match.groups())
            if lower > upper:
                raise ValueError(f"{path.name}: invalid shard bounds")
            paths.append((lower, upper, path))
    if not paths:
        raise ValueError("No block_data_<first>_<last>.csv source files were found")

    chunks, buffer = [], bytearray()
    first_height = previous_height = chunk_start = None

    def flush_chunk():
        if not buffer:
            return
        digest = hashlib.sha256(buffer).hexdigest()
        filename = f"{chunk_start}-{digest[:16]}.bin"
        atomic_write(output_dir / filename, buffer)
        chunks.append({"start": chunk_start, "count": len(buffer) // RECORD.size,
                       "path": filename, "sha256": digest})
        buffer.clear()

    for lower, upper, path in sorted(paths):
        for line, (height_text, timestamp_text) in csv_rows(path, ("block_height", "timestamp")):
            label = f"{path.name}:{line}"
            height = uint32(height_text, label)
            timestamp = uint32(timestamp_text, label, positive=True)
            if not lower <= height <= upper:
                raise ValueError(f"{label}: block height is outside its shard bounds")
            if previous_height is not None and height != previous_height + 1:
                raise ValueError(f"{label}: block heights must be contiguous, unique, and increasing")
            if first_height is None:
                first_height = height
            if chunk_start is None or height // CHUNK_SIZE != chunk_start // CHUNK_SIZE:
                flush_chunk()
                chunk_start = height
            price_timestamp, price = nearest_price(timestamp, timestamps, prices)
            buffer.extend(RECORD.pack(timestamp, price_timestamp, price))
            previous_height = height
    if first_height is None:
        raise ValueError("Block history is empty")
    flush_chunk()
    manifest = {"schema_version": 1, "chunk_size": CHUNK_SIZE, "record_bytes": RECORD.size,
                "first_height": first_height, "last_height": previous_height, "chunks": chunks}
    # Immutable payloads precede the only mutable pointer. Failed source
    # validation leaves the prior complete manifest and its chunks available.
    atomic_write(output_dir / "manifest.json",
                 (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8"))
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=ROOT,
                        help="repository root containing existing assets/*.csv")
    parser.add_argument("--output-dir", type=Path,
                        help="default: <source-root>/webapps/eoe_growth/webapp_data/reference")
    args = parser.parse_args()
    started = time.monotonic()
    try:
        manifest = build_reference(args.source_root, args.output_dir)
    except (OSError, ValueError, csv.Error) as exc:
        parser.exit(1, f"EOE reference build failed: {exc}\n")
    count = manifest["last_height"] - manifest["first_height"] + 1
    print(f"Built EOE reference: {count:,} blocks, {len(manifest['chunks'])} chunks, "
          f"{count * RECORD.size:,} binary bytes in {time.monotonic() - started:.2f}s")


if __name__ == "__main__":
    main()
