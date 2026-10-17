(function () {
  const THEME_KEY = "quantum-research-dashboard-theme";
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
    document.dispatchEvent(new CustomEvent("dashboard-theme-change"));
  }
  try { applyTheme(localStorage.getItem(THEME_KEY)); } catch (_) { applyTheme("dark"); }
  window.addEventListener("message", (e) => { if (e.data?.type === "quantum-dashboard-theme") applyTheme(e.data.theme); });
  window.addEventListener("storage", (e) => { if (e.key === THEME_KEY) applyTheme(e.newValue); });
}());

(function () {
  "use strict";
  const M = window.WSBMovingAverageModel, G = window.WSBMovingAverageCharts;
  const C = window.WSBDashboardComponents, E = window.WSBDashboardExport;
  const STORAGE = "moving_average_dashboard_state_v1", DOWNLOAD_STORAGE = "moving_average_download_settings_v1";
  const SPEEDS = [0.5, 1, 2, 4];
  const $ = (id) => document.getElementById(id);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const defaults = () => ({ lines: [{ period: 200, unit: "day", type: "sma" }, { period: 200, unit: "week", type: "sma" }],
    scales: ["log", "linear", "linear"], startIso: "", endIso: "", currentIso: "", tracksLatest: true,
    speed: 1, preset: "full", height: 620, timeZone: window.WSBDashboardTime?.getPreferredTimeZone?.() || "UTC" });
  let state = defaults(), model = null, series = [], installed = null;
  let playing = false, session = false, announcedSession = null, raf = 0, lastFrame = 0, elapsed = 0, lastSaved = 0;
  let exporting = false, cancelExport = false, needsPaint = false, undo = null, undoTimer = 0;
  let hover = null, rangeDrag = null, pendingPlay = false, estimateKey = "";
  let spotFeed = null, livePaint = 0, liveCache = null, display = null, chartDragging = false;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const scaleTransitions = new Map();
  let scalePaint = 0;
  const endScrub = { active: false, pointerId: null, resumeAfterRelease: false, captureOnWrap: false };
  const charts = ["historyChart", "window1Chart", "window2Chart"];
  const calendarIcon = $("startDateBtn").querySelector("svg").outerHTML;
  const dateLabel = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(2, 4)}`;
  const chartGeometry = new Map();
  const range = C.createIndexDateRangeController({ getRows: () => model?.rows || [], getDate: (r) => r.date });
  function read(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (_) { return null; } }
  function save() {
    if (!model) return;
    try { localStorage.setItem(STORAGE, JSON.stringify(capture())); } catch (_) { /* Browser storage may be disabled. */ }
    lastSaved = performance.now();
  }
  function capture() { return { ...clone(state), pausedPlayback: session }; }
  function bounds() { return { first: model.rows[0].date, last: model.rows.at(-1).date }; }
  function idx(iso) { return range.clampIndex(range.findIndex(iso)); }
  function normalize(source = {}, fromUrl = false, sourceModel = model) {
    const next = defaults(), b = { first: sourceModel.rows[0].date, last: sourceModel.rows.at(-1).date };
    next.lines = next.lines.map((line, i) => {
      const input = source.lines?.[i] || line;
      const unit = ["day", "week", "month"].includes(input.unit) ? input.unit : line.unit;
      const type = (i ? ["sma", "ema", "none"] : ["sma", "ema"]).includes(input.type) ? input.type : "sma";
      const max = sourceModel.limits[unit];
      return { period: Math.min(Math.max(3, max), Math.max(3, Math.round(Number(input.period) || line.period))), unit, type };
    });
    next.scales = next.scales.map((s, i) => ["log", "linear"].includes(source.scales?.[i]) ? source.scales[i] : s);
    const validDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const date = (s, fallback) => validDate(s) ? sourceModel.rows[G.indexAt(sourceModel.rows, Date.parse(s + "T00:00:00Z"))].date : fallback;
    next.startIso = date(source.startIso, b.first);
    next.tracksLatest = source.tracksLatest !== false;
    next.endIso = !fromUrl && next.tracksLatest ? b.last : date(source.endIso, b.last);
    if (next.startIso > next.endIso) next.startIso = next.endIso;
    next.currentIso = source.pausedPlayback ? date(source.currentIso, next.endIso) : next.endIso;
    next.currentIso = next.currentIso < next.startIso ? next.startIso : next.currentIso > next.endIso ? next.endIso : next.currentIso;
    next.speed = SPEEDS.includes(Number(source.speed)) ? Number(source.speed) : 1;
    next.preset = ["full", "ytd", "1y", "2y", "4y", "8y", "custom"].includes(source.preset) ? source.preset : "full";
    next.height = Math.max(400, Math.min(1200, Number(source.height) || 620));
    try { new Intl.DateTimeFormat("en", { timeZone: source.timeZone }); if (source.timeZone) next.timeZone = source.timeZone; } catch (_) {}
    return next;
  }
  function recompute() { series = state.lines.map((line) => M.calculate(model, line)); }
  function selectedQuote() { return spotFeed?.newerThan(installed?.publishedAt) || null; }
  function usesLivePrice() { return !session && state.tracksLatest && state.currentIso === model?.rows.at(-1).date; }
  function viewWithQuote(baseModel, lines, endIndex, publishedAt, quote) {
    const key = JSON.stringify(lines);
    if (!liveCache || liveCache.baseModel !== baseModel || liveCache.quote !== quote || liveCache.key !== key || (quote && liveCache.model === baseModel)) {
      const projected = quote ? M.withLiveQuote(baseModel, quote, { publishedAt }) : baseModel;
      liveCache = { baseModel, quote, key, model: projected,
        series: lines.map((line) => M.calculateCurrent(projected, line)) };
    }
    return { model: liveCache.model, series: liveCache.series, current: true,
      endIndex: liveCache.model === baseModel ? endIndex : liveCache.model.rows.length - 1 };
  }
  function currentView() {
    return usesLivePrice() ? viewWithQuote(model, state.lines, idx(state.currentIso), installed.publishedAt, selectedQuote())
      : { model, series, endIndex: idx(state.currentIso), current: false };
  }
  function syncPriceSource(view) {
    const quote = view.model.liveQuote, live = !!quote && !!spotFeed?.isLive(quote);
    const chip = $("priceChip"), source = quote ? (live ? "live" : "retained") : "published";
    chip.dataset.live = String(live); chip.dataset.priceSource = source;
    $("priceLiveStatus").dataset.kind = live ? "live" : "stale";
    chip.title = quote
      ? `${live ? "Green" : "Gray"} dot: ${quote.source} BTC/USD quote at ${new Date(quote.at).toISOString()}${live ? "" : "; no quote arrived in the last 60 seconds"}. Current moving averages include this unfinished period and prior completed closes. Published history runs through ${model.rows.at(-1).date}.`
      : `Gray dot: published BTC/USD price for ${view.model.rows[view.endIndex].date}. ${view.current ? "Current moving averages include this price as the unfinished period." : "Historical moving averages use prior completed closes."}`;
    const height = installed.latestHeight;
    if (quote) {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: state.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "short" }).formatToParts(new Date(quote.at));
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      updated.setText(`${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second} (${values.timeZoneName || state.timeZone}) | ${height.toLocaleString("en-US")}`);
    } else updated.setUpdated(installed.publishedAt, { includeHeight: true, height });
    $("chipUpdated").title = quote
      ? `BTC/USD quote at ${new Date(quote.at).toISOString()}. Block ${height.toLocaleString("en-US")} is from the published snapshot at ${installed.publishedAt}.`
      : `Published price snapshot at ${installed.publishedAt}, block ${height.toLocaleString("en-US")}.`;
  }
  function presentLivePrice() {
    if (!model) return;
    if (document.hidden || exporting || rangeDrag || endScrub.active || chartDragging) { needsPaint = true; return; }
    if (!usesLivePrice()) return;
    if (!livePaint) livePaint = requestAnimationFrame(() => { livePaint = 0; render(); });
  }
  function status(message, error = false) {
    $("loadStatus").textContent = message;
    $("loadStatus").classList.toggle("error", error);
    $("loadStatus").hidden = !message;
  }
  const updated = C.createUpdatedTimeZoneChipController({
    getTimeZone: () => state.timeZone,
    setTimeZone: (zone) => { state.timeZone = window.WSBDashboardTime?.setPreferredTimeZone?.(zone) || zone; save(); return state.timeZone; },
    onChange: () => { if (model) syncPriceSource(currentView()); },
  });
  const runtime = window.WSBDashboardComponents.initDashboardRuntime({
    getShareUrl: () => C.buildShareUrl({ slug: "moving_average", state: capture() }),
    onReset: () => {
      if (!model || exporting) return;
      finishScaleTransitions();
      clearHover(); clearPlaybackScrubState(); rangeDrag = null; pause(false);
      if (undo) { state = normalize(undo, true); session = !!undo.pausedPlayback; undo = null; }
      else { undo = capture(); state = normalize(); session = false; clearTimeout(undoTimer); undoTimer = setTimeout(() => { undo = null; sync(); }, 8000); }
      recompute(); writeLineControls(); render(); save();
    },
  });
  function periodValue(input) {
    const text = input.value.trim();
    return /^\d+(?:,\d{3})*$/.test(text) ? Number(text.replaceAll(",", "")) : NaN;
  }
  function sizePeriodInput(input) { input.style.width = `${Math.max(1, Math.min(10, input.value.length || 1))}ch`; }
  function formatPeriodInput(input) {
    const value = periodValue(input);
    if (Number.isSafeInteger(value)) {
      const digits = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/\D/g, "").length;
      input.value = value.toLocaleString("en-US");
      if (document.activeElement === input) {
        let caret = 0, seen = 0;
        while (caret < input.value.length && seen < digits) { if (/\d/.test(input.value[caret])) seen++; caret++; }
        input.setSelectionRange(caret, caret);
      }
    }
    sizePeriodInput(input);
  }
  function lineMenuElements(i, kind) {
    const prefix = "ma" + (i + 1) + kind;
    return { select: $(prefix), dropdown: $(prefix + "Dropdown"), trigger: $(prefix + "DropdownTrigger"), menu: $(prefix + "DropdownMenu"), value: $(prefix + "DropdownValue") };
  }
  function setLineMenuOpen(i, kind, open) {
    const { dropdown, trigger, menu } = lineMenuElements(i, kind);
    dropdown.classList.toggle("is-open", open); menu.classList.toggle("open", open);
    trigger.setAttribute("aria-expanded", String(open));
  }
  function closeLineMenus(except = -1, exceptKind = "") {
    for (let i = 0; i < 2; i++) for (const kind of ["Type", "Unit"]) if (i !== except || kind !== exceptKind) setLineMenuOpen(i, kind, false);
  }
  function syncLineDropdown(i, kind) {
    const { select, trigger, menu, value } = lineMenuElements(i, kind);
    value.textContent = select.selectedOptions[0]?.textContent || "";
    trigger.setAttribute("aria-label", `${i ? "Second" : "First"} moving average ${kind.toLowerCase()}: ${value.textContent}`);
    trigger.setAttribute("aria-activedescendant", select.id + "Option-" + select.value);
    menu.querySelectorAll(".dca-option-btn").forEach((button) => {
      const selected = button.dataset.value === select.value;
      button.classList.toggle("dca-option-btn--selected", selected); button.setAttribute("aria-selected", String(selected));
    });
  }
  function sizeLineDropdown(i, kind) {
    const { select, dropdown, value } = lineMenuElements(i, kind), style = getComputedStyle(value);
    const probe = document.createElement("span");
    Object.assign(probe.style, { position: "fixed", left: "-99999px", visibility: "hidden", whiteSpace: "nowrap", font: style.font });
    document.body.append(probe);
    let width = 0;
    Array.from(select.options).forEach((option) => { probe.textContent = option.textContent; width = Math.max(width, probe.getBoundingClientRect().width); });
    probe.remove();
    const dropdownStyle = getComputedStyle(dropdown);
    width = Math.ceil(Math.max(54, width + parseFloat(dropdownStyle.getPropertyValue("--dca-dropdown-content-pad")) + parseFloat(dropdownStyle.getPropertyValue("--dca-dropdown-arrow-gap")) + 1));
    for (const property of ["width", "minWidth", "maxWidth", "flexBasis"]) dropdown.style[property] = `${width}px`;
  }
  function bindLineDropdown(i, kind) {
    const { select, dropdown, trigger, menu } = lineMenuElements(i, kind);
    trigger.setAttribute("role", "combobox"); trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-controls", menu.id); menu.setAttribute("role", "listbox");
    Array.from(select.options).forEach((option) => {
      const button = document.createElement("button"); button.type = "button"; button.className = "dca-option-btn";
      button.id = select.id + "Option-" + option.value; button.dataset.value = option.value; button.textContent = option.textContent;
      button.setAttribute("role", "option"); button.tabIndex = -1; menu.append(button);
    });
    function choose(value) {
      select.value = value; select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    trigger.addEventListener("click", () => {
      if (!model || exporting || trigger.disabled) return;
      const open = !menu.classList.contains("open"); closeLineMenus(i, kind); setLineMenuOpen(i, kind, open);
    });
    menu.addEventListener("click", (event) => {
      const option = event.target.closest(".dca-option-btn"); if (!option || !model || exporting || trigger.disabled) return;
      choose(option.dataset.value); setLineMenuOpen(i, kind, false); trigger.focus();
    });
    dropdown.addEventListener("keydown", (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || !model || exporting || trigger.disabled) return;
      if (!["ArrowUp", "ArrowDown", "Home", "End", "Enter", " ", "Escape"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Escape") { setLineMenuOpen(i, kind, false); trigger.focus(); return; }
      closeLineMenus(i, kind);
      if (event.key === "Enter" || event.key === " ") {
        setLineMenuOpen(i, kind, !menu.classList.contains("open")); trigger.focus(); return;
      }
      setLineMenuOpen(i, kind, true);
      const options = Array.from(select.options), current = select.selectedIndex;
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      choose(options[next].value); trigger.focus();
    });
    dropdown.addEventListener("focusout", (event) => { if (!dropdown.contains(event.relatedTarget)) setLineMenuOpen(i, kind, false); });
    setLineMenuOpen(i, kind, false); syncLineDropdown(i, kind);
    requestAnimationFrame(() => sizeLineDropdown(i, kind)); document.fonts.ready.then(() => sizeLineDropdown(i, kind));
  }
  function writeLineControls() {
    state.lines.forEach((line, i) => {
      const input = $("ma" + (i + 1) + "Period"); input.value = line.period.toLocaleString("en-US"); sizePeriodInput(input);
      $("ma" + (i + 1) + "Unit").value = line.unit;
      $("ma" + (i + 1) + "Type").value = line.type;
      for (const kind of ["Type", "Unit"]) { syncLineDropdown(i, kind); setLineMenuOpen(i, kind, false); }
      $("ma" + (i + 1) + "Error").textContent = "";
      $("ma" + (i + 1) + "Period").removeAttribute("aria-invalid");
    });
  }
  function changeLine(i) {
    if (!model || exporting || state.lines[i].type === "none") return;
    const input = $("ma" + (i + 1) + "Period"), unit = $("ma" + (i + 1) + "Unit").value;
    syncLineDropdown(i, "Unit");
    const period = periodValue(input), max = model.limits[unit];
    input.max = max;
    const valid = Number.isSafeInteger(period) && period >= 3 && period <= max;
    input.setAttribute("aria-invalid", String(!valid));
    $("ma" + (i + 1) + "Error").textContent = valid ? "" : max < 3 ? "Not enough history for 3 periods." : `Enter a whole number from 3 to ${max.toLocaleString()} ${unit}s. Showing the last valid setting.`;
    if (!valid) return;
    finishScaleTransitions();
    clearHover(); state.lines[i] = { ...state.lines[i], period, unit }; series[i] = M.calculate(model, state.lines[i]); undo = null;
    render(); save();
  }
  function changeType(i) {
    if (!model || exporting) return;
    const select = $("ma" + (i + 1) + "Type"), type = select.value;
    if (!(i ? ["sma", "ema", "none"] : ["sma", "ema"]).includes(type)) { select.value = state.lines[i].type; return; }
    finishScaleTransitions();
    clearHover(); state.lines[i] = { ...state.lines[i], type }; series[i] = M.calculate(model, state.lines[i]); undo = null;
    // Preserve the last valid lookback when disabling or changing the method.
    const input = $("ma" + (i + 1) + "Period"); input.value = state.lines[i].period.toLocaleString("en-US"); sizePeriodInput(input);
    $("ma" + (i + 1) + "Unit").value = state.lines[i].unit;
    $("ma" + (i + 1) + "Error").textContent = ""; input.removeAttribute("aria-invalid");
    syncLineDropdown(i, "Type"); syncLineDropdown(i, "Unit"); setLineMenuOpen(i, "Unit", false);
    render(); save();
  }
  function sync(view = model ? currentView() : null) {
    if (!model) return;
    const b = bounds(), start = idx(state.startIso), end = idx(state.endIso), current = idx(state.currentIso), max = model.rows.length - 1;
    $("startDateInput").value = state.startIso; $("startDateInput").min = b.first; $("startDateInput").max = state.currentIso;
    $("endDateInput").value = state.currentIso; $("endDateInput").min = state.startIso; $("endDateInput").max = b.last;
    $("startDateBtn").innerHTML = calendarIcon + "<span>" + dateLabel(state.startIso) + "</span>"; $("endDateBtn").innerHTML = calendarIcon + "<span>" + dateLabel(state.currentIso) + "</span>";
    ["dateRangeStartSlider", "dateRangeEndSlider"].forEach((id) => { $(id).min = 0; $(id).max = max; });
    $("dateRangeStartSlider").value = start; $("dateRangeEndSlider").value = current;
    $("dateRangeSliderWrap").style.setProperty("--slider-start", `${100 * start / Math.max(1, max)}%`);
    $("dateRangeSliderWrap").style.setProperty("--slider-end", `${100 * current / Math.max(1, max)}%`);
    $("dateRangeSliderWrap").style.setProperty("--available-start", "0%"); $("dateRangeSliderWrap").style.setProperty("--available-end", "100%");
    const remaining = $("dateRangeSelection");
    if (remaining) {
      remaining.classList.toggle("active", (session || endScrub.active) && end > current);
      remaining.style.left = `${100 * current / Math.max(1, max)}%`;
      remaining.style.right = `calc(100% - ${100 * end / Math.max(1, max)}%)`;
      remaining.style.removeProperty("width");
    }
    if ($("dateRangeCurrentMarker")) $("dateRangeCurrentMarker").hidden = true;
    if (document.activeElement !== $("rangeDaysInput")) $("rangeDaysInput").value = (current - start + 1).toLocaleString("en-US");
    $("rangeDaysInput").max = model.rows.length;
    $("playBtn").disabled = playing || exporting; $("pauseBtn").disabled = !playing || exporting; $("stopBtn").disabled = !session || exporting;
    $("speedBtn").textContent = `${state.speed}x`;
    $("playBtn").classList.toggle("is-playing", playing); $("pauseBtn").classList.toggle("is-paused", session && !playing);
    $("playBtn").setAttribute("aria-pressed", String(playing)); $("stopBtn").classList.remove("is-active");
    $("historyTitle").textContent = state.startIso === b.first ? "Full History" : "Selected History";
    $("playBtn").setAttribute("aria-label", session ? "Resume playback" : "Play date range");
    document.querySelectorAll("#rangeButtons button").forEach((button) => { button.classList.remove("active"); button.classList.toggle("is-active", !session && button.dataset.rangePreset === state.preset); });
    const row = view.model.rows[view.endIndex]; $("dateKpi").textContent = row.date; $("priceKpi").textContent = G.kpiMoney(row.price);
    syncPriceSource(view);
    state.lines.forEach((line, i) => {
      const n = i + 1, value = view.series[i][view.endIndex], disabled = line.type === "none";
      $("ma" + n + "KpiChip").hidden = disabled;
      $("ma" + n + "Error").hidden = disabled;
      $("ma" + n + "Period").disabled = disabled || exporting;
      $("ma" + n + "Unit").disabled = disabled || exporting;
      $("ma" + n + "UnitDropdownTrigger").disabled = disabled || exporting;
      $("ma" + n + "KpiLabel").textContent = M.label(line, true);
      $("ma" + n + "Kpi").textContent = Number.isFinite(value) ? G.kpiMoney(value) : "Insufficient history";
      $("ma" + n + "Kpi").title = Number.isFinite(value)
        ? `${M.label(line)} · ${view.current ? (line.type === "ema" ? "current price applied once to the prior completed-period EMA" : `current price plus ${line.period - 1} prior completed closes`) : "prior completed closes"}`
        : `Requires a complete ${line.period}-${line.unit} window.`;
      $("ma" + n + "Period").max = model.limits[$("ma" + n + "Unit").value];
      $("ma" + n + "Period").title = `3–${model.limits[$("ma" + n + "Unit").value]} periods available in the latest dataset`;
      $("window" + n + "Title").textContent = G.windowTitle(line);
      const legend = $("legendMa" + n); if (legend) legend.textContent = M.label(line, true);
    });
    const single = state.lines[1].type === "none";
    $("ma2PeriodControls").hidden = single;
    $("window2Panel").hidden = single;
    $("chartGrid").classList.toggle("single-average", single);
    const lineLabels = state.lines.filter((line) => line.type !== "none").map((line) => M.label(line)).join(" and ");
    charts.forEach((id, i) => $(id).setAttribute("aria-label", `Bitcoin price and ${lineLabels} over ${i ? "the selected trailing window" : "the selected history"}`));
    ["historyScale", "window1Scale", "window2Scale"].forEach((id, i) => {
      C.syncScaleButtonGroup($(id), state.scales[i]);
      $(id).querySelectorAll(".chart-scale-btn").forEach((button) => {
        button.title = `Switch to ${state.scales[i] === "log" ? "linear" : "logarithmic"} scale`;
      });
    });
    $("chartGrid").style.setProperty("--chart-grid-height", `${state.height}px`);
    window.WSBDashboardPlaybackActive = session; window.dateRangePlaybackActive = session;
    if (announcedSession !== session) {
      announcedSession = session;
      try { if (window.parent !== window) window.parent.dateRangePlaybackActive = session; } catch (_) { /* Cross-origin embeds use the message below. */ }
      window.parent.postMessage({ type: "wsb-moving-average-date-range-playback-active", active: session }, window.location.origin);
    }
    const def = normalize();
    runtime.actions.syncResetState({ isUndo: !!undo, disabled: JSON.stringify(state) === JSON.stringify(def) && !session });
    updateEstimates();
  }
  function finishScaleTransitions() {
    cancelAnimationFrame(scalePaint); scalePaint = 0; scaleTransitions.clear();
  }
  function scaleMixAt(index, time) {
    const target = state.scales[index] === "log" ? 1 : 0, transition = scaleTransitions.get(index);
    if (!transition) return target;
    const progress = Math.min(1, Math.max(0, (time - transition.start) / transition.duration));
    if (progress === 1) { scaleTransitions.delete(index); return target; }
    // The notebook's half cosine cycle eases between normalized axis positions.
    const eased = (1 - Math.cos(Math.PI * progress)) / 2;
    return transition.from + (target - transition.from) * eased;
  }
  function scheduleScalePaint() {
    if (scalePaint || !scaleTransitions.size || document.hidden || exporting) return;
    scalePaint = requestAnimationFrame((time) => {
      scalePaint = 0;
      if (document.hidden || exporting) { finishScaleTransitions(); needsPaint = true; return; }
      paintCharts(time, true); scheduleScalePaint();
    });
  }
  function changeScale(index, scale) {
    if (!model || exporting || !["log", "linear"].includes(scale) || state.scales[index] === scale) return;
    const from = chartGeometry.get(charts[index])?.scaleMix ?? (state.scales[index] === "log" ? 1 : 0);
    const target = scale === "log" ? 1 : 0;
    state.scales[index] = scale; clearHover();
    if (!reducedMotion.matches && !document.hidden && from !== target) {
      scaleTransitions.set(index, { from, start: performance.now(), duration: Math.max(120, 700 * Math.abs(target - from)) });
    } else scaleTransitions.delete(index);
    render(); save();
  }
  function paintCharts(time, animatedOnly = false) {
    const { model: viewModel, series: viewSeries, endIndex } = display, theme = document.documentElement.dataset.theme;
    charts.forEach((id, i) => {
      if (i && state.lines[i - 1].type === "none") { chartGeometry.delete(id); scaleTransitions.delete(i); return; }
      if (animatedOnly && !scaleTransitions.has(i)) return;
      const canvas = $(id), { ctx, width, height } = G.setup(canvas);
      const startTime = i ? M.windowStart(viewModel.rows[endIndex].time, state.lines[i - 1].period, state.lines[i - 1].unit) : model.rows[idx(state.startIso)].time;
      const geometry = G.panel(ctx, { width, height }, { model: viewModel, series: viewSeries, lines: state.lines, endIndex, startTime,
        scale: state.scales[i], scaleMix: scaleMixAt(i, time), theme, hoverIndex: hover?.index ?? -1 });
      chartGeometry.set(id, geometry); canvas.dataset.startDate = new Date(startTime).toISOString().slice(0, 10); canvas.dataset.endDate = viewModel.rows[endIndex].date;
      canvas.dataset.priceSource = $("priceChip").dataset.priceSource;
    });
    if (hover) {
      const geometry = chartGeometry.get(hover.id);
      writeChartTooltip(hover.index, geometry, hover.id);
      placeChartTooltip(hover, $(hover.id).getBoundingClientRect(), geometry);
    }
  }
  function render() {
    if (!model) return;
    if (document.hidden || exporting) { needsPaint = true; return; }
    needsPaint = false; display = currentView(); sync(display);
    paintCharts(performance.now()); scheduleScalePaint();
  }
  function setRange(start, end, preset = "custom") {
    if (!model || exporting) return;
    finishScaleTransitions();
    clearHover(); pause(false); session = false;
    start = range.clampIndex(start); end = Math.max(start, range.clampIndex(end));
    state.startIso = model.rows[start].date; state.endIso = model.rows[end].date; state.currentIso = state.endIso;
    state.tracksLatest = end === model.rows.length - 1; state.preset = preset; undo = null;
    render(); save();
  }
  function seek(index, allowBeyondTarget = false) {
    if (!model || exporting) return;
    finishScaleTransitions();
    clearHover(); session = true; state.currentIso = model.rows[Math.max(idx(state.startIso), Math.min(allowBeyondTarget ? model.rows.length - 1 : idx(state.endIso), Math.round(index)))].date;
    lastFrame = 0; elapsed = 0; render(); save();
  }
  function step(time) {
    if (!playing || !model) return;
    if (document.hidden) { lastFrame = 0; raf = requestAnimationFrame(step); return; }
    if (!lastFrame) lastFrame = time;
    elapsed += Math.min(100, time - lastFrame) * 60 / 1000 * state.speed; lastFrame = time;
    const days = Math.floor(elapsed);
    if (days > 0) {
      clearHover(); elapsed -= days;
      const next = Math.min(idx(state.endIso), idx(state.currentIso) + days); state.currentIso = model.rows[next].date;
      if (next === idx(state.endIso)) { stop(); return; }
      render(); if (time - lastSaved > 500) save();
    }
    if (playing) raf = requestAnimationFrame(step); else save();
  }
  function play() {
    if (!model) { pendingPlay = true; return; }
    if (exporting || playing) return;
    if (!session) state.currentIso = state.startIso;
    clearHover(); session = true; playing = true; elapsed = 0; lastFrame = 0; raf = requestAnimationFrame(step); render(); save();
  }
  function pause(paint = true) { playing = false; cancelAnimationFrame(raf); lastFrame = 0; if (paint && model) { render(); save(); } }
  function stop(options = {}) {
    if (exporting || !model) return;
    clearHover(); pause(false);
    if (session && options.restoreOriginalRange === false) {
      state.endIso = state.currentIso; state.tracksLatest = state.endIso === model.rows.at(-1).date; state.preset = "custom";
    }
    session = false; state.currentIso = state.endIso; clearPlaybackScrubState(); rangeDrag = null;
    if (options.renderAfter !== false) { render(); save(); }
  }

  function clearPlaybackScrubState() {
    endScrub.active = false; endScrub.pointerId = null;
    endScrub.resumeAfterRelease = false; endScrub.captureOnWrap = false;
  }
  function capturePointer(element, event) {
    try { if (Number.isFinite(event.pointerId)) element.setPointerCapture(event.pointerId); } catch (_) { /* Synthetic events or released pointers need no capture. */ }
  }
  function currentRangeIndices() { return { startIndex: idx(state.startIso), endIndex: idx(state.currentIso), maxIndex: model.rows.length - 1 }; }
  function applyEndScrub(index) {
    if (!Number.isFinite(index)) return;
    const next = Math.max(idx(state.startIso), range.clampIndex(index));
    if (session) seek(next, true);
    else setRange(idx(state.startIso), next);
  }
  function beginEndScrub(event) {
    if (!model || exporting || (typeof event.button === "number" && event.button !== 0)) return;
    endScrub.active = true; endScrub.pointerId = Number.isFinite(event.pointerId) ? event.pointerId : null;
    endScrub.resumeAfterRelease = playing; endScrub.captureOnWrap = false;
    if (playing) pause();
    capturePointer($("dateRangeEndSlider"), event);
  }
  function beginStartScrub(event) {
    if (!model || exporting || (typeof event.button === "number" && event.button !== 0)) return;
    if (session) stop({ restoreOriginalRange: false });
  }
  function endEndScrub(event) {
    if (!endScrub.active || (Number.isFinite(endScrub.pointerId) && Number.isFinite(event.pointerId) && event.pointerId !== endScrub.pointerId)) return;
    try {
      if (Number.isFinite(event.pointerId)) $(endScrub.captureOnWrap ? "dateRangeSliderWrap" : "dateRangeEndSlider").releasePointerCapture(event.pointerId);
    } catch (_) { /* Pointer capture can already be released by the browser. */ }
    const resume = endScrub.resumeAfterRelease;
    clearPlaybackScrubState(); rangeDrag = null;
    refresh.requestCheck("range-scrub-finished");
    if (!session) { render(); save(); return; }
    if (idx(state.currentIso) >= idx(state.endIso)) { stop({ restoreOriginalRange: false }); return; }
    if (resume) play(); else { render(); save(); }
  }
  function beginRangeDrag(event) {
    if (!model || exporting || (typeof event.button === "number" && event.button !== 0)
        || (endScrub.active && !endScrub.captureOnWrap)) return;
    const { startIndex, endIndex, maxIndex } = currentRangeIndices();
    const wrap = $("dateRangeSliderWrap"), rect = wrap.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || rect.width <= 0) return;
    const startX = rect.left + range.indexPercent(startIndex) * rect.width / 100;
    const endX = rect.left + range.indexPercent(endIndex) * rect.width / 100;
    const nearStart = Math.abs(event.clientX - startX) <= 12, nearEnd = Math.abs(event.clientX - endX) <= 12;
    if (nearStart || nearEnd) {
      const mode = nearStart && nearEnd ? (Math.abs(event.clientX - startX) <= Math.abs(event.clientX - endX) ? "start" : "end") : nearStart ? "start" : "end";
      if (session && mode === "start") stop({ restoreOriginalRange: false });
      if (session && mode === "end") {
        endScrub.active = true; endScrub.pointerId = Number.isFinite(event.pointerId) ? event.pointerId : null;
        endScrub.resumeAfterRelease = playing; endScrub.captureOnWrap = true;
        if (playing) pause();
      }
      event.preventDefault();
      rangeDrag = { mode, pointerId: event.pointerId, startIndex, endIndex, maxIndex, startClientX: event.clientX, wrapWidth: rect.width };
      capturePointer(wrap, event); return;
    }
    if (session) {
      const index = range.indexFromPointer(event.clientX, wrap);
      if (!Number.isFinite(index)) return;
      event.preventDefault(); endScrub.active = true; endScrub.pointerId = Number.isFinite(event.pointerId) ? event.pointerId : null;
      endScrub.resumeAfterRelease = playing; endScrub.captureOnWrap = true;
      if (playing) pause();
      applyEndScrub(index); capturePointer(wrap, event); return;
    }
    if (event.clientX <= startX + 12 || event.clientX >= endX - 12 || startIndex >= endIndex) return;
    event.preventDefault();
    rangeDrag = { mode: "range", pointerId: event.pointerId, startIndex, endIndex, maxIndex, startClientX: event.clientX, wrapWidth: rect.width };
    capturePointer(wrap, event);
  }
  function moveRangeDrag(event) {
    if (!model || exporting) return;
    if (endScrub.active) {
      if (Number.isFinite(endScrub.pointerId) && Number.isFinite(event.pointerId) && event.pointerId !== endScrub.pointerId) return;
      event.preventDefault(); applyEndScrub(range.indexFromPointer(event.clientX, $("dateRangeSliderWrap"))); return;
    }
    if (!rangeDrag || event.pointerId !== rangeDrag.pointerId) return;
    event.preventDefault();
    const pointerIndex = range.indexFromPointer(event.clientX, $("dateRangeSliderWrap"));
    if (!Number.isFinite(pointerIndex)) return;
    const current = currentRangeIndices();
    if (rangeDrag.mode === "start" || rangeDrag.mode === "end") {
      setRange(rangeDrag.mode === "start" ? Math.min(current.endIndex, pointerIndex) : current.startIndex,
        rangeDrag.mode === "end" ? Math.max(current.startIndex, pointerIndex) : current.endIndex); return;
    }
    const delta = Math.round((event.clientX - rangeDrag.startClientX) / Math.max(1, rangeDrag.wrapWidth) * Math.max(1, rangeDrag.maxIndex));
    const moved = range.moveRangeByDelta(rangeDrag.startIndex, rangeDrag.endIndex, delta);
    setRange(moved.startIndex, moved.endIndex);
  }
  function endRangeDrag(event) {
    if (endScrub.active) { endEndScrub(event); return; }
    if (!rangeDrag || event.pointerId !== rangeDrag.pointerId) return;
    try { if (Number.isFinite(event.pointerId)) $("dateRangeSliderWrap").releasePointerCapture(event.pointerId); } catch (_) {}
    rangeDrag = null; refresh.requestCheck("range-drag-finished"); if (needsPaint) render();
  }
  function keyboardScrub(direction, detail = {}) {
    if (!model || exporting || !session) return;
    const next = Math.max(idx(state.startIso), Math.min(idx(state.endIso), idx(state.currentIso) + direction * (detail.isStep ? 1 : 600)));
    if (next === idx(state.currentIso)) return;
    seek(next);
    if (direction > 0 && playing && next === idx(state.endIso)) pause();
  }
  function preset(value) {
    const end = model.rows.length - 1;
    const start = value === "full" ? 0 : value === "ytd" ? idx(model.rows[end].date.slice(0, 4) + "-01-01") : G.indexAt(model.rows, M.windowStart(model.rows[end].time, Number.parseInt(value, 10) * 12, "month"));
    setRange(start, end, value);
  }
  const downloadDefaults = { orientation: "landscape", quality: "720", fps: "60", theme: "", endFrameHold: true };
  let downloadSettings = { ...downloadDefaults };
  function normalizeDownload(s = {}) {
    return { orientation: ["landscape", "portrait", "square"].includes(s.orientation) ? s.orientation : "landscape",
      quality: ["720", "1080", "1440", "2160"].includes(String(s.quality)) ? String(s.quality) : "720",
      fps: ["30", "60", "120", "240"].includes(String(s.fps)) ? String(s.fps) : "60",
      theme: ["light", "dark"].includes(s.theme) ? s.theme : "", endFrameHold: s.endFrameHold !== false };
  }
  const downloads = C.createDownloadSettingsController({ storageKey: DOWNLOAD_STORAGE, defaults: downloadDefaults, normalize: normalizeDownload,
    groups: { orientation: { group: $("downloadOrientationSelect") }, quality: { group: $("downloadQualitySelect") }, fps: { group: $("downloadFpsSelect") }, theme: { group: $("downloadThemeSelect") } },
    checkboxes: { endFrameHold: { checkbox: $("downloadEndFrameHoldToggle"), defaultValue: true } },
    afterWrite: () => updateEstimates(),
  });
  function frames(settings) {
    if (!model) return [];
    const first = idx(state.startIso), last = idx(state.currentIso), speed = Number(settings.fps) / 60;
    const values = []; for (let f = 0; Math.floor(f * speed) <= last - first; f++) values.push(first + Math.floor(f * speed));
    if (values.at(-1) !== last) values.push(last);
    return settings.endFrameHold ? [...Array(30).fill(last), ...values, ...Array(90).fill(last)] : values;
  }
  function updateEstimates() {
    if (!model) return;
    const settings = normalizeDownload(downloads.readControls());
    const chartCount = 1 + state.lines.filter((line) => line.type !== "none").length;
    const key = JSON.stringify([settings, state.startIso, state.currentIso, chartCount]);
    if (key === estimateKey) return;
    estimateKey = key;
    const list = frames(settings);
    const estimate = window.WSBDashboardExport.estimateDownload(settings, { frameCount: list.length, uniqueFrameCount: new Set(list).size, chartCount, outputFps: 30 });
    E.writeEstimateElements({ size: $("downloadEstimateSize"), length: $("downloadEstimateLength"), time: $("downloadEstimateTime") }, estimate);
    if (!E.hasWebCodecsExportSupport()) {
      $("dateRangeDownloadBtn").disabled = true; $("downloadSettingsDownloadBtn").disabled = true;
      $("dateRangeDownloadBtn").title = "Video export requires a browser with WebCodecs support. PNG export is available.";
    }
  }
  function download(blob, extension, snapshot) {
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `moving-average-${snapshot.lines.filter((l) => l.type !== "none").map((l) => M.label(l, true).replaceAll(" ", "")).join("-")}-${snapshot.currentIso}.${extension}`;
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function drawOutput(canvas, snapshot, outputSettings, endIndex) {
    const dimensions = E.getDimensions(outputSettings); canvas.width = dimensions.width; canvas.height = dimensions.height;
    const ctx = canvas.getContext("2d");
    const reference = E.getDimensions({ ...outputSettings, quality: "720" });
    ctx.scale(dimensions.width / reference.width, dimensions.height / reference.height);
    G.composite(ctx, reference.width, reference.height, { model: snapshot.model, series: snapshot.series, lines: snapshot.lines, scales: snapshot.scales,
      startIndex: snapshot.startIndex, endIndex, theme: outputSettings.theme || snapshot.theme });
  }
  function exportSnapshot() { return { ...capture(), model, series: series.slice(), startIndex: idx(state.startIso), currentIndex: idx(state.currentIso),
    publishedAt: installed.publishedAt, useLivePrice: usesLivePrice(), theme: document.documentElement.dataset.theme }; }
  function liveExportSnapshot(snapshot) {
    if (!snapshot.useLivePrice) return snapshot;
    const view = viewWithQuote(snapshot.model, snapshot.lines, snapshot.currentIndex, snapshot.publishedAt, selectedQuote());
    return { ...snapshot, model: view.model, series: view.series, currentIndex: view.endIndex, currentIso: view.model.rows[view.endIndex].date };
  }
  async function imageExport() {
    if (!model || exporting) return;
    finishScaleTransitions(); render();
    const snapshot = liveExportSnapshot(exportSnapshot()), settings = normalizeDownload(downloads.readControls()), canvas = document.createElement("canvas");
    await document.fonts.ready; drawOutput(canvas, snapshot, settings, snapshot.currentIndex);
    canvas.toBlob((blob) => { if (blob) download(blob, "png", snapshot); }, "image/png");
  }
  async function videoExport() {
    if (exporting) { cancelExport = true; $("dateRangeDownloadBtn").classList.add("is-canceling"); return; }
    if (!model || !E.hasWebCodecsExportSupport()) return;
    finishScaleTransitions(); render();
    const snapshot = exportSnapshot(), settings = normalizeDownload(downloads.readControls()), list = frames(settings), canvas = document.createElement("canvas");
    // Only the final motion frame and its hold receive a current quote. Capture
    // that projection once so incoming ticks cannot change held export frames.
    let finalStart = 0, finalSnapshot = null;
    list.forEach((index, frameIndex) => { if (index !== snapshot.currentIndex) finalStart = frameIndex + 1; });
    const wasPlaying = playing; pause(false); closeLineMenus(); exporting = true; cancelExport = false;
    const controls = new Map();
    const buttonMarkup = $("dateRangeDownloadBtn").innerHTML;
    document.querySelectorAll("input,select,button").forEach((element) => { controls.set(element, element.disabled); element.disabled = !["dateRangeDownloadBtn", "downloadSettingsDownloadBtn"].includes(element.id); });
    window.dateRangeExportActive = true; window.wsbDashboardExportActive = true;
    window.parent.postMessage({ type: "wsb-moving-average-date-range-export-active", active: true }, "*");
    function progress(value) {
      const button = $("dateRangeDownloadBtn"), pct = `${Math.max(0, Math.min(1, Number(value) || 0)) * 100}%`;
      const ring = button.querySelector(".date-range-export-progress");
      if (button.classList.contains("is-exporting") && ring) { ring.style.setProperty("--date-range-export-progress", pct); return; }
      button.classList.add("is-exporting"); button.setAttribute("aria-label", "Cancel animation download"); button.title = "Cancel download";
      button.innerHTML = `<span class="date-range-export-progress" style="--date-range-export-progress:${pct}" aria-hidden="true"><span class="date-range-export-stop-square"></span></span>`;
      $("downloadSettingsDownloadBtn").classList.add("is-stop-download"); $("downloadSettingsDownloadBtn").textContent = "Stop Download";
    }
    progress(0);
    try {
      await document.fonts.ready;
      const { width, height } = E.getDimensions(settings);
      const blob = await window.WSBDashboardExport.encodeWebM({ canvas, width, height, settings, fps: 30, frames: list, title: "Moving Average",
        renderFrame: (index, _canvas, frameIndex) => {
          if (snapshot.useLivePrice && frameIndex >= finalStart) {
            if (!finalSnapshot) finalSnapshot = liveExportSnapshot(snapshot);
            drawOutput(canvas, finalSnapshot, settings, finalSnapshot.currentIndex);
          } else drawOutput(canvas, snapshot, settings, index);
        }, isCanceled: () => cancelExport, onProgress: progress });
      if (!blob && !cancelExport) throw new Error("This browser cannot encode the selected WebM export.");
      if (blob && !cancelExport) download(blob, "webm", finalSnapshot || snapshot);
    } catch (error) { status(`Export failed: ${error.message}`, true); }
    finally {
      exporting = false; controls.forEach((disabled, element) => { element.disabled = disabled; });
      $("dateRangeDownloadBtn").classList.remove("is-exporting", "is-canceling");
      $("dateRangeDownloadBtn").setAttribute("aria-label", "Download date range animation");
      $("dateRangeDownloadBtn").innerHTML = buttonMarkup; $("dateRangeDownloadBtn").title = "Download animation";
      $("downloadSettingsDownloadBtn").classList.remove("is-stop-download"); $("downloadSettingsDownloadBtn").textContent = "Download Animation";
      window.dateRangeExportActive = false; window.wsbDashboardExportActive = false;
      window.parent.postMessage({ type: "wsb-moving-average-date-range-export-active", active: false }, "*");
      refresh.requestCheck("export-finished");
      render(); if (wasPlaying) play();
    }
  }
  function install(candidate) {
    // Keep export snapshots and active drag geometry stable. The controller
    // retries with a fresh marker after the export or pointer interaction ends.
    if (exporting || rangeDrag || endScrub.active || chartDragging) return false;
    const initial = !model, priorLast = model?.rows.at(-1).date;
    const shared = initial ? C.readShareState() : null;
    const source = initial ? (shared || read(STORAGE) || {}) : null;
    const nextState = initial ? normalize(source, !!shared, candidate.model) : clone(state);
    if (!initial && nextState.tracksLatest && nextState.endIso === priorLast) {
      const atEnd = nextState.currentIso === nextState.endIso;
      nextState.endIso = candidate.model.rows.at(-1).date;
      if (atEnd && !session) nextState.currentIso = nextState.endIso;
    }
    // Finish all potentially failing calculations before replacing visible data.
    const nextSeries = nextState.lines.map((line) => M.calculate(candidate.model, line));
    clearHover(); model = candidate.model; installed = candidate; state = nextState; series = nextSeries;
    if (initial) {
      session = !!source.pausedPlayback; writeLineControls();
      document.querySelectorAll("[data-needs-data]").forEach((element) => { element.disabled = false; });
    }
    updated.setUpdated(candidate.publishedAt, { includeHeight: true, height: candidate.latestHeight });
    document.querySelectorAll(".panel-loader, .dashboard-ring-loader").forEach((element) => { element.classList.add("hidden"); element.setAttribute("aria-hidden", "true"); });
    document.body.classList.remove("moving-average-loading"); document.body.dataset.ready = "true"; status("");
    render(); if (initial && pendingPlay) { pendingPlay = false; play(); }
    return true;
  }
  function bind() {
    for (let i = 0; i < 2; i++) {
      const input = $("ma" + (i + 1) + "Period");
      input.addEventListener("input", () => { formatPeriodInput(input); changeLine(i); });
      input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); changeLine(i); input.blur(); } });
      $("ma" + (i + 1) + "Unit").addEventListener("change", () => changeLine(i));
      $("ma" + (i + 1) + "Type").addEventListener("change", () => changeType(i));
      for (const kind of ["Type", "Unit"]) bindLineDropdown(i, kind);
      sizePeriodInput(input);
    }
    document.addEventListener("pointerdown", (event) => {
      for (let i = 0; i < 2; i++) for (const kind of ["Type", "Unit"]) if (!lineMenuElements(i, kind).dropdown.contains(event.target)) setLineMenuOpen(i, kind, false);
    });
    ["historyScale", "window1Scale", "window2Scale"].forEach((id, i) => $(id).addEventListener("click", (event) => {
      const button = event.target.closest(".chart-scale-btn");
      if (button && !button.disabled) changeScale(i, state.scales[i] === "log" ? "linear" : "log");
    }));
    const editRange = (start, end) => { clearPlaybackScrubState(); rangeDrag = null; setRange(start, end); };
    window.WSBDashboardComponents.bindDateRangePickers({ isDisabled: () => exporting || !model,
      onSelect: (which, iso) => editRange(which === "start" ? idx(iso) : idx(state.startIso), which === "end" ? idx(iso) : idx(state.currentIso)) });
    $("startDateInput").addEventListener("change", (e) => editRange(idx(e.target.value), idx(state.currentIso)));
    $("endDateInput").addEventListener("change", (e) => editRange(idx(state.startIso), idx(e.target.value)));
    $("playBtn").addEventListener("click", play); $("pauseBtn").addEventListener("click", () => pause()); $("stopBtn").addEventListener("click", () => stop());
    $("speedBtn").addEventListener("click", () => { state.speed = SPEEDS[(SPEEDS.indexOf(state.speed) + 1) % SPEEDS.length]; render(); save(); });
    $("rangeButtons").addEventListener("click", (event) => { const button = event.target.closest("[data-range-preset]"); if (button && model && !exporting) { clearPlaybackScrubState(); rangeDrag = null; preset(button.dataset.rangePreset); } });
    $("rangeDaysInput").addEventListener("change", (event) => {
      const days = Number.parseInt(event.target.value.replace(/[^\d]/g, ""), 10);
      if (model && Number.isFinite(days) && days > 0) editRange(Math.max(0, idx(state.currentIso) - days + 1), idx(state.currentIso));
    });
    $("dateRangeStartSlider").addEventListener("input", (event) => {
      if (!model || exporting) return;
      const end = idx(state.currentIso); setRange(Math.min(Number(event.target.value) || 0, end), end);
    });
    $("dateRangeStartSlider").addEventListener("pointerdown", beginStartScrub);
    $("dateRangeEndSlider").addEventListener("input", (event) => { if (model && !exporting) applyEndScrub(Number(event.target.value)); });
    $("dateRangeEndSlider").addEventListener("pointerdown", beginEndScrub);
    $("dateRangeEndSlider").addEventListener("pointerup", endEndScrub);
    $("dateRangeEndSlider").addEventListener("pointercancel", endEndScrub);
    $("dateRangeSliderWrap").addEventListener("pointerdown", beginRangeDrag);
    $("dateRangeSliderWrap").addEventListener("pointermove", moveRangeDrag);
    $("dateRangeSliderWrap").addEventListener("pointerup", endRangeDrag);
    $("dateRangeSliderWrap").addEventListener("pointercancel", endRangeDrag);
    C.bindPlaybackKeyboardShortcuts({ isPlaybackActive: () => session, isEscapeActive: () => !document.querySelector(".ma-controls .dca-dropdown.is-open") && (session || document.body.classList.contains("moving-average-dashboard-expanded")),
      isTextEntry: (el) => !!el && (el.closest(".ma-controls .dca-dropdown, .chart-scale-btn") || el.isContentEditable || ["TEXTAREA", "SELECT"].includes(el.tagName) || (el.tagName === "INPUT" && el.type !== "range")),
      blurControls: () => {
        const active = document.activeElement;
        if (["dateRangeStartSlider", "dateRangeEndSlider", "playBtn", "pauseBtn", "stopBtn", "speedBtn"].some((id) => active === $(id)) || $("rangeButtons").contains(active)) active?.blur();
      },
      onSpace: () => { if (!exporting) playing ? pause() : play(); },
      onArrow: (direction, _event, detail) => keyboardScrub(direction, detail),
      onEscape: () => { if (session) stop(); else expand(false); } });
    $("dashboardExpandBtn").addEventListener("click", () => expand(!document.body.classList.contains("moving-average-dashboard-expanded")));
    $("downloadImageBtn").addEventListener("click", imageExport); $("dateRangeDownloadBtn").addEventListener("click", videoExport); $("downloadSettingsDownloadBtn").addEventListener("click", videoExport);
    $("dateRangeSettingsBtn").addEventListener("click", () => C.setFloatingMenuOpen({ menu: $("dateRangeSettingsMenu"), button: $("dateRangeSettingsBtn") }, !$("dateRangeSettingsMenu").classList.contains("open")));
    document.addEventListener("pointerdown", (event) => { if (!event.target.closest("#dateRangeSettingsMenu,#dateRangeSettingsBtn")) C.setFloatingMenuOpen({ menu: $("dateRangeSettingsMenu"), button: $("dateRangeSettingsBtn") }, false); });
    $("dateRangeSettingsMenu").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-value]"); if (!button || exporting) return;
      C.setButtonGroupValue(button.parentElement, button.dataset.value); downloadSettings = downloads.readControls(); downloads.save(downloadSettings); updateEstimates();
    });
    $("downloadEndFrameHoldToggle").addEventListener("change", () => { downloadSettings = downloads.readControls(); downloads.save(downloadSettings); updateEstimates(); });
    charts.forEach((id) => bindChart(id));
    if ($("chartsResizeHandle")) {
      let resize = null;
      $("chartsResizeHandle").addEventListener("pointerdown", (e) => { if (exporting) return; resize = { y: e.clientY, height: state.height }; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); });
      $("chartsResizeHandle").addEventListener("pointermove", (e) => { if (resize) { state.height = Math.max(400, Math.min(1200, resize.height + e.clientY - resize.y)); render(); } });
      $("chartsResizeHandle").addEventListener("pointerup", () => { resize = null; save(); });
      $("chartsResizeHandle").addEventListener("pointercancel", () => { resize = null; });
    }
    window.addEventListener("beforeunload", (event) => { save(); if (exporting) { event.preventDefault(); event.returnValue = ""; } });
    window.addEventListener("resize", () => { clearHover(); render(); });
    document.addEventListener("dashboard-theme-change", () => { clearHover(); render(); });
    document.addEventListener("scroll", () => { if (hover) { clearHover(); render(); } }, true);
    document.addEventListener("visibilitychange", () => {
      lastFrame = 0;
      if (document.hidden) { finishScaleTransitions(); needsPaint = true; }
      else if (needsPaint) render();
    });
    reducedMotion.addEventListener("change", () => { if (reducedMotion.matches) { finishScaleTransitions(); render(); } });
  }
  function expand(value) {
    document.body.classList.toggle("moving-average-dashboard-expanded", value);
    $("dashboardExpandBtn").setAttribute("aria-pressed", String(value)); $("dashboardExpandBtn").classList.toggle("is-expanded", value);
    window.parent.postMessage({ type: "wsb-moving-average-dashboard-expanded", expanded: value }, "*"); render();
  }
  const tooltip = $("chartTooltip");
  function clearHover() { hover = null; tooltip.hidden = true; }
  function writeChartTooltip(index, geometry, chartId) {
    const row = display.model.rows[index], colors = G.palette(document.documentElement.dataset.theme);
    function entry(text, className, color) {
      const node = document.createElement("div"); node.className = className; node.textContent = text;
      if (color) node.style.color = color;
      return node;
    }
    const entries = [entry(row.date, "chart-hover-tooltip-date"), entry(`Bitcoin  ${G.money(row.price)}`, "chart-hover-tooltip-value", colors.fg)];
    state.lines.forEach((line, i) => {
      if (line.type === "none") return;
      const value = G.hoverValue(display.model, display.series[i], line, index, geometry.endIndex, state.scales[charts.indexOf(chartId)], geometry);
      const label = Number.isFinite(value.value) ? G.money(value.value) : "Insufficient history";
      entries.push(entry(`${M.label(line, true)}  ${label}`, "chart-hover-tooltip-value", colors.lines[i]));
    });
    tooltip.replaceChildren(...entries.flatMap((node, i) => i ? ["\n", node] : [node]));
  }
  function placeChartTooltip(event, rect, geometry) {
    // Match UoA: sit beside the date guide, centered vertically on the cursor,
    // and retain the flip boundary while hovering to avoid width-change jitter.
    const pad = 8, gap = 10;
    // Reserve the axis gutter so the tooltip never covers the y-tick labels.
    const left = Math.max(pad, rect.left + geometry.plot.left + pad);
    const right = Math.min(innerWidth - pad, rect.left + geometry.plot.right - pad);
    const top = Math.max(pad, rect.top + geometry.plot.top), bottom = Math.min(innerHeight - pad, rect.top + geometry.plot.bottom);
    tooltip.style.maxWidth = `${Math.max(1, right - left)}px`;
    tooltip.style.maxHeight = `${Math.max(1, bottom - top)}px`;
    tooltip.style.left = `${left}px`; tooltip.style.top = `${top}px`;
    tooltip.hidden = false;
    const { width, height } = tooltip.getBoundingClientRect();
    const guideX = rect.left + geometry.plot.left + (display.model.rows[hover.index].time - geometry.startTime) / (geometry.endTime - geometry.startTime) * geometry.plot.width;
    const overflowsRight = guideX + gap + width > right;
    if (overflowsRight) hover.flipBoundary = Number.isFinite(hover.flipBoundary) ? Math.min(hover.flipBoundary, guideX) : guideX;
    const flipLeft = Number.isFinite(hover.flipBoundary) ? guideX >= hover.flipBoundary : overflowsRight;
    const x = flipLeft ? guideX - gap - width : guideX + gap;
    const y = event.clientY - height / 2;
    tooltip.style.left = `${Math.max(left, Math.min(right - width, x))}px`;
    tooltip.style.top = `${Math.max(top, Math.min(bottom - height, y))}px`;
  }
  function bindChart(id) {
    const canvas = $(id); let pan = null;
    canvas.addEventListener("pointermove", (event) => {
      if (!model || exporting || playing) return;
      const geometry = chartGeometry.get(id); if (!geometry) return;
      const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
      if (pan) { const delta = Math.round((pan.x - event.clientX) / geometry.plot.width * (pan.end - pan.start)); const next = range.moveRangeByDelta(pan.start, pan.end, delta); setRange(next.startIndex, next.endIndex); return; }
      if (x < geometry.plot.left || x > geometry.plot.right || y < geometry.plot.top || y > geometry.plot.bottom) {
        if (hover) { clearHover(); render(); } return;
      }
      const ratio = Math.max(0, Math.min(1, (x - geometry.plot.left) / geometry.plot.width));
      const time = geometry.startTime + ratio * (geometry.endTime - geometry.startTime);
      if (time < display.model.rows[0].time) { if (hover) { clearHover(); render(); } return; }
      const index = Math.min(geometry.endIndex, G.indexAt(display.model.rows, time));
      hover = { id, index, clientX: event.clientX, clientY: event.clientY, flipBoundary: hover?.id === id ? hover.flipBoundary : null };
      render();
    });
    canvas.addEventListener("pointerleave", () => { clearHover(); render(); });
    canvas.addEventListener("pointercancel", () => { pan = null; chartDragging = false; clearHover(); render(); });
    if (id !== "historyChart") return;
    canvas.addEventListener("pointerdown", (event) => { if (!model || exporting || session || event.button !== 0) return; pan = { x: event.clientX, start: idx(state.startIso), end: idx(state.endIso) }; chartDragging = true; canvas.setPointerCapture(event.pointerId); clearHover(); render(); });
    canvas.addEventListener("pointerup", () => { pan = null; chartDragging = false; if (needsPaint) render(); refresh.requestCheck("chart-drag-finished"); });
    canvas.addEventListener("wheel", (event) => {
      if (!model || exporting || session) return;
      event.preventDefault(); const start = idx(state.startIso), end = idx(state.endIso), rect = canvas.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)); const span = Math.max(2, Math.min(model.rows.length - 1, Math.round((end - start) * (event.deltaY > 0 ? 1.15 : 0.85))));
      const anchor = start + ratio * (end - start); const nextStart = Math.max(0, Math.min(model.rows.length - 1 - span, Math.round(anchor - ratio * span))); setRange(nextStart, nextStart + span);
    }, { passive: false });
  }
  downloadSettings = downloads.load();
  if (!downloads.hasStoredSettings()) downloads.writeControls({ ...downloadSettings, theme: document.documentElement.dataset.theme });
  bind();
  window.addEventListener("wsb:data-refresh-status", (event) => {
    if (event.detail.status === "error" || event.detail.status === "failed") status(model ? "History refresh unavailable. Keeping the last complete history and available spot price; retrying automatically." : "Prices could not be loaded. Retrying automatically…", true);
  });
  const refresh = window.WSBWebappDataAutoRefresh;
  refresh.register({ getInstalledSignature: () => installed?.signature || "",
    prepare: (context) => M.prepareCandidate(context), validate: (candidate) => M.validateCandidate(candidate, installed), commit: install });
  spotFeed = window.WSBBitcoinSpotPrice?.create({ onQuote: presentLivePrice }) || null;
  spotFeed?.start();
  window.addEventListener("pagehide", () => { spotFeed?.stop(); finishScaleTransitions(); needsPaint = true; });
  window.addEventListener("pageshow", () => { spotFeed?.start(); if (needsPaint) render(); presentLivePrice(); });
  // Read-only state is useful to diagnostics and browser contract tests.
  window.WSBMovingAverageDashboard = { getState: capture, getModel: () => model, getSeries: () => series,
    getDisplayModel: () => display?.model || model, getDisplaySeries: () => display?.series || series,
    getInstalledSignature: () => installed?.signature || "", isPlaying: () => playing };
}());
