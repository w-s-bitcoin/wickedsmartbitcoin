(function () {
  const THEME_KEY = "quantum-research-dashboard-theme";
  const UOA_FILTERS_KEY = "uoa-dashboard-filters-v1";
  const UOA_DOWNLOAD_SETTINGS_KEY = "uoa-dashboard-download-settings-v1";
  const DASHBOARD_TIME = window.WSBDashboardTime || null;
  const SHARE_STATE_PARAM = "state";
  const LOCAL_RUNTIME_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
  const IS_LOCAL_RUNTIME = LOCAL_RUNTIME_HOSTS.has(window.location.hostname);
  const ICONS = {
    copyLink: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
    copyCopied: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>',
    resetDefaults: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>',
    resetUndo: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>',
  };
  const REDENOMINATION_EVENTS = {
    VES: [
      { date: "2018-05-29", ratio: 100000, ratioLabel: "100,000:1" },
      { date: "2018-08-20", ratio: 100000, ratioLabel: "100,000:1" },
      { date: "2021-10-01", ratio: 1000000, ratioLabel: "1,000,000:1" },
    ],
    BYN: [
      { date: "2016-07-01", ratio: 10000, ratioLabel: "10,000:1" },
    ],
    MRU: [
      { date: "2018-01-02", ratio: 10, ratioLabel: "10:1" },
    ],
    CUP: [
      { date: "2021-01-04", ratio: 1 / 24, ratioLabel: "1:24" },
    ],
    SYP: [
      { date: "2026-01-07", ratio: 100, ratioLabel: "100:1" },
    ],
    ZMW: [
      { date: "2013-01-02", ratio: 1000, ratioLabel: "1,000:1" },
    ],
  };
  const NOTABLE_EVENTS = {
    VES: [
      {
        date: "2013-02-19",
        label: "VES devaluation ~65%",
      },
      {
        date: "2016-03-08",
        label: "VES devaluation ~70%",
      },
      {
        date: "2018-02-06",
        label: "VES devaluation ~250,000%",
      },
      {
        date: "2018-08-20",
        label: "VES devaluation ~50% + redenomination",
      },
    ],
    SDG: [
      {
        date: "2021-02-25",
        label: "SDG devaluation ~582%",
      },
    ],
    TMT: [
      {
        date: "2015-01-06",
        label: "TMT devaluation ~20%",
      },
    ],
    LBP: [
      {
        date: "2023-02-03",
        label: "LBP devaluation ~90%",
      },
      {
        date: "2024-03-11",
        label: "LBP devaluation ~83.3%",
      },
    ],
  };
  const LOG_MIN_POSITIVE = 1e-300;
  const DEFAULT_RANGE_PLAYBACK_FPS = 60;
  const DATE_RANGE_PLAYBACK_FPS_OPTIONS = [30, 60, 120, 240];
  const DATE_RANGE_THUMB_WIDTH_PX = 12;
  const DATE_RANGE_EXPORT_VIDEO_FPS = 30;
  const DATE_RANGE_EXPORT_START_HOLD_SECONDS = 1;
  const DATE_RANGE_EXPORT_END_HOLD_SECONDS = 3;
  const DATE_RANGE_EXPORT_BATCH_MEMORY_BUDGET = 220 * 1024 * 1024;
  const DATE_RANGE_EXPORT_MIN_BATCH_FRAMES = 12;
  const DATE_RANGE_EXPORT_MAX_BATCH_FRAMES = 90;
  const YELLOW_METAL_CURRENCIES = new Set(["XAU"]);
  const SILVER_METAL_CURRENCIES = new Set(["XAG", "XPT", "XPD"]);
  const GRAINS_PER_TROY_OUNCE = 480;
  const GRAIN_AXIS_OUNCE_THRESHOLD = 0.01;
  const MONETARY_METAL_COLORS = {
    dark: {
      yellow: "#facc15",
      silver: "#cbd5e1",
    },
    light: {
      yellow: "#e8c600",
      silver: "#8f9ead",
    },
  };
  const DEFAULT_DOWNLOAD_SETTINGS = {
    chartMode: "both",
    extension: "webm",
    quality: "720",
    orientation: "landscape",
    theme: "",
    fps: String(DEFAULT_RANGE_PLAYBACK_FPS),
    leftScale: "",
    rightScale: "",
    endFrameHold: true,
  };
  const RANGE_PRESET_KEYS = ["full", "ytd", "1y", "2y", "4y", "8y"];
  const EXPORT_THEME_PALETTES = {
    dark: {
      "--bg": "#000000",
      "--panel": "#000000",
      "--fg": "#e5e7eb",
      "--muted": "#95a6ae",
      "--line": "#2b2b2b",
      "--left": "#ff9f1c",
      "--right": "#34d399",
      "--ghost": "rgba(148, 163, 184, 0.25)",
    },
    light: {
      "--bg": "#ffffff",
      "--panel": "#ffffff",
      "--fg": "#111827",
      "--muted": "#6f685f",
      "--line": "#dedede",
      "--left": "#ff9f1c",
      "--right": "#39d7a4",
      "--ghost": "rgba(55, 65, 81, 0.2)",
    },
  };

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
  }

  try {
    const stored = localStorage.getItem(THEME_KEY);
    applyTheme(
      stored === "light" || stored === "dark"
        ? stored
        : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    );
  } catch (_) {
    applyTheme("dark");
  }

  window.addEventListener("message", (event) => {
    if (event.data && event.data.type === "quantum-dashboard-theme") {
      applyTheme(event.data.theme);
      renderAll();
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === THEME_KEY && (event.newValue === "light" || event.newValue === "dark")) {
      applyTheme(event.newValue);
      renderAll();
    }
  });

  const el = {
    copyDashboardLink: document.getElementById("copyDashboardLink"),
    resetDashboard: document.getElementById("resetDashboard"),
    updatedKpiValue: document.getElementById("updatedKpiValue"),
    blockHeightKpiValue: document.getElementById("blockHeightKpiValue"),
    pairKpiValue: document.getElementById("pairKpiValue"),
    primaryRankKpiValue: document.getElementById("primaryRankKpiValue"),
    secondaryRankKpiValue: document.getElementById("secondaryRankKpiValue"),
    startDateBtn: document.getElementById("startDateBtn"),
    endDateBtn: document.getElementById("endDateBtn"),
    rangeDaysLabel: document.getElementById("rangeDaysLabel"),
    dateRangeDaysInput: document.getElementById("dateRangeDaysInput"),
    dateRangePresets: document.getElementById("dateRangePresets"),
    dateRangeChartToggles: document.getElementById("dateRangeChartToggles"),
    dateRangePanel: document.querySelector(".date-range-panel"),
    chartGrid: document.querySelector(".grid"),
    dateRangePlaybackControls: document.getElementById("dateRangePlaybackControls"),
    dateRangePlayBtn: document.getElementById("dateRangePlayBtn"),
    dateRangePauseBtn: document.getElementById("dateRangePauseBtn"),
    dateRangeStopBtn: document.getElementById("dateRangeStopBtn"),
    dateRangeFpsTrigger: document.getElementById("dateRangeFpsTrigger"),
    dashboardExpandBtn: document.getElementById("dashboardExpandBtn"),
    dateRangeDownloadBtn: document.getElementById("dateRangeDownloadBtn"),
    dateRangeDownloadSettingsBtn: document.getElementById("dateRangeDownloadSettingsBtn"),
    dateRangeDownloadSettingsMenu: document.getElementById("dateRangeDownloadSettingsMenu"),
    downloadChartModeSelect: document.getElementById("downloadChartModeSelect"),
    downloadLeftScaleSelect: document.getElementById("downloadLeftScaleSelect"),
    downloadRightScaleSelect: document.getElementById("downloadRightScaleSelect"),
    downloadQualitySelect: document.getElementById("downloadQualitySelect"),
    downloadOrientationSelect: document.getElementById("downloadOrientationSelect"),
    downloadThemeSelect: document.getElementById("downloadThemeSelect"),
    downloadFpsSelect: document.getElementById("downloadFpsSelect"),
    downloadEndFrameHoldToggle: document.getElementById("downloadEndFrameHoldToggle"),
    downloadEstimateSize: document.getElementById("downloadEstimateSize"),
    downloadEstimateLength: document.getElementById("downloadEstimateLength"),
    downloadEstimateTime: document.getElementById("downloadEstimateTime"),
    downloadSettingsDownloadBtn: document.getElementById("downloadSettingsDownloadBtn"),
    startDateInput: document.getElementById("startDateInput"),
    endDateInput: document.getElementById("endDateInput"),
    dateRangeSliderWrap: document.getElementById("dateRangeSliderWrap"),
    dateRangeAvailableTrack: document.getElementById("dateRangeAvailableTrack"),
    dateRangeMissingDataStart: document.getElementById("dateRangeMissingDataStart"),
    dateRangeMissingDataEnd: document.getElementById("dateRangeMissingDataEnd"),
    dateRangeMissingSelectionStart: document.getElementById("dateRangeMissingSelectionStart"),
    dateRangeMissingSelectionEnd: document.getElementById("dateRangeMissingSelectionEnd"),
    dateRangeMissingMarkerStart: document.getElementById("dateRangeMissingMarkerStart"),
    dateRangeMissingMarkerEnd: document.getElementById("dateRangeMissingMarkerEnd"),
    dateRangeStartSlider: document.getElementById("dateRangeStartSlider"),
    dateRangeEndSlider: document.getElementById("dateRangeEndSlider"),
    dateRangeRemaining: document.getElementById("dateRangeRemaining"),
    primaryUoaSelect: document.getElementById("primaryUoaSelect"),
    secondaryUoaSelect: document.getElementById("secondaryUoaSelect"),
    scaleSelect: document.getElementById("scaleSelect"),
    orderBySelect: document.getElementById("orderBySelect"),
    vesRedenomAdjustToggle: document.getElementById("vesRedenomAdjustToggle"),
    usdBtcBig: document.getElementById("usdBtcBig"),
    btcUsdBig: document.getElementById("btcUsdBig"),
    usdBtcScaleLabel: document.getElementById("usdBtcScaleLabel"),
    btcUsdScaleLabel: document.getElementById("btcUsdScaleLabel"),
    satUsdText: document.getElementById("satUsdText"),
    usdSatText: document.getElementById("usdSatText"),
    usdBtcDateEdges: document.getElementById("usdBtcDateEdges"),
    btcUsdDateEdges: document.getElementById("btcUsdDateEdges"),
    usdBtcStartDateEdge: document.getElementById("usdBtcStartDateEdge"),
    usdBtcEndDateEdge: document.getElementById("usdBtcEndDateEdge"),
    btcUsdStartDateEdge: document.getElementById("btcUsdStartDateEdge"),
    btcUsdEndDateEdge: document.getElementById("btcUsdEndDateEdge"),
    blockHeightText: document.getElementById("blockHeightText"),
    rightAsOf: document.getElementById("rightAsOf"),
    usdBtcChart: document.getElementById("usdBtcChart"),
    btcUsdChart: document.getElementById("btcUsdChart"),
    usdBtcTitle: document.getElementById("usdBtcTitle"),
    btcUsdTitle: document.getElementById("btcUsdTitle"),
  };

  let allRows = [];
  let rows = [];
  let dropdownGlobalListenersBound = false;
  let secondaryArrowGlobalBound = false;
  let dateRangeSpaceShortcutBound = false;
  let dateRangeSessionPersistenceBound = false;
  const overlayClosers = new Set();
  let usdParityStartIso = "";
  let requestedDateRange = {
    startIso: "",
    endIso: "",
  };
  let uoaPairs = null; // Metadata from uoa_pairs.json
  let fxRatesByDate = {}; // { "2026-05-08": { "EUR/USD": 1.176100 } }
  let availableCurrencies = ["BTC", "USD"]; // Will be populated from uoaPairs
  let lastPrimaryUoa = "BTC";
  let lastSecondaryUoa = "USD";
  let preResetStateSnapshot = null;
  let suppressResetSnapshotClear = false;
  let customTooltipBound = false;
  let customTooltipAnchor = null;
  let updatedKpiTimeZone = DASHBOARD_TIME?.getPreferredTimeZone?.() || "UTC";
  let globalTimeZoneSyncBound = false;
  let refreshedAtText = "";
  const chartEventMarkersById = {
    usdBtcChart: [],
    btcUsdChart: [],
  };
  let chartEventTooltipEl = null;
  let dateRangeDragState = null;
  let dateRangeEndSliderScrubState = {
    active: false,
    pointerId: null,
    resumeAfterRelease: false,
    captureOnWrap: false,
  };
  let dateRangePlaybackOutsidePointerHandler = null;
  let dateRangePlaybackOutsidePointerTouchState = null;
  let dateRangeDownloadSettingsOutsideHandler = null;
  let dateRangeDownloadSettingsViewportHandler = null;
  let isDateRangeExporting = false;
  let dateRangeExportCancelRequested = false;
  let isRenderingDateRangeExportFrame = false;
  let activeDateRangeExportTheme = null;
  let activeDateRangeExportAxisRows = null;
  let activeDateRangeExportScaleModes = null;
  let downloadSettings = { ...DEFAULT_DOWNLOAD_SETTINGS };
  let downloadSettingsHasStoredValue = false;
  const exportNumericMeasureCache = new Map();
  let dateRangePlaybackState = {
    isPlaying: false,
    rafId: 0,
    lastTimestampMs: 0,
    accumulatedMs: 0,
    hasSession: false,
    fps: DEFAULT_RANGE_PLAYBACK_FPS,
    startIndex: 0,
    targetEndIndex: 0,
    currentEndIndex: 0,
    originalStartIndex: 0,
    originalEndIndex: 0,
  };

  const ORDER_MODES = ["alpha-asc", "alpha-desc", "value-desc", "value-asc"];

  function updatePlaybackActiveFlag() {
    const isActive = dateRangePlaybackState.hasSession;
    window.dateRangePlaybackActive = isActive;
    // Also set on parent window if this is in an iframe
    try {
      if (window.parent && window.parent !== window) {
        window.parent.dateRangePlaybackActive = isActive;
      }
    } catch (_) {
      // Ignore cross-origin issues
    }
  }

  function safeReadJson(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function setButtonIcon(iconId, markup) {
    const iconEl = document.getElementById(iconId);
    if (!iconEl || !markup) return;
    iconEl.outerHTML = markup.replace("<svg ", `<svg id="${iconId}" `);
  }

  function isMobileUiViewport() {
    return window.matchMedia("(max-width: 820px)").matches;
  }

  function setCustomTooltip(anchor, text) {
    if (!anchor) return;
    const value = String(text || "").trim();
    if (value) {
      anchor.setAttribute("data-tooltip", value);
    } else {
      anchor.removeAttribute("data-tooltip");
    }
    anchor.removeAttribute("title");
  }

  function ensureCustomTooltipElement() {
    let tooltip = document.getElementById("dashboardInlineTooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.id = "dashboardInlineTooltip";
      tooltip.className = "dashboard-inline-tooltip";
      document.body.appendChild(tooltip);
    }
    return tooltip;
  }

  function hideCustomTooltip() {
    const tooltip = document.getElementById("dashboardInlineTooltip");
    if (!tooltip) return;
    tooltip.classList.remove("is-visible");
  }

  function placeCustomTooltip(tooltip, x, y) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const offset = 14;
    let left = x + offset;
    let top = y + offset;
    const maxLeft = viewportWidth - tooltip.offsetWidth - 8;
    const maxTop = viewportHeight - tooltip.offsetHeight - 8;
    if (left > maxLeft) left = Math.max(8, x - tooltip.offsetWidth - offset);
    if (top > maxTop) top = Math.max(8, y - tooltip.offsetHeight - offset);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function showCustomTooltip(anchor, x, y) {
    const text = String(anchor?.getAttribute("data-tooltip") || "").trim();
    if (!text) {
      hideCustomTooltip();
      return;
    }
    const tooltip = ensureCustomTooltipElement();
    tooltip.textContent = text;
    tooltip.classList.add("is-visible");
    placeCustomTooltip(tooltip, x, y);
  }

  function bindCustomTooltips() {
    if (customTooltipBound) return;
    customTooltipBound = true;
    let mobileTooltipHideTimerId = null;

    const clearMobileTooltipHideTimer = () => {
      if (mobileTooltipHideTimerId !== null) {
        window.clearTimeout(mobileTooltipHideTimerId);
        mobileTooltipHideTimerId = null;
      }
    };

    const shouldSuppressTooltipForAnchor = (anchor) => {
      if (!anchor) return true;
      if (!isMobileUiViewport()) return false;
      return !(anchor instanceof HTMLElement && anchor.disabled);
    };

    document.addEventListener("mouseover", (event) => {
      const anchor = event.target instanceof Element ? event.target.closest("[data-tooltip]") : null;
      if (shouldSuppressTooltipForAnchor(anchor)) {
        if (customTooltipAnchor === anchor) customTooltipAnchor = null;
        hideCustomTooltip();
        return;
      }
      if (!anchor) return;
      customTooltipAnchor = anchor;
      showCustomTooltip(anchor, event.clientX, event.clientY);
    });

    document.addEventListener("mousemove", (event) => {
      if (!customTooltipAnchor) return;
      const tooltip = document.getElementById("dashboardInlineTooltip");
      if (!tooltip || !tooltip.classList.contains("is-visible")) return;
      placeCustomTooltip(tooltip, event.clientX, event.clientY);
    });

    document.addEventListener("mouseout", (event) => {
      if (!customTooltipAnchor) return;
      const related = event.relatedTarget;
      if (related instanceof Node && customTooltipAnchor.contains(related)) return;
      customTooltipAnchor = null;
      clearMobileTooltipHideTimer();
      hideCustomTooltip();
    });

    document.addEventListener("touchstart", (event) => {
      const anchor = event.target instanceof Element ? event.target.closest("[data-tooltip]") : null;
      if (shouldSuppressTooltipForAnchor(anchor)) {
        customTooltipAnchor = null;
        clearMobileTooltipHideTimer();
        hideCustomTooltip();
        return;
      }
      const touch = event.touches && event.touches.length ? event.touches[0] : null;
      const rect = anchor.getBoundingClientRect();
      const x = touch ? touch.clientX : rect.left + (rect.width / 2);
      const y = touch ? touch.clientY : rect.top + (rect.height / 2);
      customTooltipAnchor = anchor;
      showCustomTooltip(anchor, x, y);
      clearMobileTooltipHideTimer();
      mobileTooltipHideTimerId = window.setTimeout(() => {
        if (customTooltipAnchor === anchor) customTooltipAnchor = null;
        hideCustomTooltip();
        mobileTooltipHideTimerId = null;
      }, 1800);
    }, { passive: true });

    window.addEventListener("scroll", () => {
      if (!customTooltipAnchor) return;
      clearMobileTooltipHideTimer();
      hideCustomTooltip();
    }, { passive: true });
  }

  function clampIsoDate(value, minIso, maxIso, fallbackIso) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallbackIso;
    if (value < minIso) return minIso;
    if (value > maxIso) return maxIso;
    return value;
  }

  function isLeapYear(year) {
    if (!Number.isFinite(year)) return false;
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  }

  function getLocalTodayIso() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  }

  function shiftIsoByYearsPreservingDate(isoValue, yearDelta, options = {}) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoValue || ""))) return "";
    const [yRaw, mRaw, dRaw] = isoValue.split("-");
    const sourceYear = Number(yRaw);
    const sourceMonth = Number(mRaw);
    const sourceDay = Number(dRaw);
    const targetYear = sourceYear + Number(yearDelta || 0);
    if (!Number.isFinite(targetYear)) return "";
    const leapDayToFeb28 = options.leapDayToFeb28 !== false;

    if (leapDayToFeb28 && sourceMonth === 2 && sourceDay === 29 && !isLeapYear(targetYear)) {
      return `${targetYear}-${String(sourceMonth).padStart(2, "0")}-28`;
    }

    const lastDay = new Date(Date.UTC(targetYear, sourceMonth, 0)).getUTCDate();
    const day = Math.min(sourceDay, lastDay);
    return `${targetYear}-${String(sourceMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function shiftIsoByDays(isoValue, dayDelta) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoValue || ""))) return "";
    const date = new Date(`${isoValue}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return "";
    date.setUTCDate(date.getUTCDate() + Math.trunc(Number(dayDelta) || 0));
    return toIsoDate(date);
  }

  function getInclusiveIsoDaySpan(startIso, endIso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startIso || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(endIso || ""))) return null;
    const start = new Date(`${startIso}T00:00:00Z`);
    const end = new Date(`${endIso}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
    const dayMs = 24 * 60 * 60 * 1000;
    return Math.floor((end.getTime() - start.getTime()) / dayMs) + 1;
  }

  function getDateIndexOnOrAfter(targetIso) {
    if (!allRows.length || !targetIso) return -1;
    for (let i = 0; i < allRows.length; i += 1) {
      if (toIsoDate(allRows[i].date) >= targetIso) return i;
    }
    return allRows.length - 1;
  }

  function getDateIndexOnOrBefore(targetIso) {
    if (!allRows.length || !targetIso) return -1;
    for (let i = allRows.length - 1; i >= 0; i -= 1) {
      if (toIsoDate(allRows[i].date) <= targetIso) return i;
    }
    return 0;
  }

  function setRequestedDateRange(startIso, endIso) {
    requestedDateRange = {
      startIso: String(startIso || ""),
      endIso: String(endIso || ""),
    };
  }

  function getSelectedPairCurrencies() {
    return {
      primary: el.primaryUoaSelect?.value || "BTC",
      secondary: el.secondaryUoaSelect?.value || "USD",
    };
  }

  function rowSupportsCurrencyPair(row, primaryCurrency, secondaryCurrency) {
    if (!row?.date) return false;
    const isoDate = toIsoDate(row.date);
    const primaryInUsd = getCurrencyValueInUsd(primaryCurrency, row, isoDate);
    const secondaryInUsd = getCurrencyValueInUsd(secondaryCurrency, row, isoDate);
    return Number.isFinite(primaryInUsd) && primaryInUsd > 0
      && Number.isFinite(secondaryInUsd) && secondaryInUsd > 0;
  }

  function rowSupportsCurrency(row, currencyCode) {
    if (!row?.date) return false;
    const isoDate = toIsoDate(row.date);
    const valueInUsd = getCurrencyValueInUsd(currencyCode, row, isoDate);
    return Number.isFinite(valueInUsd) && valueInUsd > 0;
  }

  function getCurrencyDateIndexBounds(currencyCode) {
    if (!allRows.length) return null;
    const code = String(currencyCode || "BTC").toUpperCase();
    let minIndex = -1;
    let maxIndex = -1;
    for (let i = 0; i < allRows.length; i += 1) {
      if (!rowSupportsCurrency(allRows[i], code)) continue;
      if (minIndex < 0) minIndex = i;
      maxIndex = i;
    }
    if (minIndex < 0 || maxIndex < 0) return null;
    return {
      minIndex,
      maxIndex,
      minIso: toIsoDate(allRows[minIndex].date),
      maxIso: toIsoDate(allRows[maxIndex].date),
    };
  }

  function getMissingCurrenciesForRows(startIndex, endIndex, primaryCurrency, secondaryCurrency) {
    const missing = new Set();
    const safeStart = Math.max(0, Math.min(allRows.length - 1, startIndex));
    const safeEnd = Math.max(0, Math.min(allRows.length - 1, endIndex));
    if (!allRows.length || safeEnd < safeStart) return missing;

    for (let i = safeStart; i <= safeEnd; i += 1) {
      const row = allRows[i];
      const isoDate = toIsoDate(row.date);
      const primaryInUsd = getCurrencyValueInUsd(primaryCurrency, row, isoDate);
      const secondaryInUsd = getCurrencyValueInUsd(secondaryCurrency, row, isoDate);
      if (!Number.isFinite(primaryInUsd) || primaryInUsd <= 0) missing.add(primaryCurrency);
      if (!Number.isFinite(secondaryInUsd) || secondaryInUsd <= 0) missing.add(secondaryCurrency);
      if (missing.has(primaryCurrency) && missing.has(secondaryCurrency)) break;
    }
    return missing;
  }

  function getDateRangeRestrictionMessage(dataBounds = getPairDataDateIndexBounds(), primaryBounds = getPairDateIndexBounds()) {
    if (!allRows.length || !dataBounds || !primaryBounds) return "";
    if (dataBounds.minIndex <= primaryBounds.minIndex && dataBounds.maxIndex >= primaryBounds.maxIndex) return "";

    const { primary, secondary } = getSelectedPairCurrencies();
    const missing = new Set();
    if (dataBounds.minIndex > primaryBounds.minIndex) {
      getMissingCurrenciesForRows(primaryBounds.minIndex, dataBounds.minIndex - 1, primary, secondary).forEach((code) => missing.add(code));
    }
    if (dataBounds.maxIndex < primaryBounds.maxIndex) {
      getMissingCurrenciesForRows(dataBounds.maxIndex + 1, primaryBounds.maxIndex, primary, secondary).forEach((code) => missing.add(code));
    }

    const missingText = Array.from(missing).join(" and ") || `${primary} or ${secondary}`;
    return `Missing data for ${missingText}`;
  }

  function getPairDateIndexBounds(primaryCurrency = null, secondaryCurrency = null) {
    if (!allRows.length) return null;
    const pair = primaryCurrency && secondaryCurrency
      ? { primary: primaryCurrency, secondary: secondaryCurrency }
      : getSelectedPairCurrencies();
    return getCurrencyDateIndexBounds(pair.primary);
  }

  function getPairDataDateIndexBounds(primaryCurrency = null, secondaryCurrency = null) {
    if (!allRows.length) return null;
    const pair = primaryCurrency && secondaryCurrency
      ? { primary: primaryCurrency, secondary: secondaryCurrency }
      : getSelectedPairCurrencies();
    const primaryBounds = getCurrencyDateIndexBounds(pair.primary);
    const secondaryBounds = getCurrencyDateIndexBounds(pair.secondary);
    if (!primaryBounds || !secondaryBounds) return null;

    const minIndex = Math.max(primaryBounds.minIndex, secondaryBounds.minIndex);
    const maxIndex = Math.min(primaryBounds.maxIndex, secondaryBounds.maxIndex);
    if (minIndex > maxIndex) return null;
    return {
      minIndex,
      maxIndex,
      minIso: toIsoDate(allRows[minIndex].date),
      maxIso: toIsoDate(allRows[maxIndex].date),
    };
  }

  function clampDateRangeToPairBounds(startIso, endIso, pairBounds = getPairDateIndexBounds()) {
    const globalBounds = getDateBounds();
    if (!globalBounds) return { startIso, endIso };
    const minIso = pairBounds?.minIso || globalBounds.min;
    const maxIso = pairBounds?.maxIso || globalBounds.max;
    let nextStart = clampIsoDate(startIso, minIso, maxIso, minIso);
    let nextEnd = clampIsoDate(endIso, minIso, maxIso, maxIso);
    if (nextStart > nextEnd) {
      if (String(startIso || "") > maxIso) {
        nextStart = maxIso;
        nextEnd = maxIso;
      } else {
        nextEnd = nextStart;
      }
    }
    return { startIso: nextStart, endIso: nextEnd };
  }

  function syncDateControlBoundsToPair(pairBounds = getPairDateIndexBounds()) {
    const globalBounds = getDateBounds();
    if (!globalBounds) return;
    const minIso = pairBounds?.minIso || globalBounds.min;
    const maxIso = pairBounds?.maxIso || globalBounds.max;
    if (el.startDateInput) {
      el.startDateInput.min = minIso;
      el.startDateInput.max = maxIso;
    }
    if (el.endDateInput) {
      el.endDateInput.min = minIso;
      el.endDateInput.max = maxIso;
    }
  }

  function applyRequestedDateRangeToControls() {
    const bounds = getDateBounds();
    if (!bounds || !el.startDateInput || !el.endDateInput) return;
    if (!requestedDateRange.startIso || !requestedDateRange.endIso) {
      setRequestedDateRange(el.startDateInput.value || bounds.min, el.endDateInput.value || bounds.max);
    }
    const controlBounds = getDateRangeControlBounds();
    syncDateControlBoundsToPair(controlBounds);
    const clamped = clampDateRangeToPairBounds(requestedDateRange.startIso, requestedDateRange.endIso, controlBounds);
    el.startDateInput.value = clamped.startIso;
    el.endDateInput.value = clamped.endIso;
  }

  function getDateRangeControlBounds() {
    return getPairDataDateIndexBounds() || getPairDateIndexBounds();
  }

  function getDateRangeVisualBounds() {
    return getPairDateIndexBounds() || {
      minIndex: 0,
      maxIndex: Math.max(0, allRows.length - 1),
    };
  }

  function getDateRangeVisualPercent(index, visualBounds = getDateRangeVisualBounds()) {
    const minIndex = visualBounds?.minIndex ?? 0;
    const maxIndex = visualBounds?.maxIndex ?? Math.max(0, allRows.length - 1);
    const span = Math.max(1, maxIndex - minIndex);
    return Math.max(0, Math.min(100, ((index - minIndex) / span) * 100));
  }

  function getPresetDateIndices(presetKey, anchorEndIndex = null, primaryCurrency = null) {
    if (!allRows.length) return null;
    const primaryBounds = getCurrencyDateIndexBounds(primaryCurrency || getSelectedPairCurrencies().primary);
    const minIndex = primaryBounds?.minIndex ?? 0;
    const maxIndex = primaryBounds?.maxIndex ?? Math.max(0, allRows.length - 1);
    const todayIso = getLocalTodayIso();
    let endIndex = Number.isFinite(anchorEndIndex)
      ? Math.max(0, Math.min(maxIndex, anchorEndIndex))
      : getDateIndexOnOrBefore(todayIso);
    if (endIndex < 0) endIndex = maxIndex;
    endIndex = Math.max(minIndex, endIndex);

    if (presetKey === "full") {
      return { startIndex: minIndex, endIndex: maxIndex };
    }

    if (presetKey === "ytd") {
      const year = todayIso.slice(0, 4);
      const startIsoTarget = `${year}-01-01`;
      const startIndex = Math.max(minIndex, Math.min(endIndex, getDateIndexOnOrAfter(startIsoTarget)));
      return { startIndex, endIndex };
    }

    const yearsByPreset = {
      "1y": 1,
      "2y": 2,
      "4y": 4,
      "8y": 8,
    };
    const years = yearsByPreset[presetKey];
    if (!years) return null;

    const startIsoTarget = shiftIsoByYearsPreservingDate(todayIso, -years, {
      leapDayToFeb28: years === 1 || years === 2,
    });
    let startIndex = getDateIndexOnOrAfter(startIsoTarget);
    if (startIndex < 0) startIndex = minIndex;
    startIndex = Math.max(minIndex, startIndex);
    startIndex = Math.min(startIndex, endIndex);
    return { startIndex, endIndex };
  }

  function getMatchingRangePresetKey(startIso, endIso, primaryCurrency = null) {
    if (!allRows.length || !startIso || !endIso) return "";
    let startIndex = getDateIndexFromIso(startIso);
    let endIndex = getDateIndexFromIso(endIso);
    const maxIndex = Math.max(0, allRows.length - 1);
    if (startIndex < 0) startIndex = getDateIndexOnOrAfter(startIso);
    if (endIndex < 0) endIndex = getDateIndexOnOrBefore(endIso);
    if (startIndex < 0) startIndex = 0;
    if (endIndex < 0) endIndex = maxIndex;

    for (const key of RANGE_PRESET_KEYS) {
      const preset = getPresetDateIndices(key, null, primaryCurrency);
      if (!preset) continue;
      if (preset.startIndex === startIndex && preset.endIndex === endIndex) return key;
    }
    return "";
  }

  function updateRangePresetActiveState() {
    if (!el.dateRangePresets || !allRows.length) return;
    const buttons = Array.from(el.dateRangePresets.querySelectorAll(".date-range-preset-btn[data-range]"));
    if (!buttons.length) return;

    const startIso = String(requestedDateRange.startIso || el.startDateInput?.value || "").trim();
    const endIso = String(requestedDateRange.endIso || el.endDateInput?.value || "").trim();
    const activeKey = getMatchingRangePresetKey(startIso, endIso);

    buttons.forEach((btn) => {
      const isActive = String(btn.dataset.range || "").toLowerCase() === activeKey;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  function applyRangePreset(presetKey) {
    stopDateRangePlayback();
    if (!allRows.length || !el.startDateInput || !el.endDateInput) return;
    const todayIso = getLocalTodayIso();
    let endIndex = getDateIndexOnOrBefore(todayIso);
    if (endIndex < 0) endIndex = Math.max(0, allRows.length - 1);

    const preset = getPresetDateIndices(String(presetKey || "").toLowerCase(), endIndex);
    if (!preset) return;

    let { startIndex, endIndex: nextEndIndex } = preset;
    const maxIndex = Math.max(0, allRows.length - 1);
    startIndex = Math.max(0, Math.min(maxIndex, startIndex));
    nextEndIndex = Math.max(0, Math.min(maxIndex, nextEndIndex));

    if (maxIndex >= 1 && startIndex >= nextEndIndex) {
      if (startIndex >= maxIndex) {
        startIndex = Math.max(0, maxIndex - 1);
        nextEndIndex = maxIndex;
      } else {
        nextEndIndex = Math.min(maxIndex, startIndex + 1);
      }
    }

    const startIso = toIsoDate(allRows[startIndex].date);
    const endIso = String(presetKey || "").toLowerCase() === "full"
      ? toIsoDate(allRows[nextEndIndex].date)
      : todayIso;
    setRequestedDateRange(startIso, endIso);
    el.startDateInput.value = startIso;
    el.endDateInput.value = endIso;
    applyRequestedDateRangeToControls();
    applyFilters();
  }

  function parseDateRangeDaysValue(value) {
    const parsed = Number.parseInt(String(value || "").replace(/[^\d]/g, ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function formatDateRangeDaysValue(value) {
    const dayCount = parseDateRangeDaysValue(value);
    return dayCount > 0 ? dayCount.toLocaleString("en-US") : "";
  }

  function applyDateRangeDayCount(dayCount) {
    stopDateRangePlayback();
    if (!allRows.length || !el.startDateInput || !el.endDateInput) return;
    const controlBounds = getDateRangeControlBounds();
    const safeMinIndex = controlBounds?.minIndex ?? 0;
    const safeMaxIndex = controlBounds?.maxIndex ?? Math.max(0, allRows.length - 1);
    if (safeMaxIndex < safeMinIndex) return;

    const desiredDays = Math.max(1, Math.round(Number(dayCount) || 1));
    let endIndex = getDateIndexOnOrBefore(el.endDateInput.value || requestedDateRange.endIso || toIsoDate(allRows[safeMaxIndex].date));
    if (endIndex < 0) endIndex = safeMaxIndex;
    endIndex = Math.max(safeMinIndex, Math.min(safeMaxIndex, endIndex));

    let startIndex = endIndex - desiredDays + 1;
    if (startIndex < safeMinIndex) {
      startIndex = safeMinIndex;
      endIndex = Math.min(safeMaxIndex, startIndex + desiredDays - 1);
    }
    if (endIndex > safeMaxIndex) {
      endIndex = safeMaxIndex;
      startIndex = Math.max(safeMinIndex, endIndex - desiredDays + 1);
    }
    startIndex = Math.max(safeMinIndex, Math.min(safeMaxIndex, startIndex));
    endIndex = Math.max(startIndex, Math.min(safeMaxIndex, endIndex));

    const startIso = toIsoDate(allRows[startIndex].date);
    const endIso = toIsoDate(allRows[endIndex].date);
    setRequestedDateRange(startIso, endIso);
    el.startDateInput.value = startIso;
    el.endDateInput.value = endIso;
    applyRequestedDateRangeToControls();
    applyFilters();
  }

  function commitDateRangeDaysInput() {
    const input = el.dateRangeDaysInput;
    if (!input) return;
    const dayCount = parseDateRangeDaysValue(input.value);
    if (!dayCount) {
      const fallback = Number.parseInt(input.dataset.lastValidValue || "0", 10);
      input.value = fallback > 0 ? fallback.toLocaleString("en-US") : "";
      return;
    }
    applyDateRangeDayCount(dayCount);
  }

  function selectDateRangeDaysInput(input) {
    if (!input) return;
    window.setTimeout(() => {
      input.select();
    }, 0);
  }

  function getCaretIndexForDigitPosition(value, digitCount) {
    if (digitCount <= 0) return 0;
    let seenDigits = 0;
    for (let i = 0; i < value.length; i += 1) {
      if (!/\d/.test(value[i])) continue;
      seenDigits += 1;
      if (seenDigits >= digitCount) return i + 1;
    }
    return value.length;
  }

  function handleDateRangeDaysInput() {
    const input = el.dateRangeDaysInput;
    if (!input) return;
    const rawValue = String(input.value || "");
    const rawCaret = Number.isFinite(input.selectionStart) ? input.selectionStart : rawValue.length;
    const digitsBeforeCaret = rawValue.slice(0, rawCaret).replace(/\D/g, "").length;
    const dayCount = parseDateRangeDaysValue(input.value);
    const formattedValue = formatDateRangeDaysValue(input.value);
    input.value = formattedValue;
    if (document.activeElement === input) {
      const nextCaret = getCaretIndexForDigitPosition(formattedValue, digitsBeforeCaret);
      input.setSelectionRange(nextCaret, nextCaret);
    }
    if (dayCount > 0) {
      applyDateRangeDayCount(dayCount);
    }
  }

  function bindRangePresetButtons() {
    if (!el.dateRangePresets) return;
    const buttons = Array.from(el.dateRangePresets.querySelectorAll(".date-range-preset-btn[data-range]"));
    buttons.forEach((btn) => {
      if (btn.dataset.bound === "1") return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        const key = String(btn.dataset.range || "").toLowerCase();
        applyRangePreset(key);
      });
    });
  }

  function bindDateRangeDaysInput() {
    const input = el.dateRangeDaysInput;
    if (!input || input.dataset.bound === "1") return;
    input.dataset.bound = "1";
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitDateRangeDaysInput();
        input.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        const fallback = Number.parseInt(input.dataset.lastValidValue || "0", 10);
        input.value = fallback > 0 ? fallback.toLocaleString("en-US") : "";
        input.blur();
      }
    });
    input.addEventListener("focus", () => selectDateRangeDaysInput(input));
    input.addEventListener("click", () => selectDateRangeDaysInput(input));
    input.addEventListener("input", handleDateRangeDaysInput);
    input.addEventListener("blur", commitDateRangeDaysInput);
  }

  function getSelectedDateRangePlaybackFps() {
    const triggerFps = Number(el.dateRangeFpsTrigger?.dataset.fps);
    if (Number.isFinite(triggerFps) && triggerFps > 0) return triggerFps;
    return DEFAULT_RANGE_PLAYBACK_FPS;
  }

  function getPlaybackSpeedLabel(fps) {
    const speed = (Number(fps) || DEFAULT_RANGE_PLAYBACK_FPS) / DEFAULT_RANGE_PLAYBACK_FPS;
    if (Math.abs(speed - 0.5) < 0.001) return "0.5x";
    if (Math.abs(speed - 1) < 0.001) return "1x";
    if (Math.abs(speed - 2) < 0.001) return "2x";
    if (Math.abs(speed - 4) < 0.001) return "4x";
    return `${Number(speed.toFixed(2))}x`;
  }

  function getPlaybackSpeedMultiplier(fps) {
    const speed = (Number(fps) || DEFAULT_RANGE_PLAYBACK_FPS) / DEFAULT_RANGE_PLAYBACK_FPS;
    return Number.isFinite(speed) && speed > 0 ? speed : 1;
  }

  function getNextDateRangePlaybackFps(currentFps) {
    const current = Number(currentFps);
    const index = DATE_RANGE_PLAYBACK_FPS_OPTIONS.findIndex((fps) => fps === current);
    const nextIndex = index >= 0 ? (index + 1) % DATE_RANGE_PLAYBACK_FPS_OPTIONS.length : 0;
    return DATE_RANGE_PLAYBACK_FPS_OPTIONS[nextIndex] || DEFAULT_RANGE_PLAYBACK_FPS;
  }

  function buildDateRangeExportFrameIndices(startIndex, endIndex, playbackFps, includeEndFrameHold = true) {
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
    const indices = [];
    let frameNumber = 0;
    let lastIndex = null;

    while (true) {
      const offset = Math.floor(frameNumber * speed);
      if (offset > span) break;
      const index = start + offset;
      indices.push(index);
      lastIndex = index;
      frameNumber += 1;
      if (frameNumber > (span / speed) + DATE_RANGE_EXPORT_VIDEO_FPS + 2) break;
    }

    if (lastIndex !== end) indices.push(end);
    const motionFrames = indices.length ? indices : [start, end];
    frames.push(...motionFrames);
    frames.push(...Array.from({ length: endHoldFrames }, () => end));
    return frames.length ? frames : [start, end];
  }

  function formatDownloadEstimateDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "--";
    const rounded = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(rounded / 60);
    const secs = rounded % 60;
    if (minutes <= 0) return `${secs}s`;
    return `${minutes}m ${String(secs).padStart(2, "0")}s`;
  }

  function formatDownloadEstimateSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "--";
    const mib = bytes / (1024 * 1024);
    if (mib < 10) return `${mib.toFixed(1)} MB`;
    return `${Math.round(mib)} MB`;
  }

  function getDateRangeExportEstimateRange() {
    if (!allRows.length || !el.dateRangeStartSlider || !el.dateRangeEndSlider) return null;
    const maxIndex = Math.max(0, allRows.length - 1);
    const playbackStart = Number(dateRangePlaybackState.startIndex);
    const playbackEnd = Number(dateRangePlaybackState.targetEndIndex);
    const sliderStart = Number(el.dateRangeStartSlider.value);
    const sliderEnd = Number(el.dateRangeEndSlider.value);
    const rawStart = dateRangePlaybackState.hasSession && Number.isFinite(playbackStart)
      ? playbackStart
      : sliderStart;
    const rawEnd = dateRangePlaybackState.hasSession && Number.isFinite(playbackEnd)
      ? playbackEnd
      : sliderEnd;
    const startIndex = Math.max(0, Math.min(maxIndex, Number.isFinite(rawStart) ? rawStart : 0));
    const endIndex = Math.max(startIndex, Math.min(maxIndex, Number.isFinite(rawEnd) ? rawEnd : maxIndex));
    return { startIndex, endIndex };
  }

  function getDateRangeExportBitrate(settings) {
    return Math.max(4_000_000, Number(settings.quality) * 8000);
  }

  function updateDownloadEstimates() {
    if (!el.downloadEstimateSize || !el.downloadEstimateLength || !el.downloadEstimateTime) return;
    const range = getDateRangeExportEstimateRange();
    if (!range) {
      el.downloadEstimateSize.textContent = "--";
      el.downloadEstimateLength.textContent = "--";
      el.downloadEstimateTime.textContent = "--";
      return;
    }
    const settings = normalizeDownloadSettings(readDownloadSettingsControls());
    const selectedPlaybackFps = Math.max(1, Number(settings.fps) || getSelectedDateRangePlaybackFps());
    const frameIndices = buildDateRangeExportFrameIndices(range.startIndex, range.endIndex, selectedPlaybackFps, settings.endFrameHold);
    const uniqueFrameCount = new Set(frameIndices).size;
    const videoSeconds = frameIndices.length / DATE_RANGE_EXPORT_VIDEO_FPS;
    const bitrate = getDateRangeExportBitrate(settings);
    const extensionMultiplier = settings.extension === "webm" ? 0.78 : 1;
    const estimatedBytes = (bitrate * videoSeconds / 8) * extensionMultiplier;
    const renderSeconds = Math.max(1, uniqueFrameCount * 0.035);
    const processingSeconds = videoSeconds + renderSeconds;
    el.downloadEstimateSize.textContent = formatDownloadEstimateSize(estimatedBytes);
    el.downloadEstimateLength.textContent = formatDownloadEstimateDuration(videoSeconds);
    el.downloadEstimateTime.textContent = `~${formatDownloadEstimateDuration(processingSeconds)}`;
  }

  function getExportThemePalette(theme) {
    return EXPORT_THEME_PALETTES[theme === "dark" ? "dark" : "light"];
  }

  function getCurrentDashboardTheme() {
    return document.documentElement.dataset.theme === "light" ? "light" : "dark";
  }

  function getDashboardCssValue(name, fallback = "") {
    if (isRenderingDateRangeExportFrame && activeDateRangeExportTheme) {
      return getExportThemePalette(activeDateRangeExportTheme)[name] || fallback;
    }
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function getDashboardRenderTheme() {
    if (isRenderingDateRangeExportFrame && activeDateRangeExportTheme) {
      return activeDateRangeExportTheme === "light" ? "light" : "dark";
    }
    return getCurrentDashboardTheme();
  }

  function getCurrencyAccentColor(currencyCode, fallbackCssVarName, fallbackColor) {
    const code = String(currencyCode || "").toUpperCase();
    const theme = getDashboardRenderTheme();
    const metalColors = MONETARY_METAL_COLORS[theme] || MONETARY_METAL_COLORS.dark;
    if (YELLOW_METAL_CURRENCIES.has(code)) return metalColors.yellow;
    if (SILVER_METAL_CURRENCIES.has(code)) return metalColors.silver;
    return getDashboardCssValue(fallbackCssVarName, fallbackColor);
  }

  function getChartAccentColors(primaryCurrency, secondaryCurrency) {
    if (secondaryCurrency === "BTC") {
      return {
        left: getCurrencyAccentColor(primaryCurrency, "--right", "#34d399"),
        right: getCurrencyAccentColor(secondaryCurrency, "--left", "#ff9f1c"),
      };
    }
    return {
      left: getCurrencyAccentColor(primaryCurrency, "--left", "#ff9f1c"),
      right: getCurrencyAccentColor(secondaryCurrency, "--right", "#34d399"),
    };
  }

  function getDashboardScaleMode() {
    return el.scaleSelect?.value === "linear" ? "linear" : "log";
  }

  function normalizeScaleMode(value, fallback = "log") {
    if (value === "linear" || value === "log") return value;
    return fallback === "linear" ? "linear" : "log";
  }

  function normalizeDownloadSettings(settings = {}) {
    const chartMode = ["both", "left", "right"].includes(settings.chartMode) ? settings.chartMode : DEFAULT_DOWNLOAD_SETTINGS.chartMode;
    const rawExtension = settings.extension === "gif" ? "webm" : settings.extension;
    const extension = rawExtension === "webm" ? "webm" : DEFAULT_DOWNLOAD_SETTINGS.extension;
    const quality = ["720", "1080", "1440", "2160"].includes(String(settings.quality)) ? String(settings.quality) : DEFAULT_DOWNLOAD_SETTINGS.quality;
    const orientation = ["landscape", "portrait", "square"].includes(settings.orientation) ? settings.orientation : DEFAULT_DOWNLOAD_SETTINGS.orientation;
    const theme = settings.theme === "dark" ? "dark" : settings.theme === "light" ? "light" : getCurrentDashboardTheme();
    const fallbackScale = normalizeScaleMode(settings.scaleMode, getDashboardScaleMode());
    const leftScale = normalizeScaleMode(settings.leftScale, fallbackScale);
    const rightScale = normalizeScaleMode(settings.rightScale, fallbackScale);
    const rawFps = Number(settings.fps);
    const fps = Number.isFinite(rawFps) && rawFps > 0
      ? String(rawFps)
      : String(getSelectedDateRangePlaybackFps());
    const endFrameHold = settings.endFrameHold !== false;
    return { chartMode, extension, quality, orientation, theme, fps, leftScale, rightScale, endFrameHold };
  }

  function loadDownloadSettings() {
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(UOA_DOWNLOAD_SETTINGS_KEY) || "null");
    } catch (_) {
      stored = null;
    }
    downloadSettingsHasStoredValue = !!stored && typeof stored === "object";
    downloadSettings = normalizeDownloadSettings(stored || DEFAULT_DOWNLOAD_SETTINGS);
    syncDownloadSettingsControls();
  }

  function getDownloadSettingGroupValue(group) {
    if (group === el.downloadChartModeSelect) {
      const leftSelected = !!group.querySelector('.download-setting-option.is-selected[data-value="left"]');
      const rightSelected = !!group.querySelector('.download-setting-option.is-selected[data-value="right"]');
      if (leftSelected && rightSelected) return "both";
      if (leftSelected) return "left";
      if (rightSelected) return "right";
      return DEFAULT_DOWNLOAD_SETTINGS.chartMode;
    }
    const selected = group?.querySelector?.(".download-setting-option.is-selected[data-value]");
    return selected?.dataset.value || "";
  }

  function setDownloadSettingGroupValue(group, value) {
    if (!group) return;
    const buttons = Array.from(group.querySelectorAll(".download-setting-option[data-value]"));
    if (group === el.downloadChartModeSelect) {
      const mode = ["both", "left", "right"].includes(value) ? value : DEFAULT_DOWNLOAD_SETTINGS.chartMode;
      buttons.forEach((button) => {
        const isSelected = mode === "both" || button.dataset.value === mode;
        button.classList.toggle("is-selected", isSelected);
        button.setAttribute("aria-pressed", isSelected ? "true" : "false");
      });
      return;
    }
    buttons.forEach((button) => {
      const isSelected = button.dataset.value === String(value);
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-pressed", isSelected ? "true" : "false");
    });
  }

  function toggleDownloadChartModeButton(button) {
    const group = el.downloadChartModeSelect;
    if (!group || !button) return;
    const nextSelected = !button.classList.contains("is-selected");
    button.classList.toggle("is-selected", nextSelected);
    button.setAttribute("aria-pressed", nextSelected ? "true" : "false");

    const leftButton = group.querySelector('.download-setting-option[data-value="left"]');
    const rightButton = group.querySelector('.download-setting-option[data-value="right"]');
    const leftSelected = !!leftButton?.classList.contains("is-selected");
    const rightSelected = !!rightButton?.classList.contains("is-selected");
    if (!leftSelected && !rightSelected) {
      const fallbackButton = button.dataset.value === "left" ? rightButton : leftButton;
      if (fallbackButton) {
        fallbackButton.classList.add("is-selected");
        fallbackButton.setAttribute("aria-pressed", "true");
      }
    }
    syncDownloadScaleAvailability();
  }

  function syncDownloadScaleAvailability() {
    if (!el.downloadChartModeSelect) return;
    const syncSide = (side, group) => {
      if (!group) return;
      const chartButton = el.downloadChartModeSelect.querySelector(`.download-setting-option[data-value="${side}"]`);
      const isEnabled = !!chartButton?.classList.contains("is-selected");
      group.classList.toggle("is-disabled", !isEnabled);
      group.querySelectorAll(".download-setting-option[data-value]").forEach((button) => {
        button.disabled = !isEnabled;
        button.setAttribute("aria-disabled", isEnabled ? "false" : "true");
      });
    };
    syncSide("left", el.downloadLeftScaleSelect);
    syncSide("right", el.downloadRightScaleSelect);
  }

  function getDownloadChartModeLabels() {
    const primary = (el.primaryUoaSelect?.value || "BTC").toUpperCase();
    const secondary = (el.secondaryUoaSelect?.value || "USD").toUpperCase();
    return {
      left: `${secondary}${primary}`,
      right: `${primary}${secondary}`,
    };
  }

  function syncDownloadChartModeLabels() {
    if (!el.downloadChartModeSelect) return;
    const primary = el.primaryUoaSelect?.value || "BTC";
    const secondary = el.secondaryUoaSelect?.value || "USD";
    const chartColors = getChartAccentColors(primary, secondary);
    const labels = getDownloadChartModeLabels();
    const leftButton = el.downloadChartModeSelect.querySelector('.download-setting-option[data-value="left"]');
    const rightButton = el.downloadChartModeSelect.querySelector('.download-setting-option[data-value="right"]');
    if (leftButton) {
      leftButton.textContent = labels.left;
      leftButton.style.setProperty("--download-chart-left", chartColors.left);
    }
    if (rightButton) {
      rightButton.textContent = labels.right;
      rightButton.style.setProperty("--download-chart-right", chartColors.right);
    }
    if (el.downloadLeftScaleSelect) el.downloadLeftScaleSelect.style.setProperty("--download-chart-left", chartColors.left);
    if (el.downloadRightScaleSelect) el.downloadRightScaleSelect.style.setProperty("--download-chart-right", chartColors.right);
    syncDownloadScaleAvailability();
  }

  function getVisibleChartMode() {
    if (!el.dateRangeChartToggles) return "both";
    const leftSelected = !!el.dateRangeChartToggles.querySelector('.date-range-chart-toggle-btn.is-active[data-value="left"]');
    const rightSelected = !!el.dateRangeChartToggles.querySelector('.date-range-chart-toggle-btn.is-active[data-value="right"]');
    if (leftSelected && rightSelected) return "both";
    if (leftSelected) return "left";
    if (rightSelected) return "right";
    return "both";
  }

  function setVisibleChartMode(mode) {
    if (!el.dateRangeChartToggles) return;
    const normalized = ["left", "right", "both"].includes(String(mode || "")) ? String(mode) : "both";
    const leftButton = el.dateRangeChartToggles.querySelector('.date-range-chart-toggle-btn[data-value="left"]');
    const rightButton = el.dateRangeChartToggles.querySelector('.date-range-chart-toggle-btn[data-value="right"]');
    const leftActive = normalized !== "right";
    const rightActive = normalized !== "left";
    if (leftButton) {
      leftButton.classList.toggle("is-active", leftActive);
      leftButton.setAttribute("aria-pressed", leftActive ? "true" : "false");
    }
    if (rightButton) {
      rightButton.classList.toggle("is-active", rightActive);
      rightButton.setAttribute("aria-pressed", rightActive ? "true" : "false");
    }
    applyVisibleChartMode();
  }

  function applyVisibleChartMode() {
    if (!el.chartGrid) return;
    const mode = getVisibleChartMode();
    el.chartGrid.classList.toggle("chart-view-left", mode === "left");
    el.chartGrid.classList.toggle("chart-view-right", mode === "right");
    el.chartGrid.classList.toggle("chart-view-both", mode === "both");
  }

  function syncDateRangeChartToggleLabels() {
    if (!el.dateRangeChartToggles) return;
    const primary = el.primaryUoaSelect?.value || "BTC";
    const secondary = el.secondaryUoaSelect?.value || "USD";
    const chartColors = getChartAccentColors(primary, secondary);
    const labels = getDownloadChartModeLabels();
    const leftButton = el.dateRangeChartToggles.querySelector('.date-range-chart-toggle-btn[data-value="left"]');
    const rightButton = el.dateRangeChartToggles.querySelector('.date-range-chart-toggle-btn[data-value="right"]');
    if (leftButton) {
      leftButton.textContent = labels.left;
      leftButton.style.setProperty("--date-range-chart-left", chartColors.left);
    }
    if (rightButton) {
      rightButton.textContent = labels.right;
      rightButton.style.setProperty("--date-range-chart-right", chartColors.right);
    }
    applyVisibleChartMode();
  }

  function toggleVisibleChartButton(button) {
    if (!el.dateRangeChartToggles || !button) return;
    const buttons = Array.from(el.dateRangeChartToggles.querySelectorAll(".date-range-chart-toggle-btn[data-value]"));
    const nextSelected = !button.classList.contains("is-active");
    button.classList.toggle("is-active", nextSelected);
    button.setAttribute("aria-pressed", nextSelected ? "true" : "false");
    const leftButton = el.dateRangeChartToggles.querySelector('.date-range-chart-toggle-btn[data-value="left"]');
    const rightButton = el.dateRangeChartToggles.querySelector('.date-range-chart-toggle-btn[data-value="right"]');
    const leftSelected = !!leftButton?.classList.contains("is-active");
    const rightSelected = !!rightButton?.classList.contains("is-active");
    if (!leftSelected && !rightSelected) {
      const fallbackButton = button === leftButton ? rightButton : leftButton;
      if (fallbackButton) {
        fallbackButton.classList.add("is-active");
        fallbackButton.setAttribute("aria-pressed", "true");
      }
    }
    buttons.forEach((item) => {
      item.setAttribute("aria-pressed", item.classList.contains("is-active") ? "true" : "false");
    });
    applyVisibleChartMode();
    persistFilters();
    requestAnimationFrame(renderAll);
  }

  function syncDownloadSettingsControls() {
    const normalized = normalizeDownloadSettings(downloadSettings);
    downloadSettings = normalized;
    syncDownloadChartModeLabels();
    setDownloadSettingGroupValue(el.downloadChartModeSelect, normalized.chartMode);
    setDownloadSettingGroupValue(el.downloadQualitySelect, normalized.quality);
    setDownloadSettingGroupValue(el.downloadOrientationSelect, normalized.orientation);
    setDownloadSettingGroupValue(el.downloadThemeSelect, normalized.theme);
    setDownloadSettingGroupValue(el.downloadFpsSelect, normalized.fps);
    setDownloadSettingGroupValue(el.downloadLeftScaleSelect, normalized.leftScale);
    setDownloadSettingGroupValue(el.downloadRightScaleSelect, normalized.rightScale);
    if (el.downloadEndFrameHoldToggle) el.downloadEndFrameHoldToggle.checked = !!normalized.endFrameHold;
    syncDownloadScaleAvailability();
    updateDownloadEstimates();
  }

  function readDownloadSettingsControls() {
    return normalizeDownloadSettings({
      chartMode: getDownloadSettingGroupValue(el.downloadChartModeSelect),
      extension: "webm",
      quality: getDownloadSettingGroupValue(el.downloadQualitySelect),
      orientation: getDownloadSettingGroupValue(el.downloadOrientationSelect),
      theme: getDownloadSettingGroupValue(el.downloadThemeSelect),
      fps: getDownloadSettingGroupValue(el.downloadFpsSelect),
      leftScale: getDownloadSettingGroupValue(el.downloadLeftScaleSelect),
      rightScale: getDownloadSettingGroupValue(el.downloadRightScaleSelect),
      endFrameHold: el.downloadEndFrameHoldToggle ? el.downloadEndFrameHoldToggle.checked : true,
    });
  }

  function saveDownloadSettings(nextSettings) {
    downloadSettings = normalizeDownloadSettings(nextSettings);
    downloadSettingsHasStoredValue = true;
    syncDownloadSettingsControls();
    try {
      localStorage.setItem(UOA_DOWNLOAD_SETTINGS_KEY, JSON.stringify(downloadSettings));
    } catch (_) {
      // Ignore storage failures.
    }
    updateDownloadEstimates();
  }

  function setDateRangePlaybackFps(nextFps) {
    const normalizedFps = Number.isFinite(Number(nextFps)) ? Number(nextFps) : DEFAULT_RANGE_PLAYBACK_FPS;
    if (el.dateRangeFpsTrigger) {
      el.dateRangeFpsTrigger.dataset.fps = String(normalizedFps);
      el.dateRangeFpsTrigger.textContent = getPlaybackSpeedLabel(normalizedFps);
    }
    dateRangePlaybackState.fps = normalizedFps;
    if (!downloadSettingsHasStoredValue && el.downloadFpsSelect && !el.dateRangeDownloadSettingsMenu?.classList.contains("open")) {
      downloadSettings.fps = String(normalizedFps);
      setDownloadSettingGroupValue(el.downloadFpsSelect, normalizedFps);
    }
    updateDownloadEstimates();
  }

  function closeDownloadSettingsMenu({ restoreControls = false } = {}) {
    if (el.dateRangeDownloadSettingsMenu) {
      el.dateRangeDownloadSettingsMenu.classList.remove("open");
      el.dateRangeDownloadSettingsMenu.style.removeProperty("--download-settings-menu-shift-x");
    }
    if (el.dateRangeDownloadSettingsBtn) {
      el.dateRangeDownloadSettingsBtn.classList.remove("is-open");
      el.dateRangeDownloadSettingsBtn.setAttribute("aria-expanded", "false");
    }
    if (dateRangeDownloadSettingsOutsideHandler) {
      document.removeEventListener("pointerdown", dateRangeDownloadSettingsOutsideHandler, true);
      dateRangeDownloadSettingsOutsideHandler = null;
    }
    if (dateRangeDownloadSettingsViewportHandler) {
      window.removeEventListener("resize", dateRangeDownloadSettingsViewportHandler);
      window.removeEventListener("scroll", dateRangeDownloadSettingsViewportHandler, true);
      dateRangeDownloadSettingsViewportHandler = null;
    }
    if (restoreControls) syncDownloadSettingsControls();
  }

  function constrainDownloadSettingsMenuToViewport() {
    const menu = el.dateRangeDownloadSettingsMenu;
    if (!menu?.classList.contains("open")) return;
    menu.style.setProperty("--download-settings-menu-shift-x", "0px");
    const rect = menu.getBoundingClientRect();
    const margin = 8;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || rect.right;
    let shiftX = 0;
    if (rect.left < margin) {
      shiftX = margin - rect.left;
    } else if (rect.right > viewportWidth - margin) {
      shiftX = (viewportWidth - margin) - rect.right;
    }
    menu.style.setProperty("--download-settings-menu-shift-x", `${Math.round(shiftX)}px`);
  }

  function openDownloadSettingsMenu() {
    if (!el.dateRangeDownloadSettingsMenu || !el.dateRangeDownloadSettingsBtn) return;
    syncDownloadSettingsControls();
    syncDownloadSettingsDownloadButton();
    el.dateRangeDownloadSettingsMenu.classList.add("open");
    el.dateRangeDownloadSettingsBtn.classList.add("is-open");
    el.dateRangeDownloadSettingsBtn.setAttribute("aria-expanded", "true");
    constrainDownloadSettingsMenuToViewport();
    if (!dateRangeDownloadSettingsViewportHandler) {
      dateRangeDownloadSettingsViewportHandler = () => constrainDownloadSettingsMenuToViewport();
      window.addEventListener("resize", dateRangeDownloadSettingsViewportHandler);
      window.addEventListener("scroll", dateRangeDownloadSettingsViewportHandler, true);
    }
    if (!dateRangeDownloadSettingsOutsideHandler) {
      dateRangeDownloadSettingsOutsideHandler = (event) => {
        const target = event.target;
        const inTrigger = target === el.dateRangeDownloadSettingsBtn || el.dateRangeDownloadSettingsBtn.contains(target);
        const inMenu = target === el.dateRangeDownloadSettingsMenu || el.dateRangeDownloadSettingsMenu.contains(target);
        if (inTrigger || inMenu) return;
        closeDownloadSettingsMenu({ restoreControls: true });
      };
      document.addEventListener("pointerdown", dateRangeDownloadSettingsOutsideHandler, true);
    }
  }

  function toggleDownloadSettingsMenu() {
    if (!el.dateRangeDownloadSettingsMenu) return;
    if (el.dateRangeDownloadSettingsMenu.classList.contains("open")) {
      closeDownloadSettingsMenu({ restoreControls: true });
      return;
    }
    openDownloadSettingsMenu();
  }

  function renderDateRangeDownloadButtonProgress(progress = 0) {
    if (!el.dateRangeDownloadBtn) return;
    const progressPct = `${Math.max(0, Math.min(1, Number(progress) || 0)) * 100}%`;
    const progressEl = el.dateRangeDownloadBtn.querySelector(".date-range-export-progress");
    if (el.dateRangeDownloadBtn.classList.contains("is-exporting") && progressEl) {
      progressEl.style.setProperty("--date-range-export-progress", progressPct);
      return;
    }
    el.dateRangeDownloadBtn.classList.add("is-exporting");
    el.dateRangeDownloadBtn.disabled = false;
    el.dateRangeDownloadBtn.setAttribute("aria-label", "Cancel animation download");
    el.dateRangeDownloadBtn.setAttribute("title", "Cancel download");
    el.dateRangeDownloadBtn.innerHTML = [
      `<span class="date-range-export-progress" style="--date-range-export-progress: ${progressPct}" aria-hidden="true">`,
      '<span class="date-range-export-stop-square"></span>',
      "</span>",
    ].join("");
    syncDownloadSettingsDownloadButton();
  }

  function resetDateRangeDownloadButton() {
    if (!el.dateRangeDownloadBtn) return;
    el.dateRangeDownloadBtn.classList.remove("is-exporting", "is-canceling");
    el.dateRangeDownloadBtn.disabled = false;
    el.dateRangeDownloadBtn.setAttribute("aria-label", "Download date range animation");
    el.dateRangeDownloadBtn.setAttribute("title", "Download animation");
    el.dateRangeDownloadBtn.textContent = "↓";
    syncDownloadSettingsDownloadButton();
  }

  function syncDownloadSettingsDownloadButton() {
    if (!el.downloadSettingsDownloadBtn) return;
    el.downloadSettingsDownloadBtn.classList.toggle("is-stop-download", isDateRangeExporting);
    el.downloadSettingsDownloadBtn.textContent = isDateRangeExporting ? "Stop Download" : "Download Animation";
  }

  function requestDateRangeExportCancel() {
    if (!isDateRangeExporting) return;
    dateRangeExportCancelRequested = true;
    if (el.dateRangeDownloadBtn) {
      el.dateRangeDownloadBtn.classList.add("is-canceling");
      el.dateRangeDownloadBtn.setAttribute("aria-label", "Canceling animation download");
      el.dateRangeDownloadBtn.setAttribute("title", "Canceling download");
    }
    syncDownloadSettingsDownloadButton();
  }

  function broadcastDateRangeExportActive(active) {
    try {
      window.dateRangeExportActive = !!active;
      if (window.parent && window.parent !== window) {
        window.parent.dateRangeExportActive = !!active;
        window.parent.postMessage({ type: "wsb-uoa-date-range-export-active", active: !!active }, window.location.origin);
      }
    } catch (_) {
    }
  }

  function bindDateRangeExportUnloadGuard() {
    if (window.dateRangeExportUnloadGuardBound === true) return;
    window.dateRangeExportUnloadGuardBound = true;
    window.addEventListener("beforeunload", (event) => {
      if (!isDateRangeExporting) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  function getDownloadDimensions(settings) {
    const quality = Number(settings.quality) || 1080;
    if (settings.orientation === "portrait") return { width: quality, height: Math.round(quality * 16 / 9) };
    if (settings.orientation === "square") return { width: quality, height: quality };
    return { width: Math.round(quality * 16 / 9), height: quality };
  }

  function getExportLayoutMetrics(settings) {
    const { width, height } = getDownloadDimensions(settings);
    const panelGap = Math.max(8, Math.round(Math.min(width, height) * 0.012));
    const outerMargin = panelGap;
    const footerHeight = Math.max(34, Math.round(Math.min(width, height) * 0.052));
    return { width, height, outerMargin, panelGap, footerHeight };
  }

  function getExportReferenceLayoutSettings(settings) {
    return { ...settings, quality: "1440" };
  }

  function shouldExportChart(settings, chartSide) {
    const chartMode = settings?.chartMode || DEFAULT_DOWNLOAD_SETTINGS.chartMode;
    return chartMode === "both" || chartMode === chartSide;
  }

  function drawScaledExportFrame(sourceCanvas, targetCanvas, settings) {
    const { width, height } = getDownloadDimensions(settings);
    if (targetCanvas.width !== width) targetCanvas.width = width;
    if (targetCanvas.height !== height) targetCanvas.height = height;
    const ctx = targetCanvas.getContext("2d");
    if (!ctx) return;
    const bg = getExportThemePalette(settings.theme)["--bg"];
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
    ctx.restore();
  }

  function getDateRangeExportBatchSize(settings) {
    const { width, height } = getDownloadDimensions(settings);
    const frameBytes = Math.max(1, width * height * 4);
    const budgetFrames = Math.floor(DATE_RANGE_EXPORT_BATCH_MEMORY_BUDGET / frameBytes);
    return Math.max(
      DATE_RANGE_EXPORT_MIN_BATCH_FRAMES,
      Math.min(DATE_RANGE_EXPORT_MAX_BATCH_FRAMES, budgetFrames)
    );
  }

  function closeDateRangeExportFrames(frameCache) {
    frameCache.forEach((frame) => {
      if (typeof frame?.close === "function") frame.close();
    });
    frameCache.clear();
  }

  function concatUint8Arrays(arrays) {
    const totalLength = arrays.reduce((sum, item) => sum + item.length, 0);
    const out = new Uint8Array(totalLength);
    let offset = 0;
    arrays.forEach((item) => {
      out.set(item, offset);
      offset += item.length;
    });
    return out;
  }

  function ebmlIdBytes(id) {
    const hex = id.toString(16).padStart(2, "0");
    const padded = hex.length % 2 ? `0${hex}` : hex;
    const bytes = new Uint8Array(padded.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Number.parseInt(padded.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  function ebmlSizeBytes(size) {
    if (size < 0x7f) return Uint8Array.of(0x80 | size);
    if (size < 0x3fff) return Uint8Array.of(0x40 | (size >> 8), size & 0xff);
    if (size < 0x1fffff) return Uint8Array.of(0x20 | (size >> 16), (size >> 8) & 0xff, size & 0xff);
    if (size < 0x0fffffff) {
      return Uint8Array.of(
        0x10 | (size >> 24),
        (size >> 16) & 0xff,
        (size >> 8) & 0xff,
        size & 0xff,
      );
    }
    const bytes = new Uint8Array(8);
    bytes[0] = 0x01;
    let value = size;
    for (let i = 7; i >= 1; i -= 1) {
      bytes[i] = value & 0xff;
      value = Math.floor(value / 256);
    }
    return bytes;
  }

  function ebmlUnknownSizeBytes() {
    return Uint8Array.of(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff);
  }

  function ebmlElement(id, data) {
    return concatUint8Arrays([ebmlIdBytes(id), ebmlSizeBytes(data.length), data]);
  }

  function ebmlUint(value, byteLength = 0) {
    let length = byteLength;
    if (!length) {
      length = 1;
      let probe = Math.max(0, Number(value) || 0);
      while (probe > 0xff) {
        length += 1;
        probe = Math.floor(probe / 256);
      }
    }
    const bytes = new Uint8Array(length);
    let next = Math.max(0, Number(value) || 0);
    for (let i = length - 1; i >= 0; i -= 1) {
      bytes[i] = next & 0xff;
      next = Math.floor(next / 256);
    }
    return bytes;
  }

  function ebmlFloat64(value) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, Number(value) || 0, false);
    return bytes;
  }

  function ebmlAscii(value) {
    return new TextEncoder().encode(String(value || ""));
  }

  function webmSimpleBlock(trackNumber, relativeTimecode, keyFrame, data) {
    const header = new Uint8Array(4);
    header[0] = 0x80 | Math.max(1, Math.min(126, trackNumber));
    new DataView(header.buffer).setInt16(1, Math.max(-32768, Math.min(32767, Math.round(relativeTimecode))), false);
    header[3] = keyFrame ? 0x80 : 0x00;
    return ebmlElement(0xa3, concatUint8Arrays([header, data]));
  }

  function buildWebMBlob(encodedFrames, width, height, fps, codecId) {
    const durationSeconds = encodedFrames.length / Math.max(1, fps);
    const ebmlHeader = ebmlElement(0x1a45dfa3, concatUint8Arrays([
      ebmlElement(0x4286, ebmlUint(1)),
      ebmlElement(0x42f7, ebmlUint(1)),
      ebmlElement(0x42f2, ebmlUint(4)),
      ebmlElement(0x42f3, ebmlUint(8)),
      ebmlElement(0x4282, ebmlAscii("webm")),
      ebmlElement(0x4287, ebmlUint(4)),
      ebmlElement(0x4285, ebmlUint(2)),
    ]));
    const info = ebmlElement(0x1549a966, concatUint8Arrays([
      ebmlElement(0x2ad7b1, ebmlUint(1000000)),
      ebmlElement(0x4489, ebmlFloat64(durationSeconds)),
      ebmlElement(0x4d80, ebmlAscii("wickedsmartbitcoin")),
      ebmlElement(0x5741, ebmlAscii("wickedsmartbitcoin")),
    ]));
    const video = ebmlElement(0xe0, concatUint8Arrays([
      ebmlElement(0xb0, ebmlUint(width)),
      ebmlElement(0xba, ebmlUint(height)),
    ]));
    const trackEntry = ebmlElement(0xae, concatUint8Arrays([
      ebmlElement(0xd7, ebmlUint(1)),
      ebmlElement(0x73c5, ebmlUint(1)),
      ebmlElement(0x83, ebmlUint(1)),
      ebmlElement(0x86, ebmlAscii(codecId)),
      ebmlElement(0x258688, ebmlAscii("Unit of Account")),
      video,
    ]));
    const tracks = ebmlElement(0x1654ae6b, trackEntry);
    const clusters = [];
    let clusterStartMs = -1;
    let clusterBlocks = [];
    const flushCluster = () => {
      if (clusterStartMs < 0 || !clusterBlocks.length) return;
      clusters.push(ebmlElement(0x1f43b675, concatUint8Arrays([
        ebmlElement(0xe7, ebmlUint(clusterStartMs)),
        ...clusterBlocks,
      ])));
      clusterStartMs = -1;
      clusterBlocks = [];
    };
    encodedFrames.forEach((frame) => {
      const timeMs = Math.round(frame.timestamp / 1000);
      if (clusterStartMs < 0 || timeMs - clusterStartMs > 30000) {
        flushCluster();
        clusterStartMs = timeMs;
      }
      clusterBlocks.push(webmSimpleBlock(1, timeMs - clusterStartMs, frame.type === "key", frame.data));
    });
    flushCluster();
    const segmentPayload = concatUint8Arrays([info, tracks, ...clusters]);
    const segment = concatUint8Arrays([ebmlIdBytes(0x18538067), ebmlUnknownSizeBytes(), segmentPayload]);
    return new Blob([ebmlHeader, segment], { type: "video/webm" });
  }

  async function getSupportedWebCodecsExportConfig(width, height, settings) {
    if (!window.VideoEncoder || !window.VideoFrame || typeof VideoEncoder.isConfigSupported !== "function") return null;
    const candidates = [
      { codec: "vp09.00.10.08", webmCodecId: "V_VP9" },
      { codec: "vp8", webmCodecId: "V_VP8" },
    ];
    for (const candidate of candidates) {
      const config = {
        codec: candidate.codec,
        width,
        height,
        bitrate: getDateRangeExportBitrate(settings),
        framerate: DATE_RANGE_EXPORT_VIDEO_FPS,
        latencyMode: "quality",
      };
      try {
        const support = await VideoEncoder.isConfigSupported(config);
        if (support?.supported) return { ...candidate, config: support.config || config };
      } catch (_) {
        // Try the next codec.
      }
    }
    return null;
  }

  async function encodeDateRangeAnimationWebM({
    exportCanvas,
    layoutCanvas,
    layoutSettings,
    exportRefs,
    exportSnapshot,
    settings,
    startIndex,
    frameIndices,
  }) {
    const encoderConfig = await getSupportedWebCodecsExportConfig(exportCanvas.width, exportCanvas.height, settings);
    if (!encoderConfig) return null;
    const encodedFrames = [];
    const frameDurationUs = Math.round(1000000 / DATE_RANGE_EXPORT_VIDEO_FPS);
    let frameIndex = 0;
    let encodeError = null;
    const encoder = new VideoEncoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        encodedFrames.push({
          timestamp: chunk.timestamp,
          type: chunk.type,
          data,
        });
      },
      error: (error) => {
        encodeError = error;
      },
    });
    encoder.configure(encoderConfig.config);
    for (const index of frameIndices) {
      if (dateRangeExportCancelRequested) break;
      renderExportFrameToSurface(exportRefs, exportSnapshot, startIndex, index);
      await composeDateRangeExportFrame(layoutCanvas, layoutSettings, exportRefs);
      drawScaledExportFrame(layoutCanvas, exportCanvas, settings);
      const timestamp = frameIndex * frameDurationUs;
      const frame = new VideoFrame(exportCanvas, {
        timestamp,
        duration: frameDurationUs,
      });
      encoder.encode(frame, { keyFrame: frameIndex % DATE_RANGE_EXPORT_VIDEO_FPS === 0 });
      frame.close();
      if (encodeError) throw encodeError;
      frameIndex += 1;
      renderDateRangeDownloadButtonProgress(frameIndex / Math.max(1, frameIndices.length));
      if (encoder.encodeQueueSize > 8) {
        await encoder.flush();
        await waitMs(0);
      } else if (frameIndex % 6 === 0) {
        await waitMs(0);
      }
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
    encoder.close();
    if (dateRangeExportCancelRequested) return null;
    encodedFrames.sort((a, b) => a.timestamp - b.timestamp);
    return buildWebMBlob(encodedFrames, exportCanvas.width, exportCanvas.height, DATE_RANGE_EXPORT_VIDEO_FPS, encoderConfig.webmCodecId);
  }

  async function encodeDateRangeAnimationMp4({
    exportCanvas,
    layoutCanvas,
    layoutSettings,
    exportRefs,
    exportSnapshot,
    settings,
    startIndex,
    frameIndices,
  }) {
    const muxer = window.WSBMp4Muxer;
    if (!muxer?.getSupportedAvcConfig || !muxer?.buildMp4Blob) return null;
    const encoderConfig = await muxer.getSupportedAvcConfig(
      exportCanvas.width,
      exportCanvas.height,
      getDateRangeExportBitrate(settings),
      DATE_RANGE_EXPORT_VIDEO_FPS
    );
    if (!encoderConfig) return null;
    const samples = [];
    const frameDurationUs = Math.round(1000000 / DATE_RANGE_EXPORT_VIDEO_FPS);
    let frameIndex = 0;
    let encodeError = null;
    let avcConfig = null;
    const encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        const description = metadata?.decoderConfig?.description;
        if (description && !avcConfig) avcConfig = new Uint8Array(description);
        samples.push({
          data,
          key: chunk.type === "key",
        });
      },
      error: (error) => {
        encodeError = error;
      },
    });
    encoder.configure(encoderConfig);
    for (const index of frameIndices) {
      if (dateRangeExportCancelRequested) break;
      renderExportFrameToSurface(exportRefs, exportSnapshot, startIndex, index);
      await composeDateRangeExportFrame(layoutCanvas, layoutSettings, exportRefs);
      drawScaledExportFrame(layoutCanvas, exportCanvas, settings);
      const timestamp = frameIndex * frameDurationUs;
      const frame = new VideoFrame(exportCanvas, {
        timestamp,
        duration: frameDurationUs,
      });
      encoder.encode(frame, { keyFrame: frameIndex % DATE_RANGE_EXPORT_VIDEO_FPS === 0 });
      frame.close();
      if (encodeError) throw encodeError;
      frameIndex += 1;
      renderDateRangeDownloadButtonProgress(frameIndex / Math.max(1, frameIndices.length));
      if (encoder.encodeQueueSize > 8) {
        await encoder.flush();
        await waitMs(0);
      } else if (frameIndex % 6 === 0) {
        await waitMs(0);
      }
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
    encoder.close();
    if (dateRangeExportCancelRequested) return null;
    return muxer.buildMp4Blob({
      width: exportCanvas.width,
      height: exportCanvas.height,
      fps: DATE_RANGE_EXPORT_VIDEO_FPS,
      samples,
      avcConfig,
    });
  }

  function transitionMediaRecorder(recorder, eventName, action) {
    return new Promise((resolve, reject) => {
      recorder.addEventListener(eventName, resolve, { once: true });
      recorder.addEventListener("error", () => reject(recorder.error || new Error("Recording failed")), { once: true });
      action();
    });
  }

  function getSupportedDownloadRecorder(requestedExtension) {
    const candidatesByExtension = {
      mp4: [
        { mimeType: "video/mp4;codecs=avc1.42E01E", extension: "mp4" },
        { mimeType: "video/mp4", extension: "mp4" },
      ],
      webm: [
        { mimeType: "video/webm;codecs=vp9", extension: "webm" },
        { mimeType: "video/webm;codecs=vp8", extension: "webm" },
        { mimeType: "video/webm", extension: "webm" },
      ],
    };
    const fallbackCandidates = [
      { mimeType: "video/webm;codecs=vp9", extension: "webm" },
      { mimeType: "video/webm;codecs=vp8", extension: "webm" },
      { mimeType: "video/webm", extension: "webm" },
    ];
    const candidates = [...(candidatesByExtension[requestedExtension] || []), ...fallbackCandidates];
    if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== "function") return null;
    return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate.mimeType)) || null;
  }

  function getDateRangeExportFilename(settings, actualExtension, snapshot = {}) {
    const primary = (snapshot.primaryCurrency || el.primaryUoaSelect?.value || "BTC").toLowerCase();
    const secondary = (snapshot.secondaryCurrency || el.secondaryUoaSelect?.value || "USD").toLowerCase();
    const chartMode = settings.chartMode === "left" || settings.chartMode === "right" ? `-${settings.chartMode}` : "";
    const start = String(snapshot.startIso || el.startDateInput?.value || "start").replaceAll("-", "");
    const end = String(snapshot.endIso || el.endDateInput?.value || "end").replaceAll("-", "");
    return `uoa-${primary}-${secondary}${chartMode}-${start}-${end}-${settings.orientation}-${settings.quality}p.${actualExtension}`;
  }

  function downloadDateRangeExportBlob(blob, extension, settings, snapshot = {}) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = getDateRangeExportFilename(settings, extension, snapshot);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function formatDateEdgeText(isoValue) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoValue || ""))) return "--";
    const [yearRaw, monthRaw, dayRaw] = String(isoValue).split("-");
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return "--";
    const shortYear = String(year).slice(-2).padStart(2, "0");
    return `${month}/${day}/${shortYear}`;
  }

  function drawRoundedExportRect(ctx, x, y, width, height, radius) {
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, width, height, radius);
      return;
    }
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }

  function makeExportElement(tagName, className = "", text = "") {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function createExportSelect(value) {
    const select = document.createElement("select");
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
    select.value = value;
    return select;
  }

  function setExportSelectValue(select, value) {
    if (!select) return;
    if (!Array.from(select.options).some((option) => option.value === value)) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
    select.value = value;
  }

  function createExportRenderSurface(settings) {
    const { width, height, outerMargin, panelGap, footerHeight } = getExportLayoutMetrics(settings);
    const palette = getExportThemePalette(settings.theme);
    const exportFontScale = 1.65;
    const scaleCssPixels = (value) => {
      const numeric = parseFloat(value);
      return Number.isFinite(numeric) ? `${Math.round(numeric * exportFontScale)}px` : value;
    };
    const liveTitleStyle = el.usdBtcTitle ? getComputedStyle(el.usdBtcTitle) : null;
    const liveValueStyle = el.usdBtcBig ? getComputedStyle(el.usdBtcBig) : null;
    const liveSubStyle = el.satUsdText ? getComputedStyle(el.satUsdText) : null;
    const liveDateStyle = el.usdBtcDateEdges ? getComputedStyle(el.usdBtcDateEdges) : null;
    const surface = document.createElement("div");
    surface.className = "uoa-export-surface";
    surface.style.width = `${width}px`;
    surface.style.height = `${Math.max(1, height - footerHeight)}px`;
    surface.style.position = "fixed";
    surface.style.left = "-100000px";
    surface.style.top = "0";
    surface.style.zIndex = "-1";
    surface.style.pointerEvents = "none";
    surface.style.display = "grid";
    const exportBothCharts = settings.chartMode === "both";
    surface.style.gridTemplateColumns = exportBothCharts && settings.orientation === "landscape" ? "repeat(2, minmax(0, 1fr))" : "1fr";
    surface.style.gridTemplateRows = exportBothCharts && settings.orientation !== "landscape" ? "repeat(2, minmax(0, 1fr))" : "1fr";
    surface.style.gap = `${panelGap}px`;
    surface.style.padding = `${outerMargin}px`;
    surface.style.boxSizing = "border-box";
    surface.style.background = palette["--bg"];
    Object.entries(palette).forEach(([name, value]) => {
      surface.style.setProperty(name, value);
    });

    const makePanel = (kind) => {
      const panel = makeExportElement("section", "panel chart-panel");
      panel.style.minWidth = "0";
      panel.style.minHeight = "0";
      panel.style.height = "100%";
      panel.style.background = palette["--panel"];
      panel.style.border = "0";
      panel.style.borderColor = "transparent";
      panel.style.boxShadow = "none";
      const title = makeExportElement("h2", "panel-title");
      const big = makeExportElement("div", `big-value ${kind === "left" ? "sats" : "usd"}`);
      const sub = makeExportElement("div", "sub-value");
      const edges = makeExportElement("div", "chart-date-edges mono");
      const startEdge = makeExportElement("span", "", "--");
      const endEdge = makeExportElement("span", "", "--");
      const chart = document.createElement("canvas");
      chart.width = 1200;
      chart.height = 720;
      if (liveTitleStyle) title.style.fontSize = scaleCssPixels(liveTitleStyle.fontSize);
      if (liveValueStyle) big.style.fontSize = scaleCssPixels(liveValueStyle.fontSize);
      if (liveSubStyle) {
        sub.style.fontSize = scaleCssPixels(liveSubStyle.fontSize);
        sub.style.margin = liveSubStyle.margin;
      }
      if (liveDateStyle) {
        edges.style.fontSize = scaleCssPixels(liveDateStyle.fontSize);
        edges.style.height = scaleCssPixels(liveDateStyle.height);
      }
      title.style.color = palette["--fg"];
      sub.style.color = palette["--fg"];
      edges.style.color = palette["--muted"];
      startEdge.style.color = palette["--muted"];
      endEdge.style.color = palette["--muted"];
      [big, sub, edges, startEdge, endEdge].forEach((node) => {
        node.style.setProperty("font-variant-numeric", "tabular-nums", "important");
        node.style.setProperty("font-feature-settings", "\"tnum\" 1", "important");
        node.style.setProperty("letter-spacing", "0", "important");
        node.style.setProperty("text-rendering", "geometricPrecision");
      });
      edges.append(startEdge, endEdge);
      panel.append(title, big, sub, edges, chart);
      return { panel, title, big, sub, edges, startEdge, endEdge, chart };
    };

    const left = makePanel("left");
    const right = makePanel("right");
    if (shouldExportChart(settings, "left")) surface.append(left.panel);
    if (shouldExportChart(settings, "right")) surface.append(right.panel);

    const refs = {
      surface,
      primaryUoaSelect: createExportSelect("BTC"),
      secondaryUoaSelect: createExportSelect("USD"),
      scaleSelect: createExportSelect("log"),
      orderBySelect: createExportSelect("alpha-asc"),
      vesRedenomAdjustToggle: Object.assign(document.createElement("input"), { type: "checkbox" }),
      usdBtcBig: left.big,
      btcUsdBig: right.big,
      usdBtcPanel: left.panel,
      btcUsdPanel: right.panel,
      usdBtcScaleLabel: makeExportElement("span"),
      btcUsdScaleLabel: makeExportElement("span"),
      satUsdText: left.sub,
      usdSatText: right.sub,
      usdBtcDateEdges: left.edges,
      btcUsdDateEdges: right.edges,
      usdBtcStartDateEdge: left.startEdge,
      usdBtcEndDateEdge: left.endEdge,
      btcUsdStartDateEdge: right.startEdge,
      btcUsdEndDateEdge: right.endEdge,
      blockHeightText: makeExportElement("span"),
      rightAsOf: makeExportElement("span"),
      usdBtcChart: left.chart,
      btcUsdChart: right.chart,
      usdBtcTitle: left.title,
      btcUsdTitle: right.title,
      updatedKpiValue: makeExportElement("span"),
      blockHeightKpiValue: makeExportElement("span"),
      pairKpiValue: makeExportElement("span"),
      primaryRankKpiValue: makeExportElement("span"),
      secondaryRankKpiValue: makeExportElement("span"),
    };
    document.body.appendChild(surface);
    return refs;
  }

  function withExportElements(exportRefs, callback) {
    const keys = Object.keys(exportRefs).filter((key) => key !== "surface");
    const saved = {};
    keys.forEach((key) => {
      saved[key] = el[key];
      el[key] = exportRefs[key];
    });
    try {
      return callback();
    } finally {
      keys.forEach((key) => {
        el[key] = saved[key];
      });
    }
  }

  function renderExportFrameToSurface(exportRefs, snapshot, startIndex, endIndex) {
    withExportElements(exportRefs, () => {
      setExportSelectValue(exportRefs.primaryUoaSelect, snapshot.primaryCurrency);
      setExportSelectValue(exportRefs.secondaryUoaSelect, snapshot.secondaryCurrency);
      setExportSelectValue(exportRefs.scaleSelect, snapshot.scaleMode);
      setExportSelectValue(exportRefs.orderBySelect, snapshot.orderMode);
      exportRefs.vesRedenomAdjustToggle.checked = snapshot.smoothVesRedenom;
      const savedRows = rows;
      const savedExportRenderFlag = isRenderingDateRangeExportFrame;
      const savedExportTheme = activeDateRangeExportTheme;
      const savedExportAxisRows = activeDateRangeExportAxisRows;
      const savedExportScaleModes = activeDateRangeExportScaleModes;
      const frameStartIso = toIsoDate(allRows[startIndex].date);
      const frameEndIso = toIsoDate(allRows[endIndex].date);
      const frameStartText = formatDateEdgeText(frameStartIso);
      const frameEndText = formatDateEdgeText(frameEndIso);
      exportRefs.usdBtcStartDateEdge.textContent = frameStartText;
      exportRefs.btcUsdStartDateEdge.textContent = frameStartText;
      exportRefs.usdBtcEndDateEdge.textContent = frameEndText;
      exportRefs.btcUsdEndDateEdge.textContent = frameEndText;
      rows = allRows.slice(startIndex, endIndex + 1);
      isRenderingDateRangeExportFrame = true;
      activeDateRangeExportTheme = snapshot.exportTheme || null;
      activeDateRangeExportAxisRows = null;
      activeDateRangeExportScaleModes = {
        left: normalizeScaleMode(snapshot.leftScaleMode, snapshot.scaleMode),
        right: normalizeScaleMode(snapshot.rightScaleMode, snapshot.scaleMode),
      };
      try {
        renderAll();
        stabilizeDateRangeExportNumericText(exportRefs);
      } finally {
        rows = savedRows;
        isRenderingDateRangeExportFrame = savedExportRenderFlag;
        activeDateRangeExportTheme = savedExportTheme;
        activeDateRangeExportAxisRows = savedExportAxisRows;
        activeDateRangeExportScaleModes = savedExportScaleModes;
      }
    });
  }

  function copyComputedExportStyles(source, target) {
    if (!source || !target || source.nodeType !== Node.ELEMENT_NODE) return;
    const computed = getComputedStyle(source);
    [
      "align-items",
      "background",
      "background-color",
      "border",
      "border-radius",
      "box-sizing",
      "color",
      "display",
      "flex-direction",
      "font",
      "font-family",
      "font-feature-settings",
      "font-size",
      "font-stretch",
      "font-style",
      "font-variant",
      "font-variant-numeric",
      "font-weight",
      "gap",
      "grid-template-columns",
      "grid-template-rows",
      "height",
      "justify-content",
      "left",
      "letter-spacing",
      "line-height",
      "margin",
      "max-height",
      "max-width",
      "min-height",
      "min-width",
      "object-fit",
      "opacity",
      "overflow",
      "overflow-x",
      "overflow-y",
      "padding",
      "pointer-events",
      "position",
      "right",
      "text-rendering",
      "text-align",
      "top",
      "transform",
      "-webkit-font-smoothing",
      "white-space",
      "width",
    ].forEach((property) => {
      const value = computed.getPropertyValue(property);
      if (value) target.style.setProperty(property, value);
    });
  }

  function isExportNumericTextNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    return node.classList.contains("big-value")
      || node.classList.contains("sub-value")
      || node.classList.contains("chart-date-edges")
      || node.parentElement?.classList.contains("chart-date-edges");
  }

  function applyExportNumericTextFeatures(source, target) {
    if (!isExportNumericTextNode(source) || !target?.style) return;
    target.style.setProperty("font-variant-numeric", "tabular-nums", "important");
    target.style.setProperty("font-feature-settings", "\"tnum\" 1", "important");
    target.style.setProperty("letter-spacing", "0", "important");
    target.style.setProperty("text-rendering", "geometricPrecision", "important");
    target.style.setProperty("-webkit-font-smoothing", "antialiased", "important");
  }

  function getExportNumericDigitWidth(node) {
    if (!node) return 0;
    const style = getComputedStyle(node);
    const key = [
      style.fontFamily,
      style.fontSize,
      style.fontStretch,
      style.fontStyle,
      style.fontWeight,
      style.letterSpacing,
    ].join("|");
    if (exportNumericMeasureCache.has(key)) return exportNumericMeasureCache.get(key);
    const probe = document.createElement("span");
    probe.textContent = "0";
    probe.style.position = "fixed";
    probe.style.left = "-100000px";
    probe.style.top = "0";
    probe.style.visibility = "hidden";
    probe.style.whiteSpace = "pre";
    probe.style.fontFamily = style.fontFamily;
    probe.style.fontSize = style.fontSize;
    probe.style.fontStretch = style.fontStretch;
    probe.style.fontStyle = style.fontStyle;
    probe.style.fontWeight = style.fontWeight;
    probe.style.lineHeight = style.lineHeight;
    probe.style.letterSpacing = "0";
    probe.style.fontVariantNumeric = "tabular-nums";
    probe.style.fontFeatureSettings = "\"tnum\" 1";
    document.body.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    const stableWidth = Number.isFinite(width) && width > 0 ? width : 0;
    exportNumericMeasureCache.set(key, stableWidth);
    return stableWidth;
  }

  function stabilizeExportNumericTextNode(node) {
    if (!node || !node.textContent) return;
    const text = node.textContent;
    const digitWidth = getExportNumericDigitWidth(node);
    const shouldOpticallyCenterOnes = node.classList.contains("big-value")
      || node.classList.contains("sub-value");
    node.textContent = "";
    let textBuffer = "";
    const flushTextBuffer = () => {
      if (!textBuffer) return;
      const span = document.createElement("span");
      span.textContent = textBuffer;
      span.style.setProperty("font-variant-numeric", "tabular-nums", "important");
      span.style.setProperty("font-feature-settings", "\"tnum\" 1", "important");
      span.style.setProperty("letter-spacing", "0", "important");
      span.style.display = "inline";
      span.style.whiteSpace = "pre";
      node.appendChild(span);
      textBuffer = "";
    };
    Array.from(text).forEach((char) => {
      if (!/\d/.test(char) || digitWidth <= 0) {
        textBuffer += char;
        return;
      }
      flushTextBuffer();
      const span = document.createElement("span");
      span.textContent = char;
      span.style.setProperty("font-variant-numeric", "tabular-nums", "important");
      span.style.setProperty("font-feature-settings", "\"tnum\" 1", "important");
      span.style.setProperty("letter-spacing", "0", "important");
      span.style.setProperty("text-rendering", "geometricPrecision", "important");
      span.style.setProperty("-webkit-font-smoothing", "antialiased", "important");
      span.style.display = "inline-block";
      span.style.whiteSpace = "pre";
      span.style.width = `${digitWidth}px`;
      span.style.textAlign = "center";
      if (shouldOpticallyCenterOnes && char === "1") {
        span.style.transform = "translateX(0.045em)";
      }
      node.appendChild(span);
    });
    flushTextBuffer();
  }

  function stabilizeDateRangeExportNumericText(exportRefs) {
    [
      exportRefs?.usdBtcBig,
      exportRefs?.btcUsdBig,
      exportRefs?.satUsdText,
      exportRefs?.usdSatText,
      exportRefs?.usdBtcStartDateEdge,
      exportRefs?.usdBtcEndDateEdge,
      exportRefs?.btcUsdStartDateEdge,
      exportRefs?.btcUsdEndDateEdge,
    ].forEach(stabilizeExportNumericTextNode);
  }

  function cloneExportNodeForSnapshot(node) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || "");
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    if (node instanceof HTMLCanvasElement) {
      const img = document.createElement("img");
      copyComputedExportStyles(node, img);
      const rect = node.getBoundingClientRect();
      img.src = node.toDataURL("image/png");
      img.style.width = `${rect.width}px`;
      img.style.height = `${rect.height}px`;
      img.style.display = "block";
      img.setAttribute("width", `${Math.max(1, Math.round(rect.width))}`);
      img.setAttribute("height", `${Math.max(1, Math.round(rect.height))}`);
      return img;
    }
    const clone = document.createElement(node.tagName.toLowerCase());
    copyComputedExportStyles(node, clone);
    applyExportNumericTextFeatures(node, clone);
    Array.from(node.attributes).forEach((attribute) => {
      if (attribute.name !== "style") clone.setAttribute(attribute.name, attribute.value);
    });
    node.childNodes.forEach((child) => {
      const childClone = cloneExportNodeForSnapshot(child);
      if (childClone) clone.appendChild(childClone);
    });
    return clone;
  }

  async function drawExportSurfaceSnapshot(ctx, exportRefs, width, surfaceHeight) {
    const clone = cloneExportNodeForSnapshot(exportRefs.surface);
    if (!clone) return false;
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    clone.style.position = "static";
    clone.style.left = "auto";
    clone.style.top = "auto";
    clone.style.width = `${width}px`;
    clone.style.height = `${surfaceHeight}px`;
    const markup = new XMLSerializer().serializeToString(clone);
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${surfaceHeight}" viewBox="0 0 ${width} ${surfaceHeight}">`,
      `<foreignObject width="100%" height="100%">${markup}</foreignObject>`,
      "</svg>",
    ].join("");
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const image = new Image();
      image.decoding = "sync";
      const loaded = new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
      });
      image.src = url;
      await loaded;
      ctx.drawImage(image, 0, 0, width, surfaceHeight);
      return true;
    } catch (error) {
      console.warn("Falling back to manual animation frame composition.", error);
      return false;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function canvasHasPixelVariance(canvas) {
    const ctx = canvas.getContext("2d");
    if (!ctx || canvas.width < 1 || canvas.height < 1) return false;
    const stepX = Math.max(1, Math.floor(canvas.width / 28));
    const stepY = Math.max(1, Math.floor(canvas.height / 18));
    let reference = null;
    for (let y = 0; y < canvas.height; y += stepY) {
      for (let x = 0; x < canvas.width; x += stepX) {
        let pixel;
        try {
          pixel = ctx.getImageData(x, y, 1, 1).data;
        } catch (_) {
          return false;
        }
        if (pixel[3] === 0) continue;
        if (!reference) {
          reference = pixel;
          continue;
        }
        if (
          Math.abs(pixel[0] - reference[0]) > 4
          || Math.abs(pixel[1] - reference[1]) > 4
          || Math.abs(pixel[2] - reference[2]) > 4
          || Math.abs(pixel[3] - reference[3]) > 4
        ) {
          return true;
        }
      }
    }
    return false;
  }

  async function composeDateRangeExportFrame(canvas, settings, exportRefs, options = {}) {
    const { width, height, footerHeight } = getExportLayoutMetrics(settings);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const preferDomSnapshot = options.preferDomSnapshot !== false;
    const palette = getExportThemePalette(settings.theme);
    const bg = palette["--bg"];
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    const surfaceRect = exportRefs.surface.getBoundingClientRect();
    const relativeRect = (node) => {
      const rect = node.getBoundingClientRect();
      return {
        x: rect.left - surfaceRect.left,
        y: rect.top - surfaceRect.top,
        width: rect.width,
        height: rect.height,
      };
    };
    const drawTextFragment = (node, { textAlign = "left", textBaseline = "top" } = {}) => {
      if (!node || !node.textContent) return;
      const rect = relativeRect(node);
      const style = getComputedStyle(node);
      ctx.save();
      ctx.font = [
        style.fontStyle,
        style.fontWeight,
        style.fontSize,
        style.fontFamily,
      ].filter(Boolean).join(" ");
      ctx.fillStyle = style.color || "#ffffff";
      ctx.textAlign = textAlign;
      ctx.textBaseline = textBaseline;
      const fontSize = parseFloat(style.fontSize) || 12;
      const lineBoxHeight = rect.height || fontSize;
      const x = textAlign === "right" || textAlign === "end"
        ? rect.x + rect.width
        : textAlign === "center"
          ? rect.x + rect.width / 2
          : rect.x;
      const y = textBaseline === "middle"
        ? rect.y + lineBoxHeight / 2
        : rect.y + Math.max(0, (lineBoxHeight - fontSize) / 2);
      ctx.fillText(node.textContent, x, y);
      ctx.restore();
    };
    const drawTextFragments = (node) => {
      const fragments = node ? Array.from(node.children).filter((child) => child.textContent) : [];
      if (!fragments.length) return false;
      fragments.forEach((fragment) => drawTextFragment(fragment));
      return true;
    };
    const drawElementText = (node) => {
      if (!node || !node.textContent) return;
      if (drawTextFragments(node)) return;
      const rect = relativeRect(node);
      const style = getComputedStyle(node);
      ctx.save();
      ctx.font = [
        style.fontStyle,
        style.fontWeight,
        style.fontSize,
        style.fontFamily,
      ].filter(Boolean).join(" ");
      ctx.fillStyle = style.color || "#ffffff";
      ctx.textAlign = style.textAlign || "left";
      ctx.textBaseline = "top";
      let x = rect.x;
      if (ctx.textAlign === "center") x += rect.width / 2;
      if (ctx.textAlign === "right" || ctx.textAlign === "end") x += rect.width;
      const fontSize = parseFloat(style.fontSize) || 12;
      const lineBoxHeight = rect.height || fontSize;
      const y = rect.y + Math.max(0, (lineBoxHeight - fontSize) / 2);
      ctx.fillText(node.textContent, x, y);
      ctx.restore();
    };
    const drawDateEdgeText = (node) => {
      if (!node || !node.textContent) return;
      if (drawTextFragments(node)) return;
      const rect = relativeRect(node);
      const style = getComputedStyle(node);
      const alignRight = style.textAlign === "right" || style.textAlign === "end";
      const textX = alignRight ? rect.x + rect.width : rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;
      ctx.save();
      ctx.font = [
        style.fontStyle,
        style.fontWeight,
        style.fontSize,
        style.fontFamily,
      ].filter(Boolean).join(" ");
      ctx.fillStyle = style.color || "#ffffff";
      ctx.textAlign = alignRight ? "right" : "center";
      ctx.textBaseline = "middle";
      ctx.fillText(node.textContent, textX, centerY);
      ctx.restore();
    };
    const drawPanel = (panel, title, big, sub, edges, startEdge, endEdge, chart) => {
      if (!panel?.isConnected) return;
      const panelRect = relativeRect(panel);
      const panelStyle = getComputedStyle(panel);
      ctx.save();
      ctx.fillStyle = panelStyle.backgroundColor || "transparent";
      ctx.strokeStyle = "transparent";
      ctx.lineWidth = 0;
      ctx.beginPath();
      drawRoundedExportRect(ctx, panelRect.x, panelRect.y, panelRect.width, panelRect.height, parseFloat(panelStyle.borderTopLeftRadius) || 0);
      ctx.fill();
      ctx.restore();

      drawElementText(title);
      drawElementText(big);
      if (sub.style.display !== "none") drawElementText(sub);
      drawDateEdgeText(startEdge);
      drawDateEdgeText(endEdge);

      const chartRect = relativeRect(chart);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(chart, chartRect.x, chartRect.y, chartRect.width, chartRect.height);
      ctx.restore();
    };

    let usedDomSnapshot = false;
    if (preferDomSnapshot) {
      const snapshotCanvas = document.createElement("canvas");
      const snapshotHeight = Math.max(1, height - footerHeight);
      snapshotCanvas.width = width;
      snapshotCanvas.height = snapshotHeight;
      const snapshotCtx = snapshotCanvas.getContext("2d");
      if (snapshotCtx) {
        const didDrawSnapshot = await drawExportSurfaceSnapshot(snapshotCtx, exportRefs, width, snapshotHeight);
        if (didDrawSnapshot && canvasHasPixelVariance(snapshotCanvas)) {
          ctx.drawImage(snapshotCanvas, 0, 0);
          usedDomSnapshot = true;
        }
      }
    }
    if (!usedDomSnapshot) {
      if (shouldExportChart(settings, "left")) {
        drawPanel(
          exportRefs.usdBtcPanel,
          exportRefs.usdBtcTitle,
          exportRefs.usdBtcBig,
          exportRefs.satUsdText,
          exportRefs.usdBtcDateEdges,
          exportRefs.usdBtcStartDateEdge,
          exportRefs.usdBtcEndDateEdge,
          exportRefs.usdBtcChart
        );
      }
      if (shouldExportChart(settings, "right")) {
        drawPanel(
          exportRefs.btcUsdPanel,
          exportRefs.btcUsdTitle,
          exportRefs.btcUsdBig,
          exportRefs.usdSatText,
          exportRefs.btcUsdDateEdges,
          exportRefs.btcUsdStartDateEdge,
          exportRefs.btcUsdEndDateEdge,
          exportRefs.btcUsdChart
        );
      }
    }
    ctx.save();
    ctx.fillStyle = bg;
    ctx.fillRect(0, height - footerHeight, width, footerHeight);
    ctx.fillStyle = settings.theme === "dark" ? "#6f7f87" : "#8f887f";
    ctx.font = `500 ${Math.max(30, Math.round(footerHeight * 0.6))}px IBM Plex Mono, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("https://wickedsmartbitcoin.com/uoa", width / 2, height - footerHeight * 0.68);
    ctx.restore();
  }

  function waitMs(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function waitForDateRangeExportFonts() {
    if (!document.fonts?.ready) return;
    try {
      await document.fonts.ready;
    } catch (_) {
      // Font readiness is a best-effort export polish step; keep the download moving.
    }
  }

  async function downloadDateRangeAnimation() {
    if (isDateRangeExporting) {
      requestDateRangeExportCancel();
      return;
    }
    if (!allRows.length || !el.dateRangeStartSlider || !el.dateRangeEndSlider) return;
    const settings = normalizeDownloadSettings(downloadSettings);
    const layoutSettings = getExportReferenceLayoutSettings(settings);
    const selectedPlaybackFps = Math.max(1, Number(settings.fps) || getSelectedDateRangePlaybackFps());
    const exportVideoFps = DATE_RANGE_EXPORT_VIDEO_FPS;
    const { width: exportWidth, height: exportHeight } = getExportLayoutMetrics(settings);

    const maxIndex = Math.max(0, allRows.length - 1);
    const playbackStart = Number(dateRangePlaybackState.startIndex);
    const playbackEnd = Number(dateRangePlaybackState.targetEndIndex);
    const sliderStart = Number(el.dateRangeStartSlider.value);
    const sliderEnd = Number(el.dateRangeEndSlider.value);
    const rawStart = dateRangePlaybackState.hasSession && Number.isFinite(playbackStart)
      ? playbackStart
      : sliderStart;
    const rawEnd = dateRangePlaybackState.hasSession && Number.isFinite(playbackEnd)
      ? playbackEnd
      : sliderEnd;
    const startIndex = Math.max(0, Math.min(maxIndex, Number.isFinite(rawStart) ? rawStart : 0));
    const endIndex = Math.max(startIndex, Math.min(maxIndex, Number.isFinite(rawEnd) ? rawEnd : maxIndex));
    const exportSnapshot = {
      primaryCurrency: el.primaryUoaSelect?.value || "BTC",
      secondaryCurrency: el.secondaryUoaSelect?.value || "USD",
      scaleMode: getDashboardScaleMode(),
      leftScaleMode: settings.leftScale,
      rightScaleMode: settings.rightScale,
      orderMode: ORDER_MODES.includes(el.orderBySelect?.value) ? el.orderBySelect.value : "alpha-asc",
      smoothVesRedenom: !!el.vesRedenomAdjustToggle?.checked,
      exportTheme: settings.theme,
      startIso: toIsoDate(allRows[startIndex].date),
      endIso: toIsoDate(allRows[endIndex].date),
    };

    isDateRangeExporting = true;
    dateRangeExportCancelRequested = false;
    broadcastDateRangeExportActive(true);
    renderDateRangeDownloadButtonProgress(0);

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = exportWidth;
    exportCanvas.height = exportHeight;
    const layoutCanvas = document.createElement("canvas");
    let exportRefs = null;
    let track = null;
    let recorder = null;
    let wasCanceled = false;
    const chunks = [];
    const cachedFrames = new Map();

    try {
      exportRefs = createExportRenderSurface(layoutSettings);
      await waitForDateRangeExportFonts();
      await waitForDateRangeExportFonts();
      const frameIndices = buildDateRangeExportFrameIndices(startIndex, endIndex, selectedPlaybackFps, settings.endFrameHold);
      if (settings.extension === "mp4") {
        try {
          const mp4Blob = await encodeDateRangeAnimationMp4({
            exportCanvas,
            layoutCanvas,
            layoutSettings,
            exportRefs,
            exportSnapshot,
            settings,
            startIndex,
            frameIndices,
          });
          if (mp4Blob && !dateRangeExportCancelRequested) {
            renderDateRangeDownloadButtonProgress(1);
            downloadDateRangeExportBlob(mp4Blob, "mp4", settings, exportSnapshot);
            return;
          }
          if (dateRangeExportCancelRequested) {
            wasCanceled = true;
            return;
          }
        } catch (error) {
          console.warn("Deterministic WebCodecs MP4 export unavailable; falling back to recorder export.", error);
        }
      }

      if (settings.extension === "webm") {
        try {
          const webmBlob = await encodeDateRangeAnimationWebM({
            exportCanvas,
            layoutCanvas,
            layoutSettings,
            exportRefs,
            exportSnapshot,
            settings,
            startIndex,
            frameIndices,
          });
          if (webmBlob && !dateRangeExportCancelRequested) {
            renderDateRangeDownloadButtonProgress(1);
            downloadDateRangeExportBlob(webmBlob, "webm", settings, exportSnapshot);
            return;
          }
          if (dateRangeExportCancelRequested) {
            wasCanceled = true;
            return;
          }
        } catch (error) {
          console.warn("Deterministic WebCodecs export unavailable; falling back to recorder export.", error);
        }
      }

      const recorderInfo = getSupportedDownloadRecorder(settings.extension);
      if (!recorderInfo || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
        throw new Error("Recording export unavailable.");
      }

      const batchSize = getDateRangeExportBatchSize(settings);
      const totalWorkUnits = Math.max(1, frameIndices.length * 2);
      let completedWorkUnits = 0;

      const exportCtx = exportCanvas.getContext("2d");
      if (!exportCtx) throw new Error("Export canvas context unavailable.");
      let stream;
      try {
        stream = exportCanvas.captureStream(0);
      } catch (_) {
        stream = exportCanvas.captureStream(exportVideoFps);
      }
      [track] = stream.getVideoTracks();
      if (!track || typeof track.requestFrame !== "function") {
        if (track) track.stop();
        stream = exportCanvas.captureStream(exportVideoFps);
        [track] = stream.getVideoTracks();
      }
      recorder = new MediaRecorder(stream, {
        mimeType: recorderInfo.mimeType,
        videoBitsPerSecond: getDateRangeExportBitrate(settings),
      });

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      });

      const recorderDone = new Promise((resolve, reject) => {
        recorder.addEventListener("stop", resolve, { once: true });
        recorder.addEventListener("error", () => reject(recorder.error || new Error("Recording failed")), { once: true });
      });

      const renderFrameBatch = async (batchStart) => {
        closeDateRangeExportFrames(cachedFrames);
        const batchIndices = frameIndices.slice(batchStart, batchStart + batchSize);
        const uniqueBatchIndices = [];
        const seenBatchIndices = new Set();
        batchIndices.forEach((index) => {
          if (seenBatchIndices.has(index)) return;
          seenBatchIndices.add(index);
          uniqueBatchIndices.push(index);
        });
        for (const index of uniqueBatchIndices) {
          if (dateRangeExportCancelRequested) {
            wasCanceled = true;
            break;
          }
          renderExportFrameToSurface(exportRefs, exportSnapshot, startIndex, index);
          await composeDateRangeExportFrame(layoutCanvas, layoutSettings, exportRefs);
          drawScaledExportFrame(layoutCanvas, exportCanvas, settings);
          const frameImage = typeof createImageBitmap === "function"
            ? await createImageBitmap(exportCanvas)
            : (() => {
                const canvas = document.createElement("canvas");
                canvas.width = exportCanvas.width;
                canvas.height = exportCanvas.height;
                canvas.getContext("2d")?.drawImage(exportCanvas, 0, 0);
                return canvas;
              })();
          cachedFrames.set(index, frameImage);
          completedWorkUnits += 1;
          renderDateRangeDownloadButtonProgress(completedWorkUnits / totalWorkUnits);
        }
      };

      recorder.start();
      if (typeof recorder.pause !== "function" || typeof recorder.resume !== "function") {
        throw new Error("MediaRecorder pause/resume unavailable.");
      }
      await transitionMediaRecorder(recorder, "pause", () => recorder.pause());

      let recordedFrames = 0;
      const frameDurationMs = 1000 / exportVideoFps;
      for (let batchStart = 0; batchStart < frameIndices.length; batchStart += batchSize) {
        await renderFrameBatch(batchStart);
        if (wasCanceled || dateRangeExportCancelRequested) {
          wasCanceled = true;
          break;
        }
        await transitionMediaRecorder(recorder, "resume", () => recorder.resume());
        let lastCaptureTime = performance.now() - frameDurationMs;
        const batchEnd = Math.min(frameIndices.length, batchStart + batchSize);
        for (let frameIndex = batchStart; frameIndex < batchEnd; frameIndex += 1) {
          const index = frameIndices[frameIndex];
          if (dateRangeExportCancelRequested) {
            wasCanceled = true;
            break;
          }
          const frameImage = cachedFrames.get(index);
          if (!frameImage) throw new Error("Cached export frame unavailable.");
          const elapsedSinceLastCapture = performance.now() - lastCaptureTime;
          if (elapsedSinceLastCapture < frameDurationMs) {
            await waitMs(frameDurationMs - elapsedSinceLastCapture);
          }
          exportCtx.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
          exportCtx.drawImage(frameImage, 0, 0);
          if (dateRangeExportCancelRequested) {
            wasCanceled = true;
            break;
          }
          if (track && typeof track.requestFrame === "function") track.requestFrame();
          lastCaptureTime = performance.now();
          recordedFrames += 1;
          completedWorkUnits += 1;
          renderDateRangeDownloadButtonProgress(completedWorkUnits / totalWorkUnits);
        }
        if (wasCanceled || dateRangeExportCancelRequested) break;
        if (batchEnd < frameIndices.length) {
          await transitionMediaRecorder(recorder, "pause", () => recorder.pause());
        }
      }
      recorder.stop();
      await recorderDone;
      if (wasCanceled || dateRangeExportCancelRequested) {
        chunks.length = 0;
        return;
      }
      renderDateRangeDownloadButtonProgress(1);

      const blob = new Blob(chunks, { type: recorderInfo.mimeType });
      downloadDateRangeExportBlob(blob, recorderInfo.extension, settings, exportSnapshot);
    } catch (error) {
      if (!wasCanceled && !dateRangeExportCancelRequested) {
        console.error(error);
        window.alert("The animation export could not be completed in this browser.");
      }
    } finally {
      if (recorder && recorder.state !== "inactive") recorder.stop();
      if (track) track.stop();
      closeDateRangeExportFrames(cachedFrames);
      if (exportRefs?.surface) exportRefs.surface.remove();
      chunks.length = 0;
      isDateRangeExporting = false;
      dateRangeExportCancelRequested = false;
      broadcastDateRangeExportActive(false);
      resetDateRangeDownloadButton();
    }
  }

  function updateDateRangePlayButton() {
    if (!el.dateRangePlayBtn) return;
    const isPlaying = !!dateRangePlaybackState.isPlaying;
    el.dateRangePlayBtn.disabled = isPlaying;
    el.dateRangePlayBtn.classList.toggle("is-playing", isPlaying);
    el.dateRangePlayBtn.setAttribute("aria-pressed", isPlaying ? "true" : "false");
  }

  function updateDateRangePauseButton() {
    if (!el.dateRangePauseBtn) return;
    const hasSession = !!dateRangePlaybackState.hasSession;
    const isPlaying = !!dateRangePlaybackState.isPlaying;
    el.dateRangePauseBtn.disabled = !hasSession || !isPlaying;
    el.dateRangePauseBtn.classList.toggle("is-paused", hasSession && !isPlaying);
  }

  function updateDateRangeStopButton() {
    if (!el.dateRangeStopBtn) return;
    el.dateRangeStopBtn.disabled = !dateRangePlaybackState.hasSession;
  }

  function bindDateRangePlaybackOutsidePointerCancel() {
    if (dateRangePlaybackOutsidePointerHandler) return;

    const cleanupTouchTracking = () => {
      if (!dateRangePlaybackOutsidePointerTouchState) return;
      document.removeEventListener("pointermove", dateRangePlaybackOutsidePointerTouchState.moveHandler, true);
      document.removeEventListener("pointerup", dateRangePlaybackOutsidePointerTouchState.endHandler, true);
      document.removeEventListener("pointercancel", dateRangePlaybackOutsidePointerTouchState.cancelHandler, true);
      dateRangePlaybackOutsidePointerTouchState = null;
    };

    const trackTouchMove = (event) => {
      if (!dateRangePlaybackOutsidePointerTouchState || event.pointerId !== dateRangePlaybackOutsidePointerTouchState.pointerId) return;
      const deltaX = event.clientX - dateRangePlaybackOutsidePointerTouchState.startX;
      const deltaY = event.clientY - dateRangePlaybackOutsidePointerTouchState.startY;
      if (Math.hypot(deltaX, deltaY) > 30) {
        dateRangePlaybackOutsidePointerTouchState.moved = true;
      }
    };

    const trackTouchEnd = (event) => {
      if (!dateRangePlaybackOutsidePointerTouchState || event.pointerId !== dateRangePlaybackOutsidePointerTouchState.pointerId) return;
      const { moved, target, eventPath, targetElement } = dateRangePlaybackOutsidePointerTouchState;
      cleanupTouchTracking();
      if (moved) return;
      if (!dateRangePlaybackState.hasSession) return;
      const isPauseButtonClick = (!!el.dateRangePlayBtn && (target === el.dateRangePlayBtn || el.dateRangePlayBtn.contains(target)))
        || (!!el.dateRangePauseBtn && (target === el.dateRangePauseBtn || el.dateRangePauseBtn.contains(target)));
      const isFpsButtonClick = !!el.dateRangeFpsTrigger && (target === el.dateRangeFpsTrigger || el.dateRangeFpsTrigger.contains(target));
      const isSliderInteraction = (!!el.dateRangeSliderWrap && (target === el.dateRangeSliderWrap || el.dateRangeSliderWrap.contains(target)))
        || (!!el.dateRangeStartSlider && (target === el.dateRangeStartSlider || el.dateRangeStartSlider.contains(target)))
        || (!!el.dateRangeEndSlider && (target === el.dateRangeEndSlider || el.dateRangeEndSlider.contains(target)));
      const isInDateRangePanel = !!el.dateRangePanel && (
        (targetElement && !!targetElement.closest(".date-range-panel"))
        || eventPath.includes(el.dateRangePanel)
      );
      const isChartPanelClick = !!el.chartGrid && (
        (targetElement && !!targetElement.closest(".chart-panel"))
        || eventPath.some((item) => item instanceof Element && item.classList?.contains("chart-panel"))
      );
      if (isPauseButtonClick || isFpsButtonClick || isSliderInteraction || isInDateRangePanel) return;
      if (isChartPanelClick) {
        toggleDateRangePlayback();
        return;
      }
      stopDateRangePlayback({ restoreOriginalRange: true });
    };

    const trackTouchCancel = (event) => {
      if (!dateRangePlaybackOutsidePointerTouchState || event.pointerId !== dateRangePlaybackOutsidePointerTouchState.pointerId) return;
      cleanupTouchTracking();
    };

    dateRangePlaybackOutsidePointerHandler = (event) => {
      if (!dateRangePlaybackState.hasSession) return;
      const target = event.target;
      const eventPath = typeof event.composedPath === "function" ? event.composedPath() : [];
      const targetElement = target instanceof Element ? target : null;
      const isPauseButtonClick = (!!el.dateRangePlayBtn && (target === el.dateRangePlayBtn || el.dateRangePlayBtn.contains(target)))
        || (!!el.dateRangePauseBtn && (target === el.dateRangePauseBtn || el.dateRangePauseBtn.contains(target)));
      const isFpsButtonClick = !!el.dateRangeFpsTrigger && (target === el.dateRangeFpsTrigger || el.dateRangeFpsTrigger.contains(target));
      const isSliderInteraction = (!!el.dateRangeSliderWrap && (target === el.dateRangeSliderWrap || el.dateRangeSliderWrap.contains(target)))
        || (!!el.dateRangeStartSlider && (target === el.dateRangeStartSlider || el.dateRangeStartSlider.contains(target)))
        || (!!el.dateRangeEndSlider && (target === el.dateRangeEndSlider || el.dateRangeEndSlider.contains(target)));
      const isInDateRangePanel = !!el.dateRangePanel && (
        (targetElement && !!targetElement.closest(".date-range-panel"))
        || eventPath.includes(el.dateRangePanel)
      );
      const isChartPanelClick = !!el.chartGrid && (
        (targetElement && !!targetElement.closest(".chart-panel"))
        || eventPath.some((item) => item instanceof Element && item.classList?.contains("chart-panel"))
      );
      if (isPauseButtonClick || isFpsButtonClick || isSliderInteraction || isInDateRangePanel) return;

      if (event.pointerType === "touch") {
        dateRangePlaybackOutsidePointerTouchState = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          target,
          eventPath,
          targetElement,
          moveHandler: trackTouchMove,
          endHandler: trackTouchEnd,
          cancelHandler: trackTouchCancel,
        };
        document.addEventListener("pointermove", trackTouchMove, true);
        document.addEventListener("pointerup", trackTouchEnd, true);
        document.addEventListener("pointercancel", trackTouchCancel, true);
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (isChartPanelClick) {
        toggleDateRangePlayback();
        return;
      }
      stopDateRangePlayback({ restoreOriginalRange: true });
    };

    document.addEventListener("pointerdown", dateRangePlaybackOutsidePointerHandler, true);
  }

  function unbindDateRangePlaybackOutsidePointerCancel() {
    if (!dateRangePlaybackOutsidePointerHandler) return;
    document.removeEventListener("pointerdown", dateRangePlaybackOutsidePointerHandler, true);
    dateRangePlaybackOutsidePointerHandler = null;
    if (dateRangePlaybackOutsidePointerTouchState) {
      document.removeEventListener("pointermove", dateRangePlaybackOutsidePointerTouchState.moveHandler, true);
      document.removeEventListener("pointerup", dateRangePlaybackOutsidePointerTouchState.endHandler, true);
      document.removeEventListener("pointercancel", dateRangePlaybackOutsidePointerTouchState.cancelHandler, true);
      dateRangePlaybackOutsidePointerTouchState = null;
    }
  }

  function pauseDateRangePlayback() {
    if (dateRangePlaybackState.rafId) {
      cancelAnimationFrame(dateRangePlaybackState.rafId);
    }
    dateRangePlaybackState.isPlaying = false;
    dateRangePlaybackState.rafId = 0;
    dateRangePlaybackState.lastTimestampMs = 0;
    dateRangePlaybackState.accumulatedMs = 0;
    updateDateRangePlayButton();
    updateDateRangeStopButton();
  }

  function stopDateRangePlayback(options = {}) {
    const restoreOriginalRange = !!options.restoreOriginalRange;
    const shouldRestore = restoreOriginalRange && dateRangePlaybackState.hasSession;
    const restoreStartIndex = dateRangePlaybackState.originalStartIndex;
    const restoreEndIndex = dateRangePlaybackState.originalEndIndex;
    const activeFps = getSelectedDateRangePlaybackFps();

    if (dateRangePlaybackState.rafId) {
      cancelAnimationFrame(dateRangePlaybackState.rafId);
    }
    unbindDateRangePlaybackOutsidePointerCancel();

    dateRangePlaybackState = {
      isPlaying: false,
      rafId: 0,
      lastTimestampMs: 0,
      accumulatedMs: 0,
      hasSession: false,
      fps: activeFps,
      startIndex: 0,
      targetEndIndex: 0,
      currentEndIndex: 0,
      originalStartIndex: 0,
      originalEndIndex: 0,
    };
    updatePlaybackActiveFlag();

    dateRangeEndSliderScrubState.active = false;
    dateRangeEndSliderScrubState.pointerId = null;
    dateRangeEndSliderScrubState.resumeAfterRelease = false;
    dateRangeEndSliderScrubState.captureOnWrap = false;

    if (shouldRestore && Number.isFinite(restoreStartIndex) && Number.isFinite(restoreEndIndex)) {
      setDateRangeByIndices(restoreStartIndex, restoreEndIndex);
    }

    updateDateRangePlayButton();
    updateDateRangePauseButton();
    updateDateRangeStopButton();
    persistFilters();
  }

  function setDateRangeByIndices(startIndex, endIndex) {
    if (!allRows.length) return false;
    const controlBounds = getDateRangeControlBounds();
    const minIndex = controlBounds?.minIndex ?? 0;
    const maxIndex = controlBounds?.maxIndex ?? Math.max(0, allRows.length - 1);
    const visualBounds = getDateRangeVisualBounds();
    let safeStart = Number.isFinite(startIndex) ? Math.round(startIndex) : minIndex;
    let safeEnd = Number.isFinite(endIndex) ? Math.round(endIndex) : maxIndex;
    safeStart = Math.max(minIndex, Math.min(maxIndex, safeStart));
    safeEnd = Math.max(minIndex, Math.min(maxIndex, safeEnd));

    if (maxIndex > minIndex && safeStart > safeEnd) {
      if (safeStart >= maxIndex) {
        safeStart = Math.max(minIndex, maxIndex - 1);
        safeEnd = maxIndex;
      } else {
        safeEnd = safeStart;
      }
    }

    if (el.dateRangeStartSlider) el.dateRangeStartSlider.value = String(safeStart);
    if (el.dateRangeEndSlider) el.dateRangeEndSlider.value = String(safeEnd);
    updateDateRangeSliderFill(safeStart, safeEnd, visualBounds);
    if (el.startDateInput) el.startDateInput.value = toIsoDate(allRows[safeStart].date);
    if (el.endDateInput) el.endDateInput.value = toIsoDate(allRows[safeEnd].date);
    applyFilters();
    return true;
  }

  function stepDateRangePlayback(timestampMs) {
    if (!dateRangePlaybackState.isPlaying || !allRows.length) {
      pauseDateRangePlayback();
      return;
    }

    if (!Number.isFinite(dateRangePlaybackState.targetEndIndex) || dateRangePlaybackState.targetEndIndex < 0) {
      pauseDateRangePlayback();
      return;
    }

    if (!dateRangePlaybackState.lastTimestampMs) {
      dateRangePlaybackState.lastTimestampMs = timestampMs;
    }

    const elapsedMs = Math.min(100, Math.max(0, timestampMs - dateRangePlaybackState.lastTimestampMs));
    dateRangePlaybackState.lastTimestampMs = timestampMs;
    dateRangePlaybackState.accumulatedMs += elapsedMs;

    let currentEndIndex = Number(el.dateRangeEndSlider?.value);
    if (!Number.isFinite(currentEndIndex)) currentEndIndex = Math.max(0, Number(dateRangePlaybackState.startIndex) || 0);

    const frameMs = 1000 / Math.max(1, dateRangePlaybackState.fps || DEFAULT_RANGE_PLAYBACK_FPS);

    let hasStepped = false;
    while (dateRangePlaybackState.accumulatedMs >= frameMs && currentEndIndex < dateRangePlaybackState.targetEndIndex) {
      currentEndIndex += 1;
      dateRangePlaybackState.accumulatedMs -= frameMs;
      hasStepped = true;
    }

    if (hasStepped) {
      setDateRangeByIndices(dateRangePlaybackState.startIndex, currentEndIndex);
      dateRangePlaybackState.currentEndIndex = currentEndIndex;
    }

    if (currentEndIndex >= dateRangePlaybackState.targetEndIndex) {
      dateRangePlaybackState.currentEndIndex = dateRangePlaybackState.targetEndIndex;
      stopDateRangePlayback({ restoreOriginalRange: true });
      return;
    }

    dateRangePlaybackState.rafId = requestAnimationFrame(stepDateRangePlayback);
  }

  function startDateRangePlayback() {
    if (dateRangePlaybackState.isPlaying) return;
    if (!allRows.length) return;
    
    const controlBounds = getDateRangeControlBounds();
    const minIndex = controlBounds?.minIndex ?? 0;
    const maxIndex = controlBounds?.maxIndex ?? Math.max(0, allRows.length - 1);
    if (maxIndex <= minIndex) return;

    if (!dateRangePlaybackState.hasSession) {
      const currentStartIso = String(el.startDateInput?.value || "").trim();
      const currentEndIso = String(el.endDateInput?.value || "").trim();
      let startIndex = getDateIndexFromIso(currentStartIso);
      let targetEndIndex = getDateIndexFromIso(currentEndIso);
      if (startIndex < 0) startIndex = Number(el.dateRangeStartSlider?.value);
      if (targetEndIndex < 0) targetEndIndex = Number(el.dateRangeEndSlider?.value);
      if (!Number.isFinite(startIndex)) startIndex = minIndex;
      if (!Number.isFinite(targetEndIndex)) targetEndIndex = maxIndex;
      startIndex = Math.max(minIndex, Math.min(maxIndex, startIndex));
      targetEndIndex = Math.max(minIndex, Math.min(maxIndex, targetEndIndex));

      if (targetEndIndex < startIndex) return;

      const playbackEndStartIndex = startIndex;
      const selectedFps = getSelectedDateRangePlaybackFps();

      setDateRangeByIndices(startIndex, playbackEndStartIndex);
      dateRangePlaybackState.hasSession = true;
      updatePlaybackActiveFlag();
      dateRangePlaybackState.fps = selectedFps;
      dateRangePlaybackState.startIndex = startIndex;
      dateRangePlaybackState.targetEndIndex = targetEndIndex;
      dateRangePlaybackState.currentEndIndex = playbackEndStartIndex;
      dateRangePlaybackState.originalStartIndex = startIndex;
      dateRangePlaybackState.originalEndIndex = targetEndIndex;
    } else {
      const selectedFps = getSelectedDateRangePlaybackFps();
      dateRangePlaybackState.fps = selectedFps;
      const resumeEndIndex = Math.max(
        dateRangePlaybackState.startIndex,
        Math.min(dateRangePlaybackState.targetEndIndex, dateRangePlaybackState.currentEndIndex)
      );
      if (resumeEndIndex > dateRangePlaybackState.targetEndIndex) return;
      setDateRangeByIndices(dateRangePlaybackState.startIndex, resumeEndIndex);
    }

    dateRangePlaybackState.isPlaying = true;
    dateRangePlaybackState.rafId = 0;
    dateRangePlaybackState.lastTimestampMs = 0;
    dateRangePlaybackState.accumulatedMs = 0;
    updateDateRangePlayButton();
    updateDateRangePauseButton();
    updateDateRangeStopButton();
    bindDateRangePlaybackOutsidePointerCancel();
    dateRangePlaybackState.rafId = requestAnimationFrame(stepDateRangePlayback);
  }

  function pauseDateRangePlayback() {
    if (!dateRangePlaybackState.isPlaying) return;
    if (dateRangePlaybackState.rafId) {
      cancelAnimationFrame(dateRangePlaybackState.rafId);
    }
    dateRangePlaybackState.isPlaying = false;
    dateRangePlaybackState.rafId = 0;
    updateDateRangePlayButton();
    updateDateRangePauseButton();
    bindDateRangePlaybackOutsidePointerCancel();
    persistFilters();
  }

  function toggleDateRangePlayback() {
    if (!allRows.length) return;
    if (dateRangePlaybackState.isPlaying) {
      pauseDateRangePlayback();
      return;
    }

    const controlBounds = getDateRangeControlBounds();
    const minIndex = controlBounds?.minIndex ?? 0;
    const maxIndex = controlBounds?.maxIndex ?? Math.max(0, allRows.length - 1);
    if (maxIndex <= minIndex) return;

    if (!dateRangePlaybackState.hasSession) {
      const currentStartIso = String(el.startDateInput?.value || "").trim();
      const currentEndIso = String(el.endDateInput?.value || "").trim();
      let startIndex = getDateIndexFromIso(currentStartIso);
      let targetEndIndex = getDateIndexFromIso(currentEndIso);
      if (startIndex < 0) startIndex = Number(el.dateRangeStartSlider?.value);
      if (targetEndIndex < 0) targetEndIndex = Number(el.dateRangeEndSlider?.value);
      if (!Number.isFinite(startIndex)) startIndex = minIndex;
      if (!Number.isFinite(targetEndIndex)) targetEndIndex = maxIndex;
      startIndex = Math.max(minIndex, Math.min(maxIndex, startIndex));
      targetEndIndex = Math.max(minIndex, Math.min(maxIndex, targetEndIndex));

      if (targetEndIndex < startIndex) return;

      const playbackEndStartIndex = startIndex;
      const selectedFps = getSelectedDateRangePlaybackFps();

      setDateRangeByIndices(startIndex, playbackEndStartIndex);
      dateRangePlaybackState.hasSession = true;
      updatePlaybackActiveFlag();
      dateRangePlaybackState.fps = selectedFps;
      dateRangePlaybackState.startIndex = startIndex;
      dateRangePlaybackState.targetEndIndex = targetEndIndex;
      dateRangePlaybackState.currentEndIndex = playbackEndStartIndex;
      dateRangePlaybackState.originalStartIndex = startIndex;
      dateRangePlaybackState.originalEndIndex = targetEndIndex;
    } else {
      const selectedFps = getSelectedDateRangePlaybackFps();
      dateRangePlaybackState.fps = selectedFps;
      // If paused at the end of animation, restart from the beginning
      if (dateRangePlaybackState.currentEndIndex === dateRangePlaybackState.targetEndIndex) {
        dateRangePlaybackState.currentEndIndex = dateRangePlaybackState.startIndex;
      }
      const resumeEndIndex = Math.max(
        dateRangePlaybackState.startIndex,
        Math.min(dateRangePlaybackState.targetEndIndex, dateRangePlaybackState.currentEndIndex)
      );
      if (resumeEndIndex > dateRangePlaybackState.targetEndIndex) return;
      setDateRangeByIndices(dateRangePlaybackState.startIndex, resumeEndIndex);
    }

    dateRangePlaybackState.isPlaying = true;
    dateRangePlaybackState.rafId = 0;
    dateRangePlaybackState.lastTimestampMs = 0;
    dateRangePlaybackState.accumulatedMs = 0;
    updateDateRangePlayButton();
    updateDateRangePauseButton();
    updateDateRangeStopButton();
    bindDateRangePlaybackOutsidePointerCancel();
    dateRangePlaybackState.rafId = requestAnimationFrame(stepDateRangePlayback);
  }

  function stopAndResetDateRangePlayback() {
    stopDateRangePlayback({ restoreOriginalRange: true });
  }

  function bindDateRangePlaybackSpaceShortcut() {
    if (dateRangeSpaceShortcutBound) return;
    dateRangeSpaceShortcutBound = true;

    const blurDateRangeControlIfFocused = () => {
      const active = document.activeElement;
      if (
        active === el.dateRangeStartSlider
        || active === el.dateRangeEndSlider
        || active === el.dateRangePlayBtn
        || active === el.dateRangePauseBtn
        || active === el.dateRangeStopBtn
        || active === el.dateRangeFpsTrigger
        || (el.dateRangePresets && el.dateRangePresets.contains(active))
      ) {
        active.blur();
      }
    };

    document.addEventListener("keydown", (event) => {
      if (!(event.key === " " || event.code === "Space")) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      const active = document.activeElement;
      const isTextEntryInput = (
        active
        && active.tagName === "INPUT"
        && ["text", "search", "email", "password", "url", "tel", "number"].includes(
          String(active.type || "").toLowerCase()
        )
      );
      if (
        active
        && (
          isTextEntryInput
          || active.tagName === "TEXTAREA"
          || active.tagName === "SELECT"
          || active.isContentEditable
        )
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }

      blurDateRangeControlIfFocused();
      toggleDateRangePlayback();
      requestAnimationFrame(blurDateRangeControlIfFocused);
    }, true);
  }

  function bindDateRangePlaybackFpsButtons() {
    if (el.dateRangeFpsTrigger && el.dateRangeFpsTrigger.dataset.bound !== "1") {
      el.dateRangeFpsTrigger.dataset.bound = "1";
      el.dateRangeFpsTrigger.addEventListener("click", (event) => {
        event.stopPropagation();
        const nextFps = getNextDateRangePlaybackFps(getSelectedDateRangePlaybackFps());
        setDateRangePlaybackFps(nextFps);
        persistFilters();
      });
    }

    setDateRangePlaybackFps(getSelectedDateRangePlaybackFps());
  }

  function setDashboardExpandedMode(expanded) {
    document.body.classList.toggle("uoa-dashboard-expanded", expanded);
    if (el.dashboardExpandBtn) {
      el.dashboardExpandBtn.setAttribute("aria-pressed", String(expanded));
      el.dashboardExpandBtn.setAttribute("aria-label", expanded ? "Shrink video layout" : "Expand video layout");
      el.dashboardExpandBtn.setAttribute("title", expanded ? "Shrink video layout" : "Expand video layout");
    }
    try {
      window.parent?.postMessage({ type: "wsb-uoa-dashboard-expanded", expanded }, window.location.origin);
    } catch (_) {
    }
    requestAnimationFrame(() => {
      renderAll();
      requestAnimationFrame(renderAll);
    });
  }

  function bindDashboardExpandButton() {
    if (!el.dashboardExpandBtn || el.dashboardExpandBtn.dataset.bound === "1") return;
    el.dashboardExpandBtn.dataset.bound = "1";
    el.dashboardExpandBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      setDashboardExpandedMode(!document.body.classList.contains("uoa-dashboard-expanded"));
    });
  }

  function bindDateRangeDownloadControls() {
    loadDownloadSettings();
    if (el.dateRangeDownloadBtn && el.dateRangeDownloadBtn.dataset.bound !== "1") {
      el.dateRangeDownloadBtn.dataset.bound = "1";
      el.dateRangeDownloadBtn.addEventListener("click", () => {
        closeDownloadSettingsMenu({ restoreControls: true });
        downloadDateRangeAnimation();
      });
    }
    if (el.dateRangeDownloadSettingsBtn && el.dateRangeDownloadSettingsBtn.dataset.bound !== "1") {
      el.dateRangeDownloadSettingsBtn.dataset.bound = "1";
      el.dateRangeDownloadSettingsBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleDownloadSettingsMenu();
      });
    }
    [
      el.downloadChartModeSelect,
      el.downloadLeftScaleSelect,
      el.downloadRightScaleSelect,
      el.downloadQualitySelect,
      el.downloadOrientationSelect,
      el.downloadThemeSelect,
      el.downloadFpsSelect,
    ].forEach((group) => {
      if (!group || group.dataset.bound === "1") return;
      group.dataset.bound = "1";
      const buttons = Array.from(group.querySelectorAll(".download-setting-option[data-value]"));
      buttons.forEach((button) => {
        button.addEventListener("click", () => {
          if (group === el.downloadChartModeSelect) {
            toggleDownloadChartModeButton(button);
          } else {
            setDownloadSettingGroupValue(group, button.dataset.value);
          }
          saveDownloadSettings(readDownloadSettingsControls());
        });
      });
    });
    if (el.downloadEndFrameHoldToggle && el.downloadEndFrameHoldToggle.dataset.bound !== "1") {
      el.downloadEndFrameHoldToggle.dataset.bound = "1";
      el.downloadEndFrameHoldToggle.addEventListener("change", () => {
        saveDownloadSettings(readDownloadSettingsControls());
      });
    }
    if (el.downloadSettingsDownloadBtn && el.downloadSettingsDownloadBtn.dataset.bound !== "1") {
      el.downloadSettingsDownloadBtn.dataset.bound = "1";
      el.downloadSettingsDownloadBtn.addEventListener("click", () => {
        if (isDateRangeExporting) {
          requestDateRangeExportCancel();
          return;
        }
        saveDownloadSettings(readDownloadSettingsControls());
        closeDownloadSettingsMenu();
        downloadDateRangeAnimation();
      });
    }
  }

  function bindDateRangeChartToggles() {
    if (!el.dateRangeChartToggles || el.dateRangeChartToggles.dataset.bound === "1") return;
    el.dateRangeChartToggles.dataset.bound = "1";
    const buttons = Array.from(el.dateRangeChartToggles.querySelectorAll(".date-range-chart-toggle-btn[data-value]"));
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        toggleVisibleChartButton(button);
      });
    });
    syncDateRangeChartToggleLabels();
  }

  function bindDateRangePlaybackArrowScrubbing() {
    document.addEventListener("keydown", (event) => {
      // Check if playback is active (playing or paused with an active session)
      const isPlaybackActive = dateRangePlaybackState.hasSession;
      if (!isPlaybackActive) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
        stopDateRangePlayback({ restoreOriginalRange: true });
        return;
      }

      const isArrowLeft = event.key === "ArrowLeft";
      const isArrowRight = event.key === "ArrowRight";
      const isComma = event.key === "," || event.code === "Comma";
      const isPeriod = event.key === "." || event.code === "Period";
      if (!isArrowLeft && !isArrowRight && !isComma && !isPeriod) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      // Don't interfere if focus is on a form element
      const active = document.activeElement;
      const isFormElement = (
        active
        && (
          (active.tagName === "INPUT" && !["range"].includes(String(active.type || "").toLowerCase()))
          || active.tagName === "TEXTAREA"
          || active.tagName === "SELECT"
          || active.isContentEditable
        )
      );
      if (isFormElement) return;

      event.preventDefault();
      event.stopPropagation();

      const maxIndex = Math.max(0, allRows.length - 1);
      const rawStartIndex = Number(dateRangePlaybackState.startIndex);
      const rawTargetEndIndex = Number(dateRangePlaybackState.targetEndIndex);
      const sessionStartIndex = Number.isFinite(rawStartIndex)
        ? Math.max(0, Math.min(maxIndex, Math.round(rawStartIndex)))
        : 0;
      const sessionTargetEndIndex = Number.isFinite(rawTargetEndIndex)
        ? Math.max(0, Math.min(maxIndex, Math.round(rawTargetEndIndex)))
        : maxIndex;
      const minSessionEndIndex = sessionStartIndex;
      const maxSessionEndIndex = sessionTargetEndIndex;

      if (maxSessionEndIndex < minSessionEndIndex) return;

      let currentEndIndex = Number(el.dateRangeEndSlider?.value);
      if (!Number.isFinite(currentEndIndex)) currentEndIndex = dateRangePlaybackState.currentEndIndex || minSessionEndIndex;
      currentEndIndex = Math.max(minSessionEndIndex, Math.min(maxSessionEndIndex, Math.round(currentEndIndex)));

      const fps = dateRangePlaybackState.fps || DEFAULT_RANGE_PLAYBACK_FPS;
      const framesFor10Seconds = Math.max(1, Math.round(10 * fps));

      let nextEndIndex = currentEndIndex;
      if (isArrowRight) {
        nextEndIndex = Math.min(maxSessionEndIndex, currentEndIndex + framesFor10Seconds);
      } else if (isArrowLeft) {
        nextEndIndex = Math.max(minSessionEndIndex, currentEndIndex - framesFor10Seconds);
      } else if (isPeriod) {
        nextEndIndex = Math.min(maxSessionEndIndex, currentEndIndex + 1);
      } else if (isComma) {
        nextEndIndex = Math.max(minSessionEndIndex, currentEndIndex - 1);
      }

      if (nextEndIndex !== currentEndIndex) {
        setDateRangeByIndices(sessionStartIndex, nextEndIndex);
        dateRangePlaybackState.currentEndIndex = nextEndIndex;

        // If right arrow scrubbing reaches the end of animation during playback, pause instead of advancing to next modal
        if (isArrowRight && dateRangePlaybackState.isPlaying && nextEndIndex === maxSessionEndIndex) {
          pauseDateRangePlayback();
        }
      }
    }, true);
  }

  function getFallbackSecondary(primary) {
    const preferred = ["USD", "EUR", "BTC"];
    for (const code of preferred) {
      if (code !== primary && availableCurrencies.includes(code)) return code;
    }
    return availableCurrencies.find((code) => code !== primary) || "USD";
  }

  function encodeShareState(payload) {
    try {
      const json = JSON.stringify(payload);
      const bytes = new TextEncoder().encode(json);
      let binary = "";
      bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
      });
      return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    } catch (_) {
      return "";
    }
  }

  function decodeShareState(rawValue) {
    if (!rawValue) return null;
    try {
      const normalized = rawValue.replace(/-/g, "+").replace(/_/g, "/");
      const paddingLength = (4 - (normalized.length % 4)) % 4;
      const padded = normalized + "=".repeat(paddingLength);
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const json = new TextDecoder().decode(bytes);
      const parsed = JSON.parse(json);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function getDashboardShareStateFromUrl() {
    const params = new URLSearchParams(window.location.search || "");
    return decodeShareState(params.get(SHARE_STATE_PARAM) || "");
  }

  function loadStoredFilters(bounds) {
    const shareState = getDashboardShareStateFromUrl();
    const stored = shareState || safeReadJson(UOA_FILTERS_KEY) || {};

    const validPrimary = availableCurrencies.includes(stored.primaryUoa) ? stored.primaryUoa : "BTC";
    const validSecondaryCandidate = availableCurrencies.includes(stored.secondaryUoa)
      ? stored.secondaryUoa
      : getFallbackSecondary(validPrimary);
    const validSecondary = validSecondaryCandidate === validPrimary
      ? getFallbackSecondary(validPrimary)
      : validSecondaryCandidate;

    const defaultPrimaryBounds = getCurrencyDateIndexBounds(validPrimary);
    const defaultStart = defaultPrimaryBounds?.minIso || bounds.min;
    const storedRangePreset = RANGE_PRESET_KEYS.includes(String(stored.rangePreset || "").toLowerCase())
      ? String(stored.rangePreset || "").toLowerCase()
      : "";
    let startDate = clampIsoDate(stored.startDate, bounds.min, bounds.max, defaultStart);
    let endDate = clampIsoDate(stored.endDate, bounds.min, bounds.max, bounds.max);
    if (storedRangePreset) {
      const preset = getPresetDateIndices(storedRangePreset, null, validPrimary);
      if (preset) {
        startDate = toIsoDate(allRows[preset.startIndex].date);
        endDate = storedRangePreset === "full"
          ? toIsoDate(allRows[preset.endIndex].date)
          : getLocalTodayIso();
      }
    } else {
      const rollingDaysToToday = Number(stored.rollingDaysToToday);
      if (Number.isFinite(rollingDaysToToday) && rollingDaysToToday >= 1) {
        const todayIso = getLocalTodayIso();
        endDate = clampIsoDate(todayIso, bounds.min, todayIso, todayIso);
        startDate = clampIsoDate(shiftIsoByDays(todayIso, -(Math.round(rollingDaysToToday) - 1)), bounds.min, endDate, bounds.min);
      }
    }
    const requestedStartDate = startDate;
    const requestedEndDate = endDate;
    const scale = stored.scaleMode === "linear" ? "linear" : "log";
    const orderMode = ORDER_MODES.includes(stored.orderMode) ? stored.orderMode : "alpha-asc";
    const smoothVesRedenom = stored.smoothVesRedenom === false ? false : true;
    const storedPlaybackFps = Number(stored.playbackFps);
    const playbackFps = Number.isFinite(storedPlaybackFps) && storedPlaybackFps > 0
      ? storedPlaybackFps
      : DEFAULT_RANGE_PLAYBACK_FPS;
    const chartMode = ["left", "right", "both"].includes(String(stored.chartMode || ""))
      ? String(stored.chartMode)
      : "both";
    const sharedTimeZone = shareState ? String(stored.timeZone || "").trim() : "";
    const timeZone = sharedTimeZone
      ? setPreferredDashboardTimeZone(sharedTimeZone)
      : getPreferredDashboardTimeZone();

    const pausedPlaybackSession = (
      stored.pausedPlaybackSession
      && typeof stored.pausedPlaybackSession === "object"
      && stored.pausedPlaybackSession.startDate
      && stored.pausedPlaybackSession.targetEndDate
      && stored.pausedPlaybackSession.currentEndDate
    ) ? {
      startDate: clampIsoDate(stored.pausedPlaybackSession.startDate, bounds.min, bounds.max, bounds.min),
      targetEndDate: clampIsoDate(stored.pausedPlaybackSession.targetEndDate, bounds.min, bounds.max, bounds.max),
      currentEndDate: clampIsoDate(stored.pausedPlaybackSession.currentEndDate, bounds.min, bounds.max, bounds.max),
    } : null;

    return {
      startDate,
      endDate,
      primaryUoa: validPrimary,
      secondaryUoa: validSecondary,
      scaleMode: scale,
      orderMode,
      smoothVesRedenom,
      playbackFps,
      chartMode,
      timeZone,
      rangePreset: storedRangePreset,
      requestedStartDate,
      requestedEndDate,
      pausedPlaybackSession,
    };
  }

  function persistFilters() {
    try {
      let pausedPlaybackSession = null;
      if (dateRangePlaybackState.hasSession && allRows.length) {
        const maxIndex = Math.max(0, allRows.length - 1);
        const currentEndFromSlider = Number(el.dateRangeEndSlider?.value);
        if (Number.isFinite(currentEndFromSlider)) {
          dateRangePlaybackState.currentEndIndex = currentEndFromSlider;
        }
        const safeStart = Math.max(0, Math.min(maxIndex, Number(dateRangePlaybackState.startIndex) || 0));
        const safeTargetEnd = Math.max(0, Math.min(maxIndex, Number(dateRangePlaybackState.targetEndIndex) || maxIndex));
        const safeCurrentEnd = Math.max(0, Math.min(maxIndex, Number(dateRangePlaybackState.currentEndIndex) || safeStart));
        pausedPlaybackSession = {
          startDate: toIsoDate(allRows[safeStart].date),
          targetEndDate: toIsoDate(allRows[safeTargetEnd].date),
          currentEndDate: toIsoDate(allRows[safeCurrentEnd].date),
        };
      }

      const startDateValue = requestedDateRange.startIso || el.startDateInput?.value || "";
      const endDateValue = requestedDateRange.endIso || el.endDateInput?.value || "";
      const rangePreset = getMatchingRangePresetKey(startDateValue, endDateValue);
      const rollingDaysToToday = !rangePreset && endDateValue === getLocalTodayIso()
        ? getInclusiveIsoDaySpan(startDateValue, endDateValue)
        : null;
      const payload = {
        startDate: startDateValue,
        endDate: endDateValue,
        rangePreset,
        rollingDaysToToday,
        primaryUoa: el.primaryUoaSelect?.value || "",
        secondaryUoa: el.secondaryUoaSelect?.value || "",
        scaleMode: el.scaleSelect?.value === "linear" ? "linear" : "log",
        orderMode: ORDER_MODES.includes(el.orderBySelect?.value) ? el.orderBySelect.value : "alpha-asc",
        smoothVesRedenom: !!el.vesRedenomAdjustToggle?.checked,
        playbackFps: getSelectedDateRangePlaybackFps(),
        chartMode: getVisibleChartMode(),
        timeZone: updatedKpiTimeZone || "UTC",
        pausedPlaybackSession,
      };
      localStorage.setItem(UOA_FILTERS_KEY, JSON.stringify(payload));
      if (!suppressResetSnapshotClear) clearPreResetSnapshot();
    } catch (_) {
      // Ignore storage write errors (private mode / quotas).
    }
  }

  function getDefaultDashboardState(bounds = getDateBounds()) {
    const primaryUoa = "BTC";
    const secondaryUoa = "USD";
    const defaultPrimaryBounds = getCurrencyDateIndexBounds(primaryUoa);
    const startDate = defaultPrimaryBounds?.minIso || bounds?.min || "";
    const endDate = bounds?.max || defaultPrimaryBounds?.maxIso || "";
    return {
      startDate,
      endDate,
      primaryUoa,
      secondaryUoa,
      scaleMode: "log",
      orderMode: "alpha-asc",
      smoothVesRedenom: true,
      playbackFps: DEFAULT_RANGE_PLAYBACK_FPS,
      chartMode: "both",
      timeZone: "UTC",
    };
  }

  function captureResetSnapshot() {
    return {
      startDate: requestedDateRange.startIso || el.startDateInput?.value || "",
      endDate: requestedDateRange.endIso || el.endDateInput?.value || "",
      primaryUoa: el.primaryUoaSelect?.value || "BTC",
      secondaryUoa: el.secondaryUoaSelect?.value || "USD",
      scaleMode: el.scaleSelect?.value === "linear" ? "linear" : "log",
      orderMode: ORDER_MODES.includes(el.orderBySelect?.value) ? el.orderBySelect.value : "alpha-asc",
      smoothVesRedenom: !!el.vesRedenomAdjustToggle?.checked,
      playbackFps: getSelectedDateRangePlaybackFps(),
      chartMode: getVisibleChartMode(),
      timeZone: updatedKpiTimeZone || "UTC",
    };
  }

  function restoreResetSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    const bounds = getDateBounds();
    if (!bounds) return;

    suppressResetSnapshotClear = true;
    try {
      const primary = availableCurrencies.includes(snapshot.primaryUoa) ? snapshot.primaryUoa : "BTC";
      const secondaryCandidate = availableCurrencies.includes(snapshot.secondaryUoa) ? snapshot.secondaryUoa : getFallbackSecondary(primary);
      const secondary = secondaryCandidate === primary ? getFallbackSecondary(primary) : secondaryCandidate;
      const startDate = clampIsoDate(snapshot.startDate, bounds.min, bounds.max, bounds.min);
      const endDate = clampIsoDate(snapshot.endDate, bounds.min, bounds.max, bounds.max);

      stopDateRangePlayback();
      if (el.primaryUoaSelect) el.primaryUoaSelect.value = primary;
      if (el.secondaryUoaSelect) el.secondaryUoaSelect.value = secondary;
      lastPrimaryUoa = primary;
      lastSecondaryUoa = secondary;
      if (el.scaleSelect) el.scaleSelect.value = snapshot.scaleMode === "linear" ? "linear" : "log";
      if (el.orderBySelect) {
        el.orderBySelect.value = ORDER_MODES.includes(snapshot.orderMode) ? snapshot.orderMode : "alpha-asc";
      }
      if (el.vesRedenomAdjustToggle) el.vesRedenomAdjustToggle.checked = snapshot.smoothVesRedenom !== false;
      updatedKpiTimeZone = setPreferredDashboardTimeZone(String(snapshot.timeZone || "UTC"));
      if (document.getElementById("updatedTimeZoneSelect")) {
        document.getElementById("updatedTimeZoneSelect").value = updatedKpiTimeZone;
      }
      setDateRangePlaybackFps(snapshot.playbackFps);
      setVisibleChartMode(snapshot.chartMode);
      setRequestedDateRange(startDate, endDate);
      if (el.startDateInput) el.startDateInput.value = startDate;
      if (el.endDateInput) el.endDateInput.value = endDate;

      renderPairKpiValue(primary, secondary);
      syncDateRangeChartToggleLabels();
      syncDownloadChartModeLabels();
      syncAllDropdowns();
      applyRequestedDateRangeToControls();
      applyFilters();
    } finally {
      suppressResetSnapshotClear = false;
    }
    updateResetButtonUi();
  }

  function restoreDashboardDefaults() {
    preResetStateSnapshot = captureResetSnapshot();
    try {
      localStorage.removeItem(UOA_FILTERS_KEY);
    } catch (_) {
      // Ignore storage write errors.
    }
    restoreResetSnapshot(getDefaultDashboardState());
    updateResetButtonUi();
  }

  function restorePreviousDashboardState() {
    if (!preResetStateSnapshot) return;
    const snapshot = preResetStateSnapshot;
    preResetStateSnapshot = null;
    restoreResetSnapshot(snapshot);
  }

  function clearPreResetSnapshot() {
    if (!preResetStateSnapshot) {
      updateResetButtonUi();
      return;
    }
    preResetStateSnapshot = null;
    updateResetButtonUi();
  }

  function statesMatch(current, defaults) {
    return current.startDate === defaults.startDate
      && current.endDate === defaults.endDate
      && current.primaryUoa === defaults.primaryUoa
      && current.secondaryUoa === defaults.secondaryUoa
      && current.scaleMode === defaults.scaleMode
      && current.orderMode === defaults.orderMode
      && current.smoothVesRedenom === defaults.smoothVesRedenom
      && Number(current.playbackFps) === Number(defaults.playbackFps)
      && current.chartMode === defaults.chartMode
      && current.timeZone === defaults.timeZone;
  }

  function isDefaultState() {
    return statesMatch(captureResetSnapshot(), getDefaultDashboardState());
  }

  function updateResetButtonUi() {
    const btn = el.resetDashboard || document.getElementById("resetDashboard");
    if (!btn) return;
    const labelEl = btn.querySelector(".btn-label");
    if (preResetStateSnapshot) {
      if (labelEl) labelEl.textContent = "Undo Restore";
      else btn.textContent = "Undo Restore";
      setButtonIcon("resetDashboardIcon", ICONS.resetUndo);
      btn.classList.add("reset-dashboard-btn--undo");
      btn.setAttribute("aria-label", "Undo the last restore defaults action");
      setCustomTooltip(btn, "Undo the last restore defaults action");
      btn.disabled = false;
      return;
    }

    if (labelEl) labelEl.textContent = "Restore Defaults";
    else btn.textContent = "Restore Defaults";
    setButtonIcon("resetDashboardIcon", ICONS.resetDefaults);
    btn.classList.remove("reset-dashboard-btn--undo");
    btn.setAttribute("aria-label", "Restore dashboard defaults");
    setCustomTooltip(btn, "Reset dashboard to defaults");
    btn.disabled = isDefaultState();
  }

  function getShareRouteBaseUrl() {
    const path = String(window.location.pathname || "");
    const dashboardMatch = path.match(/^(.*)\/webapps\/uoa\/dashboard\.html$/i);
    const basePath = dashboardMatch ? (dashboardMatch[1] || "") : path.replace(/\/[^/]*$/, "");
    if (IS_LOCAL_RUNTIME) {
      return `${window.location.origin}${basePath}/uoa.html`;
    }
    return `${window.location.origin}${basePath}/uoa`;
  }

  function buildShareableDashboardUrl() {
    const defaults = getDefaultDashboardState();
    const payload = captureResetSnapshot();
    const compactPayload = {};
    Object.entries(payload).forEach(([key, value]) => {
      if (value === defaults[key]) return;
      compactPayload[key] = value;
    });

    const shareUrl = new URL(getShareRouteBaseUrl());
    if (!Object.keys(compactPayload).length) return shareUrl.toString();
    const encoded = encodeShareState(compactPayload);
    if (encoded) shareUrl.searchParams.set(SHARE_STATE_PARAM, encoded);
    return shareUrl.toString();
  }

  async function copyDashboardLinkToClipboard(buttonEl) {
    const link = buildShareableDashboardUrl();
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link);
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = link;
      textArea.setAttribute("readonly", "readonly");
      textArea.style.position = "absolute";
      textArea.style.left = "-9999px";
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    }

    if (!buttonEl) return;
    const labelEl = buttonEl.querySelector(".btn-label");
    const original = labelEl ? labelEl.textContent : buttonEl.textContent;
    if (buttonEl.__copyFeedbackTimer) {
      window.clearTimeout(buttonEl.__copyFeedbackTimer);
    }
    buttonEl.classList.add("copy-link-btn--copied");
    setButtonIcon("copyDashboardIcon", ICONS.copyCopied);
    if (labelEl) labelEl.textContent = "Copied!";
    else buttonEl.textContent = "Copied!";
    buttonEl.__copyFeedbackTimer = window.setTimeout(() => {
      setButtonIcon("copyDashboardIcon", ICONS.copyLink);
      if (labelEl) labelEl.textContent = original || "Copy Link";
      else buttonEl.textContent = original || "Copy Link";
      buttonEl.classList.remove("copy-link-btn--copied");
      buttonEl.__copyFeedbackTimer = null;
    }, 1400);
  }

  function bindDashboardActionButtons() {
    bindCustomTooltips();
    setCustomTooltip(el.copyDashboardLink, "Copy shareable dashboard link");
    if (el.copyDashboardLink && el.copyDashboardLink.dataset.bound !== "1") {
      el.copyDashboardLink.dataset.bound = "1";
      el.copyDashboardLink.addEventListener("click", async () => {
        try {
          await copyDashboardLinkToClipboard(el.copyDashboardLink);
        } catch (_) {
          // Clipboard may be unavailable in some browser contexts.
        }
      });
    }

    setCustomTooltip(el.resetDashboard, preResetStateSnapshot ? "Undo the last restore defaults action" : "Reset dashboard to defaults");
    if (el.resetDashboard && el.resetDashboard.dataset.bound !== "1") {
      el.resetDashboard.dataset.bound = "1";
      el.resetDashboard.addEventListener("click", () => {
        if (preResetStateSnapshot) restorePreviousDashboardState();
        else restoreDashboardDefaults();
      });
    }
    updateResetButtonUi();
  }

  function bindDateRangeSessionPersistence() {
    if (dateRangeSessionPersistenceBound) return;
    dateRangeSessionPersistenceBound = true;

    const persistSessionSnapshot = () => {
      if (dateRangePlaybackState.hasSession) {
        const currentEndFromSlider = Number(el.dateRangeEndSlider?.value);
        if (Number.isFinite(currentEndFromSlider)) {
          dateRangePlaybackState.currentEndIndex = currentEndFromSlider;
        }
      }
      persistFilters();
    };

    window.addEventListener("pagehide", persistSessionSnapshot);
    window.addEventListener("beforeunload", persistSessionSnapshot);
  }

  const DROPDOWNS = [
    {
      selectId: "updatedTimeZoneSelect",
      dropdownId: "updatedTimeZoneDropdown",
      triggerId: "updatedTimeZoneDropdownTrigger",
      menuId: "updatedTimeZoneDropdownMenu",
      valueId: null,
    },
    {
      selectId: "primaryUoaSelect",
      dropdownId: "primaryUoaDropdown",
      triggerId: "primaryUoaDropdownTrigger",
      menuId: "primaryUoaDropdownMenu",
      valueId: "primaryUoaValue",
      searchable: true,
    },
    {
      selectId: "secondaryUoaSelect",
      dropdownId: "secondaryUoaDropdown",
      triggerId: "secondaryUoaDropdownTrigger",
      menuId: "secondaryUoaDropdownMenu",
      valueId: "secondaryUoaValue",
      searchable: true,
    },
    {
      selectId: "scaleSelect",
      dropdownId: "scaleDropdown",
      triggerId: "scaleDropdownTrigger",
      menuId: "scaleDropdownMenu",
      valueId: "scaleValue",
    },
    {
      selectId: "orderBySelect",
      dropdownId: "orderByDropdown",
      triggerId: "orderByDropdownTrigger",
      menuId: "orderByDropdownMenu",
      valueId: "orderByValue",
    },
  ];

  function toIsoDate(d) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }

  function clearCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
  }

  function parseCsv(text) {
    const lines = String(text || "").trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const parts = line.split(",");
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = (parts[i] || "").trim();
      });
      return obj;
    });
  }

  async function loadData() {
    const sourcePaths = [
      "webapp_data/daily_price.csv",
      "../../assets/daily_price.csv",
      "/assets/daily_price.csv",
    ];
    let selectedPath = "";
    const candidates = [
      ...sourcePaths,
    ];
    for (const url of candidates) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        const text = await res.text();
        const parsed = parseCsv(text)
          .map((r) => {
            const date = new Date(r.date);
            const price = Number(r.price);
            const block = Number(r.block_height);
            if (Number.isNaN(date.getTime()) || !Number.isFinite(price) || price <= 0) {
              return null;
            }
            return {
              date,
              price,
              blockHeight: Number.isFinite(block) ? block : null,
              usdbtcSats: 100000000 / price,
            };
          })
          .filter(Boolean)
          .sort((a, b) => a.date - b.date);
        if (parsed.length > 10) {
          selectedPath = url;
          return { rows: parsed, sourcePath: selectedPath };
        }
      } catch (_) {
        // Try next candidate
      }
    }
    return { rows: [], sourcePath: selectedPath };
  }

  async function loadUoaPairs() {
    const paths = [
      "webapp_data/uoa_pairs.json",
      "../../webapps/uoa/webapp_data/uoa_pairs.json",
      "/webapps/uoa/webapp_data/uoa_pairs.json",
    ];
    for (const url of paths) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        const data = await res.json();
        return data;
      } catch (_) {
        // Try next candidate
      }
    }
    return null;
  }

  async function loadLastUpdatedText() {
    const paths = [
      "webapp_data/last_updated.txt",
      "../../webapps/uoa/webapp_data/last_updated.txt",
      "/webapps/uoa/webapp_data/last_updated.txt",
    ];
    for (const url of paths) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        const text = String(await res.text() || "").trim();
        if (text) return text;
      } catch (_) {
        // Try next candidate
      }
    }
    return "";
  }

  async function loadFxRates() {
    const paths = [
      "webapp_data/daily_fx_rates.csv",
      "../../webapps/uoa/webapp_data/daily_fx_rates.csv",
      "/webapps/uoa/webapp_data/daily_fx_rates.csv",
    ];
    for (const url of paths) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        const text = await res.text();
        const parsed = parseCsv(text);
        const byDate = {};
        parsed.forEach((row) => {
          const date = row.date;
          if (!date) return;
          if (!byDate[date]) byDate[date] = {};
          
          // Load all currency pair columns (e.g., eurusd, gbpusd, jpyusd, etc.)
          Object.keys(row).forEach((key) => {
            if (key === "date") return;
            const value = Number(row[key]);
            if (Number.isFinite(value)) {
              // Convert column name (e.g., "eurusd") to pair format (e.g., "EUR/USD")
              const pairCode = key.slice(0, -3).toUpperCase(); // Remove "usd" suffix and uppercase
              const pairKey = `${pairCode}/USD`;
              byDate[date][pairKey] = value;
            }
          });
        });
        return byDate;
      } catch (_) {
        // Try next candidate
      }
    }
    return {};
  }

  function mergePriceRowsWithFxDates(priceRows, fxByDate) {
    const byIso = new Map();
    (priceRows || []).forEach((row) => {
      byIso.set(toIsoDate(row.date), row);
    });
    Object.keys(fxByDate || {}).forEach((isoDate) => {
      if (byIso.has(isoDate)) return;
      const date = new Date(`${isoDate}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) return;
      byIso.set(isoDate, {
        date,
        price: null,
        blockHeight: null,
        usdbtcSats: null,
      });
    });
    return Array.from(byIso.values()).sort((a, b) => a.date - b.date);
  }

  function populateCurrencyDropdowns() {
    if (!uoaPairs || !uoaPairs.currencies) return;
    const currencies = Object.keys(uoaPairs.currencies);
    availableCurrencies = ["BTC", ...currencies.filter(c => c !== "BTC")];

    // Update primary UoA select
    const primarySelect = el.primaryUoaSelect;
    if (primarySelect) {
      primarySelect.innerHTML = availableCurrencies
        .map((c) => `<option value="${c}">${c}</option>`)
        .join("");
      primarySelect.value = "BTC";
    }

    // Update secondary UoA select
    const secondarySelect = el.secondaryUoaSelect;
    if (secondarySelect) {
      secondarySelect.innerHTML = availableCurrencies
        .map((c) => `<option value="${c}">${c}</option>`)
        .join("");
      secondarySelect.value = "USD";
    }

    if (!isRenderingDateRangeExportFrame) syncAllDropdowns();
  }

  function getActiveOrderMode() {
    const selected = el.orderBySelect?.value;
    return ORDER_MODES.includes(selected) ? selected : "alpha-asc";
  }

  function getLatestBtcRow() {
    for (let i = allRows.length - 1; i >= 0; i -= 1) {
      const row = allRows[i];
      if (Number.isFinite(row?.price) && row.price > 0) return row;
    }
    return null;
  }

  function getLatestCurrencySatsValues() {
    const rowPool = allRows;
    if (!rowPool.length) return {};

    // Use the most recent row where BTC is valid and at least one fiat FX value exists,
    // so ordering remains stable around weekends/holidays without forcing full coverage.
    let latestRow = null;
    let latestIsoDate = "";
    for (let i = rowPool.length - 1; i >= 0; i -= 1) {
      const candidate = rowPool[i];
      const isoDate = toIsoDate(candidate.date);
      if (!Number.isFinite(candidate.price) || candidate.price <= 0) continue;

      let hasAnyFiatFx = false;
      for (const currencyCode of availableCurrencies) {
        if (currencyCode === "BTC") continue;
        const fxValue = getFxRate(isoDate, `${currencyCode}/USD`);
        if (Number.isFinite(fxValue) && fxValue > 0) {
          hasAnyFiatFx = true;
          break;
        }
      }
      if (hasAnyFiatFx) {
        latestRow = candidate;
        latestIsoDate = isoDate;
        break;
      }
    }

    // Fallback to the most recent row if complete FX coverage wasn't found.
    if (!latestRow) {
      latestRow = rowPool[rowPool.length - 1];
      latestIsoDate = toIsoDate(latestRow.date);
    }

    const isoDate = latestIsoDate;
    const btcUsd = latestRow.price;
    if (!Number.isFinite(btcUsd) || btcUsd <= 0) return {};
    const values = {};
    availableCurrencies.forEach((currencyCode) => {
      const valueInUsd = currencyCode === "BTC"
        ? btcUsd
        : getCurrencyValueInUsd(currencyCode, latestRow, isoDate);
      if (Number.isFinite(valueInUsd) && valueInUsd > 0) {
        // Value basis for ordering/ranking: sats per 1 unit of currency.
        values[currencyCode] = (100000000 * valueInUsd) / btcUsd;
      }
    });
    return values;
  }

  function getBtcRowOnOrBeforeIso(isoDate) {
    if (!allRows.length) return null;
    let index = getDateIndexOnOrBefore(isoDate);
    if (index < 0) index = allRows.length - 1;
    for (let i = Math.min(index, allRows.length - 1); i >= 0; i -= 1) {
      const row = allRows[i];
      if (Number.isFinite(row?.price) && row.price > 0) return row;
    }
    return null;
  }

  function getCurrencySatsValuesForRow(row) {
    if (!row) return {};
    const isoDate = toIsoDate(row.date);
    const btcUsd = row.price;
    if (!Number.isFinite(btcUsd) || btcUsd <= 0) return {};
    const values = {};
    availableCurrencies.forEach((currencyCode) => {
      const valueInUsd = currencyCode === "BTC"
        ? btcUsd
        : getCurrencyValueInUsd(currencyCode, row, isoDate);
      if (Number.isFinite(valueInUsd) && valueInUsd > 0) {
        values[currencyCode] = (100000000 * valueInUsd) / btcUsd;
      }
    });
    return values;
  }

  function sortCurrencies(orderMode, usdValuesByCurrency) {
    const values = usdValuesByCurrency || {};
    const codes = [...availableCurrencies];
    if (orderMode === "alpha-desc") {
      return codes.sort((a, b) => b.localeCompare(a));
    }
    if (orderMode === "value-desc" || orderMode === "value-asc") {
      const sign = orderMode === "value-desc" ? -1 : 1;
      return codes.sort((a, b) => {
        const av = Number.isFinite(values[a]) ? values[a] : null;
        const bv = Number.isFinite(values[b]) ? values[b] : null;
        if (av === null && bv === null) return a.localeCompare(b);
        if (av === null) return 1;
        if (bv === null) return -1;
        if (av === bv) return a.localeCompare(b);
        return av < bv ? -1 * sign : 1 * sign;
      });
    }
    return codes.sort((a, b) => a.localeCompare(b));
  }

  function applyCurrencyOrdering() {
    if (!el.primaryUoaSelect || !el.secondaryUoaSelect) return;
    const primaryCurrent = el.primaryUoaSelect.value;
    const secondaryCurrent = el.secondaryUoaSelect.value;
    const orderedCurrencies = sortCurrencies(getActiveOrderMode(), getLatestCurrencySatsValues());

    const optionsHtml = orderedCurrencies
      .map((code) => `<option value="${code}">${code}</option>`)
      .join("");

    el.primaryUoaSelect.innerHTML = optionsHtml;
    el.secondaryUoaSelect.innerHTML = optionsHtml;

    el.primaryUoaSelect.value = orderedCurrencies.includes(primaryCurrent) ? primaryCurrent : orderedCurrencies[0] || "BTC";

    const fallbackSecondary = orderedCurrencies.find((code) => code !== el.primaryUoaSelect.value) || orderedCurrencies[0] || "USD";
    el.secondaryUoaSelect.value = orderedCurrencies.includes(secondaryCurrent) ? secondaryCurrent : fallbackSecondary;

    if (el.secondaryUoaSelect.value === el.primaryUoaSelect.value) {
      el.secondaryUoaSelect.value = fallbackSecondary;
    }

    syncAllDropdowns();
  }

  function getCurrencyRanksByValue() {
    const values = getLatestCurrencySatsValues();
    return getCurrencyRanksFromSatsValues(values);
  }

  function getCurrencyRanksFromSatsValues(values) {
    const ranked = Object.keys(values).sort((a, b) => {
      if (values[a] === values[b]) return a.localeCompare(b);
      return values[b] - values[a];
    });
    const rankMap = {};
    ranked.forEach((code, index) => {
      rankMap[code] = index + 1;
    });
    return rankMap;
  }

  function fmtUsd(v) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v);
  }

  function fmtSats(v) {
    if (!Number.isFinite(v) || v <= 0) return "0 sats";

    if (v > 1000000000000) {
      return `${(v / 1000000000000).toFixed(2)}T sats`;
    }

    if (v > 1000000000) {
      return `${(v / 1000000000).toFixed(2)}B sats`;
    }

    if (v > 1000000) {
      return `${(v / 1000000).toFixed(2)}M sats`;
    }

    const formatWithSatsDigitRules = (unitValue, unitLabel) => {
      let decimals = 0;
      if (unitValue < 1) {
        decimals = 3;
      } else if (unitValue < 10) {
        decimals = 2;
      } else if (unitValue < 100) {
        decimals = 1;
      }
      const formatted = unitValue.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
      return `${formatted} ${unitLabel}`;
    };

    if (v < 0.01) {
      const msats = v * 1000;
      if (msats < 0.01) {
        const microsats = msats * 1000;
        return formatWithSatsDigitRules(microsats, "μsats");
      }
      return formatWithSatsDigitRules(msats, "msats");
    }

    return formatWithSatsDigitRules(v, "sats");
  }

  function fmtSatAxisLabel(v) {
    if (!Number.isFinite(v) || v < 0) return "0";
    if (v === 0) return "0 sats";
    if (v >= 100000000) {
      const btc = v / 100000000;
      if (btc >= 1000000000000) {
        const t = btc / 1000000000000;
        return `${(t >= 10 ? t.toFixed(0) : t.toFixed(1)).replace(/\.0$/, "")}T BTC`;
      }
      if (btc >= 1000000000) {
        const b = btc / 1000000000;
        return `${(b >= 10 ? b.toFixed(0) : b.toFixed(1)).replace(/\.0$/, "")}B BTC`;
      }
      if (btc >= 1000000) {
        const m = btc / 1000000;
        return `${(m >= 10 ? m.toFixed(0) : m.toFixed(1)).replace(/\.0$/, "")}M BTC`;
      }
      if (btc >= 1000) {
        const k = btc / 1000;
        return `${(k >= 10 ? k.toFixed(0) : k.toFixed(1)).replace(/\.0$/, "")}k BTC`;
      }
      const txt = btc >= 10 ? btc.toFixed(0) : btc.toFixed(2);
      return `${txt.replace(/\.00$/, "")} BTC`;
    }
    if (v >= 1000000000000) return `${(v / 1000000000000).toFixed(1).replace(/\.0$/, "")}T sats`;
    if (v >= 1000000000) return `${(v / 1000000000).toFixed(1).replace(/\.0$/, "")}B sats`;
    if (v >= 1000000) return `${(v / 1000000).toFixed(1).replace(/\.0$/, "")}M sats`;
    if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k sats`;
    if (v >= 1) return `${Math.round(v)} sats`;

    const msats = v * 1000;
    if (msats >= 1) {
      const msatText = msats >= 100 ? msats.toFixed(0) : msats >= 10 ? msats.toFixed(1) : msats.toFixed(2);
      return `${msatText.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1")} msats`;
    }

    const usats = v * 1000000;
    const usatText = usats >= 100 ? usats.toFixed(0) : usats >= 10 ? usats.toFixed(1) : usats.toFixed(2);
    return `${usatText.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1")} μsat`;
  }

  function fmtUsdSix(v) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 6,
      maximumFractionDigits: 6,
    }).format(v);
  }

  function fmtBtc(v) {
    if (!Number.isFinite(v) || v <= 0) return "0.00000000 BTC";
    return `${v.toFixed(8)} BTC`;
  }

  function fmtCurrencyToBtcSubtext(currencyUnit, btcValue) {
    if (!Number.isFinite(btcValue) || btcValue <= 0) {
      return `${currencyUnit} = 0.00000000 BTC`;
    }
    if (btcValue < 0.00000001) {
      return `${currencyUnit} < 0.00000001 BTC`;
    }
    return `${currencyUnit} = ${fmtBtc(btcValue)}`;
  }

  function fmtDate(d) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function fmtDatePickerLabel(isoVal) {
    if (!isoVal) return "\u2014";
    const [y, m, d] = isoVal.split("-");
    return `${m}/${d}/${y.slice(2)}`;
  }

  function getFxRate(isoDate, pair) {
    if (!fxRatesByDate[isoDate] || !fxRatesByDate[isoDate][pair]) {
      return null;
    }
    return fxRatesByDate[isoDate][pair];
  }

  function getCurrencySymbol(currencyCode) {
    if (currencyCode === "BTC") return "BTC";
    if (!uoaPairs || !uoaPairs.currencies || !uoaPairs.currencies[currencyCode]) {
      return currencyCode;
    }
    return uoaPairs.currencies[currencyCode].symbol || currencyCode;
  }

  function getCurrencyName(currencyCode) {
    if (currencyCode === "BTC") return "bitcoin";
    if (!uoaPairs || !uoaPairs.currencies || !uoaPairs.currencies[currencyCode]) {
      return String(currencyCode || "").toLowerCase();
    }
    const rawName = uoaPairs.currencies[currencyCode].name || currencyCode;
    const normalizedName = String(rawName).replace(/\bUnited\s+States\b/g, "US");
    const parts = normalizedName.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return String(currencyCode || "").toLowerCase();
    if (parts.length === 1) return parts[0].toLowerCase();
    return `${parts.slice(0, -1).join(" ")} ${parts[parts.length - 1].toLowerCase()}`;
  }

  function getTitleUnitLabel(currencyCode) {
    const preciousMetalUnits = {
      XAU: "oz gold",
      XAG: "oz silver",
      XPT: "oz platinum",
      XPD: "oz palladium",
    };
    return preciousMetalUnits[currencyCode] || currencyCode;
  }

  function getCurrencySymbolPosition(currencyCode) {
    if (currencyCode === "BTC") return "right";
    if (!uoaPairs || !uoaPairs.currencies || !uoaPairs.currencies[currencyCode]) {
      return "left";
    }
    return uoaPairs.currencies[currencyCode].symbol_position === "right" ? "right" : "left";
  }

  function formatCurrencyWithSymbol(amountText, currencyCode) {
    const preciousMetalUnitByCode = {
      XAU: "oz",
      XAG: "oz",
      XPT: "oz",
      XPD: "oz",
    };
    if (preciousMetalUnitByCode[currencyCode]) {
      return `${amountText} ${preciousMetalUnitByCode[currencyCode]}`;
    }

    const symbol = getCurrencySymbol(currencyCode);
    if (/^[A-Z]{3}$/i.test(symbol) && symbol.toUpperCase() === String(currencyCode || "").toUpperCase()) {
      return `${amountText} ${symbol.toUpperCase()}`;
    }
    const position = getCurrencySymbolPosition(currencyCode);
    return position === "right" ? `${amountText} ${symbol}` : `${symbol}${amountText}`;
  }

  function formatCurrencyUnit(currencyCode) {
    return formatCurrencyWithSymbol("1", currencyCode);
  }

  function getCurrencyMinorUnits(currencyCode) {
    if (currencyCode === "BTC") return 8;
    if (!uoaPairs || !uoaPairs.currencies || !uoaPairs.currencies[currencyCode]) {
      return 2;
    }
    return uoaPairs.currencies[currencyCode].minor_unit || 2;
  }

  function formatSatValue(satPriceInCurrency, currency) {
    if (!Number.isFinite(satPriceInCurrency)) return "--";
    if (satPriceInCurrency <= 0) return formatCurrencyWithSymbol("0", currency);

    let formatted;
    if (satPriceInCurrency >= 1000000000000) {
      formatted = `${(satPriceInCurrency / 1000000000000).toFixed(2)}T`;
    } else if (satPriceInCurrency >= 1000000000) {
      formatted = `${(satPriceInCurrency / 1000000000).toFixed(2)}B`;
    } else if (satPriceInCurrency >= 1000000) {
      formatted = `${(satPriceInCurrency / 1000000).toFixed(2)}M`;
    } else if (satPriceInCurrency > 100000) {
      formatted = satPriceInCurrency.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });
    } else if (satPriceInCurrency > 10) {
      formatted = satPriceInCurrency.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } else {
      const magnitude = Math.floor(Math.log10(satPriceInCurrency));
      const decimals = Math.min(8, Math.max(3, 3 - magnitude));
      formatted = satPriceInCurrency.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    }

    return formatCurrencyWithSymbol(formatted, currency);
  }

  function isPreciousMetalCurrency(currencyCode) {
    return currencyCode === "XAU" || currencyCode === "XAG" || currencyCode === "XPT" || currencyCode === "XPD";
  }

  function formatCompactOunceYAxisLabel(ouncesValue) {
    if (!Number.isFinite(ouncesValue) || ouncesValue < 0) return "0";
    if (ouncesValue === 0) return "0 oz";
    if (ouncesValue < GRAIN_AXIS_OUNCE_THRESHOLD) {
      return formatCompactGrainYAxisLabel(ouncesValue * GRAINS_PER_TROY_OUNCE);
    }

    let formatted;
    if (ouncesValue >= 1000000000000) {
      const t = ouncesValue / 1000000000000;
      formatted = t >= 10 ? `${t.toFixed(0)}T` : `${t.toFixed(1)}T`;
    } else if (ouncesValue >= 1000000000) {
      const b = ouncesValue / 1000000000;
      formatted = b >= 10 ? `${b.toFixed(0)}B` : `${b.toFixed(1)}B`;
    } else if (ouncesValue >= 1000000) {
      const m = ouncesValue / 1000000;
      formatted = m >= 10 ? `${m.toFixed(0)}M` : `${m.toFixed(1)}M`;
    } else if (ouncesValue >= 100000) {
      const k = ouncesValue / 1000;
      formatted = k >= 100 ? `${k.toFixed(0)}k` : `${k.toFixed(1)}k`;
    } else if (ouncesValue >= 1000) {
      const k = ouncesValue / 1000;
      const kDecimals = k < 10 ? 2 : 1;
      formatted = `${k.toFixed(kDecimals)}k`;
    } else if (ouncesValue >= 100) {
      formatted = `${Math.round(ouncesValue)}`;
    } else if (ouncesValue >= 10) {
      formatted = `${ouncesValue.toFixed(1)}`;
    } else if (ouncesValue >= 1) {
      formatted = `${ouncesValue.toFixed(2)}`;
    } else {
      if (ouncesValue > 0 && ouncesValue < 1e-8) {
        formatted = ouncesValue
          .toExponential(2)
          .replace("e+", "e")
          .replace(/e-0+/, "e-");
      } else {
        let decimals = 4;
        if (ouncesValue < 0.01) {
          decimals = 5;
        }
        if (ouncesValue < 0.001) {
          decimals = Math.min(24, Math.max(6, -Math.floor(Math.log10(ouncesValue)) + 3));
        }
        formatted = `${ouncesValue.toFixed(decimals)}`;
      }
    }

    if (formatted.includes(".") && !formatted.includes("e")) {
      formatted = formatted.replace(/\.0+(?=[a-zA-Z]$)/, "");
      formatted = formatted.replace(/(\.\d*?[1-9])0+(?=[a-zA-Z]$)/, "$1");
      formatted = formatted.replace(/0+$/, "");
      if (formatted.endsWith(".")) {
        formatted = formatted.slice(0, -1);
      }
    }

    return `${formatted} oz`;
  }

  function formatCompactGrainYAxisLabel(grainsValue) {
    if (!Number.isFinite(grainsValue) || grainsValue < 0) return "0";
    if (grainsValue === 0) return "0 gr";

    let formatted;
    if (grainsValue >= 1000000) {
      const m = grainsValue / 1000000;
      formatted = m >= 10 ? `${m.toFixed(0)}M` : `${m.toFixed(1)}M`;
    } else if (grainsValue >= 1000) {
      const k = grainsValue / 1000;
      formatted = k >= 10 ? `${k.toFixed(0)}k` : `${k.toFixed(1)}k`;
    } else if (grainsValue >= 100) {
      formatted = `${Math.round(grainsValue)}`;
    } else if (grainsValue >= 10) {
      formatted = grainsValue >= 20 ? `${grainsValue.toFixed(0)}` : `${grainsValue.toFixed(1)}`;
    } else if (grainsValue >= 1) {
      formatted = `${grainsValue.toFixed(2)}`;
    } else if (grainsValue > 0 && grainsValue < 1e-6) {
      formatted = grainsValue
        .toExponential(2)
        .replace("e+", "e")
        .replace(/e-0+/, "e-");
    } else {
      const magnitude = Math.floor(Math.log10(Math.max(grainsValue, 1e-12)));
      const decimals = Math.min(8, Math.max(3, 2 - magnitude));
      formatted = `${grainsValue.toFixed(decimals)}`;
    }

    if (formatted.includes(".") && !formatted.includes("e")) {
      formatted = formatted.replace(/0+$/, "");
      if (formatted.endsWith(".")) {
        formatted = formatted.slice(0, -1);
      }
    }

    return `${formatted} gr`;
  }

  function formatOunceAmount(ouncesValue) {
    if (!Number.isFinite(ouncesValue) || ouncesValue <= 0) return "0 oz";

    const magnitude = Math.floor(Math.log10(Math.max(ouncesValue, 1e-12)));
    const decimals = Math.min(8, Math.max(4, 3 - magnitude));

    let txt = ouncesValue.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

    if (txt.includes(".")) {
      txt = txt.replace(/0+$/, "");
      if (txt.endsWith(".")) txt = txt.slice(0, -1);
    }

    return `${txt} oz`;
  }

  function formatSatSubtextValue(value, currencyCode) {
    if (isPreciousMetalCurrency(currencyCode)) {
      return formatCompactGrainYAxisLabel(value * GRAINS_PER_TROY_OUNCE);
    }
    return formatSatValue(value, currencyCode);
  }

  function formatCompactYAxisLabel(value, currencyCode) {
    if (!Number.isFinite(value) || value < 0) return "0";
    if (value === 0) return formatCurrencyWithSymbol("0", currencyCode);
    
    // For currencies with common minor-unit symbols, show cents/pence below 1 unit.
    if (value < 1) {
      const minorUnitSymbolByCurrency = {
        USD: "¢",
        EUR: "¢",
        GBP: "p",
        CAD: "¢",
        AUD: "¢",
        NZD: "¢",
      };
      const minorSymbol = minorUnitSymbolByCurrency[currencyCode];
      if (minorSymbol) {
        const minorUnitValue = value * 100;
        let minorText;
        if (minorUnitValue >= 10) {
          // Keep cent precision in normal fiat ranges so tight domains do not collapse to repeated labels.
          const centDecimals = minorUnitValue < 1000 ? 2 : 0;
          minorText = minorUnitValue.toFixed(centDecimals);
        } else {
          // Add precision as values get smaller: 0.001¢, 0.0001¢, etc.
          if (minorUnitValue > 0 && minorUnitValue < 1e-20) {
            minorText = minorUnitValue.toExponential(2).replace("e+", "e");
          } else {
            const magnitude = Math.floor(Math.log10(Math.max(minorUnitValue, 1e-30)));
            const decimals = minorUnitValue >= 1
              ? 2
              : Math.min(24, Math.max(2, (-magnitude) + 2));
            minorText = minorUnitValue.toFixed(decimals);
          }
        }
        // Remove trailing zeros, but keep at least one digit after decimal point
        if (minorText.includes(".") && !minorText.includes("e")) {
          minorText = minorText.replace(/0+$/, "");  // Remove trailing zeros
          if (minorText.endsWith(".")) {
            minorText = minorText.slice(0, -1);  // Remove trailing dot if all decimals were zeros
          }
        }
        return `${minorText}${minorSymbol}`;
      }
    }
    
    let formatted;
    
    // Format with suffix for large numbers, keeping decimals consistent
    if (value >= 1000000000000) {
      const t = value / 1000000000000;
      formatted = t >= 10 ? `${t.toFixed(0)}T` : `${t.toFixed(1)}T`;
    } else if (value >= 1000000000) {
      const b = value / 1000000000;
      formatted = b >= 10 ? `${b.toFixed(0)}B` : `${b.toFixed(1)}B`;
    } else if (value >= 1000000) {
      const m = value / 1000000;
      formatted = m >= 10 ? `${m.toFixed(0)}M` : `${m.toFixed(1)}M`;
    } else if (value >= 100000) {
      const k = value / 1000;
      formatted = k >= 100 ? `${k.toFixed(0)}k` : `${k.toFixed(1)}k`;
    } else if (value >= 1000) {
      const k = value / 1000;
      // Preserve more detail in low-thousands ranges to avoid ambiguous labels like repeated "4k".
      const kDecimals = k < 10 ? 2 : 1;
      formatted = `${k.toFixed(kDecimals)}k`;
    } else if (value >= 100) {
      formatted = `${Math.round(value)}`;
    } else if (value >= 10) {
      formatted = `${value.toFixed(1)}`;
    } else if (value >= 1) {
      // Near 1.0, keep more precision so adjacent ticks do not collapse to the same label.
      if (value >= 0.95 && value <= 1.05) {
        formatted = `${value.toFixed(4)}`;
      } else if (value < 2) {
        formatted = `${value.toFixed(3)}`;
      } else {
        formatted = `${value.toFixed(2)}`;
      }
    } else {
      // For very small values, increase precision to avoid showing "0"
      if (value > 0 && value < 1e-8) {
        formatted = value
          .toExponential(2)
          .replace("e+", "e")
          .replace(/e-0+/, "e-");
      } else {
        let decimals = 3;
        if (value < 0.001) {
          decimals = Math.min(24, Math.max(4, -Math.floor(Math.log10(value)) + 2));
        }
        formatted = `${value.toFixed(decimals)}`;
      }
    }
    
    // Remove trailing zeros only from decimal values; keep integer zeros (e.g., 100)
    if (formatted.includes(".") && !formatted.includes("e")) {
      // Remove needless .0 before suffixes (e.g. 1.0k -> 1k)
      formatted = formatted.replace(/\.0+(?=[a-zA-Z]$)/, "");
      // Remove extra trailing zeros before suffixes (e.g. 4.10k -> 4.1k)
      formatted = formatted.replace(/(\.\d*?[1-9])0+(?=[a-zA-Z]$)/, "$1");
      formatted = formatted.replace(/0+$/, "");
      if (formatted.endsWith(".")) {
        formatted = formatted.slice(0, -1);
      }
    }
    
    return formatCurrencyWithSymbol(formatted, currencyCode);
  }

  function formatRateValue(value, currencyCode, opts = {}) {
    if (!Number.isFinite(value)) return "--";
    if (value <= 0) return formatCurrencyWithSymbol("0", currencyCode);

    // Exchange-rate precision by magnitude:
    // >1B: show 2-decimal billions, >1M: show 2-decimal millions, otherwise keep the existing precision rules.
    let formatted;
    if (value >= 1000000000000) {
      formatted = `${(value / 1000000000000).toFixed(2)}T`;
    } else if (value >= 1000000000) {
      formatted = `${(value / 1000000000).toFixed(2)}B`;
    } else if (value >= 1000000) {
      formatted = `${(value / 1000000).toFixed(2)}M`;
    } else if (value > 100000) {
      formatted = value.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });
    } else if (value > 10) {
      formatted = value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } else {
      const magnitude = Math.floor(Math.log10(value));
      const decimals = Math.min(8, Math.max(3, 3 - magnitude));
      formatted = value.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    }

    return formatCurrencyWithSymbol(formatted, currencyCode);
  }

  function getDateBounds() {
    if (!allRows.length) return null;
    return {
      min: toIsoDate(allRows[0].date),
      max: toIsoDate(allRows[allRows.length - 1].date),
    };
  }

  function computeUsdParityStartIso() {
    const parityRow = allRows.find((row) => Number.isFinite(row.price) && row.price >= 1);
    return parityRow ? toIsoDate(parityRow.date) : "";
  }

  function getCurrencyValueInUsd(currencyCode, row, isoDate) {
    if (currencyCode === "USD") return 1;
    if (currencyCode === "BTC") return row.price;
    // For all other currencies, fetch the FX rate
    return getFxRate(isoDate, `${currencyCode}/USD`);
  }

  function transformRowsForCurrencyPair(rowsArray, primaryCurrency, secondaryCurrency) {
    return rowsArray
      .map((row) => {
        const isoDate = toIsoDate(row.date);
        const primaryInUsd = getCurrencyValueInUsd(primaryCurrency, row, isoDate);
        const secondaryInUsd = getCurrencyValueInUsd(secondaryCurrency, row, isoDate);

        if (!Number.isFinite(primaryInUsd) || !Number.isFinite(secondaryInUsd) || primaryInUsd <= 0 || secondaryInUsd <= 0) {
          return null;
        }

        // directPrice: how many units of secondary for 1 unit of primary
        // inversePrice: how many units of primary for 1 unit of secondary
        const directPrice = primaryInUsd / secondaryInUsd;
        const inversePrice = secondaryInUsd / primaryInUsd;

        return {
          date: row.date,
          blockHeight: row.blockHeight,
          directPrice,
          inversePrice,
          satsPerSecondary: primaryCurrency === "BTC" ? inversePrice * 100000000 : null,
          satValueInSecondary: primaryCurrency === "BTC" ? directPrice / 100000000 : null,
        };
      })
      .filter(Boolean);
  }

  function parseIsoDateUtc(isoDate) {
    const d = new Date(`${String(isoDate || "").trim()}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function getRedenominationEvents(currencyCode) {
    const metadataEvents = uoaPairs?.redenomination_events?.[currencyCode];
    if (Array.isArray(metadataEvents) && metadataEvents.length) {
      return metadataEvents
        .map((event) => ({
          date: String(event?.date || "").trim(),
          ratio: Number(event?.ratio),
          ratioLabel: String(event?.ratioLabel || "").trim(),
        }))
        .filter((event) => event.date && Number.isFinite(event.ratio) && event.ratio > 0 && event.ratio !== 1)
        .sort((a, b) => a.date.localeCompare(b.date));
    }

    return Array.isArray(REDENOMINATION_EVENTS[currencyCode])
      ? REDENOMINATION_EVENTS[currencyCode]
      : [];
  }

  function getCurrencyNotableEvents(currencyCode) {
    const metadataEvents = uoaPairs?.notable_events?.[currencyCode];
    if (Array.isArray(metadataEvents) && metadataEvents.length) {
      return metadataEvents
        .map((event) => ({
          date: String(event?.date || "").trim(),
          label: String(event?.label || "").trim(),
          devaluationEstimate: String(event?.devaluationEstimate || "").trim(),
        }))
        .filter((event) => event.date && event.label)
        .sort((a, b) => a.date.localeCompare(b.date));
    }

    return Array.isArray(NOTABLE_EVENTS[currencyCode])
      ? NOTABLE_EVENTS[currencyCode]
      : [];
  }

  function getCumulativeRedenomFactorAtDate(currencyCode, dateObj, anchorDateObj = null) {
    const events = getRedenominationEvents(currencyCode);
    if (!events.length || !(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return 1;
    const hasAnchorDate = anchorDateObj instanceof Date && !Number.isNaN(anchorDateObj.getTime());
    let factor = 1;
    events.forEach((event) => {
      const eventDate = parseIsoDateUtc(event.date);
      if (!eventDate) return;
      if (dateObj < eventDate && (!hasAnchorDate || eventDate <= anchorDateObj)) {
        factor *= Number(event.ratio) || 1;
      }
    });
    return factor;
  }

  function getRedenomAdjustedChartValue(value, dateObj, numeratorCurrency, denominatorCurrency, redenomCurrency = "VES", anchorDateObj = null) {
    if (!Number.isFinite(value) || value <= 0) return value;
    if (!redenomCurrency) return value;
    if (numeratorCurrency !== redenomCurrency && denominatorCurrency !== redenomCurrency) return value;
    // Normalize historical values into post-redenomination units so the line stays continuous.
    // For A/B values: if A is redenominated, pre-event values scale down; if B is redenominated, pre-event values scale up.
    const factor = getCumulativeRedenomFactorAtDate(redenomCurrency, dateObj, anchorDateObj);
    if (numeratorCurrency === redenomCurrency) return value / factor;
    if (denominatorCurrency === redenomCurrency) return value * factor;
    return value;
  }

  function convertAdjustedTickToRawByFactor(tickValue, factor, numeratorCurrency, denominatorCurrency, redenomCurrency = "VES") {
    if (!Number.isFinite(tickValue) || tickValue <= 0 || !Number.isFinite(factor) || factor <= 0) return null;
    if (!redenomCurrency) return null;
    if (numeratorCurrency === redenomCurrency) return tickValue * factor;
    if (denominatorCurrency === redenomCurrency) return tickValue / factor;
    return null;
  }

  function createChartEventTooltip() {
    if (chartEventTooltipEl) return chartEventTooltipEl;
    const node = document.createElement("div");
    node.className = "chart-event-tooltip";
    node.style.display = "none";
    document.body.appendChild(node);
    chartEventTooltipEl = node;
    return node;
  }

  function hideChartEventTooltip() {
    if (!chartEventTooltipEl) return;
    chartEventTooltipEl.style.display = "none";
  }

  function showChartEventTooltip(text, clientX, clientY, boundsRect = null) {
    const tip = createChartEventTooltip();
    tip.textContent = text;
    tip.style.display = "block";

    const margin = 8;
    const offsetX = 10;
    const offsetY = 10;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const rect = boundsRect || { left: 0, top: 0, right: vw, bottom: vh };

    let left = clientX + offsetX;
    let top = clientY - tip.offsetHeight - offsetY;

    const minLeft = rect.left + margin;
    const maxLeft = rect.right - margin - tip.offsetWidth;
    if (Number.isFinite(minLeft) && Number.isFinite(maxLeft)) {
      if (maxLeft >= minLeft) {
        left = Math.min(Math.max(left, minLeft), maxLeft);
      } else {
        left = minLeft;
      }
    }

    const minTop = rect.top + margin;
    const maxTop = rect.bottom - margin - tip.offsetHeight;
    if (Number.isFinite(minTop) && Number.isFinite(maxTop)) {
      if (maxTop >= minTop) {
        top = Math.min(Math.max(top, minTop), maxTop);
      } else {
        top = minTop;
      }
    }

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  function bindChartEventHover(canvas) {
    if (!canvas || canvas.dataset.eventHoverBound === "1") return;
    canvas.dataset.eventHoverBound = "1";

    canvas.addEventListener("mousemove", (event) => {
      const markers = chartEventMarkersById[canvas.id] || [];
      if (!markers.length) {
        hideChartEventTooltip();
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const hit = markers.find((marker) => {
        const dx = x - marker.x;
        const dy = y - marker.y;
        return (dx * dx) + (dy * dy) <= (marker.radius * marker.radius);
      });

      if (!hit) {
        hideChartEventTooltip();
        return;
      }

      showChartEventTooltip(hit.tooltip, event.clientX, event.clientY, rect);
    });

    canvas.addEventListener("mouseleave", hideChartEventTooltip);
  }

  function drawStar(ctx, cx, cy, outerRadius = 7, innerRadius = 3.2, points = 5) {
    const step = Math.PI / points;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i += 1) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (-Math.PI / 2) + (i * step);
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function dedupeByLabel(items) {
    const seen = new Set();
    const out = [];
    items.forEach((item) => {
      const key = `${item.label}|${item.value}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(item);
    });
    return out;
  }

  function setDropdownOpen(dropdownEl, menuEl, isOpen) {
    if (!menuEl) return;
    const open = !!isOpen;
    menuEl.classList.toggle("open", open);
    if (dropdownEl) {
      dropdownEl.classList.toggle("is-open", open);
      dropdownEl.setAttribute("aria-expanded", String(open));
      if (dropdownEl.parentElement?.classList.contains("chip-menu-wrap")) {
        dropdownEl.parentElement.classList.toggle("is-open", open);
      }
    }
  }

  function closeAllDropdowns(exceptDropdown = null) {
    DROPDOWNS.forEach((config) => {
      const { dropdownId, menuId } = config;
      const dropdown = document.getElementById(dropdownId);
      const menu = document.getElementById(menuId);
      if (!dropdown || !menu) return;
      if (exceptDropdown && dropdown === exceptDropdown) return;
      clearDropdownSearchInput(config);
      setDropdownOpen(dropdown, menu, false);
    });
  }

  function closeAllOverlays() {
    overlayClosers.forEach((fn) => fn());
    closeAllDropdowns();
  }

  function autoSizeDropdown(config, options) {
    if (config.selectId === "updatedTimeZoneSelect") return;
    const dropdown = document.getElementById(config.dropdownId);
    const valueEl = document.getElementById(config.valueId);
    if (!dropdown || !valueEl || !Array.isArray(options)) return;

    const probe = document.createElement("canvas");
    const ctx = probe.getContext("2d");
    if (!ctx) return;

    const styles = getComputedStyle(valueEl);
    const font = [
      styles.fontStyle,
      styles.fontVariant,
      styles.fontWeight,
      styles.fontSize,
      styles.fontFamily,
    ].filter(Boolean).join(" ");
    if (font) ctx.font = font;

    const contentPad = parseFloat(styles.getPropertyValue("--dca-dropdown-content-pad")) || 10;
    const arrowGap = parseFloat(styles.getPropertyValue("--dca-dropdown-arrow-gap")) || 18;
    const extraBuffer = 2;
    const maxAllowed = Math.max(120, window.innerWidth - 48);

    if (config.searchable && valueEl.tagName === "INPUT") {
      const select = document.getElementById(config.selectId);
      const selectedOption = select?.options?.[select.selectedIndex];
      const selectedText = selectedOption ? selectedOption.textContent : "";
      const activeText = String(valueEl.value || "");
      const textForWidth = activeText.trim() && activeText !== selectedText && activeText.length > 3
        ? activeText
        : (selectedText || "WWW");
      const minLabelWidth = ctx.measureText("WWW").width;
      const typedWidth = ctx.measureText(textForWidth).width;
      const desired = Math.ceil(Math.max(minLabelWidth, typedWidth) + contentPad + arrowGap + extraBuffer);
      const clamped = Math.min(desired, maxAllowed);
      dropdown.style.width = `${clamped}px`;
      dropdown.style.minWidth = `${clamped}px`;
      return;
    }

    if (!options.length) return;
    const longestWidth = options.reduce((max, option) => {
      const label = option.textContent || "";
      return Math.max(max, ctx.measureText(label).width);
    }, 0);

    // right padding already includes the caret area via --dca-dropdown-arrow-gap
    const desired = Math.ceil(longestWidth + contentPad + arrowGap + extraBuffer);
    dropdown.style.width = "";
    dropdown.style.minWidth = `${Math.min(desired, maxAllowed)}px`;
  }

  function getDropdownSearchText(option) {
    const code = String(option?.value || "").toUpperCase();
    const currencyName = getCurrencyName(code);
    return `${code} ${currencyName}`.toLowerCase();
  }

  function getDropdownInputSearchTerm(dropdown, valueEl, selectedText) {
    if (!valueEl || valueEl.tagName !== "INPUT") return "";
    if (!dropdown?.classList.contains("is-open")) return "";
    const raw = String(valueEl.value || "").trim();
    return raw === String(selectedText || "") ? "" : raw;
  }

  function getDropdownOptionsForConfig(config, select) {
    let optionsToShow = Array.from(select?.options || []);
    // Secondary dropdown should not offer the currently selected primary.
    if (config.selectId === "secondaryUoaSelect") {
      const primaryValue = el.primaryUoaSelect?.value;
      if (primaryValue) {
        optionsToShow = optionsToShow.filter((opt) => opt.value !== primaryValue);
      }
    }
    return optionsToShow;
  }

  function getDropdownSearchMatches(config, select, searchTerm) {
    const normalizedTerm = String(searchTerm || "").trim().toLowerCase();
    const optionsToShow = getDropdownOptionsForConfig(config, select);
    if (!normalizedTerm) return optionsToShow;
    return optionsToShow.filter((option) => getDropdownSearchText(option).includes(normalizedTerm));
  }

  function clearDropdownSearchInput(config) {
    if (!config.searchable || !config.valueId) return;
    const select = document.getElementById(config.selectId);
    const valueEl = document.getElementById(config.valueId);
    if (!select || !valueEl || valueEl.tagName !== "INPUT") return;
    const selectedOption = select.options[select.selectedIndex];
    valueEl.value = selectedOption ? selectedOption.textContent : "";
    valueEl.dataset.lastValidSearch = "";
    valueEl.dataset.highlightedIndex = "-1";
  }

  function setDropdownHighlightedIndex(menu, valueEl, nextIndex) {
    if (!menu || !valueEl) return;
    const buttons = Array.from(menu.querySelectorAll(".dca-option-btn:not(:disabled)"));
    if (!buttons.length) {
      valueEl.dataset.highlightedIndex = "-1";
      return;
    }
    const safeIndex = ((nextIndex % buttons.length) + buttons.length) % buttons.length;
    buttons.forEach((button, index) => {
      button.classList.toggle("dca-option-btn--active", index === safeIndex);
    });
    valueEl.dataset.highlightedIndex = String(safeIndex);
    buttons[safeIndex].scrollIntoView({ block: "nearest" });
  }

  function getDropdownHighlightedButton(menu, valueEl) {
    if (!menu || !valueEl) return null;
    const buttons = Array.from(menu.querySelectorAll(".dca-option-btn:not(:disabled)"));
    const highlightedIndex = Number(valueEl.dataset.highlightedIndex);
    if (!Number.isInteger(highlightedIndex) || highlightedIndex < 0 || highlightedIndex >= buttons.length) return null;
    return buttons[highlightedIndex] || null;
  }

  function selectDropdownValue(config, select, dropdown, menu, valueEl, nextValue) {
    if (!select || !nextValue) return;
    if (select.value !== nextValue) {
      select.value = nextValue;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    clearDropdownSearchInput(config);
    syncDropdownMenu(config);
    setDropdownOpen(dropdown, menu, false);
    if (valueEl?.tagName === "INPUT") valueEl.blur();
  }

  function getDropdownSelectedButtonIndex(menu, select) {
    const buttons = Array.from(menu?.querySelectorAll(".dca-option-btn:not(:disabled)") || []);
    if (!buttons.length || !select) return -1;
    return buttons.findIndex((button) => button.dataset.value === select.value);
  }

  function handleDropdownKeyboardEvent(event, config, select, dropdown, menu, valueEl) {
    const keyboardStateEl = valueEl || dropdown;
    if (!keyboardStateEl) return false;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (!menu.classList.contains("open")) {
        closeAllOverlays();
        closeAllDropdowns(dropdown);
        setDropdownOpen(dropdown, menu, true);
        syncDropdownMenu(config);
      }
      const buttons = Array.from(menu.querySelectorAll(".dca-option-btn:not(:disabled)"));
      if (!buttons.length) return true;
      const currentIndex = Number(keyboardStateEl.dataset.highlightedIndex);
      const selectedIndex = getDropdownSelectedButtonIndex(menu, select);
      const fallbackIndex = Number.isInteger(currentIndex) && currentIndex >= 0
        ? currentIndex
        : (selectedIndex >= 0 ? selectedIndex : (event.key === "ArrowDown" ? -1 : 0));
      const nextIndex = fallbackIndex + (event.key === "ArrowDown" ? 1 : -1);
      setDropdownHighlightedIndex(menu, keyboardStateEl, nextIndex);
      return true;
    }

    if (event.key === "Enter") {
      const highlightedButton = getDropdownHighlightedButton(menu, keyboardStateEl);
      const typedCode = String(valueEl?.value || "").trim().toUpperCase();
      const exactOption = config.searchable && /^[A-Z]{3}$/.test(typedCode)
        ? getDropdownOptionsForConfig(config, select).find((option) => option.value === typedCode)
        : null;
      const nextValue = highlightedButton?.dataset.value || exactOption?.value || "";
      if (nextValue) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        selectDropdownValue(config, select, dropdown, menu, valueEl, nextValue);
        return true;
      }
      if (!menu.classList.contains("open")) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        closeAllOverlays();
        closeAllDropdowns(dropdown);
        setDropdownOpen(dropdown, menu, true);
        syncDropdownMenu(config);
        const selectedIndex = getDropdownSelectedButtonIndex(menu, select);
        if (selectedIndex >= 0) setDropdownHighlightedIndex(menu, keyboardStateEl, selectedIndex);
        return true;
      }
    }

    if (event.key === "Escape" && menu.classList.contains("open")) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      clearDropdownSearchInput(config);
      setDropdownOpen(dropdown, menu, false);
      if (valueEl?.tagName === "INPUT") valueEl.blur();
      return true;
    }

    return false;
  }

  function syncDropdownMenu(config) {
    const select = document.getElementById(config.selectId);
    const dropdown = document.getElementById(config.dropdownId);
    const trigger = document.getElementById(config.triggerId);
    const menu = document.getElementById(config.menuId);
    const valueEl = config.valueId ? document.getElementById(config.valueId) : null;
    if (!select || !menu) return;

    const selectedOption = select.options[select.selectedIndex];
    const selectedText = selectedOption ? selectedOption.textContent : "";
    if (trigger && config.selectId === "updatedTimeZoneSelect") {
      trigger.textContent = selectedText;
    }
    if (valueEl) {
      if (valueEl.tagName === "INPUT") {
        if (!dropdown?.classList.contains("is-open")) valueEl.value = selectedText;
      } else {
        valueEl.textContent = selectedText;
      }
    }

    const searchTerm = config.searchable ? getDropdownInputSearchTerm(dropdown, valueEl, selectedText).toLowerCase() : "";
    const optionsToShow = getDropdownSearchMatches(config, select, searchTerm);
    const keyboardStateEl = valueEl || dropdown;
    if (keyboardStateEl) keyboardStateEl.dataset.highlightedIndex = "-1";

    autoSizeDropdown(config, optionsToShow);

    menu.innerHTML = optionsToShow.length
      ? optionsToShow
        .map((option) => {
          const selectedClass = option.value === select.value ? " dca-option-btn--selected" : "";
          return `<button type=\"button\" class=\"dca-option-btn${selectedClass}\" data-value=\"${option.value}\">${option.textContent || ""}</button>`;
        })
        .join("")
      : `<button type="button" class="dca-option-btn" disabled>No matches</button>`;
  }

  function populateUpdatedTimeZoneSelect() {
    const select = document.getElementById("updatedTimeZoneSelect");
    if (!select) return;

    const options = getDashboardTimeZoneOptions();
    select.innerHTML = options
      .map((option) => `<option value="${option.value}">${option.label}</option>`)
      .join("");

    const preferred = getPreferredDashboardTimeZone();
    const hasPreferred = options.some((option) => option.value === preferred);
    updatedKpiTimeZone = hasPreferred ? preferred : (options[0]?.value || "UTC");
    select.value = updatedKpiTimeZone;
    const dropdownConfig = DROPDOWNS.find((config) => config.selectId === "updatedTimeZoneSelect");
    if (dropdownConfig) syncDropdownMenu(dropdownConfig);
  }

  function getPreferredDashboardTimeZone() {
    if (DASHBOARD_TIME?.getPreferredTimeZone) return DASHBOARD_TIME.getPreferredTimeZone();
    return updatedKpiTimeZone || "UTC";
  }

  function setPreferredDashboardTimeZone(value) {
    const next = String(value || "UTC").trim() || "UTC";
    let normalized = next;
    if (DASHBOARD_TIME?.setPreferredTimeZone) {
      normalized = DASHBOARD_TIME.setPreferredTimeZone(normalized);
    }
    updatedKpiTimeZone = normalized || next;
    return updatedKpiTimeZone;
  }

  function getDashboardTimeZoneOptions() {
    if (DASHBOARD_TIME?.getTimeZoneOptions) return DASHBOARD_TIME.getTimeZoneOptions();
    return [{ value: "UTC", label: "UTC - Greenwich Mean Time (GMT)" }];
  }

  function withParenthesizedZone(text) {
    const normalized = String(text || "").trim();
    if (!normalized) return normalized;
    if (/\([^()]+\)\s*$/.test(normalized)) return normalized;
    const match = normalized.match(/^(.*\d{2}:\d{2})(?:\s+([A-Za-z][A-Za-z0-9_:+\/-]*))$/);
    if (!match) return normalized;
    return `${match[1].trimEnd()} (${match[2].trim()})`;
  }

  function normalizeUpdatedTimestampInput(rawText) {
    const raw = String(rawText || "").trim();
    if (!raw) return "";
    return raw.endsWith("UTC")
      ? `${raw.replace(/\s+UTC$/, "").replace(" ", "T")}Z`
      : raw;
  }

  function formatUpdatedKpiTimestamp(dateValue) {
    if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return "--";
    if (!DASHBOARD_TIME?.formatUtcTimestamp) return fmtDate(dateValue);
    const formatted = DASHBOARD_TIME.formatUtcTimestamp(dateValue.toISOString(), updatedKpiTimeZone || "UTC");
    return withParenthesizedZone(formatted?.text || fmtDate(dateValue));
  }

  function formatUpdatedDisplayText(rawText) {
    const cleaned = String(rawText || "").trim();
    if (!cleaned) return "--";
    if (!DASHBOARD_TIME?.formatUtcTimestamp) return withParenthesizedZone(cleaned);
    const formatted = DASHBOARD_TIME.formatUtcTimestamp(normalizeUpdatedTimestampInput(cleaned), updatedKpiTimeZone || "UTC");
    return withParenthesizedZone(formatted?.text || cleaned);
  }

  function syncUpdatedTimeZonePreference(nextTimeZone) {
    const next = String(nextTimeZone || getPreferredDashboardTimeZone() || "UTC").trim() || "UTC";
    if (updatedKpiTimeZone === next) {
      const dropdownConfig = DROPDOWNS.find((config) => config.selectId === "updatedTimeZoneSelect");
      if (dropdownConfig) syncDropdownMenu(dropdownConfig);
      return;
    }
    updatedKpiTimeZone = next;
    const select = document.getElementById("updatedTimeZoneSelect");
    if (select) {
      const hasOption = Array.from(select.options).some((option) => option.value === next);
      if (hasOption) {
        select.value = next;
      } else {
        populateUpdatedTimeZoneSelect();
      }
    }
    const dropdownConfig = DROPDOWNS.find((config) => config.selectId === "updatedTimeZoneSelect");
    if (dropdownConfig) syncDropdownMenu(dropdownConfig);
    persistFilters();
    renderAll();
  }

  function bindTimeZonePreferenceSync() {
    if (globalTimeZoneSyncBound) return;
    globalTimeZoneSyncBound = true;

    const changeEvent = DASHBOARD_TIME?.CHANGE_EVENT;
    const storageKey = DASHBOARD_TIME?.STORAGE_KEY;
    const handleTimeZoneChange = (event) => {
      const changedTimeZone = String(event?.detail?.timeZone || "").trim();
      syncUpdatedTimeZonePreference(changedTimeZone || getPreferredDashboardTimeZone());
    };
    const handleResync = () => syncUpdatedTimeZonePreference(getPreferredDashboardTimeZone());

    if (changeEvent) {
      window.addEventListener(changeEvent, handleTimeZoneChange);
    }

    if (storageKey) {
      window.addEventListener("storage", (event) => {
        if (event.key !== storageKey) return;
        handleResync();
      });
    }
  }

  function syncAllDropdowns() {
    DROPDOWNS.forEach((config) => syncDropdownMenu(config));
  }

  function bindCustomDropdowns() {
    DROPDOWNS.forEach((config) => {
      const select = document.getElementById(config.selectId);
      const dropdown = document.getElementById(config.dropdownId);
      const trigger = document.getElementById(config.triggerId);
      const menu = document.getElementById(config.menuId);
      if (!select || !dropdown || !trigger || !menu) return;
      if (dropdown.dataset.bound === "1") return;
      dropdown.dataset.bound = "1";
      const valueEl = config.valueId ? document.getElementById(config.valueId) : null;

      const openDropdown = () => {
        closeAllOverlays();
        closeAllDropdowns(dropdown);
        setDropdownOpen(dropdown, menu, true);
        if (config.searchable && valueEl?.tagName === "INPUT") {
          valueEl.dataset.lastValidSearch = "";
        }
        syncDropdownMenu(config);
      };

      trigger.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const willOpen = !menu.classList.contains("open");
        closeAllOverlays();
        closeAllDropdowns(willOpen ? dropdown : null);
        setDropdownOpen(dropdown, menu, willOpen);
        if (willOpen) syncDropdownMenu(config);
      });

      trigger.addEventListener("keydown", (event) => {
        handleDropdownKeyboardEvent(event, config, select, dropdown, menu, valueEl);
      });

      if (config.searchable && valueEl && valueEl.tagName === "INPUT") {
        valueEl.addEventListener("pointerdown", (event) => {
          event.stopPropagation();
        });
        valueEl.addEventListener("click", (event) => {
          event.stopPropagation();
          openDropdown();
          valueEl.select();
        });
        valueEl.addEventListener("focus", () => {
          openDropdown();
          valueEl.select();
        });
        valueEl.addEventListener("input", () => {
          if (!menu.classList.contains("open")) setDropdownOpen(dropdown, menu, true);
          const selectedOption = select.options[select.selectedIndex];
          const selectedText = selectedOption ? selectedOption.textContent : "";
          const nextTerm = getDropdownInputSearchTerm(dropdown, valueEl, selectedText);
          const matches = getDropdownSearchMatches(config, select, nextTerm);
          if (nextTerm && !matches.length) {
            const previous = valueEl.dataset.lastValidSearch || "";
            valueEl.value = previous;
            window.requestAnimationFrame(() => {
              const end = valueEl.value.length;
              valueEl.setSelectionRange(end, end);
            });
            syncDropdownMenu(config);
            return;
          }
          valueEl.dataset.lastValidSearch = nextTerm ? valueEl.value : "";
          syncDropdownMenu(config);
        });
        valueEl.addEventListener("keydown", (event) => {
          handleDropdownKeyboardEvent(event, config, select, dropdown, menu, valueEl);
        });
        valueEl.addEventListener("blur", () => {
          window.setTimeout(() => {
            const active = document.activeElement;
            if (dropdown.contains(active) || menu.contains(active)) return;
            clearDropdownSearchInput(config);
            setDropdownOpen(dropdown, menu, false);
          }, 120);
        });
      }

      menu.addEventListener("click", (event) => {
        const btn = event.target.closest(".dca-option-btn");
        if (!btn || btn.disabled) return;
        event.preventDefault();
        event.stopPropagation();
        selectDropdownValue(config, select, dropdown, menu, valueEl, String(btn.dataset.value || ""));
      });
    });

    syncAllDropdowns();

    if (dropdownGlobalListenersBound) return;
    dropdownGlobalListenersBound = true;

    document.addEventListener("click", (event) => {
      const target = event.target;
      DROPDOWNS.forEach((config) => {
        const { dropdownId, menuId } = config;
        const dropdown = document.getElementById(dropdownId);
        const menu = document.getElementById(menuId);
        if (!dropdown || !menu) return;
        if (dropdown.contains(target) || menu.contains(target)) return;
        clearDropdownSearchInput(config);
        setDropdownOpen(dropdown, menu, false);
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeAllOverlays();
    });
  }

  function makeDatePicker(opts) {
    let popup = null;
    let pickerYear;
    let pickerMonth;
    let pickerView = "days";
    let pickerExpandedYear = null;
    const align = opts.align === "left" ? "left" : "right";

    function isoToDate(iso) {
      if (!iso) return null;
      const [y, m, d] = iso.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      dt.setHours(0, 0, 0, 0);
      return dt;
    }

    function buildCalendar() {
      const selectedIso = opts.getSelected();
      const minDate = isoToDate(opts.getMin());
      const maxDate = isoToDate(opts.getMax());

      const year = pickerYear;
      const month = pickerMonth;
      const monthLabel = new Date(year, month, 1).toLocaleString("default", { month: "long", year: "numeric" });

      const wrap = document.createElement("div");
      wrap.className = "date-picker-popup";

      const header = document.createElement("div");
      header.className = "date-picker-header";
      const prev = document.createElement("button");
      prev.className = "date-picker-nav";
      prev.textContent = "\u2039";
      prev.type = "button";
      prev.addEventListener("click", (event) => {
        event.stopPropagation();
        pickerMonth -= 1;
        if (pickerMonth < 0) {
          pickerMonth = 11;
          pickerYear -= 1;
        }
        rebuildCalendar();
      });
      const next = document.createElement("button");
      next.className = "date-picker-nav";
      next.textContent = "\u203a";
      next.type = "button";
      next.addEventListener("click", (event) => {
        event.stopPropagation();
        pickerMonth += 1;
        if (pickerMonth > 11) {
          pickerMonth = 0;
          pickerYear += 1;
        }
        rebuildCalendar();
      });
      const lbl = document.createElement("span");
      lbl.textContent = monthLabel;
      lbl.className = "date-picker-header-label";
      lbl.title = "Select year / month";
      lbl.addEventListener("click", (event) => {
        event.stopPropagation();
        pickerView = "years";
        pickerExpandedYear = null;
        rebuildCalendar();
      });
      header.append(prev, lbl, next);
      wrap.appendChild(header);

      const grid = document.createElement("div");
      grid.className = "date-picker-grid";
      ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].forEach((d) => {
        const dow = document.createElement("div");
        dow.className = "date-picker-dow";
        dow.textContent = d;
        grid.appendChild(dow);
      });

      const firstDay = new Date(year, month, 1).getDay();
      for (let i = 0; i < firstDay; i += 1) {
        const blank = document.createElement("div");
        blank.className = "date-picker-day dp-empty";
        grid.appendChild(blank);
      }

      const daysInMonth = new Date(year, month + 1, 0).getDate();
      for (let d = 1; d <= daysInMonth; d += 1) {
        const date = new Date(year, month, d);
        date.setHours(0, 0, 0, 0);
        const isoVal = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const isSelected = isoVal === selectedIso;
        const outOfRange = (minDate && date < minDate) || (maxDate && date > maxDate);
        const extraDisabled = opts.isDisabled ? opts.isDisabled(isoVal) : false;

        const cell = document.createElement("div");
        cell.className = "date-picker-day";
        cell.textContent = String(d);

        if (isSelected) {
          cell.classList.add("dp-selected");
        }

        if (outOfRange || extraDisabled) {
          cell.classList.add("dp-disabled");
        } else {
          cell.addEventListener("click", (event) => {
            event.stopPropagation();
            closePopup();
            opts.onSelect(isoVal);
          });
        }
        grid.appendChild(cell);
      }

      wrap.appendChild(grid);
      return wrap;
    }

    function buildYearGrid() {
      const minDate = isoToDate(opts.getMin());
      const maxDate = isoToDate(opts.getMax());
      const minYear = minDate ? minDate.getFullYear() : pickerYear - 10;
      const maxYear = maxDate ? maxDate.getFullYear() : pickerYear + 5;

      const wrap = document.createElement("div");
      wrap.className = "date-picker-popup dp-year-grid-popup";

      const header = document.createElement("div");
      header.className = "date-picker-header";
      const backBtn = document.createElement("button");
      backBtn.className = "date-picker-nav";
      backBtn.textContent = "\u2039";
      backBtn.type = "button";
      backBtn.title = "Back to calendar";
      backBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        pickerView = "days";
        rebuildCalendar();
      });
      const lbl = document.createElement("span");
      lbl.className = "date-picker-header-label";
      lbl.textContent = "Select Year";
      header.append(backBtn, lbl);
      wrap.appendChild(header);

      const grid = document.createElement("div");
      grid.className = "dp-year-grid";
      for (let y = minYear; y <= maxYear; y += 1) {
        const cell = document.createElement("div");
        cell.className = "dp-year-cell";
        if (y === pickerYear) cell.classList.add("dp-year-current");
        const yearLbl = document.createElement("span");
        yearLbl.textContent = String(y);
        const yearChevron = document.createElement("span");
        yearChevron.className = "dp-accordion-chevron";
        yearChevron.textContent = "\u203a";
        cell.append(yearLbl, yearChevron);
        cell.addEventListener("click", (event) => {
          event.stopPropagation();
          pickerView = "year";
          pickerExpandedYear = y;
          rebuildCalendar();
        });
        grid.appendChild(cell);
      }
      wrap.appendChild(grid);
      return wrap;
    }

    function buildYearAccordion() {
      const minDate = isoToDate(opts.getMin());
      const maxDate = isoToDate(opts.getMax());
      const minYear = minDate ? minDate.getFullYear() : pickerYear - 10;
      const maxYear = maxDate ? maxDate.getFullYear() : pickerYear + 5;
      const expandedYear = pickerExpandedYear !== null ? pickerExpandedYear : pickerYear;
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

      const wrap = document.createElement("div");
      wrap.className = "date-picker-popup dp-year-grid-popup";

      const header = document.createElement("div");
      header.className = "date-picker-header";
      const backBtn = document.createElement("button");
      backBtn.className = "date-picker-nav";
      backBtn.textContent = "\u2039";
      backBtn.type = "button";
      backBtn.title = "Back to year list";
      backBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        pickerView = "years";
        pickerExpandedYear = null;
        rebuildCalendar();
      });
      const lbl = document.createElement("span");
      lbl.className = "date-picker-header-label";
      lbl.textContent = "Select Month";
      header.append(backBtn, lbl);
      wrap.appendChild(header);

      const list = document.createElement("div");
      list.className = "dp-accordion-list";

      for (let y = minYear; y <= maxYear; y += 1) {
        const yearRow = document.createElement("div");
        yearRow.className = `dp-accordion-year${y === expandedYear ? " dp-accordion-open" : ""}`;

        const yearBtn = document.createElement("button");
        yearBtn.type = "button";
        yearBtn.className = "dp-accordion-year-btn";
        yearBtn.textContent = String(y);
        const chevron = document.createElement("span");
        chevron.className = "dp-accordion-chevron";
        chevron.textContent = "\u203a";
        yearBtn.appendChild(chevron);
        yearBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          pickerExpandedYear = pickerExpandedYear === y ? null : y;
          rebuildCalendar();
        });
        yearRow.appendChild(yearBtn);

        if (y === expandedYear) {
          const monthGrid = document.createElement("div");
          monthGrid.className = "dp-month-grid";
          monthNames.forEach((name, m) => {
            const minMonth = minDate && y === minDate.getFullYear() ? minDate.getMonth() : -1;
            const maxMonth = maxDate && y === maxDate.getFullYear() ? maxDate.getMonth() : 12;
            const disabled = m < minMonth || m > maxMonth;
            const cell = document.createElement("div");
            cell.className = `dp-month-cell${disabled ? " dp-disabled" : ""}`;
            if (y === pickerYear && m === pickerMonth) cell.classList.add("dp-month-current");
            cell.textContent = name;
            if (!disabled) {
              cell.addEventListener("click", (event) => {
                event.stopPropagation();
                pickerYear = y;
                pickerMonth = m;
                pickerView = "days";
                pickerExpandedYear = null;
                rebuildCalendar();
              });
            }
            monthGrid.appendChild(cell);
          });
          yearRow.appendChild(monthGrid);
        }
        list.appendChild(yearRow);
      }
      wrap.appendChild(list);
      return wrap;
    }

    function positionPopup() {
      if (!popup) return;
      const rect = opts.anchorEl.getBoundingClientRect();
      popup.style.top = `${rect.bottom + 6}px`;
      const idealLeft = align === "left" ? rect.left : rect.right - popup.offsetWidth;
      const maxLeft = Math.max(4, window.innerWidth - popup.offsetWidth - 4);
      const left = Math.min(Math.max(4, idealLeft), maxLeft);
      popup.style.left = `${left}px`;
    }

    function rebuildCalendar() {
      if (!popup) return;
      const fresh = pickerView === "years" ? buildYearGrid() : pickerView === "year" ? buildYearAccordion() : buildCalendar();
      popup.replaceChildren(...fresh.childNodes);
      popup.className = fresh.className;
      requestAnimationFrame(() => {
        positionPopup();
      });
    }

    function openPopup() {
      closeAllOverlays();
      pickerView = "days";
      pickerExpandedYear = null;
      const selectedIso = opts.getSelected();
      if (selectedIso) {
        const [y, m] = selectedIso.split("-").map(Number);
        pickerYear = y;
        pickerMonth = m - 1;
      } else {
        const now = new Date();
        pickerYear = now.getFullYear();
        pickerMonth = now.getMonth();
      }
      popup = buildCalendar();
      document.body.appendChild(popup);
      requestAnimationFrame(positionPopup);
      window.addEventListener("scroll", positionPopup, true);
      window.addEventListener("resize", positionPopup);
    }

    function closePopup() {
      if (!popup) return;
      popup.remove();
      popup = null;
      window.removeEventListener("scroll", positionPopup, true);
      window.removeEventListener("resize", positionPopup);
    }

    function toggle(event) {
      event.stopPropagation();
      if (popup) closePopup();
      else openPopup();
    }

    document.addEventListener("click", closePopup);
    overlayClosers.add(closePopup);

    return { toggle, closePopup, rebuildCalendar };
  }

  function refreshDateButtonLabels() {
    syncDateRangeSlidersFromInputs();
    if (el.startDateBtn) {
      el.startDateBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${fmtDatePickerLabel(el.startDateInput?.value || "")}`;
    }
    if (el.endDateBtn) {
      el.endDateBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${fmtDatePickerLabel(el.endDateInput?.value || "")}`;
    }
    if (el.dateRangeDaysInput || el.rangeDaysLabel) {
      const startVal = String(el.startDateInput?.value || "").trim();
      const endVal = String(el.endDateInput?.value || "").trim();
      const startDate = startVal ? new Date(`${startVal}T00:00:00Z`) : null;
      const endDate = endVal ? new Date(`${endVal}T00:00:00Z`) : null;
      const dayMs = 24 * 60 * 60 * 1000;
      const valid = startDate && endDate
        && !Number.isNaN(startDate.getTime())
        && !Number.isNaN(endDate.getTime())
        && endDate.getTime() >= startDate.getTime();
      const days = valid ? Math.floor((endDate.getTime() - startDate.getTime()) / dayMs) + 1 : 0;
      if (el.dateRangeDaysInput) {
        el.dateRangeDaysInput.dataset.lastValidValue = days > 0 ? String(days) : "";
        if (document.activeElement !== el.dateRangeDaysInput) {
          el.dateRangeDaysInput.value = days > 0 ? days.toLocaleString("en-US") : "";
        }
      }
      if (el.rangeDaysLabel) {
        const daysText = days > 0 ? String(days) : "--";
        el.rangeDaysLabel.innerHTML = `Range <span class="range-days-value">${daysText} Days</span>`;
      }
    }
    updateRangePresetActiveState();
  }

  function getDateIndexFromIso(isoValue) {
    if (!isoValue || !allRows.length) return -1;
    for (let i = 0; i < allRows.length; i += 1) {
      if (toIsoDate(allRows[i].date) === isoValue) return i;
    }
    return -1;
  }

  function updateDateRangeSliderFill(startIndex, endIndex, visualBounds = getDateRangeVisualBounds()) {
    if (!el.dateRangeSliderWrap) return;
    const startPct = getDateRangeVisualPercent(startIndex, visualBounds);
    const endPct = getDateRangeVisualPercent(endIndex, visualBounds);
    el.dateRangeSliderWrap.style.setProperty("--slider-start", `${startPct}%`);
    el.dateRangeSliderWrap.style.setProperty("--slider-end", `${endPct}%`);
    
    // Show remaining animation range whenever a playback session exists,
    // including paused/restored states after reload.
    if (dateRangePlaybackState.hasSession || dateRangeEndSliderScrubState.active) {
      const targetPct = getDateRangeVisualPercent(dateRangePlaybackState.targetEndIndex, visualBounds);
      if (el.dateRangeRemaining) {
        el.dateRangeRemaining.classList.add("active");
        el.dateRangeRemaining.style.left = `${endPct}%`;
        el.dateRangeRemaining.style.right = `calc(100% - ${targetPct}%)`;
      }
    } else {
      if (el.dateRangeRemaining) {
        el.dateRangeRemaining.classList.remove("active");
        el.dateRangeRemaining.style.left = "0";
        el.dateRangeRemaining.style.right = "0";
      }
    }
  }

  function updateDateRangeAvailability(pairBounds) {
    if (!el.dateRangeSliderWrap) return;
    const dataBounds = getPairDataDateIndexBounds();
    const visualBounds = pairBounds || getDateRangeVisualBounds();
    const hasRestriction = !!pairBounds && (pairBounds.minIndex > 0 || pairBounds.maxIndex < Math.max(0, allRows.length - 1));
    const hasMissingData = !!dataBounds && !!pairBounds
      && (dataBounds.minIndex > pairBounds.minIndex || dataBounds.maxIndex < pairBounds.maxIndex);
    const availableStartPct = pairBounds ? getDateRangeVisualPercent(pairBounds.minIndex, visualBounds) : 0;
    const availableEndPct = pairBounds ? getDateRangeVisualPercent(pairBounds.maxIndex, visualBounds) : 100;

    el.dateRangeSliderWrap.classList.toggle("is-restricted", hasRestriction);
    el.dateRangeSliderWrap.style.setProperty("--available-start", `${availableStartPct}%`);
    el.dateRangeSliderWrap.style.setProperty("--available-end", `${availableEndPct}%`);
    const restrictionMessage = hasMissingData ? getDateRangeRestrictionMessage(dataBounds, pairBounds) : "";
    if (restrictionMessage) {
      el.dateRangeSliderWrap.setAttribute("title", restrictionMessage);
      if (el.dateRangeStartSlider) el.dateRangeStartSlider.setAttribute("title", restrictionMessage);
      if (el.dateRangeEndSlider) el.dateRangeEndSlider.setAttribute("title", restrictionMessage);
    } else {
      el.dateRangeSliderWrap.removeAttribute("title");
      if (el.dateRangeStartSlider) el.dateRangeStartSlider.removeAttribute("title");
      if (el.dateRangeEndSlider) el.dateRangeEndSlider.removeAttribute("title");
    }

    const missingStartFrom = hasMissingData ? pairBounds.minIndex : 0;
    const missingStartTo = hasMissingData ? Math.min(dataBounds.minIndex, pairBounds.maxIndex) : 0;
    const missingEndFrom = hasMissingData ? Math.max(dataBounds.maxIndex, pairBounds.minIndex) : visualBounds.maxIndex;
    const missingEndTo = hasMissingData ? pairBounds.maxIndex : visualBounds.maxIndex;
    setRangeTrackSegment(el.dateRangeMissingDataStart, missingStartFrom, missingStartTo, visualBounds);
    setRangeTrackSegment(el.dateRangeMissingDataEnd, missingEndFrom, missingEndTo, visualBounds);
  }

  function setRangeTrackSegment(trackEl, fromIndex, toIndex, visualBounds = getDateRangeVisualBounds()) {
    if (!trackEl) return;
    if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex) || toIndex <= fromIndex) {
      trackEl.classList.remove("active");
      trackEl.style.left = "0";
      trackEl.style.right = "100%";
      return;
    }

    const startPct = getDateRangeVisualPercent(fromIndex, visualBounds);
    const endPct = getDateRangeVisualPercent(toIndex, visualBounds);
    trackEl.style.left = `${startPct}%`;
    trackEl.style.right = `calc(100% - ${endPct}%)`;
    trackEl.classList.add("active");
  }

  function getDateRangeVisualIndex(isoValue, fallbackIndex, prefer = "nearest") {
    if (!allRows.length || !isoValue) return fallbackIndex;
    let index = getDateIndexFromIso(isoValue);
    if (index >= 0) return index;
    index = prefer === "after" ? getDateIndexOnOrAfter(isoValue) : getDateIndexOnOrBefore(isoValue);
    if (index < 0) index = fallbackIndex;
    return Math.max(0, Math.min(Math.max(0, allRows.length - 1), index));
  }

  function setMissingRangeSegment(segmentEl, markerEl, fromIndex, toIndex, markerIndex, visualBounds = getDateRangeVisualBounds()) {
    if (!segmentEl || !markerEl) return;
    if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex) || toIndex <= fromIndex) {
      segmentEl.classList.remove("active");
      markerEl.classList.remove("active");
      segmentEl.style.left = "0";
      segmentEl.style.right = "100%";
      markerEl.style.left = "0";
      return;
    }

    const startPct = getDateRangeVisualPercent(fromIndex, visualBounds);
    const endPct = getDateRangeVisualPercent(toIndex, visualBounds);
    const markerPct = getDateRangeVisualPercent(markerIndex, visualBounds);
    const markerOffsetPx = (DATE_RANGE_THUMB_WIDTH_PX / 2) - (DATE_RANGE_THUMB_WIDTH_PX * markerPct / 100);
    segmentEl.style.left = `${startPct}%`;
    segmentEl.style.right = `calc(100% - ${endPct}%)`;
    markerEl.style.left = `calc(${markerPct}% + ${markerOffsetPx}px)`;
    segmentEl.classList.add("active");
    markerEl.classList.add("active");
  }

  function updateDateRangeMissingSelection(startIndex, endIndex, visualBounds = getDateRangeVisualBounds()) {
    const pairBounds = getPairDateIndexBounds();
    const dataBounds = getPairDataDateIndexBounds();
    const availableStartIndex = dataBounds?.minIndex ?? pairBounds?.minIndex ?? 0;
    const availableEndIndex = dataBounds?.maxIndex ?? pairBounds?.maxIndex ?? visualBounds.maxIndex;
    const primaryStartIndex = pairBounds?.minIndex ?? 0;
    const primaryEndIndex = pairBounds?.maxIndex ?? visualBounds.maxIndex;
    const requestedStartIndex = getDateRangeVisualIndex(requestedDateRange.startIso, startIndex, "after");
    const requestedEndIndex = getDateRangeVisualIndex(requestedDateRange.endIso, endIndex, "before");
    const startMissingFromIndex = Math.max(requestedStartIndex, primaryStartIndex);
    const startMissingEndIndex = Math.min(requestedEndIndex, availableStartIndex);
    const endMissingStartIndex = Math.max(requestedStartIndex, availableEndIndex);
    const endMissingToIndex = Math.min(requestedEndIndex, primaryEndIndex);

    setMissingRangeSegment(
      el.dateRangeMissingSelectionStart,
      el.dateRangeMissingMarkerStart,
      startMissingFromIndex,
      startMissingEndIndex,
      startMissingFromIndex,
      visualBounds
    );
    setMissingRangeSegment(
      el.dateRangeMissingSelectionEnd,
      el.dateRangeMissingMarkerEnd,
      endMissingStartIndex,
      endMissingToIndex,
      endMissingToIndex,
      visualBounds
    );
  }

  function syncDateRangeSlidersFromInputs() {
    if (!el.dateRangeStartSlider || !el.dateRangeEndSlider || !allRows.length) return;
    const pairBounds = getPairDateIndexBounds();
    const controlBounds = getDateRangeControlBounds();
    const visualBounds = getDateRangeVisualBounds();
    const minIndex = controlBounds?.minIndex ?? 0;
    const maxIndex = controlBounds?.maxIndex ?? Math.max(0, allRows.length - 1);
    syncDateControlBoundsToPair(controlBounds);
    updateDateRangeAvailability(pairBounds);
    const startIso = el.startDateInput?.value || toIsoDate(allRows[minIndex].date);
    const endIso = el.endDateInput?.value || toIsoDate(allRows[maxIndex].date);

    let startIndex = getDateIndexFromIso(startIso);
    let endIndex = getDateIndexFromIso(endIso);
    if (startIndex < 0) startIndex = minIndex;
    if (endIndex < 0) endIndex = maxIndex;
    startIndex = Math.max(minIndex, Math.min(maxIndex, startIndex));
    endIndex = Math.max(minIndex, Math.min(maxIndex, endIndex));
    if (maxIndex > minIndex && startIndex > endIndex) {
      if (startIndex >= maxIndex) {
        startIndex = Math.max(minIndex, maxIndex - 1);
        endIndex = maxIndex;
      } else {
        endIndex = startIndex;
      }
    } else if (startIndex > endIndex) {
      startIndex = endIndex;
    }

    el.dateRangeStartSlider.min = String(visualBounds.minIndex);
    el.dateRangeStartSlider.max = String(visualBounds.maxIndex);
    el.dateRangeEndSlider.min = String(visualBounds.minIndex);
    el.dateRangeEndSlider.max = String(visualBounds.maxIndex);
    el.dateRangeStartSlider.value = String(startIndex);
    el.dateRangeEndSlider.value = String(endIndex);
    if (el.startDateInput) el.startDateInput.value = toIsoDate(allRows[startIndex].date);
    if (el.endDateInput) el.endDateInput.value = toIsoDate(allRows[endIndex].date);

    updateDateRangeSliderFill(startIndex, endIndex, visualBounds);
    updateDateRangeMissingSelection(startIndex, endIndex, visualBounds);
    updateDownloadEstimates();
  }

  function handleDateRangeSliderInput(changed) {
    const shouldPreservePlaybackSession = changed === "end" && dateRangePlaybackState.hasSession;
    if (!shouldPreservePlaybackSession) {
      stopDateRangePlayback();
    }
    if (!el.dateRangeStartSlider || !el.dateRangeEndSlider || !allRows.length) return;
    const controlBounds = getDateRangeControlBounds();
    const visualBounds = getDateRangeVisualBounds();
    const safeMinIndex = controlBounds?.minIndex ?? 0;
    const safeMaxIndex = controlBounds?.maxIndex ?? Math.max(0, allRows.length - 1);
    let startIndex = Number(el.dateRangeStartSlider.value);
    let endIndex = Number(el.dateRangeEndSlider.value);

    if (!Number.isFinite(startIndex)) startIndex = safeMinIndex;
    if (!Number.isFinite(endIndex)) endIndex = safeMaxIndex;
    startIndex = Math.max(safeMinIndex, Math.min(safeMaxIndex, startIndex));
    endIndex = Math.max(safeMinIndex, Math.min(safeMaxIndex, endIndex));
    el.dateRangeStartSlider.value = String(startIndex);
    el.dateRangeEndSlider.value = String(endIndex);

    if (safeMaxIndex > safeMinIndex) {
      if (changed === "start" && startIndex > endIndex) {
        startIndex = endIndex;
        el.dateRangeStartSlider.value = String(startIndex);
      }
      if (changed === "end" && endIndex < startIndex) {
        endIndex = startIndex;
        el.dateRangeEndSlider.value = String(endIndex);
      }
      if (startIndex > endIndex) {
        if (startIndex >= safeMaxIndex) {
          startIndex = Math.max(safeMinIndex, safeMaxIndex - 1);
          endIndex = safeMaxIndex;
        } else {
          endIndex = startIndex;
        }
        el.dateRangeStartSlider.value = String(startIndex);
        el.dateRangeEndSlider.value = String(endIndex);
      }
    } else {
      startIndex = safeMinIndex;
      endIndex = safeMaxIndex;
      el.dateRangeStartSlider.value = String(startIndex);
      el.dateRangeEndSlider.value = String(endIndex);
    }

    updateDateRangeSliderFill(startIndex, endIndex, visualBounds);

    const startIso = toIsoDate(allRows[startIndex].date);
    const endIso = toIsoDate(allRows[endIndex].date);
    setRequestedDateRange(startIso, endIso);
    if (el.startDateInput) el.startDateInput.value = startIso;
    if (el.endDateInput) el.endDateInput.value = endIso;

    if (changed === "end" && dateRangePlaybackState.hasSession) {
      dateRangePlaybackState.currentEndIndex = endIndex;
    }

    applyFilters();
  }

  function getDateRangeIndexFromPointerX(clientX) {
    if (!el.dateRangeSliderWrap || !allRows.length) return null;
    const visualBounds = getDateRangeVisualBounds();
    const wrapRect = el.dateRangeSliderWrap.getBoundingClientRect();
    if (!Number.isFinite(wrapRect.width) || wrapRect.width <= 0) return null;
    const minIndex = visualBounds?.minIndex ?? 0;
    const maxIndex = visualBounds?.maxIndex ?? Math.max(0, allRows.length - 1);
    const span = Math.max(1, maxIndex - minIndex);
    const ratio = Math.max(0, Math.min(1, (clientX - wrapRect.left) / wrapRect.width));
    return Math.round(minIndex + ratio * span);
  }

  function applyPlaybackEndScrubIndex(nextIndex) {
    if (!el.dateRangeEndSlider || !allRows.length || !Number.isFinite(nextIndex)) return null;
    const controlBounds = getDateRangeControlBounds();
    const minIndex = controlBounds?.minIndex ?? 0;
    const maxIndex = controlBounds?.maxIndex ?? Math.max(0, allRows.length - 1);
    const clamped = Math.max(minIndex, Math.min(maxIndex, Math.round(nextIndex)));
    el.dateRangeEndSlider.value = String(clamped);
    handleDateRangeSliderInput("end");
    const adjustedEndIndex = Number(el.dateRangeEndSlider.value);
    return Number.isFinite(adjustedEndIndex) ? adjustedEndIndex : null;
  }

  function beginDateRangeEndSliderScrub(event) {
    if (!el.dateRangeEndSlider || !allRows.length) return;
    if (typeof event.button === "number" && event.button !== 0) return;

    dateRangeEndSliderScrubState.active = true;
    dateRangeEndSliderScrubState.pointerId = Number.isFinite(event.pointerId) ? event.pointerId : null;
    dateRangeEndSliderScrubState.resumeAfterRelease = false;
    dateRangeEndSliderScrubState.captureOnWrap = false;

    if (dateRangePlaybackState.isPlaying) {
      pauseDateRangePlayback();
      dateRangeEndSliderScrubState.resumeAfterRelease = true;
    }

    const currentEndIndex = Number(el.dateRangeEndSlider.value);
    if (dateRangePlaybackState.hasSession && Number.isFinite(currentEndIndex)) {
      dateRangePlaybackState.currentEndIndex = currentEndIndex;
    }

    try {
      if (Number.isFinite(event.pointerId)) {
        el.dateRangeEndSlider.setPointerCapture(event.pointerId);
      }
    } catch (_) {
      // Ignore capture failures.
    }
  }

  function beginDateRangeStartSliderScrub(event) {
    if (!el.dateRangeStartSlider || !allRows.length) return;
    if (typeof event.button === "number" && event.button !== 0) return;
    if (!dateRangePlaybackState.hasSession) return;

    stopDateRangePlayback({ restoreOriginalRange: false });
    dateRangeEndSliderScrubState.active = false;
    dateRangeEndSliderScrubState.pointerId = null;
    dateRangeEndSliderScrubState.resumeAfterRelease = false;
    dateRangeEndSliderScrubState.captureOnWrap = false;
  }

  function endDateRangeEndSliderScrub(event) {
    if (!dateRangeEndSliderScrubState.active || !el.dateRangeEndSlider) return;
    if (Number.isFinite(dateRangeEndSliderScrubState.pointerId) && Number.isFinite(event.pointerId)
      && event.pointerId !== dateRangeEndSliderScrubState.pointerId) {
      return;
    }

    try {
      if (dateRangeEndSliderScrubState.captureOnWrap && el.dateRangeSliderWrap && Number.isFinite(event.pointerId)) {
        el.dateRangeSliderWrap.releasePointerCapture(event.pointerId);
      }
      if (!dateRangeEndSliderScrubState.captureOnWrap && Number.isFinite(event.pointerId)) {
        el.dateRangeEndSlider.releasePointerCapture(event.pointerId);
      }
    } catch (_) {
      // Ignore capture failures.
    }

    const shouldResumeAfterRelease = dateRangeEndSliderScrubState.resumeAfterRelease;
    dateRangeEndSliderScrubState.active = false;
    dateRangeEndSliderScrubState.pointerId = null;
    dateRangeEndSliderScrubState.resumeAfterRelease = false;
    dateRangeEndSliderScrubState.captureOnWrap = false;

    if (!dateRangePlaybackState.hasSession) return;

    const currentEndIndex = Number(el.dateRangeEndSlider.value);
    if (Number.isFinite(currentEndIndex)) {
      dateRangePlaybackState.currentEndIndex = currentEndIndex;
    }

    if (Number.isFinite(currentEndIndex)
      && (currentEndIndex < dateRangePlaybackState.startIndex || currentEndIndex >= dateRangePlaybackState.targetEndIndex)) {
      stopDateRangePlayback({ restoreOriginalRange: false });
      return;
    }

    if (!shouldResumeAfterRelease) return;

    startDateRangePlayback();
  }

  function beginDateRangeSegmentDrag(event) {
    if (dateRangeEndSliderScrubState.active && !dateRangeEndSliderScrubState.captureOnWrap) {
      // End-marker scrub is already handling this pointer sequence.
      return;
    }

    if (!el.dateRangeSliderWrap || !el.dateRangeStartSlider || !el.dateRangeEndSlider || !allRows.length) return;
    if (event.button !== 0) return;

    const controlBounds = getDateRangeControlBounds();
    const visualBounds = getDateRangeVisualBounds();
    const minIndex = controlBounds?.minIndex ?? 0;
    const maxIndex = controlBounds?.maxIndex ?? Math.max(0, allRows.length - 1);
    if (maxIndex <= minIndex) return;

    const wrapRect = el.dateRangeSliderWrap.getBoundingClientRect();
    if (!Number.isFinite(wrapRect.width) || wrapRect.width <= 0) return;

    const startIndex = Number(el.dateRangeStartSlider.value);
    const endIndex = Number(el.dateRangeEndSlider.value);
    if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex) || startIndex > endIndex) return;

    const startX = wrapRect.left + (getDateRangeVisualPercent(startIndex, visualBounds) / 100) * wrapRect.width;
    const endX = wrapRect.left + (getDateRangeVisualPercent(endIndex, visualBounds) / 100) * wrapRect.width;
    const pointerX = event.clientX;
    const handleGuardPx = 12;
    const nearStartHandle = Math.abs(pointerX - startX) <= handleGuardPx;
    const nearEndHandle = Math.abs(pointerX - endX) <= handleGuardPx;

    if (nearStartHandle || nearEndHandle) {
      const handle = nearStartHandle && nearEndHandle
        ? (Math.abs(pointerX - startX) <= Math.abs(pointerX - endX) ? "start" : "end")
        : (nearStartHandle ? "start" : "end");

      if (dateRangePlaybackState.hasSession && handle === "start") {
        stopDateRangePlayback({ restoreOriginalRange: false });
      } else if (dateRangePlaybackState.isPlaying && handle === "end") {
        pauseDateRangePlayback();
        dateRangeEndSliderScrubState.resumeAfterRelease = true;
      }

      event.preventDefault();

      dateRangeDragState = {
        mode: handle,
        pointerId: event.pointerId,
        startIndex,
        endIndex,
        minIndex,
        maxIndex,
        visualSpan: Math.max(1, (visualBounds?.maxIndex ?? maxIndex) - (visualBounds?.minIndex ?? minIndex)),
        visualBounds,
        wrapLeft: wrapRect.left,
        wrapWidth: wrapRect.width,
      };

      try {
        el.dateRangeSliderWrap.setPointerCapture(event.pointerId);
      } catch (_) {
        // Ignore capture failures.
      }
      return;
    }

    if (dateRangePlaybackState.hasSession) {
      const clickedIndex = getDateRangeIndexFromPointerX(event.clientX);
      if (!Number.isFinite(clickedIndex)) return;
      event.preventDefault();

      dateRangeEndSliderScrubState.active = true;
      dateRangeEndSliderScrubState.pointerId = Number.isFinite(event.pointerId) ? event.pointerId : null;
      dateRangeEndSliderScrubState.resumeAfterRelease = !!dateRangePlaybackState.isPlaying;
      dateRangeEndSliderScrubState.captureOnWrap = true;

      if (dateRangePlaybackState.isPlaying) {
        pauseDateRangePlayback();
      }

      const adjustedEndIndex = applyPlaybackEndScrubIndex(clickedIndex);
      if (Number.isFinite(adjustedEndIndex)) {
        dateRangePlaybackState.currentEndIndex = adjustedEndIndex;
      }

      try {
        if (el.dateRangeSliderWrap && Number.isFinite(event.pointerId)) {
          el.dateRangeSliderWrap.setPointerCapture(event.pointerId);
        }
      } catch (_) {
        // Ignore capture failures.
      }
      return;
    }

    stopDateRangePlayback();
    if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex) || startIndex >= endIndex) return;

    // Only start drag when clicking the highlighted middle segment, not near handles.
    if (pointerX <= startX + handleGuardPx || pointerX >= endX - handleGuardPx) return;
    if (pointerX < startX || pointerX > endX) return;

    event.preventDefault();

    dateRangeDragState = {
      mode: "range",
      pointerId: event.pointerId,
      startClientX: pointerX,
      startIndex,
      endIndex,
      minIndex,
      maxIndex,
      visualSpan: Math.max(1, (visualBounds?.maxIndex ?? maxIndex) - (visualBounds?.minIndex ?? minIndex)),
      visualBounds,
      wrapLeft: wrapRect.left,
      wrapWidth: wrapRect.width,
    };

    try {
      el.dateRangeSliderWrap.setPointerCapture(event.pointerId);
    } catch (_) {
      // Ignore capture failures.
    }
  }

  function moveDateRangeSegmentDrag(event) {
    if (dateRangeEndSliderScrubState.active) {
      if (Number.isFinite(dateRangeEndSliderScrubState.pointerId)
        && Number.isFinite(event.pointerId)
        && event.pointerId !== dateRangeEndSliderScrubState.pointerId) {
        return;
      }
      event.preventDefault();
      const hoveredIndex = getDateRangeIndexFromPointerX(event.clientX);
      if (!Number.isFinite(hoveredIndex)) return;
      const adjustedEndIndex = applyPlaybackEndScrubIndex(hoveredIndex);
      if (Number.isFinite(adjustedEndIndex) && dateRangePlaybackState.hasSession) {
        dateRangePlaybackState.currentEndIndex = adjustedEndIndex;
      }
      return;
    }

    if (!dateRangeDragState || !el.dateRangeStartSlider || !el.dateRangeEndSlider || !allRows.length) return;
    if (event.pointerId !== dateRangeDragState.pointerId) return;
    event.preventDefault();

    if (dateRangeDragState.mode === "start" || dateRangeDragState.mode === "end") {
      const rawIndex = getDateRangeIndexFromPointerX(event.clientX);
      if (!Number.isFinite(rawIndex)) return;
      const currentStart = Number(el.dateRangeStartSlider.value);
      const currentEnd = Number(el.dateRangeEndSlider.value);
      if (!Number.isFinite(currentStart) || !Number.isFinite(currentEnd)) return;
      const nextStart = dateRangeDragState.mode === "start"
        ? Math.max(dateRangeDragState.minIndex, Math.min(currentEnd, rawIndex))
        : currentStart;
      const nextEnd = dateRangeDragState.mode === "end"
        ? Math.max(currentStart, Math.min(dateRangeDragState.maxIndex, rawIndex))
        : currentEnd;
      if (Number(el.dateRangeStartSlider.value) === nextStart && Number(el.dateRangeEndSlider.value) === nextEnd) return;
      el.dateRangeStartSlider.value = String(nextStart);
      el.dateRangeEndSlider.value = String(nextEnd);
      updateDateRangeSliderFill(nextStart, nextEnd, dateRangeDragState.visualBounds);
      const startIso = toIsoDate(allRows[nextStart].date);
      const endIso = toIsoDate(allRows[nextEnd].date);
      setRequestedDateRange(startIso, endIso);
      if (el.startDateInput) el.startDateInput.value = startIso;
      if (el.endDateInput) el.endDateInput.value = endIso;
      applyFilters();
      return;
    }

    const {
      startClientX,
      startIndex,
      endIndex,
      minIndex,
      maxIndex,
      visualSpan,
      visualBounds,
      wrapWidth,
    } = dateRangeDragState;

    const deltaPx = event.clientX - startClientX;
    const deltaIndex = Math.round((deltaPx / wrapWidth) * Math.max(1, visualSpan));

    const minShift = minIndex - startIndex;
    const maxShift = maxIndex - endIndex;
    const shift = Math.max(minShift, Math.min(maxShift, deltaIndex));

    const nextStart = startIndex + shift;
    const nextEnd = endIndex + shift;
    if (Number(el.dateRangeStartSlider.value) === nextStart && Number(el.dateRangeEndSlider.value) === nextEnd) return;

    el.dateRangeStartSlider.value = String(nextStart);
    el.dateRangeEndSlider.value = String(nextEnd);

    updateDateRangeSliderFill(nextStart, nextEnd, visualBounds);

    const startIso = toIsoDate(allRows[nextStart].date);
    const endIso = toIsoDate(allRows[nextEnd].date);
    setRequestedDateRange(startIso, endIso);
    if (el.startDateInput) el.startDateInput.value = startIso;
    if (el.endDateInput) el.endDateInput.value = endIso;
    applyFilters();
  }

  function endDateRangeSegmentDrag(event) {
    if (dateRangeEndSliderScrubState.active) {
      endDateRangeEndSliderScrub(event);
      return;
    }

    if (!dateRangeDragState || !el.dateRangeSliderWrap) return;
    if (event.pointerId !== dateRangeDragState.pointerId) return;

    try {
      el.dateRangeSliderWrap.releasePointerCapture(event.pointerId);
    } catch (_) {
      // Ignore capture failures.
    }

    dateRangeDragState = null;
  }

  function initDatePickers() {
    if (!el.startDateBtn || !el.endDateBtn || !el.startDateInput || !el.endDateInput) return;

    const startPicker = makeDatePicker({
      align: "left",
      anchorEl: el.startDateBtn,
      getSelected: () => el.startDateInput.value,
      getMin: () => el.startDateInput.min || "",
      getMax: () => el.startDateInput.max || "",
      isDisabled: () => false,
      onSelect: (isoVal) => {
        stopDateRangePlayback();
        el.startDateInput.value = isoVal;
        setRequestedDateRange(el.startDateInput.value, el.endDateInput.value);
        applyFilters();
        endPicker.rebuildCalendar();
      },
    });

    const endPicker = makeDatePicker({
      align: "left",
      anchorEl: el.endDateBtn,
      getSelected: () => el.endDateInput.value,
      getMin: () => el.endDateInput.min || "",
      getMax: () => el.endDateInput.max || "",
      isDisabled: () => false,
      onSelect: (isoVal) => {
        stopDateRangePlayback();
        el.endDateInput.value = isoVal;
        setRequestedDateRange(el.startDateInput.value, el.endDateInput.value);
        applyFilters();
        startPicker.rebuildCalendar();
      },
    });

    el.startDateBtn.addEventListener("click", startPicker.toggle);
    el.endDateBtn.addEventListener("click", endPicker.toggle);
    refreshDateButtonLabels();
  }

  function buildLinearTicks(min, max, count = 5) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
    // Ensure at least 3 ticks.
    count = Math.max(3, count);
    
    if (Math.abs(max - min) < 1e-12) {
      const scale = Math.max(Math.abs(min), Math.abs(max), LOG_MIN_POSITIVE);
      const epsilon = Math.max(scale * 1e-6, Number.EPSILON * scale * 16);
      const start = min - epsilon;
      const end = max + epsilon;
      return Array.from({ length: count }, (_, i) => start + ((end - start) * i) / (count - 1));
    }

    const rawStep = (max - min) / (count - 1);
    const exponent = Math.floor(Math.log10(Math.abs(rawStep)));
    const niceBases = [1, 2, 2.5, 5, 10];

    const stepCandidates = [];
    for (let exp = exponent - 3; exp <= exponent + 3; exp += 1) {
      const scale = 10 ** exp;
      for (const base of niceBases) {
        stepCandidates.push(base * scale);
      }
    }
    stepCandidates.sort((a, b) => a - b);

    let candidateIndex = stepCandidates.findIndex((step) => step >= rawStep);
    if (candidateIndex < 0) candidateIndex = stepCandidates.length - 1;

    const buildTicksForStep = (step) => {
      const valueScale = Math.max(Math.abs(min), Math.abs(max), LOG_MIN_POSITIVE);
      const eps = Math.max(
        Math.abs(step) * 1e-9,
        valueScale * 1e-12,
        Number.EPSILON * valueScale * 16
      );
      const start = Math.ceil((min - eps) / step) * step;
      const end = Math.floor((max + eps) / step) * step;
      const ticks = [];
      for (let value = start; value <= end + eps; value += step) {
        ticks.push(Number(value.toPrecision(15)));
      }
      return ticks;
    };

    let ticks = buildTicksForStep(stepCandidates[candidateIndex]);

    // Refine to get at least 3 ticks, but avoid overcrowding with too many.
    while (ticks.length < 3 && candidateIndex > 0) {
      candidateIndex -= 1;
      ticks = buildTicksForStep(stepCandidates[candidateIndex]);
    }
    while (ticks.length > 12 && candidateIndex < stepCandidates.length - 1) {
      const nextTicks = buildTicksForStep(stepCandidates[candidateIndex + 1]);
      if (nextTicks.length < 3) break;
      candidateIndex += 1;
      ticks = nextTicks;
    }

    if (ticks.length >= 3) return ticks;

    // Final fallback for very unusual ranges.
    return Array.from({ length: count }, (_, i) => min + ((max - min) * i) / (count - 1));
  }

  function buildLogTicks(min, max) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) return [];
    const minLog = Math.log10(min);
    const maxLog = Math.log10(max);
    const span = maxLog - minLog;

    // For tight ranges, use denser values so the axis is readable instead of showing only a single decade tick.
    if (span < 1) {
      const linearTicks = buildLinearTicks(min, max, 6)
        .filter((value) => value > 0)
        .sort((a, b) => a - b);
      // Ensure at least 3 ticks
      return linearTicks.length >= 3 ? linearTicks : buildLinearTicks(min, max, 4);
    }

    const ticks = [];

    // Wide ranges keep decade ticks; tighter ranges add intermediate ticks
    // For span < 2.5, we want at least 4-5 ticks visible
    const factors = span >= 3
      ? [1]
      : span >= 2
        ? [1, 5]
        : span >= 1
          ? [1, 2, 5]
          : [1, 2, 3, 4, 5, 6, 7, 8, 9];

    const startExp = Math.floor(minLog);
    const endExp = Math.ceil(maxLog);
    for (let exp = startExp; exp <= endExp; exp += 1) {
      const base = 10 ** exp;
      for (const factor of factors) {
        const value = factor * base;
        if (value >= min && value <= max) {
          ticks.push(value);
        }
      }
    }
    
    const uniqueTicks = Array.from(new Set(ticks)).sort((a, b) => a - b);
    
    // If we have fewer than 3 ticks, fall back to linear ticks
    if (uniqueTicks.length < 3) {
      return buildLinearTicks(min, max, 4);
    }
    
    return uniqueTicks;
  }

  function buildMetalYAxisTicks(min, max, isLinear, count = 8) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
    const ticks = [];
    const addTick = (value) => {
      if (!Number.isFinite(value) || (!isLinear && value <= 0)) return;
      if (value < min || value > max) return;
      const normalized = Number(value.toPrecision(15));
      const valueScale = Math.max(Math.abs(normalized), LOG_MIN_POSITIVE);
      const isDuplicate = ticks.some((tick) => Math.abs(tick - normalized) <= valueScale * 1e-10);
      if (!isDuplicate) ticks.push(normalized);
    };

    if (max >= GRAIN_AXIS_OUNCE_THRESHOLD) {
      const ounceMin = Math.max(min, GRAIN_AXIS_OUNCE_THRESHOLD);
      const ounceTicks = isLinear
        ? buildLinearTicks(ounceMin, max, Math.max(3, Math.ceil(count / 2)))
        : buildLogTicks(ounceMin, max);
      ounceTicks
        .filter((value) => value >= GRAIN_AXIS_OUNCE_THRESHOLD)
        .forEach(addTick);
    }

    if (min < GRAIN_AXIS_OUNCE_THRESHOLD) {
      const grainMin = Math.max(min * GRAINS_PER_TROY_OUNCE, isLinear ? 0 : LOG_MIN_POSITIVE);
      const grainMax = Math.min(max, GRAIN_AXIS_OUNCE_THRESHOLD) * GRAINS_PER_TROY_OUNCE;
      if (grainMax > 0 && grainMax >= grainMin) {
        const grainTicks = isLinear
          ? buildLinearTicks(grainMin, grainMax, Math.max(3, Math.ceil(count / 2)))
          : buildLogTicks(Math.max(grainMin, LOG_MIN_POSITIVE), grainMax);
        grainTicks
          .map((value) => value / GRAINS_PER_TROY_OUNCE)
          .filter((value) => value < GRAIN_AXIS_OUNCE_THRESHOLD)
          .forEach(addTick);
      }
    }

    return ticks.sort((a, b) => a - b);
  }

  function clampYAxisTicksBySpacing(ticks, yFor, min, max, minSpacingPx) {
    if (!Array.isArray(ticks) || ticks.length <= 1 || typeof yFor !== "function") return ticks;
    const visibleTicks = ticks
      .filter((tick) => tick && Number.isFinite(tick.value) && tick.value >= min && tick.value <= max)
      .map((tick) => ({ ...tick, y: yFor(tick.value) }))
      .filter((tick) => Number.isFinite(tick.y))
      .sort((a, b) => a.y - b.y);
    const kept = [];

    visibleTicks.forEach((tick) => {
      const hasRoom = kept.every((keptTick) => Math.abs(keptTick.y - tick.y) >= minSpacingPx);
      if (hasRoom) kept.push(tick);
    });

    if (kept.length < 3) return ticks;
    const keptValues = new Set(kept.map((tick) => tick.value));
    return ticks.filter((tick) => keptValues.has(tick.value));
  }

  function measureLabelWidth(ticks, fontSpec) {
    if (!fontSpec) {
      const tickLabelFontSize = getResponsiveTickLabelFontSize();
      fontSpec = `500 ${tickLabelFontSize}px Space Grotesk`;
    }
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return 40;
    ctx.font = fontSpec;
    let maxWidth = 40;
    if (ticks && Array.isArray(ticks)) {
      ticks.forEach((tick) => {
        const metrics = ctx.measureText(tick.label);
        maxWidth = Math.max(maxWidth, metrics.width);
      });
    }
    return maxWidth;
  }

  function renderPairKpiValue(primary, secondary) {
    if (!el.pairKpiValue) return;
    el.pairKpiValue.innerHTML = `<span class="pair-primary">${primary}</span><span class="pair-separator">/</span><span class="pair-secondary">${secondary}</span>`;
    const primaryEl = el.pairKpiValue.querySelector(".pair-primary");
    const secondaryEl = el.pairKpiValue.querySelector(".pair-secondary");
    const chartColors = getChartAccentColors(primary, secondary);
    if (primaryEl) primaryEl.style.color = chartColors.left;
    if (secondaryEl) secondaryEl.style.color = chartColors.right;
  }

  function syncPairControls(changedControlId) {
    if (!el.primaryUoaSelect || !el.secondaryUoaSelect) return;
    const priorPrimary = lastPrimaryUoa || el.primaryUoaSelect.value || "BTC";
    const priorRangePreset = getMatchingRangePresetKey(
      requestedDateRange.startIso || el.startDateInput?.value || "",
      requestedDateRange.endIso || el.endDateInput?.value || "",
      priorPrimary
    );
    let primary = el.primaryUoaSelect.value;
    let secondary = el.secondaryUoaSelect.value;

    if (primary === secondary) {
      if (changedControlId === "primaryUoaSelect") {
        // User picked the current secondary on primary: swap sides.
        const nextSecondary = lastPrimaryUoa && lastPrimaryUoa !== primary
          ? lastPrimaryUoa
          : getFallbackSecondary(primary);
        el.secondaryUoaSelect.value = nextSecondary;
        secondary = nextSecondary;
      } else {
        // User picked the current primary on secondary: swap sides.
        const nextPrimary = lastSecondaryUoa && lastSecondaryUoa !== secondary
          ? lastSecondaryUoa
          : getFallbackSecondary(secondary);
        el.primaryUoaSelect.value = nextPrimary;
        primary = nextPrimary;
      }
    }

    lastPrimaryUoa = primary;
    lastSecondaryUoa = secondary;

    renderPairKpiValue(primary, secondary);
    syncDateRangeChartToggleLabels();
    syncDownloadChartModeLabels();

    syncAllDropdowns();
    if (changedControlId === "primaryUoaSelect" && priorRangePreset === "full") {
      const preset = getPresetDateIndices("full", null, primary);
      if (preset) {
        setRequestedDateRange(toIsoDate(allRows[preset.startIndex].date), toIsoDate(allRows[preset.endIndex].date));
      }
    }
    applyRequestedDateRangeToControls();
    applyFilters();
  }

  function cycleSecondaryUoa(direction) {
    if (!el.secondaryUoaSelect || !el.primaryUoaSelect) return;
    const primary = el.primaryUoaSelect.value;
    const options = Array.from(el.secondaryUoaSelect.options)
      .map((option) => option.value)
      .filter((value) => value !== primary);
    if (!options.length) return;

    const current = el.secondaryUoaSelect.value;
    const currentIndex = options.indexOf(current);
    const startIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (startIndex + direction + options.length) % options.length;
    const nextValue = options[nextIndex];
    if (!nextValue || nextValue === current) return;

    el.secondaryUoaSelect.value = nextValue;
    el.secondaryUoaSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function bindSecondaryArrowCycling() {
    const trigger = document.getElementById("secondaryUoaDropdownTrigger");
    if (trigger && trigger.dataset.arrowBound !== "1") {
      trigger.dataset.arrowBound = "1";
      trigger.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        event.stopPropagation();
        cycleSecondaryUoa(event.key === "ArrowDown" ? 1 : -1);
      });
    }

    if (secondaryArrowGlobalBound) return;
    secondaryArrowGlobalBound = true;

    const handleGlobalArrow = (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const target = event.target;
      if (target?.closest?.(".dca-dropdown, .dca-dropdown-menu")) return;
      event.preventDefault();
      cycleSecondaryUoa(event.key === "ArrowDown" ? 1 : -1);
    };

    // Single capture-phase handler to avoid double-cycling the same key event.
    window.addEventListener("keydown", handleGlobalArrow, true);
  }

  function primeKeyboardFocus() {
    // Ensure this document can immediately receive arrow-key events on first load.
    if (document.body && !document.body.hasAttribute("tabindex")) {
      document.body.setAttribute("tabindex", "-1");
    }
    requestAnimationFrame(() => {
      try {
        window.focus();
        document.body?.focus({ preventScroll: true });
      } catch (_) {
        // Ignore browser focus restrictions.
      }
    });
  }

  function applyFilters() {
    if (!allRows.length) {
      rows = [];
      persistFilters();
      renderAll();
      return;
    }

    const bounds = getDateBounds();
    if (!bounds) return;
    const controlBounds = getDateRangeControlBounds();
    syncDateControlBoundsToPair(controlBounds);

    let start = String(el.startDateInput?.value || bounds.min);
    let end = String(el.endDateInput?.value || bounds.max);
    const clamped = clampDateRangeToPairBounds(start, end, controlBounds);
    start = clamped.startIso;
    end = clamped.endIso;
    if (el.startDateInput) el.startDateInput.value = start;
    if (el.endDateInput) el.endDateInput.value = end;

    const maxIndex = Math.max(0, allRows.length - 1);
    if (maxIndex >= 1) {
      let startIndex = getDateIndexFromIso(start);
      let endIndex = getDateIndexFromIso(end);
      if (startIndex < 0) startIndex = 0;
      if (endIndex < 0) endIndex = maxIndex;

      if (startIndex > endIndex) {
        if (startIndex >= maxIndex) {
          startIndex = Math.max(0, maxIndex - 1);
          endIndex = maxIndex;
        } else {
          endIndex = startIndex;
        }
        start = toIsoDate(allRows[startIndex].date);
        end = toIsoDate(allRows[endIndex].date);
        if (el.startDateInput) el.startDateInput.value = start;
        if (el.endDateInput) el.endDateInput.value = end;
      }
    }

    const startDate = new Date(`${start}T00:00:00Z`);
    const endDate = new Date(`${end}T23:59:59Z`);

    const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
    const startEdgeText = isoPattern.test(start) ? formatDateEdgeText(start) : "--";
    const endEdgeText = isoPattern.test(end) ? formatDateEdgeText(end) : "--";
    if (el.usdBtcStartDateEdge) el.usdBtcStartDateEdge.textContent = startEdgeText;
    if (el.btcUsdStartDateEdge) el.btcUsdStartDateEdge.textContent = startEdgeText;
    if (el.usdBtcEndDateEdge) el.usdBtcEndDateEdge.textContent = endEdgeText;
    if (el.btcUsdEndDateEdge) el.btcUsdEndDateEdge.textContent = endEdgeText;

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      rows = [...allRows];
      refreshDateButtonLabels();
      persistFilters();
      renderAll();
      return;
    }

    if (startDate.getTime() > endDate.getTime()) return;

    rows = allRows.filter((r) => r.date >= startDate && r.date <= endDate);
    refreshDateButtonLabels();
    persistFilters();
    renderAll();
  }

  function initControls() {
    const bounds = getDateBounds();
    if (!bounds) return null;
    const saved = loadStoredFilters(bounds);
    updatedKpiTimeZone = getPreferredDashboardTimeZone();
    const updatedTimeZoneSelectEl = document.getElementById("updatedTimeZoneSelect");
    if (updatedTimeZoneSelectEl) {
      updatedTimeZoneSelectEl.value = updatedKpiTimeZone;
      const dropdownConfig = DROPDOWNS.find((config) => config.selectId === "updatedTimeZoneSelect");
      if (dropdownConfig) syncDropdownMenu(dropdownConfig);
    }
    setRequestedDateRange(saved.requestedStartDate || saved.startDate, saved.requestedEndDate || saved.endDate);

    if (el.startDateInput) {
      el.startDateInput.min = bounds.min;
      el.startDateInput.max = bounds.max;
      el.startDateInput.value = saved.startDate;
      el.startDateInput.addEventListener("change", () => {
        stopDateRangePlayback();
        setRequestedDateRange(el.startDateInput.value, el.endDateInput?.value || el.startDateInput.value);
        applyFilters();
      });
    }
    if (el.endDateInput) {
      el.endDateInput.min = bounds.min;
      el.endDateInput.max = bounds.max;
      el.endDateInput.value = saved.endDate;
      el.endDateInput.addEventListener("change", () => {
        stopDateRangePlayback();
        setRequestedDateRange(el.startDateInput?.value || el.endDateInput.value, el.endDateInput.value);
        applyFilters();
      });
    }
    if (el.dateRangeStartSlider && el.dateRangeEndSlider) {
      el.dateRangeStartSlider.addEventListener("input", () => {
        handleDateRangeSliderInput("start");
      });
      if (el.dateRangeStartSlider.dataset.scrubBound !== "1") {
        el.dateRangeStartSlider.dataset.scrubBound = "1";
        el.dateRangeStartSlider.addEventListener("pointerdown", beginDateRangeStartSliderScrub);
      }
      el.dateRangeEndSlider.addEventListener("input", () => {
        handleDateRangeSliderInput("end");
      });
      if (el.dateRangeEndSlider.dataset.scrubBound !== "1") {
        el.dateRangeEndSlider.dataset.scrubBound = "1";
        el.dateRangeEndSlider.addEventListener("pointerdown", beginDateRangeEndSliderScrub);
        el.dateRangeEndSlider.addEventListener("pointerup", endDateRangeEndSliderScrub);
        el.dateRangeEndSlider.addEventListener("pointercancel", endDateRangeEndSliderScrub);
      }
    }
    if (el.dateRangeSliderWrap) {
      el.dateRangeSliderWrap.addEventListener("pointerdown", beginDateRangeSegmentDrag);
      el.dateRangeSliderWrap.addEventListener("pointermove", moveDateRangeSegmentDrag);
      el.dateRangeSliderWrap.addEventListener("pointerup", endDateRangeSegmentDrag);
      el.dateRangeSliderWrap.addEventListener("pointercancel", endDateRangeSegmentDrag);
    }
    if (el.dateRangePlayBtn && el.dateRangePlayBtn.dataset.bound !== "1") {
      el.dateRangePlayBtn.dataset.bound = "1";
      el.dateRangePlayBtn.addEventListener("click", startDateRangePlayback);
    }
    if (el.dateRangePauseBtn && el.dateRangePauseBtn.dataset.bound !== "1") {
      el.dateRangePauseBtn.dataset.bound = "1";
      el.dateRangePauseBtn.addEventListener("click", pauseDateRangePlayback);
    }
    if (el.dateRangeStopBtn && el.dateRangeStopBtn.dataset.bound !== "1") {
      el.dateRangeStopBtn.dataset.bound = "1";
      el.dateRangeStopBtn.addEventListener("click", stopAndResetDateRangePlayback);
    }
    bindDateRangePlaybackSpaceShortcut();
    bindDateRangePlaybackFpsButtons();
    bindDashboardExpandButton();
    bindDateRangeChartToggles();
    bindDateRangeDaysInput();
    bindDateRangeDownloadControls();
    setDateRangePlaybackFps(saved.playbackFps);
    setVisibleChartMode(saved.chartMode);

    if (el.primaryUoaSelect) {
      el.primaryUoaSelect.value = saved.primaryUoa;
      el.primaryUoaSelect.addEventListener("change", () => {
        syncPairControls("primaryUoaSelect");
      });
    }
    if (el.secondaryUoaSelect) {
      el.secondaryUoaSelect.value = saved.secondaryUoa;
      el.secondaryUoaSelect.addEventListener("change", () => {
        syncPairControls("secondaryUoaSelect");
      });
    }
    if (el.scaleSelect) {
      el.scaleSelect.value = saved.scaleMode;
      el.scaleSelect.addEventListener("change", () => {
        syncAllDropdowns();
        persistFilters();
        renderAll();
      });
    }
    if (el.orderBySelect) {
      el.orderBySelect.value = saved.orderMode;
      el.orderBySelect.addEventListener("change", () => {
        applyCurrencyOrdering();
        syncAllDropdowns();
        persistFilters();
        renderAll();
      });
    }
    if (el.vesRedenomAdjustToggle) {
      el.vesRedenomAdjustToggle.checked = saved.smoothVesRedenom;
      el.vesRedenomAdjustToggle.addEventListener("change", () => {
        persistFilters();
        renderAll();
      });
    }

    const updatedTimeZoneSelect = document.getElementById("updatedTimeZoneSelect");
    if (updatedTimeZoneSelect) {
      updatedTimeZoneSelect.addEventListener("change", () => {
        const next = String(updatedTimeZoneSelect.value || "UTC");
        updatedKpiTimeZone = setPreferredDashboardTimeZone(next);
        syncAllDropdowns();
        updatedTimeZoneSelect.blur();
        closeAllDropdowns();
        persistFilters();
        renderAll();
      });
    }

    syncPairControls();
    bindCustomDropdowns();
    bindSecondaryArrowCycling();
    bindDateRangeSessionPersistence();
    initDatePickers();
    bindRangePresetButtons();
    bindDashboardActionButtons();
    updateDateRangePlayButton();
    updateDateRangeStopButton();
    updateResetButtonUi();
    return saved;
  }

  function restorePausedPlaybackSession(saved) {
    if (!saved?.pausedPlaybackSession || !allRows.length) return;

    const startIndex = getDateIndexFromIso(saved.pausedPlaybackSession.startDate);
    const targetEndIndex = getDateIndexFromIso(saved.pausedPlaybackSession.targetEndDate);
    const currentEndIndex = getDateIndexFromIso(saved.pausedPlaybackSession.currentEndDate);
    const maxIndex = Math.max(0, allRows.length - 1);

    if (!Number.isFinite(startIndex) || !Number.isFinite(targetEndIndex) || !Number.isFinite(currentEndIndex)) return;
    if (startIndex < 0 || targetEndIndex < 0 || currentEndIndex < 0) return;

    const safeStart = Math.max(0, Math.min(maxIndex, startIndex));
    const safeTargetEnd = Math.max(0, Math.min(maxIndex, targetEndIndex));
    const safeCurrentEnd = Math.max(0, Math.min(maxIndex, currentEndIndex));
    if (safeTargetEnd < safeStart) return;

    // Keep paused session state so reload restores the exact frame and target end point.
    dateRangePlaybackState.hasSession = true;
    updatePlaybackActiveFlag();
    dateRangePlaybackState.isPlaying = false;
    dateRangePlaybackState.startIndex = safeStart;
    dateRangePlaybackState.targetEndIndex = safeTargetEnd;
    dateRangePlaybackState.currentEndIndex = safeCurrentEnd;
    dateRangePlaybackState.originalStartIndex = safeStart;
    dateRangePlaybackState.originalEndIndex = safeTargetEnd;

    setDateRangeByIndices(safeStart, safeCurrentEnd);
    updateDateRangePlayButton();
    updateDateRangePauseButton();
    updateDateRangeStopButton();
    bindDateRangePlaybackOutsidePointerCancel();
  }

  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function makeUtcDate(year, month, day = 1) {
    return new Date(Date.UTC(year, month, day));
  }

  function clampTickCountByWidth(ticks, chartW, minTargetPx = 88) {
    const maxTicks = Math.max(4, Math.floor(chartW / minTargetPx));
    if (ticks.length <= maxTicks) return ticks;
    const stride = Math.ceil(ticks.length / maxTicks);
    return ticks.filter((_, i) => i % stride === 0);
  }

  function snapCanvasLineCoord(value, lineWidth = 1, dpr = 1) {
    const safeDpr = Math.max(1, Number(dpr) || 1);
    const deviceLineWidth = Math.max(1, Math.round((Number(lineWidth) || 1) * safeDpr));
    const offset = deviceLineWidth % 2 === 1 ? 0.5 / safeDpr : 0;
    return (Math.round((Number(value) || 0) * safeDpr) / safeDpr) + offset;
  }

  function buildAdaptiveTimeTicks(series, chartW) {
    if (!Array.isArray(series) || series.length < 2) return [];

    const first = series[0].date;
    const last = series[series.length - 1].date;
    const firstMs = first.getTime();
    const lastMs = last.getTime();
    const startYear = first.getUTCFullYear();
    const endYear = last.getUTCFullYear();
    const isMultiYearRange = endYear > startYear;

    const monthStarts = [];
    let cursor = makeUtcDate(first.getUTCFullYear(), first.getUTCMonth(), 1);
    while (cursor <= last) {
      const ms = cursor.getTime();
      if (ms >= firstMs && ms <= lastMs) {
        monthStarts.push(new Date(ms));
      }
      cursor = makeUtcDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1);
    }

    if (!monthStarts.length) return [];

    const maxTicks = Math.max(4, Math.floor(chartW / (isRenderingDateRangeExportFrame ? 122 : 88)));
    const selectedIndices = new Set();

    if (isMultiYearRange) {
      const tierMonthSets = [
        [0],                         // Jan (year labels)
        [0, 6],                      // Jan + Jul
        [0, 4, 8],                   // Jan + May + Sep
        [0, 3, 6, 9],                // Jan + Apr + Jul + Oct
        [0, 2, 4, 6, 8, 10],         // Every other month
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], // Every month
      ];

      const buildTierIndices = (monthSet) => {
        const monthLookup = new Set(monthSet);
        const out = [];
        monthStarts.forEach((d, idx) => {
          if (monthLookup.has(d.getUTCMonth())) out.push(idx);
        });
        return out;
      };

      // Pick the most detailed calendar tier that fits the label budget.
      let chosenTierIndices = null;
      for (let tier = tierMonthSets.length - 1; tier >= 0; tier -= 1) {
        const indices = buildTierIndices(tierMonthSets[tier]);
        if (indices.length > 0 && indices.length <= maxTicks) {
          chosenTierIndices = indices;
          break;
        }
      }

      if (chosenTierIndices) {
        chosenTierIndices.forEach((idx) => selectedIndices.add(idx));
      } else {
        // Extremely wide spans: keep Jan-only and downsample by year stride.
        const janIndices = buildTierIndices([0]);
        const janStride = Math.max(1, Math.ceil(janIndices.length / maxTicks));
        for (let i = 0; i < janIndices.length; i += janStride) {
          selectedIndices.add(janIndices[i]);
        }
      }
    } else {
      const minStep = Math.max(1, Math.ceil(monthStarts.length / maxTicks));
      const niceMonthSteps = [1, 2, 3, 4, 6, 12, 24, 36, 48, 60, 120];
      const monthStep = niceMonthSteps.find((step) => step >= minStep) || minStep;
      for (let idx = 0; idx < monthStarts.length; idx += monthStep) {
        selectedIndices.add(idx);
      }
    }

    const ticks = monthStarts
      .filter((_, idx) => selectedIndices.has(idx))
      .map((d) => {
        const month = d.getUTCMonth();
        const year = d.getUTCFullYear();
        return {
          date: d,
          // Keep month labels compact; use year marker at January boundaries.
          label: month === 0 ? String(year) : MONTH_SHORT[month],
        };
      });

    return ticks;
  }

  function getResponsiveTickLabelFontSize() {
    const width = window.innerWidth;
    const baseSize = width < 640 ? 12 : width < 980 ? 14 : 18;
    return isRenderingDateRangeExportFrame ? Math.round(baseSize * 1.5) : baseSize;
  }

  function drawChart(canvas, series, opts) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(320, Math.round(rect.width));
    const h = Math.max(240, Math.round(rect.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const isLinear = opts.scaleMode === "linear";
    const axisSourceSeries = (series.length === 1 && Array.isArray(opts.axisReferenceSeries) && opts.axisReferenceSeries.length >= 2)
      ? opts.axisReferenceSeries
      : series;
    const yAxisSourceSeries = Array.isArray(opts.yAxisReferenceSeries) && opts.yAxisReferenceSeries.length >= 2
      ? opts.yAxisReferenceSeries
      : axisSourceSeries;

    const vals = yAxisSourceSeries
      .map((s) => s.value)
      .filter((v) => Number.isFinite(v) && (isLinear || v > 0));
    if (!vals.length) {
      if (canvas.id) chartEventMarkersById[canvas.id] = [];
      return;
    }

    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (Number.isFinite(Number(opts?.minYFloor))) {
      min = Math.min(min, Number(opts.minYFloor));
    }
    if (Number.isFinite(Number(opts?.maxYFloor))) {
      max = Math.max(max, Number(opts.maxYFloor));
    }
    const dataMin = min;
    const dataMax = max;
    const dataRange = dataMax - dataMin;
    let tickValues = [];

    if (isLinear) {
      // For very low-variance positive series (e.g., pegged FX), center the axis at midpoint ±1%.
      const midpoint = (dataMin + dataMax) / 2;
      const hasPositiveMidpoint = Number.isFinite(midpoint) && midpoint > 0;
      const relativeSpread = hasPositiveMidpoint ? (dataRange / midpoint) : Infinity;
      const valueScale = Math.max(Math.abs(dataMin), Math.abs(dataMax), LOG_MIN_POSITIVE);
      const nearConstantByScale = Math.abs(dataRange) <= Math.max(
        valueScale * 1e-12,
        Number.EPSILON * valueScale * 64
      );

      if (hasPositiveMidpoint && relativeSpread < 0.01) {
        const padAmount = midpoint * 0.01;
        min = midpoint - padAmount;
        max = midpoint + padAmount;
      } else if (nearConstantByScale) {
        const padAmount = Math.max(valueScale * 0.01, Number.EPSILON * valueScale * 64);
        min = dataMin - padAmount;
        max = dataMax + padAmount;
      } else {
        const padAmount = dataRange * 0.01;
        min = dataMin - padAmount;
        max = dataMax + padAmount;
      }
      if (dataMin >= 0) min = Math.max(0, min);
      tickValues = isPreciousMetalCurrency(opts.yAxisCurrency)
        ? buildMetalYAxisTicks(min, max, true, 8)
        : buildLinearTicks(min, max, 8);
    } else {
      // Apply an equivalent 1% pad in log space to keep margins proportional.
      const safeMin = Math.max(dataMin, LOG_MIN_POSITIVE);
      const safeMax = Math.max(dataMax, safeMin * (1 + 1e-15));
      const logSpan = Math.log(safeMax / safeMin);
      if (logSpan < 1e-6) {
        const center = Math.max(safeMin, LOG_MIN_POSITIVE);
        const factor = 1.01;
        min = center / factor;
        max = center * factor;
      } else {
        // Keep 1% padding in log space so behavior matches the requested baseline.
        const logPad = Math.max(logSpan * 0.01, 1e-6);
        const factor = Math.exp(logPad);
        min = safeMin / factor;
        max = safeMax * factor;
      }
      tickValues = isPreciousMetalCurrency(opts.yAxisCurrency)
        ? buildMetalYAxisTicks(min, max, false, 8)
        : buildLogTicks(min, max);
    }

    // Measure tick labels to determine required left padding.
    const tickLabelFontSize = getResponsiveTickLabelFontSize();
    ctx.font = `500 ${tickLabelFontSize}px Space Grotesk`;
    let maxYLabelWidth = 40;
    tickValues.forEach((value) => {
      const baseLabel = opts.linearFormatter ? opts.linearFormatter(value) : String(value);
      const label = typeof opts.overlapLabelFn === "function"
        ? (opts.overlapLabelFn(value, baseLabel) || baseLabel)
        : baseLabel;
      const metrics = ctx.measureText(label);
      maxYLabelWidth = Math.max(maxYLabelWidth, metrics.width);
    });
    const yLabelSpacing = 12; // space between y-label and chart
    const sidePadSize = maxYLabelWidth + yLabelSpacing;
    const sideMargin = 6; // margin to edge
    
    // Measure year labels for bottom padding
    const xAxisSeries = axisSourceSeries.length > 1 ? axisSourceSeries : series;
    const y0 = xAxisSeries[0].date.getFullYear();
    const y1 = xAxisSeries[xAxisSeries.length - 1].date.getFullYear();
    let maxYearWidth = 0;
    for (let y = y0; y <= y1; y++) {
      const metrics = ctx.measureText(String(y));
      maxYearWidth = Math.max(maxYearWidth, metrics.width);
    }
    // Account for rotation (-π/5 radians = -36 degrees)
    const fontHeight = tickLabelFontSize * 1.2; // approximate line height
    const rotationAngle = -Math.PI / 5;
    const rotatedHeight = Math.abs(maxYearWidth * Math.sin(rotationAngle)) + 
                          Math.abs(fontHeight * Math.cos(rotationAngle));
    const bottomSpacing = 12; // gap between chart and year labels
    const bottomMargin = 4; // tight margin to panel edge
    const rightMargin = 4; // tight margin to panel edge
    const rightYearOverhang = Math.abs(fontHeight * Math.sin(rotationAngle));

    const pad = {
      top: 12,
      right: rightYearOverhang + rightMargin,
      bottom: rotatedHeight + bottomSpacing + bottomMargin,
      left: sidePadSize + sideMargin,
    };
    const chartW = Math.max(1, w - pad.left - pad.right);
    const chartH = Math.max(1, h - pad.top - pad.bottom);

    if (opts.edgeTrackEl && Number.isFinite(w) && w > 0) {
      const plotStartPct = Math.max(0, Math.min(100, (pad.left / w) * 100));
      const plotEndPct = Math.max(0, Math.min(100, ((w - pad.right) / w) * 100));
      opts.edgeTrackEl.style.setProperty("--chart-start-x-pct", `${plotStartPct}%`);
      opts.edgeTrackEl.style.setProperty("--chart-end-x-pct", `${plotEndPct}%`);
    }

    let yFor = null;
    let ticksToDraw = [];

    if (isLinear) {
      yFor = (v) => pad.top + ((max - v) / Math.max(1e-9, max - min)) * chartH;
      ticksToDraw = tickValues.map((value) => ({
        value,
        label: opts.linearFormatter ? opts.linearFormatter(value) : String(Math.round(value)),
      }));
    } else {
      const minLog = Math.log10(min);
      const maxLog = Math.log10(max);
      yFor = (v) => pad.top + ((maxLog - Math.log10(v)) / Math.max(1e-9, (maxLog - minLog))) * chartH;
      ticksToDraw = tickValues.map((value) => ({
        value,
        label: opts.linearFormatter ? opts.linearFormatter(value) : String(value),
      }));
    }

    if (typeof opts.overlapLabelFn === "function") {
      ticksToDraw = ticksToDraw.map((tick) => {
        const nextLabel = opts.overlapLabelFn(tick.value, tick.label);
        return nextLabel ? { ...tick, label: nextLabel } : tick;
      });
    }

    if (isPreciousMetalCurrency(opts.yAxisCurrency)) {
      ticksToDraw = clampYAxisTicksBySpacing(
        ticksToDraw,
        yFor,
        min,
        max,
        tickLabelFontSize * 1.6
      );
    }

    const isSinglePointSeries = series.length === 1;
    const xFor = (i) => {
      if (isSinglePointSeries) return pad.left + (chartW / 2);
      return pad.left + (i / Math.max(1, series.length - 1)) * chartW;
    };

    ctx.strokeStyle = getDashboardCssValue("--line", "#2b2b2b");
    ctx.lineWidth = 1;

    ticksToDraw.forEach((tick) => {
      if (tick.value < min || tick.value > max) return;
      const y = yFor(tick.value);
      const gridY = snapCanvasLineCoord(y, ctx.lineWidth, dpr);
      ctx.beginPath();
      ctx.moveTo(pad.left, gridY);
      ctx.lineTo(pad.left + chartW, gridY);
      ctx.stroke();

      ctx.fillStyle = opts.color;
      ctx.font = `500 ${tickLabelFontSize}px Space Grotesk`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const tx = pad.left - yLabelSpacing;
      ctx.fillText(tick.label, tx, y);
    });

    const xTicks = buildAdaptiveTimeTicks(xAxisSeries, chartW);

    xTicks.forEach((tick) => {
      const idx = series.findIndex((s) => s.date >= tick.date);
      if (idx <= 0) return;
      const x = xFor(idx);
      const gridX = snapCanvasLineCoord(x, ctx.lineWidth, dpr);
      ctx.beginPath();
      ctx.moveTo(gridX, pad.top);
      ctx.lineTo(gridX, pad.top + chartH);
      ctx.stroke();

      ctx.save();
      ctx.translate(x - 8, pad.top + chartH + bottomSpacing);
      ctx.rotate(-Math.PI / 5);
      ctx.fillStyle = getDashboardCssValue("--muted", "#95a6ae");
      ctx.font = `500 ${tickLabelFontSize}px Space Grotesk`;
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText(String(tick.label), 0, 0);
      ctx.restore();
    });

    const fullRangeCount = Math.max(2, Array.isArray(allRows) ? allRows.length : series.length);
    const visibleRangeRatio = Math.max(0, Math.min(1, (series.length - 1) / Math.max(1, fullRangeCount - 1)));
    const shortRangeBoost = 1 - Math.sqrt(visibleRangeRatio);
    const primaryLineWidth = 1.6 + shortRangeBoost * 1.8;
    const ghostLineWidth = 0.6 + shortRangeBoost * 0.7;
    const lineTipBleed = Math.ceil(Math.max(primaryLineWidth, ghostLineWidth) / 2);

    // Clip line rendering near the chart area while preserving rounded line tips.
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left - lineTipBleed, pad.top - lineTipBleed, chartW + lineTipBleed * 2, chartH + lineTipBleed * 2);
    ctx.clip();

    if (series.length >= 2) {
      ctx.strokeStyle = getDashboardCssValue("--ghost", "rgba(148, 163, 184, 0.25)");
      ctx.lineWidth = ghostLineWidth;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      series.forEach((s, i) => {
        const x = xFor(i);
        const y = yFor(s.value);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.strokeStyle = opts.color;
      ctx.lineWidth = primaryLineWidth;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      series.forEach((s, i) => {
        const x = xFor(i);
        const y = yFor(s.value);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    } else if (series.length === 1) {
      const pointX = xFor(0);
      const pointY = yFor(series[0].value);
      ctx.fillStyle = opts.color;
      ctx.beginPath();
      ctx.arc(pointX, pointY, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const markerStates = [];
    const eventMarkers = Array.isArray(opts.eventMarkers) ? opts.eventMarkers : [];
    
    const firstDate = series.length > 0 ? series[0].date : null;
    const lastDate = series.length > 0 ? series[series.length - 1].date : null;
    
    eventMarkers.forEach((event) => {
      const eventDate = parseIsoDateUtc(event.dateIso);
      if (!eventDate) return;
      if (firstDate && eventDate < firstDate) return;
      if (lastDate && eventDate > lastDate) return;
      
      // Find the first point at or after the event date
      const idx = series.findIndex((s) => s.date >= eventDate);
      if (idx < 0) return;
      
      const point = series[idx];
      const yValue = point.value;
      
      if (!Number.isFinite(yValue) || yValue <= 0 || yValue < min || yValue > max) return;

      const x = xFor(idx);
      const y = yFor(yValue);
      drawStar(ctx, x, y);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.78)";
      ctx.lineWidth = 1;
      ctx.stroke();

      markerStates.push({
        x,
        y,
        radius: 10,
        tooltip: String(event.tooltip || "Redenomination event"),
      });
    });

    if (canvas.id) {
      chartEventMarkersById[canvas.id] = markerStates;
    }
  }

  function renderAll() {
    applyCurrencyOrdering();

    const scaleMode = getDashboardScaleMode();
    const leftScaleMode = normalizeScaleMode(activeDateRangeExportScaleModes?.left, scaleMode);
    const rightScaleMode = normalizeScaleMode(activeDateRangeExportScaleModes?.right, scaleMode);
    const primaryCurrency = el.primaryUoaSelect?.value || "BTC";
    const secondaryCurrency = el.secondaryUoaSelect?.value || "USD";
    
    if (el.usdBtcScaleLabel) el.usdBtcScaleLabel.textContent = leftScaleMode.toUpperCase();
    if (el.btcUsdScaleLabel) el.btcUsdScaleLabel.textContent = rightScaleMode.toUpperCase();

    // Update pair KPI
    renderPairKpiValue(primaryCurrency, secondaryCurrency);
    syncDateRangeChartToggleLabels();
    const fallbackEndRow = rows[rows.length - 1] || allRows[allRows.length - 1] || null;
    const selectedEndIso = el.endDateInput?.value || requestedDateRange.endIso || (fallbackEndRow ? toIsoDate(fallbackEndRow.date) : "");
    const selectedEndBtcRow = getBtcRowOnOrBeforeIso(selectedEndIso);
    const selectedBlockHeight = selectedEndBtcRow?.blockHeight;
    const selectedBlockHeightText = Number.isFinite(selectedBlockHeight) ? String(selectedBlockHeight) : "";
    const ranksByCurrency = getCurrencyRanksFromSatsValues(getCurrencySatsValuesForRow(selectedEndBtcRow));
    if (el.primaryRankKpiValue) el.primaryRankKpiValue.textContent = ranksByCurrency[primaryCurrency] ? String(ranksByCurrency[primaryCurrency]) : "";
    if (el.secondaryRankKpiValue) el.secondaryRankKpiValue.textContent = ranksByCurrency[secondaryCurrency] ? String(ranksByCurrency[secondaryCurrency]) : "";
    if (el.blockHeightText) {
      el.blockHeightText.textContent = selectedBlockHeightText ? `BLOCK HEIGHT: ${selectedBlockHeightText}` : "BLOCK HEIGHT: --";
    }
    if (el.blockHeightKpiValue) el.blockHeightKpiValue.textContent = selectedBlockHeightText;

    // Update panel titles
    if (el.usdBtcTitle) {
      if (primaryCurrency === "BTC") {
        el.usdBtcTitle.textContent = `Price of 1 ${getTitleUnitLabel(secondaryCurrency)} in terms of bitcoin`;
      } else {
        el.usdBtcTitle.textContent = `Price of 1 ${getTitleUnitLabel(secondaryCurrency)} in terms of ${getCurrencyName(primaryCurrency)}`;
      }
    }
    if (el.btcUsdTitle) {
      if (primaryCurrency === "BTC") {
        el.btcUsdTitle.textContent = `Price of 1 ${getTitleUnitLabel("BTC")} in terms of ${getCurrencyName(secondaryCurrency)}`;
      } else {
        el.btcUsdTitle.textContent = `Price of 1 ${getTitleUnitLabel(primaryCurrency)} in terms of ${getCurrencyName(secondaryCurrency)}`;
      }
    }

    if (!rows.length) {
      el.usdBtcBig.textContent = "-- units";
      el.btcUsdBig.textContent = "-- units";
      el.satUsdText.textContent = "N/A";
      el.usdSatText.textContent = "N/A";
      if (el.rightAsOf) el.rightAsOf.textContent = "--";
      if (el.updatedKpiValue) el.updatedKpiValue.textContent = formatUpdatedDisplayText(refreshedAtText);
      clearCanvas(el.usdBtcChart);
      clearCanvas(el.btcUsdChart);
      return;
    }

    const transformedRows = transformRowsForCurrencyPair(rows, primaryCurrency, secondaryCurrency);
    if (!transformedRows.length) {
      el.usdBtcBig.textContent = "-- units";
      el.btcUsdBig.textContent = "-- units";
      el.satUsdText.textContent = "N/A";
      el.usdSatText.textContent = "N/A";
      clearCanvas(el.usdBtcChart);
      clearCanvas(el.btcUsdChart);
      return;
    }

    const smoothVesRedenom = !!el.vesRedenomAdjustToggle?.checked;
    const redenominationCurrency = [primaryCurrency, secondaryCurrency].find((code) => getRedenominationEvents(code).length > 0) || null;
    const hasRedenomInPair = Boolean(redenominationCurrency);
    const applyRedenomAdjustment = smoothVesRedenom && hasRedenomInPair;
    const redenomAnchorDate = (rows[rows.length - 1] || allRows[allRows.length - 1])?.date || null;

    const adjustedRows = applyRedenomAdjustment
      ? transformedRows.map((row) => {
          const adjustedDirect = getRedenomAdjustedChartValue(
            row.directPrice,
            row.date,
            secondaryCurrency,
            primaryCurrency,
            redenominationCurrency,
            redenomAnchorDate
          );
          const adjustedInverse = Number.isFinite(adjustedDirect) && adjustedDirect > 0
            ? (1 / adjustedDirect)
            : row.inversePrice;

          return {
            ...row,
            directPrice: adjustedDirect,
            inversePrice: adjustedInverse,
            satsPerSecondary: primaryCurrency === "BTC"
              ? adjustedInverse * 100000000
              : row.satsPerSecondary,
            satValueInSecondary: primaryCurrency === "BTC"
              ? adjustedDirect / 100000000
              : row.satValueInSecondary,
          };
        })
      : transformedRows;

    const transformedAllRows = transformRowsForCurrencyPair(allRows, primaryCurrency, secondaryCurrency);
    const adjustedAllRows = applyRedenomAdjustment
      ? transformedAllRows.map((row) => {
          const adjustedDirect = getRedenomAdjustedChartValue(
            row.directPrice,
            row.date,
            secondaryCurrency,
            primaryCurrency,
            redenominationCurrency,
            redenomAnchorDate
          );
          const adjustedInverse = Number.isFinite(adjustedDirect) && adjustedDirect > 0
            ? (1 / adjustedDirect)
            : row.inversePrice;

          return {
            ...row,
            directPrice: adjustedDirect,
            inversePrice: adjustedInverse,
            satsPerSecondary: primaryCurrency === "BTC"
              ? adjustedInverse * 100000000
              : row.satsPerSecondary,
            satValueInSecondary: primaryCurrency === "BTC"
              ? adjustedDirect / 100000000
              : row.satValueInSecondary,
          };
        })
      : transformedAllRows;

    const latest = adjustedRows[adjustedRows.length - 1] || adjustedAllRows[adjustedAllRows.length - 1];
    const latestOriginal = rows[rows.length - 1] || allRows[allRows.length - 1];
    if (!latest || !latestOriginal) return;
    const hasBtcInPair = primaryCurrency === "BTC" || secondaryCurrency === "BTC";
    const satsTicks = [
      { value: 1, label: "1 sat" },
      { value: 10, label: "10 sats" },
      { value: 100, label: "100 sats" },
      { value: 1000, label: "1k sats" },
      { value: 10000, label: "10k sats" },
      { value: 100000, label: "100k sats" },
      { value: 1000000, label: "1M sats" },
      { value: 10000000, label: "10M sats" },
      { value: 100000000, label: "1 BTC" },
    ];

    const hasPreciousMetalInPair = isPreciousMetalCurrency(primaryCurrency) || isPreciousMetalCurrency(secondaryCurrency);
    const leftMainValue = isPreciousMetalCurrency(primaryCurrency)
      ? latest.inversePrice
      : latest.inversePrice;
    const rightMainValue = isPreciousMetalCurrency(secondaryCurrency)
      ? latest.directPrice
      : latest.directPrice;
    const showSubtext = hasBtcInPair || hasPreciousMetalInPair;
    if (el.satUsdText) el.satUsdText.style.display = showSubtext ? "" : "none";
    if (el.usdSatText) el.usdSatText.style.display = showSubtext ? "" : "none";

    el.usdBtcBig.textContent = primaryCurrency === "BTC"
      ? fmtSats(latest.satsPerSecondary)
      : isPreciousMetalCurrency(primaryCurrency)
        ? formatOunceAmount(leftMainValue)
        : formatRateValue(leftMainValue, primaryCurrency);
    el.btcUsdBig.textContent = secondaryCurrency === "BTC"
      ? fmtSats(latest.directPrice * 100000000)
      : isPreciousMetalCurrency(secondaryCurrency)
        ? formatOunceAmount(rightMainValue)
        : formatRateValue(rightMainValue, secondaryCurrency);

    const primaryUnit = formatCurrencyUnit(primaryCurrency);
    const secondaryUnit = formatCurrencyUnit(secondaryCurrency);

    if (hasBtcInPair) {
      if (primaryCurrency === "BTC") {
        el.satUsdText.textContent = fmtCurrencyToBtcSubtext(secondaryUnit, latest.inversePrice);
        el.usdSatText.textContent = `1 sat = ${formatSatSubtextValue(latest.satValueInSecondary, secondaryCurrency)}`;
      } else {
        const satValueInPrimary = latest.inversePrice / 100000000;
        el.satUsdText.textContent = `1 sat = ${formatSatSubtextValue(satValueInPrimary, primaryCurrency)}`;
        el.usdSatText.textContent = `${primaryUnit} = ${fmtBtc(latest.directPrice)}`;
      }
    } else if (hasPreciousMetalInPair) {
      if (primaryCurrency !== secondaryCurrency) {
        let nonMetalCurrency;
        let nonMetalPerOunce;
        let ouncesPerNonMetal;

        if (isPreciousMetalCurrency(primaryCurrency) && !isPreciousMetalCurrency(secondaryCurrency)) {
          nonMetalCurrency = secondaryCurrency;
          nonMetalPerOunce = latest.directPrice;
          ouncesPerNonMetal = latest.inversePrice;
        } else if (!isPreciousMetalCurrency(primaryCurrency) && isPreciousMetalCurrency(secondaryCurrency)) {
          nonMetalCurrency = primaryCurrency;
          nonMetalPerOunce = latest.inversePrice;
          ouncesPerNonMetal = latest.directPrice;
        }

        if (nonMetalCurrency && Number.isFinite(nonMetalPerOunce) && Number.isFinite(ouncesPerNonMetal)) {
          el.satUsdText.textContent = `1 oz = ${formatRateValue(nonMetalPerOunce, nonMetalCurrency)}`;
          el.usdSatText.textContent = `${formatCurrencyUnit(nonMetalCurrency)} = ${formatOunceAmount(ouncesPerNonMetal)}`;
        } else {
          el.satUsdText.textContent = "N/A";
          el.usdSatText.textContent = "N/A";
        }
      }
    } else {
      if (el.satUsdText) el.satUsdText.textContent = "";
      if (el.usdSatText) el.usdSatText.textContent = "";
    }

    if (el.rightAsOf) el.rightAsOf.textContent = fmtDate(latestOriginal.date);
    if (el.updatedKpiValue) {
      el.updatedKpiValue.textContent = refreshedAtText
        ? formatUpdatedDisplayText(refreshedAtText)
        : formatUpdatedKpiTimestamp(latestOriginal.date);
    }

    // Determine colors and labels based on pair
    const chartColors = getChartAccentColors(primaryCurrency, secondaryCurrency);
    const leftColor = chartColors.left;
    const rightColor = chartColors.right;
    if (el.usdBtcBig) el.usdBtcBig.style.color = leftColor;
    if (el.btcUsdBig) el.btcUsdBig.style.color = rightColor;

    const leftSeries = adjustedRows.map((r) => {
      const baseValue = primaryCurrency === "BTC" ? r.satsPerSecondary : r.inversePrice;
      return {
        date: r.date,
        value: baseValue,
      };
    });
    const rightSeries = adjustedRows.map((r) => {
      const baseValue = secondaryCurrency === "BTC" ? r.directPrice * 100000000 : r.directPrice;
      return {
        date: r.date,
        value: baseValue,
      };
    });

    const getRangeAxisHints = (displaySeries, allSeries, chartScaleMode) => {
      if (!Array.isArray(displaySeries) || displaySeries.length < 1 || !Array.isArray(allSeries) || allSeries.length < 2) {
        return null;
      }
      const startPoint = displaySeries[0];
      if (!startPoint?.date || !Number.isFinite(startPoint.value)) return null;
      const startTime = startPoint.date.getTime();
      const idx = allSeries.findIndex((s) => s?.date && s.date.getTime() === startTime);
      if (idx < 0) return null;

      // Use n+1 specifically (next date in the full series) to anchor axis scaling.
      const nextPoint = allSeries[idx + 1] || null;
      if (!nextPoint || !Number.isFinite(nextPoint.value)) return null;

      const startValue = startPoint.value;
      const nextValue = nextPoint.value;

      let minYFloor = null;
      let maxYFloor = null;
      let axisReferenceSeries = null;

      if (chartScaleMode === "log") {
        if (!(startValue > 0 && nextValue > 0)) return null;
        let ratio = Math.max(startValue / nextValue, nextValue / startValue);
        if (!Number.isFinite(ratio) || ratio <= 1) ratio = 1.01;
        maxYFloor = startValue * ratio;

        // Apply the n->n+1 anchored lower bound to all start->end ranges.
        minYFloor = startValue / ratio;

        // Single-point frame still uses explicit axis reference for stable ticks.
        if (displaySeries.length === 1) {
          axisReferenceSeries = [startPoint, nextPoint];
        }
      } else {
        let delta = Math.abs(nextValue - startValue);
        if (!Number.isFinite(delta) || delta <= 0) {
          delta = Math.max(Math.abs(startValue) * 0.01, LOG_MIN_POSITIVE);
        }
        maxYFloor = startValue + delta;

        // Apply the n->n+1 anchored lower bound to all start->end ranges.
        minYFloor = startValue - delta;

        // Single-point frame still uses explicit axis reference for stable ticks.
        if (displaySeries.length === 1) {
          axisReferenceSeries = [startPoint, nextPoint];
        }
      }

      return {
        axisReferenceSeries,
        minYFloor,
        maxYFloor,
      };
    };

    const leftSeriesAllForAxis = adjustedAllRows.map((r) => {
      const baseValue = primaryCurrency === "BTC" ? r.satsPerSecondary : r.inversePrice;
      return {
        date: r.date,
        value: baseValue,
      };
    });
    const rightSeriesAllForAxis = adjustedAllRows.map((r) => {
      const baseValue = secondaryCurrency === "BTC" ? r.directPrice * 100000000 : r.directPrice;
      return {
        date: r.date,
        value: baseValue,
      };
    });

    const leftAxisHints = getRangeAxisHints(leftSeries, leftSeriesAllForAxis, leftScaleMode);
    const rightAxisHints = getRangeAxisHints(rightSeries, rightSeriesAllForAxis, rightScaleMode);
    const getExportYAxisReferenceSeries = (allSeriesForAxis) => {
      if (!isRenderingDateRangeExportFrame || !Array.isArray(activeDateRangeExportAxisRows) || activeDateRangeExportAxisRows.length < 2) {
        return null;
      }
      if (!Array.isArray(allSeriesForAxis) || allSeriesForAxis.length < 2) return null;
      const startTime = activeDateRangeExportAxisRows[0]?.date?.getTime?.();
      const endTime = activeDateRangeExportAxisRows[activeDateRangeExportAxisRows.length - 1]?.date?.getTime?.();
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;
      const reference = allSeriesForAxis.filter((point) => {
        const time = point?.date?.getTime?.();
        return Number.isFinite(time) && time >= startTime && time <= endTime;
      });
      return reference.length >= 2 ? reference : null;
    };
    const leftExportYAxisReferenceSeries = getExportYAxisReferenceSeries(leftSeriesAllForAxis);
    const rightExportYAxisReferenceSeries = getExportYAxisReferenceSeries(rightSeriesAllForAxis);

    const leftFormatter = (value) => {
      if (!Number.isFinite(value) || value < 0) return "0";
      if (primaryCurrency === "BTC") return fmtSatAxisLabel(value);
      if (isPreciousMetalCurrency(primaryCurrency)) {
        return formatCompactOunceYAxisLabel(value);
      }
      return formatCompactYAxisLabel(value, primaryCurrency);
    };
    const rightFormatter = (value) => {
      if (!Number.isFinite(value) || value < 0) return "0";
      if (secondaryCurrency === "BTC") return fmtSatAxisLabel(value);
      if (isPreciousMetalCurrency(secondaryCurrency)) {
        return formatCompactOunceYAxisLabel(value);
      }
      return formatCompactYAxisLabel(value, secondaryCurrency);
    };

    const leftEventMarkers = [];
    const rightEventMarkers = [];
    let leftOverlapLabelFn = null;
    let rightOverlapLabelFn = null;

    const pairNotableEvents = [];
    [primaryCurrency, secondaryCurrency].forEach((currencyCode) => {
      getCurrencyNotableEvents(currencyCode).forEach((event) => {
        pairNotableEvents.push({ currencyCode, ...event });
      });
    });
    const seenEventKeys = new Set();
    pairNotableEvents.forEach((event) => {
      const key = `${event.currencyCode}:${event.date}:${event.label}:${event.devaluationEstimate || ""}`;
      if (seenEventKeys.has(key)) return;
      seenEventKeys.add(key);
      const tooltip = event.devaluationEstimate
        ? `${event.date}\n${event.label}\n${event.devaluationEstimate}`
        : `${event.date}\n${event.label}`;
      leftEventMarkers.push({
        dateIso: event.date,
        tooltip,
      });
      rightEventMarkers.push({
        dateIso: event.date,
        tooltip,
      });
    });

    if (hasRedenomInPair) {
      const redenomEvents = getRedenominationEvents(redenominationCurrency);
      redenomEvents.forEach((event) => {
        leftEventMarkers.push({
          dateIso: event.date,
          tooltip: `${event.date}\n${redenominationCurrency} ${event.ratioLabel} redenomination`,
        });
        rightEventMarkers.push({
          dateIso: event.date,
          tooltip: `${event.date}\n${redenominationCurrency} ${event.ratioLabel} redenomination`,
        });
      });

      if (!applyRedenomAdjustment) {
        // Stars remain visible even without redenomination adjustment; slash labels remain off.
      } else {
        const currentSegmentFactor = getCumulativeRedenomFactorAtDate(
          redenominationCurrency,
          latestOriginal.date,
          redenomAnchorDate
        );

        if (redenominationCurrency === "VES") {
          const leftRawSeriesAll = transformedAllRows.map((r) => ({
            date: r.date,
            value: primaryCurrency === "BTC" ? r.satsPerSecondary : r.inversePrice,
          }));
          const leftNumeratorCurrency = secondaryCurrency;
          const leftDenominatorCurrency = primaryCurrency;
          const rightRawSeriesAll = transformedAllRows.map((r) => ({
            date: r.date,
            value: secondaryCurrency === "BTC" ? r.directPrice * 100000000 : r.directPrice,
          }));
          const rightNumeratorCurrency = primaryCurrency;
          const rightDenominatorCurrency = secondaryCurrency;
          const leftOverlapRanges = [];
          const rightOverlapRanges = [];

          const eventSegmentFilter = (point, eventDate, prevEventDate, nextEventDate, isPostEvent) => {
            if (isPostEvent) {
              if (!(point.date >= eventDate)) return false;
              if (nextEventDate && point.date >= nextEventDate) return false;
              return true;
            }
            if (!(point.date < eventDate)) return false;
            if (prevEventDate && point.date < prevEventDate) return false;
            return true;
          };

          const segmentCrossesTick = (points, tickValue) => {
            if (!Array.isArray(points) || points.length === 0 || !Number.isFinite(tickValue) || tickValue <= 0) return false;
            if (points.length === 1) {
              const v = points[0]?.value;
              return Number.isFinite(v) && v > 0 && Math.abs(v - tickValue) <= (tickValue * 1e-9);
            }
            for (let i = 1; i < points.length; i += 1) {
              const a = points[i - 1]?.value;
              const b = points[i]?.value;
              if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) continue;
              if ((a <= tickValue && b >= tickValue) || (a >= tickValue && b <= tickValue)) {
                return true;
              }
            }
            return false;
          };

          const computePaddedLogDomain = (points) => {
            const values = (Array.isArray(points) ? points : [])
              .map((p) => p?.value)
              .filter((v) => Number.isFinite(v) && v > 0);
            if (!values.length) return null;
            const dataMin = Math.min(...values);
            const dataMax = Math.max(...values);
            if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax) || dataMin <= 0 || dataMax <= 0) return null;
            const safeMin = Math.max(dataMin, LOG_MIN_POSITIVE);
            const safeMax = Math.max(dataMax, safeMin * (1 + 1e-15));
            const logSpan = Math.log(safeMax / safeMin);
            if (logSpan < 1e-6) {
              const center = Math.max(safeMin, LOG_MIN_POSITIVE);
              const factor = 1.01;
              return { min: center / factor, max: center * factor };
            }
            const logPad = Math.max(logSpan * 0.01, 1e-6);
            const factor = Math.exp(logPad);
            return { min: safeMin / factor, max: safeMax * factor };
          };

          const leftAdjustedDomain = computePaddedLogDomain(leftSeries);

          redenomEvents.forEach((event, eventIndex) => {
            const eventDate = parseIsoDateUtc(event.date);
            if (!eventDate) return;
            const preEventProbeDate = new Date(eventDate.getTime() - (24 * 60 * 60 * 1000));
            const preEventFactor = getCumulativeRedenomFactorAtDate(
              redenominationCurrency,
              preEventProbeDate,
              redenomAnchorDate
            );

            const prevEventDate = eventIndex > 0
              ? parseIsoDateUtc(redenomEvents[eventIndex - 1].date)
              : null;
            const nextEventDate = eventIndex < redenomEvents.length - 1
              ? parseIsoDateUtc(redenomEvents[eventIndex + 1].date)
              : null;

            const leftPreRawPoints = leftRawSeriesAll
              .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, false))
              .filter((point) => Number.isFinite(point.value) && point.value > 0);
            const leftPreAdjPoints = leftSeriesAllForAxis
              .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, false))
              .filter((point) => Number.isFinite(point.value) && point.value > 0);
            const leftPostRawPoints = leftRawSeriesAll
              .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, true))
              .filter((point) => Number.isFinite(point.value) && point.value > 0);
            const leftPostAdjPoints = leftSeriesAllForAxis
              .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, true))
              .filter((point) => Number.isFinite(point.value) && point.value > 0);
            const leftPreAdjVisiblePoints = leftSeries
              .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, false))
              .filter((point) => Number.isFinite(point.value) && point.value > 0);
            const leftPostAdjVisiblePoints = leftSeries
              .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, true))
              .filter((point) => Number.isFinite(point.value) && point.value > 0);

            const leftPreRawPointsExt = [...leftPreRawPoints];
            const leftPreAdjPointsExt = [...leftPreAdjPoints];
            if (leftPostRawPoints.length && leftPostAdjPoints.length) {
              const boundaryRawPoint = leftPostRawPoints[0];
              const boundaryAdjPoint = leftPostAdjPoints[0];
              if (boundaryRawPoint && Number.isFinite(boundaryRawPoint.value) && boundaryRawPoint.value > 0) {
                leftPreRawPointsExt.push({ date: eventDate, value: boundaryRawPoint.value * preEventFactor });
              }
              if (boundaryAdjPoint && Number.isFinite(boundaryAdjPoint.value) && boundaryAdjPoint.value > 0) {
                leftPreAdjPointsExt.push({ date: eventDate, value: boundaryAdjPoint.value });
              }
            }

            if (leftPreRawPointsExt.length && leftPreAdjPointsExt.length && leftPostAdjPoints.length) {
              leftOverlapRanges.push({
                eventDate,
                preFactor: preEventFactor,
                preAdjPoints: leftPreAdjPointsExt,
                postAdjPoints: leftPostAdjPoints,
                preVisibleInWindow: leftPreAdjVisiblePoints.length > 0,
                postVisibleInWindow: leftPostAdjVisiblePoints.length > 0,
              });
            }

            const rightPreRawPoints = rightRawSeriesAll
              .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, false))
              .filter((point) => Number.isFinite(point.value) && point.value > 0);
            const rightPreAdjPoints = rightSeriesAllForAxis
              .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, false))
              .filter((point) => Number.isFinite(point.value) && point.value > 0);
            const rightPostRawPoints = rightRawSeriesAll
              .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, true))
              .filter((point) => Number.isFinite(point.value) && point.value > 0);
            const rightPostAdjPoints = rightSeriesAllForAxis
              .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, true))
              .filter((point) => Number.isFinite(point.value) && point.value > 0);
            const rightPreAdjVisiblePoints = rightSeries
              .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, false))
              .filter((point) => Number.isFinite(point.value) && point.value > 0);
            const rightPostAdjVisiblePoints = rightSeries
              .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, true))
              .filter((point) => Number.isFinite(point.value) && point.value > 0);

            const rightPreRawPointsExt = [...rightPreRawPoints];
            const rightPreAdjPointsExt = [...rightPreAdjPoints];
            if (rightPostRawPoints.length && rightPostAdjPoints.length) {
              const boundaryRawPoint = rightPostRawPoints[0];
              const boundaryAdjPoint = rightPostAdjPoints[0];
              if (boundaryRawPoint && Number.isFinite(boundaryRawPoint.value) && boundaryRawPoint.value > 0) {
                rightPreRawPointsExt.push({ date: eventDate, value: boundaryRawPoint.value * preEventFactor });
              }
              if (boundaryAdjPoint && Number.isFinite(boundaryAdjPoint.value) && boundaryAdjPoint.value > 0) {
                rightPreAdjPointsExt.push({ date: eventDate, value: boundaryAdjPoint.value });
              }
            }

            if (rightPreRawPointsExt.length && rightPreAdjPointsExt.length && rightPostAdjPoints.length) {
              rightOverlapRanges.push({
                eventDate,
                preFactor: preEventFactor,
                preAdjPoints: rightPreAdjPointsExt,
                postAdjPoints: rightPostAdjPoints,
                preVisibleInWindow: rightPreAdjVisiblePoints.length > 0,
                postVisibleInWindow: rightPostAdjVisiblePoints.length > 0,
              });
            }
          });

          leftOverlapRanges.sort((a, b) => b.eventDate - a.eventDate);
          rightOverlapRanges.sort((a, b) => b.eventDate - a.eventDate);

          const getTotalRedenomFactor = () => {
            const hasRedenomAnchorDate = redenomAnchorDate instanceof Date && !Number.isNaN(redenomAnchorDate.getTime());
            return redenomEvents.reduce((acc, e) => {
              const eventDate = parseIsoDateUtc(e.date);
              if (hasRedenomAnchorDate && eventDate && eventDate > redenomAnchorDate) return acc;
              return acc * (Number(e.ratio) || 1);
            }, 1);
          };

          if (leftOverlapRanges.length) {
            const totalRedenomFactor = getTotalRedenomFactor();
            leftOverlapLabelFn = (tickValue, baseLabel) => {
              if (leftAdjustedDomain && tickValue > leftAdjustedDomain.max) return baseLabel;

              for (const range of leftOverlapRanges) {
                const preVisibleInWindow = !!range.preVisibleInWindow;
                const postVisibleInWindow = !!range.postVisibleInWindow;
                if (!preVisibleInWindow && !postVisibleInWindow) continue;

                const preAdjCross = segmentCrossesTick(range.preAdjPoints, tickValue);
                const postAdjCross = segmentCrossesTick(range.postAdjPoints, tickValue);
                if (!preAdjCross && !postAdjCross) continue;

                if (!preVisibleInWindow && postVisibleInWindow) return baseLabel;
                if (!postVisibleInWindow && preVisibleInWindow && !preAdjCross) continue;
                if (preVisibleInWindow && postVisibleInWindow && !preAdjCross && postAdjCross) return baseLabel;

                const oldValue = convertAdjustedTickToRawByFactor(
                  tickValue,
                  range.preFactor,
                  leftDenominatorCurrency,
                  leftNumeratorCurrency,
                  redenominationCurrency
                );
                if (!Number.isFinite(oldValue) || oldValue <= 0) continue;

                if (preAdjCross && !postAdjCross) return leftFormatter(oldValue);
                if (preVisibleInWindow && postVisibleInWindow && preAdjCross && postAdjCross) {
                  return `${leftFormatter(oldValue)}/${baseLabel}`;
                }
              }

              if (totalRedenomFactor > 1) {
                const oldValue = convertAdjustedTickToRawByFactor(
                  tickValue,
                  totalRedenomFactor,
                  leftDenominatorCurrency,
                  leftNumeratorCurrency,
                  redenominationCurrency
                );
                if (Number.isFinite(oldValue) && oldValue > 0) return leftFormatter(oldValue);
              }
              return null;
            };
          }

          if (rightOverlapRanges.length) {
            const totalRedenomFactor = getTotalRedenomFactor();
            rightOverlapLabelFn = (tickValue, baseLabel) => {
              for (const range of rightOverlapRanges) {
                const preVisibleInWindow = !!range.preVisibleInWindow;
                const postVisibleInWindow = !!range.postVisibleInWindow;
                if (!preVisibleInWindow && !postVisibleInWindow) continue;

                const preAdjCross = segmentCrossesTick(range.preAdjPoints, tickValue);
                const postAdjCross = segmentCrossesTick(range.postAdjPoints, tickValue);
                if (!preAdjCross && !postAdjCross) continue;

                if (!preVisibleInWindow && postVisibleInWindow) return baseLabel;
                if (!postVisibleInWindow && preVisibleInWindow && !preAdjCross) continue;
                if (preVisibleInWindow && postVisibleInWindow && !preAdjCross && postAdjCross) return baseLabel;

                const oldValue = convertAdjustedTickToRawByFactor(
                  tickValue,
                  range.preFactor,
                  rightDenominatorCurrency,
                  rightNumeratorCurrency,
                  redenominationCurrency
                );
                if (!Number.isFinite(oldValue) || oldValue <= 0) continue;

                if (preAdjCross && !postAdjCross) return rightFormatter(oldValue);
                if (preVisibleInWindow && postVisibleInWindow && preAdjCross && postAdjCross) {
                  return `${rightFormatter(oldValue)}/${baseLabel}`;
                }
              }

              if (totalRedenomFactor > 1) {
                const oldValue = convertAdjustedTickToRawByFactor(
                  tickValue,
                  totalRedenomFactor,
                  rightDenominatorCurrency,
                  rightNumeratorCurrency,
                  redenominationCurrency
                );
                if (Number.isFinite(oldValue) && oldValue > 0) return rightFormatter(oldValue);
              }
              return null;
            };
          }
        } else if (Number.isFinite(currentSegmentFactor) && currentSegmentFactor > 0 && currentSegmentFactor !== 1) {
          leftOverlapLabelFn = (tickValue, baseLabel) => {
            const rawValue = convertAdjustedTickToRawByFactor(
              tickValue,
              currentSegmentFactor,
              primaryCurrency,
              secondaryCurrency,
              redenominationCurrency
            );
            return Number.isFinite(rawValue) && rawValue > 0 ? leftFormatter(rawValue) : baseLabel;
          };
          rightOverlapLabelFn = (tickValue, baseLabel) => {
            const rawValue = convertAdjustedTickToRawByFactor(
              tickValue,
              currentSegmentFactor,
              secondaryCurrency,
              primaryCurrency,
              redenominationCurrency
            );
            return Number.isFinite(rawValue) && rawValue > 0 ? rightFormatter(rawValue) : baseLabel;
          };
        }
      }
    }

    // Left chart: secondary currency in terms of primary
    drawChart(
      el.usdBtcChart,
      leftSeries,
      {
        scaleMode: leftScaleMode,
        color: leftColor,
        tickSide: "left",
        yAxisCurrency: primaryCurrency,
        linearFormatter: leftFormatter,
        overlapLabelFn: leftOverlapLabelFn,
        eventMarkers: leftEventMarkers,
        edgeTrackEl: el.usdBtcDateEdges,
        axisReferenceSeries: leftAxisHints?.axisReferenceSeries || null,
        yAxisReferenceSeries: leftExportYAxisReferenceSeries,
        minYFloor: leftAxisHints?.minYFloor,
        maxYFloor: leftAxisHints?.maxYFloor,
        ticks: primaryCurrency === "BTC" ? [
          { value: 1, label: "1 sat" },
          { value: 10, label: "10 sats" },
          { value: 100, label: "100 sats" },
          { value: 1000, label: "1k sats" },
          { value: 10000, label: "10k sats" },
          { value: 100000, label: "100k sats" },
          { value: 1000000, label: "1M sats" },
          { value: 10000000, label: "10M sats" },
          { value: 100000000, label: "1 BTC" },
        ] : [],
      }
    );

    // Right chart: primary currency in terms of secondary
    drawChart(
      el.btcUsdChart,
      rightSeries,
      {
        scaleMode: rightScaleMode,
        color: rightColor,
        tickSide: "left",
        yAxisCurrency: secondaryCurrency,
        linearFormatter: rightFormatter,
        overlapLabelFn: rightOverlapLabelFn,
        eventMarkers: rightEventMarkers,
        edgeTrackEl: el.btcUsdDateEdges,
        axisReferenceSeries: rightAxisHints?.axisReferenceSeries || null,
        yAxisReferenceSeries: rightExportYAxisReferenceSeries,
        minYFloor: rightAxisHints?.minYFloor,
        maxYFloor: rightAxisHints?.maxYFloor,
        ticks: secondaryCurrency === "BTC" ? satsTicks : secondaryCurrency === "USD" ? [
          { value: 0.001, label: "0.1¢" },
          { value: 0.01, label: "1¢" },
          { value: 0.1, label: "10¢" },
          { value: 1, label: "$1" },
          { value: 10, label: "$10" },
          { value: 100, label: "$100" },
          { value: 1000, label: "$1k" },
          { value: 10000, label: "$10k" },
          { value: 100000, label: "$100k" },
        ] : secondaryCurrency === "EUR" ? [
          { value: 1, label: "€1" },
          { value: 10, label: "€10" },
          { value: 100, label: "€100" },
          { value: 500, label: "€500" },
          { value: 1000, label: "€1,000" },
          { value: 5000, label: "€5,000" },
          { value: 10000, label: "€10,000" },
        ] : [],
      }
    );
  }

  async function init() {
    // Load metadata first
    uoaPairs = await loadUoaPairs();
    fxRatesByDate = await loadFxRates();
    refreshedAtText = await loadLastUpdatedText();

    const loaded = await loadData();
    allRows = mergePriceRowsWithFxDates(loaded.rows, fxRatesByDate);
    usdParityStartIso = computeUsdParityStartIso();
    rows = [...allRows];

    // Populate dropdowns from metadata
    populateCurrencyDropdowns();
    populateUpdatedTimeZoneSelect();

    const saved = initControls();
    bindTimeZonePreferenceSync();
    bindChartEventHover(el.usdBtcChart);
    bindChartEventHover(el.btcUsdChart);
    bindDateRangeExportUnloadGuard();
    primeKeyboardFocus();
    bindDateRangePlaybackArrowScrubbing();
    applyFilters();
    restorePausedPlaybackSession(saved);
    document.body.classList.remove("uoa-loading");
    window.addEventListener("resize", () => {
      renderAll();
    });
  }

  init().catch((err) => {
    console.error(err);
  });
}());
