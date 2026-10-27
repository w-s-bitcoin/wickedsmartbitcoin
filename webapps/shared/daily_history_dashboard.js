(function () {
  const THEME_KEY = "quantum-research-dashboard-theme";
  function applyTheme(value) {
    document.documentElement.dataset.theme = value === "light" ? "light" : "dark";
    document.dispatchEvent(new CustomEvent("dashboard-theme-change"));
  }
  try { applyTheme(localStorage.getItem(THEME_KEY)); } catch (_) { applyTheme("dark"); }
  window.addEventListener("storage", (event) => { if (event.key === THEME_KEY) applyTheme(event.newValue); });
  window.addEventListener("message", (event) => { if (event.data?.type === "quantum-dashboard-theme") applyTheme(event.data.theme); });
}());

window.WSBDailyHistoryDashboard = function (config) {
  "use strict";
  const C = window.WSBDashboardComponents, E = window.WSBDashboardExport;
  const B = window.WSBDashboardExportBranding, Chart = config.chart;
  const STORAGE = config.storageKey, SPEEDS = [0.5, 1, 2, 4];
  const $ = (id) => document.getElementById(id);
  const canvas = $("dashboardCanvas"), loader = $("chartLoader"), status = $("dashboardStatus");
  const tooltip = window.WSBDashboardChartTooltip.create(canvas);
  function clearHover() { hover = null; tooltip.hide(); }
  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORAGE) || "{}"); } catch (_) { return {}; } })();
  const initial = C.readShareState() || saved;
  const validOrientation = (value) => ["landscape", "portrait", "square"].includes(value) ? value : "landscape";
  const validQuality = (value) => ["720", "1080", "1440", "2160"].includes(String(value)) ? String(value) : "720";
  const validSpeed = (value) => SPEEDS.includes(Number(value)) ? Number(value) : 1;
  let rows = [], index = 0, startIndex = 0, tracksLatest = true, playing = false, timer = null;
  let speed = validSpeed(initial.speed), playbackTarget = null, exporting = false, cancelExport = false;
  let previousReset = null, undoTimer = null, refreshSequence = 0, drag = null;
  let hover = null;
  let publishedAt = null, spotFeed = null, livePaintTimer = null;
  function usesLivePrice() { return tracksLatest && !playing && playbackTarget === null && index === rows.length - 1; }
  function selectedQuote() { return usesLivePrice() ? spotFeed?.newerThan(publishedAt) : null; }
  function presentLivePrice() {
    if (document.hidden || exporting || drag || !usesLivePrice() || livePaintTimer) return;
    livePaintTimer = setTimeout(() => { livePaintTimer = null; if (!exporting && !drag) render(); }, 250);
  }
  function theme() { return document.documentElement.dataset.theme === "light" ? "light" : "dark"; }
  function isIso(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)); }
  const downloads = C.createDownloadSettingsController({
    defaults: { orientation: "landscape", quality: "720", exportSpeed: "1", exportTheme: theme(), endHold: true },
    initial,
    normalize: (s) => ({ orientation: validOrientation(s.orientation), quality: validQuality(s.quality),
      exportSpeed: String(validSpeed(s.exportSpeed)), exportTheme: ["light", "dark"].includes(s.exportTheme) ? s.exportTheme : theme(), endHold: s.endHold !== false }),
    groups: { orientation: $("exportOrientation"), quality: $("exportQuality"), exportSpeed: $("exportSpeed"), exportTheme: $("exportTheme") },
    checkboxes: { endHold: $("downloadEndFrameHoldToggle") },
  });
  downloads.writeControls();
  const range = C.createIndexDateRangeController({ getRows: () => rows, getDate: (row) => row.iso });
  const timeApi = window.WSBDashboardTime;
  const updatedChip = C.createUpdatedTimeZoneChipController({
    getTimeZone: () => timeApi?.getPreferredTimeZone?.() || "UTC",
    setTimeZone: (value) => timeApi?.setPreferredTimeZone?.(value) || value || "UTC",
    onChange: () => syncKpis(),
  });
  function viewState() {
    return { startDate: rows[startIndex]?.iso || "first", date: tracksLatest ? "latest" : rows[index]?.iso || "latest",
      speed: String(speed), ...downloads.getSettings(), pausedTarget: playbackTarget === null ? null : rows[playbackTarget]?.iso };
  }
  function isDefault() {
    const s = viewState();
    return s.startDate === (rows[0]?.iso || "first") && s.date === "latest" && s.orientation === "landscape" && s.quality === "720" && s.speed === "1" && s.exportSpeed === "1" && s.exportTheme === theme() && s.endHold;
  }
  function persist() {
    try { localStorage.setItem(STORAGE, JSON.stringify(viewState())); } catch (_) {}
    runtime.actions.syncResetState({ isUndo: !!previousReset, disabled: exporting || (!previousReset && isDefault()) });
  }
  const runtime = window.WSBDashboardComponents.initDashboardRuntime({ manifest: window.WSBDashboardManifest,
    copyButton: $("copyDashboardLink"), resetButton: $("resetDashboard"),
    getShareUrl: () => C.buildShareUrl({ slug: config.slug, state: viewState() }),
    onReset: () => {
      if (!rows.length || exporting) return;
      clearTimeout(undoTimer);
      if (previousReset) { const restore = previousReset; previousReset = null; applySettings(restore); }
      else {
        previousReset = viewState(); applySettings({ startDate: "first", date: "latest" });
        undoTimer = setTimeout(() => { previousReset = null; persist(); }, 8000);
      }
      persist();
    },
  });
  function installSelection(value) {
    tracksLatest = !isIso(value.date);
    index = tracksLatest ? rows.length - 1 : Chart.latestIndexAtDate(rows, value.date);
    startIndex = 0; // Both charts always accumulate from Bitcoin genesis, including old saved links.
    playbackTarget = isIso(value.pausedTarget) ? Math.max(index, Chart.latestIndexAtDate(rows, value.pausedTarget)) : null;
  }
  function applySettings(value) {
    pausePlayback(); speed = validSpeed(value.speed); downloads.setSettings(value); installSelection(value); render(); persist();
  }
  function dateLabel(iso) { const [y, m, d] = iso.split("-"); return `${Number(m)}/${Number(d)}/${y.slice(2)}`; }
  function syncKpis() {
    if (!rows.length) return;
    const quote = selectedQuote(), row = Chart.withLiveQuote(rows, quote)[index], s = Chart.summary(row), max = rows.length - 1;
    const live = quote && spotFeed.isLive(quote);
    updatedChip?.setUpdated(quote ? new Date(quote.at).toISOString() : row.timestamp.replace(" ", "T") + "Z", { includeHeight: true, height: row.height });
    const sourceDescription = quote ? `${live ? "Live" : "Retained"} ${quote.source} BTC/USD quote at ${new Date(quote.at).toISOString()}.`
      : `Published daily BTC/USD price for ${row.iso}.`;
    $("priceLiveStatus").dataset.kind = quote ? (live ? "live" : "retained") : "published";
    $("priceLiveStatus").setAttribute("aria-label", sourceDescription);
    $("priceChip").title = sourceDescription;
    $("chipUpdated").title = `${sourceDescription} Block height and historical observations are from the publication at ${row.timestamp} UTC.`;
    for (const [id, value] of config.kpis(s)) $(id).textContent = value;
    for (const [which, at] of [["start", startIndex], ["end", index]]) {
      const input = $(which + "DateInput"), button = $(which + "DateBtn");
      input.value = rows[at].iso; input.min = rows[which === "end" ? startIndex : 0].iso; input.max = rows[which === "start" ? index : max].iso;
      button.querySelector("span").textContent = dateLabel(rows[at].iso); button.querySelector("span").classList.remove("date-range-btn-placeholder"); button.querySelector("span").removeAttribute("aria-hidden");
      button.title = Chart.summary(rows[at]).date;
      const slider = $(which === "start" ? "dateRangeStartSlider" : "dateRangeEndSlider");
      if (slider) { slider.min = 0; slider.max = max; slider.value = at; slider.setAttribute("aria-valuetext", rows[at].iso); }
    }
    const percent = (i) => `${range.indexPercent(i)}%`;
    $("dateRangeSliderWrap").style.setProperty("--slider-start", percent(startIndex));
    $("dateRangeSliderWrap").style.setProperty("--slider-end", percent(index));
    $("dateRangeSelection").classList.toggle("active", playbackTarget !== null && index < playbackTarget);
    $("dateRangeSelection").style.left = percent(index);
    $("dateRangeSelection").style.right = `calc(100% - ${percent(playbackTarget ?? index)})`;
    if (document.activeElement !== $("rangeDaysInput")) $("rangeDaysInput").value = (index - startIndex + 1).toLocaleString("en-US");
    $("playPause").disabled = playing || exporting;
    $("pausePlayback").disabled = !playing || exporting;
    $("stopPlayback").disabled = playbackTarget === null || exporting;
    $("playPause").classList.toggle("is-playing", playing); $("playPause").setAttribute("aria-pressed", String(playing));
    $("pausePlayback").classList.toggle("is-paused", playbackTarget !== null && !playing);
    $("playbackSpeed").textContent = `${speed}x`;
    document.querySelectorAll("[data-range-preset]").forEach((b) => { const active = b.dataset.rangePreset === "full" && index === rows.length - 1; b.classList.toggle("is-active", active); b.setAttribute("aria-pressed", String(active)); });
    canvas.setAttribute("aria-label", config.description(s));
    runtime.actions.syncResetState({ isUndo: !!previousReset, disabled: exporting || (!previousReset && isDefault()) });
    syncEstimate();
  }
  function draw() {
    if (!rows.length || !canvas.isConnected || document.hidden) return;
    const rect = canvas.getBoundingClientRect(), dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width)), height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const inspection = Chart.render(ctx, width, height, Chart.withLiveQuote(rows, selectedQuote()), index, { theme: theme(), startIndex, hover: playing || drag || exporting ? null : hover });
    tooltip.show(inspection, hover);
    C.setChartLoaderVisible(loader, false);
  }
  function render() { if (rows.length) { syncKpis(); draw(); } }
  function select(next, follow = false) {
    if (!rows.length) return;
    clearHover();
    index = Math.max(startIndex, Math.min(rows.length - 1, next)); tracksLatest = follow || (playbackTarget === null && index === rows.length - 1);
    previousReset = null; render(); persist();
  }
  function setRange(start, end, preset = "") {
    if (!rows.length || exporting) return;
    pausePlayback(); playbackTarget = null;
    startIndex = 0; select(Math.max(startIndex, end));
  }
  function pausePlayback() { playing = false; if (timer) clearInterval(timer); timer = null; syncKpis(); }
  function stopPlayback() { const end = playbackTarget; pausePlayback(); playbackTarget = null; if (end !== null) select(end); }
  function setExpanded(expanded) {
    document.body.classList.toggle(config.expandedClass, !!expanded);
    document.body.classList.toggle("daily-history-dashboard-expanded", !!expanded);
    $("expandDashboard").classList.toggle("is-expanded", !!expanded);
    $("expandDashboard").setAttribute("aria-pressed", String(!!expanded));
    $("expandDashboard").setAttribute("aria-label", expanded ? "Shrink video layout" : "Expand video layout");
    try { window.parent?.postMessage({ type: config.expandedMessage, expanded: !!expanded }, window.location.origin); } catch (_) {}
    requestAnimationFrame(draw);
  }
  function play() {
    if (exporting || !rows.length || playing) return;
    if (playbackTarget === null) { playbackTarget = index; index = startIndex; }
    if (index >= playbackTarget) index = startIndex;
    clearHover(); playing = true; tracksLatest = false; render();
    timer = setInterval(() => {
      if (document.hidden) return;
      if (index >= playbackTarget) { pausePlayback(); persist(); return; }
      select(Math.min(playbackTarget, index + Math.max(1, Math.round(speed * 7))));
    }, 80);
  }
  async function refresh() {
    if (exporting || drag) return;
    const sequence = ++refreshSequence;
    try {
      const fetchFresh = async (url) => { const response = await fetch(url, { cache: "no-store" }); if (!response.ok) throw new Error(`History request returned HTTP ${response.status}.`); return response; };
      const candidate = await Chart.prepareCandidate(fetchFresh);
      const recheck = await (await fetchFresh("../../assets/daily_price_metadata.json")).json();
      if (recheck?.artifact?.sha256 !== candidate.signature) throw new Error("A newer publication arrived during refresh.");
      if (sequence !== refreshSequence || exporting || drag) return;
      if (rows.length && (candidate.rows.at(-1).time < rows.at(-1).time || candidate.rows.at(-1).height < rows.at(-1).height)) throw new Error("New history is older than the displayed version.");
      const selection = rows.length ? viewState() : initial;
      rows = candidate.rows; publishedAt = candidate.publishedAt; installSelection(selection); status.textContent = ""; render();
    } catch (error) {
      if (sequence !== refreshSequence) return;
      status.textContent = rows.length ? `Update unavailable; showing the last complete history. ${error.message}` : `Could not load history: ${error.message}`;
      C.setChartLoaderVisible(loader, false);
    }
  }
  const pickers = window.WSBDashboardComponents.bindDateRangePickers({ isDisabled: () => !rows.length || exporting, onSelect: (which, iso) => {
    if (which === "start" || !isIso(iso)) return;
    const at = Chart.latestIndexAtDate(rows, iso); setRange(which === "start" ? at : startIndex, which === "end" ? at : index);
  } });
  $("rangeButtons").addEventListener("click", (event) => {
    const preset = event.target.closest("[data-range-preset]")?.dataset.rangePreset;
    if (!preset || !rows.length || exporting) return;
    if (preset === "full") { setRange(0, rows.length - 1, preset); return; }
    const end = rows[index], date = new Date(end.time);
    if (preset === "ytd") date.setUTCMonth(0, 1); else date.setUTCFullYear(date.getUTCFullYear() - Number(preset.slice(0, -1)));
    setRange(Math.max(0, Chart.latestIndexAtDate(rows, date.toISOString().slice(0, 10))), index, preset);
  });
  $("dateRangeEndSlider").addEventListener("input", () => { const next = Number($("dateRangeEndSlider").value); if (playbackTarget !== null) { pausePlayback(); select(Math.min(playbackTarget, next)); } else setRange(startIndex, Math.max(startIndex, next)); });
  const track = $("dateRangeSliderWrap");
  track.addEventListener("pointerdown", (event) => {
    if (!rows.length || exporting || event.button !== 0) return;
    const at = range.indexFromPointer(event.clientX, track), mode = "end";
    clearHover(); draw();
    drag = { mode, start: startIndex, end: index, at, pointerId: event.pointerId }; pausePlayback();
    track.setPointerCapture(event.pointerId); event.preventDefault();
  });
  track.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const at = range.indexFromPointer(event.clientX, track); event.preventDefault();
    if (playbackTarget !== null) select(Math.min(playbackTarget, at)); else setRange(startIndex, Math.max(startIndex, at));
  });
  const endDrag = (event) => { if (drag?.pointerId === event.pointerId) { drag = null; if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId); } };
  track.addEventListener("pointerup", endDrag); track.addEventListener("pointercancel", endDrag);
  $("playPause").addEventListener("click", play); $("pausePlayback").addEventListener("click", () => { pausePlayback(); persist(); }); $("stopPlayback").addEventListener("click", stopPlayback);
  $("playbackSpeed").addEventListener("click", () => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; previousReset = null; syncKpis(); persist(); });
  $("expandDashboard").addEventListener("click", () => setExpanded(!document.body.classList.contains(config.expandedClass)));
  function setMenu(open, focus = false) { C.setFloatingMenuOpen({ menu: $("dateRangeSettingsMenu"), button: $("dateRangeSettingsBtn") }, open); if (!open && focus) $("dateRangeSettingsBtn").focus(); }
  $("dateRangeSettingsBtn").addEventListener("click", () => setMenu(!$("dateRangeSettingsMenu").classList.contains("open")));
  $("dateRangeSettingsMenu").addEventListener("click", (event) => {
    const button = event.target.closest(".download-setting-option");
    if (button) { C.setButtonGroupValue(button.parentElement, button.dataset.value); downloads.save(); previousReset = null; syncEstimate(); persist(); }
  });
  $("downloadEndFrameHoldToggle").addEventListener("change", () => { downloads.save(); previousReset = null; syncEstimate(); persist(); });
  document.addEventListener("click", (event) => { if (!$("dateRangeDownloadSettings").contains(event.target)) setMenu(false); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && $("dateRangeSettingsMenu").classList.contains("open")) { event.preventDefault(); event.stopImmediatePropagation(); setMenu(false, true); } }, true);
  C.bindPlaybackKeyboardShortcuts({ isPlaybackActive: () => playing, isInactiveArrowActive: () => true,
    isEscapeActive: () => playing || exporting || document.body.classList.contains(config.expandedClass),
    isTextEntry: (element) => !!element?.closest?.("input, select, textarea, button, .date-picker-popup") || !!element?.isContentEditable,
    onSpace: () => playing ? pausePlayback() : play(), onArrow: (direction) => { pausePlayback(); select(index + direction); },
    onInactiveArrow: (direction) => select(index + direction), onEscape: () => { if (exporting) cancelExport = true; else if (document.body.classList.contains(config.expandedClass)) setExpanded(false); else pausePlayback(); } });
  function exportSettings(quality) { const s = downloads.getSettings(); return { ...s, quality, theme: s.exportTheme }; }
  function frameIndices(source, target, first, settings) {
    const count = Math.min(Math.ceil(900 / Number(settings.exportSpeed)), target - first + 1), frames = [];
    for (let i = 0; i < count; i++) frames.push(first + Math.round(i * (target - first) / Math.max(1, count - 1)));
    for (let epoch = 1; epoch <= 6; epoch++) { const boundary = source.findIndex((row) => row.height >= epoch * 210000); if (boundary >= first && boundary <= target && !frames.includes(boundary)) frames.push(boundary); }
    frames.sort((a, b) => a - b);
    if (settings.endHold) { frames.unshift(...Array(30).fill(first)); frames.push(...Array(90).fill(target)); }
    return frames;
  }
  function syncEstimate() {
    if (!rows.length) return;
    const settings = exportSettings(downloads.getSettings().quality), frames = frameIndices(rows, index, startIndex, settings);
    const estimate = window.WSBDashboardExport.estimateDownload(settings, { frameCount: frames.length, uniqueFrameCount: new Set(frames).size, outputFps: 30 });
    $("downloadEstimateSize").textContent = estimate.sizeText; $("downloadEstimateLength").textContent = estimate.lengthText; $("downloadEstimateTime").textContent = estimate.timeText;
  }
  function renderExport(ctx, width, height, source, frame, settings) { Chart.render(ctx, width, height, source, frame, { theme: settings.theme, export: true, branded: true, startIndex: settings.startIndex }); }
  function lockControls(locked) {
    document.querySelectorAll('.date-range-panel button, .date-range-panel input').forEach((el) => { if (el.id !== "downloadVideo") el.disabled = locked; });
    $("copyDashboardLink").disabled = locked; $("updatedTimeZoneDropdownTrigger").disabled = locked;
    $("startDateBtn").disabled = true; $("startDateInput").disabled = true;
    if (!locked) syncKpis();
  }
  async function runExport(kind) {
    if (!rows.length || exporting) { if (exporting) cancelExport = true; return; }
    clearHover(); draw();
    const allowLive = usesLivePrice();
    pausePlayback(); exporting = true; cancelExport = false; setMenu(false); pickers?.startPicker.closePopup(); pickers?.endPicker.closePopup();
    const source = rows.slice(), frame = index, settings = { ...exportSettings(kind === "png" ? "2160" : downloads.getSettings().quality), startIndex };
    const { width, height } = E.getDimensions(settings), output = document.createElement("canvas"); output.width = width; output.height = height;
    lockControls(true); $("downloadVideo").textContent = "×"; $("downloadVideo").setAttribute("aria-label", "Cancel export");
    status.textContent = kind === "video" ? "Preparing video…" : "Preparing 2160-quality PNG…";
    try {
      await B.ready();
      if (cancelExport) return;
      let finalSource = null;
      const finalRows = () => finalSource || (finalSource = allowLive ? Chart.withLiveQuote(source, spotFeed?.newerThan(publishedAt)) : source);
      if (kind === "png") { renderExport(output.getContext("2d"), width, height, finalRows(), frame, settings); await E.downloadPng(output, `${config.slug}_${source[frame].iso}.png`); }
      else {
        const frames = frameIndices(source, frame, settings.startIndex, settings);
        const blob = await E.encodeVideo({ canvas: output, width, height, fps: 30, settings, frames, title: config.title, isCanceled: () => cancelExport,
          renderFrame: (frameIndex, targetCanvas) => renderExport(targetCanvas.getContext("2d"), width, height, frameIndex === frame ? finalRows() : source, frameIndex, settings),
          onProgress: (fraction) => { status.textContent = `Rendering video ${Math.floor(fraction * 100)}%`; } });
        if (!cancelExport) {
          if (!blob) throw new Error("This browser cannot encode the selected video size.");
          const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `${config.slug}_${source[frame].iso}.${E.videoExtension(blob)}`;
          document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }
      status.textContent = cancelExport ? "Export canceled." : "Download ready.";
    } catch (error) { status.textContent = `Export failed: ${error.message}`; }
    finally { exporting = false; cancelExport = false; $("downloadVideo").textContent = "↓"; $("downloadVideo").setAttribute("aria-label", "Download date range animation"); lockControls(false); persist(); }
  }
  $("downloadImage").addEventListener("click", () => runExport("png")); $("downloadVideo").addEventListener("click", () => runExport("video")); $("downloadSettingsDownloadBtn").addEventListener("click", () => runExport("video"));
  canvas.addEventListener("pointermove", (event) => {
    if (playing || exporting || drag || event.buttons || event.pointerType === "touch") { clearHover(); draw(); return; }
    const rect = canvas.getBoundingClientRect(); hover = { x: event.clientX - rect.left, y: event.clientY - rect.top }; draw();
  });
  for (const type of ["pointerleave", "pointercancel", "pointerdown"]) canvas.addEventListener(type, () => { clearHover(); draw(); });
  document.addEventListener("scroll", () => { if (hover) { clearHover(); draw(); } }, true);
  new ResizeObserver(() => { clearHover(); draw(); }).observe(canvas.parentElement);
  new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { draw(); refresh(); } });
  spotFeed = window.WSBBitcoinSpotPrice?.create({ onQuote: presentLivePrice });
  spotFeed?.start();
  window.addEventListener("pageshow", () => { spotFeed?.start(); presentLivePrice(); });
  window.addEventListener("pagehide", () => { spotFeed?.stop(); clearTimeout(livePaintTimer); livePaintTimer = null; if (document.body.classList.contains(config.expandedClass)) setExpanded(false); });
  refresh().then(() => window.WSBWebappDataAutoRefresh.register({
    prepare: (context) => Chart.prepareCandidate(context.fetchFresh),
    commit: (candidate) => {
      if (exporting || drag) return false;
      if (rows.length && (candidate.rows.at(-1).time < rows.at(-1).time || candidate.rows.at(-1).height < rows.at(-1).height)) throw new Error("New history is older than the displayed version.");
      const selection = rows.length ? viewState() : initial;
      rows = candidate.rows; publishedAt = candidate.publishedAt; installSelection(selection);
      status.textContent = ""; render(); return true;
    },
    onError: (error) => { status.textContent = `Update unavailable; showing the last complete history. ${error.message}`; },
  }));
  return { getState: () => ({ index, startIndex, rows: rows.length, date: rows[index]?.iso, playing, exporting }), refresh };
};
