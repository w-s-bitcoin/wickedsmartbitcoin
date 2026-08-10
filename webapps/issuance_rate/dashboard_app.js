(() => {
  const THEME_KEY = "quantum-research-dashboard-theme";
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
    document.dispatchEvent(new CustomEvent("dashboard-theme-change"));
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
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === THEME_KEY && (event.newValue === "light" || event.newValue === "dark")) {
      applyTheme(event.newValue);
    }
  });

  const STORAGE_KEY = "issuance_rate_dashboard_state_v1";
  const DOWNLOAD_SETTINGS_KEY = "issuance_rate_download_settings_v1";
  const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];
  const EXPORT_VIDEO_FPS = 30;
  const EXPORT_START_HOLD_SECONDS = 1;
  const EXPORT_END_HOLD_SECONDS = 3;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const AUTO_REFRESH_MS = 60000;
  const DASHBOARD_TIME = window.WSBDashboardTime || null;
  const DASHBOARD_COMPONENTS = window.WSBDashboardComponents || {};
  const ICONS = {
    copyLink: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
    copyCopied: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>',
    resetRestore: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>',
    resetUndo: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M9 14 4 9l5-5"></path><path d="M4 9h10a6 6 0 0 1 0 12h-1"></path></svg>',
  };

  const state = {
    data: null,
    rows: [],
    startIndex: 0,
    endIndex: 0,
    currentIndex: 0,
    isPlaying: false,
    isPaused: false,
    playbackSpeed: 1,
    timerId: null,
    timeZone: DASHBOARD_TIME?.getPreferredTimeZone?.() || "UTC",
    selectedPreset: "custom",
    viewMode: "single",
    scaleMode: "linear",
    showPerfectIssuanceMarkers: true,
    showTargetIssuanceRate: true,
    dailyCalculationsUseSelectedTimeZone: false,
    endTracksLatest: true,
    currentTracksLatest: true,
    downloadSettings: {
      scale: "linear",
      orientation: "landscape",
      quality: "720",
      speed: "1",
      theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
      extension: "webm",
      endFrameHold: true,
    },
    dataSignature: "",
    autoRefreshTimer: null,
    refreshInFlight: false,
  };
  const updatedTimeZoneChip = DASHBOARD_COMPONENTS.createUpdatedTimeZoneChipController?.({
    getTimeZone: () => state.timeZone || DASHBOARD_TIME?.getPreferredTimeZone?.() || "UTC",
    setTimeZone: (value) => {
      state.timeZone = DASHBOARD_TIME?.setPreferredTimeZone?.(value) || value || "UTC";
      return state.timeZone;
    },
    onChange: (timeZone) => {
      state.timeZone = timeZone || state.timeZone;
      updateStatus();
      if (state.dailyCalculationsUseSelectedTimeZone) renderChart();
    },
  });

  const els = {};
  let customTooltipBound = false;
  let customTooltipAnchor = null;
  let preResetStateSnapshot = null;
  let dateRangeCurrentMarkerDrag = null;
  let dateRangeHandleDrag = null;
  let dateRangeLastAdjustedHandle = null;
  let dateRangeKeyboardShortcutsBound = false;
  let dateRangeSessionPersistenceBound = false;
  let dateRangePlaybackOutsidePointerHandler = null;
  let dateRangePlaybackOutsidePointerTouchState = null;
  let isDateRangeExporting = false;
  let dateRangeExportCancelRequested = false;
  let renderedRangePresetKey = "";
  let layoutSyncFrameId = null;
  const downloadEstimateCalibrationCache = new Map();
  const downloadEstimateCalibrationPending = new Set();
  let downloadEstimateCalibrationRequestId = 0;
  let downloadEstimateCalibrationTimer = null;
  const epochLogMinCache = new Map();
  const epochTargetLogMinCache = new Map();
  const timeZoneAdjustedRowsCache = new Map();
  const timeZoneFormatterCache = new Map();

  function $(id) {
    return document.getElementById(id);
  }

  function setButtonIcon(id, svg) {
    const icon = $(id);
    if (icon) icon.innerHTML = svg;
  }

  function setCustomTooltip(el, text) {
    if (!el) return;
    const value = String(text || "").trim();
    if (value) {
      el.setAttribute("data-tooltip", value);
    } else {
      el.removeAttribute("data-tooltip");
    }
    el.removeAttribute("title");
  }

  function isMobileUiViewport() {
    return window.matchMedia("(max-width: 820px)").matches;
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

  function cacheElements() {
    [
      "issuanceChart", "chartLoading",
      "dateRangeStartInput", "dateRangeEndInput", "dateRangeStartBtn", "dateRangeEndBtn",
      "dateRangeStartLabel", "dateRangeEndLabel", "dateRangeDaysInput", "dateRangePlayBtn",
      "dateRangePauseBtn", "dateRangeStopBtn", "dateRangeSpeedBtn", "dashboardExpandBtn",
      "dateRangeDownloadBtn", "dateRangeSettingsBtn", "dateRangeSettingsMenu", "downloadSettingsDownloadBtn",
      "downloadEndFrameHoldToggle", "downloadEstimateSize", "downloadEstimateLength", "downloadEstimateTime",
      "dateRangeSliderWrap", "dateRangeStartSlider", "dateRangeEndSlider", "copyDashboardLink", "resetDashboard",
      "chipUpdated", "updatedTimeZoneSelect", "updatedTimeZoneDropdown", "updatedTimeZoneDropdownTrigger",
      "updatedTimeZoneDropdownMenu", "chipHeight", "chipEpoch", "chipSubsidy", "chipSupply", "chipDailyIssuance",
      "chipIssuanceRate", "issuanceSettingsBtn", "issuanceSettingsPanel", "issuanceSettingsClose",
      "showPerfectIssuanceToggle", "showTargetIssuanceRateToggle", "dailyCalculationsUseSelectedTimeZoneToggle",
    ].forEach((id) => {
      els[id] = $(id);
    });
  }

  function parseIso(value) {
    const [y, m, d] = String(value || "").split("-").map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  }

  function dateNum(value) {
    return Math.floor(parseIso(value).getTime() / MS_PER_DAY);
  }

  function addIsoDays(value, days) {
    const base = parseIso(value);
    if (Number.isNaN(base.getTime())) return "";
    return new Date(base.getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
  }

  function getSelectedDashboardTimeZone() {
    return String(state.timeZone || "UTC").trim() || "UTC";
  }

  function getDailyCalculationTimeZone() {
    return state.dailyCalculationsUseSelectedTimeZone ? getSelectedDashboardTimeZone() : "UTC";
  }

  function getTimeZoneFormatter(timeZone) {
    const zone = String(timeZone || "UTC").trim() || "UTC";
    if (!timeZoneFormatterCache.has(zone)) {
      try {
        timeZoneFormatterCache.set(zone, new Intl.DateTimeFormat("en-US", {
          timeZone: zone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        }));
      } catch (_) {
        timeZoneFormatterCache.set(zone, new Intl.DateTimeFormat("en-US", {
          timeZone: "UTC",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        }));
      }
    }
    return timeZoneFormatterCache.get(zone);
  }

  function getTimeZoneOffsetMinutes(timeZone, utcMs) {
    const formatter = getTimeZoneFormatter(timeZone);
    const parts = formatter.formatToParts(new Date(utcMs));
    const valueFor = (type) => Number(parts.find((part) => part.type === type)?.value);
    const year = valueFor("year");
    const month = valueFor("month");
    const day = valueFor("day");
    const hour = valueFor("hour");
    const minute = valueFor("minute");
    const second = valueFor("second");
    if (![year, month, day, hour, minute, second].every(Number.isFinite)) return 0;
    const localAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
    return (localAsUtcMs - utcMs) / 60000;
  }

  function localMidnightUtcDateNum(dateIso, timeZone) {
    const localMidnightAsUtcMs = parseIso(dateIso).getTime();
    if (!Number.isFinite(localMidnightAsUtcMs)) return NaN;
    let utcMs = localMidnightAsUtcMs;
    for (let i = 0; i < 3; i += 1) {
      utcMs = localMidnightAsUtcMs - getTimeZoneOffsetMinutes(timeZone, utcMs) * 60000;
    }
    return utcMs / MS_PER_DAY;
  }

  function subsidyForHeight(height) {
    const numericHeight = Math.max(0, Math.floor(Number(height)));
    if (!Number.isFinite(numericHeight)) return 0;
    const halvings = Math.floor(numericHeight / 210000);
    if (halvings >= 33) return 0;
    return 50 / (2 ** halvings);
  }

  function supplyAtHeight(height) {
    const numericHeight = Math.max(0, Math.floor(Number(height)));
    if (!Number.isFinite(numericHeight)) return 0;
    let remaining = numericHeight + 1;
    let supply = 0;
    let epoch = 0;
    while (remaining > 0 && epoch < 33) {
      const blocks = Math.min(remaining, 210000);
      supply += blocks * (50 / (2 ** epoch));
      remaining -= blocks;
      epoch += 1;
    }
    return supply;
  }

  function fmtDatePickerLabel(isoVal) {
    if (!isoVal) return '<span class="date-range-btn-placeholder" aria-hidden="true">00/00/00</span>';
    const [year, month, day] = String(isoVal).split("-");
    if (!year || !month || !day) return '<span class="date-range-btn-placeholder" aria-hidden="true">00/00/00</span>';
    return `${month}/${day}/${year.slice(2)}`;
  }

  function datePickerButtonHtml(isoVal) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${fmtDatePickerLabel(isoVal)}`;
  }

  function makeDatePicker({ anchorEl, align = "left", getSelected, getMin, getMax, onSelect }) {
    return window.WSBDashboardComponents.createDatePicker({ anchorEl, align, getSelected, getMin, getMax, onSelect });
  }

  function getPresetStartIndex(preset, endIndex) {
    const maxEnd = clamp(endIndex, 0, state.rows.length - 1);
    const epoch = getEpochFromPreset(preset);
    if (Number.isFinite(epoch)) {
      const idx = state.rows.findIndex((row) => Number(row?.epoch) === epoch);
      return idx >= 0 ? idx : 0;
    }
    return 0;
  }

  function getEpochFromPreset(preset) {
    const match = /^e(\d+)$/i.exec(String(preset || ""));
    if (!match) return NaN;
    const epoch = Number(match[1]);
    return Number.isFinite(epoch) && epoch >= 1 ? epoch : NaN;
  }

  function isValidViewMode(value) {
    return value === "single" || value === "all";
  }

  function isValidScaleMode(value) {
    return value === "linear" || value === "log";
  }

  function buildTimeZoneAdjustedRows(timeZone) {
    const zone = String(timeZone || "UTC").trim() || "UTC";
    const rows = state.rows;
    if (!rows.length) return [];

    return rows.map((row, idx) => {
      const date = String(row.date || "");
      const height = Number(row.height);
      const rollingStartHeight = Number(row.rolling_24h_start_height);
      if (idx === rows.length - 1 && Number.isFinite(height) && Number.isFinite(rollingStartHeight)) {
        return {
          ...row,
          timezone_blocks: Math.max(0, Math.round(height - rollingStartHeight)),
          uses_rolling_24h: true,
        };
      }
      const exact = state.data?.time_zone_daily?.[zone]?.[date];
      if (Array.isArray(exact) && exact.length >= 5) {
        const dailyIssuance = Number(exact[1]);
        const targetIssuance = Number(exact[2]);
        const issuanceRate = Number(exact[3]);
        const targetRate = Number(exact[4]);
        return {
          ...row,
          daily_issuance: Number.isFinite(dailyIssuance) ? dailyIssuance : Number(row.daily_issuance),
          issuance_rate: Number.isFinite(issuanceRate) ? issuanceRate : Number(row.issuance_rate),
          target_issuance: Number.isFinite(targetIssuance) ? targetIssuance : Number(row.target_issuance),
          target_rate: Number.isFinite(targetRate) ? targetRate : Number(row.target_rate),
          timezone_blocks: Number(exact[0]),
        };
      }
      const startBoundaryUtc = zone === "UTC" || zone === "Etc/UTC"
        ? dateNum(date)
        : localMidnightUtcDateNum(date, zone);
      const endBoundaryUtc = zone === "UTC" || zone === "Etc/UTC"
        ? dateNum(addIsoDays(date, 1))
        : localMidnightUtcDateNum(addIsoDays(date, 1), zone);
      const startBoundary = startBoundaryUtc - 1;
      const endBoundary = endBoundaryUtc - 1;
      const rawStartHeight = Math.round(interpolateHeightForDate(rows, startBoundary));
      const rawEndHeight = Math.round(interpolateHeightForDate(rows, endBoundary));
      const fallbackHeight = Math.max(0, Math.round(Number(row.height) || 0));
      const startHeight = Number.isFinite(rawStartHeight) ? Math.max(0, rawStartHeight) : fallbackHeight;
      const endHeight = Number.isFinite(rawEndHeight) ? Math.max(startHeight, rawEndHeight) : fallbackHeight;
      const blocks = Math.max(0, endHeight - startHeight);
      const supply = supplyAtHeight(endHeight);
      const dailyIssuance = Math.max(0, supply - supplyAtHeight(startHeight));
      const subsidy = subsidyForHeight(endHeight);
      const targetIssuance = 144 * subsidy;
      const issuanceRate = supply > 0 ? (dailyIssuance * 365) / supply : 0;
      const targetRate = supply > 0 ? (targetIssuance * 365) / supply : 0;
      return {
        ...row,
        daily_issuance: dailyIssuance,
        issuance_rate: issuanceRate,
        target_issuance: targetIssuance,
        target_rate: targetRate,
        timezone_blocks: blocks,
        timezone_start_height: startHeight,
        timezone_end_height: endHeight,
      };
    });
  }

  function getDisplayRows() {
    const zone = getDailyCalculationTimeZone();
    if (!timeZoneAdjustedRowsCache.has(zone)) {
      timeZoneAdjustedRowsCache.set(zone, buildTimeZoneAdjustedRows(zone));
    }
    return timeZoneAdjustedRowsCache.get(zone) || state.rows;
  }

  function getDisplayRow(index = state.currentIndex) {
    return getDisplayRows()[index] || state.rows[index] || null;
  }

  function niceLogFloor(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0.001;
    const exp = Math.floor(Math.log10(numeric));
    const base = 10 ** exp;
    const normalized = numeric / base;
    const multiplier = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
    return Math.max(0.001, multiplier * base);
  }

  function getEpochLogMin(epoch) {
    const numericEpoch = Number(epoch);
    if (!Number.isFinite(numericEpoch) || numericEpoch < 1) return 0.001;
    const cacheKey = `${getDailyCalculationTimeZone()}|${numericEpoch}`;
    if (epochLogMinCache.has(cacheKey)) return epochLogMinCache.get(cacheKey);
    let minPositive = Infinity;
    getDisplayRows().forEach((row) => {
      if (Number(row?.epoch) !== numericEpoch) return;
      [Number(row.issuance_rate) * 100, Number(row.target_rate) * 100].forEach((pct) => {
        if (Number.isFinite(pct) && pct > 0) minPositive = Math.min(minPositive, pct);
      });
    });
    const value = Number.isFinite(minPositive) ? niceLogFloor(minPositive) : 0.001;
    epochLogMinCache.set(cacheKey, value);
    return value;
  }

  function getEpochTargetLogMin(epoch) {
    const numericEpoch = Number(epoch);
    if (!Number.isFinite(numericEpoch) || numericEpoch < 1) return 0.001;
    const cacheKey = `${getDailyCalculationTimeZone()}|${numericEpoch}`;
    if (epochTargetLogMinCache.has(cacheKey)) return epochTargetLogMinCache.get(cacheKey);
    let minTarget = Infinity;
    getDisplayRows().forEach((row) => {
      if (Number(row?.epoch) !== numericEpoch) return;
      const pct = Number(row.target_rate) * 100;
      if (Number.isFinite(pct) && pct > 0) minTarget = Math.min(minTarget, pct);
    });
    const value = Number.isFinite(minTarget) ? niceLogFloor(Math.max(0.001, minTarget / 4)) : getEpochLogMin(numericEpoch);
    epochTargetLogMinCache.set(cacheKey, value);
    return value;
  }

  function getLogScaleEpochBlend(frame, fallbackEpoch) {
    const transitions = [
      { start: Math.floor(1426 / 10 * 9), end: 1426, from: 1, to: 2 },
      { start: Math.floor(1426 + ((2745 - 1426) / 10) * 9), end: 2745, from: 2, to: 3 },
      { start: Math.floor(2745 + ((4147 - 2745) / 10) * 9), end: 4147, from: 3, to: 4 },
      { start: Math.floor(4147 + ((5587 - 4147) / 10) * 9), end: 5587, from: 4, to: 5 },
    ];
    const active = transitions.find((transition) => frame > transition.start && frame < transition.end);
    if (!active) {
      const epoch = Number(fallbackEpoch);
      return { from: epoch, to: epoch, t: 0 };
    }
    return {
      from: active.from,
      to: active.to,
      t: clamp((frame - active.start) / Math.max(1, active.end - active.start), 0, 1),
    };
  }

  function getLogScaleDomain(frame, viewport) {
    const maxCeiling = 2500;
    const logMax = Math.max(0.01, Math.min(maxCeiling, Number(viewport.yMax) || maxCeiling));
    const blend = getLogScaleEpochBlend(frame, viewport.epoch);
    const epochLogMin = (epoch) => {
      if (state.viewMode === "all" && state.scaleMode === "log") return getEpochTargetLogMin(epoch);
      return getEpochLogMin(epoch);
    };
    const fromMin = epochLogMin(blend.from);
    const toMin = epochLogMin(blend.to);
    const rawLogMin = blend.t > 0
      ? 10 ** (Math.log10(fromMin) + (Math.log10(toMin) - Math.log10(fromMin)) * blend.t)
      : fromMin;
    const logMin = rawLogMin >= logMax ? niceLogFloor(logMax / 10) : rawLogMin;
    return { min: logMin, max: logMax };
  }

  function getAvailableEpochs() {
    const epochs = new Set();
    state.rows.forEach((row) => {
      const epoch = Number(row?.epoch);
      if (Number.isFinite(epoch) && epoch >= 1) epochs.add(epoch);
    });
    return Array.from(epochs).sort((a, b) => b - a);
  }

  function getDefaultPreset() {
    const epochs = getAvailableEpochs();
    if (epochs.includes(1)) return "e1";
    return epochs.length ? `e${epochs[epochs.length - 1]}` : "custom";
  }

  function inferPresetForRange(startIndex, endIndex) {
    if (endIndex !== state.rows.length - 1) return "custom";
    const match = getAvailableEpochs().find((epoch) => getPresetStartIndex(`e${epoch}`, endIndex) === startIndex);
    return Number.isFinite(match) ? `e${match}` : "custom";
  }

  function normalizeRangeIndices(start, end, current = end) {
    const max = state.rows.length - 1;
    if (max <= 0) {
      return { startIndex: 0, endIndex: 0, currentIndex: 0 };
    }
    const safeIndex = (value, fallback) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Math.round(numeric) : fallback;
    };
    const startIndex = clamp(safeIndex(start, 0), 0, max - 1);
    const endIndex = clamp(safeIndex(end, max), startIndex + 1, max);
    const currentIndex = clamp(safeIndex(current, endIndex), startIndex, endIndex);
    return { startIndex, endIndex, currentIndex };
  }

  function isLatestRowIndex(index) {
    const max = state.rows.length - 1;
    return max >= 0 && Number(index) >= max;
  }

  function renderRangePresetButtons() {
    const container = document.querySelector(".date-range-range-buttons");
    if (!container) return;
    const epochs = getAvailableEpochs().slice().reverse();
    const key = epochs.join(",");
    const existingButtons = Array.from(container.querySelectorAll("[data-range-preset]"));
    const existingKey = existingButtons.map((button) => {
      const preset = String(button.dataset.rangePreset || "");
      return preset.replace(/^e/i, "");
    }).join(",");
    if (key === renderedRangePresetKey || existingKey === key) {
      renderedRangePresetKey = key;
      return;
    }
    renderedRangePresetKey = key;
    container.querySelectorAll("[data-range-preset]").forEach((button) => button.remove());
    epochs.forEach((epoch) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "date-range-btn";
      button.dataset.rangePreset = `e${epoch}`;
      button.textContent = `E${epoch}-`;
      container.appendChild(button);
    });
  }

  function fmtDateShort(value) {
    const d = parseIso(value);
    if (Number.isNaN(d.getTime())) return "-";
    return new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", year: "numeric", timeZone: "UTC" }).format(d);
  }

  function estimateHalvingDateLabel(row, targetHeight, fallbackDate) {
    return fmtDateShort(estimateHalvingDateIso(row, targetHeight, fallbackDate));
  }

  function estimateHalvingDateIso(row, targetHeight, fallbackDate) {
    const currentHeight = Number(row?.height);
    const target = Number(targetHeight);
    if (!Number.isFinite(currentHeight) || !Number.isFinite(target) || currentHeight >= target) {
      return fallbackDate;
    }
    const base = parseIso(row?.date);
    if (Number.isNaN(base.getTime())) return fallbackDate;
    const projected = new Date(base.getTime() + (target - currentHeight) * 10 * 60 * 1000);
    return projected.toISOString().slice(0, 10);
  }

  function fmtPct(value, digits = 2) {
    if (!Number.isFinite(value)) return "-";
    return `${(value * 100).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
  }

  function fmtNumber(value, digits = 0) {
    if (!Number.isFinite(value)) return "-";
    return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function fmtAxisPercent(value, digits = 0) {
    if (!Number.isFinite(value)) return "-";
    const rounded = Math.round(value);
    if (Math.abs(value - rounded) < 1e-9) return `${fmtNumber(value, 0)}%`;
    return `${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits })}%`;
  }

  function fmtNumberTrim(value, maxDigits = 8) {
    if (!Number.isFinite(value)) return "-";
    return value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: maxDigits });
  }

  function getFormattedRowKpis(row) {
    const epoch = Number(row?.epoch);
    const supplyDigits = Number.isFinite(epoch) ? Math.max(0, epoch - 2) : 0;
    const issuanceDigits = Number.isFinite(epoch) ? Math.max(0, epoch - 2) : 0;
    const subsidy = Number(row?.subsidy);
    const supply = Number(row?.supply);
    const issuance = Number(row?.daily_issuance);
    const rate = Number(row?.issuance_rate);
    const height = Number(row?.height);
    return {
      height: Number.isFinite(height) ? height.toLocaleString("en-US") : "-",
      epoch: row ? String(row.epoch) : "-",
      subsidy: Number.isFinite(subsidy) ? `${fmtNumberTrim(subsidy, 8)} BTC` : "-",
      supply: Number.isFinite(supply) ? `${fmtNumber(supply, supplyDigits)} BTC` : "-",
      dailyIssuance: Number.isFinite(issuance) ? `${fmtNumber(issuance, issuanceDigits)} BTC` : "-",
      issuanceRate: Number.isFinite(rate) ? fmtPct(rate, 2) : "-",
    };
  }

  function setChipMinWidth(chipId, cssVar, label, values, minCh) {
    const maxTextLength = values.reduce((max, value) => {
      const text = `${label} ${value || "-"}`;
      return Math.max(max, text.length);
    }, `${label} -`.length);
    const widthCh = Math.max(minCh, maxTextLength + 4);
    document.documentElement.style.setProperty(cssVar, `${widthCh}ch`);
    const chip = $(chipId);
    if (chip) chip.style.minWidth = `var(${cssVar})`;
  }

  function applyTopKpiWidthLocks() {
    const formattedRows = state.rows.map(getFormattedRowKpis);
    setChipMinWidth("chipHeight", "--kpi-width-height", "Height", formattedRows.map((row) => row.height), 17);
    setChipMinWidth("chipEpoch", "--kpi-width-epoch", "Epoch", formattedRows.map((row) => row.epoch), 10);
    setChipMinWidth("chipSubsidy", "--kpi-width-subsidy", "Subsidy", formattedRows.map((row) => row.subsidy), 22);
    setChipMinWidth("chipSupply", "--kpi-width-supply", "Total Supply", formattedRows.map((row) => row.supply), 34);
    setChipMinWidth("chipDailyIssuance", "--kpi-width-daily-issuance", "Daily Issuance", formattedRows.map((row) => row.dailyIssuance), 29);
    setChipMinWidth("chipIssuanceRate", "--kpi-width-issuance-rate", "Issuance Rate", formattedRows.map((row) => row.issuanceRate), 21);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getHalvingDates() {
    return (state.data?.halvings || []).map((h) => ({
      ...h,
      num: dateNum(h.date),
    }));
  }

  function getFrameViewport(frame) {
    const epochContextPad = 0.025;
    const allViewEarliestMarkerAnchor = epochContextPad / (1 + 2 * epochContextPad);
    const allViewLatestMarkerAnchor = 1 - allViewEarliestMarkerAnchor;
    const yMaxClamp = 2500;
    const rows = state.rows;
    const row = rows[clamp(frame - 1, 0, rows.length - 1)] || rows[rows.length - 1];
    const halvings = getHalvingDates();
    const genesis = dateNum(state.data?.chart?.genesis_date || "2009-01-03");
    const fifth = dateNum(state.data?.chart?.fifth_halving_estimate || "2028-04-17");
    const fifthDate = state.data?.chart?.fifth_halving_estimate || "2028-04-17";
    const h = (idx) => halvings[idx]?.num;
    const hHeight = (idx) => Number(halvings[idx]?.height);
    const hDate = (idx) => halvings[idx]?.date;
    const halvingDateLabel = (idx) => estimateHalvingDateLabel(row, hHeight(idx), hDate(idx));
    const fifthLabel = () => estimateHalvingDateLabel(row, 1050000, fifthDate);
    const has = (idx) => Number.isFinite(h(idx));
    const lastHeight = Number(row?.height || 0);
    let epoch = 1;
    let yMin = 0;
    let yMax = 80;
    let xMin = genesis;
    let xMax = has(0) ? h(0) : dateNum(row.date);
    let xWidth = Math.max(1, xMax - xMin);
    const labels = [];
    const heightByHalvingLabel = {
      Genesis: 0,
      "1st Halving": 210000,
      "2nd Halving": 420000,
      "3rd Halving": 630000,
      "4th Halving": 840000,
      "5th Halving": 1050000,
    };

    const addHalving = (x, label, dateLabel, showDate = false, solid = false) => {
      if (!Number.isFinite(x)) return;
      labels.push({ x, label, dateLabel, showDate, solid });
    };
    const halvingBoundaryX = (idx) => {
      const targetHeight = hHeight(idx);
      if (Number.isFinite(targetHeight) && lastHeight < targetHeight) {
        return dateNum(estimateHalvingDateIso(row, targetHeight, hDate(idx)));
      }
      return h(idx);
    };
    const fifthBoundaryX = () => (
      lastHeight < 1050000 ? dateNum(estimateHalvingDateIso(row, 1050000, fifthDate)) : fifth
    );
    const estimatedBoundaryX = (idx) => (idx === 4 ? fifthBoundaryX() : halvingBoundaryX(idx));
    const boundaryX = (idx) => estimatedBoundaryX(idx);
    const allModeTransitionLatestMarker = () => {
      const transitions = [
        { start: Math.floor(1426 / 10 * 9), end: 1426, from: 0, to: 1 },
        { start: Math.floor(1426 + ((2745 - 1426) / 10) * 9), end: 2745, from: 1, to: 2 },
        { start: Math.floor(2745 + ((4147 - 2745) / 10) * 9), end: 4147, from: 2, to: 3 },
        { start: Math.floor(4147 + ((5587 - 4147) / 10) * 9), end: 5587, from: 3, to: 4 },
      ];
      const transition = transitions.find((item) => frame > item.start && frame < item.end);
      if (!transition) return NaN;
      const from = estimatedBoundaryX(transition.from);
      const to = estimatedBoundaryX(transition.to);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return NaN;
      const t = clamp((frame - transition.start) / Math.max(1, transition.end - transition.start), 0, 1);
      return from + (to - from) * t;
    };

    if (frame >= 5587 && has(3)) {
      epoch = 5;
      yMax = 2;
      xWidth = boundaryX(4) - boundaryX(3);
      xMin = boundaryX(3) - epochContextPad * xWidth;
      xMax = boundaryX(4) + 0.025 * xWidth;
      addHalving(boundaryX(3), "4th Halving", halvingDateLabel(3), lastHeight >= 840000);
      addHalving(boundaryX(4), "5th Halving", fifthLabel(), true);
    } else if (frame >= 4147 && has(2) && has(3)) {
      epoch = 4;
      const endFrame = 5587;
      const transitionStart = Math.floor(4147 + ((endFrame - 4147) / 10) * 9);
      if (frame <= transitionStart) {
        yMax = 4;
        xWidth = boundaryX(3) - boundaryX(2);
        xMin = boundaryX(2) - epochContextPad * xWidth;
        xMax = boundaryX(3) + 0.025 * xWidth;
      } else {
        const t = (frame - transitionStart) / (endFrame - transitionStart);
        yMax = 4 - t * 2;
        const xWidthStart = boundaryX(3) - boundaryX(2);
        const xWidthEnd = boundaryX(4) - boundaryX(3);
        xWidth = ((xWidthEnd - xWidthStart) * t) + xWidthStart;
        xMin = xWidthStart * t + boundaryX(2) - epochContextPad * xWidth;
        xMax = xWidthEnd * t + boundaryX(3) + 0.025 * xWidth;
      }
      if (xMin < boundaryX(2)) addHalving(boundaryX(2), "3rd Halving", halvingDateLabel(2), lastHeight >= 630000);
      addHalving(boundaryX(3), "4th Halving", halvingDateLabel(3), true);
      if (xMax - 0.05 * xWidth > boundaryX(4) + 0.008 * xWidth) addHalving(boundaryX(4), "5th Halving", fifthLabel(), true);
    } else if (frame >= 2745 && has(1) && has(2)) {
      epoch = 3;
      const endFrame = 4147;
      const transitionStart = Math.floor(2745 + ((endFrame - 2745) / 10) * 9);
      if (frame <= transitionStart) {
        yMax = 10;
        xWidth = boundaryX(2) - boundaryX(1);
        xMin = boundaryX(1) - epochContextPad * xWidth;
        xMax = boundaryX(2) + 0.025 * xWidth;
      } else {
        const t = (frame - transitionStart) / (endFrame - transitionStart);
        yMax = 10 - t * 6;
        const xWidthStart = boundaryX(2) - boundaryX(1);
        const xWidthEnd = boundaryX(3) - boundaryX(2);
        xWidth = ((xWidthEnd - xWidthStart) * t) + xWidthStart;
        xMin = xWidthStart * t + boundaryX(1) - epochContextPad * xWidth;
        xMax = xWidthEnd * t + boundaryX(2) + 0.025 * xWidth;
      }
      if (xMin < boundaryX(1)) addHalving(boundaryX(1), "2nd Halving", halvingDateLabel(1), lastHeight >= 420000);
      addHalving(boundaryX(2), "3rd Halving", halvingDateLabel(2), true);
      if (has(3) && xMax - 0.05 * xWidth > boundaryX(3) + 0.008 * xWidth) addHalving(boundaryX(3), "4th Halving", halvingDateLabel(3), true);
    } else if (frame >= 1426 && has(0) && has(1)) {
      epoch = 2;
      const endFrame = 2745;
      const transitionStart = Math.floor(1426 + ((endFrame - 1426) / 10) * 9);
      if (frame <= transitionStart) {
        yMax = 30;
        xWidth = boundaryX(1) - boundaryX(0);
        xMin = boundaryX(0) - epochContextPad * xWidth;
        xMax = boundaryX(1) + 0.025 * xWidth;
      } else {
        const t = (frame - transitionStart) / (endFrame - transitionStart);
        yMax = 30 - t * 20;
        const xWidthStart = boundaryX(1) - boundaryX(0);
        const xWidthEnd = boundaryX(2) - boundaryX(1);
        xWidth = ((xWidthEnd - xWidthStart) * t) + xWidthStart;
        xMin = xWidthStart * t + boundaryX(0) - epochContextPad * xWidth;
        xMax = xWidthEnd * t + boundaryX(1) + 0.025 * xWidth;
      }
      if (xMin < boundaryX(0)) addHalving(boundaryX(0), "1st Halving", halvingDateLabel(0), lastHeight >= 210000);
      addHalving(boundaryX(1), "2nd Halving", halvingDateLabel(1), true);
      if (has(2) && xMax - 0.05 * xWidth > boundaryX(2) + 0.008 * xWidth) addHalving(boundaryX(2), "3rd Halving", halvingDateLabel(2), true);
    } else if (has(0)) {
      epoch = 1;
      const transitionStart = Math.floor(1426 / 10 * 9);
      if (frame <= transitionStart) {
        yMax = Math.min(2500, 250 * transitionStart / Math.max(1, frame) - 170);
        xWidth = boundaryX(0) - genesis;
        xMin = genesis - epochContextPad * xWidth;
        xMax = boundaryX(0) + 0.025 * xWidth;
      } else {
        const t = (frame - transitionStart) / (1426 - transitionStart);
        yMax = 80 - t * 50;
        const xWidthStart = boundaryX(0) - genesis;
        const xWidthEnd = boundaryX(1) - boundaryX(0);
        xWidth = ((xWidthEnd - xWidthStart) * t) + xWidthStart;
        xMin = xWidthStart * t + genesis - epochContextPad * xWidth;
        xMax = xWidthEnd * t + boundaryX(0) + 0.025 * xWidth;
      }
      if (xMin < genesis) addHalving(genesis, "Genesis", "1/3/2009", true);
      addHalving(boundaryX(0), "1st Halving", halvingDateLabel(0), true);
      if (has(1) && xMax - 0.05 * xWidth > boundaryX(1) + 0.008 * xWidth) addHalving(boundaryX(1), "2nd Halving", halvingDateLabel(1), true);
    }

    if (state.viewMode === "all") {
      const upcomingHalvingHeight = Math.max(210000, (Math.floor(lastHeight / 210000) + 1) * 210000);
      const upcomingHalvingIdx = (upcomingHalvingHeight / 210000) - 1;
      const upcomingFallbackDate = upcomingHalvingHeight === 1050000
        ? fifthDate
        : hDate(upcomingHalvingIdx);
      const upcomingEstimatedX = upcomingHalvingHeight === 1050000
        ? fifthBoundaryX()
        : dateNum(estimateHalvingDateIso(row, upcomingHalvingHeight, upcomingFallbackDate));
      const transitionLatestMarker = allModeTransitionLatestMarker();
      const latestMarker = Number.isFinite(transitionLatestMarker)
        ? transitionLatestMarker
        : Number.isFinite(upcomingEstimatedX) && upcomingHalvingHeight > lastHeight
        ? upcomingEstimatedX
        : xMax - epochContextPad * xWidth;
      const rangeStart = dateNum(rows[state.startIndex]?.date);
      const rangeEnd = dateNum(rows[state.endIndex]?.date);
      if (Number.isFinite(rangeStart) && Number.isFinite(latestMarker) && latestMarker > rangeStart) {
        xWidth = (latestMarker - rangeStart) / (allViewLatestMarkerAnchor - allViewEarliestMarkerAnchor);
        xMin = rangeStart - allViewEarliestMarkerAnchor * xWidth;
        xMax = xMin + xWidth;
      } else if (Number.isFinite(rangeStart) && Number.isFinite(rangeEnd) && rangeEnd > rangeStart) {
        xWidth = (rangeEnd - rangeStart) / (allViewLatestMarkerAnchor - allViewEarliestMarkerAnchor);
        xMin = rangeStart - allViewEarliestMarkerAnchor * xWidth;
        xMax = xMin + xWidth;
      } else if (Number.isFinite(rangeStart)) {
        xMin = rangeStart;
        xMax = xMin + 1;
      } else if (Number.isFinite(rangeEnd)) {
        xMax = Math.max(xMin + 1, rangeEnd);
      }
      xWidth = Math.max(1, xMax - xMin);
      const displayRows = getDisplayRows();
      const visibleRows = displayRows.slice(state.startIndex, Math.min(state.currentIndex, state.endIndex) + 1);
      const visibleMax = visibleRows.reduce((max, visibleRow) => {
        const actual = Math.abs(Number(visibleRow.issuance_rate || 0) * 100);
        const target = state.showTargetIssuanceRate ? Math.abs(Number(visibleRow.target_rate || 0) * 100) : 0;
        return Math.max(max, actual, target);
      }, 0);
      if (visibleMax > 0) {
        const paddedMax = visibleMax * 1.08;
        const step = getYStep(paddedMax);
        yMax = Math.min(yMaxClamp, Math.max(step, Math.ceil(paddedMax / step) * step));
      }
      labels.length = 0;
      const markerMin = Number.isFinite(rangeStart) ? rangeStart : xMin;
      const addAllModeHalving = (idx, label, showDateHeight) => {
        if (!has(idx)) return;
        const targetHeight = hHeight(idx);
        const x = halvingBoundaryX(idx);
        const showDate = lastHeight < targetHeight || lastHeight >= showDateHeight;
        if (x >= markerMin && x <= xMax) addHalving(x, label, halvingDateLabel(idx), showDate);
      };
      if (genesis >= markerMin && genesis <= xMax) addHalving(genesis, "Genesis", "1/3/2009", true);
      addAllModeHalving(0, "1st Halving", 210000);
      addAllModeHalving(1, "2nd Halving", 420000);
      addAllModeHalving(2, "3rd Halving", 630000);
      addAllModeHalving(3, "4th Halving", 840000);
      const fifthX = fifthBoundaryX();
      if (Number.isFinite(fifthX) && fifthX >= markerMin && fifthX <= xMax) addHalving(fifthX, "5th Halving", fifthLabel(), true);
    }

    const epochLabels = [];
    const addEpochLabel = (start, end, label) => {
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
      const rangeStart = state.viewMode === "all" ? dateNum(state.rows[state.startIndex]?.date) : NaN;
      if (Number.isFinite(rangeStart) && rangeStart > end) return;
      const shortLabel = label.replace(/^Epoch\s+/i, "E");
      epochLabels.push({ start, end, x: start + (end - start) / 2, label, shortLabel });
    };
    const epochBoundary = (idx) => halvingBoundaryX(idx);
    const fifthEpochBoundary = fifthBoundaryX();
    if (has(0)) addEpochLabel(genesis, epochBoundary(0), "Epoch 1");
    if (has(0) && has(1)) addEpochLabel(epochBoundary(0), epochBoundary(1), "Epoch 2");
    if (has(1) && has(2)) addEpochLabel(epochBoundary(1), epochBoundary(2), "Epoch 3");
    if (has(2) && has(3)) addEpochLabel(epochBoundary(2), epochBoundary(3), "Epoch 4");
    if (has(3) && Number.isFinite(fifthEpochBoundary)) addEpochLabel(epochBoundary(3), fifthEpochBoundary, "Epoch 5");
    if (Number.isFinite(fifthEpochBoundary) && Number.isFinite(xMax) && xMax > fifthEpochBoundary) {
      const futureEpochEnd = xMax;
      addEpochLabel(fifthEpochBoundary, futureEpochEnd, "Epoch 6");
    }
    const heightAnchors = labels
      .map((label) => ({
        height: heightByHalvingLabel[label.label],
        date_num: label.x,
      }))
      .filter((anchor) => Number.isFinite(anchor.height) && Number.isFinite(anchor.date_num));

    return {
      epoch,
      yMin,
      yMax,
      xMin,
      xMax,
      xWidth: Math.max(1, xMax - xMin),
      labels,
      epochLabels,
      heightAnchors,
    };
  }

  function getYStep(yMax) {
    if (yMax >= 3000) return 1000;
    if (yMax >= 1500) return 500;
    if (yMax >= 600) return 200;
    if (yMax >= 300) return 100;
    if (yMax >= 150) return 50;
    if (yMax >= 60) return 20;
    if (yMax >= 30) return 10;
    if (yMax >= 15) return 5;
    if (yMax >= 8) return 2;
    return 1;
  }

  function getNiceBlockHeightStep(span, desiredTicks) {
    const raw = Math.max(1, Number(span) / Math.max(1, desiredTicks));
    const base = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].find((multiplier) => multiplier * base >= raw) * base;
  }

  function interpolateDateForHeight(rows, targetHeight) {
    const target = Number(targetHeight);
    if (!Number.isFinite(target) || !rows.length) return NaN;
    for (let i = 1; i < rows.length; i += 1) {
      const prev = rows[i - 1];
      const next = rows[i];
      const prevHeight = Number(prev.height);
      const nextHeight = Number(next.height);
      if (!Number.isFinite(prevHeight) || !Number.isFinite(nextHeight)) continue;
      const low = Math.min(prevHeight, nextHeight);
      const high = Math.max(prevHeight, nextHeight);
      if (target < low || target > high) continue;
      const prevDate = Number(prev.date_num ?? dateNum(prev.date));
      const nextDate = Number(next.date_num ?? dateNum(next.date));
      if (!Number.isFinite(prevDate) || !Number.isFinite(nextDate)) return NaN;
      if (nextHeight === prevHeight) return prevDate;
      const t = (target - prevHeight) / (nextHeight - prevHeight);
      return prevDate + (nextDate - prevDate) * clamp(t, 0, 1);
    }
    const first = rows[0];
    const last = rows[rows.length - 1];
    if (target === Number(first?.height)) return Number(first.date_num ?? dateNum(first.date));
    if (target === Number(last?.height)) return Number(last.date_num ?? dateNum(last.date));
    const lastHeight = Number(last?.height);
    const lastDate = Number(last?.date_num ?? dateNum(last?.date));
    if (Number.isFinite(lastHeight) && Number.isFinite(lastDate) && target > lastHeight) {
      return lastDate + ((target - lastHeight) / 144);
    }
    return NaN;
  }

  function interpolateHeightForDate(rows, targetDateNum) {
    const target = Number(targetDateNum);
    if (!Number.isFinite(target) || !rows.length) return NaN;
    for (let i = 1; i < rows.length; i += 1) {
      const prev = rows[i - 1];
      const next = rows[i];
      const prevDate = Number(prev.date_num ?? dateNum(prev.date));
      const nextDate = Number(next.date_num ?? dateNum(next.date));
      if (!Number.isFinite(prevDate) || !Number.isFinite(nextDate)) continue;
      const low = Math.min(prevDate, nextDate);
      const high = Math.max(prevDate, nextDate);
      if (target < low || target > high) continue;
      const prevHeight = Number(prev.height);
      const nextHeight = Number(next.height);
      if (!Number.isFinite(prevHeight) || !Number.isFinite(nextHeight)) return NaN;
      if (nextDate === prevDate) return prevHeight;
      const t = (target - prevDate) / (nextDate - prevDate);
      return prevHeight + (nextHeight - prevHeight) * clamp(t, 0, 1);
    }
    const first = rows[0];
    const last = rows[rows.length - 1];
    const firstDate = Number(first?.date_num ?? dateNum(first?.date));
    const firstHeight = Number(first?.height);
    if (Number.isFinite(firstDate) && Number.isFinite(firstHeight) && target <= firstDate) return firstHeight;
    const lastDate = Number(last?.date_num ?? dateNum(last?.date));
    const lastHeight = Number(last?.height);
    if (Number.isFinite(lastDate) && Number.isFinite(lastHeight) && target > lastDate) {
      return lastHeight + ((target - lastDate) * 144);
    }
    return NaN;
  }

  function getFrameRows() {
    const rows = getDisplayRows();
    if (state.viewMode === "all") {
      return rows.slice(state.startIndex, Math.min(state.currentIndex, state.endIndex) + 1);
    }
    return rows.slice(0, state.currentIndex + 1);
  }

  function setupCanvas(canvas) {
    const exportWidth = Number(canvas.__exportCssWidth);
    const exportHeight = Number(canvas.__exportCssHeight);
    const exportPixelWidth = Number(canvas.__exportPixelWidth);
    const exportPixelHeight = Number(canvas.__exportPixelHeight);
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Number.isFinite(exportWidth) && exportWidth > 0 ? exportWidth : rect.width;
    const cssHeight = Number.isFinite(exportHeight) && exportHeight > 0 ? exportHeight : rect.height;
    const dpr = canvas.__exportCssWidth
      ? Math.max(1, Math.min(
        Number.isFinite(exportPixelWidth) && exportPixelWidth > 0 ? exportPixelWidth / cssWidth : 1,
        Number.isFinite(exportPixelHeight) && exportPixelHeight > 0 ? exportPixelHeight / cssHeight : 1
      ))
      : Math.max(1, window.devicePixelRatio || 1);
    const width = canvas.__exportCssWidth && Number.isFinite(exportPixelWidth) && exportPixelWidth > 0
      ? Math.max(1, Math.floor(exportPixelWidth))
      : Math.max(1, Math.floor(cssWidth * dpr));
    const height = canvas.__exportCssHeight && Number.isFinite(exportPixelHeight) && exportPixelHeight > 0
      ? Math.max(1, Math.floor(exportPixelHeight))
      : Math.max(1, Math.floor(cssHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: cssWidth, height: cssHeight };
  }

  function drawText(ctx, text, x, y, options = {}) {
    ctx.save();
    ctx.font = `${options.weight || 500} ${options.size || 14}px ${options.family || "Space Grotesk, sans-serif"}`;
    ctx.fillStyle = options.color || getCss("--fg");
    ctx.textAlign = options.align || "left";
    ctx.textBaseline = options.baseline || "alphabetic";
    if (options.stroke !== false) {
      ctx.lineWidth = options.strokeWidth || 5;
      ctx.strokeStyle = getCss("--bg");
      ctx.strokeText(text, x, y);
    }
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawRichTextRight(ctx, segments, right, y, options = {}) {
    const family = options.family || "Helvetica Neue, Arial, sans-serif";
    const baseline = options.baseline || "top";
    const strokeWidth = options.strokeWidth || 5;
    const gap = options.gap ?? 6;
    let x = right;
    ctx.save();
    ctx.textBaseline = baseline;
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const segment = segments[i];
      const size = segment.size || options.size || 16;
      const weight = segment.weight || options.weight || 400;
      ctx.font = `${weight} ${size}px ${segment.family || family}`;
      const width = ctx.measureText(segment.text).width;
      x -= width;
      ctx.fillStyle = segment.color || options.color || getCss("--fg");
      ctx.textAlign = "left";
      if (segment.stroke !== false && options.stroke !== false) {
        ctx.lineWidth = segment.strokeWidth || strokeWidth;
        ctx.strokeStyle = getCss("--bg");
        ctx.strokeText(segment.text, x, y);
      }
      ctx.fillText(segment.text, x, y);
      x -= gap;
    }
    ctx.restore();
  }

  function getCss(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function renderChart() {
    if (!els.issuanceChart || !state.rows.length) return;
    const canvas = els.issuanceChart;
    const { ctx, width, height } = setupCanvas(canvas);
    const colors = {
      bg: getCss("--chart-bg") || getCss("--panel") || getCss("--bg") || "#000",
      fg: getCss("--fg") || "#fff",
      muted: getCss("--muted") || "#999",
      target: getCss("--target") || "#ff9900",
      actual: getCss("--actual") || "#fff",
      perfect: "#2ecc71",
      grid: document.documentElement.dataset.theme === "light" ? "rgba(0,0,0,.18)" : "rgba(255,255,255,.25)",
    };
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);

    const rows = getFrameRows();
    const viewport = getFrameViewport(state.currentIndex + 1);
    let yWidth = viewport.yMax - viewport.yMin;
    const xWidth = viewport.xWidth;
    const plot = {
      left: Math.max(70, width * 0.055),
      right: Math.max(18, width * 0.016),
      top: Math.max(28, height * 0.045),
      bottom: Math.max(42, height * 0.078),
    };
    const x0 = plot.left;
    const x1 = width - plot.right;
    const y0 = plot.top;
    const y1 = height - plot.bottom;
    const xFor = (num) => x0 + ((num - viewport.xMin) / Math.max(1, viewport.xMax - viewport.xMin)) * (x1 - x0);
    const useLogScale = state.scaleMode === "log";
    const logDomain = getLogScaleDomain(state.currentIndex + 1, viewport);
    const logMin = logDomain.min;
    const logMax = logDomain.max;
    const logMinValue = Math.log10(logMin);
    const logMaxValue = Math.log10(logMax);
    yWidth = useLogScale ? logMaxValue - logMinValue : yWidth;
    const yFor = (pct) => {
      if (useLogScale) {
        if (!Number.isFinite(pct) || pct <= 0) return y1;
        const clampedPct = Math.max(logMin, pct);
        return y1 - ((Math.log10(clampedPct) - logMinValue) / Math.max(0.0001, logMaxValue - logMinValue)) * (y1 - y0);
      }
      return y1 - ((pct - viewport.yMin) / Math.max(1, yWidth)) * (y1 - y0);
    };

    ctx.save();
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = colors.grid;
    ctx.fillStyle = colors.fg;
    const yTicks = [];
    if (useLogScale) {
      const minExp = Math.floor(Math.log10(logMin));
      const maxExp = Math.ceil(Math.log10(logMax));
      const lowerBound = logMin * (1 - 1e-9);
      const upperBound = logMax * (1 + 1e-9);
      for (let exp = minExp; exp <= maxExp; exp += 1) {
        [1, 2, 5].forEach((multiplier) => {
          const tick = multiplier * (10 ** exp);
          if (tick >= lowerBound && tick <= upperBound) yTicks.push(tick);
        });
      }
    } else {
      const yStep = getYStep(viewport.yMax);
      for (let y = 0; y <= viewport.yMax + 0.1 * yWidth; y += yStep) yTicks.push(y);
    }
    yTicks.forEach((y) => {
      const py = yFor(y);
      if (!Number.isFinite(py) || py < y0) return;
      ctx.beginPath();
      ctx.moveTo(x0, py);
      ctx.lineTo(x1, py);
      ctx.stroke();
      const decimals = useLogScale && y < 10 ? (y < 1 ? 2 : 1) : 0;
      drawText(ctx, fmtAxisPercent(y, decimals), x0 - 10, py, { size: 13, align: "right", baseline: "middle", color: colors.fg, strokeWidth: 4 });
    });
    ctx.restore();

    drawAxisLabels(ctx, width, height, viewport, colors, x0, x1, y0, y1);

    viewport.labels.forEach((label) => {
      const x = xFor(label.x);
      if (x < -20 || x > width + 20) return;
      ctx.save();
      ctx.strokeStyle = colors.fg;
      ctx.globalAlpha = 0.95;
      ctx.setLineDash(label.solid ? [] : [6, 6]);
      ctx.beginPath();
      ctx.moveTo(x, y0 - 3);
      ctx.lineTo(x, y1 + 3);
      ctx.stroke();
      ctx.restore();

      const labelY = y1 - 0.01 * (y1 - y0);
      const labelOffset = 0.0075 * xWidth * ((x1 - x0) / Math.max(1, viewport.xMax - viewport.xMin));
      const dateLabelOffset = Math.max(labelOffset * 2.4, 16);
      ctx.save();
      ctx.translate(x - labelOffset, labelY);
      ctx.rotate(-Math.PI / 2);
      drawText(ctx, label.label, 0, 0, { size: 13, align: "left", baseline: "bottom", color: colors.fg, strokeWidth: 4 });
      ctx.restore();
      if (label.showDate) {
        ctx.save();
        ctx.translate(x + dateLabelOffset, labelY);
        ctx.rotate(-Math.PI / 2);
        drawText(ctx, label.dateLabel, 0, 0, { size: 12, align: "left", baseline: "bottom", color: colors.fg, strokeWidth: 4 });
        ctx.restore();
      }
    });

    const clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    const plottedRows = useLogScale ? rows.filter((row) => Number(row.issuance_rate) > 0) : rows;
    if (!useLogScale) drawLine(ctx, rows.filter((row) => row.issuance_rate === 0), xFor, yFor, "issuance_rate", colors.actual, 1.5, clip);
    drawLine(ctx, plottedRows.filter((row) => Number(row.issuance_rate) !== 0), xFor, yFor, "issuance_rate", colors.actual, 1.5, clip);
    if (state.showTargetIssuanceRate) {
      drawLine(ctx, plottedRows, xFor, yFor, "target_rate", colors.bg, 6, clip);
      drawLine(ctx, plottedRows, xFor, yFor, "target_rate", colors.target, 4, clip);
    }
    if (state.showPerfectIssuanceMarkers) {
      drawPerfectIssuanceMarkers(ctx, plottedRows, xFor, yFor, colors, clip);
    }
    drawMonthDateTicks(ctx, rows, viewport, colors, xFor, x0, x1, y0);
    drawBlockHeightTicks(ctx, rows, viewport, colors, xFor, x0, x1, y1);
    drawChartStats(ctx, width, rows[rows.length - 1], colors, x0, x1, y0);
  }

  function drawMonthDateTicks(ctx, rows, viewport, colors, xFor, x0, x1, y0) {
    const minDate = new Date(Math.ceil(viewport.xMin) * MS_PER_DAY);
    const maxDate = new Date(Math.floor(viewport.xMax) * MS_PER_DAY);
    if (Number.isNaN(minDate.getTime()) || Number.isNaN(maxDate.getTime()) || maxDate <= minDate) return;
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const originYear = 2009;
    const originMonth = 0;
    const minMonthIndex = (minDate.getUTCFullYear() - originYear) * 12 + minDate.getUTCMonth() - originMonth;
    const maxMonthIndex = (maxDate.getUTCFullYear() - originYear) * 12 + maxDate.getUTCMonth() - originMonth;
    const firstVisibleMonthIndex = minDate.getUTCDate() <= 1 ? minMonthIndex : minMonthIndex + 1;
    const adjacentMonthSpacing = Math.abs(
      xFor(dateNum("2009-02-01")) - xFor(dateNum("2009-01-01"))
    );
    const monthIntervals = [1, 2, 3, 4, 6, 12, 24, 36, 48, 60, 120];
    const minLabelSpacing = 42;
    const monthInterval = monthIntervals.find((interval) => adjacentMonthSpacing * interval >= minLabelSpacing)
      || monthIntervals[monthIntervals.length - 1];
    const ticks = [];
    for (let monthIndex = Math.max(0, firstVisibleMonthIndex); monthIndex <= maxMonthIndex; monthIndex += 1) {
      if (monthIndex % monthInterval !== 0) continue;
      const cursor = new Date(Date.UTC(originYear, originMonth + monthIndex, 1));
      const x = xFor(Math.floor(cursor.getTime() / MS_PER_DAY));
      if (!Number.isFinite(x) || x < x0 || x > x1) continue;
      const tickMonth = cursor.getUTCMonth();
      ticks.push({
        x,
        label: tickMonth === 0 ? String(cursor.getUTCFullYear()) : monthNames[tickMonth],
      });
    }
    if (!ticks.length) return;

    ctx.save();
    ctx.strokeStyle = colors.muted;
    ctx.fillStyle = colors.muted;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.9;
    ticks.forEach((tick) => {
      ctx.beginPath();
      ctx.moveTo(tick.x, y0 - 3);
      ctx.lineTo(tick.x, y0 + 3);
      ctx.stroke();
      drawText(ctx, tick.label, tick.x, y0 - 7, {
        size: 10,
        align: "center",
        baseline: "bottom",
        color: colors.muted,
        strokeWidth: 3,
        family: "IBM Plex Mono, monospace",
        weight: 500,
      });
    });
    const currentRow = rows[rows.length - 1];
    const currentDate = Number(currentRow?.date_num ?? dateNum(currentRow?.date));
    const currentX = xFor(currentDate);
    if (Number.isFinite(currentX) && currentX >= x0 && currentX <= x1) {
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(currentX, y0, 2.75, 0, Math.PI * 2);
      ctx.fillStyle = colors.actual;
      ctx.fill();
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = getCss("--bg") || "#000";
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBlockHeightTicks(ctx, rows, viewport, colors, xFor, x0, x1, y1) {
    if (rows.length < 2) return;
    const interpolationRows = rows.concat(viewport.heightAnchors || [])
      .filter((row) => Number.isFinite(Number(row.height)) && Number.isFinite(Number(row.date_num ?? dateNum(row.date))))
      .sort((a, b) => Number(a.date_num ?? dateNum(a.date)) - Number(b.date_num ?? dateNum(b.date)));
    const minHeight = interpolateHeightForDate(interpolationRows, viewport.xMin);
    const maxHeight = interpolateHeightForDate(interpolationRows, viewport.xMax);
    if (!Number.isFinite(minHeight) || !Number.isFinite(maxHeight) || maxHeight <= minHeight) return;
    const desiredTicks = clamp(Math.floor((x1 - x0) / 115), 4, 12);
    const step = getNiceBlockHeightStep(maxHeight - minHeight, desiredTicks);
    const firstTick = Math.ceil(minHeight / step) * step;
    const ticks = [];
    for (let height = firstTick; height <= maxHeight; height += step) {
      const date = interpolateDateForHeight(interpolationRows, height);
      const x = xFor(date);
      if (Number.isFinite(x) && x >= x0 && x <= x1) ticks.push({ height, x });
    }
    if (!ticks.length) return;

    ctx.save();
    ctx.strokeStyle = colors.muted;
    ctx.fillStyle = colors.muted;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.9;
    const axisY = y1;
    let lastLabelX = -Infinity;
    ticks.forEach((tick) => {
      ctx.beginPath();
      ctx.moveTo(tick.x, axisY - 3);
      ctx.lineTo(tick.x, axisY + 3);
      ctx.stroke();
      if (tick.x - lastLabelX < 58) return;
      drawText(ctx, fmtNumber(tick.height, 0), tick.x, y1 + 20, {
        size: 10,
        align: "center",
        baseline: "bottom",
        color: colors.muted,
        strokeWidth: 3,
        family: "IBM Plex Mono, monospace",
        weight: 500,
      });
      lastLabelX = tick.x;
    });
    const currentRow = rows[rows.length - 1];
    const currentDate = Number(currentRow?.date_num ?? dateNum(currentRow?.date));
    const currentX = xFor(currentDate);
    if (Number.isFinite(currentX) && currentX >= x0 && currentX <= x1) {
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(currentX, axisY, 2.75, 0, Math.PI * 2);
      ctx.fillStyle = colors.actual;
      ctx.fill();
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = getCss("--bg") || "#000";
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawAxisLabels(ctx, width, height, viewport, colors, x0, x1, y0, y1) {
    ctx.save();
    ctx.translate(22, y0 + (y1 - y0) / 2);
    ctx.rotate(-Math.PI / 2);
    drawText(ctx, "Annualized Issuance Rate", 0, 0, {
      size: 15,
      align: "center",
      baseline: "middle",
      color: colors.fg,
      strokeWidth: 4,
      family: "Helvetica Neue, Arial, sans-serif",
      weight: 400,
    });
    ctx.restore();

    const xFor = (num) => x0 + ((num - viewport.xMin) / Math.max(1, viewport.xMax - viewport.xMin)) * (x1 - x0);
    const epochLabelLayouts = [];
    const size = 15;
    const family = "Helvetica Neue, Arial, sans-serif";
    const weight = 400;
    (viewport.epochLabels || []).forEach((epochLabel) => {
      const visibleStart = Math.max(Number(epochLabel.start), viewport.xMin);
      const visibleEnd = Math.min(Number(epochLabel.end), viewport.xMax);
      if (!Number.isFinite(visibleStart) || !Number.isFinite(visibleEnd) || visibleEnd <= visibleStart) return;
      const segmentLeft = Math.max(x0, xFor(visibleStart));
      const segmentRight = Math.min(x1, xFor(visibleEnd));
      const segmentWidth = segmentRight - segmentLeft;
      if (segmentWidth <= 0) return;
      ctx.save();
      ctx.font = `${weight} ${size}px ${family}`;
      const fullWidth = ctx.measureText(epochLabel.label).width;
      const shortLabel = epochLabel.shortLabel || epochLabel.label;
      const shortWidth = ctx.measureText(shortLabel).width;
      ctx.restore();
      const horizontalPad = 8;
      epochLabelLayouts.push({
        label: epochLabel.label,
        shortLabel,
        fullWidth,
        shortWidth,
        segmentWidth,
        horizontalPad,
        isFullyVisible: Number(epochLabel.start) >= viewport.xMin && Number(epochLabel.end) <= viewport.xMax,
        isFuture: /^Epoch\s+6$/i.test(epochLabel.label),
        needsShort: segmentWidth < fullWidth + horizontalPad * 2,
        rawX: xFor(visibleStart + (visibleEnd - visibleStart) / 2),
      });
    });
    const useShortEpochLabels = epochLabelLayouts.some((layout) => layout.isFullyVisible && layout.needsShort && !layout.isFuture);
    epochLabelLayouts.forEach((layout) => {
      const useShortLabel = useShortEpochLabels || layout.needsShort;
      const text = useShortLabel ? layout.shortLabel : layout.label;
      const textWidth = useShortLabel ? layout.shortWidth : layout.fullWidth;
      if (layout.segmentWidth < textWidth + layout.horizontalPad * 2) return;
      const x = clamp(layout.rawX, x0 + textWidth / 2 + layout.horizontalPad, x1 - textWidth / 2 - layout.horizontalPad);
      drawText(ctx, text, x, height - 12, {
        size,
        align: "center",
        baseline: "bottom",
        color: colors.fg,
        strokeWidth: 4,
        family,
        weight,
      });
    });
  }

  function drawLine(ctx, rows, xFor, yFor, key, color, width, clip) {
    if (!rows.length) return;
    ctx.save();
    if (clip) {
      ctx.beginPath();
      ctx.rect(clip.x, clip.y, clip.width, clip.height);
      ctx.clip();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    let started = false;
    rows.forEach((row) => {
      const x = xFor(dateNum(row.date));
      const y = yFor(Number(row[key]) * 100);
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

  function drawPerfectIssuanceMarkers(ctx, rows, xFor, yFor, colors, clip) {
    ctx.save();
    if (clip) {
      ctx.beginPath();
      ctx.rect(clip.x, clip.y, clip.width, clip.height);
      ctx.clip();
    }
    rows.forEach((row) => {
      if (Number(row.timezone_blocks) !== 144) return;
      const x = xFor(dateNum(row.date));
      const y = yFor(Number(row.target_rate) * 100);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = colors.perfect;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = colors.bg;
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawChartStats(ctx, width, row, colors, x0, x1, y0) {
    if (!row) return;
    const epochContextPad = 0.025;
    const plotWidth = x1 - x0;
    const restingMarkerX = x0 + ((1 + epochContextPad) / (1 + 2 * epochContextPad)) * plotWidth;
    const restingLabelOffset = 0.0075 / (1 + 2 * epochContextPad) * plotWidth;
    const right = clamp(restingMarkerX - restingLabelOffset, x0 + 260, x1 - 4);
    const topY = y0 + 6;
    const family = "Helvetica Neue, Arial, sans-serif";
    const kpiScale = clamp(width / 980, 0.58, 1);
    const labelSize = 15 * kpiScale;
    const valueSize = 29 * kpiScale;
    const secondaryValueSize = 28 * kpiScale;
    const strokeWidth = Math.max(3, 5 * kpiScale);
    const labelGap = 6 * kpiScale;
    const valueGap = 8 * kpiScale;
    const epoch = Number(row.epoch);
    const supplyDigits = Math.max(0, epoch - 2);
    const issueDigits = Math.max(0, epoch - 2);
    const targetIssuance = Number(row.target_issuance);
    const dailyIssuance = Number(row.daily_issuance);
    const subsidy = Number(row.subsidy);

    const metricY = [4, 66 * kpiScale, 128 * kpiScale];
    const valueOffset = 22 * kpiScale;

    drawText(ctx, "Total Mined Supply", right, topY + metricY[0], { size: labelSize, align: "right", baseline: "top", color: colors.fg, strokeWidth, weight: 400, family });
    drawText(ctx, `${fmtNumber(Number(row.supply), supplyDigits)} BTC`, right, topY + metricY[0] + valueOffset, { size: valueSize, align: "right", baseline: "top", color: colors.fg, strokeWidth, weight: 400, family });

    const dailyIssuanceLabelParts = [
      { text: "Daily Issuance", color: colors.fg, size: labelSize },
    ];
    const dailyIssuanceValueParts = [
      { text: `${fmtNumber(dailyIssuance, issueDigits)} BTC`, color: colors.fg, size: secondaryValueSize },
    ];
    if (state.showPerfectIssuanceMarkers) {
      dailyIssuanceLabelParts.push({ text: `(144 x ${fmtNumberTrim(subsidy, 8)} BTC)`, color: colors.perfect, size: labelSize });
      dailyIssuanceValueParts.push({ text: `(${fmtNumberTrim(targetIssuance, 8)} BTC)`, color: colors.perfect, size: secondaryValueSize });
    }
    drawRichTextRight(ctx, dailyIssuanceLabelParts, right, topY + metricY[1], { family, baseline: "top", strokeWidth, gap: labelGap });
    drawRichTextRight(ctx, dailyIssuanceValueParts, right, topY + metricY[1] + valueOffset, { family, baseline: "top", strokeWidth, gap: valueGap });

    const issuanceRateLabelParts = [
      { text: "Annualized Issuance Rate", color: colors.fg, size: labelSize },
    ];
    const issuanceRateValueParts = [
      { text: fmtPct(Number(row.issuance_rate), 2), color: colors.fg, size: valueSize },
    ];
    if (state.showTargetIssuanceRate) {
      issuanceRateLabelParts.push({ text: "(Target)", color: colors.target, size: labelSize });
      issuanceRateValueParts.push({ text: `(${fmtPct(Number(row.target_rate), 2)})`, color: colors.target, size: valueSize });
    }
    drawRichTextRight(ctx, issuanceRateLabelParts, right, topY + metricY[2], { family, baseline: "top", strokeWidth, gap: labelGap });
    drawRichTextRight(ctx, issuanceRateValueParts, right, topY + metricY[2] + valueOffset, { family, baseline: "top", strokeWidth, gap: valueGap });
  }

  function updateStatus() {
    const row = getDisplayRow(state.currentIndex);
    const updatedRaw = String(state.data?.generated_utc || "").trim();
    const value = els.chipUpdated?.querySelector(".chip-value");
    if (updatedTimeZoneChip) updatedTimeZoneChip.setUpdated(updatedRaw);
    else if (value) value.textContent = "-";
    const formattedKpis = getFormattedRowKpis(row);
    const heightValue = els.chipHeight?.querySelector(".chip-value");
    if (heightValue) heightValue.textContent = formattedKpis.height;
    const epochValue = els.chipEpoch?.querySelector(".chip-value");
    if (epochValue) epochValue.textContent = formattedKpis.epoch;
    const subsidyValue = els.chipSubsidy?.querySelector(".chip-value");
    if (subsidyValue) subsidyValue.textContent = formattedKpis.subsidy;
    const epoch = Number(row?.epoch);
    const supplyValue = els.chipSupply?.querySelector(".chip-value");
    if (supplyValue) supplyValue.textContent = formattedKpis.supply;
    const dailyIssuanceValue = els.chipDailyIssuance?.querySelector(".chip-value");
    if (dailyIssuanceValue) dailyIssuanceValue.textContent = formattedKpis.dailyIssuance;
    if (els.chipDailyIssuance) {
      const height = Number(row?.height);
      const rollingStartHeight = Number(row?.rolling_24h_start_height);
      const subsidy = Number(row?.subsidy);
      const issuance = Number(row?.daily_issuance);
      const blocks = Number.isFinite(Number(row?.timezone_blocks))
        ? Number(row.timezone_blocks)
        : Number.isFinite(height) && Number.isFinite(rollingStartHeight)
        ? Math.max(0, height - rollingStartHeight)
        : Number.isFinite(issuance) && Number.isFinite(subsidy) && subsidy > 0
          ? Math.round(issuance / subsidy)
          : null;
      const zone = getDailyCalculationTimeZone();
      const tooltip = Number.isFinite(blocks)
        ? row?.uses_rolling_24h
          ? `${fmtNumber(blocks, 0)} blocks mined in the last 24 hours`
          : `${fmtNumber(blocks, 0)} blocks mined in the selected ${zone} day`
        : row?.uses_rolling_24h
          ? "Blocks mined in the last 24 hours"
          : `Blocks mined in the selected ${zone} day`;
      setCustomTooltip(els.chipDailyIssuance, tooltip);
      els.chipDailyIssuance.setAttribute("aria-label", `Daily Issuance. ${tooltip}`);
    }
    const issuanceRateValue = els.chipIssuanceRate?.querySelector(".chip-value");
    if (issuanceRateValue) issuanceRateValue.textContent = formattedKpis.issuanceRate;
  }

  function syncSliderGeometry() {
    const max = Math.max(0, state.rows.length - 1);
    if (els.dateRangeSliderWrap) {
      const styles = window.getComputedStyle(els.dateRangeSliderWrap);
      const edgePad = Number.parseFloat(styles.getPropertyValue("--slider-edge-pad")) || 0;
      const trackWidth = Math.max(1, els.dateRangeSliderWrap.clientWidth - edgePad * 2);
      const pct = (idx) => `${((clamp(idx, 0, max) / Math.max(1, max)) * 100).toFixed(4)}%`;
      const markerPos = (idx) => {
        const ratio = clamp(idx, 0, max) / Math.max(1, max);
        return `${(edgePad + ratio * trackWidth).toFixed(2)}px`;
      };
      els.dateRangeSliderWrap.classList.toggle("is-ready", max > 0);
      els.dateRangeSliderWrap.classList.toggle("is-playing", state.isPlaying);
      els.dateRangeSliderWrap.classList.toggle("is-paused", state.isPaused);
      els.dateRangeSliderWrap.style.setProperty("--slider-start", pct(state.startIndex));
      els.dateRangeSliderWrap.style.setProperty("--slider-end", pct(state.endIndex));
      els.dateRangeSliderWrap.style.setProperty("--slider-current", pct(state.currentIndex));
      els.dateRangeSliderWrap.style.setProperty("--slider-start-marker", markerPos(state.startIndex));
      els.dateRangeSliderWrap.style.setProperty("--slider-end-marker", markerPos(state.endIndex));
      els.dateRangeSliderWrap.style.setProperty("--slider-current-marker", markerPos(state.currentIndex));
    }
  }

  function scheduleLayoutSync() {
    if (layoutSyncFrameId !== null) return;
    layoutSyncFrameId = window.requestAnimationFrame(() => {
      layoutSyncFrameId = null;
      syncSliderGeometry();
      renderChart();
    });
  }

  function syncControls() {
    const max = Math.max(0, state.rows.length - 1);
    renderRangePresetButtons();
    if (els.dateRangeStartSlider) {
      els.dateRangeStartSlider.min = "0";
      els.dateRangeStartSlider.max = String(Math.max(0, state.endIndex - 1));
      els.dateRangeStartSlider.value = String(state.startIndex);
    }
    if (els.dateRangeEndSlider) {
      els.dateRangeEndSlider.min = String(Math.min(max, state.startIndex + 1));
      els.dateRangeEndSlider.max = String(max);
      els.dateRangeEndSlider.value = String(state.endIndex);
    }
    if (els.dateRangeStartInput) {
      els.dateRangeStartInput.min = state.rows[0]?.date || "";
      els.dateRangeStartInput.max = state.rows[Math.max(0, state.endIndex - 1)]?.date || state.rows[max]?.date || "";
      els.dateRangeStartInput.value = state.rows[state.startIndex]?.date || "";
    }
    if (els.dateRangeEndInput) {
      els.dateRangeEndInput.min = state.rows[Math.min(max, state.startIndex + 1)]?.date || state.rows[0]?.date || "";
      els.dateRangeEndInput.max = state.rows[max]?.date || "";
      els.dateRangeEndInput.value = state.rows[state.endIndex]?.date || "";
    }
    if (els.dateRangeStartBtn) els.dateRangeStartBtn.innerHTML = datePickerButtonHtml(state.rows[state.startIndex]?.date);
    if (els.dateRangeEndBtn) els.dateRangeEndBtn.innerHTML = datePickerButtonHtml(state.rows[state.endIndex]?.date);
    if (els.dateRangeDaysInput) {
      const days = Math.max(2, state.endIndex - state.startIndex + 1);
      els.dateRangeDaysInput.dataset.lastValidValue = String(days);
      if (document.activeElement !== els.dateRangeDaysInput) {
        els.dateRangeDaysInput.value = days.toLocaleString("en-US");
      }
    }
    syncSliderGeometry();
    els.dateRangePlayBtn?.classList.toggle("is-playing", state.isPlaying);
    els.dateRangePauseBtn?.classList.toggle("is-paused", state.isPaused);
    els.dateRangeStopBtn?.classList.toggle("is-active", false);
    const playbackActive = state.isPlaying || state.isPaused;
    if (els.dateRangePlayBtn) els.dateRangePlayBtn.disabled = state.isPlaying;
    if (els.dateRangePauseBtn) els.dateRangePauseBtn.disabled = !playbackActive || state.isPaused;
    if (els.dateRangeStopBtn) els.dateRangeStopBtn.disabled = !playbackActive;
    if (els.dateRangeSpeedBtn) els.dateRangeSpeedBtn.textContent = `${state.playbackSpeed}x`;
    updateDownloadEstimates();
    document.querySelectorAll("[data-range-preset]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.rangePreset === state.selectedPreset);
    });
    document.querySelectorAll("[data-view-mode]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.viewMode === state.viewMode);
    });
    document.querySelectorAll("[data-scale-mode]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.scaleMode === state.scaleMode);
    });
    if (els.showPerfectIssuanceToggle) els.showPerfectIssuanceToggle.checked = !!state.showPerfectIssuanceMarkers;
    if (els.showTargetIssuanceRateToggle) els.showTargetIssuanceRateToggle.checked = !!state.showTargetIssuanceRate;
    if (els.dailyCalculationsUseSelectedTimeZoneToggle) els.dailyCalculationsUseSelectedTimeZoneToggle.checked = !!state.dailyCalculationsUseSelectedTimeZone;
    updateResetButtonUi();
    updateStatus();
    persistState();
  }

  function positionIssuanceSettingsPanel() {
    if (!els.issuanceSettingsBtn || !els.issuanceSettingsPanel) return;
    const topbar = els.issuanceSettingsBtn.closest(".topbar");
    if (!topbar) return;
    const topbarRect = topbar.getBoundingClientRect();
    const buttonRect = els.issuanceSettingsBtn.getBoundingClientRect();
    const topbarStyle = window.getComputedStyle(topbar);
    const contentLeft = topbarRect.left + (parseFloat(topbarStyle.paddingLeft) || 0);
    els.issuanceSettingsPanel.style.setProperty("--issuance-settings-panel-left", `${Math.round(contentLeft - buttonRect.left)}px`);
    const panelTop = buttonRect.bottom + 8;
    const playbackPanel = document.querySelector(".date-range-panel");
    const playbackBottom = playbackPanel?.getBoundingClientRect().bottom || (window.innerHeight - 12);
    const viewportBottom = window.innerHeight - 12;
    const availableHeight = Math.min(playbackBottom, viewportBottom) - panelTop;
    els.issuanceSettingsPanel.style.setProperty("--issuance-settings-panel-max-height", `${Math.max(1, Math.floor(availableHeight))}px`);
  }

  function setIssuanceSettingsPanelOpen(open) {
    if (!els.issuanceSettingsBtn || !els.issuanceSettingsPanel) return;
    if (open) positionIssuanceSettingsPanel();
    els.issuanceSettingsPanel.classList.toggle("open", !!open);
    els.issuanceSettingsBtn.classList.toggle("is-open", !!open);
    els.issuanceSettingsBtn.setAttribute("aria-expanded", String(!!open));
  }

  function isDefaultState() {
    const defaultPreset = getDefaultPreset();
    const defaultEnd = state.rows.length - 1;
    return state.startIndex === getPresetStartIndex(defaultPreset, defaultEnd)
      && state.endIndex === defaultEnd
      && state.currentIndex === state.endIndex
      && Number(state.playbackSpeed) === 1
      && state.selectedPreset === defaultPreset
      && state.viewMode === "single"
      && state.scaleMode === "linear"
      && state.showPerfectIssuanceMarkers === true
      && state.showTargetIssuanceRate === true
      && state.dailyCalculationsUseSelectedTimeZone === false;
  }

  function captureResetSnapshot() {
    return {
      startIndex: state.startIndex,
      endIndex: state.endIndex,
      currentIndex: state.currentIndex,
      playbackSpeed: state.playbackSpeed,
      selectedPreset: state.selectedPreset,
      viewMode: state.viewMode,
      scaleMode: state.scaleMode,
      showPerfectIssuanceMarkers: state.showPerfectIssuanceMarkers,
      showTargetIssuanceRate: state.showTargetIssuanceRate,
      dailyCalculationsUseSelectedTimeZone: state.dailyCalculationsUseSelectedTimeZone,
    };
  }

  function restoreResetSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    const finiteNumber = (value, fallback) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    };
    stopTimer();
    state.isPlaying = false;
    state.isPaused = false;
    state.playbackSpeed = PLAYBACK_SPEEDS.includes(Number(snapshot.playbackSpeed)) ? Number(snapshot.playbackSpeed) : 1;
    state.selectedPreset = typeof snapshot.selectedPreset === "string" ? snapshot.selectedPreset : "custom";
    state.viewMode = isValidViewMode(snapshot.viewMode) ? snapshot.viewMode : "single";
    state.scaleMode = isValidScaleMode(snapshot.scaleMode) ? snapshot.scaleMode : "linear";
    state.showPerfectIssuanceMarkers = snapshot.showPerfectIssuanceMarkers !== false;
    state.showTargetIssuanceRate = snapshot.showTargetIssuanceRate !== false;
    state.dailyCalculationsUseSelectedTimeZone = snapshot.dailyCalculationsUseSelectedTimeZone === true;
    const normalized = normalizeRangeIndices(
      finiteNumber(snapshot.startIndex, 0),
      finiteNumber(snapshot.endIndex, state.rows.length - 1),
      finiteNumber(snapshot.currentIndex, state.rows.length - 1)
    );
    state.startIndex = normalized.startIndex;
    state.endIndex = normalized.endIndex;
    state.currentIndex = normalized.currentIndex;
    state.endTracksLatest = isLatestRowIndex(state.endIndex);
    state.currentTracksLatest = state.currentIndex === state.endIndex && state.endTracksLatest;
    syncControls();
    renderChart();
  }

  function updateResetButtonUi() {
    const btn = els.resetDashboard;
    window.WSBDashboardComponents.setResetButtonState({
      button: btn,
      isUndo: !!preResetStateSnapshot,
      disabled: isDefaultState(),
      undoIcon: ICONS.resetUndo,
      defaultIcon: ICONS.resetRestore,
      setIcon: (icon) => setButtonIcon("resetDashboardIcon", icon),
    });
    setCustomTooltip(btn, preResetStateSnapshot ? "Undo the last restore defaults action" : "Reset dashboard to defaults");
  }

  function persistState() {
    try {
      const latestDate = state.rows[state.rows.length - 1]?.date || "";
      const endTracksLatest = isLatestRowIndex(state.endIndex);
      const currentTracksLatest = state.currentIndex === state.endIndex && endTracksLatest;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        start: state.rows[state.startIndex]?.date,
        end: state.rows[state.endIndex]?.date,
        current: state.rows[state.currentIndex]?.date,
        latestDate,
        endTracksLatest,
        currentTracksLatest,
        speed: state.playbackSpeed,
        playbackState: state.isPlaying ? "playing" : (state.isPaused ? "paused" : "stopped"),
        preset: state.selectedPreset,
        viewMode: state.viewMode,
        scaleMode: state.scaleMode,
        showPerfectIssuanceMarkers: state.showPerfectIssuanceMarkers,
        showTargetIssuanceRate: state.showTargetIssuanceRate,
        dailyCalculationsUseSelectedTimeZone: state.dailyCalculationsUseSelectedTimeZone,
      }));
    } catch (_) {
      // Ignore storage failures.
    }
  }

  function restoreState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const indexForDate = (date, fallback) => {
        const idx = state.rows.findIndex((row) => row.date === date);
        return idx >= 0 ? idx : fallback;
      };
      const defaultPreset = getDefaultPreset();
      const defaultEnd = state.rows.length - 1;
      const defaultStart = getPresetStartIndex(defaultPreset, defaultEnd);
      const hasStoredRange = typeof parsed.start === "string" || typeof parsed.end === "string" || typeof parsed.current === "string";
      const storedPreset = typeof parsed.preset === "string" ? parsed.preset : "";
      const storedLatestDate = typeof parsed.latestDate === "string" ? parsed.latestDate : "";
      const storedPresetTracksLatest = Number.isFinite(getEpochFromPreset(storedPreset)) && (!storedLatestDate || parsed.end === storedLatestDate);
      const latestDate = state.rows[defaultEnd]?.date || "";
      const parsedEndDateNum = typeof parsed.end === "string" ? dateNum(parsed.end) : NaN;
      const latestDateNum = latestDate ? dateNum(latestDate) : NaN;
      const hasExplicitLatestTracking = typeof parsed.endTracksLatest === "boolean" || !!storedLatestDate;
      const legacyRecentEndTracksLatest = !hasExplicitLatestTracking
        && parsed.current === parsed.end
        && Number.isFinite(parsedEndDateNum)
        && Number.isFinite(latestDateNum)
        && latestDateNum >= parsedEndDateNum
        && latestDateNum - parsedEndDateNum <= 7 * MS_PER_DAY;
      const endTracksLatest = parsed.endTracksLatest === true || storedPresetTracksLatest || legacyRecentEndTracksLatest;
      const currentTracksLatest = parsed.currentTracksLatest === true || (endTracksLatest && parsed.current === parsed.end);
      const normalized = normalizeRangeIndices(
        hasStoredRange ? indexForDate(parsed.start, defaultStart) : defaultStart,
        endTracksLatest ? defaultEnd : indexForDate(parsed.end, defaultEnd),
        currentTracksLatest ? defaultEnd : indexForDate(parsed.current, defaultEnd)
      );
      state.startIndex = normalized.startIndex;
      state.endIndex = normalized.endIndex;
      state.currentIndex = normalized.currentIndex;
      state.endTracksLatest = isLatestRowIndex(state.endIndex);
      state.currentTracksLatest = state.currentIndex === state.endIndex && state.endTracksLatest;
      const speed = Number(parsed.speed);
      state.playbackSpeed = PLAYBACK_SPEEDS.includes(speed) ? speed : 1;
      const playbackState = String(parsed.playbackState || "");
      state.isPlaying = false;
      state.isPaused = playbackState === "playing" || playbackState === "paused";
      state.selectedPreset = hasStoredRange && Number.isFinite(getEpochFromPreset(parsed.preset))
        ? parsed.preset
        : (hasStoredRange ? inferPresetForRange(state.startIndex, state.endIndex) : defaultPreset);
      state.viewMode = isValidViewMode(parsed.viewMode) ? parsed.viewMode : "single";
      state.scaleMode = isValidScaleMode(parsed.scaleMode) ? parsed.scaleMode : "linear";
      state.showPerfectIssuanceMarkers = parsed.showPerfectIssuanceMarkers !== false;
      state.showTargetIssuanceRate = parsed.showTargetIssuanceRate !== false;
      state.dailyCalculationsUseSelectedTimeZone = parsed.dailyCalculationsUseSelectedTimeZone === true;
    } catch (_) {
      const defaultPreset = getDefaultPreset();
      state.startIndex = getPresetStartIndex(defaultPreset, state.rows.length - 1);
      state.endIndex = state.rows.length - 1;
      state.currentIndex = state.endIndex;
      state.endTracksLatest = true;
      state.currentTracksLatest = true;
      state.playbackSpeed = 1;
      state.isPlaying = false;
      state.isPaused = false;
      state.selectedPreset = defaultPreset;
      state.viewMode = "single";
      state.scaleMode = "linear";
      state.showPerfectIssuanceMarkers = true;
      state.showTargetIssuanceRate = true;
      state.dailyCalculationsUseSelectedTimeZone = false;
    }
  }

  function bindDateRangeSessionPersistence() {
    if (dateRangeSessionPersistenceBound) return;
    dateRangeSessionPersistenceBound = true;
    const persistSessionSnapshot = () => {
      persistState();
    };
    window.addEventListener("pagehide", persistSessionSnapshot);
    window.addEventListener("beforeunload", persistSessionSnapshot);
  }

  function setRange(start, end, current = end, preset = "custom") {
    stopPlayback(false);
    const normalized = normalizeRangeIndices(start, end, current);
    state.startIndex = normalized.startIndex;
    state.endIndex = normalized.endIndex;
    state.currentIndex = normalized.currentIndex;
    state.endTracksLatest = isLatestRowIndex(state.endIndex);
    state.currentTracksLatest = state.currentIndex === state.endIndex && state.endTracksLatest;
    state.selectedPreset = preset === "custom" ? inferPresetForRange(state.startIndex, state.endIndex) : preset;
    if (preResetStateSnapshot) preResetStateSnapshot = null;
    syncControls();
    renderChart();
  }

  function play() {
    stopTimer();
    if (state.currentIndex >= state.endIndex) state.currentIndex = state.startIndex;
    state.isPlaying = true;
    state.isPaused = false;
    syncControls();
    bindDateRangePlaybackOutsidePointerActions();
    const interval = state.playbackSpeed < 1 ? 1000 / (30 * state.playbackSpeed) : 1000 / 30;
    const step = Math.max(1, Math.round(state.playbackSpeed));
    state.timerId = window.setInterval(() => {
      state.currentIndex = Math.min(state.endIndex, state.currentIndex + step);
      syncControls();
      renderChart();
      if (state.currentIndex >= state.endIndex) pause();
    }, interval);
  }

  function pause() {
    stopTimer();
    state.isPlaying = false;
    state.isPaused = true;
    syncControls();
    bindDateRangePlaybackOutsidePointerActions();
  }

  function stop() {
    stopPlayback(true);
  }

  function stopPlayback(resetToEnd = true) {
    stopTimer();
    state.isPlaying = false;
    state.isPaused = false;
    unbindDateRangePlaybackOutsidePointerActions();
    if (resetToEnd) state.currentIndex = state.endIndex;
    syncControls();
    renderChart();
  }

  function stopTimer() {
    if (state.timerId) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function isDateRangePlaybackActive() {
    return state.isPlaying || state.isPaused;
  }

  function getDateRangeOutsidePointerTargetInfo(event) {
    const target = event?.target;
    const eventPath = typeof event?.composedPath === "function" ? event.composedPath() : [];
    const targetElement = target instanceof Element ? target : null;
    const isInDateRangePanel = !!(
      targetElement?.closest(".date-range-panel")
      || targetElement?.closest(".date-picker-popup")
      || eventPath.some((item) => item instanceof Element && (
        item.classList?.contains("date-range-panel")
        || item.classList?.contains("date-picker-popup")
      ))
    );
    const isInChartPanel = !!(
      targetElement?.closest(".chart-wrap")
      || targetElement?.closest("#issuanceChart")
      || eventPath.some((item) => item instanceof Element && (
        item.classList?.contains("chart-wrap")
        || item.id === "issuanceChart"
      ))
    );
    return { target, eventPath, targetElement, isInDateRangePanel, isInChartPanel };
  }

  function handleDateRangePlaybackOutsideClick(info, event = null) {
    if (!isDateRangePlaybackActive()) return;
    if (info?.isInDateRangePanel) return;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (info?.isInChartPanel) {
      if (state.isPlaying) pause();
      else play();
      return;
    }
    stopPlayback(true);
  }

  function bindDateRangePlaybackOutsidePointerActions() {
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
      if (Math.hypot(deltaX, deltaY) > 30) dateRangePlaybackOutsidePointerTouchState.moved = true;
    };

    const trackTouchEnd = (event) => {
      if (!dateRangePlaybackOutsidePointerTouchState || event.pointerId !== dateRangePlaybackOutsidePointerTouchState.pointerId) return;
      const { moved, info } = dateRangePlaybackOutsidePointerTouchState;
      cleanupTouchTracking();
      if (!moved) handleDateRangePlaybackOutsideClick(info);
    };

    const trackTouchCancel = (event) => {
      if (!dateRangePlaybackOutsidePointerTouchState || event.pointerId !== dateRangePlaybackOutsidePointerTouchState.pointerId) return;
      cleanupTouchTracking();
    };

    dateRangePlaybackOutsidePointerHandler = (event) => {
      if (!isDateRangePlaybackActive()) return;
      const info = getDateRangeOutsidePointerTargetInfo(event);
      if (info.isInDateRangePanel) return;
      if (event.pointerType === "touch") {
        dateRangePlaybackOutsidePointerTouchState = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          info,
          moveHandler: trackTouchMove,
          endHandler: trackTouchEnd,
          cancelHandler: trackTouchCancel,
        };
        document.addEventListener("pointermove", trackTouchMove, true);
        document.addEventListener("pointerup", trackTouchEnd, true);
        document.addEventListener("pointercancel", trackTouchCancel, true);
        return;
      }
      handleDateRangePlaybackOutsideClick(info, event);
    };

    document.addEventListener("pointerdown", dateRangePlaybackOutsidePointerHandler, true);
  }

  function unbindDateRangePlaybackOutsidePointerActions() {
    if (dateRangePlaybackOutsidePointerHandler) {
      document.removeEventListener("pointerdown", dateRangePlaybackOutsidePointerHandler, true);
      dateRangePlaybackOutsidePointerHandler = null;
    }
    if (dateRangePlaybackOutsidePointerTouchState) {
      document.removeEventListener("pointermove", dateRangePlaybackOutsidePointerTouchState.moveHandler, true);
      document.removeEventListener("pointerup", dateRangePlaybackOutsidePointerTouchState.endHandler, true);
      document.removeEventListener("pointercancel", dateRangePlaybackOutsidePointerTouchState.cancelHandler, true);
      dateRangePlaybackOutsidePointerTouchState = null;
    }
  }

  function isKeyboardShortcutTextEntry(active) {
    return !!(
      active
      && (
        (active.tagName === "INPUT" && String(active.type || "").toLowerCase() !== "range")
        || active.tagName === "TEXTAREA"
        || active.tagName === "SELECT"
        || active.isContentEditable
      )
    );
  }

  function blurDateRangeSliderIfFocused() {
    const active = document.activeElement;
    if (
      active === els.dateRangeStartSlider
      || active === els.dateRangeEndSlider
      || active === els.dateRangePlayBtn
      || active === els.dateRangePauseBtn
      || active === els.dateRangeStopBtn
      || active === els.dateRangeSpeedBtn
      || active?.matches?.("[data-range-preset], [data-view-mode], [data-scale-mode]")
    ) {
      active.blur();
    }
  }

  function setCurrentIndexByIndex(index) {
    const nextIndex = clamp(Math.round(index), state.startIndex, state.endIndex);
    if (!state.rows[nextIndex]) return false;
    state.currentIndex = nextIndex;
    syncControls();
    renderChart();
    return true;
  }

  function togglePlayback() {
    if (state.isPlaying) pause();
    else play();
  }

  function bindDateRangeKeyboardShortcuts() {
    if (dateRangeKeyboardShortcutsBound) return;
    dateRangeKeyboardShortcutsBound = true;

    DASHBOARD_COMPONENTS.bindPlaybackKeyboardShortcuts?.({
      blurControls: blurDateRangeSliderIfFocused,
      isTextEntry: (active) => isKeyboardShortcutTextEntry(active),
      isPlaybackActive: isDateRangePlaybackActive,
      isEscapeActive: isDateRangePlaybackActive,
      isInactiveArrowActive: () => dateRangeLastAdjustedHandle === "start" || dateRangeLastAdjustedHandle === "end",
      onSpace: togglePlayback,
      onEscape: () => stopPlayback(true),
      onInactiveArrow: (direction) => nudgeLastAdjustedDateRangeHandle(direction),
      onArrow: (direction, _event, detail = {}) => {
        const daysPerSecond = 30 * Math.max(0.5, Number(state.playbackSpeed) || 1);
        const framesFor10Seconds = Math.max(1, Math.round(10 * daysPerSecond));
        const delta = detail.isStep ? direction : direction * framesFor10Seconds;
        const nextIndex = Math.max(state.startIndex, Math.min(state.endIndex, state.currentIndex + delta));
        if (nextIndex !== state.currentIndex) {
          setCurrentIndexByIndex(nextIndex);
          if (direction > 0 && state.isPlaying && nextIndex === state.endIndex) pause();
        }
      },
    });
  }

  function primeKeyboardFocus() {
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

  function setDashboardExpandedMode(expanded) {
    document.body.classList.toggle("issuance-dashboard-expanded", !!expanded);
    if (els.dashboardExpandBtn) {
      els.dashboardExpandBtn.setAttribute("aria-pressed", String(!!expanded));
      els.dashboardExpandBtn.setAttribute("aria-label", expanded ? "Shrink video layout" : "Expand video layout");
      els.dashboardExpandBtn.setAttribute("title", expanded ? "Shrink video layout" : "Expand video layout");
    }
    try {
      window.parent?.postMessage({ type: "wsb-issuance-dashboard-expanded", expanded: !!expanded }, window.location.origin);
    } catch (_) {
      // Ignore parent messaging failures.
    }
    requestAnimationFrame(() => {
      renderChart();
      requestAnimationFrame(renderChart);
    });
  }

  function loadDownloadSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(DOWNLOAD_SETTINGS_KEY) || "{}");
      state.downloadSettings = normalizeDownloadSettings({ ...state.downloadSettings, ...parsed });
    } catch (_) {
      state.downloadSettings = normalizeDownloadSettings(state.downloadSettings);
    }
  }

  function saveDownloadSettings() {
    try {
      localStorage.setItem(DOWNLOAD_SETTINGS_KEY, JSON.stringify(state.downloadSettings));
    } catch (_) {
      // Ignore storage failures.
    }
  }

  function normalizeDownloadSettings(settings = {}) {
    const currentTheme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    return {
      scale: ["linear", "log"].includes(settings.scale) ? settings.scale : state.scaleMode,
      orientation: ["landscape", "portrait", "square"].includes(settings.orientation) ? settings.orientation : "landscape",
      quality: ["720", "1080", "1440", "2160"].includes(String(settings.quality)) ? String(settings.quality) : "720",
      speed: ["0.5", "1", "2", "4"].includes(String(settings.speed)) ? String(settings.speed) : String(state.playbackSpeed || 1),
      theme: ["light", "dark"].includes(settings.theme) ? settings.theme : currentTheme,
      extension: "webm",
      endFrameHold: settings.endFrameHold !== false,
    };
  }

  function getDownloadDimensions(settings) {
    return window.WSBDashboardExport.getDimensions(settings);
  }

  function getDownloadLayoutDimensions(settings) {
    if (settings.orientation === "portrait") return { width: 720, height: 1280 };
    if (settings.orientation === "square") return { width: 720, height: 720 };
    return { width: 1280, height: 720 };
  }

  function getDateRangeFrameIndices(start = state.startIndex, end = state.endIndex, speed = state.playbackSpeed) {
    const normalized = normalizeRangeIndices(start, end, end);
    const step = Number(speed) >= 1 ? Math.max(1, Math.round(Number(speed))) : 1;
    const indices = [];
    for (let index = normalized.startIndex; index <= normalized.endIndex; index += step) {
      indices.push(index);
    }
    if (indices[indices.length - 1] !== normalized.endIndex) indices.push(normalized.endIndex);
    return indices;
  }

  function getDateRangeExportFrameIndices(start = state.startIndex, end = state.endIndex, speed = state.playbackSpeed, includeEndFrameHold = true) {
    const motion = getDateRangeFrameIndices(start, end, speed);
    if (!motion.length) return [];
    const startHoldFrames = includeEndFrameHold ? Math.max(0, Math.round(EXPORT_START_HOLD_SECONDS * EXPORT_VIDEO_FPS)) : 0;
    const endHoldFrames = includeEndFrameHold ? Math.max(0, Math.round(EXPORT_END_HOLD_SECONDS * EXPORT_VIDEO_FPS)) : 0;
    const frames = [
      ...Array.from({ length: startHoldFrames }, () => motion[motion.length - 1]),
    ];
    motion.forEach((index) => {
      frames.push(index);
      if (Number(speed) === 0.5) frames.push(index);
    });
    frames.push(...Array.from({ length: endHoldFrames }, () => motion[motion.length - 1]));
    return frames;
  }

  function getDownloadEstimateCalibrationKey(settings, frames) {
    const { width, height } = getDownloadDimensions(settings);
    const dashboardSettings = getExportDashboardSettings(settings);
    return [
      state.rows[state.startIndex]?.date || state.startIndex,
      state.rows[state.endIndex]?.date || state.endIndex,
      settings.scale,
      settings.orientation,
      settings.quality,
      settings.speed,
      settings.theme,
      settings.endFrameHold ? "hold" : "no-hold",
      state.viewMode,
      dashboardSettings.showPerfectIssuanceMarkers ? "perfect-on" : "perfect-off",
      dashboardSettings.showTargetIssuanceRate ? "target-on" : "target-off",
      dashboardSettings.dailyCalculationsUseSelectedTimeZone ? "daily-selected-tz" : "daily-utc",
      dashboardSettings.timeZone || "UTC",
      width,
      height,
      frames.length,
      new Set(frames).size,
    ].join("|");
  }

  function getRepresentativeExportFrameIndices(frames) {
    const uniqueFrames = Array.from(new Set(frames));
    if (uniqueFrames.length <= 9) return uniqueFrames;
    const samples = [];
    const lastIndex = uniqueFrames.length - 1;
    for (let i = 0; i < 9; i += 1) {
      samples.push(uniqueFrames[Math.round((lastIndex * i) / 8)]);
    }
    return samples;
  }

  async function calibrateDownloadEstimate(settings, frames, key) {
    if (isDateRangeExporting || downloadEstimateCalibrationCache.has(key) || downloadEstimateCalibrationPending.has(key)) return;
    const representativeFrames = getRepresentativeExportFrameIndices(frames);
    if (!representativeFrames.length) return;
    downloadEstimateCalibrationPending.add(key);
    const requestId = ++downloadEstimateCalibrationRequestId;

    try {
      await waitForDateRangeExportFonts();
      if (requestId !== downloadEstimateCalibrationRequestId) return;

      const { width, height } = getDownloadDimensions(settings);
      const layout = getDownloadLayoutDimensions(settings);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.__exportCssWidth = layout.width;
      canvas.__exportCssHeight = layout.height;
      canvas.__exportPixelWidth = width;
      canvas.__exportPixelHeight = height;

      const sampleDurations = [];
      for (const frameIndex of representativeFrames) {
        if (requestId !== downloadEstimateCalibrationRequestId) return;
        const frameStarted = performance.now();
        renderExportFrame(canvas, frameIndex, settings);
        sampleDurations.push(performance.now() - frameStarted);
      }
      await wait(0);
      sampleDurations.sort((a, b) => a - b);
      const msPerUniqueFrame = sampleDurations[Math.floor(sampleDurations.length / 2)];
      if (!Number.isFinite(msPerUniqueFrame) || msPerUniqueFrame <= 0) return;
      downloadEstimateCalibrationCache.set(key, {
        msPerUniqueFrame,
        sampleCount: representativeFrames.length,
      });
      if (requestId === downloadEstimateCalibrationRequestId) updateDownloadEstimates();
    } catch (error) {
      console.warn("Unable to calibrate issuance export estimate.", error);
    } finally {
      downloadEstimateCalibrationPending.delete(key);
    }
  }

  function scheduleDownloadEstimateCalibration(settings, frames, key) {
    if (downloadEstimateCalibrationCache.has(key) || downloadEstimateCalibrationPending.has(key)) return;
    if (downloadEstimateCalibrationTimer) {
      window.clearTimeout(downloadEstimateCalibrationTimer);
      downloadEstimateCalibrationTimer = null;
    }
    downloadEstimateCalibrationTimer = window.setTimeout(() => {
      downloadEstimateCalibrationTimer = null;
      calibrateDownloadEstimate({ ...settings }, [...frames], key);
    }, 180);
  }

  function recordMeasuredDownloadEstimate(settings, frames, elapsedMs) {
    if (!frames.length || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return;
    const key = getDownloadEstimateCalibrationKey(settings, frames);
    downloadEstimateCalibrationCache.set(key, {
      msPerUniqueFrame: Math.max(0.1, elapsedMs / frames.length),
      sampleCount: frames.length,
      measured: true,
    });
  }

  function canUseDeterministicWebCodecsExport() {
    return !!window.WSBDashboardExport?.hasWebCodecsExportSupport?.();
  }

  function updateDownloadEstimates() {
    if (!els.downloadEstimateSize || !els.downloadEstimateLength || !els.downloadEstimateTime) return;
    const settings = {
      ...normalizeDownloadSettings(state.downloadSettings),
      dashboardSettings: getDashboardSettingsSnapshot(),
    };
    const { width, height } = getDownloadDimensions(settings);
    const frames = getDateRangeExportFrameIndices(state.startIndex, state.endIndex, Number(settings.speed) || 1, settings.endFrameHold);
    const uniqueFrameCount = new Set(frames).size;
    const seconds = frames.length / EXPORT_VIDEO_FPS;
    const bitrate = getDateRangeExportBitrate(settings);
    const calibrationKey = getDownloadEstimateCalibrationKey(settings, frames);
    const calibration = downloadEstimateCalibrationCache.get(calibrationKey);
    const megapixels = Math.max(1, (width * height) / (1280 * 720));
    const calibratedMsPerFrame = calibration?.msPerUniqueFrame;
    const deterministicExport = canUseDeterministicWebCodecsExport();
    const estimate = window.WSBDashboardExport.estimateDownload(settings, {
      frameCount: frames.length,
      uniqueFrameCount,
      videoSeconds: seconds,
      dimensions: { width, height },
      bitrate,
      calibration: Number.isFinite(calibratedMsPerFrame) ? { msPerFrame: calibratedMsPerFrame } : null,
      fallbackFrameSeconds: 0.006 * Math.sqrt(megapixels),
      encodeFrameSeconds: 0.0005,
    });
    els.downloadEstimateSize.textContent = estimate.sizeText;
    els.downloadEstimateLength.textContent = estimate.lengthText;
    els.downloadEstimateTime.textContent = deterministicExport ? estimate.timeText : "--";
    if (!calibration && frames.length) {
      scheduleDownloadEstimateCalibration(settings, frames, calibrationKey);
    }
  }

  function getDateRangeExportBitrate(settings) {
    const { width, height } = getDownloadDimensions(settings);
    const pixels = width * height;
    if (pixels >= 3840 * 2160) return 34_000_000;
    if (pixels >= 2560 * 1440) return 18_000_000;
    if (pixels >= 1920 * 1080) return 10_000_000;
    return 5_000_000;
  }

  function broadcastDateRangeExportActive(active) {
    try {
      window.dateRangeExportActive = !!active;
      if (window.parent && window.parent !== window) {
        window.parent.dateRangeExportActive = !!active;
        window.parent.postMessage({ type: "wsb-issuance-date-range-export-active", active: !!active }, window.location.origin);
      }
    } catch (_) {
      // Best effort only.
    }
  }

  function bindDateRangeExportUnloadGuard() {
    if (window.issuanceDateRangeExportUnloadGuardBound === true) return;
    window.issuanceDateRangeExportUnloadGuardBound = true;
    window.addEventListener("beforeunload", (event) => {
      if (!isDateRangeExporting) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  function syncDownloadSettingsControls() {
    loadDownloadSettings();
    const groups = {
      downloadScaleSelect: state.downloadSettings.scale,
      downloadOrientationSelect: state.downloadSettings.orientation,
      downloadQualitySelect: state.downloadSettings.quality,
      downloadSpeedSelect: state.downloadSettings.speed,
      downloadThemeSelect: state.downloadSettings.theme,
    };
    Object.entries(groups).forEach(([id, value]) => {
      const group = $(id);
      if (!group) return;
      group.querySelectorAll(".download-setting-option[data-value]").forEach((button) => {
        const selected = button.dataset.value === value;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", selected ? "true" : "false");
      });
    });
    if (els.downloadEndFrameHoldToggle) els.downloadEndFrameHoldToggle.checked = !!state.downloadSettings.endFrameHold;
    syncDownloadSettingsDownloadButton();
    updateDownloadEstimates();
  }

  function renderDateRangeDownloadButtonProgress(progress = 0) {
    const downloadBtn = els.dateRangeDownloadBtn;
    if (!downloadBtn) return;
    const progressPct = `${clamp(Number(progress) || 0, 0, 1) * 100}%`;
    const progressEl = downloadBtn.querySelector(".date-range-export-progress");
    if (downloadBtn.classList.contains("is-exporting") && progressEl) {
      progressEl.style.setProperty("--date-range-export-progress", progressPct);
      return;
    }
    downloadBtn.classList.add("is-exporting");
    downloadBtn.disabled = false;
    downloadBtn.setAttribute("aria-label", "Cancel animation download");
    downloadBtn.setAttribute("title", "Cancel download");
    downloadBtn.innerHTML = [
      `<span class="date-range-export-progress" style="--date-range-export-progress: ${progressPct}" aria-hidden="true">`,
      '<span class="date-range-export-stop-square"></span>',
      "</span>",
    ].join("");
    syncDownloadSettingsDownloadButton();
  }

  function resetDateRangeDownloadButton() {
    const downloadBtn = els.dateRangeDownloadBtn;
    if (!downloadBtn) return;
    downloadBtn.classList.remove("is-exporting", "is-canceling");
    downloadBtn.disabled = !canUseDeterministicWebCodecsExport();
    downloadBtn.setAttribute("aria-label", "Download date range animation");
    downloadBtn.setAttribute("title", canUseDeterministicWebCodecsExport() ? "Download animation" : "Animation download requires WebCodecs support");
    downloadBtn.textContent = "↓";
    syncDownloadSettingsDownloadButton();
  }

  function syncDownloadSettingsDownloadButton() {
    const button = els.downloadSettingsDownloadBtn;
    if (!button) return;
    const canDownload = canUseDeterministicWebCodecsExport();
    button.classList.toggle("is-stop-download", isDateRangeExporting);
    button.disabled = !canDownload && !isDateRangeExporting;
    button.textContent = isDateRangeExporting ? "Stop Download" : "Download Animation";
    button.title = canDownload ? "" : "Animation download requires WebCodecs support";
  }

  function requestDateRangeExportCancel() {
    if (!isDateRangeExporting) return;
    dateRangeExportCancelRequested = true;
    els.dateRangeDownloadBtn?.classList.add("is-canceling");
    syncDownloadSettingsDownloadButton();
  }

  async function encodeDateRangeAnimationWebM({ canvas, settings, frameIndices }) {
    return window.WSBDashboardExport.encodeWebM({
      canvas,
      width: canvas.width,
      height: canvas.height,
      fps: EXPORT_VIDEO_FPS,
      settings,
      frames: frameIndices,
      title: "Issuance Rate",
      bitrate: getDateRangeExportBitrate(settings),
      isCanceled: () => dateRangeExportCancelRequested,
      onProgress: renderDateRangeDownloadButtonProgress,
      renderFrame: (frameIndex) => renderExportFrame(canvas, frameIndex, settings),
    });
  }

  async function waitForDateRangeExportFonts() {
    if (document.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch (_) {
        // Ignore font loading errors.
      }
    }
  }

  function getDashboardSettingsSnapshot() {
    return {
      timeZone: getSelectedDashboardTimeZone(),
      showPerfectIssuanceMarkers: !!state.showPerfectIssuanceMarkers,
      showTargetIssuanceRate: !!state.showTargetIssuanceRate,
      dailyCalculationsUseSelectedTimeZone: !!state.dailyCalculationsUseSelectedTimeZone,
    };
  }

  function getExportDashboardSettings(settings = {}) {
    const snapshot = settings.dashboardSettings && typeof settings.dashboardSettings === "object"
      ? settings.dashboardSettings
      : getDashboardSettingsSnapshot();
    return {
      timeZone: String(snapshot.timeZone || "UTC").trim() || "UTC",
      showPerfectIssuanceMarkers: snapshot.showPerfectIssuanceMarkers !== false,
      showTargetIssuanceRate: snapshot.showTargetIssuanceRate !== false,
      dailyCalculationsUseSelectedTimeZone: snapshot.dailyCalculationsUseSelectedTimeZone === true,
    };
  }

  function renderExportFrame(canvas, frameIndex, settings) {
    const cssWidth = Math.max(1, Number(canvas.__exportCssWidth) || canvas.width || 1);
    const cssHeight = Math.max(1, Number(canvas.__exportCssHeight) || canvas.height || 1);
    const pixelWidth = Math.max(1, Number(canvas.__exportPixelWidth) || canvas.width || 1);
    const pixelHeight = Math.max(1, Number(canvas.__exportPixelHeight) || canvas.height || 1);
    const dpr = Math.max(1, Math.min(pixelWidth / cssWidth, pixelHeight / cssHeight));
    const footerCssHeight = Math.max(34, Math.round(Math.min(cssWidth, cssHeight) * 0.052));
    const chartCssHeight = Math.max(1, cssHeight - footerCssHeight);
    const chartPixelHeight = Math.max(1, Math.min(pixelHeight - 1, Math.round(chartCssHeight * dpr)));
    const footerPixelHeight = Math.max(1, pixelHeight - chartPixelHeight);
    const chartCanvas = canvas.__exportChartCanvas || document.createElement("canvas");
    canvas.__exportChartCanvas = chartCanvas;
    const dashboardSettings = getExportDashboardSettings(settings);
    chartCanvas.__exportCssWidth = cssWidth;
    chartCanvas.__exportCssHeight = chartCssHeight;
    chartCanvas.__exportPixelWidth = pixelWidth;
    chartCanvas.__exportPixelHeight = chartPixelHeight;
    const original = {
      chart: els.issuanceChart,
      currentIndex: state.currentIndex,
      scaleMode: state.scaleMode,
      timeZone: state.timeZone,
      showPerfectIssuanceMarkers: state.showPerfectIssuanceMarkers,
      showTargetIssuanceRate: state.showTargetIssuanceRate,
      dailyCalculationsUseSelectedTimeZone: state.dailyCalculationsUseSelectedTimeZone,
      theme: document.documentElement.dataset.theme,
    };
    try {
      els.issuanceChart = chartCanvas;
      state.currentIndex = clamp(frameIndex, state.startIndex, state.endIndex);
      state.scaleMode = settings.scale;
      state.timeZone = dashboardSettings.timeZone;
      state.showPerfectIssuanceMarkers = dashboardSettings.showPerfectIssuanceMarkers;
      state.showTargetIssuanceRate = dashboardSettings.showTargetIssuanceRate;
      state.dailyCalculationsUseSelectedTimeZone = dashboardSettings.dailyCalculationsUseSelectedTimeZone;
      document.documentElement.dataset.theme = settings.theme;
      renderChart();

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const bg = settings.theme === "light" ? "#ffffff" : "#000000";
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, pixelWidth, pixelHeight);
        ctx.drawImage(chartCanvas, 0, 0, pixelWidth, chartPixelHeight);
        ctx.fillStyle = bg;
        ctx.fillRect(0, chartPixelHeight, pixelWidth, footerPixelHeight);
        window.WSBDashboardExport.drawFooterUrl(
          ctx,
          "https://wickedsmartbitcoin.com/issuance_rate",
          { width: pixelWidth, height: pixelHeight, footerHeight: footerPixelHeight },
          { ...settings, referenceQuality: 1440 },
        );
        ctx.restore();
      }
    } finally {
      els.issuanceChart = original.chart;
      state.currentIndex = original.currentIndex;
      state.scaleMode = original.scaleMode;
      state.timeZone = original.timeZone;
      state.showPerfectIssuanceMarkers = original.showPerfectIssuanceMarkers;
      state.showTargetIssuanceRate = original.showTargetIssuanceRate;
      state.dailyCalculationsUseSelectedTimeZone = original.dailyCalculationsUseSelectedTimeZone;
      document.documentElement.dataset.theme = original.theme;
    }
  }

  function downloadDateRangeExportBlob(blob, extension) {
    const startDate = state.rows[state.startIndex]?.date || "start";
    const endDate = state.rows[state.endIndex]?.date || "end";
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bitcoin-issuance-rate-${startDate}-${endDate}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadDateRangeAnimation() {
    if (isDateRangeExporting) {
      requestDateRangeExportCancel();
      return;
    }
    if (!canUseDeterministicWebCodecsExport()) {
      resetDateRangeDownloadButton();
      updateDownloadEstimates();
      return;
    }
    const normalizedSettings = normalizeDownloadSettings(state.downloadSettings);
    const settings = {
      ...normalizedSettings,
      dashboardSettings: getDashboardSettingsSnapshot(),
    };
    state.downloadSettings = normalizedSettings;
    saveDownloadSettings();
    stopPlayback(false);
    const frameIndices = getDateRangeExportFrameIndices(state.startIndex, state.endIndex, Number(settings.speed) || 1, settings.endFrameHold);
    if (!frameIndices.length) return;
    const { width, height } = getDownloadDimensions(settings);
    const layout = getDownloadLayoutDimensions(settings);
    const canvas = document.createElement("canvas");
    canvas.__exportCssWidth = layout.width;
    canvas.__exportCssHeight = layout.height;
    canvas.__exportPixelWidth = width;
    canvas.__exportPixelHeight = height;
    canvas.width = width;
    canvas.height = height;
    if (!canvas.getContext("2d")) return;

    isDateRangeExporting = true;
    dateRangeExportCancelRequested = false;
    broadcastDateRangeExportActive(true);
    renderDateRangeDownloadButtonProgress(0);
    els.dateRangeSettingsMenu?.classList.remove("open");
    els.dateRangeSettingsBtn?.classList.remove("is-open");
    const exportStartedAt = performance.now();

    try {
      await waitForDateRangeExportFonts();
      const webmBlob = await encodeDateRangeAnimationWebM({ canvas, settings, frameIndices });
      if (webmBlob && !dateRangeExportCancelRequested) {
        recordMeasuredDownloadEstimate(settings, frameIndices, performance.now() - exportStartedAt);
        renderDateRangeDownloadButtonProgress(1);
        downloadDateRangeExportBlob(webmBlob, "webm");
        isDateRangeExporting = false;
        dateRangeExportCancelRequested = false;
        broadcastDateRangeExportActive(false);
        resetDateRangeDownloadButton();
        updateDownloadEstimates();
        return;
      }
      if (dateRangeExportCancelRequested) {
        isDateRangeExporting = false;
        dateRangeExportCancelRequested = false;
        broadcastDateRangeExportActive(false);
        resetDateRangeDownloadButton();
        updateDownloadEstimates();
        return;
      }
    } catch (error) {
      console.error("Unable to export issuance rate animation.", error);
      if (!dateRangeExportCancelRequested) window.alert(`Unable to export animation: ${error.message || error}`);
    } finally {
      isDateRangeExporting = false;
      dateRangeExportCancelRequested = false;
      broadcastDateRangeExportActive(false);
      resetDateRangeDownloadButton();
      updateDownloadEstimates();
    }
  }

  function selectDateRangeDaysInput(input) {
    window.requestAnimationFrame(() => input?.select?.());
  }

  function commitDateRangeDaysInput(input) {
    if (!input) return;
    const fallback = Number.parseInt(input.dataset.lastValidValue || "2", 10) || 2;
    const days = clamp(Number(String(input.value || "").replace(/\D/g, "")) || fallback, 2, state.rows.length);
    input.dataset.lastValidValue = String(days);
    input.value = days.toLocaleString("en-US");
    setRange(Math.max(0, state.endIndex - days + 1), state.endIndex, state.endIndex, "custom");
  }

  function getDateRangeRawIndexFromClientX(clientX) {
    const sliderWrap = els.dateRangeSliderWrap;
    if (!sliderWrap || !state.rows.length) return NaN;
    const rect = sliderWrap.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || rect.width <= 0) return NaN;
    const styles = window.getComputedStyle(sliderWrap);
    const edgePad = Number.parseFloat(styles.getPropertyValue("--slider-edge-pad")) || 0;
    const trackLeft = rect.left + edgePad;
    const trackWidth = Math.max(1, rect.width - edgePad * 2);
    const ratio = (clientX - trackLeft) / trackWidth;
    return Math.round(ratio * Math.max(0, state.rows.length - 1));
  }

  function getDateRangeMarkerClientX(index) {
    const sliderWrap = els.dateRangeSliderWrap;
    if (!sliderWrap || !state.rows.length) return NaN;
    const rect = sliderWrap.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || rect.width <= 0) return NaN;
    const maxIndex = Math.max(0, state.rows.length - 1);
    const styles = window.getComputedStyle(sliderWrap);
    const edgePad = Number.parseFloat(styles.getPropertyValue("--slider-edge-pad")) || 0;
    const ratio = clamp(index, 0, maxIndex) / Math.max(1, maxIndex);
    return rect.left + edgePad + ratio * Math.max(1, rect.width - edgePad * 2);
  }

  function setLastAdjustedDateRangeHandle(handle) {
    if (handle === "start" || handle === "end") dateRangeLastAdjustedHandle = handle;
  }

  function nudgeLastAdjustedDateRangeHandle(delta) {
    if (dateRangeLastAdjustedHandle !== "start" && dateRangeLastAdjustedHandle !== "end") return false;
    const max = state.rows.length - 1;
    if (max <= 0) return false;
    let nextStart = state.startIndex;
    let nextEnd = state.endIndex;
    if (dateRangeLastAdjustedHandle === "start") {
      nextStart = clamp(state.startIndex + delta, 0, state.endIndex - 1);
    } else {
      nextEnd = clamp(state.endIndex + delta, state.startIndex + 1, max);
    }
    if (nextStart === state.startIndex && nextEnd === state.endIndex) return false;
    setRange(nextStart, nextEnd, nextEnd, "custom");
    return true;
  }

  function setCurrentIndexFromPointerEvent(event) {
    const rawIndex = getDateRangeRawIndexFromClientX(event.clientX);
    if (!Number.isFinite(rawIndex)) return;
    const targetEnd = Number.isFinite(dateRangeCurrentMarkerDrag?.targetEndIdx)
      ? dateRangeCurrentMarkerDrag.targetEndIdx
      : state.endIndex;
    const index = clamp(rawIndex, state.startIndex, state.rows.length - 1);
    if (dateRangeCurrentMarkerDrag && index > targetEnd) {
      state.endIndex = index;
    }
    state.currentIndex = clamp(index, state.startIndex, state.endIndex);
    if (dateRangeCurrentMarkerDrag) {
      dateRangeCurrentMarkerDrag.lastRawIndex = rawIndex;
      dateRangeCurrentMarkerDrag.lastIndex = state.currentIndex;
    }
    syncControls();
    renderChart();
  }

  function beginDateRangePlaybackScrub(event, captureTarget = event.currentTarget) {
    if (!isDateRangePlaybackActive()) return;
    if (typeof event.button === "number" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dateRangeCurrentMarkerDrag = {
      pointerId: Number.isFinite(event.pointerId) ? event.pointerId : null,
      resumeAfterRelease: state.isPlaying,
      captureTarget,
      targetEndIdx: state.endIndex,
      lastRawIndex: getDateRangeRawIndexFromClientX(event.clientX),
    };
    if (state.isPlaying) pause();
    if (captureTarget && Number.isFinite(event.pointerId) && typeof captureTarget.setPointerCapture === "function") {
      try {
        captureTarget.setPointerCapture(event.pointerId);
      } catch (_) {
        // Best effort only.
      }
    }
    setCurrentIndexFromPointerEvent(event);
  }

  function beginDateRangeCurrentMarkerDrag(event) {
    beginDateRangePlaybackScrub(event, event.currentTarget);
  }

  function beginDateRangeHandleDrag(event, handle, captureTarget = event.currentTarget) {
    if (typeof event.button === "number" && event.button !== 0) return;
    pauseIfActive();
    setLastAdjustedDateRangeHandle(handle);
    dateRangeHandleDrag = {
      handle,
      pointerId: Number.isFinite(event.pointerId) ? event.pointerId : null,
      startClientX: event.clientX,
      startIdx: state.startIndex,
      endIdx: state.endIndex,
    };
    if (captureTarget && Number.isFinite(event.pointerId) && typeof captureTarget.setPointerCapture === "function") {
      try {
        captureTarget.setPointerCapture(event.pointerId);
      } catch (_) {
        // Best effort only.
      }
    }
    updateDateRangeHandleDrag(getDateRangeRawIndexFromClientX(event.clientX), handle);
    event.preventDefault();
    event.stopPropagation();
  }

  function beginDateRangeSliderWrapScrub(event) {
    if (event.target?.closest?.(".date-range-current-marker")) return;
    const staticMarker = event.target?.closest?.(".date-range-static-marker");
    if (staticMarker?.classList.contains("date-range-start-marker")) {
      beginDateRangeHandleDrag(event, "start", event.currentTarget);
      return;
    }
    if (isDateRangePlaybackActive()) {
      beginDateRangePlaybackScrub(event, event.currentTarget);
      return;
    }
    if (staticMarker?.classList.contains("date-range-end-marker")) {
      beginDateRangeHandleDrag(event, "end", event.currentTarget);
      return;
    }
    if (typeof event.button === "number" && event.button !== 0) return;
    const startX = getDateRangeMarkerClientX(state.startIndex);
    const endX = getDateRangeMarkerClientX(state.endIndex);
    if (!Number.isFinite(startX) || !Number.isFinite(endX)) return;
    const pointerX = event.clientX;
    const handleGuardPx = 12;
    const nearStart = Math.abs(pointerX - startX) <= handleGuardPx;
    const nearEnd = Math.abs(pointerX - endX) <= handleGuardPx;
    const selectedSegment = pointerX > startX + handleGuardPx && pointerX < endX - handleGuardPx;
    if (!nearStart && !nearEnd && !selectedSegment) return;
    event.preventDefault();
    event.stopPropagation();
    pauseIfActive();
    const handle = nearStart && nearEnd
      ? (Math.abs(pointerX - startX) <= Math.abs(pointerX - endX) ? "start" : "end")
      : (nearStart ? "start" : "end");
    dateRangeHandleDrag = {
      pointerId: Number.isFinite(event.pointerId) ? event.pointerId : null,
      handle: selectedSegment ? "range" : handle,
      startClientX: pointerX,
      startIdx: state.startIndex,
      endIdx: state.endIndex,
    };
    if (!selectedSegment) setLastAdjustedDateRangeHandle(handle);
    if (event.currentTarget && Number.isFinite(event.pointerId) && typeof event.currentTarget.setPointerCapture === "function") {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch (_) {
        // Best effort only.
      }
    }
  }

  function updateDateRangeHandleDrag(rawIndex, handle = dateRangeHandleDrag?.handle) {
    if (!handle || !Number.isFinite(rawIndex)) return;
    const max = state.rows.length - 1;
    if (handle === "start") {
      const nextStart = clamp(rawIndex, 0, Math.max(0, state.endIndex - 1));
      setLastAdjustedDateRangeHandle("start");
      setRange(nextStart, state.endIndex, Math.max(nextStart, state.currentIndex), "custom");
    } else if (handle === "end") {
      const nextEnd = clamp(rawIndex, Math.min(max, state.startIndex + 1), max);
      setLastAdjustedDateRangeHandle("end");
      setRange(state.startIndex, nextEnd, nextEnd, "custom");
    } else if (handle === "range") {
      const initialStart = Number.isFinite(dateRangeHandleDrag?.startIdx) ? dateRangeHandleDrag.startIdx : state.startIndex;
      const initialEnd = Number.isFinite(dateRangeHandleDrag?.endIdx) ? dateRangeHandleDrag.endIdx : state.endIndex;
      const initialPointerIndex = getDateRangeRawIndexFromClientX(dateRangeHandleDrag?.startClientX);
      if (!Number.isFinite(initialPointerIndex)) return;
      const shift = Math.round(rawIndex - initialPointerIndex);
      const minShift = -initialStart;
      const maxShift = max - initialEnd;
      const safeShift = clamp(shift, minShift, maxShift);
      setRange(initialStart + safeShift, initialEnd + safeShift, initialEnd + safeShift, "custom");
    }
  }

  function moveDateRangeHandleDrag(event) {
    if (dateRangeCurrentMarkerDrag) {
      if (Number.isFinite(dateRangeCurrentMarkerDrag.pointerId)
        && Number.isFinite(event.pointerId)
        && event.pointerId !== dateRangeCurrentMarkerDrag.pointerId) return;
      event.preventDefault();
      setCurrentIndexFromPointerEvent(event);
      return;
    }
    if (!dateRangeHandleDrag) return;
    if (Number.isFinite(dateRangeHandleDrag.pointerId)
      && Number.isFinite(event.pointerId)
      && event.pointerId !== dateRangeHandleDrag.pointerId) return;
    updateDateRangeHandleDrag(getDateRangeRawIndexFromClientX(event.clientX));
    event.preventDefault();
  }

  function endDateRangeHandleDrag(event) {
    if (dateRangeCurrentMarkerDrag) {
      if (Number.isFinite(dateRangeCurrentMarkerDrag.pointerId)
        && Number.isFinite(event.pointerId)
        && event.pointerId !== dateRangeCurrentMarkerDrag.pointerId) return;
      const scrubState = dateRangeCurrentMarkerDrag;
      const captureTarget = scrubState.captureTarget || event.currentTarget;
      if (captureTarget && Number.isFinite(event.pointerId) && typeof captureTarget.releasePointerCapture === "function") {
        try {
          captureTarget.releasePointerCapture(event.pointerId);
        } catch (_) {
          // Best effort only.
        }
      }
      dateRangeCurrentMarkerDrag = null;
      const releasedAtOrPastEnd = Number.isFinite(scrubState.lastRawIndex)
        && scrubState.lastRawIndex >= scrubState.targetEndIdx;
      if (releasedAtOrPastEnd) {
        state.currentIndex = state.endIndex;
        stopPlayback(false);
        renderChart();
        return;
      }
      if (scrubState.resumeAfterRelease) play();
      return;
    }
    if (!dateRangeHandleDrag) return;
    if (Number.isFinite(dateRangeHandleDrag.pointerId)
      && Number.isFinite(event.pointerId)
      && event.pointerId !== dateRangeHandleDrag.pointerId) return;
    if (event.currentTarget && Number.isFinite(event.pointerId) && typeof event.currentTarget.releasePointerCapture === "function") {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch (_) {
        // Best effort only.
      }
    }
    dateRangeHandleDrag = null;
    event.preventDefault();
  }

  function bindEvents() {
    els.dateRangePlayBtn?.addEventListener("click", play);
    els.dateRangePauseBtn?.addEventListener("click", pause);
    els.dateRangeStopBtn?.addEventListener("click", stop);
    els.dateRangeSpeedBtn?.addEventListener("click", () => {
      const idx = PLAYBACK_SPEEDS.indexOf(state.playbackSpeed);
      state.playbackSpeed = PLAYBACK_SPEEDS[(idx + 1) % PLAYBACK_SPEEDS.length];
      state.downloadSettings.speed = String(state.playbackSpeed);
      saveDownloadSettings();
      if (preResetStateSnapshot) preResetStateSnapshot = null;
      const wasPlaying = state.isPlaying;
      if (wasPlaying) play();
      else syncControls();
    });
    els.dashboardExpandBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      setDashboardExpandedMode(!document.body.classList.contains("issuance-dashboard-expanded"));
    });
    els.dateRangeDownloadBtn?.addEventListener("click", downloadDateRangeAnimation);
    els.downloadSettingsDownloadBtn?.addEventListener("click", downloadDateRangeAnimation);
    els.dateRangeSettingsBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = !els.dateRangeSettingsMenu?.classList.contains("open");
      els.dateRangeSettingsMenu?.classList.toggle("open", open);
      els.dateRangeSettingsBtn?.classList.toggle("is-open", open);
      if (open) syncDownloadSettingsControls();
    });
    els.dateRangeSettingsMenu?.addEventListener("click", (event) => {
      event.stopPropagation();
      const button = event.target instanceof Element ? event.target.closest(".download-setting-option[data-value]") : null;
      if (!button) return;
      const group = button.closest(".download-setting-button-row");
      if (!group) return;
      const keyByGroup = {
        downloadScaleSelect: "scale",
        downloadOrientationSelect: "orientation",
        downloadQualitySelect: "quality",
        downloadSpeedSelect: "speed",
        downloadThemeSelect: "theme",
      };
      const key = keyByGroup[group.id];
      if (!key) return;
      state.downloadSettings[key] = button.dataset.value;
      state.downloadSettings = normalizeDownloadSettings(state.downloadSettings);
      saveDownloadSettings();
      syncDownloadSettingsControls();
    });
    els.downloadEndFrameHoldToggle?.addEventListener("change", (event) => {
      state.downloadSettings.endFrameHold = !!event.target.checked;
      state.downloadSettings = normalizeDownloadSettings(state.downloadSettings);
      saveDownloadSettings();
      syncDownloadSettingsControls();
    });
    els.issuanceSettingsBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setIssuanceSettingsPanelOpen(!els.issuanceSettingsPanel?.classList.contains("open"));
    });
    els.issuanceSettingsClose?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setIssuanceSettingsPanelOpen(false);
    });
    els.issuanceSettingsPanel?.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    els.showPerfectIssuanceToggle?.addEventListener("change", (event) => {
      state.showPerfectIssuanceMarkers = !!event.target.checked;
      syncControls();
      renderChart();
    });
    els.showTargetIssuanceRateToggle?.addEventListener("change", (event) => {
      state.showTargetIssuanceRate = !!event.target.checked;
      syncControls();
      renderChart();
    });
    els.dailyCalculationsUseSelectedTimeZoneToggle?.addEventListener("change", (event) => {
      state.dailyCalculationsUseSelectedTimeZone = !!event.target.checked;
      syncControls();
      renderChart();
    });
    document.addEventListener("click", (event) => {
      if (!els.dateRangeSettingsMenu?.classList.contains("open")) return;
      if (els.dateRangeSettingsMenu.contains(event.target) || els.dateRangeSettingsBtn?.contains(event.target)) return;
      els.dateRangeSettingsMenu.classList.remove("open");
      els.dateRangeSettingsBtn?.classList.remove("is-open");
    });
    document.addEventListener("click", (event) => {
      if (!els.issuanceSettingsPanel?.classList.contains("open")) return;
      if (els.issuanceSettingsPanel.contains(event.target) || els.issuanceSettingsBtn?.contains(event.target)) return;
      setIssuanceSettingsPanelOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      els.dateRangeSettingsMenu?.classList.remove("open");
      els.dateRangeSettingsBtn?.classList.remove("is-open");
      setIssuanceSettingsPanelOpen(false);
    });
    els.dateRangeStartSlider?.addEventListener("input", () => {
      pauseIfActive();
      setLastAdjustedDateRangeHandle("start");
      const rawStart = Number(els.dateRangeStartSlider.value);
      const nextStart = clamp(Number.isFinite(rawStart) ? rawStart : state.startIndex, 0, Math.max(0, state.endIndex - 1));
      setRange(nextStart, state.endIndex, Math.max(nextStart, state.currentIndex), "custom");
    });
    els.dateRangeEndSlider?.addEventListener("input", () => {
      pauseIfActive();
      setLastAdjustedDateRangeHandle("end");
      const minEnd = Math.min(state.rows.length - 1, state.startIndex + 1);
      const rawEnd = Number(els.dateRangeEndSlider.value);
      const nextEnd = clamp(Number.isFinite(rawEnd) ? rawEnd : minEnd, minEnd, state.rows.length - 1);
      setRange(state.startIndex, nextEnd, nextEnd, "custom");
    });
    els.dateRangeStartInput?.addEventListener("change", () => {
      setLastAdjustedDateRangeHandle("start");
      setRange(indexForDate(els.dateRangeStartInput.value), state.endIndex, state.endIndex, "custom");
    });
    els.dateRangeEndInput?.addEventListener("change", () => {
      setLastAdjustedDateRangeHandle("end");
      const nextEnd = indexForDate(els.dateRangeEndInput.value);
      setRange(state.startIndex, nextEnd, nextEnd, "custom");
    });
    if (els.dateRangeStartBtn && els.dateRangeStartInput) {
      const startPicker = makeDatePicker({
        anchorEl: els.dateRangeStartBtn,
        align: "left",
        getSelected: () => els.dateRangeStartInput.value || state.rows[state.startIndex]?.date || "",
        getMin: () => els.dateRangeStartInput.min || state.rows[0]?.date || "",
        getMax: () => els.dateRangeStartInput.max || state.rows[Math.max(0, state.endIndex - 1)]?.date || "",
        onSelect: (isoVal) => {
          setLastAdjustedDateRangeHandle("start");
          setRange(indexForDate(isoVal), state.endIndex, state.endIndex, "custom");
        },
      });
      els.dateRangeStartBtn.addEventListener("click", startPicker.toggle);
    }
    if (els.dateRangeEndBtn && els.dateRangeEndInput) {
      const endPicker = makeDatePicker({
        anchorEl: els.dateRangeEndBtn,
        align: "left",
        getSelected: () => els.dateRangeEndInput.value || state.rows[state.endIndex]?.date || "",
        getMin: () => els.dateRangeEndInput.min || state.rows[Math.min(state.rows.length - 1, state.startIndex + 1)]?.date || "",
        getMax: () => els.dateRangeEndInput.max || state.rows[state.rows.length - 1]?.date || "",
        onSelect: (isoVal) => {
          setLastAdjustedDateRangeHandle("end");
          const nextEnd = indexForDate(isoVal);
          setRange(state.startIndex, nextEnd, nextEnd, "custom");
        },
      });
      els.dateRangeEndBtn.addEventListener("click", endPicker.toggle);
    }
    els.dateRangeDaysInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitDateRangeDaysInput(els.dateRangeDaysInput);
        els.dateRangeDaysInput.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        const fallback = Number.parseInt(els.dateRangeDaysInput.dataset.lastValidValue || "0", 10);
        els.dateRangeDaysInput.value = fallback > 0 ? fallback.toLocaleString("en-US") : "";
        els.dateRangeDaysInput.blur();
      }
    });
    els.dateRangeDaysInput?.addEventListener("focus", () => selectDateRangeDaysInput(els.dateRangeDaysInput));
    els.dateRangeDaysInput?.addEventListener("click", () => selectDateRangeDaysInput(els.dateRangeDaysInput));
    els.dateRangeDaysInput?.addEventListener("input", () => {
      els.dateRangeDaysInput.value = String(els.dateRangeDaysInput.value || "").replace(/\D/g, "");
    });
    els.dateRangeDaysInput?.addEventListener("blur", () => commitDateRangeDaysInput(els.dateRangeDaysInput));
    const startMarker = document.querySelector(".date-range-start-marker");
    const endMarker = document.querySelector(".date-range-end-marker");
    const currentMarker = document.querySelector(".date-range-current-marker");
    currentMarker?.addEventListener("pointerdown", beginDateRangeCurrentMarkerDrag);
    currentMarker?.addEventListener("pointermove", moveDateRangeHandleDrag);
    currentMarker?.addEventListener("pointerup", endDateRangeHandleDrag);
    currentMarker?.addEventListener("pointercancel", endDateRangeHandleDrag);
    startMarker?.addEventListener("pointerdown", (event) => beginDateRangeHandleDrag(event, "start", els.dateRangeSliderWrap || event.currentTarget));
    endMarker?.addEventListener("pointerdown", (event) => beginDateRangeHandleDrag(event, "end", els.dateRangeSliderWrap || event.currentTarget));
    els.dateRangeSliderWrap?.addEventListener("pointerdown", beginDateRangeSliderWrapScrub);
    [els.dateRangeSliderWrap, startMarker, endMarker].forEach((target) => {
      target?.addEventListener("pointermove", moveDateRangeHandleDrag);
      target?.addEventListener("pointerup", endDateRangeHandleDrag);
      target?.addEventListener("pointercancel", endDateRangeHandleDrag);
    });
    document.querySelector(".date-range-range-buttons")?.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("[data-range-preset]") : null;
      if (!button) return;
      const preset = button.getAttribute("data-range-preset");
      const end = state.rows.length - 1;
      const start = getPresetStartIndex(preset, end);
      setRange(start, end, end, preset);
    });
    document.querySelector(".date-range-view-buttons")?.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("[data-view-mode]") : null;
      if (!button) return;
      const viewMode = button.getAttribute("data-view-mode");
      if (!isValidViewMode(viewMode) || state.viewMode === viewMode) return;
      state.viewMode = viewMode;
      if (preResetStateSnapshot) preResetStateSnapshot = null;
      syncControls();
      renderChart();
    });
    document.querySelector(".date-range-scale-buttons")?.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("[data-scale-mode]") : null;
      if (!button) return;
      const scaleMode = button.getAttribute("data-scale-mode");
      if (!isValidScaleMode(scaleMode) || state.scaleMode === scaleMode) return;
      state.scaleMode = scaleMode;
      if (preResetStateSnapshot) preResetStateSnapshot = null;
      syncControls();
      renderChart();
    });
    els.copyDashboardLink?.addEventListener("click", async () => {
      try {
        await window.WSBDashboardComponents.copyDashboardLink({
          button: els.copyDashboardLink,
          url: window.location.href,
          copiedIcon: ICONS.copyCopied,
          defaultIcon: ICONS.copyLink,
          setIcon: (icon) => setButtonIcon("copyDashboardIcon", icon),
        });
      } catch (_) {
        // Best effort only.
      }
    });
    els.resetDashboard?.addEventListener("click", () => {
      if (preResetStateSnapshot) {
        const snapshot = preResetStateSnapshot;
        preResetStateSnapshot = null;
        restoreResetSnapshot(snapshot);
        return;
      }
      preResetStateSnapshot = captureResetSnapshot();
      const defaultPreset = getDefaultPreset();
      const defaultEnd = state.rows.length - 1;
      restoreResetSnapshot({
        startIndex: getPresetStartIndex(defaultPreset, defaultEnd),
        endIndex: defaultEnd,
        currentIndex: defaultEnd,
        playbackSpeed: 1,
        selectedPreset: defaultPreset,
        viewMode: "single",
        scaleMode: "linear",
        showPerfectIssuanceMarkers: true,
        showTargetIssuanceRate: true,
        dailyCalculationsUseSelectedTimeZone: false,
      });
    });
    bindCustomTooltips();
    bindDateRangeKeyboardShortcuts();
    primeKeyboardFocus();
    window.addEventListener("resize", () => {
      scheduleLayoutSync();
      if (els.issuanceSettingsPanel?.classList.contains("open")) positionIssuanceSettingsPanel();
    });
    window.addEventListener("scroll", () => {
      if (els.issuanceSettingsPanel?.classList.contains("open")) positionIssuanceSettingsPanel();
    }, true);
    if ("ResizeObserver" in window && els.dateRangeSliderWrap) {
      const sliderResizeObserver = new ResizeObserver(scheduleLayoutSync);
      sliderResizeObserver.observe(els.dateRangeSliderWrap);
    }
    document.addEventListener("dashboard-theme-change", () => requestAnimationFrame(renderChart));
  }

  function pauseIfActive() {
    if (state.isPlaying || state.isPaused) stopPlayback(false);
  }

  function withBust(url, cacheBust = null) {
    if (cacheBust == null) return url;
    const separator = String(url).includes("?") ? "&" : "?";
    return `${url}${separator}_=${cacheBust}`;
  }

  function getIssuanceDataSignature(data) {
    const generated = String(data?.generated_utc || "");
    const height = String(data?.source?.latest_block_height ?? "");
    return `${generated}|${height}`;
  }

  function normalizeIssuanceRows(data) {
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    rows.forEach((row) => {
      row.date_num = dateNum(row.date);
    });
    return rows;
  }

  async function loadIssuanceData(cacheBust = null) {
    const resp = await fetch(withBust("webapp_data/issuance_rate_data.json", cacheBust), { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to load issuance data (${resp.status})`);
    return resp.json();
  }

  function findRowIndexByDate(rows, date, fallback) {
    const idx = rows.findIndex((row) => row.date === date);
    return idx >= 0 ? idx : fallback;
  }

  function applyIssuanceData(data, { preserveSelection = false } = {}) {
    const oldRows = state.rows;
    const oldMax = Math.max(0, oldRows.length - 1);
    const oldStartDate = oldRows[state.startIndex]?.date || "";
    const oldEndDate = oldRows[state.endIndex]?.date || "";
    const oldCurrentDate = oldRows[state.currentIndex]?.date || "";
    const endWasLatest = state.endIndex >= oldMax;
    const currentWasLatest = state.currentIndex >= oldMax;

    state.data = data;
    state.rows = normalizeIssuanceRows(data);
    state.dataSignature = getIssuanceDataSignature(data);
    timeZoneAdjustedRowsCache.clear();
    epochLogMinCache.clear();
    epochTargetLogMinCache.clear();

    if (!state.rows.length) throw new Error("No issuance rows found.");

    const max = Math.max(0, state.rows.length - 1);
    if (preserveSelection && oldRows.length) {
      state.startIndex = clamp(findRowIndexByDate(state.rows, oldStartDate, state.startIndex), 0, max);
      state.endIndex = endWasLatest ? max : clamp(findRowIndexByDate(state.rows, oldEndDate, state.endIndex), state.startIndex, max);
      if (state.endIndex < state.startIndex) state.endIndex = state.startIndex;
      state.currentIndex = currentWasLatest
        ? state.endIndex
        : clamp(findRowIndexByDate(state.rows, oldCurrentDate, state.currentIndex), state.startIndex, state.endIndex);
    } else {
      state.endIndex = max;
      state.currentIndex = max;
    }
  }

  async function refreshIfDataChanged() {
    if (!state.data || state.refreshInFlight || isDateRangeExporting) return;
    state.refreshInFlight = true;
    try {
      const latestData = await loadIssuanceData(Date.now());
      const latestSignature = getIssuanceDataSignature(latestData);
      if (!latestSignature || latestSignature === state.dataSignature) return;
      applyIssuanceData(latestData, { preserveSelection: true });
      applyTopKpiWidthLocks();
      syncControls();
      renderChart();
    } catch (error) {
      console.warn("Issuance data auto-refresh check failed:", error);
    } finally {
      state.refreshInFlight = false;
    }
  }

  function triggerRefreshSoon(delayMs = 150) {
    window.setTimeout(refreshIfDataChanged, delayMs);
  }

  function setupRefreshWakeEvents() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") triggerRefreshSoon(0);
    });
    window.addEventListener("focus", () => triggerRefreshSoon(0));
    window.addEventListener("pageshow", () => triggerRefreshSoon(0));
    window.addEventListener("online", () => triggerRefreshSoon(0));
  }

  function startAutoRefresh() {
    if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = setInterval(refreshIfDataChanged, AUTO_REFRESH_MS);
  }

  function indexForDate(date) {
    const idx = state.rows.findIndex((row) => row.date === date);
    return idx >= 0 ? idx : state.endIndex;
  }

  async function init() {
    cacheElements();
    loadDownloadSettings();
    bindDateRangeExportUnloadGuard();
    updatedTimeZoneChip?.populate?.();
    bindEvents();
    applyIssuanceData(await loadIssuanceData());
    applyTopKpiWidthLocks();
    restoreState();
    bindDateRangeSessionPersistence();
    syncDownloadSettingsControls();
    syncControls();
    renderChart();
    setupRefreshWakeEvents();
    startAutoRefresh();
    if (state.isPaused) bindDateRangePlaybackOutsidePointerActions();
    document.body.classList.remove("issuance-loading");
    if (els.chartLoading) els.chartLoading.hidden = true;
  }

  init().catch((error) => {
    console.error(error);
    document.body.classList.remove("issuance-loading");
    if (els.chartLoading) {
      els.chartLoading.hidden = false;
      els.chartLoading.textContent = error.message || "Unable to load issuance rate data.";
    }
  });
})();
