#!/usr/bin/env python3
"""Render All Coins & Bars atlas PNGs and hitmap metadata with browser canvas."""

from __future__ import annotations

import json
import importlib.util
import re
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "casascius_explorer.js"
DATA_SOURCE = ROOT / "assets" / "casascius_data.js"
ASSET_DIR = ROOT / "assets"
CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
PIXELS_PER_MM = 12
MODES = {
    "front": "all_front.png",
    "back": "all_back.png",
    "hologram": "all_hologram.png",
}


def load_image_file_map() -> dict[str, tuple[str, str]]:
    module_path = ROOT / "scripts" / "update_casascius_data_images.py"
    spec = importlib.util.spec_from_file_location("update_casascius_data_images", module_path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"Could not load image map from {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.IMAGE_FILES


def load_source_data() -> tuple[list[dict], dict]:
    data_text = DATA_SOURCE.read_text()
    coins_match = re.search(r"^const COINS = (\[.*?\]);$", data_text, re.M)
    if not coins_match:
        raise SystemExit("Could not locate COINS array")
    coins = json.loads(coins_match.group(1))

    text = SOURCE.read_text()
    packing_block = re.search(r"const ALL_ITEMS_PACKING = \{(.*?)\n  \};", text, re.S)
    if not packing_block:
        raise SystemExit("Could not locate ALL_ITEMS_PACKING")
    block = packing_block.group(1)
    width = float(re.search(r"widthMm:\s*([\d.]+)", block).group(1))
    height = float(re.search(r"heightMm:\s*([\d.]+)", block).group(1))
    items = [
        {"slug": slug, "x": float(x), "y": float(y)}
        for slug, x, y in re.findall(r"\{\s*slug:\s*'([^']+)'\s*,\s*x:\s*([-\d.]+)\s*,\s*y:\s*([-\d.]+)\s*\}", block)
    ]
    image_files = load_image_file_map()
    for coin in coins:
        slug = coin.get("slug")
        if slug not in image_files:
            raise SystemExit(f"No source image mapping for {slug}")
        front, back = image_files[slug]
        coin["frontData"] = (ROOT / "coins_and_bars" / front).as_uri()
        coin["backData"] = (ROOT / "coins_and_bars" / back).as_uri()

    return coins, {"widthMm": width, "heightMm": height, "items": items}



def color_for_index(index: int) -> tuple[int, int, int]:
    value = index + 1
    return value & 255, (value >> 8) & 255, (value >> 16) & 255


def render_html(coins: list[dict], packing: dict) -> str:
    payload = {
        "coins": coins,
        "packing": packing,
        "pixelsPerMm": PIXELS_PER_MM,
    }
    return f"""<!doctype html>
<meta charset="utf-8">
<style>
html, body {{
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
}}
canvas {{
  display: block;
}}
</style>
<canvas id="atlas"></canvas>
<script>
const payload = {json.dumps(payload)};
const mode = new URLSearchParams(location.search).get('mode') || 'front';
const coinBySlug = new Map(payload.coins.map(coin => [coin.slug, coin]));
const width = Math.ceil(payload.packing.widthMm * payload.pixelsPerMm);
const height = Math.ceil(payload.packing.heightMm * payload.pixelsPerMm);
const canvas = document.getElementById('atlas');
canvas.width = width;
canvas.height = height;

function loadImage(src) {{
  return new Promise((resolve, reject) => {{
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  }});
}}

function colorForIndex(index) {{
  const n = index + 1;
  return `rgb(${{n & 255}}, ${{(n >> 8) & 255}}, ${{(n >> 16) & 255}})`;
}}

function itemSize(coin) {{
  if (coin.shape === 'bar') {{
    return {{ w: Number(coin.widthMm || 40) * payload.pixelsPerMm, h: Number(coin.heightMm || 80) * payload.pixelsPerMm }};
  }}
  const size = Number(coin.diameterMm || 28) * payload.pixelsPerMm;
  return {{ w: size, h: size }};
}}

function atlasImage(coin) {{
  if (mode === 'back') return coin.backData || coin.frontData;
  if (mode === 'hologram') return coin.shape === 'bar' ? coin.frontData : (coin.backData || coin.frontData);
  return coin.frontData;
}}

function drawRoundedClip(ctx, x, y, w, h, radius) {{
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}}

(async () => {{
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, width, height);
  for (let index = 0; index < payload.packing.items.length; index++) {{
    const packed = payload.packing.items[index];
    const coin = coinBySlug.get(packed.slug);
    if (!coin) continue;
    const size = itemSize(coin);
    const x = width / 2 + packed.x * payload.pixelsPerMm - size.w / 2;
    const y = height / 2 + packed.y * payload.pixelsPerMm - size.h / 2;
    const radius = coin.shape === 'bar' ? Math.max(8, Math.min(size.w, size.h) * 0.08) : size.w / 2;
    ctx.save();
    const shouldClip = coin.shape === 'bar' || mode === 'hitmap';
    if (shouldClip) {{
      drawRoundedClip(ctx, x, y, size.w, size.h, radius);
      ctx.clip();
    }}
    if (mode === 'hitmap') {{
      ctx.fillStyle = colorForIndex(index);
      ctx.fillRect(x, y, size.w, size.h);
    }} else {{
      const img = await loadImage(atlasImage(coin));
      ctx.drawImage(img, x, y, size.w, size.h);
    }}
    ctx.restore();
  }}
  document.body.dataset.ready = 'true';
}})().catch(error => {{
  document.body.dataset.error = String(error && error.stack || error);
}});
</script>
"""


def chrome_screenshot(html_uri: str, output: Path, mode: str, width: int, height: int, profile: Path) -> None:
    command = [
        str(CHROME),
        "--headless=new",
        "--disable-gpu",
        "--default-background-color=00000000",
        f"--user-data-dir={profile}-{mode}",
        f"--window-size={width},{height}",
        "--virtual-time-budget=12000",
        f"--screenshot={output}",
        f"{html_uri}?mode={mode}",
    ]
    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=75,
        )
    except subprocess.TimeoutExpired as error:
        if output.exists() and output.stat().st_size > 0:
            return
        raise SystemExit(f"Chrome timed out while rendering {mode}: {error}") from error
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        raise SystemExit(result.returncode)


def main() -> int:
    if not CHROME.exists():
        raise SystemExit(f"Chrome not found: {CHROME}")
    coins, packing = load_source_data()
    width = int(packing["widthMm"] * PIXELS_PER_MM + 0.999)
    height = int(packing["heightMm"] * PIXELS_PER_MM + 0.999)
    ASSET_DIR.mkdir(exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="casascius-atlas-") as tmp:
        tmp_path = Path(tmp)
        html_path = tmp_path / "atlas.html"
        html_path.write_text(render_html(coins, packing))
        requested_modes = sys.argv[1:] or list(MODES)
        unknown_modes = sorted(set(requested_modes) - set(MODES))
        if unknown_modes:
            raise SystemExit(f"Unknown atlas mode(s): {', '.join(unknown_modes)}")
        for mode in requested_modes:
            filename = MODES[mode]
            chrome_screenshot(html_path.as_uri(), ASSET_DIR / filename, mode, width, height, tmp_path / "profile")

    refs = []
    for index, packed in enumerate(packing["items"]):
        rgb = color_for_index(index)
        refs.append({"slug": packed["slug"], "index": index + 1, "rgb": list(rgb)})
    metadata = {
        "width": width,
        "height": height,
        "pixelsPerMm": PIXELS_PER_MM,
        "packingWidthMm": packing["widthMm"],
        "packingHeightMm": packing["heightMm"],
        "colorToSlug": {f"{r},{g},{b}": ref["slug"] for ref in refs for r, g, b in [ref["rgb"]]},
        "items": refs,
    }
    (ASSET_DIR / "all_items_map.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"Wrote atlas {width}x{height} to {ASSET_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
