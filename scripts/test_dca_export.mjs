import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("webapps/dca_cost_basis/dashboard_app.js", root), "utf8");
const day = "2026-03-13";
const dates = ["2026-03-11", "2026-03-12", day];

function element(id) {
  const classes = new Set(), attributes = new Map();
  return { id, disabled: false, textContent: "", innerHTML: "", style: { setProperty() {} }, dataset: {},
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle(name, value) { if (value ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
    },
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: name => attributes.get(name) ?? null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    remove() {},
  };
}

function fixture() {
  const controls = new Map(["downloadImageBtn", "dateRangeDownloadBtn", "downloadSettingsDownloadBtn",
    "cadenceSelect", "dateRangeStartInput", "dateRangeEndInput", "dateRangePlayBtn", "dateRangePauseBtn",
    "dateRangeStopBtn", "dateRangeSettingsBtn"].map(id => [id, element(id)]));
  const downloads = [], renders = [], alerts = [], errors = [], canvases = [];
  const objects = new Map();
  const document = {
    documentElement: { dataset: { theme: "dark" } },
    visibilityState: "visible",
    body: { appendChild() {}, classList: element().classList },
    fonts: { ready: Promise.resolve() },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    getElementById: id => controls.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [...controls.values()],
    createElement(tag) {
      if (tag === "canvas") {
        const canvas = { width: 0, height: 0,
          getContext: () => ({}),
          toBlob: callback => callback(new Blob(["fixture PNG"], { type: "image/png" })),
        };
        canvases.push(canvas);
        return canvas;
      }
      if (tag === "a") return { remove() {}, click() {
        downloads.push({ filename: this.download, blob: objects.get(this.href) });
      } };
      return element(tag);
    },
  };
  const window = {
    location: { hostname: "localhost", origin: "http://localhost" },
    addEventListener() {},
    setTimeout: () => 1, clearTimeout() {}, clearInterval() {},
    WSBDashboardComponents: {},
    WSBDashboardExportBranding: { ready: async () => {} },
    alert: message => alerts.push(message),
  };
  window.parent = window;
  const sandbox = {
    document, window, Blob, AbortController, TextEncoder, Uint8Array, DataView,
    console: { warn() {}, log() {}, error: error => errors.push(error) },
    localStorage: { getItem: () => null, setItem() {} },
    CustomEvent: class {},
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    URL: { createObjectURL(blob) { const url = `blob:test-${objects.size}`; objects.set(url, blob); return url; }, revokeObjectURL() {} },
  };
  vm.createContext(sandbox);
  for (const name of ["dashboard_charting.js", "dashboard_export.js"])
    vm.runInContext(readFileSync(new URL(`webapps/shared/${name}`, root), "utf8"), sandbox);
  vm.runInContext(source.replace(/\binit\(\);\s*$/, `
    renderChart = () => {};
    syncDateRangeControls = () => {};
    saveDateRangeState = () => {};
    unbindDateRangePlaybackOutsidePointerActions = () => {};
    globalThis.api = {
      state, buildCadenceCaches, getFrameRows, getDateRangeExportEndIso,
      getDcaExportSnapshot, getDcaExportFrameOptions,
      getDownloadVideoSeconds, getDateRangeExportFrameDates,
      downloadDateRangeImage, downloadDateRangeAnimation, encodeDateRangeAnimationVideo,
      requestDateRangeExportCancel,
      get exporting() { return isDateRangeExporting; },
      setDraw(fn) { drawExportFrame = fn; },
      setQuote(quote) { dcaSpotFeed = { current: () => quote, newerThan: () => quote }; },
    };
  `), sandbox);
  const { api } = sandbox;
  api.state.metadata = { source: { latest_timestamp_utc: `${day}T19:00:00Z`, latest_block_height: 940548 } };
  api.state.priceRows = dates.map((dateIso, index) => ({ dateIso, timestampUtc: `${dateIso} 19:00:00`,
    blockHeight: 940546 + index, price: [100, 200, 400][index],
    utcDay: new Date(`${dateIso}T00:00:00Z`).getUTCDay(), monthDay: Number(dateIso.slice(8)),
  }));
  api.state.cadenceCaches = api.buildCadenceCaches(api.state.priceRows);
  Object.assign(api.state.dateRange, { startIso: dates[0], endIso: day, currentEndIso: day, rangeTracksLatestEnd: true });
  api.state.downloadSettings.endFrameHold = false;
  api.setDraw(async (...args) => renders.push(args));
  window.WSBDashboardExport.hasWebCodecsExportSupport = () => true;
  window.WSBDashboardExport.videoExtension = blob => blob.type === "video/mp4" ? "mp4" : "webm";
  window.WSBDashboardExport.encodeVideo = async options => {
    for (let index = 0; index < options.frames.length; index++) {
      if (options.isCanceled?.()) return null;
      await options.renderFrame(options.frames[index], options.canvas, index);
    }
    return new Blob(["fixture video"], { type: "video/mp4" });
  };
  return { api, sandbox, window, controls, downloads, renders, alerts, errors, canvases };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

for (const [orientation, width, height] of [["landscape", 3840, 2160], ["portrait", 2160, 3840], ["square", 2160, 2160]]) {
  test(`PNG uses 2160 quality in ${orientation} even without video support`, async () => {
    const f = fixture();
    f.api.state.downloadSettings.orientation = orientation;
    f.window.WSBDashboardExport.hasWebCodecsExportSupport = () => false;
    await f.api.downloadDateRangeImage();
    assert.equal(f.alerts.length, 0);
    assert.equal(f.downloads.length, 1);
    assert.equal(f.downloads[0].blob.type, "image/png");
    assert.match(f.downloads[0].filename, new RegExp(`${orientation}-2160p\\.png$`));
    assert.deepEqual([f.canvases[0].width, f.canvases[0].height], [width, height]);
    assert.equal(f.api.state.downloadSettings.quality, "720", "PNG must not overwrite the saved video quality");
    assert.equal(f.controls.get("downloadImageBtn").disabled, false);
    assert.equal(f.controls.get("dateRangeDownloadBtn").disabled, true, "unsupported video remains disabled after PNG");
    assert.equal(f.api.exporting, false);
    assert.equal(f.window.dateRangeExportActive, false);
  });
}

test("paused PNG and video use the visible published date, with matching estimates", async () => {
  const f = fixture();
  Object.assign(f.api.state.dateRange, { currentEndIso: dates[1], isPaused: true });
  f.api.setQuote({ price: 800, at: Date.parse(`${day}T20:00:00Z`) });
  assert.equal(f.api.getDateRangeExportEndIso(), dates[1]);
  assert.equal(f.api.getDownloadVideoSeconds(), 2 / 30);
  await f.api.downloadDateRangeImage();
  let record = f.renders.at(-1);
  assert.equal(record[2], dates[1]);
  assert.equal(record[5][0].currentPrice, 200, "a historical end date cannot inherit today's live quote");
  assert.equal(record[6].timestamp, `${dates[1]} 19:00:00`);
  assert.match(f.downloads.at(-1).filename, /2026-03-11-2026-03-12/);
  assert.equal(f.api.state.dateRange.isPaused, true, "PNG preserves the paused selection");
  f.renders.length = 0;
  await f.api.downloadDateRangeAnimation();
  record = f.renders.at(-1);
  assert.equal(record[2], dates[1]);
  assert.equal(record[5][0].currentPrice, 200);
  assert.equal(record[6].height, 940547);
  assert.match(f.downloads.at(-1).filename, /2026-03-11-2026-03-12-landscape-720p\.mp4$/);
  assert.equal(f.alerts.length, 0);
});

test("PNG freezes visible data, quote time, settings, and file name while assets load", async () => {
  const f = fixture(), ready = deferred();
  const quote = { price: 800, at: Date.parse(`${day}T20:01:00Z`) };
  f.api.setQuote(quote);
  f.window.WSBDashboardExportBranding.ready = () => ready.promise;
  const pending = f.api.downloadDateRangeImage();
  assert.equal(f.api.exporting, true);
  assert.equal(f.controls.get("downloadImageBtn").disabled, true);
  assert.equal(f.controls.get("dateRangeDownloadBtn").disabled, true);
  f.api.setQuote({ price: 1600, at: quote.at + 60_000 });
  f.api.state.cadence = "monthly_dca";
  f.api.state.timeZone = "America/New_York";
  f.api.state.showHalvings = false;
  f.api.state.metadata = { source: { latest_block_height: 999999 } };
  f.api.state.priceRows = [];
  f.api.state.cadenceCaches = {};
  Object.assign(f.api.state.dateRange, { startIso: dates[1], endIso: dates[1], currentEndIso: dates[1] });
  Object.assign(f.api.state.downloadSettings, { theme: "light", orientation: "square", scale: "log" });
  ready.resolve();
  await pending;
  assert.equal(f.alerts.length, 0);
  assert.equal(f.downloads.length, 1);
  assert.match(f.downloads[0].filename, /2026-03-11-2026-03-13-landscape-2160p\.png$/);
  const record = f.renders.at(-1), options = record[6];
  assert.equal(record[5][0].currentPrice, 800);
  assert.equal(record[5][0].dcaBasis, 800);
  assert.equal(options.timestamp, quote.at, "same-day live header follows its frozen quote, not the publication time");
  assert.equal(options.height, 940548, "live quotes preserve the published snapshot block height");
  assert.equal(options.cadence, "daily_dca");
  assert.equal(options.showHalvings, true);
  assert.equal(options.timeZone, "UTC");
  assert.equal(options.scale, "linear");
  assert.equal(options.theme, "dark");
  assert.equal(f.controls.get("downloadImageBtn").getAttribute("aria-busy"), "false");
});

test("video captures one final quote and preserves its rows and timestamp through the hold", async () => {
  const f = fixture();
  const openingQuote = { price: 800, at: Date.parse(`${day}T20:00:00Z`) };
  const finalQuote = { price: 1600, at: Date.parse(`${day}T20:01:00Z`) };
  f.api.setQuote(openingQuote);
  const snapshot = f.api.getDcaExportSnapshot();
  f.window.WSBDashboardExport.encodeVideo = async options => {
    for (let index = 0; index < options.frames.length; index++) {
      await options.renderFrame(options.frames[index], options.canvas, index);
      if (index === 1) {
        f.api.setQuote(finalQuote);
        f.api.state.cadence = "monthly_dca";
        f.api.state.metadata = { source: { latest_block_height: 999999 } };
        f.api.state.priceRows = [];
        f.api.state.cadenceCaches = {};
        f.api.state.dateRange.startIso = day;
      }
      if (index === 2) f.api.setQuote({ price: 3200, at: finalQuote.at + 60_000 });
    }
  };
  await f.api.encodeDateRangeAnimationVideo({ canvas: { width: 1280, height: 720 }, ctx: {},
    settings: { ...f.api.state.downloadSettings }, theme: "dark", palette: {},
    frameDates: [day, dates[0], day, day], snapshot,
  });
  assert.equal(f.renders[0][5][0].currentPrice, 400, "opening hold uses the published final date");
  assert.equal(f.renders[1][5][0].currentPrice, 100, "historical motion cannot use the future live quote");
  assert.equal(f.renders[2][5][0].currentPrice, 1600);
  assert.equal(f.renders[2][5][0].dcaBasis, 1600);
  assert.strictEqual(f.renders[2][5], f.renders[3][5], "ending hold reuses the captured derived rows");
  for (const record of f.renders.slice(2)) {
    assert.equal(record[6].timestamp, finalQuote.at);
    assert.equal(record[6].height, 940548);
    assert.equal(record[6].cadence, "daily_dca");
  }
});

test("missing assets and unavailable canvas recover export controls for a retry", async () => {
  const f = fixture();
  f.window.WSBDashboardExportBranding.ready = async () => { throw new Error("QR unavailable"); };
  await f.api.downloadDateRangeImage();
  assert.equal(f.downloads.length, 0);
  assert.match(f.alerts[0], /QR unavailable/);
  assert.equal(f.api.exporting, false);
  assert.equal(f.window.dateRangeExportActive, false);
  assert.equal(f.controls.get("downloadImageBtn").disabled, false);
  assert.equal(f.controls.get("dateRangeDownloadBtn").disabled, false);
  f.window.WSBDashboardExportBranding.ready = async () => {};
  const createElement = f.sandbox.document.createElement;
  f.sandbox.document.createElement = tag => tag === "canvas" ? { getContext: () => null } : createElement(tag);
  await f.api.downloadDateRangeImage();
  assert.equal(f.downloads.length, 0);
  assert.match(f.alerts[1], /Canvas rendering is unavailable/);
  assert.equal(f.api.exporting, false);
  f.sandbox.document.createElement = createElement;
  await f.api.downloadDateRangeImage();
  assert.equal(f.downloads.length, 1, "a failed asset/canvas attempt must not poison the next PNG");
});

test("video cancellation and encoder failure leave no file and allow another download", async () => {
  const f = fixture(), ready = deferred();
  f.window.WSBDashboardExportBranding.ready = () => ready.promise;
  const pending = f.api.downloadDateRangeAnimation();
  assert.equal(f.api.exporting, true);
  assert.equal(f.controls.get("downloadImageBtn").disabled, true);
  await f.api.downloadDateRangeAnimation();
  ready.resolve();
  await pending;
  assert.equal(f.downloads.length, 0);
  assert.equal(f.alerts.length, 0, "cancellation must not display an encoding error");
  assert.equal(f.api.exporting, false);
  assert.equal(f.controls.get("downloadImageBtn").disabled, false);
  assert.equal(f.controls.get("dateRangeDownloadBtn").classList.contains("is-canceling"), false);
  const encode = f.window.WSBDashboardExport.encodeVideo;
  f.window.WSBDashboardExport.encodeVideo = async () => { throw new Error("fixture encoder failure"); };
  await f.api.downloadDateRangeAnimation();
  assert.equal(f.downloads.length, 0);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.api.exporting, false);
  assert.equal(f.window.dateRangeExportActive, false);
  f.window.WSBDashboardExport.encodeVideo = encode;
  await f.api.downloadDateRangeAnimation();
  assert.equal(f.downloads.length, 1);
  assert.match(f.downloads[0].filename, /\.mp4$/);
});

function rendererFixture() {
  const calls = [], stack = [];
  const ctx = { font: "", fillStyle: "", strokeStyle: "", lineWidth: 1,
    textAlign: "left", textBaseline: "alphabetic", globalAlpha: 1,
    save() { stack.push({ font: this.font, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth, textAlign: this.textAlign, globalAlpha: this.globalAlpha }); },
    restore() { Object.assign(this, stack.pop()); },
    measureText(text) { return { width: String(text).length * (parseFloat(this.font) || 20) * 0.55 }; },
    fillText(text, x, y) { calls.push({ name: "text", text, x, y, color: this.fillStyle, font: this.font }); },
    stroke() { calls.push({ name: "stroke", color: this.strokeStyle, width: this.lineWidth }); },
  };
  for (const name of ["scale", "fillRect", "beginPath", "moveTo", "lineTo", "translate", "rotate", "rect", "clip", "setLineDash", "arc", "fill", "strokeText"])
    ctx[name] = (...args) => calls.push({ name, args });
  const branding = {
    ready: async () => {},
    setFont(context, size, role) { context.font = `${size}px WSB-${role}`; },
    drawWordmark(context, bounds, options) { calls.push({ name: "wordmark", bounds, options }); },
    drawFooter(context, slug, metrics, settings) { calls.push({ name: "footer", slug, metrics, settings }); },
  };
  // Simulate a browser in UTC-4 even if the test runner itself uses UTC.
  class LocalDate extends Date {
    constructor(value) {
      const local = typeof value === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value);
      super(local ? value.replace(" ", "T") + "-04:00" : value);
    }
  }
  const sandbox = { window: { WSBDashboardExportBranding: branding }, Date: LocalDate };
  vm.createContext(sandbox);
  for (const path of ["webapps/shared/dashboard_charting.js", "webapps/dca_cost_basis/dca_cost_basis_export.js"])
    vm.runInContext(readFileSync(new URL(path, root), "utf8"), sandbox);
  return { E: sandbox.window.WSBDCACostBasisExport, ctx, calls };
}

test("renderer keeps published timestamps in UTC on a non-UTC browser", () => {
  const { E, ctx, calls } = rendererFixture();
  const result = E.render(ctx, 1920, 1080, { rows: [{ daysAgo: 1, dateIso: day,
    historicalPrice: 71072, dcaBasis: 71072, currentPrice: 71072, blockHeight: 940548 }],
    timestamp: `${day} 19:00:00`, height: 940548, timeZone: "UTC", theme: "dark", scale: "linear" });
  assert.equal(result.timestamp, "Mar 13, 2026 19:00 (UTC)");
  assert.ok(calls.some(call => call.name === "text" && call.text === "940548"));
  assert.ok(calls.some(call => call.name === "arc"), "a single daily purchase remains visible");
});

for (const [orientation, width, height] of [["landscape", 3840, 2160], ["portrait", 2160, 3840], ["square", 2160, 2160]]) {
  test(`renderer produces finite chart geometry and shared branding in ${orientation}`, () => {
    for (const scale of ["linear", "log"]) for (const theme of ["dark", "light"]) {
      const { E, ctx, calls } = rendererFixture();
      const rows = Array.from({ length: 5200 }, (_, index) => ({
        daysAgo: index + 1, dateIso: new Date(Date.parse(`${day}T00:00:00Z`) - index * 86400000).toISOString().slice(0, 10),
        historicalPrice: 71072 / (1 + index / 10), dcaBasis: 71072 / (1 + index / 20),
        currentPrice: 71072, isPriceAbove: index % 2,
      }));
      const originalFirst = { ...rows[0] };
      const result = E.render(ctx, width, height, { rows, timestamp: `${day}T19:00:00Z`,
        height: 940548, cadence: "weekly_dca", showHalvings: true, timeZone: "UTC", theme, scale });
      assert.equal(result.layout.orientation, orientation);
      assert.deepEqual(rows[0], originalFirst, "rendering must not alter the data snapshot");
      for (const call of calls) {
        for (const arg of call.args || []) if (typeof arg === "number") assert.ok(Number.isFinite(arg), JSON.stringify(call));
        if (call.name === "text") assert.ok(Number.isFinite(call.x) && Number.isFinite(call.y), JSON.stringify(call));
      }
      assert.ok(calls.some(call => call.name === "wordmark" && call.options.theme === theme));
      assert.ok(calls.some(call => call.name === "footer" && call.slug === "dca_cost_basis"
        && call.settings.orientation === orientation && call.settings.theme === theme));
      assert.ok(calls.some(call => call.name === "text" && call.text === "Weekly DCA Duration"));
      assert.ok(calls.some(call => call.name === "text" && call.text === "Cost Basis" && call.color === "#ff9900"));
      for (const color of ["#ff9900", "#469B54", "#BD2D31"])
        assert.ok(calls.some(call => call.name === "stroke" && call.color === color), `missing notebook series color ${color}`);
      assert.ok(result.yTicks.length >= 2 && result.yTicks.every(Number.isFinite));
      assert.equal(result.currentPrice, 71072);
    }
  });
}
