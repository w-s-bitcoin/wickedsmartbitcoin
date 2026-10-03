#!/usr/bin/env python3
"""Exercise dashboard share forwarding through the actual standalone/home shells.

Dashboard documents are replaced with a tiny query probe: this isolates routing
from data and third-party chart feeds. Data/control round trips have separate
time-series, analytics, and specialized browser suites.
"""
import json
import os
import re
import subprocess
import tempfile
import threading
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from test_stage1_refresh_atomicity import CdpSocket, QuietHandler, free_port, wait_for

ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get("CHROME_BIN", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
SLUGS = (
    "node_count", "bitcoin_dominance", "dca_cost_basis", "dca_comparison",
    "days_since_ath", "issuance_rate", "uoa", "bip110_signaling",
    "patoshi_pattern", "quantum_exposure", "casascius_explorer",
)


class Handler(QuietHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        slug = parsed.path.strip("/")
        if re.fullmatch(r"/webapps/[^/]+/dashboard\.html", parsed.path):
            content = b"<script>window.shareProbe=Object.fromEntries(new URLSearchParams(location.search));</script>"
        elif slug in SLUGS:
            content = (ROOT / "404.html").read_bytes()
        elif parsed.path.endswith(".html") and "bootstrap=1" in parsed.query and slug[:-5] in SLUGS:
            html = (ROOT / slug).read_text()
            html, count = re.subn(r"\(function primeStandaloneDashboard\(\) \{.*?\}\)\(\);", "", html, count=1, flags=re.S)
            assert count == 1
            content = html.encode()
        else:
            return super().do_GET()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def main():
    if not Path(CHROME).is_file():
        raise SystemExit(f"Chrome not found at {CHROME}; set CHROME_BIN")
    server_port, debug_port = free_port(), free_port()
    server = ThreadingHTTPServer(("127.0.0.1", server_port),
        lambda *a, **kw: Handler(*a, directory=str(ROOT), **kw))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="wsb-share-routes-") as profile:
        chrome = subprocess.Popen([
            CHROME, "--headless=new", "--disable-gpu", "--remote-allow-origins=*",
            f"--remote-debugging-port={debug_port}", f"--user-data-dir={profile}", "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda: urllib.request.urlopen(f"http://127.0.0.1:{debug_port}/json/version", timeout=.5).read(), description="Chrome")
            target = json.load(urllib.request.urlopen(urllib.request.Request(
                f"http://127.0.0.1:{debug_port}/json/new?about:blank", method="PUT")))
            cdp = CdpSocket(target["webSocketDebuggerUrl"])
            cdp.command("Page.enable")
            cdp.command("Runtime.enable")
            cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": "window.routeErrors=[];addEventListener('error', e => routeErrors.push(e.message));"})
            cdp.command("Network.enable")
            cdp.command("Network.setBlockedURLs", {"urls": ["https://*", "wss://*"]})
            query = "state=e30&pair=BTCUSD&bip110_state=legacy&chainSplitDemo=1"
            for slug in SLUGS:
                routes = [
                    f"/{slug}.html?{query}",
                    f"/{slug}.html?{query}&bootstrap=1",
                    f"/view.html#{slug}?{query}",
                    f"/view.html?{query}#{slug}",
                    f"/{slug}?{query}",
                    f"/?{query}#{slug}",
                ]
                for route in routes:
                    cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{server_port}{route}"})
                    probe = lambda: cdp.evaluate("document.getElementById('modal-embed')?.contentWindow?.shareProbe || null")
                    try:
                        wait_for(probe, description=f"{slug} route {route}")
                    except TimeoutError:
                        print(cdp.evaluate("({url:location.href, ready:document.readyState, src:document.getElementById('modal-embed')?.src, errors:window.routeErrors})"), flush=True)
                        print([event for event in cdp.events if event.get('method') == 'Runtime.exceptionThrown'], flush=True)
                        raise
                    result = probe()
                    for key, value in urllib.parse.parse_qsl(query):
                        assert result.get(key) == value, (slug, route, key, result)
                print(f"{slug}: standalone, bootstrap, both hash forms, clean route, and homepage forwarding passed", flush=True)
            cdp.sock.close()
        finally:
            chrome.terminate()
            chrome.wait(timeout=10)
            server.shutdown()


if __name__ == "__main__":
    main()
