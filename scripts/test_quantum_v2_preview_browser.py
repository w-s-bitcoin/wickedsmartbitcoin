#!/usr/bin/env python3
"""Real Chrome preview/homepage lifecycle using temporary format-2 publications.

Production files are read-only. Both valid publications and every corrupt/stale
response are fixture data; no database, producer, Git delivery or scheduler runs.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import urllib.request
from http.server import ThreadingHTTPServer

import test_homepage_preview_refresh as preview
from test_quantum_immutable_generation import publication, seed
import quantum_v2_delivery as delivery


DATA_PREFIX = "/webapps/quantum_exposure/webapp_data/"
MARKER_PATH = DATA_PREFIX + "published_generation.json"
FRAME_SELECTOR = '.dashboard-preview-frame[data-filename="quantum_exposure.png"]'
SPEC = preview.PERIODIC_PREVIEWS["quantum_exposure"]


class FrameContext:
    """Evaluate existing lifecycle assertions in the real homepage's child frame."""
    def __init__(self, cdp):
        self.cdp = cdp

    def evaluate(self, expression):
        return self.cdp.evaluate(
            f"document.querySelector({json.dumps(FRAME_SELECTOR)}).contentWindow.eval({json.dumps(expression)})"
        )


def test_new_object_in_homepage(cdp):
    cdp.evaluate(f"document.querySelector({json.dumps(FRAME_SELECTOR)}).scrollIntoView({{block:'center',behavior:'instant'}}); true")
    time.sleep(.2)
    frame = FrameContext(cdp)
    preview.wait_for_periodic_ready(frame, SPEC)
    parent_before = preview.homepage_state(cdp)
    child_before = preview.capture_preview_baseline(frame)
    frame.evaluate("window.__wsbStage5PreviewTest.stopMonitor(); true")

    # A different, valid immutable generation is offered with one same-length
    # corrupt byte. The accepted signature and complete visual must survive.
    preview.reset_test_activity(frame)
    preview.set_test_generation(frame, 6, "corrupt")
    preview.request_periodic_check(frame, SPEC["filename"], "v2-hash-corrupt")
    preview.wait_for_status(frame, "error")
    preview.wait_for(lambda: not frame.evaluate(
        f"{preview.controller_expression(SPEC['filename'])}?.getStatus?.().checkInFlight"
    ), description="corrupt immutable preview rejection")
    assert preview.accepted_generation(frame, SPEC["filename"]) == 0
    preview.assert_failure_preserved(frame, child_before["fingerprints"], "same-length immutable corruption")
    assert frame.evaluate("window.__wsbStage5PreviewTest.dataRequests.some(r => r.pathname.includes('/generations/objects/'))")

    # Install the genuinely changed history while hidden. Only one visible
    # presentation may expose the new chart; the iframe identity stays intact.
    preview.reset_test_activity(frame)
    frame.evaluate("""(() => {
      window.__wsbStage5Visibility = 'hidden';
      Object.defineProperty(document, 'visibilityState', {configurable:true, get:()=>window.__wsbStage5Visibility});
      document.dispatchEvent(new Event('visibilitychange'));
      return true;
    })()""")
    preview.set_test_generation(frame, 6)
    preview.request_periodic_check(frame, SPEC["filename"], "v2-hidden-new-object")
    preview.wait_for_status(frame, "applied", 6)
    hidden = frame.evaluate("({fingerprints:__wsbStage5PreviewTest.fingerprints(),presented:__wsbStage5PreviewTest.events.filter(e=>e.status==='presented').length})")
    assert hidden == {"fingerprints": child_before["fingerprints"], "presented": 0}, hidden
    frame.evaluate("window.__wsbStage5Visibility='visible';document.dispatchEvent(new Event('visibilitychange'));true")
    preview.wait_for_status(frame, "presented", 6)
    time.sleep(.2)
    child_after = preview.capture_preview_state(frame)
    assert child_after["fingerprints"] != child_before["fingerprints"], "A new history object did not repaint"
    assert frame.evaluate("__wsbStage5PreviewTest.events.filter(e=>e.status==='presented'&&e.generation===6).length") == 1
    for key in ("href", "navigationCount", "loadCount", "storedLoadCount", "theme"):
        assert child_after[key] == child_before[key], (key, child_before, child_after)
    assert child_after["sameRootRefs"] and not child_after["errors"]
    parent_after = preview.homepage_state(cdp)
    for key in ("href", "navigationCount", "order", "cssOrder", "favorites", "favoritesOnly",
                "favoritesToggle", "visible", "focused", "theme", "bodyClass", "frames"):
        assert parent_after[key] == parent_before[key], (key, parent_before[key], parent_after[key])
    assert abs(parent_after["scrollY"]-parent_before["scrollY"]) <= 2
    assert not parent_after["loaderMutations"] and not parent_after["windowErrors"]


def main():
    if not Path(preview.CHROME).is_file():
        raise SystemExit("Chrome unavailable; set CHROME_BIN")
    preview.assert_parent_refresh_ownership_removed()
    with tempfile.TemporaryDirectory(prefix="quantum-v2-preview-") as temporary:
        root = Path(temporary)
        first = root / "generation-one"
        first.mkdir()
        metadata = seed(first)
        marker_one = json.loads(publication.publish_immutable_generation(
            first, metadata=metadata, reason="isolated-preview-fixture", generation_id="preview-one"))
        second = root / "generation-two"
        delivery.prepare_output(first, second, 2000)
        metadata = seed(second, 2000)
        metadata["snapshot_blockheight"] = 2000
        marker_two = delivery.finish_output(second, metadata, "preview-two")
        assert marker_one["artifacts"]["historical_eco.csv"]["path"] != marker_two["artifacts"]["historical_eco.csv"]["path"]

        # The real homepage and other preview assets are served read-only. Only
        # Quantum data is replaced by a frozen dictionary of temporary exports.
        snapshot = preview.build_data_snapshot()
        for source in first.rglob("*"):
            if source.is_file():
                snapshot[DATA_PREFIX + source.relative_to(first).as_posix()] = source.read_bytes()
        for source in (second / "generations").rglob("*"):
            if source.is_file():
                snapshot[DATA_PREFIX + source.relative_to(second).as_posix()] = source.read_bytes()
        preview.validate_snapshot(snapshot, {"homepage"})
        paths = preview.quantum_immutable_preview_paths(snapshot)
        assert paths == {DATA_PREFIX + marker_one["artifacts"]["historical_eco.csv"]["path"]}
        assert all(path in snapshot for path in paths)
        preview.SnapshotHandler.snapshot = snapshot
        server_port, debug_port = preview.free_port(), preview.free_port()
        server = ThreadingHTTPServer(("127.0.0.1", server_port),
            lambda *a, **kw: preview.SnapshotHandler(*a, directory=str(preview.ROOT), **kw))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        chrome = subprocess.Popen([preview.CHROME, "--headless=new", "--disable-gpu", "--remote-allow-origins=*",
            "--window-size=1440,1000", f"--remote-debugging-port={debug_port}",
            f"--user-data-dir={root / 'chrome-profile'}", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            try:
                os.setpriority(os.PRIO_PROCESS, chrome.pid, 10)
            except (AttributeError, OSError):
                pass
            preview.wait_for(lambda: urllib.request.urlopen(f"http://127.0.0.1:{debug_port}/json/version", timeout=.5).read(),
                             description="Chrome DevTools endpoint")
            target = json.load(urllib.request.urlopen(urllib.request.Request(
                f"http://127.0.0.1:{debug_port}/json/new?about:blank", method="PUT"), timeout=2))
            cdp = preview.CdpSocket(target["webSocketDebuggerUrl"])
            cdp.command("Page.enable")
            cdp.command("Runtime.enable")
            cdp.command("Network.enable")
            # Existing lifecycle scenarios 0..5 reuse the first exact object.
            # Scenario 6 advertises a real second immutable history object.
            choose_marker = f"""(() => {{
              const original = window.fetch.bind(window);
              const next = {json.dumps(marker_two)};
              window.fetch = (input, init) => {{
                const url = new URL(typeof input === 'string' ? input : input.url, document.baseURI);
                if (location.pathname === '/webapps/quantum_exposure/preview.html' &&
                    url.pathname === {json.dumps(MARKER_PATH)} &&
                    window.__wsbStage5PreviewTest?.generation >= 6) {{
                  return Promise.resolve(new Response(JSON.stringify(next), {{headers:{{'content-type':'application/json'}}}}));
                }}
                return original(input, init);
              }};
            }})();"""
            cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": choose_marker + preview.fetch_harness_source()})
            preview.test_periodic_preview(cdp, server_port, "quantum_exposure", SPEC)
            assert cdp.evaluate("__wsbStage5PreviewTest.dataRequests.length>0 && __wsbStage5PreviewTest.dataRequests.every(r=>r.pathname.includes('/generations/objects/'))")
            preview.test_periodic_cold_recovery(cdp, server_port, "quantum_exposure", SPEC)
            preview.test_homepage_integration(cdp, server_port)
            test_new_object_in_homepage(cdp)
            print("Quantum v2 preview/homepage Chrome fixture passed: immutable stale/corrupt rejection, cold retry, hidden install/visible paint, stable iframe and homepage state.")
        finally:
            chrome.terminate()
            try:
                chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome.kill()
                chrome.wait(timeout=5)
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
