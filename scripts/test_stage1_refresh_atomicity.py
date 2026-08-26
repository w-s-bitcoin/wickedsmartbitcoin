#!/usr/bin/env python3
"""Browser regressions for the first dashboard-refresh migration stage.

This test intentionally uses only Python's standard library and the Chrome
DevTools Protocol so it can run beside the existing dashboard smoke checks.
It verifies two user-visible contracts:

* refreshing a homepage preview never navigates the open modal iframe;
* a BIP-110 refresh leaves the last complete generation visible until every
  required dynamic block dataset is ready, and leaves it visible on failure.

Run from anywhere with:

    python3 scripts/test_stage1_refresh_atomicity.py

Set CHROME_BIN when Chrome is installed somewhere other than the macOS default.
"""

from __future__ import annotations

import base64
import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get(
    "CHROME_BIN",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class CdpSocket:
    """Small, dependency-free Chrome DevTools Protocol websocket client."""

    def __init__(self, url: str):
        parsed = urllib.parse.urlparse(url)
        self.sock = socket.create_connection((parsed.hostname, parsed.port), timeout=15)
        key = base64.b64encode(os.urandom(16)).decode()
        path = parsed.path + (("?" + parsed.query) if parsed.query else "")
        request = (
            f"GET {path} HTTP/1.1\r\nHost: {parsed.hostname}:{parsed.port}\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(request.encode())
        response = b""
        while b"\r\n\r\n" not in response:
            response += self.sock.recv(4096)
        if b" 101 " not in response.split(b"\r\n", 1)[0]:
            raise RuntimeError(response.decode(errors="replace"))
        self.next_id = 1
        self.events = []

    def _send(self, payload: str):
        data = payload.encode()
        mask = os.urandom(4)
        size = len(data)
        header = bytearray([0x81])
        if size < 126:
            header.append(0x80 | size)
        elif size < 65536:
            header.append(0x80 | 126)
            header.extend(struct.pack("!H", size))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack("!Q", size))
        header.extend(mask)
        header.extend(bytes(value ^ mask[index % 4] for index, value in enumerate(data)))
        self.sock.sendall(header)

    def _recv_exact(self, size: int) -> bytes:
        chunks = bytearray()
        while len(chunks) < size:
            chunks.extend(self.sock.recv(size - len(chunks)))
        return bytes(chunks)

    def _recv(self):
        first, second = self._recv_exact(2)
        opcode = first & 0x0F
        size = second & 0x7F
        if size == 126:
            size = struct.unpack("!H", self._recv_exact(2))[0]
        elif size == 127:
            size = struct.unpack("!Q", self._recv_exact(8))[0]
        masked = bool(second & 0x80)
        mask = self._recv_exact(4) if masked else b""
        data = self._recv_exact(size)
        if masked:
            data = bytes(value ^ mask[index % 4] for index, value in enumerate(data))
        if opcode == 0x9:  # Chrome rarely pings this short-lived connection.
            return self._recv()
        if opcode == 0x8:
            raise EOFError("Chrome closed the DevTools socket")
        return json.loads(data.decode())

    def command(self, method: str, params=None):
        command_id = self.next_id
        self.next_id += 1
        self._send(json.dumps({"id": command_id, "method": method, "params": params or {}}))
        while True:
            message = self._recv()
            if message.get("id") == command_id:
                if "error" in message:
                    raise RuntimeError(message["error"])
                return message.get("result", {})
            self.events.append(message)

    def evaluate(self, expression: str):
        result = self.command(
            "Runtime.evaluate",
            {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": True,
            },
        )
        remote = result.get("result", {})
        if remote.get("subtype") == "error":
            raise RuntimeError(remote.get("description") or remote)
        return remote.get("value")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_for(predicate, *, timeout=35, description="condition"):
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        try:
            value = predicate()
        except Exception as error:  # The page may be between execution contexts.
            value = None
            last_error = error
        if value:
            return value
        time.sleep(0.1)
    suffix = f"; last error: {last_error}" if last_error else ""
    raise TimeoutError(f"Timed out waiting for {description}{suffix}")


def install_bip_fetch_harness(cdp: CdpSocket):
    """Install controllable dynamic responses before the BIP page initializes."""

    source = r"""
      (() => {
        const nativeFetch = window.fetch.bind(window);
        const generationStamp = (generation) => {
          const minute = String(Math.max(0, Math.min(59, Number(generation) || 0))).padStart(2, "0");
          return `2099-01-01T00:${minute}:00.000Z`;
        };
        const test = {
          enabled: false,
          generation: 0,
          mode: "pass",
          pending: [],
          metadataRequests: 0,
          blockRequests: 0,
          blockRequestsByGeneration: {},
          calls: [],
          setGeneration(generation, mode = "pass") {
            this.enabled = true;
            this.generation = Number(generation);
            this.mode = mode;
            this.pending = [];
            this.metadataRequests = 0;
            this.blockRequests = 0;
            this.blockRequestsByGeneration[this.generation] = 0;
          },
          releaseAll() {
            const releases = this.pending.splice(0);
            releases.forEach((release) => release());
            return releases.length;
          },
        };
        window.__wsbAtomicRefreshTest = test;

        window.fetch = async (input, init) => {
          const raw = typeof input === "string" ? input : input?.url;
          const url = new URL(raw, window.location.href);
          const pathname = url.pathname;
          if (!test.enabled) return nativeFetch(input, init);

          if (pathname.endsWith("/bip110_metadata.json")) {
            const generation = test.generation;
            test.metadataRequests += 1;
            test.calls.push(`metadata:${generation}`);
            const response = await nativeFetch(input, init);
            if (!response.ok) return response;
            const payload = await response.clone().json();
            payload.generated_utc = generationStamp(generation);
            const headers = new Headers(response.headers);
            headers.delete("content-length");
            headers.delete("content-encoding");
            headers.set("content-type", "application/json");
            headers.set("etag", `"stage1-generation-${generation}"`);
            headers.set("last-modified", new Date(Date.UTC(2099, 0, 1, 0, generation, 0)).toUTCString());
            return new Response(JSON.stringify(payload), {
              status: response.status,
              statusText: response.statusText,
              headers,
            });
          }

          const isMainBlocks = pathname.endsWith("/bip110_block_points.bin");
          const isNodeBlocks = pathname.endsWith("/bip110_node_block_points.bin");
          if (isMainBlocks || isNodeBlocks) {
            const generation = test.generation;
            const kind = isMainBlocks ? "main" : "node";
            test.blockRequests += 1;
            test.blockRequestsByGeneration[generation] =
              (test.blockRequestsByGeneration[generation] || 0) + 1;
            test.calls.push(`blocks:${kind}:${generation}:${test.mode}`);

            if (test.mode === "truncate-main" && isMainBlocks) {
              return new Response(new Uint8Array([0, 1, 2, 3]), {
                status: 200,
                headers: { "content-type": "application/octet-stream" },
              });
            }
            if (test.mode === "hold") {
              return new Promise((resolve, reject) => {
                test.pending.push(() => {
                  nativeFetch(input, init).then(resolve, reject);
                });
              });
            }
          }

          return nativeFetch(input, init);
        };
      })();
    """
    cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": source})


def test_homepage_modal_is_not_navigated(cdp: CdpSocket, server_port: int):
    cdp.command(
        "Page.navigate",
        {"url": f"http://127.0.0.1:{server_port}/index.html"},
    )
    wait_for(
        lambda: cdp.evaluate(
            "typeof refreshHomepageLastUpdatedStamp === 'function' "
            "&& !!document.querySelector('#modal-embed')"
        ),
        description="homepage timestamp refresh helper",
    )

    before = cdp.evaluate(
        r"""
          (() => {
            const modal = document.querySelector("#modal");
            const frame = document.querySelector("#modal-embed");
            const image = document.querySelector("#modal-img");
            modal.style.display = "flex";
            modal.classList.add("embed-active");
            document.body.classList.add("modal-open");
            image.dataset.filename = "bip110_signaling.png";
            try { modalContentMode = "embed"; } catch (_) {}
            frame.src = "about:blank#stage1-open-modal-sentinel";
            return frame.getAttribute("src");
          })()
        """
    )
    if before != "about:blank#stage1-open-modal-sentinel":
        raise AssertionError(f"Could not establish modal sentinel: {before!r}")

    after = cdp.evaluate(
        r"""
          (async () => {
            const frame = document.querySelector("#modal-embed");
            const mutations = [];
            const observer = new MutationObserver((records) => {
              records.forEach((record) => {
                if (record.attributeName === "src") mutations.push(frame.getAttribute("src"));
              });
            });
            observer.observe(frame, { attributes: true, attributeFilter: ["src"] });
            await refreshHomepageLastUpdatedStamp();
            window.dispatchEvent(new Event("focus"));
            window.dispatchEvent(new Event("online"));
            await new Promise((resolve) => setTimeout(resolve, 350));
            observer.disconnect();
            return {
              src: frame.getAttribute("src"),
              mutations,
              childOwnsPreviewRefresh:
                typeof refreshHomepageDashboardPreview === "undefined"
                && typeof refreshHomepageGridCards === "undefined"
                && typeof HOMEPAGE_GRID_CARD_DATA_SOURCES === "undefined"
                && !refreshHomepageLastUpdatedStamp.toString().includes("modalEmbed"),
            };
          })()
        """
    )
    if after["src"] != before or after["mutations"]:
        raise AssertionError(
            "Homepage preview refresh navigated the active modal iframe: "
            f"before={before!r}, after={after!r}"
        )
    if not after["childOwnsPreviewRefresh"]:
        raise AssertionError(
            "Homepage still exposes a parent-owned preview refresh path"
        )


def test_bip_refresh_is_atomic(cdp: CdpSocket, server_port: int):
    cdp.command(
        "Page.navigate",
        {
            "url": (
                f"http://127.0.0.1:{server_port}/webapps/bip110_signaling/"
                "dashboard.html?stage1_refresh_test=1"
            )
        },
    )
    wait_for(
        lambda: cdp.evaluate(
            """
              (() => {
                const value = document.querySelector('#updatedTimeZoneDisplay .chip-value');
                const loader = document.querySelector('#dashboardLoader');
                return !!value?.textContent?.trim() && loader?.classList.contains('hidden');
              })()
            """
        ),
        timeout=50,
        description="complete initial BIP-110 dashboard generation",
    )
    # Let any initial requestIdleCallback attribution enhancement settle before
    # observing routine-refresh mutations.
    time.sleep(0.75)

    baseline = cdp.evaluate(
        r"""
          (() => {
            const value = document.querySelector('#updatedTimeZoneDisplay .chip-value');
            window.__wsbRefreshObservedValues = [];
            window.__wsbRefreshObserver = new MutationObserver(() => {
              const next = document.querySelector('#updatedTimeZoneDisplay .chip-value')?.textContent || '';
              window.__wsbRefreshObservedValues.push(next);
            });
            window.__wsbRefreshObserver.observe(document.querySelector('#statusChips'), {
              childList: true,
              subtree: true,
              characterData: true,
            });
            window.__wsbRefreshLoaderMutations = [];
            window.__wsbRefreshLoaderObservers = [
              '#dashboardLoader',
              '#segwitLoader',
              '#bip110Loader',
              '#bip110NodeLoader',
            ].map((selector) => {
              const element = document.querySelector(selector);
              if (!element) return null;
              const observer = new MutationObserver((records) => {
                records.forEach((record) => {
                  window.__wsbRefreshLoaderMutations.push({
                    selector,
                    attribute: record.attributeName,
                    className: element.className,
                    style: element.getAttribute('style') || '',
                  });
                });
              });
              observer.observe(element, {
                attributes: true,
                attributeFilter: ['class', 'style'],
              });
              return observer;
            }).filter(Boolean);
            window.__wsbAtomicRefreshTest.setGeneration(1, 'hold');
            window.dispatchEvent(new Event('online'));
            return value.textContent;
          })()
        """
    )
    wait_for(
        lambda: cdp.evaluate("window.__wsbAtomicRefreshTest.pending.length >= 2"),
        description="both held BIP-110 block datasets",
    )

    held = cdp.evaluate(
        r"""
          (() => ({
            value: document.querySelector('#updatedTimeZoneDisplay .chip-value')?.textContent || '',
            observed: [...window.__wsbRefreshObservedValues],
            metadataRequests: window.__wsbAtomicRefreshTest.metadataRequests,
            blockRequests: window.__wsbAtomicRefreshTest.blockRequests,
            visibleLoaders: [
              '#dashboardLoader',
              '#segwitLoader',
              '#bip110Loader',
              '#bip110NodeLoader',
            ].filter((selector) => {
              const element = document.querySelector(selector);
              return element
                && !element.classList.contains('hidden')
                && getComputedStyle(element).display !== 'none';
            }),
            canvasCount: document.querySelectorAll('main canvas').length,
            statusChipCount: document.querySelector('#statusChips')?.children.length || 0,
          }))()
        """
    )
    if held["value"] != baseline or held["observed"]:
        raise AssertionError(
            "BIP-110 exposed a partial generation while block data was pending: "
            f"baseline={baseline!r}, held={held!r}"
        )
    if held["visibleLoaders"]:
        raise AssertionError(
            f"BIP-110 showed routine-refresh loaders: {held['visibleLoaders']!r}"
        )
    if held["canvasCount"] < 2 or held["statusChipCount"] < 1:
        raise AssertionError(f"BIP-110 cleared visible dashboard content during refresh: {held!r}")

    # Repeated resume signals while a refresh is in flight must be coalesced;
    # otherwise an older response can race a newer generation into the UI.
    cdp.evaluate(
        "window.dispatchEvent(new Event('focus')); "
        "window.dispatchEvent(new Event('online')); true"
    )
    time.sleep(0.4)
    repeated_request_count = cdp.evaluate(
        "window.__wsbAtomicRefreshTest.metadataRequests"
    )
    if repeated_request_count != held["metadataRequests"]:
        raise AssertionError(
            "BIP-110 started overlapping refresh generations after repeated wake events: "
            f"before={held['metadataRequests']}, after={repeated_request_count}"
        )

    released = cdp.evaluate("window.__wsbAtomicRefreshTest.releaseAll()")
    if released < 2:
        raise AssertionError(f"Expected two held block responses, released {released}")
    final_generation_one = wait_for(
        lambda: cdp.evaluate(
            """
              (() => {
                const value = document.querySelector('#updatedTimeZoneDisplay .chip-value')?.textContent || '';
                return value.includes('2099') ? value : '';
              })()
            """
        ),
        description="atomic BIP-110 generation commit",
    )
    observed = cdp.evaluate("[...new Set(window.__wsbRefreshObservedValues)]")
    unexpected = [value for value in observed if value not in (baseline, final_generation_one)]
    if unexpected:
        raise AssertionError(
            f"BIP-110 rendered intermediate Updated values during commit: {unexpected!r}"
        )

    # A required-file failure must not install the metadata/period portion of
    # the failed generation. It should leave the prior complete dashboard in
    # place and allow a later good generation to recover normally.
    failed_generation_baseline = final_generation_one
    cdp.evaluate(
        "window.__wsbRefreshObservedValues = []; "
        "window.__wsbAtomicRefreshTest.setGeneration(2, 'truncate-main'); "
        "window.dispatchEvent(new Event('online')); true"
    )
    wait_for(
        lambda: cdp.evaluate(
            "window.__wsbAtomicRefreshTest.blockRequestsByGeneration[2] >= 2"
        ),
        description="failed generation block requests",
    )
    time.sleep(0.8)
    after_failure = cdp.evaluate(
        r"""
          (() => ({
            value: document.querySelector('#updatedTimeZoneDisplay .chip-value')?.textContent || '',
            observed: [...window.__wsbRefreshObservedValues],
          }))()
        """
    )
    if after_failure["value"] != failed_generation_baseline:
        raise AssertionError(
            "BIP-110 installed metadata from a generation whose required main "
            f"block dataset was truncated: {after_failure!r}"
        )
    failed_intermediate = [
        value
        for value in after_failure["observed"]
        if value not in ("", failed_generation_baseline)
    ]
    if failed_intermediate:
        raise AssertionError(
            f"BIP-110 briefly exposed failed-generation values: {failed_intermediate!r}"
        )

    cdp.evaluate(
        "window.__wsbAtomicRefreshTest.setGeneration(3, 'pass'); "
        "window.dispatchEvent(new Event('online')); true"
    )
    wait_for(
        lambda: cdp.evaluate(
            """
              (() => {
                const value = document.querySelector('#updatedTimeZoneDisplay .chip-value')?.textContent || '';
                return value.includes('2099') && value !== %s;
              })()
            """ % json.dumps(failed_generation_baseline)
        ),
        description="recovery after a failed BIP-110 generation",
    )

    # Browsers can complete fetches while the document is hidden but suspend
    # paint work. Model that state explicitly: the complete generation may be
    # committed internally, while the old DOM must remain untouched until the
    # visibility wake flushes one pending render.
    hidden_baseline = cdp.evaluate(
        "document.querySelector('#updatedTimeZoneDisplay .chip-value')?.textContent || ''"
    )
    visibility_override_installed = cdp.evaluate(
        r"""
          (() => {
            try {
              window.__wsbTestVisibilityState = 'hidden';
              Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                get: () => window.__wsbTestVisibilityState,
              });
              return document.visibilityState === 'hidden';
            } catch (_) {
              return false;
            }
          })()
        """
    )
    if not visibility_override_installed:
        raise AssertionError("Could not install the test-only document visibility override")
    cdp.evaluate(
        "window.__wsbRefreshObservedValues = []; "
        "window.__wsbAtomicRefreshTest.setGeneration(4, 'pass'); "
        "window.dispatchEvent(new Event('online')); true"
    )
    wait_for(
        lambda: cdp.evaluate(
            "window.__wsbAtomicRefreshTest.blockRequestsByGeneration[4] >= 2"
        ),
        description="hidden generation block requests",
    )
    # Queue another wake while generation 4 is in flight. Its later metadata
    # probe can only run after the first transaction has committed, giving the
    # test a deterministic signal that the hidden commit is complete.
    cdp.evaluate("window.dispatchEvent(new Event('online')); true")
    wait_for(
        lambda: cdp.evaluate("window.__wsbAtomicRefreshTest.metadataRequests >= 3"),
        description="post-commit hidden refresh probe",
    )
    hidden_state = cdp.evaluate(
        r"""
          (() => ({
            value: document.querySelector('#updatedTimeZoneDisplay .chip-value')?.textContent || '',
            observed: [...window.__wsbRefreshObservedValues],
          }))()
        """
    )
    if hidden_state["value"] != hidden_baseline or hidden_state["observed"]:
        raise AssertionError(
            "BIP-110 painted a background generation while the document was hidden: "
            f"baseline={hidden_baseline!r}, hidden={hidden_state!r}"
        )
    cdp.evaluate(
        "window.__wsbTestVisibilityState = 'visible'; "
        "document.dispatchEvent(new Event('visibilitychange')); true"
    )
    generation_four = wait_for(
        lambda: cdp.evaluate(
            """
              (() => {
                const value = document.querySelector('#updatedTimeZoneDisplay .chip-value')?.textContent || '';
                return value !== %s ? value : '';
              })()
            """ % json.dumps(hidden_baseline)
        ),
        description="visible wake flushing the pending BIP-110 render",
    )

    # Finally, change the advertised generation while its two block responses
    # are held. The confirmation probe must reject generation 5, queue a clean
    # generation-6 transaction, and never render generation 5 in between.
    cdp.evaluate(
        "window.__wsbRefreshObservedValues = []; "
        "window.__wsbAtomicRefreshTest.setGeneration(5, 'hold'); "
        "window.dispatchEvent(new Event('online')); true"
    )
    wait_for(
        lambda: cdp.evaluate("window.__wsbAtomicRefreshTest.pending.length >= 2"),
        description="stale generation held block responses",
    )
    cdp.evaluate(
        "window.__wsbAtomicRefreshTest.generation = 6; "
        "window.__wsbAtomicRefreshTest.mode = 'pass'; "
        "window.__wsbAtomicRefreshTest.blockRequestsByGeneration[6] = 0; "
        "window.__wsbAtomicRefreshTest.releaseAll(); true"
    )
    generation_six = wait_for(
        lambda: cdp.evaluate(
            """
              (() => {
                const value = document.querySelector('#updatedTimeZoneDisplay .chip-value')?.textContent || '';
                return value !== %s
                  && window.__wsbAtomicRefreshTest.blockRequestsByGeneration[6] >= 2
                  ? value
                  : '';
              })()
            """ % json.dumps(generation_four)
        ),
        description="new generation replacing an in-flight stale candidate",
    )
    stale_observed = cdp.evaluate("[...new Set(window.__wsbRefreshObservedValues)]")
    stale_intermediates = [
        value for value in stale_observed if value not in (generation_four, generation_six)
    ]
    if stale_intermediates:
        raise AssertionError(
            "BIP-110 rendered a stale generation before the newest candidate: "
            f"{stale_intermediates!r}"
        )
    loader_mutations = cdp.evaluate("window.__wsbRefreshLoaderMutations")
    if loader_mutations:
        raise AssertionError(
            "BIP-110 mutated loader presentation during routine refresh: "
            f"{loader_mutations!r}"
        )
    cdp.evaluate(
        "window.__wsbRefreshObserver?.disconnect(); "
        "window.__wsbRefreshLoaderObservers?.forEach((observer) => observer.disconnect()); true"
    )


def main():
    chrome_path = Path(CHROME)
    if not chrome_path.is_file():
        raise SystemExit(f"Chrome not found at {CHROME}; set CHROME_BIN")

    server_port = free_port()
    debug_port = free_port()
    handler = lambda *args, **kwargs: QuietHandler(*args, directory=str(ROOT), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", server_port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    with tempfile.TemporaryDirectory(prefix="wsb-stage1-refresh-cdp-") as profile:
        chrome = subprocess.Popen(
            [
                CHROME,
                "--headless=new",
                "--disable-gpu",
                "--remote-allow-origins=*",
                f"--remote-debugging-port={debug_port}",
                f"--user-data-dir={profile}",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            version_url = f"http://127.0.0.1:{debug_port}/json/version"
            wait_for(
                lambda: urllib.request.urlopen(version_url, timeout=0.5).read(),
                description="Chrome DevTools endpoint",
            )
            request = urllib.request.Request(
                f"http://127.0.0.1:{debug_port}/json/new?about:blank",
                method="PUT",
            )
            target = json.load(urllib.request.urlopen(request, timeout=2))
            cdp = CdpSocket(target["webSocketDebuggerUrl"])
            cdp.command("Page.enable")
            cdp.command("Runtime.enable")
            cdp.command(
                "Page.addScriptToEvaluateOnNewDocument",
                {"source": "localStorage.clear(); sessionStorage.clear();"},
            )

            requested = set(sys.argv[1:])
            unknown = requested.difference({"homepage", "bip110"})
            if unknown:
                raise SystemExit(f"Unknown test target(s): {', '.join(sorted(unknown))}")
            run_all = not requested

            if run_all or "homepage" in requested:
                print("Testing homepage modal refresh isolation...", flush=True)
                test_homepage_modal_is_not_navigated(cdp, server_port)
                print("Passed: homepage refresh did not navigate the active modal", flush=True)

            if run_all or "bip110" in requested:
                install_bip_fetch_harness(cdp)
                print("Testing BIP-110 atomic refresh transaction...", flush=True)
                test_bip_refresh_is_atomic(cdp, server_port)
                print("Passed: BIP-110 refresh remained atomic and recovered", flush=True)
        finally:
            chrome.terminate()
            try:
                chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome.kill()
            server.shutdown()


if __name__ == "__main__":
    main()
