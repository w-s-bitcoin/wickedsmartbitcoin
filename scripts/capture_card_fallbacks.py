#!/usr/bin/env python3
"""Capture homepage posters from the completed Pages artifact, never source data.

Requires only Python's standard library and Chrome/Chromium. The actual homepage
preview registry and renderers supply the images; no dashboard list or chart
implementation is duplicated here. External feeds are blocked so captures use
the same published generation shipped in this artifact.
"""

from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
import errno
import hashlib
import json
import os
import re
import shutil
import signal
import struct
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

if __package__:
    from .browser_cdp import CdpSocket, QuietHandler, free_port, wait_for
else:
    from browser_cdp import CdpSocket, QuietHandler, free_port, wait_for


REGISTRY_PATH = Path("js/06_grid_layout_filter_render.js")
FALLBACK_PLACEHOLDER = "const DASHBOARD_CARD_FALLBACKS = Object.freeze({});"
THEME_KEY = "quantum-research-dashboard-theme"


@contextmanager
def capture_workspace():
    path = Path(tempfile.mkdtemp(prefix="wsb-card-capture-"))
    try:
        yield path
    finally:
        # Chromium helpers can briefly finish profile writes after the browser
        # process exits. Retry only transient directory races in our own temp dir.
        deadline = time.monotonic() + 5
        while True:
            try:
                shutil.rmtree(path)
                break
            except FileNotFoundError:
                break
            except OSError as error:
                if error.errno not in (errno.ENOTEMPTY, errno.EBUSY) or time.monotonic() >= deadline:
                    raise
                time.sleep(0.1)


def close_browser(process, cdp):
    if cdp:
        try:
            cdp.sock.settimeout(3)
            cdp.command("Browser.close")
        except (EOFError, OSError, RuntimeError):
            pass  # A graceful browser close can close the socket before replying.
        finally:
            cdp.sock.close()

    def stop(sig):
        try:
            if os.name == "posix":
                os.killpg(process.pid, sig)
            else:
                process.send_signal(sig)
        except ProcessLookupError:
            pass

    try:
        process.wait(timeout=5 if cdp else 0)
    except subprocess.TimeoutExpired:
        stop(signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            stop(signal.SIGKILL)
            process.wait(timeout=5)
    if os.name == "posix":
        # This group belongs solely to our temporary browser, never a user tab.
        stop(signal.SIGKILL)


class CaptureHandler(QuietHandler):
    def end_headers(self):
        # All preview dependencies are local. In particular, never let optional
        # live prices make a build depend on the network or alter its snapshot.
        self.send_header("Content-Security-Policy", "default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src 'self'")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def find_chrome(requested=None):
    requested = requested or os.environ.get("CHROME_BIN")
    if requested:
        resolved = shutil.which(requested)
        if resolved:
            return resolved
        raise RuntimeError(f"Chrome executable not found: {requested}")
    for candidate in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome",
                      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"):
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise RuntimeError("Chrome/Chromium is required to build fresh card images; set CHROME_BIN.")


def preview_registry_expression(source):
    match = re.search(r"const DASHBOARD_CARD_PREVIEW_SPECS = Object\.freeze\((\{.*?\n\})\);", source, re.S)
    if not match:
        raise ValueError("Homepage preview registry was not found")
    if source.count(FALLBACK_PLACEHOLDER) != 1:
        raise ValueError("Expected exactly one empty card fallback map in the newly built artifact")
    return match.group(1)


def validate_specs(specs, dist):
    if not isinstance(specs, dict) or not specs:
        raise ValueError("Homepage preview registry is empty")
    for filename, spec in specs.items():
        if not re.fullmatch(r"[a-z0-9_]+\.png", filename):
            raise ValueError(f"Invalid card filename: {filename}")
        url = urllib.parse.urlsplit(spec["url"])
        path = (dist / urllib.parse.unquote(url.path)).resolve()
        if url.scheme or url.netloc or not path.is_relative_to(dist) or not path.is_file():
            raise ValueError(f"Preview must be an existing artifact file: {spec['url']}")
        for key in ("width", "height"):
            if not isinstance(spec.get(key), int) or not 1 <= spec[key] <= 4096:
                raise ValueError(f"Invalid preview {key}: {filename}")


def wait_for_preview(cdp, url, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            # Navigation can expose a context before its document root exists.
            state = cdp.evaluate("({url: location.href, ready: document.documentElement?.dataset.previewReady, "
                                 "available: document.documentElement?.dataset.previewAvailable})")
        except RuntimeError as error:
            if not any(message in str(error) for message in ("context was destroyed", "Cannot find context")):
                raise
            time.sleep(0.05)
            continue
        if state and state["url"] == url and state.get("ready") == "1":
            if state.get("available") != "1":
                raise RuntimeError(f"Preview reported unavailable: {url}")
            cdp.evaluate("(async () => { await document.fonts.ready; await new Promise(resolve => "
                         "requestAnimationFrame(() => requestAnimationFrame(resolve))); return true; })()")
            return
        time.sleep(0.05)
    raise TimeoutError(f"Timed out waiting for a painted preview: {url}")


def version_runtime_references(dist, source):
    """A new HTML visit must fetch the map for this build, not a cached old map."""
    version = hashlib.sha256(source.encode()).hexdigest()[:16]
    pattern = re.compile(r'(?P<prefix><script\b[^>]*\bsrc=["\'])(?P<url>(?:\./|/)?js/06_grid_layout_filter_render\.js)(?:\?[^"\']*)?(?P<quote>["\'])')
    for page in dist.glob("*.html"):
        html = page.read_text()
        updated = pattern.sub(lambda match: f'{match["prefix"]}{match["url"]}?v={version}{match["quote"]}', html)
        if updated != html:
            page.write_text(updated)


def capture_images(cdp, specs, origin, output, timeout):
    images = {}
    for filename, spec in specs.items():
        images[filename] = {}
        width, height = spec["width"], spec["height"]
        cdp.command("Emulation.setDeviceMetricsOverride", {
            "width": width, "height": height, "deviceScaleFactor": 1, "mobile": False,
        })
        for theme in ("dark", "light"):
            setup = cdp.command("Page.addScriptToEvaluateOnNewDocument", {
                "source": f"localStorage.setItem({json.dumps(THEME_KEY)}, {json.dumps(theme)});",
            })
            try:
                preview_url = urllib.parse.urljoin(origin + "/", spec["url"])
                parts = urllib.parse.urlsplit(preview_url)
                query = urllib.parse.parse_qsl(parts.query) + [("wsb_card_capture", theme)]
                url = urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(query)))
                cdp.command("Page.navigate", {"url": url})
                wait_for_preview(cdp, url, timeout)
                shot = cdp.command("Page.captureScreenshot", {
                    "format": "png", "captureBeyondViewport": False,
                    "clip": {"x": 0, "y": 0, "width": width, "height": height, "scale": 1},
                })
                payload = base64.b64decode(shot["data"], validate=True)
                if (payload[:8] != b"\x89PNG\r\n\x1a\n" or len(payload) < 33
                        or struct.unpack(">II", payload[16:24]) != (width, height)):
                    raise ValueError(f"Invalid screenshot dimensions: {filename} ({theme})")
                digest = hashlib.sha256(payload).hexdigest()[:16]
                stem = Path(filename).stem + (".light" if theme == "light" else "")
                name = f"{stem}.{digest}.png"
                (output / name).write_bytes(payload)
                images[filename][theme] = f"assets/card_fallbacks/{name}"
                print(f"Captured {filename} ({theme}, {width}x{height})", flush=True)
            finally:
                cdp.command("Page.removeScriptToEvaluateOnNewDocument", {"identifier": setup["identifier"]})
            cdp.events.clear()
    return images


def capture(dist, chrome, timeout):
    dist = dist.resolve()
    registry = dist / REGISTRY_PATH
    source = registry.read_text()
    expression = preview_registry_expression(source)
    handler = lambda *args, **kwargs: CaptureHandler(*args, directory=str(dist), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    try:
        with capture_workspace() as workspace:
            output = workspace / "images"
            output.mkdir()
            port = free_port()
            with (workspace / "chrome.log").open("w+") as log:
                process = subprocess.Popen([
                    chrome, "--headless=new", "--disable-gpu", "--disable-dev-shm-usage",
                    "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
                    "--disable-component-update", "--remote-allow-origins=*",
                    f"--remote-debugging-port={port}", f"--user-data-dir={workspace / 'profile'}", "about:blank",
                ], stdout=log, stderr=log, start_new_session=True)
                cdp = None
                try:
                    def chrome_ready():
                        if process.poll() is not None:
                            log.seek(0)
                            raise RuntimeError(f"Chrome exited: {log.read()[-3000:]}")
                        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=.5) as response:
                            return response.read()
                    wait_for(chrome_ready, timeout=15, description="Chrome for preview capture")
                    request = urllib.request.Request(f"http://127.0.0.1:{port}/json/new?about:blank", method="PUT")
                    with urllib.request.urlopen(request, timeout=2) as response:
                        target = json.load(response)
                    cdp = CdpSocket(target["webSocketDebuggerUrl"])
                    cdp.command("Page.enable")
                    cdp.command("Runtime.enable")
                    cdp.command("Network.enable")
                    cdp.command("Network.setCacheDisabled", {"cacheDisabled": True})
                    cdp.command("Emulation.setTimezoneOverride", {"timezoneId": "UTC"})
                    cdp.command("Emulation.setEmulatedMedia", {"features": [{"name": "prefers-reduced-motion", "value": "reduce"}]})
                    specs = cdp.evaluate(f"({expression})")
                    validate_specs(specs, dist)
                    images = capture_images(cdp, specs, origin, output, timeout)
                finally:
                    close_browser(process, cdp)
            # No poster or runtime change is installed until every preview has
            # succeeded. The Pages workflow must not upload a failed build.
            destination = dist / "assets/card_fallbacks"
            destination.mkdir(parents=True, exist_ok=True)
            for image in output.iterdir():
                shutil.copy2(image, destination / image.name)
            replacement = "const DASHBOARD_CARD_FALLBACKS = Object.freeze(" + json.dumps(images, sort_keys=True) + ");"
            runtime = source.replace(FALLBACK_PLACEHOLDER, replacement)
            registry.write_text(runtime)
            version_runtime_references(dist, runtime)
            print(f"Installed {len(images) * 2} fresh homepage card images in {destination}", flush=True)
    finally:
        server.shutdown()
        server.server_close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, required=True)
    parser.add_argument("--chrome", help="Chrome/Chromium executable (or set CHROME_BIN)")
    parser.add_argument("--timeout", type=float, default=30, help="Maximum seconds per preview")
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    capture(args.dist, find_chrome(args.chrome), args.timeout)


if __name__ == "__main__":
    main()
