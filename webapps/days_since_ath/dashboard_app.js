(function () {
  const DASHBOARD_COMPONENTS = window.WSBDashboardComponents || {};
  const DASHBOARD_TIME = window.WSBDashboardTime || null;
  const STORAGE_KEY = "days_since_ath_dashboard_state_v1";
  const DOWNLOAD_SETTINGS_KEY = "days_since_ath_download_settings_v1";
  const THEME_KEY = "quantum-research-dashboard-theme";
  const PRICE_FALLBACK = 0.0001;
  const SPEEDS = [0.5, 1, 2, 4];
  const DATE_RANGE_EXPORT_VIDEO_FPS = 30;
  const DEFAULT_RANGE_PLAYBACK_FPS = 60;
  const DATE_RANGE_EXPORT_START_HOLD_SECONDS = 1;
  const DATE_RANGE_EXPORT_END_HOLD_SECONDS = 3;
  const DATE_RANGE_PLAYBACK_FPS_OPTIONS = [30, 60, 120, 240];
  const DEFAULT_DOWNLOAD_SETTINGS = {
    chartMode: "both",
    quality: "720",
    orientation: "landscape",
    theme: "",
    fps: String(DEFAULT_RANGE_PLAYBACK_FPS),
    leftScale: "log",
    rightScale: "linear",
    endFrameHold: true,
  };
  const EXPORT_THEME_PALETTES = {
    dark: {
      "--bg": "#000000",
      "--panel": "#000000",
      "--fg": "#e5e7eb",
      "--muted": "#95a6ae",
      "--accent": "#ff9900",
      "--green": "#35c779",
      "--line": "#242424",
    },
    light: {
      "--bg": "#ffffff",
      "--panel": "#ffffff",
      "--fg": "#111827",
      "--muted": "#6f685f",
      "--accent": "#ff9900",
      "--green": "#35c779",
      "--line": "#e6e6e6",
    },
  };
  const ATH_LABEL_FONT_SIZE = 12;
  const ATH_LABEL_FONT_FAMILY = "IBM Plex Mono, monospace";
  const ATH_LABEL_FONT = `500 ${ATH_LABEL_FONT_SIZE}px ${ATH_LABEL_FONT_FAMILY}`;
  const CURRENT_ATH_LABEL_FONT = `700 ${ATH_LABEL_FONT_SIZE}px ${ATH_LABEL_FONT_FAMILY}`;
  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const HALVINGS = [
    { height: 210000, label: "1st Halving", date: "2012-11-28" },
    { height: 420000, label: "2nd Halving", date: "2016-07-09" },
    { height: 630000, label: "3rd Halving", date: "2020-05-11" },
    { height: 840000, label: "4th Halving", date: "2024-04-20" },
  ];
  const ICONS = {
    copyLink: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
    copyCopied: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>',
    resetDefaults: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>',
    resetUndo: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>',
  };

  const state = {
    rows: [],
    startIso: "",
    endIso: "",
    currentIso: "",
    preset: "full",
    speed: 1,
    chartMode: "both",
    priceScaleMode: "log",
    daysScaleMode: "linear",
    showAthLabels: true,
    showAthMarkers: true,
    showHalvings: true,
    timeZone: DASHBOARD_TIME?.getPreferredTimeZone?.() || "UTC",
    playing: false,
    timer: null,
  };

  const dateRangeController = DASHBOARD_COMPONENTS.createIndexDateRangeController?.({
    getRows: () => state.rows,
    getDate: (row) => row?.date,
    onRange: ({ startIso, endIso }, options = {}) => {
      state.startIso = startIso || state.startIso;
      state.endIso = endIso || state.endIso;
      state.currentIso = state.endIso;
      state.preset = inferPreset(state.startIso, state.endIso) || options.preset || "";
      render();
    },
  });

  const el = {
    updatedKpi: document.getElementById("updatedKpi"),
    heightKpi: document.getElementById("heightKpi"),
    dailyHighKpi: document.getElementById("dailyHighKpi"),
    athKpi: document.getElementById("athKpi"),
    drawdownKpi: document.getElementById("drawdownKpi"),
    daysKpi: document.getElementById("daysKpi"),
    startInput: document.getElementById("startDateInput"),
    endInput: document.getElementById("endDateInput"),
    startBtn: document.getElementById("startDateBtn"),
    endBtn: document.getElementById("endDateBtn"),
    rangeDaysInput: document.getElementById("rangeDaysInput"),
    rangeButtons: document.getElementById("rangeButtons"),
    sliderWrap: document.getElementById("dateRangeSliderWrap"),
    startSlider: document.getElementById("dateRangeStartSlider"),
    endSlider: document.getElementById("dateRangeEndSlider"),
    selection: document.getElementById("dateRangeSelection"),
    playBtn: document.getElementById("playBtn"),
    pauseBtn: document.getElementById("pauseBtn"),
    stopBtn: document.getElementById("stopBtn"),
    speedBtn: document.getElementById("speedBtn"),
    chartModeButtons: document.getElementById("dateRangeChartControls"),
    chartGrid: document.getElementById("chartGrid"),
    pricePanel: document.getElementById("pricePanel"),
    daysPanel: document.getElementById("daysPanel"),
    priceScaleButtons: document.getElementById("priceScaleButtons"),
    daysScaleButtons: document.getElementById("daysScaleButtons"),
    priceCanvas: document.getElementById("priceCanvas"),
    daysCanvas: document.getElementById("daysCanvas"),
    priceChartLoader: document.getElementById("priceChartLoader"),
    daysChartLoader: document.getElementById("daysChartLoader"),
    athLabelsToggle: document.getElementById("toggleAthLabels"),
    athMarkersToggle: document.getElementById("toggleAthMarkers"),
    halvingsToggle: document.getElementById("toggleHalvings"),
    expandBtn: document.getElementById("dashboardExpandBtn"),
    downloadBtn: document.getElementById("dateRangeDownloadBtn"),
    settingsBtn: document.getElementById("dateRangeSettingsBtn"),
    settingsMenu: document.getElementById("dateRangeSettingsMenu"),
    downloadChartModeSelect: document.getElementById("downloadChartModeSelect"),
    downloadPriceScaleSelect: document.getElementById("downloadPriceScaleSelect"),
    downloadDaysScaleSelect: document.getElementById("downloadDaysScaleSelect"),
    downloadOrientationSelect: document.getElementById("downloadOrientationSelect"),
    downloadQualitySelect: document.getElementById("downloadQualitySelect"),
    downloadFpsSelect: document.getElementById("downloadFpsSelect"),
    downloadThemeSelect: document.getElementById("downloadThemeSelect"),
    downloadEndFrameHoldToggle: document.getElementById("downloadEndFrameHoldToggle"),
    downloadEstimateSize: document.getElementById("downloadEstimateSize"),
    downloadEstimateLength: document.getElementById("downloadEstimateLength"),
    downloadEstimateTime: document.getElementById("downloadEstimateTime"),
    settingsDownloadBtn: document.getElementById("downloadSettingsDownloadBtn"),
    copyLink: document.getElementById("copyDashboardLink"),
    reset: document.getElementById("resetDashboard"),
  };

  const updatedTimeZoneChip = DASHBOARD_COMPONENTS.createUpdatedTimeZoneChipController?.({
    getTimeZone: () => state.timeZone,
    setTimeZone: (value) => {
      state.timeZone = DASHBOARD_TIME?.setPreferredTimeZone?.(value) || value || "UTC";
      return state.timeZone;
    },
    onChange: (timeZone) => {
      state.timeZone = timeZone || state.timeZone;
      syncControls();
    },
  });

  let downloadSettings = { ...DEFAULT_DOWNLOAD_SETTINGS };
  let downloadSettingsHasStoredValue = false;
  const downloadSettingsController = window.WSBDashboardComponents?.createDownloadSettingsController({
    storageKey: DOWNLOAD_SETTINGS_KEY,
    defaults: DEFAULT_DOWNLOAD_SETTINGS,
    normalize: normalizeDownloadSettings,
    groups: {
      chartMode: { group: el.downloadChartModeSelect, multi: true, defaultValue: DEFAULT_DOWNLOAD_SETTINGS.chartMode },
      leftScale: { group: el.downloadPriceScaleSelect },
      rightScale: { group: el.downloadDaysScaleSelect },
      orientation: { group: el.downloadOrientationSelect },
      quality: { group: el.downloadQualitySelect },
      fps: { group: el.downloadFpsSelect },
      theme: { group: el.downloadThemeSelect },
    },
    checkboxes: {
      endFrameHold: { checkbox: el.downloadEndFrameHoldToggle, defaultValue: DEFAULT_DOWNLOAD_SETTINGS.endFrameHold },
    },
    afterWrite: () => {
      syncDownloadScaleAvailability();
      updateDownloadEstimates();
    },
  });
  let isDateRangeExporting = false;
  let dateRangeExportCancelRequested = false;
  let activeExportTheme = "";
  let activeExportFrameIso = "";
  let activeExportPriceScaleMode = "";
  let activeExportDaysScaleMode = "";
  let dateRangeDragState = null;
  let dateRangeEndSliderScrubState = {
    active: false,
    pointerId: null,
    resumeAfterRelease: false,
    captureOnWrap: false,
  };
  let dateRangePlaybackState = {
    hasSession: false,
    startIndex: 0,
    targetEndIndex: 0,
    currentEndIndex: 0,
    originalStartIndex: 0,
    originalEndIndex: 0,
    lastTimestampMs: 0,
    accumulatedMs: 0,
  };

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
  }

  try {
    const stored = localStorage.getItem(THEME_KEY);
    applyTheme(stored === "light" || stored === "dark" ? stored : "dark");
  } catch (_) {
    applyTheme("dark");
  }

  window.addEventListener("message", (event) => {
    if (event.data && event.data.type === "quantum-dashboard-theme") {
      applyTheme(event.data.theme);
      render();
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === THEME_KEY && (event.newValue === "light" || event.newValue === "dark")) {
      applyTheme(event.newValue);
      render();
    }
  });

  function css(name, fallback) {
    if (activeExportTheme) {
      const palette = EXPORT_THEME_PALETTES[activeExportTheme === "light" ? "light" : "dark"];
      if (palette && Object.prototype.hasOwnProperty.call(palette, name)) return palette[name];
    }
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function setButtonIcon(iconId, svgMarkup) {
    const icon = document.getElementById(iconId);
    if (!icon || !svgMarkup) return;
    icon.outerHTML = svgMarkup.replace("<svg ", `<svg id="${iconId}" `);
  }

  function parseCsv(text) {
    const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
    const headers = lines.shift().split(",");
    return lines.map((line) => {
      const cells = line.split(",");
      const row = {};
      headers.forEach((header, idx) => { row[header] = cells[idx] ?? ""; });
      return row;
    });
  }

  function isoFromRow(row) {
    const timestamp = String(row.timestamp || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) return timestamp;
    const parts = String(row.date || "").split("/");
    if (parts.length !== 3) return "";
    const year = Number(parts[2]) < 100 ? 2000 + Number(parts[2]) : Number(parts[2]);
    return `${year}-${String(parts[0]).padStart(2, "0")}-${String(parts[1]).padStart(2, "0")}`;
  }

  function addDays(iso, days) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function dayDiff(a, b) {
    return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
  }

  function fmtDate(iso) {
    if (!iso) return "-";
    const d = new Date(`${iso}T00:00:00Z`);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }

  function fmtShortDate(iso) {
    if (!iso) return "00/00/00";
    const d = new Date(`${iso}T00:00:00Z`);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(2)}`;
  }

  function fmtUsd(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= PRICE_FALLBACK) return "Not Valued";
    if (n < 1) return `${trimNumber((n * 100).toFixed(3))}¢`;
    return `$${trimNumber(n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}`;
  }

  function fmtCurrentPrice(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= PRICE_FALLBACK) return "Not Valued";
    if (n < 1) return `${trimNumber((n * 100).toFixed(3))}¢`;
    if (n < 100000) {
      return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }

  function trimNumber(value) {
    return String(value).replace(/(\.\d*?)0+$/u, "$1").replace(/\.$/u, "");
  }

  function isNotValued(value) {
    const n = Number(value);
    return !Number.isFinite(n) || n <= PRICE_FALLBACK;
  }

  function isScaleMode(value) {
    return value === "linear" || value === "log";
  }

  function isChartMode(value) {
    return value === "both" || value === "price" || value === "days";
  }

  function firstValuedPrice() {
    const row = state.rows.find((candidate) => !isNotValued(candidate.price));
    return row ? row.price : PRICE_FALLBACK * 10;
  }

  function fmtPct(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `${n.toFixed(2)}%` : "N/A";
  }

  function clampIso(iso) {
    const min = state.rows[0]?.date;
    const max = state.rows[state.rows.length - 1]?.date;
    if (!min || !max) return iso || "";
    if (!iso || iso < min) return min;
    if (iso > max) return max;
    return iso;
  }

  function findIndex(iso, mode = "nearest") {
    return dateRangeController?.findIndex(iso, mode) ?? -1;
  }

  function getPresetStart(preset, endIso) {
    const first = state.rows[0]?.date || "";
    if (!endIso) return first;
    if (preset === "full") return first;
    if (preset === "ytd") return clampIso(`${endIso.slice(0, 4)}-01-01`);
    const years = Number.parseInt(String(preset).replace("y", ""), 10);
    if (Number.isFinite(years)) {
      const d = new Date(`${endIso}T00:00:00Z`);
      d.setUTCFullYear(d.getUTCFullYear() - years);
      return clampIso(d.toISOString().slice(0, 10));
    }
    return first;
  }

  function inferPreset(startIso, endIso) {
    const latest = state.rows[state.rows.length - 1]?.date;
    if (!latest || endIso !== latest) return "";
    return ["full", "ytd", "1y", "2y", "4y", "8y"].find((preset) => getPresetStart(preset, endIso) === startIso) || "";
  }

  function normalizeState() {
    state.startIso = clampIso(state.startIso);
    state.endIso = clampIso(state.endIso);
    if (state.startIso > state.endIso) state.startIso = state.endIso;
    state.currentIso = clampIso(state.currentIso || state.endIso);
    if (state.currentIso < state.startIso) state.currentIso = state.startIso;
    if (state.currentIso > state.endIso) state.currentIso = state.endIso;
    state.preset = inferPreset(state.startIso, state.endIso) || state.preset || "";
    if (!isChartMode(state.chartMode)) state.chartMode = "both";
  }

  function maxRangeIndex() {
    return dateRangeController?.maxIndex() ?? Math.max(0, state.rows.length - 1);
  }

  function indexPercent(index) {
    return dateRangeController?.indexPercent(index) ?? 0;
  }

  function getCurrentRangeIndices() {
    return dateRangeController?.getRangeIndices(state.startIso, state.endIso)
      || { startIndex: 0, endIndex: maxRangeIndex(), minIndex: 0, maxIndex: maxRangeIndex() };
  }

  function setRangeByIndices(startIndex, endIndex, options = {}) {
    dateRangeController?.setRangeByIndices(startIndex, endIndex, options);
  }

  function getDateRangeIndexFromPointerX(clientX) {
    return dateRangeController?.indexFromPointer(clientX, el.sliderWrap);
  }

  function applyPlaybackEndScrubIndex(nextIndex) {
    if (!Number.isFinite(nextIndex) || !state.rows.length) return null;
    const maxIdx = maxRangeIndex();
    const clamped = Math.max(0, Math.min(maxIdx, Math.round(nextIndex)));
    const startIndex = dateRangePlaybackState.hasSession
      ? dateRangePlaybackState.startIndex
      : getCurrentRangeIndices().startIndex;
    const safeEnd = Math.max(startIndex, clamped);
    setRangeByIndices(startIndex, safeEnd);
    if (dateRangePlaybackState.hasSession) {
      dateRangePlaybackState.currentEndIndex = safeEnd;
    }
    return safeEnd;
  }

  function readState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      Object.assign(state, {
        startIso: typeof parsed.startIso === "string" ? parsed.startIso : state.startIso,
        endIso: typeof parsed.endIso === "string" ? parsed.endIso : state.endIso,
        currentIso: typeof parsed.currentIso === "string" ? parsed.currentIso : state.currentIso,
        preset: typeof parsed.preset === "string" ? parsed.preset : state.preset,
        speed: SPEEDS.includes(Number(parsed.speed)) ? Number(parsed.speed) : state.speed,
        chartMode: isChartMode(parsed.chartMode) ? parsed.chartMode : state.chartMode,
        priceScaleMode: isScaleMode(parsed.priceScaleMode) ? parsed.priceScaleMode : state.priceScaleMode,
        daysScaleMode: isScaleMode(parsed.daysScaleMode) ? parsed.daysScaleMode : state.daysScaleMode,
        showAthLabels: typeof parsed.showAthLabels === "boolean" ? parsed.showAthLabels : state.showAthLabels,
        showAthMarkers: typeof parsed.showAthMarkers === "boolean" ? parsed.showAthMarkers : state.showAthMarkers,
        showHalvings: typeof parsed.showHalvings === "boolean" ? parsed.showHalvings : state.showHalvings,
      });
    } catch (_) {}
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        startIso: state.startIso,
        endIso: state.endIso,
        currentIso: state.currentIso,
        preset: state.preset,
        speed: state.speed,
        chartMode: state.chartMode,
        priceScaleMode: state.priceScaleMode,
        daysScaleMode: state.daysScaleMode,
        showAthLabels: state.showAthLabels,
        showAthMarkers: state.showAthMarkers,
        showHalvings: state.showHalvings,
      }));
    } catch (_) {}
  }

  function getCurrentTheme() {
    return document.documentElement.dataset.theme === "light" ? "light" : "dark";
  }

  function normalizeDownloadSettings(settings = {}) {
    const chartMode = ["both", "left", "right"].includes(settings.chartMode) ? settings.chartMode : DEFAULT_DOWNLOAD_SETTINGS.chartMode;
    const quality = ["720", "1080", "1440", "2160"].includes(String(settings.quality)) ? String(settings.quality) : DEFAULT_DOWNLOAD_SETTINGS.quality;
    const orientation = ["landscape", "portrait", "square"].includes(settings.orientation) ? settings.orientation : DEFAULT_DOWNLOAD_SETTINGS.orientation;
    const theme = settings.theme === "dark" ? "dark" : settings.theme === "light" ? "light" : getCurrentTheme();
    const leftScale = isScaleMode(settings.leftScale) ? settings.leftScale : DEFAULT_DOWNLOAD_SETTINGS.leftScale;
    const rightScale = isScaleMode(settings.rightScale) ? settings.rightScale : DEFAULT_DOWNLOAD_SETTINGS.rightScale;
    const rawFps = Number(settings.fps);
    const fps = DATE_RANGE_PLAYBACK_FPS_OPTIONS.includes(rawFps) ? String(rawFps) : String(DEFAULT_RANGE_PLAYBACK_FPS);
    const endFrameHold = settings.endFrameHold !== false;
    return { chartMode, quality, orientation, theme, fps, leftScale, rightScale, endFrameHold };
  }

  function getDownloadSettingGroupValue(group) {
    const groupMap = new Map([
      [el.downloadChartModeSelect, "chartMode"],
      [el.downloadPriceScaleSelect, "leftScale"],
      [el.downloadDaysScaleSelect, "rightScale"],
      [el.downloadOrientationSelect, "orientation"],
      [el.downloadQualitySelect, "quality"],
      [el.downloadFpsSelect, "fps"],
      [el.downloadThemeSelect, "theme"],
    ]);
    const key = groupMap.get(group);
    if (key && downloadSettingsController) return downloadSettingsController.getGroupValue(key);
    return window.WSBDashboardComponents.getButtonGroupValue(group, {
      multi: group === el.downloadChartModeSelect,
      defaultValue: group === el.downloadChartModeSelect ? DEFAULT_DOWNLOAD_SETTINGS.chartMode : "",
    });
  }

  function setDownloadSettingGroupValue(group, value) {
    const groupMap = new Map([
      [el.downloadChartModeSelect, "chartMode"],
      [el.downloadPriceScaleSelect, "leftScale"],
      [el.downloadDaysScaleSelect, "rightScale"],
      [el.downloadOrientationSelect, "orientation"],
      [el.downloadQualitySelect, "quality"],
      [el.downloadFpsSelect, "fps"],
      [el.downloadThemeSelect, "theme"],
    ]);
    const key = groupMap.get(group);
    if (key && downloadSettingsController) {
      downloadSettingsController.setGroupValue(key, value);
      return;
    }
    window.WSBDashboardComponents.setButtonGroupValue(group, value, {
      multi: group === el.downloadChartModeSelect,
      defaultValue: DEFAULT_DOWNLOAD_SETTINGS.chartMode,
    });
  }

  function syncDownloadScaleAvailability() {
    window.WSBDashboardComponents.syncDependentButtonGroupAvailability({
      chartGroup: el.downloadChartModeSelect,
      sides: [
        { value: "left", group: el.downloadPriceScaleSelect },
        { value: "right", group: el.downloadDaysScaleSelect },
      ],
    });
  }

  function readDownloadSettingsControls() {
    return downloadSettingsController?.readControls()
      || normalizeDownloadSettings({
        chartMode: getDownloadSettingGroupValue(el.downloadChartModeSelect),
        leftScale: getDownloadSettingGroupValue(el.downloadPriceScaleSelect),
        rightScale: getDownloadSettingGroupValue(el.downloadDaysScaleSelect),
        orientation: getDownloadSettingGroupValue(el.downloadOrientationSelect),
        quality: getDownloadSettingGroupValue(el.downloadQualitySelect),
        fps: getDownloadSettingGroupValue(el.downloadFpsSelect),
        theme: getDownloadSettingGroupValue(el.downloadThemeSelect),
        endFrameHold: el.downloadEndFrameHoldToggle?.checked !== false,
      });
  }

  function syncDownloadSettingsControls() {
    downloadSettings = normalizeDownloadSettings(downloadSettings);
    if (downloadSettingsController) {
      downloadSettingsController.setSettings(downloadSettings);
      downloadSettings = downloadSettingsController.getSettings();
      return;
    }
  }

  function persistDownloadSettingsFromControls() {
    if (downloadSettingsController) {
      downloadSettings = downloadSettingsController.save();
      downloadSettingsHasStoredValue = downloadSettingsController.hasStoredSettings();
      return;
    }
  }

  function loadDownloadSettings() {
    if (downloadSettingsController) {
      downloadSettings = downloadSettingsController.load();
      downloadSettingsHasStoredValue = downloadSettingsController.hasStoredSettings();
    }
  }

  function getPlaybackSpeedMultiplier(fps) {
    return Math.max(0.25, (Number(fps) || DEFAULT_RANGE_PLAYBACK_FPS) / DEFAULT_RANGE_PLAYBACK_FPS);
  }

  function buildExportFrameIndices(startIndex, endIndex, playbackFps, includeEndFrameHold = true) {
    const start = Math.round(Number(startIndex));
    const end = Math.round(Number(endIndex));
    const safeStart = Number.isFinite(start) ? start : 0;
    const safeEnd = Number.isFinite(end) ? end : safeStart;
    const startHoldFrames = includeEndFrameHold
      ? Math.max(0, Math.round(DATE_RANGE_EXPORT_START_HOLD_SECONDS * DATE_RANGE_EXPORT_VIDEO_FPS))
      : 0;
    const endHoldFrames = includeEndFrameHold
      ? Math.max(0, Math.round(DATE_RANGE_EXPORT_END_HOLD_SECONDS * DATE_RANGE_EXPORT_VIDEO_FPS))
      : 0;
    const frames = [
      ...Array.from({ length: startHoldFrames }, () => safeEnd),
    ];

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      frames.push(...Array.from({ length: endHoldFrames }, () => safeEnd));
      return frames.length ? frames : [safeStart];
    }

    const speed = getPlaybackSpeedMultiplier(playbackFps);
    const span = end - start;
    const motionFrames = [];
    let frameNumber = 0;
    let lastIndex = null;
    while (true) {
      const offset = Math.floor(frameNumber * speed);
      if (offset > span) break;
      const index = start + offset;
      motionFrames.push(index);
      lastIndex = index;
      frameNumber += 1;
      if (frameNumber > (span / speed) + DATE_RANGE_EXPORT_VIDEO_FPS + 2) break;
    }
    if (lastIndex !== end) motionFrames.push(end);
    frames.push(...(motionFrames.length ? motionFrames : [start, end]));
    frames.push(...Array.from({ length: endHoldFrames }, () => end));
    return frames.length ? frames : [start, end];
  }

  function formatDownloadEstimateDuration(seconds) {
    return window.WSBDashboardExport.formatDuration(seconds);
  }

  function formatDownloadEstimateSize(bytes) {
    return window.WSBDashboardExport.formatSize(bytes);
  }

  function getDownloadDimensions(settings) {
    return window.WSBDashboardExport.getDimensions(settings);
  }

  function getExportLayoutMetrics(settings) {
    return window.WSBDashboardExport.getLayoutMetrics(settings);
  }

  function getExportReferenceLayoutSettings(settings) {
    return window.WSBDashboardExport.getReferenceSettings(settings, 720);
  }

  function drawScaledExportFrame(sourceCanvas, targetCanvas, settings) {
    const { width, height } = getDownloadDimensions(settings);
    if (targetCanvas.width !== width) targetCanvas.width = width;
    if (targetCanvas.height !== height) targetCanvas.height = height;
    const ctx = targetCanvas.getContext("2d");
    if (!ctx) return;
    const bg = EXPORT_THEME_PALETTES[settings.theme]?.["--bg"] || css("--bg", "#000");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
    ctx.restore();
  }

  function getExportBitrate(settings) {
    return window.WSBDashboardExport.getBitrate(settings);
  }

  function updateDownloadEstimates() {
    if (!el.downloadEstimateSize || !el.downloadEstimateLength || !el.downloadEstimateTime || !state.rows.length) return;
    const settings = normalizeDownloadSettings(readDownloadSettingsControls());
    const startIndex = Math.max(0, findIndex(state.startIso, "ceil"));
    const endIndex = Math.max(startIndex, findIndex(state.endIso, "floor"));
    const frameIndices = buildExportFrameIndices(startIndex, endIndex, Number(settings.fps), settings.endFrameHold);
    const uniqueFrameCount = new Set(frameIndices).size;
    const videoSeconds = frameIndices.length / DATE_RANGE_EXPORT_VIDEO_FPS;
    const chartCount = settings.chartMode === "both" ? 2 : 1;
    const estimate = window.WSBDashboardExport.estimateDownload(settings, {
      frameCount: frameIndices.length,
      uniqueFrameCount,
      videoSeconds,
      chartCount,
      bitrate: getExportBitrate(settings),
      fallbackFrameSeconds: 0.004,
      encodeFrameSeconds: 0.0005,
    });
    el.downloadEstimateSize.textContent = estimate.sizeText;
    el.downloadEstimateLength.textContent = estimate.lengthText;
    el.downloadEstimateTime.textContent = estimate.timeText;
  }

  function setupCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const forcedWidth = Number(canvas.__exportWidth);
    const forcedHeight = Number(canvas.__exportHeight);
    const useForcedSize = Number.isFinite(forcedWidth) && forcedWidth > 0 && Number.isFinite(forcedHeight) && forcedHeight > 0;
    const width = useForcedSize ? Math.round(forcedWidth) : Math.max(1, Math.round(rect.width));
    const height = useForcedSize ? Math.round(forcedHeight) : Math.max(1, Math.round(rect.height));
    const forcedScale = Number(canvas.__exportPixelScale);
    const scale = useForcedSize ? Math.max(1, Number.isFinite(forcedScale) ? forcedScale : 1) : dpr;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    return { ctx, width, height };
  }

  function visibleRows() {
    const start = findIndex(state.startIso, "ceil");
    const end = findIndex(activeExportFrameIso || state.currentIso, "floor");
    return state.rows.slice(Math.max(0, start), Math.max(start, end) + 1);
  }

  function drawHalvings(ctx, rows, xFor, top, bottom, mode) {
    const start = rows[0];
    const end = rows[rows.length - 1];
    if (!start || !end) return;
    const colors = chartColors();
    ctx.save();
    ctx.strokeStyle = colors.halving;
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1;
    ctx.fillStyle = colors.halvingLabel;
    ctx.font = ATH_LABEL_FONT;
    HALVINGS.forEach((halving) => {
      const visible = mode === "height"
        ? halving.height >= start.height && halving.height <= end.height
        : halving.date >= start.date && halving.date <= end.date;
      if (!visible) return;
      const x = mode === "height" ? xFor({ height: halving.height }) : xFor({ date: halving.date });
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, bottom);
      ctx.lineTo(x, bottom + 8);
      ctx.stroke();
      ctx.save();
      ctx.translate(x - 7, bottom - 6);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(halving.label, 0, 0);
      ctx.restore();
    });
    ctx.restore();
  }

  function drawLine(ctx, rows, xFor, yFor, key, color, width) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    let started = false;
    rows.forEach((row) => {
      const x = xFor(row);
      const y = yFor(row[key], row);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (!started) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    if (started) ctx.stroke();
    ctx.restore();
  }

  function drawPriceLine(ctx, rows, xFor, yFor, color, width) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const flushRun = (run) => {
      if (!run.length) return;
      if (run.length === 1) {
        const point = run[0];
        ctx.beginPath();
        ctx.arc(point.x, point.y, width / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.beginPath();
      run.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
    };

    let run = [];
    let runValued = null;
    rows.forEach((row) => {
      const x = xFor(row);
      const y = yFor(row.price, row);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const valued = !isNotValued(row.price);
      if (runValued !== null && valued !== runValued) {
        flushRun(run);
        run = [];
      }
      run.push({ x, y });
      runValued = valued;
    });
    flushRun(run);
    ctx.restore();
  }

  function drawAthMarkers(ctx, rows, xFor, yFor, pad, plotW, plotH, color) {
    const markerRows = rows.filter((row) => row.isAth && !isNotValued(row.price));
    if (!markerRows.length) return;
    ctx.save();
    ctx.fillStyle = color;
    markerRows.forEach((row) => {
      const x = xFor(row);
      const y = yFor(row.price, row);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x < pad.left || x > pad.left + plotW || y < pad.top || y > pad.top + plotH) return;
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawAthResetMarkers(ctx, rows, xFor, yFor, pad, plotW, plotH, color) {
    const markerRows = rows.filter((row) => row.isAth && !isNotValued(row.price));
    if (!markerRows.length) return;
    ctx.save();
    ctx.fillStyle = color;
    markerRows.forEach((row) => {
      const x = xFor(row);
      const y = yFor(row.daysSinceAth, row);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x < pad.left || x > pad.left + plotW || y < pad.top || y > pad.top + plotH) return;
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function chartLabelSizes(width = window.innerWidth) {
    const safeWidth = Number.isFinite(width) ? width : window.innerWidth;
    const progress = Math.max(0, Math.min(1, (safeWidth - 420) / 900));
    const tick = 12 + (progress * 6);
    return {
      yTick: Number(tick.toFixed(2)),
      currentValue: Number((tick * 1.12).toFixed(2)),
    };
  }

  function chartColors() {
    const isLight = activeExportTheme ? activeExportTheme === "light" : document.documentElement.dataset.theme === "light";
    return {
      isLight,
      bg: css("--chart-bg", isLight ? "#ffffff" : "#000000"),
      fg: css("--fg", isLight ? "#1c1b19" : "#f1f5f7"),
      muted: css("--muted", isLight ? "#6f685f" : "#95a6ae"),
      grid: isLight ? "#e6e6e6" : "#242424",
      overlappedTick: isLight ? "rgba(0,0,0,0.26)" : "rgba(255,255,255,0.22)",
      halving: isLight ? "rgba(28,27,25,0.48)" : "rgba(255,255,255,0.65)",
      halvingLabel: isLight ? "rgba(28,27,25,0.82)" : "#f1f5f7",
      athLabel: isLight ? "rgba(28,27,25,0.54)" : "lightgray",
    };
  }

  function drawYGrid(ctx, ticks, yFor, pad, plotW, plotH, formatter, currentY = null, options = {}) {
    const labelSizes = chartLabelSizes(ctx.canvas.width / Math.max(1, window.devicePixelRatio || 1));
    const colors = chartColors();
    const tickFontSize = labelSizes.yTick;
    const currentFontSize = labelSizes.currentValue;
    const overlapRadius = Number.isFinite(currentY) ? ((tickFontSize + currentFontSize) / 2) + 2 : 0;
    const plotRight = pad.left + plotW;
    ctx.save();
    ctx.font = `500 ${tickFontSize}px IBM Plex Mono, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ticks.forEach((tick) => {
      const y = yFor(tick);
      if (!Number.isFinite(y) || y < pad.top - 1 || y > pad.top + plotH + 1) return;
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();

      const overlapsCurrent = Number.isFinite(currentY) && Math.abs(y - currentY) < overlapRadius;
      const label = formatter(tick);
      let labelFontSize = tickFontSize;
      ctx.font = `500 ${labelFontSize}px IBM Plex Mono, monospace`;
      if (label === "Not Valued") {
        labelFontSize = Math.min(labelFontSize * 0.78, 12);
        ctx.font = `500 ${labelFontSize}px IBM Plex Mono, monospace`;
        const availableWidth = Math.max(24, (ctx.canvas.width / Math.max(1, window.devicePixelRatio || 1)) - plotRight - 12);
        while (ctx.measureText(label).width > availableWidth && labelFontSize > 8) {
          labelFontSize -= 1;
          ctx.font = `500 ${labelFontSize}px IBM Plex Mono, monospace`;
        }
      }
      ctx.fillStyle = overlapsCurrent ? colors.overlappedTick : colors.muted;
      ctx.fillText(label, plotRight + 8, y + (options.centerLabels ? 0 : labelFontSize * 0.36));
    });
    ctx.restore();
  }

  function drawCurrentValueLabel(ctx, text, y, width, pad) {
    if (!text || !Number.isFinite(y)) return;
    const labelSizes = chartLabelSizes(width);
    const colors = chartColors();
    const x = width - pad.right + 8;
    ctx.save();
    let fontSize = labelSizes.currentValue;
    const availableWidth = Math.max(24, pad.right - 12);
    ctx.font = `${fontSize}px IBM Plex Mono, monospace`;
    while (ctx.measureText(text).width > availableWidth && fontSize > 8) {
      fontSize -= 1;
      ctx.font = `${fontSize}px IBM Plex Mono, monospace`;
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = colors.bg;
    ctx.lineWidth = 5;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = colors.fg;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function completedAthCycles(rows) {
    const out = [];
    for (let i = 0; i < rows.length - 1; i += 1) {
      const current = rows[i];
      const next = rows[i + 1];
      if (!current || !next) continue;
      if (next.daysSinceAth === 0 && current.daysSinceAth >= 180 && !isNotValued(current.athPrice)) {
        out.push({
          athDate: current.athDate,
          athPrice: current.athPrice,
          resetDate: next.date,
          days: current.daysSinceAth,
        });
      }
    }
    return out;
  }

  function shouldShowCompletedAthLabel(cycle) {
    return !String(cycle?.athDate || "").startsWith("2024");
  }

  function filteredCompletedAthLabels(cycles, yearKey, activeAthDate = "") {
    const visibleCycles = cycles.filter(shouldShowCompletedAthLabel);
    const visible2021Cycles = visibleCycles.filter((cycle) => String(cycle?.[yearKey] || "").startsWith("2021"));
    const hideFirst2021 = visible2021Cycles.length > 1 || String(activeAthDate || "").startsWith("2021");
    const hidden2021Value = hideFirst2021 ? visible2021Cycles[0]?.[yearKey] : "";
    return visibleCycles.filter((cycle) => !hidden2021Value || cycle?.[yearKey] !== hidden2021Value);
  }

  function drawOutlinedText(ctx, text, x, y, options = {}) {
    const colors = chartColors();
    const color = options.color || colors.athLabel;
    ctx.save();
    ctx.font = options.font || ATH_LABEL_FONT;
    ctx.textAlign = options.align || "right";
    ctx.textBaseline = options.baseline || "bottom";
    ctx.lineJoin = "round";
    ctx.strokeStyle = options.stroke || colors.bg;
    ctx.lineWidth = options.strokeWidth || 5;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function boxesOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function makeUtcDate(iso) {
    const ms = Date.parse(`${iso}T00:00:00Z`);
    return Number.isFinite(ms) ? new Date(ms) : null;
  }

  function makeDatePicker(opts) {
    return window.WSBDashboardComponents.createDatePicker(opts);
  }

  function buildTimeTicks(rows, plotW) {
    if (!Array.isArray(rows) || rows.length < 2) return [];
    const firstDate = makeUtcDate(rows[0].date);
    const lastDate = makeUtcDate(rows[rows.length - 1].date);
    if (!firstDate || !lastDate) return [];
    const monthStarts = [];
    let cursor = new Date(Date.UTC(firstDate.getUTCFullYear(), firstDate.getUTCMonth(), 1));
    const firstMs = firstDate.getTime();
    const lastMs = lastDate.getTime();
    while (cursor.getTime() <= lastMs) {
      const ms = cursor.getTime();
      if (ms >= firstMs && ms <= lastMs) monthStarts.push(new Date(ms));
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }
    if (!monthStarts.length) return [];

    const maxTicks = Math.max(4, Math.floor(plotW / 88));
    const isMultiYearRange = lastDate.getUTCFullYear() > firstDate.getUTCFullYear();
    const selected = [];
    if (isMultiYearRange) {
      const tiers = [
        [0],
        [0, 6],
        [0, 4, 8],
        [0, 3, 6, 9],
        [0, 2, 4, 6, 8, 10],
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      ];
      for (let tier = tiers.length - 1; tier >= 0; tier -= 1) {
        const monthSet = new Set(tiers[tier]);
        const candidates = monthStarts.filter((date) => monthSet.has(date.getUTCMonth()));
        if (candidates.length && candidates.length <= maxTicks) {
          selected.push(...candidates);
          break;
        }
      }
      if (!selected.length) {
        const janTicks = monthStarts.filter((date) => date.getUTCMonth() === 0);
        const stride = Math.max(1, Math.ceil(janTicks.length / maxTicks));
        for (let i = 0; i < janTicks.length; i += stride) selected.push(janTicks[i]);
      }
    } else {
      const stride = Math.max(1, Math.ceil(monthStarts.length / maxTicks));
      for (let i = 0; i < monthStarts.length; i += stride) selected.push(monthStarts[i]);
    }

    return selected.map((date) => ({
      date,
      iso: date.toISOString().slice(0, 10),
      label: date.getUTCMonth() === 0 ? String(date.getUTCFullYear()) : MONTH_SHORT[date.getUTCMonth()],
    }));
  }

  function drawChartTitle(ctx, title, width, pad) {
    const labelSizes = chartLabelSizes(width);
    const colors = chartColors();
    ctx.save();
    ctx.fillStyle = colors.fg;
    ctx.font = `700 ${Math.max(16, labelSizes.yTick * 1.1).toFixed(2)}px Space Grotesk, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(title, width / 2, 14);
    ctx.restore();
  }

  function drawXAxisTicks(ctx, ticks, xForIso, pad, plotW, plotH, labelOffset = 14) {
    if (!Array.isArray(ticks) || !ticks.length) return;
    const labelSizes = chartLabelSizes(ctx.canvas.width / Math.max(1, window.devicePixelRatio || 1));
    const colors = chartColors();
    const tickFontSize = labelSizes.yTick;
    const top = pad.top;
    const bottom = pad.top + plotH;
    ctx.save();
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = colors.muted;
    ctx.font = `500 ${tickFontSize}px IBM Plex Mono, monospace`;
    ticks.forEach((tick) => {
      const x = xForIso(tick.iso);
      if (!Number.isFinite(x) || x < pad.left - 1 || x > pad.left + plotW + 1) return;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, bottom);
      ctx.lineTo(x, bottom + 8);
      ctx.stroke();
      ctx.save();
      ctx.translate(x - 8, bottom + labelOffset);
      ctx.rotate(-Math.PI / 5);
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText(String(tick.label), 0, 0);
      ctx.restore();
    });
    ctx.restore();
  }

  function priceTicks(minPrice, maxPrice, includeFallback = true) {
    const minPow = Math.floor(Math.log10(Math.max(PRICE_FALLBACK, minPrice)));
    const maxPow = Math.ceil(Math.log10(Math.max(PRICE_FALLBACK * 10, maxPrice)));
    const ticks = includeFallback ? [PRICE_FALLBACK] : [];
    for (let pow = minPow; pow <= maxPow; pow += 1) {
      const value = 10 ** pow;
      if (value >= minPrice * 0.98 && value < maxPrice * 0.98) ticks.push(value);
    }
    return Array.from(new Set(ticks)).sort((a, b) => a - b);
  }

  function priceLinearTicks(minPrice, maxPrice, includeFallback = true) {
    const ticks = linearTicks(maxPrice, 5).filter((value) => value >= minPrice * 0.98 && value <= maxPrice * 1.02);
    if (includeFallback) ticks.unshift(PRICE_FALLBACK);
    return Array.from(new Set(ticks)).sort((a, b) => a - b);
  }

  function linearTicks(maxValue, count = 5) {
    const max = Math.max(1, maxValue);
    const rawStep = max / Math.max(1, count - 1);
    const pow = 10 ** Math.floor(Math.log10(rawStep));
    const step = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= rawStep) || rawStep;
    const ticks = [];
    for (let value = 0; value <= max + step * 0.5; value += step) ticks.push(value);
    return ticks;
  }

  function integerTicks(maxValue, count = 5) {
    const max = Math.max(1, Math.ceil(maxValue));
    const rawStep = max / Math.max(1, count - 1);
    const pow = 10 ** Math.floor(Math.log10(rawStep));
    const step = Math.max(1, Math.ceil(([1, 2, 5, 10].map((m) => m * pow).find((v) => v >= rawStep) || rawStep)));
    const ticks = [];
    for (let value = 0; value <= max + step * 0.5; value += step) ticks.push(value);
    return Array.from(new Set(ticks.filter((value) => value <= max))).sort((a, b) => a - b);
  }

  function daysLogTicks(maxValue) {
    const max = Math.max(1, Math.ceil(maxValue));
    const ticks = [0.1, 1];
    for (let value = 10; value <= max; value *= 10) ticks.push(value);
    return Array.from(new Set(ticks.filter((value) => value <= max))).sort((a, b) => a - b);
  }

  function drawPriceChart(canvas = el.priceCanvas) {
    const { ctx, width, height } = setupCanvas(canvas);
    const rows = visibleRows();
    const bg = css("--chart-bg", css("--panel", "#000"));
    const accent = css("--accent", "#ff9900");
    const green = css("--green", "#35c779");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    if (!rows.length) return;

    const pad = { top: 62, right: 96, bottom: 60, left: 18 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const startMs = Date.parse(`${rows[0].date}T00:00:00Z`);
    const endMs = Math.max(startMs + 86400000, Date.parse(`${rows[rows.length - 1].date}T00:00:00Z`));
    const values = rows.map((r) => r.price).filter((v) => v > PRICE_FALLBACK);
    const hasNotValuedRows = rows.some((row) => isNotValued(row.price));
    const fallbackMaxPrice = firstValuedPrice();
    const rawMinPrice = hasNotValuedRows
      ? PRICE_FALLBACK
      : (values.length ? Math.min(...values) : Math.max(PRICE_FALLBACK, fallbackMaxPrice / 10));
    const rawMaxPrice = values.length ? Math.max(...values) : fallbackMaxPrice;
    const maxPrice = rawMaxPrice * 1.035;
    const minPrice = rawMinPrice >= maxPrice ? Math.max(PRICE_FALLBACK, maxPrice / 10) : Math.max(PRICE_FALLBACK, rawMinPrice);
    const usePriceLog = (activeExportPriceScaleMode || state.priceScaleMode) === "log";
    const minLog = Math.log10(minPrice);
    const maxLog = Math.max(minLog + 1e-9, Math.log10(maxPrice));
    const priceRange = Math.max(1e-12, maxPrice - minPrice);
    const xFor = (row) => pad.left + ((Date.parse(`${row.date}T00:00:00Z`) - startMs) / (endMs - startMs)) * plotW;
    const yPriceScale = (value) => {
      const safeValue = Math.max(value, PRICE_FALLBACK);
      if (usePriceLog) {
        return pad.top + (1 - ((Math.log10(safeValue) - minLog) / (maxLog - minLog))) * plotH;
      }
      return pad.top + (1 - ((safeValue - minPrice) / priceRange)) * plotH;
    };
    const xForIso = (iso) => xFor({ date: iso });

    const latest = rows[rows.length - 1];
    const yPriceValue = (value) => isNotValued(value) ? yPriceScale(PRICE_FALLBACK) : yPriceScale(value);
    const currentPriceY = yPriceValue(latest.price);
    const yPriceTick = (value) => isNotValued(value) ? yPriceScale(PRICE_FALLBACK) : yPriceScale(value);
    const priceTickValues = usePriceLog
      ? priceTicks(minPrice, maxPrice, hasNotValuedRows)
      : priceLinearTicks(minPrice, maxPrice, hasNotValuedRows);
    drawChartTitle(ctx, "Daily High Price", width, pad);
    drawYGrid(ctx, priceTickValues, yPriceTick, pad, plotW, plotH, (value) => fmtUsd(value), currentPriceY, { centerLabels: true });
    drawXAxisTicks(ctx, buildTimeTicks(rows, plotW), xForIso, pad, plotW, plotH, 18);
    if (state.showHalvings) drawHalvings(ctx, rows, xFor, pad.top, pad.top + plotH, "date");
    drawPriceLine(ctx, rows, xFor, yPriceValue, accent, 2.2);
    if (state.showAthMarkers) drawAthMarkers(ctx, rows, xFor, yPriceValue, pad, plotW, plotH, green);

    if (!isNotValued(latest.price)) {
      const athRow = rows.reduce((best, row) => row.price >= best.price ? row : best, rows[0]);
      ctx.fillStyle = green;
      const athMarkerX = Math.max(pad.left + 5, Math.min(pad.left + plotW, xFor(athRow)));
      const athPointY = Math.max(pad.top + 4, Math.min(pad.top + plotH, yPriceScale(athRow.price)));
      const triangleTopY = athPointY - 18;
      const priceLabelY = triangleTopY - 1;
      ctx.beginPath();
      ctx.moveTo(athMarkerX, athPointY - 10);
      ctx.lineTo(athMarkerX - 4, triangleTopY);
      ctx.lineTo(athMarkerX + 4, triangleTopY);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.font = CURRENT_ATH_LABEL_FONT;
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.lineJoin = "round";
      ctx.strokeStyle = bg;
      ctx.lineWidth = 5;
      ctx.strokeText(fmtCurrentPrice(athRow.price), athMarkerX - 8, priceLabelY);
      ctx.fillStyle = green;
      ctx.fillText(fmtCurrentPrice(athRow.price), athMarkerX - 8, priceLabelY);
      ctx.restore();
    }
    if (state.showAthLabels) {
      const priceCycles = filteredCompletedAthLabels(completedAthCycles(rows), "athDate", latest.athDate)
        .filter((cycle) => {
          const x = xFor({ date: cycle.athDate });
          const y = yPriceScale(cycle.athPrice);
          return Number.isFinite(x) && Number.isFinite(y)
            && x >= pad.left && x <= pad.left + plotW
            && y >= pad.top && y <= pad.top + plotH;
        });
      const priceLabelBoxes = [];
      const drawablePriceCycles = usePriceLog ? priceCycles : [...priceCycles].sort((a, b) => b.athPrice - a.athPrice);
      drawablePriceCycles.forEach((cycle) => {
        const x = xFor({ date: cycle.athDate });
        const peakY = yPriceScale(cycle.athPrice);
        const y = peakY - 4;
        if (!Number.isFinite(x) || !Number.isFinite(peakY) || !Number.isFinite(y)) return;
        if (x < pad.left || x > pad.left + plotW || peakY < pad.top || peakY > pad.top + plotH) return;
        const label = fmtCurrentPrice(cycle.athPrice);
        const labelX = x + 4;
        if (!usePriceLog) {
          ctx.save();
          ctx.font = ATH_LABEL_FONT;
          const textWidth = ctx.measureText(label).width;
          ctx.restore();
          const box = {
            left: labelX - textWidth - 4,
            right: labelX + 4,
            top: y - 15,
            bottom: y + 3,
          };
          if (priceLabelBoxes.some((existing) => boxesOverlap(box, existing))) return;
          priceLabelBoxes.push(box);
        }
        drawOutlinedText(ctx, label, labelX, y, {
          align: "right",
          baseline: "bottom",
        });
      });
    }
    drawCurrentValueLabel(ctx, fmtCurrentPrice(latest.price), currentPriceY, width, pad);
  }

  function drawDaysChart(canvas = el.daysCanvas) {
    const { ctx, width, height } = setupCanvas(canvas);
    const rows = visibleRows();
    const bg = css("--chart-bg", css("--panel", "#000"));
    const accent = css("--accent", "#ff9900");
    const green = css("--green", "#35c779");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    if (!rows.length) return;

    const pad = { top: 62, right: 86, bottom: 60, left: 18 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const startMs = Date.parse(`${rows[0].date}T00:00:00Z`);
    const endMs = Math.max(startMs + 86400000, Date.parse(`${rows[rows.length - 1].date}T00:00:00Z`));
    const maxDays = Math.max(6, ...rows.map((r) => r.daysSinceAth));
    const useDaysLog = (activeExportDaysScaleMode || state.daysScaleMode) === "log";
    const daysLogMin = 0.1;
    const daysLogMinPow = Math.log10(daysLogMin);
    const daysLogMaxPow = Math.max(daysLogMinPow + 1e-9, Math.log10(Math.max(1, maxDays)));
    const xFor = (row) => pad.left + ((Date.parse(`${row.date}T00:00:00Z`) - startMs) / (endMs - startMs)) * plotW;
    const yFor = (value) => {
      const safeValue = Math.max(0, Number(value) || 0);
      if (useDaysLog) {
        const logValue = Math.log10(safeValue <= 0 ? daysLogMin : Math.max(daysLogMin, safeValue));
        return pad.top + (1 - ((logValue - daysLogMinPow) / (daysLogMaxPow - daysLogMinPow))) * plotH;
      }
      return pad.top + (1 - (safeValue / maxDays)) * plotH;
    };
    const xForIso = (iso) => xFor({ date: iso });

    const latest = rows[rows.length - 1];
    const currentDaysY = yFor(latest.daysSinceAth);
    const daysTickValues = useDaysLog ? daysLogTicks(maxDays) : integerTicks(maxDays, 5);
    drawChartTitle(ctx, "Days Since ATH", width, pad);
    drawYGrid(
      ctx,
      daysTickValues,
      yFor,
      pad,
      plotW,
      plotH,
      (value) => Math.round(value).toLocaleString("en-US"),
      currentDaysY,
      { centerLabels: true },
    );
    drawXAxisTicks(ctx, buildTimeTicks(rows, plotW), xForIso, pad, plotW, plotH, 18);
    if (state.showHalvings) drawHalvings(ctx, rows, xFor, pad.top, pad.top + plotH, "date");
    const colors = chartColors();
    for (let i = 4; i >= 1; i -= 1) {
      const alpha = colors.isLight ? 0.08 * i : 0.09 * i;
      const halo = colors.isLight ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
      drawLine(ctx, rows, xFor, yFor, "daysSinceAth", halo, 2 + i);
    }
    drawLine(ctx, rows, xFor, yFor, "daysSinceAth", accent, 2.2);
    if (state.showAthMarkers) drawAthResetMarkers(ctx, rows, xFor, yFor, pad, plotW, plotH, green);

    const athDate = latest.athDate;
    if (!isNotValued(latest.price) && athDate >= rows[0].date && athDate <= latest.date) {
      const x = xFor({ date: athDate });
      ctx.fillStyle = green;
      const safeX = Math.max(pad.left + 5, Math.min(pad.left + plotW, x));
      const resetPointY = pad.top + plotH;
      const triangleBottomY = resetPointY + 14;
      const daysLabelY = triangleBottomY + 3;
      ctx.beginPath();
      ctx.moveTo(safeX, resetPointY + 6);
      ctx.lineTo(safeX - 4, triangleBottomY);
      ctx.lineTo(safeX + 4, triangleBottomY);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.font = ATH_LABEL_FONT;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.lineJoin = "round";
      ctx.strokeStyle = bg;
      ctx.lineWidth = 5;
      ctx.strokeText(fmtDate(athDate), safeX - 8, daysLabelY);
      ctx.fillStyle = green;
      ctx.fillText(fmtDate(athDate), safeX - 8, daysLabelY);
      ctx.restore();
    }
    if (state.showAthLabels) {
      filteredCompletedAthLabels(completedAthCycles(rows), "resetDate", latest.athDate).forEach((cycle) => {
        const x = xFor({ date: cycle.resetDate });
        const peakY = yFor(cycle.days);
        const y = peakY - (plotH * 0.012);
        if (!Number.isFinite(x) || !Number.isFinite(peakY) || !Number.isFinite(y)) return;
        if (x < pad.left || x > pad.left + plotW || peakY < pad.top || peakY > pad.top + plotH) return;
        drawOutlinedText(ctx, cycle.days.toLocaleString("en-US"), x + 4, y, {
          align: "right",
          baseline: "bottom",
        });
      });
    }
    drawCurrentValueLabel(ctx, latest.daysSinceAth.toLocaleString("en-US"), currentDaysY, width, pad);
  }

  function syncControls() {
    const latest = state.rows[findIndex(state.currentIso, "floor")] || state.rows[state.rows.length - 1];
    if (!latest) return;
    if (updatedTimeZoneChip) {
      updatedTimeZoneChip.setUpdated(latest.timestamp || latest.date, { mode: latest.timestamp ? "timestamp" : "date" });
    } else {
      el.updatedKpi.textContent = fmtDate(latest.date);
    }
    el.heightKpi.textContent = latest.height.toLocaleString("en-US");
    el.dailyHighKpi.textContent = fmtUsd(latest.price);
    if (isNotValued(latest.price)) {
      el.athKpi.textContent = "None";
      el.drawdownKpi.textContent = "None";
    } else {
      el.athKpi.textContent = `${fmtUsd(latest.athPrice)} on ${fmtDate(latest.athDate)}`;
      const dd = latest.athPrice > PRICE_FALLBACK ? ((latest.price - latest.athPrice) / latest.athPrice) * 100 : NaN;
      el.drawdownKpi.textContent = fmtPct(dd);
    }
    el.daysKpi.textContent = latest.daysSinceAth.toLocaleString("en-US");
    el.startInput.min = state.rows[0].date;
    el.startInput.max = state.endIso;
    el.startInput.value = state.startIso;
    el.endInput.min = state.startIso;
    el.endInput.max = state.rows[state.rows.length - 1].date;
    el.endInput.value = state.endIso;
    const startBtnValue = el.startBtn.querySelector("span");
    const endBtnValue = el.endBtn.querySelector("span");
    if (startBtnValue) {
      startBtnValue.textContent = fmtShortDate(state.startIso);
      startBtnValue.classList.remove("date-range-btn-placeholder");
    }
    if (endBtnValue) {
      endBtnValue.textContent = fmtShortDate(state.endIso);
      endBtnValue.classList.remove("date-range-btn-placeholder");
    }
    const days = Math.max(1, dayDiff(state.startIso, state.endIso) + 1);
    if (document.activeElement !== el.rangeDaysInput) el.rangeDaysInput.value = days.toLocaleString("en-US");
    el.speedBtn.textContent = `${state.speed}x`;
    syncChartModeControls();
    window.WSBDashboardComponents.syncScaleButtonGroup(el.priceScaleButtons, state.priceScaleMode, { buttonSelector: "[data-price-scale]" });
    window.WSBDashboardComponents.syncScaleButtonGroup(el.daysScaleButtons, state.daysScaleMode, { buttonSelector: "[data-days-scale]" });
    if (el.athLabelsToggle) el.athLabelsToggle.checked = state.showAthLabels;
    if (el.athMarkersToggle) el.athMarkersToggle.checked = state.showAthMarkers;
    if (el.halvingsToggle) el.halvingsToggle.checked = state.showHalvings;
    el.playBtn.disabled = state.playing;
    el.playBtn.classList.toggle("is-playing", state.playing);
    el.playBtn.setAttribute("aria-pressed", state.playing ? "true" : "false");
    el.pauseBtn.disabled = !state.playing;
    el.pauseBtn.classList.toggle("is-paused", dateRangePlaybackState.hasSession && !state.playing);
    el.stopBtn.disabled = !dateRangePlaybackState.hasSession && !state.playing;
    el.stopBtn.classList.remove("is-active");
    syncDownloadSettingsButtons();
    el.reset.disabled = state.preset === "full"
      && state.startIso === state.rows[0].date
      && state.endIso === state.rows[state.rows.length - 1].date
      && state.currentIso === state.endIso
      && state.speed === 1
      && state.chartMode === "both"
      && state.priceScaleMode === "log"
      && state.daysScaleMode === "linear"
      && state.showAthLabels
      && state.showAthMarkers
      && state.showHalvings;
    document.querySelectorAll("[data-range-preset]").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.rangePreset === state.preset));
    const { startIndex: startIdx, endIndex: endIdx, maxIndex } = getCurrentRangeIndices();
    const maxIdx = Math.max(1, maxIndex);
    const startPct = indexPercent(startIdx);
    const endPct = indexPercent(endIdx);
    if (el.sliderWrap) {
      el.sliderWrap.style.setProperty("--slider-start", `${startPct}%`);
      el.sliderWrap.style.setProperty("--slider-end", `${endPct}%`);
      el.sliderWrap.style.setProperty("--available-start", "0%");
      el.sliderWrap.style.setProperty("--available-end", "100%");
    }
    if (el.startSlider && el.endSlider) {
      el.startSlider.max = String(maxIdx);
      el.endSlider.max = String(maxIdx);
      el.startSlider.value = String(startIdx);
      el.endSlider.value = String(endIdx);
    }
    if (el.selection) {
      const showRemaining = dateRangePlaybackState.hasSession || dateRangeEndSliderScrubState.active;
      const targetPct = indexPercent(dateRangePlaybackState.targetEndIndex || endIdx);
      el.selection.classList.toggle("active", showRemaining && targetPct > endPct);
      el.selection.style.left = `${endPct}%`;
      el.selection.style.right = `calc(100% - ${targetPct}%)`;
    }
  }

  function render() {
    if (!state.rows.length) return;
    normalizeState();
    syncControls();
    const showPrice = state.chartMode !== "days";
    const showDays = state.chartMode !== "price";
    if (showPrice) drawPriceChart();
    if (showDays) drawDaysChart();
    saveState();
  }

  function syncChartModeControls() {
    window.WSBDashboardComponents.setTwoPanelMode({
      mode: state.chartMode,
      leftValue: "price",
      rightValue: "days",
      activeClass: "is-selected",
      selectedClass: "is-selected",
      buttonSelector: "[data-chart-mode]",
      group: el.chartModeButtons,
      grid: el.chartGrid,
      leftPanel: el.pricePanel,
      rightPanel: el.daysPanel,
      leftOnlyClass: "is-price-only",
      rightOnlyClass: "is-days-only",
    });
  }

  function setChartModeFromVisible(showPrice, showDays) {
    if (showPrice && showDays) state.chartMode = "both";
    else if (showPrice) state.chartMode = "price";
    else if (showDays) state.chartMode = "days";
    else state.chartMode = "both";
  }

  function setSettingsMenuOpen(open) {
    window.WSBDashboardComponents.setFloatingMenuOpen({
      menu: el.settingsMenu,
      button: el.settingsBtn,
      onOpen: syncDownloadSettingsControls,
    }, open);
  }

  function constrainDownloadSettingsMenuToViewport() {
    window.WSBDashboardComponents.constrainFloatingMenuToViewport(el.settingsMenu);
  }

  function syncDownloadSettingsButtons() {
    syncDownloadSettingsControls();
  }

  function syncExpandedState() {
    const expanded = document.body.classList.contains("days-since-ath-dashboard-expanded");
    el.expandBtn?.classList.toggle("is-expanded", expanded);
    el.expandBtn?.setAttribute("aria-pressed", expanded ? "true" : "false");
    el.expandBtn?.setAttribute("aria-label", expanded ? "Shrink video layout" : "Expand video layout");
    el.expandBtn?.setAttribute("title", expanded ? "Shrink video layout" : "Expand video layout");
  }

  function setDashboardExpandedMode(expanded) {
    document.body.classList.toggle("days-since-ath-dashboard-expanded", !!expanded);
    syncExpandedState();
    try {
      window.parent?.postMessage({ type: "wsb-days-since-ath-dashboard-expanded", expanded: !!expanded }, window.location.origin);
    } catch (_) {
      // Ignore parent messaging failures.
    }
    requestAnimationFrame(() => {
      render();
      requestAnimationFrame(render);
    });
  }

  function toggleExpandedLayout() {
    setDashboardExpandedMode(!document.body.classList.contains("days-since-ath-dashboard-expanded"));
  }

  function renderDateRangeDownloadButtonProgress(progress = 0) {
    if (!el.downloadBtn) return;
    const progressPct = `${Math.max(0, Math.min(1, Number(progress) || 0)) * 100}%`;
    const progressEl = el.downloadBtn.querySelector(".date-range-export-progress");
    if (el.downloadBtn.classList.contains("is-exporting") && progressEl) {
      progressEl.style.setProperty("--date-range-export-progress", progressPct);
      return;
    }
    el.downloadBtn.classList.add("is-exporting");
    el.downloadBtn.disabled = false;
    el.downloadBtn.setAttribute("aria-label", "Cancel animation download");
    el.downloadBtn.setAttribute("title", "Cancel download");
    el.downloadBtn.innerHTML = [
      `<span class="date-range-export-progress" style="--date-range-export-progress: ${progressPct}" aria-hidden="true">`,
      '<span class="date-range-export-stop-square"></span>',
      "</span>",
    ].join("");
    syncDownloadSettingsDownloadButton();
  }

  function resetDateRangeDownloadButton() {
    if (!el.downloadBtn) return;
    el.downloadBtn.classList.remove("is-exporting", "is-canceling");
    el.downloadBtn.disabled = false;
    el.downloadBtn.setAttribute("aria-label", "Download date range animation");
    el.downloadBtn.setAttribute("title", "Download animation");
    el.downloadBtn.textContent = "↓";
    syncDownloadSettingsDownloadButton();
  }

  function syncDownloadSettingsDownloadButton() {
    if (!el.settingsDownloadBtn) return;
    el.settingsDownloadBtn.classList.toggle("is-stop-download", isDateRangeExporting);
    el.settingsDownloadBtn.textContent = isDateRangeExporting ? "Stop Download" : "Download Animation";
  }

  function requestExportCancel() {
    if (!isDateRangeExporting) return;
    dateRangeExportCancelRequested = true;
    el.downloadBtn?.classList.add("is-canceling");
    syncDownloadSettingsDownloadButton();
  }

  function broadcastExportActive(active) {
    try {
      window.dateRangeExportActive = !!active;
      window.wsbDashboardExportActive = !!active;
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "wsb-days-since-ath-date-range-export-active", active: !!active }, window.location.origin);
      }
    } catch (_) {}
  }

  function waitMs(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function waitForExportFonts() {
    try {
      await document.fonts?.ready;
    } catch (_) {}
  }

  function drawExportLayoutFrame(index, settings, exportCanvas, options = {}) {
    const { width, height, footerHeight } = getExportLayoutMetrics(settings);
    const outputSettings = options.outputSettings || settings;
    const outputDimensions = getDownloadDimensions(outputSettings);
    const pixelScale = Math.max(1, Number(options.pixelScale) || 1);
    if (exportCanvas.width !== outputDimensions.width) exportCanvas.width = outputDimensions.width;
    if (exportCanvas.height !== outputDimensions.height) exportCanvas.height = outputDimensions.height;
    const ctx = exportCanvas.getContext("2d");
    const bg = EXPORT_THEME_PALETTES[settings.theme]?.["--bg"] || css("--bg", "#000");
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const mode = settings.chartMode;
    const surfaceHeight = Math.max(1, height - footerHeight);
    const gap = mode === "both" ? Math.max(10, Math.round(Math.min(width, height) * 0.012)) : 0;
    const horizontal = mode !== "both" || width >= surfaceHeight;
    const panelWidth = mode === "both" && horizontal ? Math.floor((width - gap) / 2) : width;
    const panelHeight = mode === "both" && !horizontal ? Math.floor((surfaceHeight - gap) / 2) : surfaceHeight;
    const priceCanvas = document.createElement("canvas");
    const daysCanvas = document.createElement("canvas");
    priceCanvas.__exportWidth = panelWidth;
    priceCanvas.__exportHeight = panelHeight;
    priceCanvas.__exportPixelScale = pixelScale;
    daysCanvas.__exportWidth = panelWidth;
    daysCanvas.__exportHeight = panelHeight;
    daysCanvas.__exportPixelScale = pixelScale;

    const prevFrameIso = activeExportFrameIso;
    const prevPriceScale = activeExportPriceScaleMode;
    const prevDaysScale = activeExportDaysScaleMode;
    const prevTheme = activeExportTheme;
    activeExportFrameIso = state.rows[index]?.date || state.endIso;
    activeExportPriceScaleMode = settings.leftScale;
    activeExportDaysScaleMode = settings.rightScale;
    activeExportTheme = settings.theme;
    try {
      if (mode !== "right") drawPriceChart(priceCanvas);
      if (mode !== "left") drawDaysChart(daysCanvas);
    } finally {
      activeExportFrameIso = prevFrameIso;
      activeExportPriceScaleMode = prevPriceScale;
      activeExportDaysScaleMode = prevDaysScale;
      activeExportTheme = prevTheme;
    }

    if (mode === "left") {
      ctx.drawImage(priceCanvas, 0, 0, width, surfaceHeight);
    } else if (mode === "right") {
      ctx.drawImage(daysCanvas, 0, 0, width, surfaceHeight);
    } else if (horizontal) {
      ctx.drawImage(priceCanvas, 0, 0, panelWidth, surfaceHeight);
      ctx.drawImage(daysCanvas, panelWidth + gap, 0, width - panelWidth - gap, surfaceHeight);
    } else {
      ctx.drawImage(priceCanvas, 0, 0, width, panelHeight);
      ctx.drawImage(daysCanvas, 0, panelHeight + gap, width, surfaceHeight - panelHeight - gap);
    }

    ctx.save();
    ctx.fillStyle = bg;
    ctx.fillRect(0, height - footerHeight, width, footerHeight);
    ctx.fillStyle = settings.theme === "dark" ? "#6f7f87" : "#8f887f";
    window.WSBDashboardExport.drawFooterUrl(
      ctx,
      "https://wickedsmartbitcoin.com/days_since_ath",
      { width, height, footerHeight },
      { ...outputSettings, theme: settings.theme, pixelScale, referenceQuality: 1440 },
    );
    ctx.restore();
  }

  function drawExportFrame(index, settings, exportCanvas) {
    const referenceSettings = getExportReferenceLayoutSettings(settings);
    const referenceDimensions = getDownloadDimensions(referenceSettings);
    const outputDimensions = getDownloadDimensions(settings);
    const pixelScale = Math.max(
      outputDimensions.width / Math.max(1, referenceDimensions.width),
      outputDimensions.height / Math.max(1, referenceDimensions.height),
    );
    drawExportLayoutFrame(index, referenceSettings, exportCanvas, {
      outputSettings: settings,
      pixelScale,
    });
  }

  async function encodeAnimationWebM(settings, frameIndices) {
    const { width, height } = getDownloadDimensions(settings);
    const exportCanvas = document.createElement("canvas");
    const blob = await window.WSBDashboardExport.encodeWebM({
      canvas: exportCanvas,
      width,
      height,
      fps: DATE_RANGE_EXPORT_VIDEO_FPS,
      settings,
      frames: frameIndices,
      title: "Days Since ATH",
      renderFrame: (index) => drawExportFrame(index, settings, exportCanvas),
      isCanceled: () => dateRangeExportCancelRequested,
      onProgress: renderDateRangeDownloadButtonProgress,
    });
    if (!blob) throw new Error("Deterministic WebCodecs WebM export is unavailable in this browser.");
    return blob;
  }

  function downloadBlob(blob, settings) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const charts = settings.chartMode === "both" ? "both" : settings.chartMode === "left" ? "price" : "days";
    link.download = `days-since-ath-${charts}-${state.startIso}-${state.endIso}.webm`;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadDateRangeAnimation() {
    if (isDateRangeExporting) {
      requestExportCancel();
      return;
    }
    if (!state.rows.length) return;
    const settings = normalizeDownloadSettings(readDownloadSettingsControls());
    downloadSettings = settings;
    persistDownloadSettingsFromControls();
    const startIndex = Math.max(0, findIndex(state.startIso, "ceil"));
    const endIndex = Math.max(startIndex, findIndex(state.endIso, "floor"));
    const frameIndices = buildExportFrameIndices(startIndex, endIndex, Number(settings.fps), settings.endFrameHold);
    isDateRangeExporting = true;
    dateRangeExportCancelRequested = false;
    broadcastExportActive(true);
    renderDateRangeDownloadButtonProgress(0);
    try {
      await waitForExportFonts();
      const blob = await encodeAnimationWebM(settings, frameIndices);
      if (blob && !dateRangeExportCancelRequested) {
        renderDateRangeDownloadButtonProgress(1);
        downloadBlob(blob, settings);
      }
    } catch (error) {
      console.error("Unable to export Days Since ATH animation.", error);
      window.alert?.(error?.message || "Unable to export animation.");
    } finally {
      isDateRangeExporting = false;
      dateRangeExportCancelRequested = false;
      broadcastExportActive(false);
      resetDateRangeDownloadButton();
      updateDownloadEstimates();
    }
  }

  function clearPlaybackScrubState() {
    dateRangeEndSliderScrubState.active = false;
    dateRangeEndSliderScrubState.pointerId = null;
    dateRangeEndSliderScrubState.resumeAfterRelease = false;
    dateRangeEndSliderScrubState.captureOnWrap = false;
  }

  function updatePlaybackActiveFlag() {
    const active = !!dateRangePlaybackState.hasSession;
    window.dateRangePlaybackActive = active;
    try {
      if (window.parent && window.parent !== window) {
        window.parent.dateRangePlaybackActive = active;
        window.parent.postMessage({ type: "wsb-days-since-ath-date-range-playback-active", active }, window.location.origin);
      }
    } catch (_) {
      // Ignore cross-frame access issues.
    }
  }

  function setRange(startIso, endIso, preset = "", options = {}) {
    if (!options.preservePlayback) stopPlayback({ restoreOriginalRange: false, renderAfter: false });
    state.startIso = clampIso(startIso);
    state.endIso = clampIso(endIso);
    state.currentIso = state.endIso;
    state.preset = inferPreset(state.startIso, state.endIso) || preset || "";
    render();
  }

  function applyPreset(preset) {
    const end = state.rows[state.rows.length - 1].date;
    setRange(getPresetStart(preset, end), end, preset);
  }

  function stepPlayback(timestampMs) {
    if (!state.playing || !dateRangePlaybackState.hasSession) {
      pause();
      return;
    }
    if (!dateRangePlaybackState.lastTimestampMs) dateRangePlaybackState.lastTimestampMs = timestampMs;
    const elapsedMs = Math.min(100, Math.max(0, timestampMs - dateRangePlaybackState.lastTimestampMs));
    dateRangePlaybackState.lastTimestampMs = timestampMs;
    dateRangePlaybackState.accumulatedMs += elapsedMs;
    const frameMs = 1000 / DEFAULT_RANGE_PLAYBACK_FPS;
    let currentEndIndex = findIndex(state.endIso, "floor");
    if (!Number.isFinite(currentEndIndex)) currentEndIndex = dateRangePlaybackState.currentEndIndex;
    let stepped = false;
    while (dateRangePlaybackState.accumulatedMs >= frameMs && currentEndIndex < dateRangePlaybackState.targetEndIndex) {
      currentEndIndex += Math.max(1, Math.round(state.speed));
      currentEndIndex = Math.min(currentEndIndex, dateRangePlaybackState.targetEndIndex);
      dateRangePlaybackState.accumulatedMs -= frameMs;
      stepped = true;
    }
    if (stepped) {
      dateRangePlaybackState.currentEndIndex = currentEndIndex;
      setRangeByIndices(dateRangePlaybackState.startIndex, currentEndIndex);
    }
    if (currentEndIndex >= dateRangePlaybackState.targetEndIndex) {
      stopPlayback({ restoreOriginalRange: true });
      return;
    }
    state.timer = window.requestAnimationFrame(stepPlayback);
  }

  function play() {
    if (state.playing) return;
    const { startIndex, endIndex } = getCurrentRangeIndices();
    if (!dateRangePlaybackState.hasSession) {
      dateRangePlaybackState = {
        hasSession: true,
        startIndex,
        targetEndIndex: endIndex,
        currentEndIndex: startIndex,
        originalStartIndex: startIndex,
        originalEndIndex: endIndex,
        lastTimestampMs: 0,
        accumulatedMs: 0,
      };
      updatePlaybackActiveFlag();
      setRangeByIndices(startIndex, startIndex);
    } else {
      const resumeEndIndex = Math.max(
        dateRangePlaybackState.startIndex,
        Math.min(dateRangePlaybackState.targetEndIndex, dateRangePlaybackState.currentEndIndex)
      );
      setRangeByIndices(dateRangePlaybackState.startIndex, resumeEndIndex);
    }
    state.playing = true;
    dateRangePlaybackState.lastTimestampMs = 0;
    dateRangePlaybackState.accumulatedMs = 0;
    state.timer = window.requestAnimationFrame(stepPlayback);
    render();
  }

  function pause() {
    if (!state.playing) return;
    window.cancelAnimationFrame(state.timer);
    state.timer = null;
    state.playing = false;
    dateRangePlaybackState.currentEndIndex = findIndex(state.endIso, "floor");
    render();
  }

  function stopPlayback(options = {}) {
    const restoreOriginalRange = !!options.restoreOriginalRange;
    const renderAfter = options.renderAfter !== false;
    const restoreStart = dateRangePlaybackState.originalStartIndex;
    const restoreEnd = dateRangePlaybackState.originalEndIndex;
    window.cancelAnimationFrame(state.timer);
    state.timer = null;
    state.playing = false;
    const hadSession = dateRangePlaybackState.hasSession;
    dateRangePlaybackState = {
      hasSession: false,
      startIndex: 0,
      targetEndIndex: 0,
      currentEndIndex: 0,
      originalStartIndex: 0,
      originalEndIndex: 0,
      lastTimestampMs: 0,
      accumulatedMs: 0,
    };
    updatePlaybackActiveFlag();
    clearPlaybackScrubState();
    if (restoreOriginalRange && hadSession && Number.isFinite(restoreStart) && Number.isFinite(restoreEnd)) {
      setRangeByIndices(restoreStart, restoreEnd);
      return;
    }
    state.currentIso = state.endIso;
    if (renderAfter) render();
  }

  function isKeyboardTextEntryActive() {
    const active = document.activeElement;
    if (!active) return false;
    const tag = String(active.tagName || "").toUpperCase();
    const type = String(active.type || "").toLowerCase();
    return (
      (tag === "INPUT" && type !== "range")
      || tag === "TEXTAREA"
      || tag === "SELECT"
      || active.isContentEditable
    );
  }

  function blurDateRangeKeyboardControlIfFocused() {
    const active = document.activeElement;
    if (
      active === el.startSlider
      || active === el.endSlider
      || active === el.playBtn
      || active === el.pauseBtn
      || active === el.stopBtn
      || active === el.speedBtn
      || (el.rangeButtons && el.rangeButtons.contains(active))
    ) {
      active.blur();
    }
  }

  function handleDateRangeSpaceShortcut(event) {
    if (!(event.key === " " || event.key === "Spacebar" || event.code === "Space")) return;
    if (event.altKey || event.ctrlKey || event.metaKey || isKeyboardTextEntryActive()) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    blurDateRangeKeyboardControlIfFocused();
    if (state.playing) pause();
    else play();
    requestAnimationFrame(blurDateRangeKeyboardControlIfFocused);
  }

  function handleDateRangeArrowScrubbing(event) {
    if (!dateRangePlaybackState.hasSession) return;
    if (event.altKey || event.ctrlKey || event.metaKey || isKeyboardTextEntryActive()) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      stopPlayback({ restoreOriginalRange: true });
      return;
    }

    const isArrowLeft = event.key === "ArrowLeft";
    const isArrowRight = event.key === "ArrowRight";
    if (!isArrowLeft && !isArrowRight) return;

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();

    const maxIdx = maxRangeIndex();
    const sessionStart = Math.max(0, Math.min(maxIdx, Math.round(dateRangePlaybackState.startIndex)));
    const sessionEnd = Math.max(sessionStart, Math.min(maxIdx, Math.round(dateRangePlaybackState.targetEndIndex)));
    let currentEnd = findIndex(state.endIso, "floor");
    if (!Number.isFinite(currentEnd)) currentEnd = dateRangePlaybackState.currentEndIndex || sessionStart;
    currentEnd = Math.max(sessionStart, Math.min(sessionEnd, Math.round(currentEnd)));
    const step = Math.max(1, Math.round(10 * DEFAULT_RANGE_PLAYBACK_FPS));
    const nextEnd = isArrowRight
      ? Math.min(sessionEnd, currentEnd + step)
      : Math.max(sessionStart, currentEnd - step);
    if (nextEnd === currentEnd) return;

    setRangeByIndices(sessionStart, nextEnd);
    dateRangePlaybackState.currentEndIndex = nextEnd;
    if (isArrowRight && state.playing && nextEnd === sessionEnd) pause();
  }

  function beginDateRangeEndSliderScrub(event) {
    if (!el.endSlider || !state.rows.length) return;
    if (typeof event.button === "number" && event.button !== 0) return;
    dateRangeEndSliderScrubState.active = true;
    dateRangeEndSliderScrubState.pointerId = Number.isFinite(event.pointerId) ? event.pointerId : null;
    dateRangeEndSliderScrubState.resumeAfterRelease = false;
    dateRangeEndSliderScrubState.captureOnWrap = false;
    if (state.playing) {
      pause();
      dateRangeEndSliderScrubState.resumeAfterRelease = true;
    }
    if (dateRangePlaybackState.hasSession) {
      dateRangePlaybackState.currentEndIndex = findIndex(state.endIso, "floor");
    }
    try {
      if (Number.isFinite(event.pointerId)) el.endSlider.setPointerCapture(event.pointerId);
    } catch (_) {}
  }

  function beginDateRangeStartSliderScrub(event) {
    if (!el.startSlider || !state.rows.length) return;
    if (typeof event.button === "number" && event.button !== 0) return;
    if (dateRangePlaybackState.hasSession) stopPlayback({ restoreOriginalRange: false });
  }

  function endDateRangeEndSliderScrub(event) {
    if (!dateRangeEndSliderScrubState.active) return;
    if (Number.isFinite(dateRangeEndSliderScrubState.pointerId)
      && Number.isFinite(event.pointerId)
      && event.pointerId !== dateRangeEndSliderScrubState.pointerId) {
      return;
    }
    try {
      if (dateRangeEndSliderScrubState.captureOnWrap && el.sliderWrap && Number.isFinite(event.pointerId)) {
        el.sliderWrap.releasePointerCapture(event.pointerId);
      } else if (el.endSlider && Number.isFinite(event.pointerId)) {
        el.endSlider.releasePointerCapture(event.pointerId);
      }
    } catch (_) {}

    const shouldResume = dateRangeEndSliderScrubState.resumeAfterRelease;
    clearPlaybackScrubState();
    dateRangeDragState = null;
    if (!dateRangePlaybackState.hasSession) return;

    const currentEndIndex = findIndex(state.endIso, "floor");
    dateRangePlaybackState.currentEndIndex = currentEndIndex;
    if (currentEndIndex < dateRangePlaybackState.startIndex || currentEndIndex >= dateRangePlaybackState.targetEndIndex) {
      stopPlayback({ restoreOriginalRange: false });
      return;
    }
    if (shouldResume) play();
  }

  function beginDateRangeSegmentDrag(event) {
    if (dateRangeEndSliderScrubState.active && !dateRangeEndSliderScrubState.captureOnWrap) return;
    if (!el.sliderWrap || !state.rows.length) return;
    if (typeof event.button === "number" && event.button !== 0) return;

    const { startIndex, endIndex, maxIndex } = getCurrentRangeIndices();
    const rect = el.sliderWrap.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || rect.width <= 0) return;

    const pointerX = event.clientX;
    const startX = rect.left + (indexPercent(startIndex) / 100) * rect.width;
    const endX = rect.left + (indexPercent(endIndex) / 100) * rect.width;
    const handleGuardPx = 12;
    const nearStartHandle = Math.abs(pointerX - startX) <= handleGuardPx;
    const nearEndHandle = Math.abs(pointerX - endX) <= handleGuardPx;

    if (nearStartHandle || nearEndHandle) {
      const mode = nearStartHandle && nearEndHandle
        ? (Math.abs(pointerX - startX) <= Math.abs(pointerX - endX) ? "start" : "end")
        : (nearStartHandle ? "start" : "end");
      if (dateRangePlaybackState.hasSession && mode === "start") stopPlayback({ restoreOriginalRange: false });
      if (dateRangePlaybackState.hasSession && mode === "end") {
        dateRangeEndSliderScrubState.active = true;
        dateRangeEndSliderScrubState.pointerId = Number.isFinite(event.pointerId) ? event.pointerId : null;
        dateRangeEndSliderScrubState.resumeAfterRelease = !!state.playing;
        dateRangeEndSliderScrubState.captureOnWrap = true;
        if (state.playing) pause();
      }
      event.preventDefault();
      dateRangeDragState = {
        mode,
        pointerId: event.pointerId,
        startIndex,
        endIndex,
        maxIndex,
        startClientX: pointerX,
        wrapWidth: rect.width,
      };
      try {
        if (Number.isFinite(event.pointerId)) el.sliderWrap.setPointerCapture(event.pointerId);
      } catch (_) {}
      return;
    }

    if (dateRangePlaybackState.hasSession) {
      const clickedIndex = getDateRangeIndexFromPointerX(pointerX);
      if (!Number.isFinite(clickedIndex)) return;
      event.preventDefault();
      dateRangeEndSliderScrubState.active = true;
      dateRangeEndSliderScrubState.pointerId = Number.isFinite(event.pointerId) ? event.pointerId : null;
      dateRangeEndSliderScrubState.resumeAfterRelease = !!state.playing;
      dateRangeEndSliderScrubState.captureOnWrap = true;
      if (state.playing) pause();
      applyPlaybackEndScrubIndex(clickedIndex);
      try {
        if (Number.isFinite(event.pointerId)) el.sliderWrap.setPointerCapture(event.pointerId);
      } catch (_) {}
      return;
    }

    if (pointerX <= startX + handleGuardPx || pointerX >= endX - handleGuardPx) return;
    if (pointerX < startX || pointerX > endX || startIndex >= endIndex) return;
    event.preventDefault();
    dateRangeDragState = {
      mode: "range",
      pointerId: event.pointerId,
      startClientX: pointerX,
      startIndex,
      endIndex,
      maxIndex,
      wrapWidth: rect.width,
    };
    try {
      if (Number.isFinite(event.pointerId)) el.sliderWrap.setPointerCapture(event.pointerId);
    } catch (_) {}
  }

  function moveDateRangeSegmentDrag(event) {
    if (dateRangeEndSliderScrubState.active) {
      if (Number.isFinite(dateRangeEndSliderScrubState.pointerId)
        && Number.isFinite(event.pointerId)
        && event.pointerId !== dateRangeEndSliderScrubState.pointerId) {
        return;
      }
      event.preventDefault();
      const nextIndex = getDateRangeIndexFromPointerX(event.clientX);
      if (Number.isFinite(nextIndex)) applyPlaybackEndScrubIndex(nextIndex);
      return;
    }
    if (!dateRangeDragState || event.pointerId !== dateRangeDragState.pointerId) return;
    event.preventDefault();
    const pointerIndex = getDateRangeIndexFromPointerX(event.clientX);
    if (!Number.isFinite(pointerIndex)) return;

    if (dateRangeDragState.mode === "start" || dateRangeDragState.mode === "end") {
      const current = getCurrentRangeIndices();
      const nextStart = dateRangeDragState.mode === "start"
        ? Math.max(0, Math.min(current.endIndex, pointerIndex))
        : current.startIndex;
      const nextEnd = dateRangeDragState.mode === "end"
        ? Math.max(current.startIndex, Math.min(current.maxIndex, pointerIndex))
        : current.endIndex;
      setRangeByIndices(nextStart, nextEnd);
      return;
    }

    const deltaPx = event.clientX - dateRangeDragState.startClientX;
    const deltaIndex = Math.round((deltaPx / Math.max(1, dateRangeDragState.wrapWidth)) * Math.max(1, dateRangeDragState.maxIndex));
    const nextRange = dateRangeController?.moveRangeByDelta(dateRangeDragState.startIndex, dateRangeDragState.endIndex, deltaIndex);
    if (nextRange) setRangeByIndices(nextRange.startIndex, nextRange.endIndex);
  }

  function endDateRangeSegmentDrag(event) {
    if (dateRangeEndSliderScrubState.active) {
      endDateRangeEndSliderScrub(event);
      return;
    }
    if (!dateRangeDragState || event.pointerId !== dateRangeDragState.pointerId) return;
    try {
      if (Number.isFinite(event.pointerId)) el.sliderWrap?.releasePointerCapture(event.pointerId);
    } catch (_) {}
    dateRangeDragState = null;
  }

  function bindEvents() {
    const startPicker = makeDatePicker({
      align: "left",
      anchorEl: el.startBtn,
      getSelected: () => el.startInput.value,
      getMin: () => el.startInput.min || state.rows[0]?.date || "",
      getMax: () => el.startInput.max || state.endIso || "",
      isDisabled: () => false,
      onSelect: (isoVal) => {
        stopPlayback({ restoreOriginalRange: false });
        setRange(isoVal, state.endIso, "");
        endPicker.rebuildCalendar();
      },
    });
    const endPicker = makeDatePicker({
      align: "left",
      anchorEl: el.endBtn,
      getSelected: () => el.endInput.value,
      getMin: () => el.endInput.min || state.startIso || "",
      getMax: () => el.endInput.max || state.rows[state.rows.length - 1]?.date || "",
      isDisabled: () => false,
      onSelect: (isoVal) => {
        stopPlayback({ restoreOriginalRange: false });
        setRange(state.startIso, isoVal, "");
        startPicker.rebuildCalendar();
      },
    });
    el.startBtn.addEventListener("click", startPicker.toggle);
    el.endBtn.addEventListener("click", endPicker.toggle);
    el.startInput.addEventListener("change", () => setRange(el.startInput.value, state.endIso, ""));
    el.endInput.addEventListener("change", () => setRange(state.startIso, el.endInput.value, ""));
    el.rangeButtons.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-range-preset]");
      if (btn) applyPreset(btn.dataset.rangePreset);
    });
    el.rangeDaysInput.addEventListener("change", () => {
      const days = Number.parseInt(el.rangeDaysInput.value.replace(/[^\d]/g, ""), 10);
      if (!Number.isFinite(days) || days < 1) return;
      setRange(addDays(state.endIso, -days + 1), state.endIso, "");
    });
    el.startSlider?.addEventListener("input", () => {
      const currentEnd = findIndex(state.endIso, "floor");
      const startIdx = Math.max(0, Math.min(Number(el.startSlider.value) || 0, currentEnd));
      setRangeByIndices(startIdx, currentEnd);
    });
    el.startSlider?.addEventListener("pointerdown", beginDateRangeStartSliderScrub);
    el.endSlider?.addEventListener("input", () => {
      const currentStart = dateRangePlaybackState.hasSession
        ? dateRangePlaybackState.startIndex
        : findIndex(state.startIso, "ceil");
      const endIdx = Math.max(currentStart, Number(el.endSlider.value) || currentStart);
      setRangeByIndices(currentStart, endIdx);
      if (dateRangePlaybackState.hasSession) dateRangePlaybackState.currentEndIndex = endIdx;
    });
    el.endSlider?.addEventListener("pointerdown", beginDateRangeEndSliderScrub);
    el.endSlider?.addEventListener("pointerup", endDateRangeEndSliderScrub);
    el.endSlider?.addEventListener("pointercancel", endDateRangeEndSliderScrub);
    el.sliderWrap?.addEventListener("pointerdown", beginDateRangeSegmentDrag);
    el.sliderWrap?.addEventListener("pointermove", moveDateRangeSegmentDrag);
    el.sliderWrap?.addEventListener("pointerup", endDateRangeSegmentDrag);
    el.sliderWrap?.addEventListener("pointercancel", endDateRangeSegmentDrag);
    window.WSBDashboardComponents.bindPlaybackKeyboardShortcuts({
      onSpace: handleDateRangeSpaceShortcut,
      isArrowActive: () => dateRangePlaybackState.hasSession,
      onArrow: (_direction, event) => handleDateRangeArrowScrubbing(event),
      isEscapeActive: () => dateRangePlaybackState.hasSession,
      onEscape: () => stopPlayback({ restoreOriginalRange: true }),
    });
    el.playBtn.addEventListener("click", play);
    el.pauseBtn.addEventListener("click", pause);
    el.stopBtn.addEventListener("click", () => stopPlayback({ restoreOriginalRange: true }));
    el.speedBtn.addEventListener("click", () => {
      const idx = SPEEDS.indexOf(state.speed);
      state.speed = SPEEDS[(idx + 1) % SPEEDS.length] || 1;
      render();
    });
    el.chartModeButtons?.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("[data-chart-mode]") : null;
      const nextMode = window.WSBDashboardComponents.toggleTwoPanelMode({
        group: el.chartModeButtons,
        currentMode: state.chartMode,
        leftValue: "price",
        rightValue: "days",
        activeClass: "is-selected",
        buttonSelector: "[data-chart-mode]",
      }, button);
      if (!isChartMode(nextMode) || nextMode === state.chartMode) return;
      state.chartMode = nextMode;
      render();
    });
    el.priceScaleButtons?.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("[data-price-scale]") : null;
      const scaleMode = window.WSBDashboardComponents.getScaleButtonValue(button);
      if (!isScaleMode(scaleMode) || state.priceScaleMode === scaleMode) return;
      state.priceScaleMode = scaleMode;
      render();
    });
    el.daysScaleButtons?.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("[data-days-scale]") : null;
      const scaleMode = window.WSBDashboardComponents.getScaleButtonValue(button);
      if (!isScaleMode(scaleMode) || state.daysScaleMode === scaleMode) return;
      state.daysScaleMode = scaleMode;
      render();
    });
    el.expandBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleExpandedLayout();
    });
    el.downloadBtn?.addEventListener("click", downloadDateRangeAnimation);
    el.settingsDownloadBtn?.addEventListener("click", () => {
      if (!isDateRangeExporting) setSettingsMenuOpen(false);
      downloadDateRangeAnimation();
    });
    el.settingsBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      setSettingsMenuOpen(!el.settingsMenu?.classList.contains("open"));
    });
    el.settingsMenu?.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest(".download-setting-option[data-value]") : null;
      if (!button) return;
      if (button.closest("#downloadChartModeSelect")) {
        window.WSBDashboardComponents.toggleRequiredButtonGroupItem(el.downloadChartModeSelect, button);
      } else {
        setDownloadSettingGroupValue(button.closest(".download-setting-button-row"), button.dataset.value);
      }
      persistDownloadSettingsFromControls();
    });
    el.settingsMenu?.addEventListener("change", (event) => {
      if (event.target === el.downloadEndFrameHoldToggle) persistDownloadSettingsFromControls();
    });
    document.addEventListener("click", (event) => {
      if (!el.settingsMenu?.classList.contains("open")) return;
      if (el.settingsMenu.contains(event.target) || el.settingsBtn?.contains(event.target)) return;
      setSettingsMenuOpen(false);
    });
    el.athLabelsToggle?.addEventListener("change", () => {
      state.showAthLabels = el.athLabelsToggle.checked;
      render();
    });
    el.athMarkersToggle?.addEventListener("change", () => {
      state.showAthMarkers = el.athMarkersToggle.checked;
      render();
    });
    el.halvingsToggle?.addEventListener("change", () => {
      state.showHalvings = el.halvingsToggle.checked;
      render();
    });
    window.WSBDashboardComponents.bindDashboardActions({
      copyButton: el.copyLink,
      resetButton: el.reset,
      getShareUrl: () => window.location.href,
      copyDefaultIcon: ICONS.copyLink,
      copyCopiedIcon: ICONS.copyCopied,
      setCopyIcon: (icon) => setButtonIcon("copyDashboardIcon", icon),
      onReset: () => {
        localStorage.removeItem(STORAGE_KEY);
        state.preset = "full";
        state.speed = 1;
        state.chartMode = "both";
        state.priceScaleMode = "log";
        state.daysScaleMode = "linear";
        state.showAthLabels = true;
        state.showAthMarkers = true;
        state.showHalvings = true;
        applyPreset("full");
      },
    });
    window.addEventListener("resize", render);
    window.addEventListener("resize", constrainDownloadSettingsMenuToViewport);
  }

  async function loadData() {
    const resp = await fetch("../../assets/daily_price.csv", { cache: "default" });
    if (!resp.ok) throw new Error(`Failed to load daily_price.csv (${resp.status})`);
    const rows = parseCsv(await resp.text())
      .map((row) => ({
        date: isoFromRow(row),
        timestamp: row.timestamp || row.date || "",
        price: Math.max(Number(row.daily_high || row.price) || 0, PRICE_FALLBACK),
        height: Number(row.block_height) || 0,
      }))
      .filter((row) => row.date)
      .sort((a, b) => a.date.localeCompare(b.date));
    let athPrice = PRICE_FALLBACK;
    let athDate = rows[0]?.date || "";
    rows.forEach((row) => {
      row.isAth = !isNotValued(row.price) && row.price > athPrice;
      if (row.price >= athPrice) {
        athPrice = row.price;
        athDate = row.date;
      }
      row.athPrice = athPrice;
      row.athDate = athDate;
      row.daysSinceAth = dayDiff(athDate, row.date);
    });
    state.rows = rows;
    state.startIso = rows[0]?.date || "";
    state.endIso = rows[rows.length - 1]?.date || "";
    state.currentIso = state.endIso;
    readState();
    loadDownloadSettings();
    if (state.preset && state.preset !== "custom") {
      state.endIso = rows[rows.length - 1].date;
      state.startIso = getPresetStart(state.preset, state.endIso);
      state.currentIso = state.endIso;
    }
    render();
    DASHBOARD_COMPONENTS.bindChartLoaders?.([el.priceChartLoader, el.daysChartLoader])?.hide?.();
  }

  bindEvents();
  loadData().catch((error) => {
    DASHBOARD_COMPONENTS.bindChartLoaders?.([el.priceChartLoader, el.daysChartLoader])?.hide?.();
    console.error("Unable to load Days Since ATH dashboard.", error);
    if (updatedTimeZoneChip) updatedTimeZoneChip.setText("Load failed");
    else el.updatedKpi.textContent = "Load failed";
  });
}());
