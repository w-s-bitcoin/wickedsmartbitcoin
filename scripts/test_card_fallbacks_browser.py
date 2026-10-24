#!/usr/bin/env python3
"""Capture fallback images from isolated preview fixtures in real Chrome.

Exercises the capture CLI without copying or changing production datasets.
Requires Chrome; set CHROME_BIN when it is not installed at the macOS default.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import unittest
import zlib


ROOT = Path(__file__).resolve().parents[1]
CAPTURE = ROOT / "scripts/capture_card_fallbacks.py"
RUNTIME = "js/06_grid_layout_filter_render.js"
CHROME = os.environ.get(
    "CHROME_BIN", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
)
COLORS = {"dark": (17, 51, 85), "light": (238, 204, 170)}
HTML_RUNTIME_REFERENCES = {
    "index.html": (RUNTIME + "?v=old&cache=stale", '"'),
    "view.html": ("./" + RUNTIME, "'"),
    "404.html": ("/" + RUNTIME + "?v=previous", '"'),
}


def tree_bytes(root: Path) -> dict[str, bytes]:
    return {str(path.relative_to(root)): path.read_bytes()
            for path in root.rglob("*") if path.is_file()}


def png_info(data: bytes) -> tuple[int, int, tuple[int, ...]]:
    """Read screenshot dimensions and the first RGB pixel using only stdlib."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssertionError("Capture is not a PNG")
    offset, compressed, header = 8, bytearray(), None
    while offset < len(data):
        size = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + size]
        checksum = struct.unpack_from(">I", data, offset + 8 + size)[0]
        if zlib.crc32(kind + payload) != checksum:
            raise AssertionError("Capture contains an invalid PNG chunk")
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", payload)
        elif kind == b"IDAT":
            compressed.extend(payload)
        offset += size + 12
    if header is None:
        raise AssertionError("Capture has no PNG dimensions")
    width, height, depth, color, compression, filtering, interlace = header
    if depth != 8 or color not in (2, 6) or compression or filtering or interlace:
        raise AssertionError(f"Unexpected screenshot PNG format: {header!r}")
    pixels = zlib.decompress(compressed)
    channels = 3 if color == 2 else 4
    if len(pixels) != height * (1 + width * channels) or pixels[0] > 4:
        raise AssertionError("Capture contains incomplete pixel data")
    # Every PNG filter has a zero predictor at the first pixel of the first row.
    return width, height, tuple(pixels[1:4])


def preview_html(mode: str, external_origin: str | None = None) -> str:
    external_probe = ""
    if external_origin:
        external_probe = f"""
        fetch({json.dumps(external_origin + '/http-probe')}).catch(() => {{}});
        try {{
          const socket = new WebSocket({json.dumps(external_origin.replace('http:', 'ws:') + '/ws-probe')});
          socket.onerror = () => {{}};
        }} catch (_) {{}}
        """
    return """<!doctype html><html><head><meta charset="utf-8">
      <style>html,body{margin:0;width:100%;height:100%;overflow:hidden}
      canvas{display:block;width:100%;height:100%}</style></head>
      <body><canvas id="chart"></canvas><script>
      (async () => {
        const theme = localStorage.getItem('quantum-research-dashboard-theme') || 'dark';
        document.documentElement.dataset.theme = theme;
        const colors = await (await fetch('./data.json')).json();
        EXTERNAL_PROBE
        // Readiness follows asynchronous data loading and an actual canvas paint.
        await new Promise(resolve => setTimeout(resolve, 150));
        const canvas = document.querySelector('canvas');
        canvas.width = innerWidth;
        canvas.height = innerHeight;
        const context = canvas.getContext('2d');
        context.fillStyle = `rgb(${colors[theme].join(',')})`;
        context.fillRect(0, 0, canvas.width, canvas.height);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        READINESS
      })();
      </script></body></html>
    """.replace("EXTERNAL_PROBE", external_probe).replace("READINESS", {
        "ready": "document.documentElement.dataset.previewReady = '1'; document.documentElement.dataset.previewAvailable = '1';",
        "unavailable": "document.documentElement.dataset.previewReady = '1'; document.documentElement.dataset.previewAvailable = '0';",
        "pending": "",
    }[mode])


def fixture_dist(root: Path, cards: dict[str, tuple[str, int, int]], *, external_origin=None):
    specs = {}
    for slug, (mode, width, height) in cards.items():
        preview = root / "webapps" / slug
        preview.mkdir(parents=True)
        (preview / "preview.html").write_text(preview_html(mode, external_origin))
        (preview / "data.json").write_text(json.dumps(COLORS))
        specs[slug + ".png"] = {
            "url": f"webapps/{slug}/preview.html",
            "width": width,
            "height": height,
        }
    runtime = root / RUNTIME
    runtime.parent.mkdir()
    runtime.write_text(
        "const DASHBOARD_CARD_PREVIEW_SPECS = Object.freeze(" + json.dumps(specs, indent=2) + ");\n"
        "const DASHBOARD_CARD_FALLBACKS = Object.freeze({});\n"
        "window.fixtureRuntimePreserved = true;\n"
    )
    fallbacks = root / "assets/card_fallbacks"
    fallbacks.mkdir(parents=True)
    (fallbacks / "previous.png").write_bytes(b"previous published fallback fixture")
    (root / "assets/keep.txt").write_text("unrelated build asset\n")
    for filename, (url, quote) in HTML_RUNTIME_REFERENCES.items():
        (root / filename).write_text(
            f"<!doctype html><script defer src={quote}{url}{quote}></script>\n"
            '<script src="js/07_modal.js?v=keep"></script>\n'
            '<link rel="stylesheet" href="assets/styles.css?v=keep">\n'
        )


class CardFallbackCaptureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not Path(CHROME).is_file():
            raise RuntimeError(f"Chrome not found at {CHROME}; set CHROME_BIN")
        if not CAPTURE.is_file():
            raise RuntimeError(f"Capture script missing: {CAPTURE}")

    def capture(self, root: Path, timeout=10):
        return subprocess.run(
            [sys.executable, str(CAPTURE), "--dist", str(root),
             "--timeout", str(timeout), "--chrome", CHROME],
            cwd=ROOT, capture_output=True, text=True, timeout=90,
        )

    def test_capture_uses_painted_theme_pixels_and_content_hashes(self):
        with tempfile.TemporaryDirectory(prefix="wsb-fallback-capture-") as temporary:
            root = Path(temporary)
            cards = {"alpha": ("ready", 1280, 720), "beta": ("ready", 640, 360)}
            fixture_dist(root, cards)
            original_html = {filename: (root / filename).read_text()
                             for filename in HTML_RUNTIME_REFERENCES}
            result = self.capture(root)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            source = (root / RUNTIME).read_text()
            match = re.search(r"const DASHBOARD_CARD_FALLBACKS = Object\.freeze\((.*?)\);", source, re.S)
            self.assertIsNotNone(match, source)
            mapping = json.loads(match.group(1))
            self.assertEqual(set(mapping), {"alpha.png", "beta.png"})
            self.assertIn("window.fixtureRuntimePreserved = true;", source)
            self.assertEqual((root / "assets/keep.txt").read_text(), "unrelated build asset\n")
            runtime_version = hashlib.sha256((root / RUNTIME).read_bytes()).hexdigest()[:16]
            for filename, (url, quote) in HTML_RUNTIME_REFERENCES.items():
                versioned_url = url.split("?", 1)[0] + "?v=" + runtime_version
                expected = original_html[filename].replace(
                    f"src={quote}{url}{quote}", f"src={quote}{versioned_url}{quote}"
                )
                self.assertEqual((root / filename).read_text(), expected, filename)
            for slug, (_, width, height) in cards.items():
                variants = mapping[slug + ".png"]
                self.assertEqual(set(variants), {"dark", "light"})
                self.assertNotEqual(variants["dark"], variants["light"])
                for theme, relative in variants.items():
                    with self.subTest(slug=slug, theme=theme):
                        data = (root / relative).read_bytes()
                        suffix = ".light" if theme == "light" else ""
                        digest = hashlib.sha256(data).hexdigest()[:16]
                        self.assertEqual(relative, f"assets/card_fallbacks/{slug}{suffix}.{digest}.png")
                        self.assertEqual(png_info(data), (width, height, COLORS[theme]))

    def test_later_unavailable_preview_keeps_previous_build_untouched(self):
        with tempfile.TemporaryDirectory(prefix="wsb-fallback-unavailable-") as temporary:
            root = Path(temporary)
            fixture_dist(root, {"alpha": ("ready", 1280, 720), "unavailable": ("unavailable", 1280, 720)})
            before = tree_bytes(root)
            result = self.capture(root)
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(tree_bytes(root), before, "Failed capture partially changed the build")
            self.assertIn("Captured alpha.png (light", result.stdout)
            self.assertIn("unavailable", result.stderr.splitlines()[-1].lower())

    def test_missing_readiness_times_out_without_installing_images(self):
        with tempfile.TemporaryDirectory(prefix="wsb-fallback-timeout-") as temporary:
            root = Path(temporary)
            fixture_dist(root, {"pending": ("pending", 1280, 720)})
            before = tree_bytes(root)
            result = self.capture(root, timeout=1)
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(tree_bytes(root), before, "Timed-out capture changed the build")
            self.assertRegex(result.stderr.splitlines()[-1].lower(), r"timed?\s*out.*pending/preview")

    def test_external_http_and_websocket_requests_never_leave_preview_origin(self):
        requests = []

        class ProbeHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"{}")

            def log_message(self, *_args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), ProbeHandler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with tempfile.TemporaryDirectory(prefix="wsb-fallback-network-") as temporary:
                root = Path(temporary)
                fixture_dist(root, {"network": ("ready", 640, 360)},
                             external_origin=f"http://127.0.0.1:{server.server_port}")
                result = self.capture(root)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(requests, [], "Capture contacted an external HTTP or WebSocket origin")
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
