(function () {
  const key = "quantum-research-dashboard-theme";
  function theme(value) { document.documentElement.dataset.theme = value === "light" ? "light" : "dark"; document.dispatchEvent(new CustomEvent("dashboard-theme-change")); }
  try { theme(localStorage.getItem(key)); } catch (_) { theme("dark"); }
  window.addEventListener("storage", (event) => { if (event.key === key) theme(event.newValue); });
  window.addEventListener("message", (event) => { if (event.data?.type === "quantum-dashboard-theme") theme(event.data.theme); });
}());

(function () {
  "use strict";
  const M = window.WSBEOEGrowthModel, G = window.WSBEOEGrowthCharts, X = window.WSBEOEGrowthExport;
  const C = window.WSBDashboardComponents, E = window.WSBDashboardExport, refresh = window.WSBWebappDataAutoRefresh;
  const STORAGE = "eoe_growth_dashboard_state_v1", DOWNLOAD_STORAGE = "eoe_growth_download_settings_v1";
  const SPEEDS = [0.5, 1, 2, 4], $ = (id) => document.getElementById(id);
  const defaults = () => ({ startIso: "", endIso: "", currentIso: "", tracksLatest: true, speed: 1, preset: "full", height: 650, autoHeight: true,
    timeZone: window.WSBDashboardTime?.getPreferredTimeZone?.() || "UTC" });
  const read = (key) => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (_) { return null; } };
  let state = defaults(), model = null, installed = null, frame = null, geometry = null;
  let playing = false, session = false, raf = 0, lastTime = 0, elapsed = 0, lastSave = 0, announcedSession = null;
  let exporting = false, cancelExport = false, drag = null, resize = null, hover = null, dirty = false;
  let undo = null, undoTimer = 0, estimateKey = "", pendingPlay = false;
  let liveFeed = null, livePaintTimer = 0, lastLivePaint = 0;
  let exportController = null;
  const range = C.createIndexDateRangeController({ getRows: () => model?.rows || [], getDate: (row) => row.date });
  const index = (iso) => range.clampIndex(range.findIndex(iso));
  const calendarIcon = $("startDateBtn").querySelector("svg").outerHTML;
  const dateLabel = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(2, 4)}`;
  const capture = () => ({ ...state, pausedPlayback: session });
  function save() { if (!model) return; try { localStorage.setItem(STORAGE, JSON.stringify(capture())); } catch (_) {} lastSave = performance.now(); }
  function normalize(source = {}, fromUrl = false, sourceModel = model) {
    const next = defaults(), rows = sourceModel.rows, first = rows[0].date, last = rows.at(-1).date;
    const date = (value, fallback) => {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
      const time = Date.parse(value + "T00:00:00Z");
      if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return fallback;
      return rows[M.indexAtTime(sourceModel, time)].date;
    };
    next.startIso = date(source.startIso, first); next.tracksLatest = source.tracksLatest !== false;
    next.endIso = !fromUrl && next.tracksLatest ? last : date(source.endIso, last);
    if (next.startIso > next.endIso) next.startIso = next.endIso;
    next.currentIso = source.pausedPlayback ? date(source.currentIso, next.endIso) : next.endIso;
    next.currentIso = next.currentIso < next.startIso ? next.startIso : next.currentIso > next.endIso ? next.endIso : next.currentIso;
    next.speed = SPEEDS.includes(Number(source.speed)) ? Number(source.speed) : 1;
    next.preset = ["full", "ytd", "1y", "2y", "4y", "8y", "custom"].includes(source.preset) ? source.preset : "full";
    next.height = Math.max(400, Math.min(4000, Number(source.height) || 650));
    // Migrate the former fixed default; retain explicitly resized layouts.
    next.autoHeight = typeof source.autoHeight === "boolean" ? source.autoHeight : next.height === 650;
    try { if (source.timeZone) { new Intl.DateTimeFormat("en", { timeZone: source.timeZone }); next.timeZone = source.timeZone; } } catch (_) {}
    return next;
  }
  function status(message, error = false) { $("loadStatus").textContent = message; $("loadStatus").hidden = !message; $("loadStatus").classList.toggle("error", error); }
  function clearHover() { hover = null; $("chartTooltip").hidden = true; }
  function usesLivePrice() { return !session && state.tracksLatest && state.currentIso === model?.rows.at(-1).date; }
  function currentFrame() {
    const current = usesLivePrice() ? liveFeed?.current(installed) : null;
    return (current && M.liveFrame(model, current)) || M.frame(model, index(state.currentIso));
  }
  function presentLivePrice(reason) {
    if (!model || !usesLivePrice()) return;
    if (document.hidden || exporting || drag || resize) { dirty = true; return; }
    // New block/reference pairs are infrequent and should paint as soon as
    // validation finishes, even when a price repaint is already pending.
    if (reason === "reference") {
      clearTimeout(livePaintTimer); livePaintTimer = 0;
      lastLivePaint = performance.now(); render();
      return;
    }
    // Batch frequent price ticks; the feed retains the newest quote in between.
    if (!livePaintTimer) livePaintTimer = setTimeout(() => {
      livePaintTimer = 0;
      if (document.hidden || exporting || drag || resize) { dirty = true; return; }
      if (usesLivePrice()) { lastLivePaint = performance.now(); render(); }
    }, Math.max(0, 1000 - (performance.now() - lastLivePaint)));
  }
  function tooltipGrowthColor(value, theme) {
    if (!Number.isFinite(value)) return "var(--muted)";
    const color = G.growthTextColor(value, theme);
    const rgb = color.startsWith("#") ? color.slice(1).match(/../g).map((part) => parseInt(part, 16)) : color.match(/\d+/g).map(Number);
    const dark = theme !== "light", target = dark ? 255 : 0;
    // The chart palette has nearly black and pale endpoints. Preserve its hue
    // while keeping small tooltip text at least 4.5:1 against the panel.
    for (let step = 0; step <= 20; step++) {
      const mixed = rgb.map((channel) => Math.round(channel + (target - channel) * step / 20));
      const linear = mixed.map((channel) => { const v = channel / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
      const luminance = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
      if ((dark ? (luminance + .05) / .05 : 1.05 / (luminance + .05)) >= 4.5) return `rgb(${mixed.join(",")})`;
    }
  }
  function renderTooltip(rows) {
    const content = document.createDocumentFragment(), theme = document.documentElement.dataset.theme;
    rows.forEach((row, i) => {
      const source = row.source === "block-reference" ? `Historical price ${new Date(row.priceTime).toISOString()}\nBlock ${row.height.toLocaleString()} · ${new Date(row.blockTime).toISOString()}`
        : row.source === "live" || row.source === "retained" ? `${row.source === "live" ? "Live" : "Retained"} quote ${new Date(row.quoteAt).toISOString()}` : row.date;
      if (i) content.append("\n");
      content.append(`E${row.epoch} · ${source}\n${row.price === 0 ? "Not Valued" : G.kpiMoney(row.price)} · EOE `);
      const growth = document.createElement("span");
      growth.className = "tooltip-growth"; growth.textContent = G.growthLabel(row.growth);
      growth.style.color = tooltipGrowthColor(row.growth, theme); content.append(growth);
    });
    $("chartTooltip").replaceChildren(content);
  }
  const updated = C.createUpdatedTimeZoneChipController({ getTimeZone: () => state.timeZone,
    setTimeZone: (zone) => { state.timeZone = window.WSBDashboardTime?.setPreferredTimeZone?.(zone) || zone; save(); return state.timeZone; },
    onChange: () => { if (model) sync(); } });
  const runtime = window.WSBDashboardComponents.initDashboardRuntime({ getShareUrl: () => C.buildShareUrl({ slug: "eoe_growth", state: capture() }),
    onReset: () => {
      if (!model || exporting) return;
      pause(false); clearHover(); drag = null;
      if (undo) { state = normalize(undo, true); session = !!undo.pausedPlayback; undo = null; }
      else { undo = capture(); state = normalize(); session = false; clearTimeout(undoTimer); undoTimer = setTimeout(() => { undo = null; sync(); }, 8000); }
      updated.syncDropdown(); render(); save();
    } });
  function sync(view = model ? currentFrame() : null) {
    if (!model) return;
    const start = index(state.startIso), end = index(state.endIso), current = index(state.currentIso), max = model.rows.length - 1;
    $("startDateInput").value = state.startIso; $("endDateInput").value = state.currentIso;
    $("startDateInput").min = model.rows[0].date; $("startDateInput").max = state.currentIso;
    $("endDateInput").min = state.startIso; $("endDateInput").max = model.rows.at(-1).date;
    $("startDateBtn").innerHTML = calendarIcon + "<span>" + dateLabel(state.startIso) + "</span>";
    $("endDateBtn").innerHTML = calendarIcon + "<span>" + dateLabel(state.currentIso) + "</span>";
    for (const [id, value] of [["dateRangeStartSlider", start], ["dateRangeEndSlider", current]]) {
      $(id).min = 0; $(id).max = max; $(id).value = value; $(id).setAttribute("aria-valuetext", model.rows[value].date);
    }
    const percent = (value) => `${100 * value / Math.max(1, max)}%`;
    $("dateRangeSliderWrap").style.setProperty("--slider-start", percent(start)); $("dateRangeSliderWrap").style.setProperty("--slider-end", percent(current));
    $("dateRangeSliderWrap").style.setProperty("--available-start", "0%"); $("dateRangeSliderWrap").style.setProperty("--available-end", "100%");
    $("dateRangeSelection").classList.toggle("active", session && end > current);
    $("dateRangeSelection").style.left = percent(current); $("dateRangeSelection").style.right = `calc(100% - ${percent(end)})`;
    if (document.activeElement !== $("rangeDaysInput")) $("rangeDaysInput").value = (current - start + 1).toLocaleString("en-US");
    $("rangeDaysInput").max = model.rows.length;
    $("playBtn").disabled = playing || exporting; $("pauseBtn").disabled = !playing || exporting; $("stopBtn").disabled = !session || exporting;
    $("playBtn").classList.toggle("is-playing", playing); $("pauseBtn").classList.toggle("is-paused", session && !playing);
    $("playBtn").setAttribute("aria-pressed", String(playing)); $("speedBtn").textContent = `${state.speed}x`;
    $("playBtn").setAttribute("aria-label", session ? "Resume playback" : "Play date range animation");
    document.querySelectorAll("[data-range-preset]").forEach((button) => { const selected = !session && button.dataset.rangePreset === state.preset; button.classList.toggle("is-active", selected); button.setAttribute("aria-pressed", String(selected)); });
    const row = view.row, currentValue = view.current;
    $("epochKpi").textContent = row.epoch; $("countKpi").textContent = row.epochBlockCount.toLocaleString("en-US");
    $("previousPriceLabel").textContent = row.epoch > 1 ? `Epoch ${row.epoch - 1} Price` : "Previous Epoch Price";
    $("priceLabel").textContent = `Epoch ${row.epoch} Price`; $("priceKpi").textContent = row.price === 0 ? "Not Valued" : G.kpiMoney(row.price);
    $("previousPriceKpi").textContent = row.previousPrice === 0 ? "Not Valued" : G.kpiMoney(row.previousPrice);
    $("growthKpi").textContent = G.growthLabel(row.growth);
    // The swatch supplies the palette; text stays readable even at its dark endpoints.
    $("growthKpi").style.borderBottom = Number.isFinite(row.growth) ? `3px solid ${G.growthColor(row.growth)}` : "";
    $("growthKpi").title = row.growth == null ? "No valued previous-epoch comparison is available." : currentValue ? "Growth from the price nearest the timestamp of the block exactly 210,000 heights earlier." : "Growth from the previous epoch’s nearest daily block-count observation.";
    $("priceChip").dataset.priceSource = currentValue ? (currentValue.live ? "live" : "retained") : "published";
    $("priceLiveStatus").dataset.kind = currentValue?.live ? "live" : "stale";
    $("priceChip").title = currentValue
      ? `${currentValue.live ? "Green" : "Gray"} dot: ${currentValue.quote.source} BTC/USD quote at ${new Date(currentValue.quote.at).toISOString()}. ${currentValue.live ? "" : "Retained while awaiting a fresh quote."}`
      : `Gray dot: published daily price for ${row.date}. Live comparison appears when a current quote and its exact previous-epoch reference are available.`;
    $("previousPriceChip").title = currentValue
      ? `Block ${currentValue.reference.height.toLocaleString("en-US")} (${new Date(currentValue.reference.blockTime).toISOString()}). Closest historical price: ${new Date(currentValue.reference.priceTime).toISOString()}.`
      : "Previous epoch’s nearest published daily block count.";
    updated.setUpdated(currentValue ? new Date(currentValue.quote.at).toISOString() : installed.publishedAt,
      { includeHeight: true, height: currentValue ? row.height : installed.latestHeight });
    $("chipUpdated").dataset.chainSource = currentValue?.tip.source === "mempool"
      ? (currentValue.chainLive ? "live" : "retained") : "published";
    $("chipUpdated").title = currentValue
      ? `Quote time: ${new Date(currentValue.quote.at).toISOString()}. ${currentValue.tip.source === "mempool" ? (currentValue.chainLive ? "Live network block" : "Retained network block") : "Published block"}: ${row.height.toLocaleString("en-US")}, mined ${new Date(currentValue.tip.blockTime).toISOString()}.`
      : `Published snapshot: ${installed.publishedAt}. Selected observation: ${row.date}, block ${row.height.toLocaleString("en-US")}.`;
    $("epochChart").setAttribute("aria-label", `Bitcoin prices through ${row.date}, epoch ${row.epoch}, block count ${row.epochBlockCount.toLocaleString("en-US")}. Current price ${$("priceKpi").textContent}; epoch-over-epoch growth ${G.growthLabel(row.growth)}. Logarithmic USD axis.`);
    if (state.autoHeight) $("epochPanel").style.removeProperty("--epoch-chart-height");
    else $("epochPanel").style.setProperty("--epoch-chart-height", `${state.height}px`);
    window.WSBDashboardPlaybackActive = session; window.dateRangePlaybackActive = session;
    if (session !== announcedSession) {
      announcedSession = session;
      window.parent.postMessage({ type: "wsb-eoe-growth-date-range-playback-active", active: session }, location.origin);
    }
    runtime.actions.syncResetState({ isUndo: !!undo, disabled: JSON.stringify(state) === JSON.stringify(normalize()) && !session });
    updateEstimates();
  }
  function render() {
    if (!model) return;
    if (document.hidden || exporting) { dirty = true; return; }
    dirty = false; frame = currentFrame(); sync(frame);
    const canvas = $("epochChart"), { ctx, width, height } = G.setup(canvas);
    geometry = G.panel(ctx, { x: 0, y: 0, width, height }, { frame, theme: document.documentElement.dataset.theme, hoverBlockCount: hover?.count ?? null });
    canvas.dataset.endDate = frame.row.date;
    canvas.dataset.priceSource = $("priceChip").dataset.priceSource;
    if (hover && !$("chartTooltip").hidden) renderTooltip(G.inspect(frame, hover.count));
  }
  function setRange(start, end, preset = "custom") {
    if (!model || exporting) return;
    pause(false); clearHover(); session = false;
    start = range.clampIndex(start); end = Math.max(start, range.clampIndex(end));
    state.startIso = model.rows[start].date; state.endIso = model.rows[end].date; state.currentIso = state.endIso;
    state.tracksLatest = end === model.rows.length - 1; state.preset = preset; undo = null; render(); save();
  }
  function seek(value, allowBeyondTarget = false) {
    if (!model || exporting) return;
    clearHover(); session = true; state.currentIso = model.rows[Math.max(index(state.startIso), Math.min(allowBeyondTarget ? model.rows.length - 1 : index(state.endIso), Math.round(value)))].date;
    elapsed = 0; lastTime = 0; render(); save();
  }
  function step(time) {
    if (!playing) return;
    if (document.hidden) { lastTime = 0; raf = requestAnimationFrame(step); return; }
    if (!lastTime) lastTime = time;
    elapsed += Math.min(100, time - lastTime) * 60 / 1000 * state.speed; lastTime = time;
    const count = Math.floor(elapsed);
    if (count) {
      elapsed -= count; const next = Math.min(index(state.endIso), index(state.currentIso) + count); state.currentIso = model.rows[next].date;
      if (next === index(state.endIso)) { stop(); return; }
      render(); if (time - lastSave > 500) save();
    }
    raf = requestAnimationFrame(step);
  }
  function play() {
    if (!model) { pendingPlay = true; return; }
    if (exporting || playing) return;
    if (!session) state.currentIso = state.startIso;
    clearHover(); playing = true; session = true; lastTime = 0; elapsed = 0; raf = requestAnimationFrame(step); render(); save();
  }
  function pause(paint = true) { playing = false; cancelAnimationFrame(raf); lastTime = 0; if (paint) { render(); save(); } }
  function stop(options = {}) {
    if (!model || exporting) return;
    pause(false);
    if (session && options.restoreOriginalRange === false) {
      state.endIso = state.currentIso; state.tracksLatest = state.endIso === model.rows.at(-1).date; state.preset = "custom";
    }
    session = false; state.currentIso = state.endIso; drag = null; clearHover(); render(); save();
  }
  function preset(value) {
    const end = model.rows.length - 1, date = new Date(model.rows[end].time);
    if (value === "ytd") date.setUTCMonth(0, 1); else if (value !== "full") date.setUTCFullYear(date.getUTCFullYear() - Number.parseInt(value, 10));
    setRange(value === "full" ? 0 : index(date.toISOString().slice(0, 10)), end, value);
  }
  const downloadDefaults = { orientation: "landscape", quality: "720", fps: "60", theme: "dark", fastIntro: true, endFrameHold: true };
  function normalizeDownload(value = {}) {
    const result = { ...downloadDefaults };
    for (const [key, choices] of Object.entries({ orientation: ["landscape", "portrait", "square"], quality: ["720", "1080", "1440", "2160"], fps: ["30", "60", "120", "240"], theme: ["dark", "light"] })) {
      if (choices.includes(String(value[key]))) result[key] = String(value[key]);
    }
    result.fastIntro = value.fastIntro !== false;
    result.endFrameHold = value.endFrameHold !== false; return result;
  }
  const downloads = C.createDownloadSettingsController({ storageKey: DOWNLOAD_STORAGE, defaults: downloadDefaults, normalize: normalizeDownload,
    groups: Object.fromEntries(["orientation", "quality", "fps", "theme"].map((key) => [key, { group: $("download" + key[0].toUpperCase() + key.slice(1) + "Select") }])),
    checkboxes: { fastIntro: { checkbox: $("downloadFastIntroToggle"), defaultValue: true },
      endFrameHold: { checkbox: $("downloadEndFrameHoldToggle"), defaultValue: true } }, afterWrite: () => updateEstimates() });
  function frames(settings) {
    if (!model) return [];
    return M.exportFrames(model, { startIndex: index(state.startIso), endIndex: index(state.currentIso),
      speed: Number(settings.fps) / 60, fastIntro: settings.fastIntro, endFrameHold: settings.endFrameHold });
  }
  function updateEstimates() {
    if (!model) return;
    const settings = normalizeDownload(downloads.readControls()), key = JSON.stringify([settings, state.startIso, state.currentIso]);
    if (key === estimateKey) return; estimateKey = key;
    const list = frames(settings), estimate = window.WSBDashboardExport.estimateDownload(settings, { frameCount: list.length, uniqueFrameCount: new Set(list).size, chartCount: 1, outputFps: 30 });
    E.writeEstimateElements({ size: $("downloadEstimateSize"), length: $("downloadEstimateLength"), time: $("downloadEstimateTime") }, estimate);
    if (!E.hasWebCodecsExportSupport()) {
      $("dateRangeDownloadBtn").disabled = true; $("downloadSettingsDownloadBtn").disabled = true;
      $("dateRangeDownloadBtn").title = "Video requires a browser with WebCodecs. PNG remains available.";
    }
  }
  function drawOutput(canvas, snapshot, settings, endIndex, view = null) {
    const { width, height } = E.getDimensions(settings);
    if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height;
    X.render(canvas.getContext("2d"), width, height, { frame: view || M.frame(snapshot.model, endIndex), theme: settings.theme });
  }
  async function captureExportFrame(snapshot) {
    if (snapshot.useLivePrice) {
      // The shared feeds pause in background tabs. Resume them before asking
      // for the final comparison, while allowing cancellation to release us.
      do {
        if (document.hidden && !snapshot.signal.aborted) await new Promise((resolve) => {
          const resume = () => {
            if (document.hidden && !snapshot.signal.aborted) return;
            document.removeEventListener("visibilitychange", resume);
            snapshot.signal.removeEventListener("abort", resume);
            resolve();
          };
          document.addEventListener("visibilitychange", resume);
          snapshot.signal.addEventListener("abort", resume, { once: true });
        });
        if (snapshot.signal.aborted) return M.frame(snapshot.model, snapshot.endIndex);
        await liveFeed?.refresh();
      } while (document.hidden && !snapshot.signal.aborted);
      if (snapshot.signal.aborted) return M.frame(snapshot.model, snapshot.endIndex);
      // Sample the newest available quote after refreshing the complete chain/
      // reference pair. Reuse this immutable result throughout the frame's hold.
      const current = liveFeed?.current(snapshot.publication);
      const view = current && M.liveFrame(snapshot.model, current);
      if (view) return view;
    }
    return M.frame(snapshot.model, snapshot.endIndex);
  }
  function download(blob, extension, date) {
    const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `eoe-growth-${date}.${extension}`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportFile(video) {
    if (exporting) { if (video) { cancelExport = true; exportController?.abort(); $("dateRangeDownloadBtn").classList.add("is-canceling"); } return; }
    if (!model) return;
    if (video && !E.hasWebCodecsExportSupport()) { status("Video export is unavailable in this browser. PNG export is available.", true); return; }
    const snapshot = { model, endIndex: index(state.currentIso), date: state.currentIso,
      publication: { publishedAt: installed.publishedAt, latestHeight: installed.latestHeight } };
    // An earlier selected or paused End remains historical, even when the
    // original playback range targeted the latest date.
    snapshot.useLivePrice = snapshot.endIndex === snapshot.model.rows.length - 1;
    const settings = normalizeDownload(downloads.readControls());
    const list = video ? frames(settings) : [], wasPlaying = playing, canvas = document.createElement("canvas");
    if (!video) settings.quality = "2160";
    pause(false); clearHover(); exporting = true; cancelExport = false;
    exportController = new AbortController(); snapshot.signal = exportController.signal;
    const controls = new Map(), buttonMarkup = $("dateRangeDownloadBtn").innerHTML;
    document.querySelectorAll("button,input,select").forEach((element) => { controls.set(element, element.disabled); element.disabled = !(video && ["dateRangeDownloadBtn", "downloadSettingsDownloadBtn"].includes(element.id)); });
    window.dateRangeExportActive = window.wsbDashboardExportActive = true;
    window.parent.postMessage({ type: "wsb-eoe-growth-date-range-export-active", active: true }, location.origin);
    function progress(value) {
      $("dateRangeDownloadBtn").classList.add("is-exporting"); $("dateRangeDownloadBtn").setAttribute("aria-label", "Cancel animation download"); $("dateRangeDownloadBtn").title = "Cancel download";
      $("dateRangeDownloadBtn").innerHTML = `<span class="date-range-export-progress" style="--date-range-export-progress:${Math.round(value * 100)}%" aria-hidden="true"><span class="date-range-export-stop-square"></span></span>`;
      $("downloadSettingsDownloadBtn").textContent = "Stop Download"; $("downloadSettingsDownloadBtn").classList.add("is-stop-download");
    }
    try {
      if (video) progress(0);
      await X.ready(); await document.fonts.ready;
      let blob;
      if (video) {
        const { width, height } = E.getDimensions(settings);
        // A one-day range has no earlier source index to mark the boundary,
        // but its one-second opening preview must still precede final capture.
        let finalStart = settings.endFrameHold ? 30 : 0, openingFrame = null, finalFrame = null;
        list.forEach((endIndex, frameIndex) => { if (endIndex !== snapshot.endIndex) finalStart = frameIndex + 1; });
        blob = await E.encodeVideo({ canvas, width, height, settings, fps: 30, frames: list, title: "Epoch-Over-Epoch Growth",
          renderFrame: async (endIndex, _canvas, frameIndex) => {
            let view = null;
            if (snapshot.useLivePrice && endIndex === snapshot.endIndex) {
              if (frameIndex >= finalStart) {
                if (!finalFrame) { finalFrame = await captureExportFrame(snapshot); snapshot.date = finalFrame.row.date; }
                view = finalFrame;
              } else {
                // The optional opening preview has its own snapshot; it must
                // not freeze the ending before historical motion is encoded.
                if (!openingFrame) openingFrame = await captureExportFrame(snapshot);
                view = openingFrame;
              }
            }
            if (!cancelExport) drawOutput(canvas, snapshot, settings, endIndex, view);
          }, isCanceled: () => cancelExport, onProgress: progress });
      } else {
        const view = await captureExportFrame(snapshot); snapshot.date = view.row.date;
        drawOutput(canvas, snapshot, settings, snapshot.endIndex, view);
        blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      }
      if (!blob && !cancelExport) throw new Error("The browser could not create the selected export.");
      if (blob && !cancelExport) { download(blob, video ? E.videoExtension(blob) : "png", snapshot.date); status(""); }
    } catch (error) { status(`Export failed: ${error.message}`, true); }
    finally {
      exportController.abort(); exportController = null;
      exporting = false; controls.forEach((disabled, element) => { element.disabled = disabled; });
      $("dateRangeDownloadBtn").innerHTML = buttonMarkup; $("dateRangeDownloadBtn").classList.remove("is-exporting", "is-canceling"); $("dateRangeDownloadBtn").setAttribute("aria-label", "Download date range animation"); $("dateRangeDownloadBtn").title = "Download animation";
      $("downloadSettingsDownloadBtn").textContent = "Download Animation"; $("downloadSettingsDownloadBtn").classList.remove("is-stop-download");
      window.dateRangeExportActive = window.wsbDashboardExportActive = false;
      window.parent.postMessage({ type: "wsb-eoe-growth-date-range-export-active", active: false }, location.origin);
      render(); refresh.requestCheck("export-finished"); if (wasPlaying) play();
    }
  }
  function install(candidate) {
    if (exporting || drag || resize) return false;
    const initial = !model, shared = initial ? C.readShareState() : null, source = initial ? (shared || read(STORAGE) || {}) : capture();
    const next = normalize(source, !!shared || !initial, candidate.model);
    if (!initial && state.tracksLatest && state.endIso === model.rows.at(-1).date) {
      next.endIso = candidate.model.rows.at(-1).date; if (!session) next.currentIso = next.endIso;
    }
    const nextFrame = M.frame(candidate.model, M.indexAtTime(candidate.model, Date.parse(next.currentIso + "T00:00:00Z")));
    model = candidate.model; installed = candidate; state = next; frame = nextFrame;
    if (initial) session = !!source.pausedPlayback;
    clearHover(); updated.syncDropdown(); $("chartLoader").hidden = true; document.body.dataset.ready = "true"; status(""); render();
    if (pendingPlay) { pendingPlay = false; play(); }
    liveFeed?.refresh();
    return true;
  }
  function setMenu(open, returnFocus = false) {
    C.setFloatingMenuOpen({ menu: $("dateRangeSettingsMenu"), button: $("dateRangeSettingsBtn") }, open);
    if (!open && returnFocus) $("dateRangeSettingsBtn").focus();
  }
  function expand(value) {
    document.body.classList.toggle("eoe-growth-dashboard-expanded", value); $("dashboardExpandBtn").classList.toggle("is-expanded", value);
    $("dashboardExpandBtn").setAttribute("aria-pressed", String(value));
    window.parent.postMessage({ type: "wsb-eoe-growth-dashboard-expanded", expanded: value }, location.origin); render();
  }
  function bind() {
    let dateTrigger = null;
    const pickers = window.WSBDashboardComponents.bindDateRangePickers({ isDisabled: () => !model || exporting, onSelect: (which, iso) => {
      const start = which === "start" ? index(iso) : index(state.startIso), end = which === "end" ? index(iso) : index(state.currentIso);
      if (start > end) { status("Start must be on or before End. Keeping the previous range.", true); return; }
      setRange(start, end); status("");
    } });
    for (const id of ["startDateBtn", "endDateBtn"]) $(id).addEventListener("click", () => { dateTrigger = $(id); });
    for (const which of ["start", "end"]) $(which + "DateInput").addEventListener("change", (event) => {
      if (!model || !event.target.value || exporting) return;
      const a = which === "start" ? index(event.target.value) : index(state.startIso), b = which === "end" ? index(event.target.value) : index(state.currentIso);
      if (a > b) { status("Start must be on or before End. Keeping the previous range.", true); sync(); } else { setRange(a, b); status(""); }
    });
    $("playBtn").addEventListener("click", play); $("pauseBtn").addEventListener("click", () => pause()); $("stopBtn").addEventListener("click", stop);
    $("speedBtn").addEventListener("click", () => { if (!model || exporting) return; state.speed = SPEEDS[(SPEEDS.indexOf(state.speed) + 1) % SPEEDS.length]; render(); save(); });
    $("rangeButtons").addEventListener("click", (event) => { const button = event.target.closest("[data-range-preset]"); if (button && model && !exporting) preset(button.dataset.rangePreset); });
    $("rangeDaysInput").addEventListener("change", (event) => {
      if (!model || exporting) return;
      const text = event.target.value.replaceAll(",", ""), days = /^\d+$/.test(text) ? Number(text) : NaN;
      if (!Number.isSafeInteger(days) || days < 1 || days > model.rows.length) { event.target.setAttribute("aria-invalid", "true"); status(`Enter 1–${model.rows.length.toLocaleString()} days. Keeping the previous range.`, true); return; }
      event.target.removeAttribute("aria-invalid"); status(""); setRange(Math.max(0, index(state.currentIso) - days + 1), index(state.currentIso));
    });
    $("dateRangeStartSlider").addEventListener("input", (event) => { if (model && !exporting) setRange(Math.min(Number(event.target.value), index(state.currentIso)), index(state.currentIso)); });
    $("dateRangeEndSlider").addEventListener("input", (event) => { if (!model || exporting) return; if (session) seek(Number(event.target.value), true); else setRange(index(state.startIso), Number(event.target.value)); });
    const wrap = $("dateRangeSliderWrap");
    wrap.addEventListener("pointerdown", (event) => {
      if (!model || exporting || event.button !== 0) return;
      const rect = wrap.getBoundingClientRect(), a = index(state.startIso), b = index(state.currentIso), position = range.indexFromPointer(event.clientX, wrap);
      if (!Number.isFinite(rect.width) || rect.width <= 0) return;
      const x0 = rect.left + range.indexPercent(a) * rect.width / 100, x1 = rect.left + range.indexPercent(b) * rect.width / 100;
      const nearA = Math.abs(event.clientX - x0) <= 12, nearB = Math.abs(event.clientX - x1) <= 12;
      const mode = event.target === $("dateRangeStartSlider") ? "start" : event.target === $("dateRangeEndSlider") ? "end"
        : nearA && (!nearB || Math.abs(event.clientX - x0) <= Math.abs(event.clientX - x1)) ? "start" : nearB || session ? "end" : position > a && position < b ? "range" : "";
      if (!mode) return;
      if (session && mode === "start") stop({ restoreOriginalRange: false });
      drag = { mode, a, b, position, resume: playing, pointerId: event.pointerId }; pause(false); clearHover();
      try { wrap.setPointerCapture(event.pointerId); } catch (_) { /* Synthetic events or released pointers need no capture. */ }
      event.preventDefault();
      if (!nearA && !nearB && mode === "end" && session) seek(position, true); else render();
    });
    wrap.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return; event.preventDefault();
      const at = range.indexFromPointer(event.clientX, wrap);
      if (drag.mode === "range") { const next = range.moveRangeByDelta(drag.a, drag.b, at - drag.position); setRange(next.startIndex, next.endIndex); }
      else if (drag.mode === "start") setRange(Math.min(at, index(state.currentIso)), index(state.currentIso));
      else if (session) seek(at, true); else setRange(index(state.startIso), at);
    });
    const endDrag = (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const resume = drag.resume && session;
      try { wrap.releasePointerCapture(event.pointerId); } catch (_) { /* Capture may already have ended. */ }
      drag = null; refresh.requestCheck("scrub-finished");
      if (session && state.currentIso >= state.endIso) stop({ restoreOriginalRange: false });
      else if (resume) play(); else { render(); save(); }
    };
    wrap.addEventListener("pointerup", endDrag); wrap.addEventListener("pointercancel", endDrag);
    const openMenu = () => document.querySelector(".date-picker-popup,#dateRangeSettingsMenu.open,#updatedTimeZoneDropdownMenu.open");
    C.bindPlaybackKeyboardShortcuts({ isPlaybackActive: () => session, isEscapeActive: () => !!openMenu() || session || document.body.classList.contains("eoe-growth-dashboard-expanded"),
      isTextEntry: (el) => !!el && (el.isContentEditable || el.closest(".date-picker-popup,.date-range-download-settings-menu,.dca-dropdown")
        || ["TEXTAREA", "SELECT"].includes(el.tagName) || (el.tagName === "INPUT" && el.type !== "range")
        || (el.tagName === "BUTTON" && !["playBtn", "pauseBtn", "stopBtn", "speedBtn"].includes(el.id) && !$("rangeButtons").contains(el))),
      blurControls: () => {
        const active = document.activeElement;
        if (["dateRangeStartSlider", "dateRangeEndSlider", "playBtn", "pauseBtn", "stopBtn", "speedBtn"].some((id) => active === $(id)) || $("rangeButtons").contains(active)) active?.blur();
      },
      onSpace: () => { if (!exporting) playing ? pause() : play(); },
      onArrow: (direction, _event, detail) => {
        if (exporting || !session) return;
        const next = Math.max(index(state.startIso), Math.min(index(state.endIso), index(state.currentIso) + direction * (detail.isStep ? 1 : 600)));
        if (next === index(state.currentIso)) return;
        seek(next); if (direction > 0 && playing && next === index(state.endIso)) pause();
      },
      onEscape: () => {
        // The shared playback handler captures Escape before a menu's bubble
        // listener. Close the active menu before changing a paused selection.
        if (document.querySelector(".date-picker-popup")) { pickers.startPicker.closePopup(); pickers.endPicker.closePopup(); dateTrigger?.focus(); }
        else if ($("dateRangeSettingsMenu").classList.contains("open")) setMenu(false, true);
        else if ($("updatedTimeZoneDropdownMenu").classList.contains("open")) { $("updatedTimeZoneDropdownTrigger").click(); $("updatedTimeZoneDropdownTrigger").focus(); }
        else if (session) stop(); else expand(false);
      } });
    const zoneTrigger = $("updatedTimeZoneDropdownTrigger"), zoneMenu = $("updatedTimeZoneDropdownMenu");
    zoneTrigger.setAttribute("aria-haspopup", "listbox"); zoneTrigger.setAttribute("aria-controls", zoneMenu.id); zoneMenu.setAttribute("role", "listbox");
    $("updatedTimeZoneDropdown").addEventListener("keydown", (event) => {
      const options = [...zoneMenu.querySelectorAll(".dca-dropdown-option")], active = document.activeElement;
      if (event.key === "Tab") { if (zoneMenu.classList.contains("open")) { zoneTrigger.click(); zoneTrigger.focus(); } return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key) || !options.length) return;
      event.preventDefault(); event.stopPropagation();
      if (active === zoneTrigger) {
        if (!zoneMenu.classList.contains("open")) zoneTrigger.click();
        const selected = options.findIndex((option) => option.getAttribute("aria-selected") === "true");
        options[event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : Math.max(0, selected)].focus();
        return;
      }
      const at = options.indexOf(active);
      if (at < 0) return;
      if (event.key === "Enter" || event.key === " ") { active.click(); zoneTrigger.focus(); return; }
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (at + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      options[next].focus(); options[next].scrollIntoView({ block: "nearest" });
    });
    $("dashboardExpandBtn").addEventListener("click", () => expand(!document.body.classList.contains("eoe-growth-dashboard-expanded")));
    $("downloadImageBtn").addEventListener("click", () => exportFile(false));
    for (const id of ["dateRangeDownloadBtn", "downloadSettingsDownloadBtn"]) $(id).addEventListener("click", () => exportFile(true));
    $("dateRangeSettingsBtn").addEventListener("click", () => setMenu(!$("dateRangeSettingsMenu").classList.contains("open")));
    document.addEventListener("pointerdown", (event) => { if (!event.target.closest("#dateRangeSettingsMenu,#dateRangeSettingsBtn")) setMenu(false); });
    $("dateRangeSettingsMenu").addEventListener("keydown", (event) => { if (event.key === "Escape") { event.stopPropagation(); setMenu(false, true); } });
    $("dateRangeSettingsMenu").addEventListener("click", (event) => { const button = event.target.closest("[data-value]"); if (button && !exporting) { C.setButtonGroupValue(button.parentElement, button.dataset.value); downloads.save(downloads.readControls()); updateEstimates(); } });
    for (const id of ["downloadFastIntroToggle", "downloadEndFrameHoldToggle"]) {
      $(id).addEventListener("change", () => { downloads.save(downloads.readControls()); updateEstimates(); });
    }
    const handle = $("chartsResizeHandle");
    handle.addEventListener("pointerdown", (event) => { if (!model || exporting) return; resize = { y: event.clientY, height: $("epochPanel").getBoundingClientRect().height }; handle.setPointerCapture(event.pointerId); event.preventDefault(); });
    handle.addEventListener("pointermove", (event) => { if (resize) { state.autoHeight = false; state.height = Math.max(400, Math.min(4000, resize.height + event.clientY - resize.y)); render(); } });
    for (const name of ["pointerup", "pointercancel"]) handle.addEventListener(name, () => { resize = null; if (dirty) render(); save(); refresh.requestCheck("resize-finished"); });
    handle.addEventListener("keydown", (event) => { if (!model || exporting || !["ArrowUp", "ArrowDown"].includes(event.key)) return; event.preventDefault(); state.autoHeight = false; state.height = Math.max(400, Math.min(4000, $("epochPanel").getBoundingClientRect().height + (event.key === "ArrowUp" ? -20 : 20))); render(); save(); });
    $("epochChart").addEventListener("pointermove", (event) => {
      if (!frame || playing || exporting || !geometry) return;
      const rect = event.currentTarget.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top, p = geometry.plot;
      if (x < p.left || x > p.right || y < p.top || y > p.bottom) { clearHover(); render(); return; }
      const count = Math.round(geometry.blockAtX(x));
      if (!G.inspect(frame, count).length) { clearHover(); render(); return; }
      hover = { count }; render();
      const tooltip = $("chartTooltip"); renderTooltip(G.inspect(frame, count));
      tooltip.hidden = false; tooltip.style.maxWidth = `${Math.max(100, p.width - 16)}px`;
      const box = tooltip.getBoundingClientRect(); tooltip.style.left = `${Math.max(rect.left + p.left + 4, Math.min(rect.left + p.right - box.width - 4, event.clientX + 12))}px`;
      tooltip.style.top = `${Math.max(rect.top + p.top + 4, Math.min(innerHeight - box.height - 8, rect.top + p.bottom - box.height - 4, event.clientY - box.height / 2))}px`;
    });
    $("epochChart").addEventListener("pointerleave", () => { clearHover(); render(); });
    $("epochChart").addEventListener("pointercancel", () => { clearHover(); render(); });
    window.addEventListener("resize", () => { clearHover(); render(); });
    document.addEventListener("dashboard-theme-change", () => { clearHover(); render(); });
    document.addEventListener("scroll", () => { if (hover) { clearHover(); render(); } }, true);
    document.addEventListener("visibilitychange", () => { lastTime = 0; if (!document.hidden && dirty) render(); });
    window.addEventListener("beforeunload", (event) => { save(); if (exporting) { event.preventDefault(); event.returnValue = ""; } });
  }
  downloads.load(); bind();
  liveFeed = window.WSBEOEGrowthLive.create({ onChange: presentLivePrice, getPublishedAt: () => installed });
  liveFeed.start();
  window.addEventListener("pagehide", () => { liveFeed.stop(); clearTimeout(livePaintTimer); livePaintTimer = 0; });
  window.addEventListener("pageshow", () => { liveFeed.start(); presentLivePrice(); });
  window.addEventListener("wsb:data-refresh-status", (event) => {
    if (["error", "failed"].includes(event.detail?.status)) status(model ? "History refresh unavailable. Keeping the last complete publication and retrying automatically." : "History could not be loaded. Retrying automatically…", true);
  });
  refresh.register({ getInstalledSignature: () => installed?.signature || "", prepare: M.prepareCandidate,
    validate: (candidate) => M.validateCandidate(candidate, installed), commit: install });
  window.WSBEOEGrowthDashboard = { getState: capture, getModel: () => model, getFrame: () => frame,
    getInstalledSignature: () => installed?.signature || "", isPlaying: () => playing };
}());
