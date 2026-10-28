#!/usr/bin/env python3
"""Package existing block CSVs for Target & Block Hashes; no network or database.

Records are little-endian uint32 timestamps followed by the 32-byte display-order
hash. Targets/difficulty are losslessly retained at each change in the manifest.
Immutable content-addressed chunks precede the atomically replaced manifest.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import base64
import zlib
from array import array

try:
    from .build_eoe_live_reference import atomic_write, csv_rows, BLOCK_FILENAME, uint32
except ImportError:
    from build_eoe_live_reference import atomic_write, csv_rows, BLOCK_FILENAME, uint32

ROOT = Path(__file__).resolve().parents[1]
CHUNK_SIZE = 100000
RECORD = struct.Struct('<I32s')


def preview_svg(logs, epochs, records, theme):
    """A compact 640x360 card: every hash contributes to a density pixel.

    Target boundaries, exact record lows and halving points remain vector paths.
    This avoids transferring/decoding the full history merely to paint a card.
    """
    width, height, pad_x, pad_y = 640, 360, 16, 12
    pad_bottom = 6 if records[-1] == 0 else 3
    plot_w, plot_h = width - pad_x * 2, height - pad_y - pad_bottom
    end = len(logs) - 1
    max_log = max(math.log(int(e['target'], 16), 16) for e in epochs)
    min_log = logs[records[-1]]
    span = max(.001, max_log - min_log)
    x = lambda log: pad_x + (max_log - log) / span * plot_w
    y = lambda block: height - pad_bottom - block / max(1, end) * plot_h
    epoch_logs = [math.log(int(e['target'], 16), 16) for e in epochs]
    mean, epoch, low = 0, 0, 0
    for i, log in enumerate(logs):
        while epoch + 1 < len(epochs) and epochs[epoch + 1]['height'] <= i:
            epoch += 1
        if log < logs[low]:
            low = i
        mean += epoch_logs[epoch] - logs[low]
    mean = max(.00001, mean / len(logs))
    alpha = array('f', [0]) * (width * height)
    epoch = 0
    base = .025 * max((840000 - end) / 42000, 1)
    for i, log in enumerate(logs):
        while epoch + 1 < len(epochs) and epochs[epoch + 1]['height'] <= i:
            epoch += 1
        px, py = round(x(log)), round(y(i))
        offset = py * width + px
        opacity = min(1, base + .975 * (epoch_logs[epoch] - log) / mean)
        alpha[offset] += (1 - alpha[offset]) * opacity
    rgb = (191, 112, 0) if theme == 'light' else (255, 153, 0)
    scanlines = bytearray()
    for row in range(height):
        scanlines.append(0)
        for col in range(width):
            scanlines.extend((*rgb, round(alpha[row * width + col] * 255)))
    def png_chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + png_chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) + png_chunk(b'IDAT', zlib.compress(scanlines, 9)) + png_chunk(b'IEND', b'')
    bg, fg, green = ('#fff', '#171717', '#38742b') if theme == 'light' else ('#000', '#fff', '#4f913f')
    point = lambda a, b: f'{a:.3f},{b:.3f}'
    target = [point(x(epoch_logs[0]), y(0))]
    for i, e in enumerate(epochs[1:], 1):
        target.extend([point(x(epoch_logs[i - 1]), y(e['height'] - 1)), point(x(epoch_logs[i]), y(e['height']))])
    target.append(point(x(epoch_logs[-1]), y(end)))
    lowest = [point(x(logs[0]), y(0))]
    for a, b in zip(records, records[1:]):
        lowest.extend([point(x(logs[a]), y(b - 1)), point(x(logs[b]), y(b))])
    lowest.append(point(x(logs[records[-1]]), y(end)))
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
             f'<rect width="{width}" height="{height}" fill="{bg}"/>',
             f'<image width="{width}" height="{height}" href="data:image/png;base64,{base64.b64encode(png).decode()}"/>',
             f'<polyline points="{" ".join(target)}" fill="none" stroke="{fg}" stroke-width="1.5" stroke-linejoin="round"/>',
             f'<polyline points="{" ".join(lowest)}" fill="none" stroke="{green}" stroke-width=".85" stroke-dasharray="2 2"/>']
    def marker(block, star=False):
        px, py = x(logs[block]), y(block)
        count, radius = (10, 5) if star else (4, 3)
        points = []
        for i in range(count):
            angle = -math.pi / 2 + i * math.pi * 2 / count
            r = radius * .4 if star and i % 2 else radius
            points.append(point(px + math.cos(angle) * r, py + math.sin(angle) * r))
        color = green if star else '#1338be'
        parts.append(f'<polygon points="{" ".join(points)}" fill="{color}"/><circle cx="{px:.3f}" cy="{py:.3f}" r=".6" fill="#fff"/>')
    for block in range(210000, len(logs), 210000):
        marker(block)
    marker(records[-1], True)
    return (''.join(parts) + '</svg>\n').encode()


def build(source_root=ROOT, output_dir=None):
    source_root = Path(source_root)
    output = Path(output_dir) if output_dir else source_root / 'webapps/target_and_block_hashes/webapp_data'
    paths = sorted((int(m[1]), int(m[2]), p) for p in (source_root / 'assets').glob('block_data_*.csv')
                   if (m := BLOCK_FILENAME.fullmatch(p.name)))
    if not paths:
        raise ValueError('No block CSVs found')
    chunks, epochs, buffer = [], [], bytearray()
    logs, records, lowest_hash = array('d'), [], None
    expected, last_timestamp, previous = 0, 0, None

    def flush():
        if not buffer:
            return
        digest = hashlib.sha256(buffer).hexdigest()
        count = len(buffer) // RECORD.size
        filename = f'{expected-count}-{digest[:20]}.bin'
        atomic_write(output / filename, buffer)
        chunks.append(dict(start=expected-count, count=count, path=filename, sha256=digest))
        buffer.clear()

    for lower, upper, path in paths:
        for line, values in csv_rows(path, ('block_height', 'timestamp', 'block_hash', 'difficulty', 'target')):
            h, ts, block_hash, difficulty_text, target = values
            label = f'{path.name}:{line}'
            height, timestamp = uint32(h, label), uint32(ts, label, positive=True)
            difficulty = float(difficulty_text)
            if height != expected or not lower <= height <= upper:
                raise ValueError(f'{label}: blocks must be contiguous from genesis and inside shard bounds')
            if not all(re.fullmatch('[0-9a-f]{64}', v) for v in (block_hash, target)):
                raise ValueError(f'{label}: invalid hash or target')
            if not math.isfinite(difficulty) or difficulty < 1 or not 0 < int(block_hash, 16) <= int(target, 16):
                raise ValueError(f'{label}: invalid difficulty or proof of work')
            if previous != (difficulty, target):
                epochs.append(dict(height=height, difficulty=difficulty, target=target))
                previous = difficulty, target
            logs.append(math.log(int(block_hash, 16), 16))
            if lowest_hash is None or block_hash < lowest_hash:
                lowest_hash = block_hash
                records.append(height)
            buffer.extend(RECORD.pack(timestamp, bytes.fromhex(block_hash)))
            expected += 1
            last_timestamp = timestamp
            if expected % CHUNK_SIZE == 0:
                flush()
    flush()
    if not expected:
        raise ValueError('Block history is empty')
    previews = {}
    for theme in ('dark', 'light'):
        svg = preview_svg(logs, epochs, records, theme)
        digest = hashlib.sha256(svg).hexdigest()
        filename = f'preview-{theme}-{digest[:20]}.svg'
        atomic_write(output / filename, svg)
        previews[theme] = dict(path=filename, sha256=digest, bytes=len(svg))
    payload = dict(schema_version=1, record_bytes=RECORD.size, count=expected,
                   last_timestamp=last_timestamp, chunks=chunks, epochs=epochs, previews=previews)
    # Signature covers every chunk, target, difficulty and source timestamp.
    payload['signature'] = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    atomic_write(output / 'manifest.json', (json.dumps(payload, separators=(',', ':')) + '\n').encode())
    return payload


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=ROOT)
    parser.add_argument('--output-dir', type=Path)
    args = parser.parse_args()
    result = build(args.source_root, args.output_dir)
    print(f"Built Target & Block Hashes: {result['count']:,} blocks in {len(result['chunks'])} verified chunks")
