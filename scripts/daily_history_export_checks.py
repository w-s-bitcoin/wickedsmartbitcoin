"""Exercise live export boundaries through the real shared dashboard controls."""

from __future__ import annotations

import json

from browser_cdp import CdpSocket, wait_for


def check_live_exports(cdp: CdpSocket, origin: str, slug: str, dashboard: str, chart: str) -> None:
    history = cdp.evaluate(f"""(async () => {{
      const rows = {chart}.parse(await (await fetch('../../assets/daily_price.csv')).text());
      return {{latest: rows.at(-1), historical: rows.at(-3), first: rows[0]}};
    }})()""")
    latest, historical = history["latest"], history["historical"]
    cases = [
        ("pinned PNG", "png", {"date": latest["iso"]}),
        ("paused latest PNG", "png", {"date": latest["iso"], "pausedTarget": latest["iso"]}),
        ("historical PNG", "png", {"date": historical["iso"], "pausedTarget": latest["iso"]}),
        ("latest video", "video", {"date": "latest"}),
        ("no-hold video", "video", {"date": "latest", "endHold": False}),
        ("historical video", "video", {"date": historical["iso"], "pausedTarget": latest["iso"]}),
    ]
    if slug == "mined_supply_price":
        cases.extend([
            ("one-date video", "video", {"date": latest["iso"], "startDate": latest["iso"], "pausedTarget": latest["iso"]}),
            ("pinned publication advance", "png", {"date": latest["iso"]}),
            ("rolling publication advance", "png", {"date": "latest"}),
        ])
    for name, kind, selection in cases:
        state = {"startDate": "first", "orientation": "landscape", "quality": "720", "endHold": True, **selection}
        query = cdp.evaluate("new URL(WSBDashboardComponents.buildShareUrl(" +
                             json.dumps({"slug": slug, "state": state}) + ")).search")
        cdp.command("Page.navigate", {"url": origin + f"/webapps/{slug}/dashboard.html" + query})
        wait_for(lambda: cdp.evaluate(f"window.{dashboard}?.getState().rows > 100"), description=name)
        arguments = {"dashboard": dashboard, "chart": chart, "kind": kind,
                     "advance": "publication advance" in name}
        result = cdp.evaluate("(async (args) => {" + r"""
          const app = window[args.dashboard], G = window[args.chart];
          const E = WSBDashboardExport, B = WSBDashboardExportBranding;
          const original = {render: G.render, ready: B.ready, png: E.downloadPng,
            encode: E.encodeVideo, fetch: window.fetch};
          const observed = [], snapshots = new Map();
          let label = '', refreshes = 0, assetsReady = false, refreshedAfterReady = true, pngSize = null;
          let firstFrame = null, lastFrame = null;
          const published = G.parse(await (await fetch('../../assets/daily_price.csv')).text());
          // Pinned historical views needn't select a quote before an export.
          // Give their feed a valid quote three days after the publication too.
          const emit = window.__spotEmit;
          const quoteAt = Date.parse(published.at(-1).timestamp.replace(' ', 'T') + 'Z') + 3 * 86400000;
          window.__spotEmit = (price, live = true) => emit(price, live, quoteAt);
          if (args.advance) {
            // A complete next-day fixture exists only behind this page's fetch shim.
            const csv = await (await fetch('../../assets/daily_price.csv')).text();
            const marker = await (await fetch('../../assets/daily_price_metadata.json')).json();
            const lines = csv.trimEnd().split('\n'), fields = lines[0].split(','), next = lines.at(-1).split(',');
            const day = new Date(published.at(-1).time + 86400000), iso = day.toISOString().slice(0, 10);
            next[fields.indexOf('date')] = `${day.getUTCMonth()+1}/${day.getUTCDate()}/${String(day.getUTCFullYear()).slice(-2)}`;
            next[fields.indexOf('timestamp')] = `${iso} 00:00:00`;
            next[fields.indexOf('block_height')] = String(published.at(-1).height + 144);
            next[fields.indexOf('supply')] = String(published.at(-1).supply + 450);
            lines.push(next.join(','));
            const fresh = lines.join('\n') + '\n';
            marker.artifact.rows++;
            marker.artifact.sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fresh)))].map(b => b.toString(16).padStart(2,'0')).join('');
            marker.latest_date = iso; marker.latest_timestamp = `${iso} 00:00:00`;
            marker.latest_block_height = published.at(-1).height + 144;
            window.fetch = (url, ...rest) => String(url).includes('daily_price_metadata.json') ? Promise.resolve(new Response(JSON.stringify(marker)))
              : String(url).includes('daily_price.csv') ? Promise.resolve(new Response(fresh)) : original.fetch(url, ...rest);
          }
          B.ready = async () => {
            await original.ready();
            await new Promise(resolve => setTimeout(resolve, 5));
            assetsReady = true; window.__spotEmit(711111.11);
          };
          window.__spotRefresh = async () => {
            refreshedAfterReady &&= assetsReady;
            refreshes++;
            window.__spotEmit(args.kind === 'png' ? 722222.22 : 730000 + refreshes * 10000);
          };
          G.render = (ctx, width, height, rows, index, options) => {
            const result = original.render(ctx, width, height, rows, index, options);
            if (options.export) {
              observed.push({label, index, row: {...rows[index]}, previousPrice: rows.at(-2).price});
              snapshots.set(label, ctx.canvas.toDataURL());
            }
            return result;
          };
          E.downloadPng = async canvas => {
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            const bitmap = await createImageBitmap(blob); pngSize = [bitmap.width, bitmap.height]; bitmap.close();
          };
          E.encodeVideo = async config => {
            const frames = config.frames, opening = config.settings.endHold ? E.VIDEO_FPS : 0;
            firstFrame = Math.min(...frames); lastFrame = frames.at(-1);
            const final = Math.max(opening, frames.findLastIndex(index => index !== lastFrame) + 1);
            const render = async (position, name) => { label = name; await config.renderFrame(frames[position], config.canvas, position); };
            if (opening) {
              await render(0, 'opening');
              window.__spotEmit(933333.33);
              await render(opening - 1, 'opening hold');
            }
            if (opening < final) await render(opening, 'historical');
            window.__spotEmit(944444.44);
            await render(final, 'final');
            window.__spotEmit(955555.55);
            if (opening) await render(frames.length - 1, 'ending hold');
            return null; // Also verify the ordinary encoder-error recovery path.
          };
          try {
            window.__spotEmit(700000);
            document.getElementById(args.kind === 'png' ? 'downloadImage' : 'downloadVideo').click();
            for (let i = 0; i < 250 && app.getState().exporting; i++) await new Promise(resolve => setTimeout(resolve, 20));
            return {observed, refreshes, refreshedAfterReady, pngSize, firstFrame, lastFrame,
              recovered: !app.getState().exporting && !document.getElementById('downloadImage').disabled,
              openingFrozen: snapshots.get('opening') === snapshots.get('opening hold'),
              endingFrozen: snapshots.get('final') === snapshots.get('ending hold'),
              separateSnapshots: snapshots.get('opening') !== snapshots.get('final')};
          } finally {
            G.render = original.render; B.ready = original.ready; E.downloadPng = original.png;
            E.encodeVideo = original.encode; window.fetch = original.fetch; delete window.__spotRefresh;
          }
        """ + "})(" + json.dumps(arguments) + ")")
        assert result["recovered"] and result["refreshedAfterReady"], (name, result)
        is_historical = name.startswith("historical") or name == "pinned publication advance"
        expected_row = historical if name.startswith("historical") else latest
        if kind == "png":
            assert result["pngSize"] == [3840, 2160] and len(result["observed"]) == 1, (name, result)
            row = result["observed"][0]["row"]
            if is_historical:
                assert result["refreshes"] == 0 and row == expected_row, (name, result)
            else:
                assert result["refreshes"] == 1 and row["price"] == 722222.22 and row["quoteAt"], (name, result)
                assert row["iso"] > latest["iso"] if arguments["advance"] else row["iso"] == latest["iso"], (name, result)
        else:
            seen = {item["label"]: item for item in result["observed"]}
            if state["endHold"]:
                assert result["openingFrozen"] and result["endingFrozen"], (name, result)
            if is_historical:
                assert result["refreshes"] == 0, (name, result)
                assert seen["opening"]["row"] == seen["final"]["row"] == expected_row, (name, result)
            else:
                assert result["refreshes"] == (2 if state["endHold"] else 1), (name, result)
                assert seen["final"]["row"]["price"] == (750000 if state["endHold"] else 740000), (name, result)
                if state["endHold"]:
                    assert result["separateSnapshots"] and seen["opening"]["row"]["price"] == 740000, (name, result)
            if name == "one-date video":
                assert result["firstFrame"] == result["lastFrame"], (name, result)
                assert "historical" not in seen, (name, result)
            else:
                assert seen["historical"]["row"] == history["first"], (name, result)
    # Return to the ordinary latest view for the rest of each consumer suite.
    query = cdp.evaluate("new URL(WSBDashboardComponents.buildShareUrl(" +
                         json.dumps({"slug": slug, "state": {"date": "latest", "startDate": "first"}}) + ")).search")
    cdp.command("Page.navigate", {"url": origin + f"/webapps/{slug}/dashboard.html" + query})
    wait_for(lambda: cdp.evaluate(f"window.{dashboard}?.getState().rows > 100"), description="live export recovery")
