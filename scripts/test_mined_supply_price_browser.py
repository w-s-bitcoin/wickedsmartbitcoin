#!/usr/bin/env python3
"""Browser regression for mined supply/price rendering and exports.

Serves the checkout read-only. The dashboard verifies the published daily-price
marker and CSV; no producer, live market endpoint, or dataset mutation runs.
"""

from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path
import subprocess
import threading
import urllib.request
from http.server import ThreadingHTTPServer

from daily_history_tooltip_checks import check_tooltips
from browser_cdp import CdpSocket, QuietHandler, free_port, wait_for
from capture_card_fallbacks import capture_workspace, close_browser, find_chrome

ROOT = Path(__file__).resolve().parents[1]


class Handler(QuietHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)


def check_export_reference(cdp: CdpSocket, artifact_dir: Path | None) -> None:
    result = cdp.evaluate("""(async () => {
      await WSBDashboardExportBranding.ready();
      const history = WSBMinedSupplyPriceChart.parse(await (await fetch('../../assets/daily_price.csv')).text());
      // Isolated reference snapshot: never install fixture values in the app or
      // change published files. This makes visual comparison independent of today.
      const rows = history.filter(row => row.iso <= '2026-03-13');
      rows[rows.length - 1] = { ...rows.at(-1), timestamp: '2026-03-13 19:00:00',
        height: 940548, supply: 20001715.625, price: 71071.70 };
      const results = [];
      for (const orientation of ['landscape', 'portrait', 'square']) for (const theme of ['dark', 'light']) {
        const baseWidth = orientation === 'landscape' ? 1920 : 1080;
        for (const width of [baseWidth, orientation === 'landscape' ? 1280 : 720, orientation === 'landscape' ? 3840 : 2160]) {
          const canvas = document.createElement('canvas'); canvas.width = width;
          canvas.height = width * (orientation === 'landscape' ? 9 / 16 : orientation === 'portrait' ? 16 / 9 : 1);
          const ctx = canvas.getContext('2d'), labels = [], circles = [], unit = width / baseWidth;
          const fillText = ctx.fillText.bind(ctx), arc = ctx.arc.bind(ctx);
          ctx.fillText = (text, x, y, ...rest) => {
            const m = ctx.getTransform(), p = m.transformPoint({x, y}), bounds = ctx.measureText(text);
            const corners = [-bounds.actualBoundingBoxLeft, bounds.actualBoundingBoxRight].flatMap(dx =>
              [-bounds.actualBoundingBoxAscent, bounds.actualBoundingBoxDescent].map(dy => m.transformPoint({x: x + dx, y: y + dy})));
            labels.push({text, x: p.x / unit, y: p.y / unit, font: ctx.font, fontSize: Number(ctx.font.match(/([0-9.]+)px/)[1]), color: ctx.fillStyle,
              top: Math.min(...corners.map(p => p.y)) / unit, bottom: Math.max(...corners.map(p => p.y)) / unit,
              angle: Math.atan2(m.b, m.a), left: (p.x - bounds.actualBoundingBoxLeft * Math.hypot(m.a, m.b)) / unit,
              right: (p.x + bounds.actualBoundingBoxRight * Math.hypot(m.a, m.b)) / unit});
            fillText(text, x, y, ...rest);
          };
          ctx.arc = (x, y, radius, ...rest) => {
            const m = ctx.getTransform(), p = m.transformPoint({x, y});
            circles.push({x: p.x / unit, y: p.y / unit, radius: radius * Math.hypot(m.a, m.b) / unit});
            arc(x, y, radius, ...rest);
          };
          WSBMinedSupplyPriceChart.render(ctx, width, canvas.height, rows, rows.length - 1,
            {theme, export: true, branded: true});
          const result = {orientation, theme, width, baseWidth, labels, circle: circles[0]};
          if (__SAVE_ARTIFACTS__ && width === baseWidth) result.data = canvas.toDataURL('image/png');
          results.push(result);
        }
      }
      return results;
    })()""".replace("__SAVE_ARTIFACTS__", "true" if artifact_dir else "false"))
    for rendering in result:
        if artifact_dir and "data" in rendering:
            (artifact_dir / f"{rendering['orientation']}-reference-{rendering['theme']}.png").write_bytes(
                base64.b64decode(rendering.pop("data").split(",", 1)[1]))
        labels = {label["text"]: label for label in rendering["labels"]}
        circle = rendering["circle"]
        if rendering["orientation"] == "landscape":
            assert abs(circle["x"] - 365) < 1 and abs(circle["y"] - 613) < 1, circle
            assert abs(circle["radius"] - 331) < 1, circle
        else:
            assert abs(circle["x"] - 540) < 1, circle
            assert labels["20,001,715.625 BTC"]["bottom"] + 10 < labels["Percentage of 21M BTC Mined"]["top"], labels
            footer_top = 1854 if rendering["orientation"] == "portrait" else 1002
            assert all(label["bottom"] < footer_top for label in rendering["labels"] if label["text"].isdigit() and len(label["text"]) == 4), labels
        landscape = next(item for item in result if item["theme"] == rendering["theme"] and item["orientation"] == "landscape" and item["width"] == 1920)
        landscape_labels = {label["text"]: label for label in landscape["labels"]}
        for text in ["Block Height:", "940548", "Epoch", "5", "Block Subsidy", "3.125 BTC", "Mined Supply", "20,001,715.625 BTC", "Price (BTCUSD)", "$71,071.70"]:
            assert labels[text]["font"] == landscape_labels[text]["font"] and labels[text]["color"] == landscape_labels[text]["color"], labels[text]
        assert abs(labels["95.2%"]["fontSize"] / circle["radius"] - landscape_labels["95.2%"]["fontSize"] / 331) < .001, circle
        assert labels["Block Height:"]["right"] + 8 < labels["940548"]["left"], labels
        assert labels["940548"]["right"] + 60 < labels["5"]["left"], labels
        assert 44 <= labels["20,001,715.625 BTC"]["fontSize"] <= 49, labels
        assert "700" not in labels["20,001,715.625 BTC"]["font"] and "WSB Export DejaVu" in labels["20,001,715.625 BTC"]["font"], labels
        assert labels["Mar 13, 2026 19:00 (UTC)"]["color"] == ("#ffffff" if rendering["theme"] == "dark" else "#171b22"), labels
        assert abs(labels["2012"]["angle"] + 3.141592653589793 / 4) < .001, labels
        assert labels["95.2%"]["right"] - labels["95.2%"]["left"] < 175, labels
        # The normalized chart layout must be identical at PNG and video sizes.
        baseline = next(item for item in result if item["theme"] == rendering["theme"] and item["orientation"] == rendering["orientation"] and item["width"] == rendering["baseWidth"])
        assert len(rendering["labels"]) == len(baseline["labels"])
        for actual, expected in zip(rendering["labels"], baseline["labels"]):
            assert actual["text"] == expected["text"] and abs(actual["x"] - expected["x"]) < .01 and abs(actual["y"] - expected["y"]) < .01, (actual, expected)


def check_opening_reveal(cdp: CdpSocket) -> None:
    result = cdp.evaluate("""(async () => {
      const G = WSBMinedSupplyPriceChart;
      const published = G.parse(await (await fetch('../../assets/daily_price.csv')).text());
      // Uneven block spacing ensures the reveal follows height, not row count.
      const synthetic = [0, 0, 0, 0, .001, .002].map((price, i) => ({price,
        height: [0, 2, 7, 10, 15, 20][i], supply: i * 50,
        time: Date.UTC(2009, 0, 3 + i), timestamp: '2009-01-03 00:00:00'}));
      const results = [];
      for (const rows of [published, synthetic, synthetic.slice(0, 4)]) {
        const lastZero = rows.findIndex(row => row.price > 0) < 0 ? rows.length - 1 : rows.findIndex(row => row.price > 0) - 1;
        for (const orientation of ['landscape', 'portrait', 'square']) for (const theme of ['dark', 'light']) {
          const {width, height} = WSBDashboardExport.getDimensions({quality: '720', orientation});
          const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          let points = [], observed = [];
          for (const name of ['beginPath', 'moveTo', 'lineTo', 'stroke']) {
            const original = ctx[name].bind(ctx);
            ctx[name] = (...args) => {
              if (name === 'beginPath') points = [];
              if (name === 'moveTo' || name === 'lineTo') points.push({move: name === 'moveTo', x: args[0], y: args[1]});
              if (name === 'stroke' && ctx.strokeStyle === '#ffffff' && Math.abs(ctx.lineWidth - 2.1) < .001) observed = points.slice();
              return original(...args);
            };
          }
          for (const index of [...new Set([0, 1, Math.floor(lastZero / 2), lastZero, Math.min(lastZero + 1, rows.length - 1)])]) {
            G.render(ctx, width, height, rows, index, {theme, export: true, branded: true});
            const left = orientation === 'landscape' ? 709 : orientation === 'portrait' ? 20 : 32;
            const right = orientation === 'landscape' ? 1876 : orientation === 'portrait' ? 1060 : 1048;
            const fraction = (rows[Math.min(index, lastZero)].height - rows[0].height) /
              Math.max(1, rows[Math.max(index, lastZero)].height - rows[0].height);
            results.push({orientation, theme, index, lastZero, left, right, fraction, points: observed});
          }
        }
      }
      const milestones = G.exportMilestones(published);
      const sampled = [0.5, 1, 2, 4].map(speed => {
        const frames = WSBDashboardExport.buildDailyFrameIndices(0, published.length - 1, {speed, milestones});
        return milestones.every(index => frames.includes(index));
      });
      return {results, sampled, empty: G.exportMilestones([]), priced: G.exportMilestones(synthetic.slice(4))};
    })()""")
    assert all(result['sampled']) and result['empty'] == result['priced'] == [], result
    for frame in result['results']:
        points, index, last = frame['points'], frame['index'], frame['lastZero']
        assert len(points) == index + 1, frame
        endpoint = points[min(index, last)]
        expected = frame['left'] + frame['fraction'] * (frame['right'] - frame['left'])
        assert abs(endpoint['x'] - expected) < .001, frame
        assert all(abs(point['y'] - points[0]['y']) < .001 for point in points[:last + 1]), frame
        if index < last:
            assert endpoint['x'] < frame['right'], frame
        if index > last:
            assert points[-1]['move'] and points[-1]['y'] < endpoint['y'], frame


def check(cdp: CdpSocket, origin: str, artifact_dir: Path | None = None) -> None:
    # Replace the shared feed at its script boundary; no live endpoints are used.
    cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": """
      Object.defineProperty(window, 'WSBBitcoinSpotPrice', { configurable: true,
        set(api) {
          let quote = null, live = false, callback;
          const feed = { start() {}, stop() {}, refresh: async () => quote,
            current: () => live ? quote : null, last: () => quote, isLive: () => live,
            newerThan: (at) => quote && quote.at > Date.parse(at || 0) ? quote : null };
          api.create = ({ onQuote }) => { callback = onQuote; return feed; };
          window.__spotEmit = (price, isLive = true) => {
            if (price) quote = { price, source: 'test feed', at: Date.now() + 86400000, receivedAt: Date.now() };
            live = isLive; callback?.(live ? quote : null);
          };
          Object.defineProperty(window, 'WSBBitcoinSpotPrice', { value: api, configurable: true });
        }
      });
    """})
    cdp.command("Emulation.setDeviceMetricsOverride", {
        "width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False,
    })
    cdp.command("Page.navigate", {"url": origin + "/webapps/mined_supply_price/preview.html"})
    preview = wait_for(lambda: (state if (state := cdp.evaluate("""({
      ready: document.documentElement.dataset.previewReady,
      available: document.documentElement.dataset.previewAvailable,
      date: document.getElementById('previewCanvas')?.dataset.endDate,
    })""")).get("ready") == "1" else None), description="mined supply preview")
    assert preview["available"] == "1" and preview["date"], preview

    cdp.command("Page.navigate", {"url": origin + "/webapps/mined_supply_price/dashboard.html"})
    initial = wait_for(lambda: (state if (state := cdp.evaluate("""({
      model: window.WSBMinedSupplyPriceDashboard?.getState(),
      error: document.getElementById('dashboardStatus')?.textContent,
      size: [document.getElementById('dashboardCanvas')?.width, document.getElementById('dashboardCanvas')?.height],
    })""")).get("model", {}).get("rows", 0) > 100 else None), description="mined supply dashboard")
    assert not initial["error"] and initial["size"][0] > 500 and initial["size"][1] > 300, initial
    check_export_reference(cdp, artifact_dir)
    check_opening_reveal(cdp)
    assert initial["model"]["startIndex"] == 0, "Full range must include Not Valued history"
    assert cdp.evaluate("document.getElementById('startDateBtn').disabled && !document.getElementById('dateRangeStartSlider') && document.getElementById('rangeDaysInput').readOnly"), "Start must stay locked with only one handle"
    assert cdp.evaluate("!document.getElementById('kpiHeight')"), "Block chip duplicates Updated"
    check_tooltips(cdp, "WSBMinedSupplyPriceChart", artifact_dir)
    cdp.evaluate("window.__spotEmit(123456.78)")
    wait_for(lambda: cdp.evaluate("document.getElementById('kpiPrice').textContent === '$123,456.78'"), description="live price KPI")
    assert cdp.evaluate("document.getElementById('priceLiveStatus').dataset.kind === 'live'")
    cdp.evaluate("window.__spotEmit(null, false)")
    wait_for(lambda: cdp.evaluate("document.getElementById('priceLiveStatus').dataset.kind === 'retained'"), description="retained price status")
    assert cdp.evaluate("document.getElementById('kpiPrice').textContent === '$123,456.78'")
    expanded = cdp.evaluate("""(() => {
      document.getElementById('expandDashboard').click();
      return { active: document.body.classList.contains('mined-supply-dashboard-expanded'),
        pressed: document.getElementById('expandDashboard').getAttribute('aria-pressed') };
    })()""")
    assert expanded == {"active": True, "pressed": "true"}, expanded
    cdp.evaluate("document.getElementById('expandDashboard').click()")
    assert cdp.evaluate("!document.body.classList.contains('mined-supply-dashboard-expanded')")

    scrubbed = cdp.evaluate("""(() => {
      const slider = document.getElementById('dateRangeEndSlider');
      slider.value = String(Math.floor(window.WSBMinedSupplyPriceDashboard.getState().rows / 2));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return window.WSBMinedSupplyPriceDashboard.getState();
    })()""")
    assert scrubbed["startIndex"] < scrubbed["index"] < initial["model"]["index"], scrubbed
    cdp.evaluate("window.__spotEmit(234567.89)")
    assert cdp.evaluate("document.getElementById('priceLiveStatus').dataset.kind === 'published' && document.getElementById('kpiPrice').textContent !== '$234,567.89'"), "Live ticks changed history"
    assert cdp.evaluate("!document.getElementById('latestBtn').classList.contains('is-active') && document.getElementById('latestBtn').getAttribute('aria-pressed') === 'false'"), "Historical dates must clear Latest"
    cdp.evaluate("(() => { const end = document.getElementById('dateRangeEndSlider'); end.value = end.max; end.dispatchEvent(new Event('input', {bubbles:true})); })()")
    assert cdp.evaluate("document.getElementById('latestBtn').classList.contains('is-active') && document.getElementById('latestBtn').getAttribute('aria-pressed') === 'true'"), "Returning the end slider to latest must restore its highlight"

    wait_for(lambda: cdp.evaluate("document.getElementById('kpiPrice').textContent === '$234,567.89'"), description="latest resumes live feed")
    shared = cdp.evaluate("""(() => {
      document.getElementById('dateRangeSettingsBtn').click();
      const group = document.getElementById('exportOrientation');
      group.querySelector('[data-value="square"]').click();
      const result = { menu: document.getElementById('dateRangeSettingsMenu').classList.contains('open'),
        orientation: WSBDashboardComponents.getButtonGroupValue(group),
        toolbar: !!document.querySelector('.date-range-playback-button-group #downloadImage'),
        range: !!document.querySelector('.date-range-slider-wrap .date-range-slider'),
        buttonHeight: getComputedStyle(document.getElementById('playPause')).height };
      document.getElementById('dateRangeSettingsBtn').click();
      return result;
    })()""")
    assert shared["menu"] and shared["orientation"] == "square" and shared["toolbar"] and shared["range"], shared
    # Playback keeps the selected end, Pause retains its frame, Stop restores it.
    cdp.evaluate("document.getElementById('playPause').click(); document.getElementById('pausePlayback').click()")
    assert cdp.evaluate("document.getElementById('priceLiveStatus').dataset.kind === 'published'")
    cdp.evaluate("document.getElementById('stopPlayback').click()")
    assert cdp.evaluate("WSBMinedSupplyPriceDashboard.getState().index === WSBMinedSupplyPriceDashboard.getState().rows - 1")
    export = cdp.evaluate("""(async () => {
      await WSBDashboardExportBranding.ready();
      const text = await (await fetch('../../assets/daily_price.csv')).text();
      const rows = WSBMinedSupplyPriceChart.parse(text), results = {};
      const early = document.createElement('canvas'); early.width = 960; early.height = 540;
      const earlyCtx = early.getContext('2d');
      WSBMinedSupplyPriceChart.render(earlyCtx, 960, 540, rows, rows.findIndex(r => r.price > 0) - 1, {theme: 'dark', preview: true});
      const baseline = earlyCtx.getImageData(500, 400, 440, 140).data;
      let longest = 0;
      for (let y = 0; y < 140; y++) {
        let count = 0;
        for (let x = 0; x < 440; x++) { const at = (y * 440 + x) * 4; if (baseline[at] > 180 && baseline[at + 1] > 180 && baseline[at + 2] > 180) count++; }
        longest = Math.max(longest, count);
      }
      results.notValuedBaseline = longest > 300;
      for (const orientation of ['landscape', 'portrait', 'square']) {
        const { width, height } = WSBDashboardExport.getDimensions({ quality: '2160', orientation });
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        WSBMinedSupplyPriceChart.render(ctx, width, height, rows, rows.length - 1,
          { theme: 'dark', export: true, branded: true });
        const plot = ctx.getImageData(Math.floor(width * .7), Math.floor(height * (orientation === 'landscape' ? .5 : .8)), 1, 1).data;
        const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const png = await createImageBitmap(pngBlob);
        results[orientation] = { width, height, plot: [...plot], pngSize: [png.width, png.height] };
        png.close();
        if (__SAVE_ARTIFACTS__) results[orientation].data = canvas.toDataURL('image/png');
        if (orientation === 'landscape') {
          // The reference's smaller Block Height row must clear the Epoch KPI.
          const gap = ctx.getImageData(Math.floor(width * .22), Math.floor(height * .088),
            Math.floor(width * .02), Math.floor(height * .015)).data;
          results.headerGapClear = !Array.from(gap).some((channel, i) => i % 4 !== 3 && channel > 16);
        }
      }
      return results;
    })()""".replace("__SAVE_ARTIFACTS__", "true" if artifact_dir else "false"))
    for orientation in ("landscape", "portrait", "square"):
        result = export[orientation]
        if artifact_dir:
            (artifact_dir / f"{orientation}.png").write_bytes(base64.b64decode(result.pop("data").split(",", 1)[1]))
        assert result["pngSize"] == [result["width"], result["height"]], result
    assert [(export[key]["width"], export[key]["height"]) for key in ("landscape", "portrait", "square")] == [
        (3840, 2160), (2160, 3840), (2160, 2160)], export
    assert export["notValuedBaseline"], "The pre-price history needs a visible flat Not Valued line"
    assert export["headerGapClear"], "Block Height ran into Epoch on the landscape export"
    assert all(export[key]["plot"][3] == 255 and max(export[key]["plot"][:3]) > 20
               for key in ("landscape", "portrait", "square")), export

    frozen = cdp.evaluate("""(async () => {
      const originalEncode = WSBDashboardExport.encodeVideo;
      const originalRender = WSBMinedSupplyPriceChart.render;
      const observed = [];
      let milestonesPreserved = false;
      const publishedPrice = WSBMinedSupplyPriceChart.parse(await (await fetch('../../assets/daily_price.csv')).text()).at(-1).price;
      WSBMinedSupplyPriceChart.render = (ctx, width, height, rows, index, options) => {
        if (options.export) observed.push({index, price: rows[index].price});
        return originalRender(ctx, width, height, rows, index, options);
      };
      WSBDashboardExport.encodeVideo = async (config) => {
        const history = WSBMinedSupplyPriceChart.parse(await (await fetch('../../assets/daily_price.csv')).text());
        milestonesPreserved = WSBMinedSupplyPriceChart.exportMilestones(history).every(index => config.frames.includes(index));
        await config.renderFrame(config.frames[0], config.canvas, 0);
        window.__spotEmit(345678.90);
        await config.renderFrame(config.frames.at(-1), config.canvas, config.frames.length - 1);
        window.__spotEmit(456789.01);
        await config.renderFrame(config.frames.at(-1), config.canvas, config.frames.length - 1);
        // Exercise control recovery on an encoder failure as well.
        return null;
      };
      try {
        document.getElementById('downloadVideo').click();
        for (let i = 0; i < 100 && WSBMinedSupplyPriceDashboard.getState().exporting; i++)
          await new Promise(resolve => setTimeout(resolve, 20));
        return {observed, publishedPrice, milestonesPreserved, recovered: !WSBMinedSupplyPriceDashboard.getState().exporting && !document.getElementById('downloadImage').disabled};
      } finally {
        WSBDashboardExport.encodeVideo = originalEncode;
        WSBMinedSupplyPriceChart.render = originalRender;
      }
    })()""")
    assert frozen["recovered"] and frozen["milestonesPreserved"] and len(frozen["observed"]) == 3, frozen
    assert cdp.evaluate("document.getElementById('startDateBtn').disabled && !document.getElementById('dateRangeStartSlider')"), "Export recovery unlocked Start"
    assert frozen["observed"][0]["index"] == frozen["observed"][-1]["index"], frozen
    assert frozen["observed"][0]["price"] == frozen["publishedPrice"], frozen
    assert [row["price"] for row in frozen["observed"][1:]] == [345678.90, 345678.90], frozen

    videos = cdp.evaluate("""(async () => {
      const rows = WSBMinedSupplyPriceChart.parse(await (await fetch('../../assets/daily_price.csv')).text());
      const firstPriced = rows.findIndex(row => row.price > 0), results = {};
      const frames = [0, 1, Math.floor((firstPriced - 1) / 2), firstPriced - 1, firstPriced, rows.length - 1];
      for (const orientation of ['landscape', 'portrait', 'square']) {
        const settings = { quality: '720', orientation, theme: 'dark' };
        const { width, height } = WSBDashboardExport.getDimensions(settings);
        const canvas = document.createElement('canvas');
        const blob = await WSBDashboardExport.encodeVideo({
          canvas, width, height, fps: 2, settings,
          frames,
          renderFrame: async (i, target) => WSBMinedSupplyPriceChart.render(
            target.getContext('2d'), width, height, rows, i, { theme: 'dark', export: true, branded: true }),
        });
        if (!blob) throw new Error('No encoded video for ' + orientation);
        const player = document.createElement('video'), url = URL.createObjectURL(blob);
        player.muted = true; player.preload = 'auto';
        try {
          await new Promise((resolve, reject) => { player.onloadedmetadata = resolve; player.onerror = reject; player.src = url; });
          await new Promise((resolve, reject) => { player.onseeked = resolve; player.onerror = reject; player.currentTime = Math.max(0, player.duration - .1); });
          const decoded = document.createElement('canvas'); decoded.width = width; decoded.height = height;
          const ctx = decoded.getContext('2d'); ctx.drawImage(player, 0, 0);
          const pixel = ctx.getImageData(Math.floor(width * .7), Math.floor(height * (orientation === 'landscape' ? .5 : .8)), 1, 1).data;
          results[orientation] = { size: blob.size, extension: WSBDashboardExport.videoExtension(blob),
            width: player.videoWidth, height: player.videoHeight, duration: player.duration, pixel: [...pixel] };
          const finalImage = decoded.toDataURL('image/png');
          await new Promise((resolve, reject) => { player.onseeked = resolve; player.onerror = reject; player.currentTime = 1.25; });
          ctx.drawImage(player, 0, 0);
          const u = width / (orientation === 'landscape' ? 1920 : 1080);
          const left = (orientation === 'landscape' ? 709 : orientation === 'portrait' ? 20 : 32) * u;
          const right = (orientation === 'landscape' ? 1876 : orientation === 'portrait' ? 1060 : 1048) * u;
          const bottom = (orientation === 'landscape' ? 911 : orientation === 'portrait' ? 1801 : 949) * u;
          const stripe = ctx.getImageData(Math.ceil(left), Math.floor(bottom) - 2, Math.floor(right - left) - 2, 4);
          const xs = [];
          for (let i = 0; i < stripe.data.length; i += 4) {
            if (stripe.data[i] > 145 && stripe.data[i + 1] > 145 && stripe.data[i + 2] > 145)
              xs.push(Math.ceil(left) + (i / 4) % stripe.width);
          }
          results[orientation].openingEnd = Math.max(...xs);
          results[orientation].expectedOpeningEnd = left + (rows[frames[2]].height - rows[0].height) /
            (rows[firstPriced - 1].height - rows[0].height) * (right - left);
          if (__SAVE_ARTIFACTS__) {
            results[orientation].data = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
            results[orientation].frame = finalImage;
            results[orientation].opening = decoded.toDataURL('image/png');
          }
        } finally { player.removeAttribute('src'); player.load(); URL.revokeObjectURL(url); }
      }
      return results;
    })()""".replace("__SAVE_ARTIFACTS__", "true" if artifact_dir else "false"))
    for orientation, expected in (("landscape", (1280, 720)), ("portrait", (720, 1280)), ("square", (720, 720))):
        result = videos[orientation]
        assert abs(result['openingEnd'] - result['expectedOpeningEnd']) < 4, result
        if artifact_dir:
            (artifact_dir / f"{orientation}-opening-video-frame.png").write_bytes(base64.b64decode(result.pop("opening").split(",", 1)[1]))
            (artifact_dir / f"{orientation}.{result['extension']}").write_bytes(base64.b64decode(result.pop("data").split(",", 1)[1]))
            (artifact_dir / f"{orientation}-video-frame.png").write_bytes(base64.b64decode(result.pop("frame").split(",", 1)[1]))
        assert (result["width"], result["height"]) == expected and result["duration"] >= 1.4, result
        assert result["size"] > 1000 and result["extension"] in ("mp4", "webm"), result
        assert result["pixel"][3] == 255 and max(result["pixel"][:3]) > 20, result

    cdp.evaluate("window.postMessage({type:'quantum-dashboard-theme', theme:'light'}, location.origin)")
    wait_for(lambda: cdp.evaluate("document.documentElement.dataset.theme === 'light'"), description="shared light theme message")
    for width in (390, 320):
        cdp.command("Emulation.setDeviceMetricsOverride", {
            "width": width, "height": 844, "deviceScaleFactor": 1, "mobile": True,
        })
        mobile = cdp.evaluate("""({ viewport: innerWidth,
          scroll: document.documentElement.scrollWidth,
          chart: document.getElementById('dashboardCanvas').getBoundingClientRect().width,
        })""")
        assert mobile["scroll"] <= mobile["viewport"] and mobile["chart"] > 200, mobile
    cdp.command("Emulation.setDeviceMetricsOverride", {
        "width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False,
    })
    cdp.command("Page.navigate", {"url": origin + "/mined_supply_price.html"})
    wait_for(lambda: cdp.evaluate("window.document.getElementById('modal-embed')?.contentWindow?.WSBMinedSupplyPriceDashboard?.getState()?.rows > 100"),
             description="mined supply standalone shell")
    embedded = cdp.evaluate("""(() => {
      const frame = document.getElementById('modal-embed');
      frame.contentWindow.document.getElementById('expandDashboard').click();
      return { shell: document.body.classList.contains('mined-supply-dashboard-expanded'),
        frame: frame.contentWindow.document.body.classList.contains('mined-supply-dashboard-expanded') };
    })()""")
    wait_for(lambda: cdp.evaluate("document.body.classList.contains('mined-supply-dashboard-expanded')"),
             description="standalone expand message")
    assert embedded["frame"] and cdp.evaluate("document.body.classList.contains('mined-supply-dashboard-expanded')"), embedded
    print("Passed: reference geometry and shared typography across all orientations at PNG/video resolutions in both themes, shared controls, live/retained/historical price, genesis range, playback, three decoded PNG/video layouts, frozen live final frame, mobile widths, and standalone expand")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, help="Save PNGs, short videos, and decoded final frames for visual review")
    args = parser.parse_args()
    if args.artifacts:
        args.artifacts.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with capture_workspace() as workspace:
            port = free_port()
            with (workspace / "chrome.log").open("w+") as log:
                chrome = subprocess.Popen([
                    find_chrome(), "--headless=new", "--disable-gpu", "--disable-dev-shm-usage",
                    "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
                    "--remote-allow-origins=*", f"--remote-debugging-port={port}",
                    f"--user-data-dir={workspace / 'profile'}", "about:blank",
                ], stdout=log, stderr=log, start_new_session=True)
                cdp = None
                try:
                    wait_for(lambda: urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=.5).read(),
                             description="Chrome DevTools endpoint")
                    request = urllib.request.Request(f"http://127.0.0.1:{port}/json/new?about:blank", method="PUT")
                    with urllib.request.urlopen(request, timeout=2) as response:
                        target = json.load(response)
                    cdp = CdpSocket(target["webSocketDebuggerUrl"])
                    cdp.command("Page.enable")
                    cdp.command("Runtime.enable")
                    check(cdp, f"http://127.0.0.1:{server.server_port}", args.artifacts)
                finally:
                    close_browser(chrome, cdp)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
