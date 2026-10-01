#!/usr/bin/env python3
"""Check title settings dialogs on the dashboards that use them."""

import json
import os
import subprocess
import tempfile
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from test_stage1_refresh_atomicity import CdpSocket, QuietHandler, free_port, wait_for


ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get("CHROME_BIN", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
DASHBOARDS = (
    ("uoa", "uoaSettingsBtn", "uoaSettingsPanel", "uoaSettingsClose"),
    ("issuance_rate", "issuanceSettingsBtn", "issuanceSettingsPanel", "issuanceSettingsClose"),
    ("dca_comparison", "dcaComparisonSettingsBtn", "dcaComparisonSettingsPanel", "dcaComparisonSettingsClose"),
    ("patoshi_pattern", "filtersBtn", "filtersPanel", "filtersClose"),
)


def click(cdp, x, y):
    for kind in ("mousePressed", "mouseReleased"):
        cdp.command("Input.dispatchMouseEvent", {
            "type": kind, "x": x, "y": y, "button": "left", "clickCount": 1,
        })


def assert_dialog(cdp, button_id, dialog_id, width, height):
    result = cdp.evaluate(f"""(() => {{
      const button = document.getElementById({json.dumps(button_id)});
      const dialog = document.getElementById({json.dumps(dialog_id)});
      const rect = dialog.getBoundingClientRect();
      if (!dialog.open || !dialog.matches(':modal')) return 'dialog is not modal';
      if (button.getAttribute('aria-expanded') !== 'true') return 'trigger state is stale';
      if (Math.abs((rect.left + rect.right) / 2 - innerWidth / 2) > 2 ||
          Math.abs((rect.top + rect.bottom) / 2 - innerHeight / 2) > 2)
        return `dialog is off center: ${{JSON.stringify(rect.toJSON())}}`;
      if (rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight)
        return 'dialog is clipped by the viewport';
      if (document.elementFromPoint(innerWidth / 2, innerHeight / 2) !== dialog &&
          !dialog.contains(document.elementFromPoint(innerWidth / 2, innerHeight / 2)))
        return 'dialog does not cover dashboard content';
      return '';
    }})()""")
    if result:
        raise AssertionError(f"{dialog_id} at {width}x{height}: {result}")


def main():
    if not Path(CHROME).is_file():
        raise SystemExit(f"Chrome not found at {CHROME}; set CHROME_BIN")
    server_port, debug_port = free_port(), free_port()
    server = ThreadingHTTPServer(("127.0.0.1", server_port),
        lambda *args, **kwargs: QuietHandler(*args, directory=str(ROOT), **kwargs))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="wsb-title-settings-") as profile:
        chrome = subprocess.Popen([
            CHROME, "--headless=new", "--disable-gpu", "--remote-allow-origins=*",
            f"--remote-debugging-port={debug_port}", f"--user-data-dir={profile}", "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda: urllib.request.urlopen(
                f"http://127.0.0.1:{debug_port}/json/version", timeout=0.5).read(),
                description="Chrome DevTools endpoint")
            target = json.load(urllib.request.urlopen(urllib.request.Request(
                f"http://127.0.0.1:{debug_port}/json/new?about:blank", method="PUT"), timeout=2))
            cdp = CdpSocket(target["webSocketDebuggerUrl"])
            cdp.command("Page.enable")
            cdp.command("Runtime.enable")
            for slug, button_id, dialog_id, close_id in DASHBOARDS:
                cdp.command("Emulation.setDeviceMetricsOverride", {
                    "width": 1280, "height": 800, "deviceScaleFactor": 1, "mobile": False,
                })
                cdp.command("Page.navigate", {
                    "url": f"http://127.0.0.1:{server_port}/webapps/{slug}/dashboard.html",
                })
                wait_for(lambda: cdp.evaluate("document.readyState === 'complete'"),
                    description=f"{slug} document load")
                wait_for(lambda: cdp.evaluate(f"""(() => {{
                  const button = document.getElementById({json.dumps(button_id)});
                  const dialog = document.getElementById({json.dumps(dialog_id)});
                  if (!button || !dialog) return false;
                  if (!dialog.open) button.click();
                  return dialog.open;
                }})()"""), description=f"{slug} settings opening")
                assert_dialog(cdp, button_id, dialog_id, 1280, 800)
                cdp.command("Emulation.setDeviceMetricsOverride", {
                    "width": 390, "height": 780, "deviceScaleFactor": 1, "mobile": True,
                })
                assert_dialog(cdp, button_id, dialog_id, 390, 780)
                inside = cdp.evaluate(f"""(() => {{
                  const rect = document.getElementById({json.dumps(dialog_id)}).getBoundingClientRect();
                  return {{ x: rect.left + 20, y: rect.top + 18 }};
                }})()""")
                click(cdp, inside["x"], inside["y"])
                if not cdp.evaluate(f"document.getElementById({json.dumps(dialog_id)}).open"):
                    raise AssertionError(f"{slug} closed after clicking inside")
                click(cdp, 5, 5)
                wait_for(lambda: not cdp.evaluate(
                    f"document.getElementById({json.dumps(dialog_id)}).open"),
                    description=f"{slug} backdrop close")
                if cdp.evaluate(f"document.getElementById({json.dumps(button_id)}).getAttribute('aria-expanded')") != "false":
                    raise AssertionError(f"{slug} trigger stayed expanded after backdrop close")
                cdp.evaluate(f"document.getElementById({json.dumps(button_id)}).click()")
                wait_for(lambda: cdp.evaluate(f"document.getElementById({json.dumps(dialog_id)}).open"),
                    description=f"{slug} settings reopening")
                cdp.evaluate(f"document.getElementById({json.dumps(close_id)}).click()")
                wait_for(lambda: not cdp.evaluate(
                    f"document.getElementById({json.dumps(dialog_id)}).open"),
                    description=f"{slug} close button")
                cdp.evaluate(f"document.getElementById({json.dumps(button_id)}).click()")
                wait_for(lambda: cdp.evaluate(f"document.getElementById({json.dumps(dialog_id)}).open"),
                    description=f"{slug} settings reopening for Escape")
                cdp.command("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Escape", "code": "Escape", "windowsVirtualKeyCode": 27})
                cdp.command("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Escape", "code": "Escape", "windowsVirtualKeyCode": 27})
                wait_for(lambda: not cdp.evaluate(
                    f"document.getElementById({json.dumps(dialog_id)}).open"),
                    description=f"{slug} Escape close")
                print(f"{slug}: desktop/mobile centering, inside/backdrop clicks, close button, Escape OK")
            cdp.sock.close()
        finally:
            chrome.terminate()
            chrome.wait(timeout=10)
            server.shutdown()


if __name__ == "__main__":
    main()
