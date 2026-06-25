(function () {
  "use strict";

  const THEME_KEY = "quantum-research-dashboard-theme";
  const STORAGE_KEY = "dca_comparison_settings_v1";
  const SHARE_STATE_PARAM = "state";
  const LOCAL_RUNTIME_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
  const IS_LOCAL_RUNTIME = LOCAL_RUNTIME_HOSTS.has(window.location.hostname);
  const ICONS = {
    copyLink: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
    copyCopied: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>',
    resetDefaults: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>',
    resetUndo: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>',
  };
  const SPEEDS = [0.5, 1, 2, 4];
  const MS_DAY = 86400000;
  const EXPORT_FPS = 30;
  const EXPORT_START_HOLD_FRAMES = EXPORT_FPS;
  const EXPORT_END_HOLD_FRAMES = EXPORT_FPS * 3;
  const LOG_MIN_POSITIVE = 1e-12;
  const CHART_MONO_FONT = '"IBM Plex Mono", monospace';
  const DASHBOARD_GRID_LINE_WIDTH = 1;
  const DASHBOARD_CHART_LINE_WIDTH = 2;
  const EXPORT_GRID_LINE_WIDTH = 1;
  const EXPORT_REFERENCE_CHART_LINE_WIDTH = 5.8;
  const SELECT_DROPDOWN_CONFIGS = [
    { selectId: "cadenceSelect", dropdownId: "cadenceDropdown", triggerId: "cadenceDropdownTrigger", menuId: "cadenceDropdownMenu" },
    { selectId: "scaleSelect", dropdownId: "scaleDropdown", triggerId: "scaleDropdownTrigger", menuId: "scaleDropdownMenu" },
    { selectId: "assetASelect", dropdownId: "assetADropdown", triggerId: "assetADropdownTrigger", menuId: "assetADropdownMenu" },
    { selectId: "assetBSelect", dropdownId: "assetBDropdown", triggerId: "assetBDropdownTrigger", menuId: "assetBDropdownMenu" },
  ];
  const ASSETS = {
    BTC: { name: "Bitcoin", label: "Bitcoin", unit: "btc", color: "#ff9900" },
    XAU: { name: "Gold", label: "Gold", unit: "gold oz", color: "#ffd000", cssClass: "gold" },
    XAG: { name: "Silver", label: "Silver", unit: "silver oz", color: "#c7d2dc", cssClass: "silver" },
    SPY: { name: "$SPY", label: "$SPY", unit: "SPY", color: "#4da3ff" },
    QQQ: { name: "$QQQ", label: "$QQQ", unit: "QQQ", color: "#b77cff" },
    TLT: { name: "$TLT", label: "$TLT", unit: "TLT", color: "#7dd3fc" },
    MSTR: { name: "$MSTR", label: "$MSTR", unit: "MSTR", color: "#f97316" },
  };
  const LEGACY_ASSET_CODES = {
    SPX: "SPY",
    IXIC: "QQQ",
  };
  const NO_SECONDARY_ASSET = "NONE";

  let selectDropdownGlobalListenersBound = false;
  let secondaryAssetArrowGlobalBound = false;
  let activeDatePickerClose = null;
  let downloadEstimateCalibrationTimer = null;
  let downloadEstimateCalibrationRequestId = 0;
  let preResetStateSnapshot = null;
  const downloadEstimateCalibrationCache = new Map();
  const downloadEstimateCalibrationPending = new Set();
  const DEFAULTS = {
    dcaStart: "",
    rangeStart: "",
    rangeEnd: "",
    cadence: "weekly",
    amount: 50,
    assetA: "BTC",
    assetB: "XAU",
    preset: "4y",
    speed: 1,
    quality: 720,
    scale: "linear",
    orientation: "landscape",
    theme: "",
    endFrameHold: true,
  };
  const DEFAULT_EXPORT_SETTINGS = {
    scale: DEFAULTS.scale,
    orientation: DEFAULTS.orientation,
    quality: DEFAULTS.quality,
    speed: DEFAULTS.speed,
    theme: "",
    endFrameHold: DEFAULTS.endFrameHold,
  };

  const el = {
    cadenceSelect: document.getElementById("cadenceSelect"),
    scaleSelect: document.getElementById("scaleSelect"),
    amountInput: document.getElementById("amountInput"),
    assetASelect: document.getElementById("assetASelect"),
    assetBSelect: document.getElementById("assetBSelect"),
    rangeStartInput: document.getElementById("dateRangeStartInput"),
    rangeEndInput: document.getElementById("dateRangeEndInput"),
    rangeStartBtn: document.getElementById("dateRangeStartBtn"),
    rangeEndBtn: document.getElementById("dateRangeEndBtn"),
    rangeDaysInput: document.getElementById("dateRangeDaysInput"),
    startSlider: document.getElementById("dateRangeStartSlider"),
    endSlider: document.getElementById("dateRangeEndSlider"),
    rangePanel: document.querySelector(".date-range-panel"),
    rangeTrackWrap: document.getElementById("dateRangeSliderWrap"),
    playBtn: document.getElementById("dateRangePlayBtn"),
    pauseBtn: document.getElementById("dateRangePauseBtn"),
    stopBtn: document.getElementById("dateRangeStopBtn"),
    speedBtn: document.getElementById("dateRangeSpeedBtn"),
    expandBtn: document.getElementById("dashboardExpandBtn"),
    downloadBtn: document.getElementById("dateRangeDownloadBtn"),
    settingsBtn: document.getElementById("dateRangeSettingsBtn"),
    settingsPanel: document.getElementById("dateRangeSettingsMenu"),
    downloadPanelBtn: document.getElementById("downloadSettingsDownloadBtn"),
    downloadScaleSelect: document.getElementById("downloadScaleSelect"),
    downloadOrientationSelect: document.getElementById("downloadOrientationSelect"),
    downloadQualitySelect: document.getElementById("downloadQualitySelect"),
    downloadSpeedSelect: document.getElementById("downloadSpeedSelect"),
    downloadThemeSelect: document.getElementById("downloadThemeSelect"),
    downloadEndFrameHoldToggle: document.getElementById("downloadEndFrameHoldToggle"),
    downloadEstimateSize: document.getElementById("downloadEstimateSize"),
    downloadEstimateLength: document.getElementById("downloadEstimateLength"),
    downloadEstimateTime: document.getElementById("downloadEstimateTime"),
    copyLinkBtn: document.getElementById("copyDashboardLink"),
    resetBtn: document.getElementById("resetDashboard"),
    canvas: document.getElementById("chartCanvas"),
    chartLegend: document.getElementById("chartLegend"),
    statusChips: document.getElementById("statusChips"),
    missingDataStart: document.getElementById("dateRangeMissingDataStart"),
    missingDataEnd: document.getElementById("dateRangeMissingDataEnd"),
    missingSelectionStart: document.getElementById("dateRangeMissingSelectionStart"),
    missingSelectionEnd: document.getElementById("dateRangeMissingSelectionEnd"),
    missingMarkerStart: document.getElementById("dateRangeMissingMarkerStart"),
    missingMarkerEnd: document.getElementById("dateRangeMissingMarkerEnd"),
    assetAPriceTitle: document.getElementById("assetAPriceTitle"),
    assetBPriceTitle: document.getElementById("assetBPriceTitle"),
    assetAPriceLabel: document.getElementById("assetAPriceLabel"),
    assetBPriceLabel: document.getElementById("assetBPriceLabel"),
    assetAPrice: document.getElementById("assetAPrice"),
    assetBPrice: document.getElementById("assetBPrice"),
    countLabel: document.getElementById("countLabel"),
    countKpi: document.getElementById("countKpi"),
    countYearsKpi: document.getElementById("countYearsKpi"),
    investedKpi: document.getElementById("investedKpi"),
    assetADcaTitle: document.getElementById("assetADcaTitle"),
    assetBDcaTitle: document.getElementById("assetBDcaTitle"),
    assetADcaValue: document.getElementById("assetADcaValue"),
    assetBDcaValue: document.getElementById("assetBDcaValue"),
    assetADcaUnits: document.getElementById("assetADcaUnits"),
    assetBDcaUnits: document.getElementById("assetBDcaUnits"),
    errorBox: document.getElementById("errorBox"),
    startMarker: document.querySelector(".date-range-start-marker"),
    endMarker: document.querySelector(".date-range-end-marker"),
    currentMarker: document.querySelector(".date-range-current-marker"),
  };

  const state = {
    settings: { ...DEFAULTS },
    exportSettings: { ...DEFAULT_EXPORT_SETTINGS },
    rows: [],
    byDate: new Map(),
    assetBounds: {},
    minIso: "",
    maxIso: "",
    desiredRangeStart: "",
    desiredRangeEnd: "",
    currentIso: "",
    isPlaying: false,
    paused: false,
    timerId: null,
    drag: null,
    dragInfo: null,
    lastAdjustedHandle: null,
    pendingSpacePlayback: false,
    wasPlayingBeforeDrag: false,
    wasPausedBeforeDrag: false,
    isExporting: false,
    exportCancelRequested: false,
  };
  let chartRangeDragState = null;
  let chartRangeResizeWheelRemainder = 0;
  let chartRangePanWheelRemainder = 0;

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
    if (state.rows.length) requestAnimationFrame(render);
  }

  try {
    const storedTheme = localStorage.getItem(THEME_KEY);
    applyTheme(storedTheme === "light" || storedTheme === "dark" ? storedTheme : "dark");
  } catch {
    applyTheme("dark");
  }

  window.addEventListener("message", (event) => {
    if (event.data?.type === "quantum-dashboard-theme") applyTheme(event.data.theme);
  });

  window.addEventListener("storage", (event) => {
    if (event.key === THEME_KEY && (event.newValue === "light" || event.newValue === "dark")) applyTheme(event.newValue);
  });

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (ch !== "\r") field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.length && r.some((v) => v !== ""));
  }

  function isoFromMaybeUsDate(value) {
    const raw = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return "";
    const y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
    return `${y}-${String(Number(m[1])).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
  }

  function dateFromIso(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  function getLocalTodayIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function addDays(iso, days) {
    const d = dateFromIso(iso);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function subtractCalendarYears(iso, years) {
    const end = dateFromIso(iso);
    const start = new Date(Date.UTC(end.getUTCFullYear() - years, end.getUTCMonth(), end.getUTCDate()));
    if (end.getUTCMonth() === 1 && end.getUTCDate() === 29) {
      start.setUTCDate(28);
    }
    return start.toISOString().slice(0, 10);
  }

  function getNextFridayIso(iso) {
    const d = dateFromIso(iso);
    const day = d.getUTCDay();
    const daysUntilFriday = (5 - day + 7) % 7;
    d.setUTCDate(d.getUTCDate() + daysUntilFriday);
    return d.toISOString().slice(0, 10);
  }

  function getPreviousFridayIso(iso) {
    const d = dateFromIso(iso);
    const day = d.getUTCDay();
    const daysSinceFriday = (day - 5 + 7) % 7;
    d.setUTCDate(d.getUTCDate() - daysSinceFriday);
    return d.toISOString().slice(0, 10);
  }

  function getNextMonthFirstIso(iso) {
    const d = dateFromIso(iso);
    if (d.getUTCDate() === 1) return iso;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  }

  function getPreviousMonthFirstIso(iso) {
    const d = dateFromIso(iso);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (d.getUTCDate() === 1 ? 1 : 0), 1)).toISOString().slice(0, 10);
  }

  function normalizeCadenceStartIso(iso, cadence) {
    if (!iso) return iso;
    if (cadence === "weekly") return getNextFridayIso(iso);
    if (cadence === "monthly") return getNextMonthFirstIso(iso);
    return iso;
  }

  function alignCadenceStartIso(iso, cadence, direction = "ceil") {
    if (!iso) return iso;
    if (direction === "floor") {
      if (cadence === "weekly") return getPreviousFridayIso(iso);
      if (cadence === "monthly") {
        const d = dateFromIso(iso);
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
      }
      return iso;
    }
    return normalizeCadenceStartIso(iso, cadence);
  }

  function dayDiff(a, b) {
    return Math.round((dateFromIso(b) - dateFromIso(a)) / MS_DAY);
  }

  function clampIso(iso, min, max) {
    if (!iso || iso < min) return min;
    if (iso > max) return max;
    return iso;
  }

  function getPresetStartIso(preset, endIso) {
    const bounds = getActiveAvailableBounds();
    if (!bounds.minIso || !endIso) return "";
    if (preset === "full") return bounds.minIso;
    if (preset === "ytd") return clampIso(`${endIso.slice(0, 4)}-01-01`, bounds.minIso, bounds.maxIso);
    const yearCount = Number.parseInt(String(preset).replace("y", ""), 10);
    if (Number.isFinite(yearCount) && yearCount > 0) {
      return clampIso(subtractCalendarYears(endIso, yearCount), bounds.minIso, bounds.maxIso);
    }
    return bounds.minIso;
  }

  function inferRangePreset(startIso, endIso) {
    if (!startIso || !endIso) return "";
    const bounds = getActiveAvailableBounds();
    if (startIso === bounds.minIso && endIso === bounds.maxIso) return "full";
    const presets = ["ytd", "1y", "2y", "4y", "8y"];
    return presets.find((preset) => {
      const presetStart = normalizeCadenceStartIso(getPresetStartIso(preset, endIso), state.settings.cadence);
      return clampIso(presetStart, bounds.minIso, bounds.maxIso) === startIso;
    }) || "";
  }

  function findDateIndex(iso) {
    if (!state.rows.length) return 0;
    let lo = 0;
    let hi = state.rows.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (state.rows[mid].date < iso) lo = mid + 1;
      else hi = mid;
    }
    if (state.rows[lo]?.date === iso || lo === 0) return lo;
    const prior = lo - 1;
    return Math.abs(dayDiff(state.rows[lo].date, iso)) < Math.abs(dayDiff(state.rows[prior].date, iso)) ? lo : prior;
  }

  function findDateIndexByMode(iso, mode = "nearest") {
    if (!state.rows.length) return -1;
    let lo = 0;
    let hi = state.rows.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (state.rows[mid].date < iso) lo = mid + 1;
      else hi = mid;
    }
    if (state.rows[lo]?.date === iso) return lo;
    if (mode === "ceil") return lo;
    if (mode === "floor") return Math.max(0, lo - 1);
    if (lo === 0) return 0;
    const prior = lo - 1;
    return Math.abs(dayDiff(state.rows[lo].date, iso)) < Math.abs(dayDiff(state.rows[prior].date, iso)) ? lo : prior;
  }

  function getAssetBounds(assetCode) {
    if (assetCode === NO_SECONDARY_ASSET) return { minIso: state.minIso, maxIso: state.maxIso };
    return state.assetBounds?.[assetCode] || { minIso: state.minIso, maxIso: state.maxIso };
  }

  function hasSecondaryAsset(settings = state.settings) {
    return settings.assetB !== NO_SECONDARY_ASSET && !!ASSETS[settings.assetB];
  }

  function getPairAvailableBounds(settings = state.settings) {
    const a = getAssetBounds(settings.assetA);
    const bounds = [a];
    if (hasSecondaryAsset(settings)) bounds.push(getAssetBounds(settings.assetB));
    const minIso = bounds.map((bound) => bound.minIso).filter(Boolean).sort().at(-1) || state.minIso;
    const maxIso = bounds.map((bound) => bound.maxIso).filter(Boolean).sort()[0] || state.maxIso;
    if (!minIso || !maxIso || minIso > maxIso) return { minIso: state.minIso, maxIso: state.maxIso };
    return { minIso, maxIso };
  }

  function getActiveAvailableBounds() {
    return getPairAvailableBounds(state.settings);
  }

  function getLatestPresetEndIso(settings = state.settings) {
    const available = getPairAvailableBounds(settings);
    return clampIso(getLocalTodayIso(), available.minIso, available.maxIso);
  }

  function rememberDesiredRange(startIso = state.settings.rangeStart, endIso = state.settings.rangeEnd) {
    state.desiredRangeStart = startIso || state.desiredRangeStart || state.minIso;
    state.desiredRangeEnd = endIso || state.desiredRangeEnd || state.maxIso;
  }

  function getVisualBounds() {
    const available = getActiveAvailableBounds();
    const desiredStart = state.desiredRangeStart || state.settings.rangeStart || available.minIso;
    const desiredEnd = state.desiredRangeEnd || state.settings.rangeEnd || available.maxIso;
    return {
      minIso: [desiredStart, available.minIso].filter(Boolean).sort()[0] || state.minIso,
      maxIso: [desiredEnd, available.maxIso].filter(Boolean).sort().at(-1) || state.maxIso,
    };
  }

  function clampSettingsToAvailableRange({ preserveDesired = true } = {}) {
    const available = getActiveAvailableBounds();
    if (preserveDesired) rememberDesiredRange();
    state.settings.rangeStart = clampIso(state.settings.rangeStart || available.minIso, available.minIso, available.maxIso);
    state.settings.rangeEnd = clampIso(state.settings.rangeEnd || available.maxIso, available.minIso, available.maxIso);
    if (state.settings.rangeStart > state.settings.rangeEnd) state.settings.rangeStart = state.settings.rangeEnd;
    state.settings.dcaStart = state.settings.rangeStart;
    state.currentIso = clampIso(state.currentIso || state.settings.rangeEnd, state.settings.rangeStart, state.settings.rangeEnd);
  }

  function fmtShortDate(iso) {
    const [y, m, d] = iso.split("-");
    return `${Number(m)}/${Number(d)}/${String(y).slice(-2)}`;
  }

  function datePickerButtonHtml(iso) {
    const label = iso ? fmtShortDate(iso) : "00/00/00";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg><span>${label}</span>`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function parseCssPx(value, fallback = 0) {
    const n = Number.parseFloat(String(value || "").trim());
    return Number.isFinite(n) ? n : fallback;
  }

  function setDropdownOpen(dropdownEl, menuEl, isOpen) {
    if (!menuEl) return;
    const open = !!isOpen;
    menuEl.classList.toggle("open", open);
    dropdownEl?.classList.toggle("is-open", open);
  }

  function closeAllSelectDropdowns(exceptDropdown = null) {
    SELECT_DROPDOWN_CONFIGS.forEach(({ dropdownId, menuId }) => {
      const dropdown = document.getElementById(dropdownId);
      const menu = document.getElementById(menuId);
      if (!dropdown || !menu || dropdown === exceptDropdown) return;
      setDropdownOpen(dropdown, menu, false);
    });
  }

  function sizeSelectDropdownToOptions(selectId, dropdownId, triggerId) {
    const select = document.getElementById(selectId);
    const dropdown = document.getElementById(dropdownId);
    const trigger = document.getElementById(triggerId);
    const valueEl = document.getElementById(triggerId.replace("Trigger", "Value"));
    if (!select || !dropdown || dropdown.dataset.fixedWidthPx) return;
    const probeEl = valueEl || trigger || dropdown;
    const style = window.getComputedStyle(probeEl);
    const measurer = document.createElement("span");
    measurer.style.position = "fixed";
    measurer.style.left = "-99999px";
    measurer.style.top = "-99999px";
    measurer.style.visibility = "hidden";
    measurer.style.whiteSpace = "nowrap";
    measurer.style.font = style.font || `${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;
    document.body.appendChild(measurer);
    let maxTextWidth = 0;
    Array.from(select.options).forEach((option) => {
      measurer.textContent = option.textContent || "";
      maxTextWidth = Math.max(maxTextWidth, measurer.getBoundingClientRect().width);
    });
    measurer.remove();
    const dropdownStyle = window.getComputedStyle(dropdown);
    const leftPad = parseCssPx(dropdownStyle.getPropertyValue("--dca-dropdown-content-pad"), 10);
    const rightPad = parseCssPx(dropdownStyle.getPropertyValue("--dca-dropdown-arrow-gap"), 18);
    const fixedWidth = Math.ceil(Math.max(54, maxTextWidth + leftPad + rightPad + 1));
    dropdown.dataset.fixedWidthPx = String(fixedWidth);
    const widthPx = `${fixedWidth}px`;
    dropdown.style.width = widthPx;
    dropdown.style.minWidth = widthPx;
    dropdown.style.maxWidth = widthPx;
    dropdown.style.flexBasis = widthPx;
  }

  function syncSelectDropdown(selectId, triggerId, menuId) {
    const select = document.getElementById(selectId);
    const trigger = document.getElementById(triggerId);
    const menu = document.getElementById(menuId);
    const valueEl = document.getElementById(triggerId.replace("Trigger", "Value"));
    if (!select || !menu) return;
    const options = Array.from(select.options).filter((option) => {
      if (selectId !== "assetBSelect") return option.value !== NO_SECONDARY_ASSET;
      if (option.value === NO_SECONDARY_ASSET) return true;
      return option.value !== (el.assetASelect?.value || state.settings.assetA);
    });
    if (selectId === "assetBSelect" && options.length && !options.some((option) => option.value === select.value)) {
      select.value = options[0].value;
      state.settings.assetB = options[0].value;
    }
    const selectedOption = Array.from(select.options).find((option) => option.value === select.value);
    if (valueEl) valueEl.textContent = selectedOption ? selectedOption.textContent : "";
    if (trigger) trigger.setAttribute("aria-label", selectedOption ? selectedOption.textContent : "");
    menu.innerHTML = options
      .map((option) => {
        const selectedClass = option.value === select.value ? " dca-option-btn--selected" : "";
        return `<button type="button" class="dca-option-btn${selectedClass}" data-value="${escapeHtml(option.value)}">${escapeHtml(option.textContent || "")}</button>`;
      })
      .join("");
  }

  function getDropdownOptionButtons(menu) {
    return Array.from(menu?.querySelectorAll(".dca-option-btn") || []);
  }

  function cycleSelectDropdownOption(select, menu, direction) {
    const buttons = getDropdownOptionButtons(menu)
      .filter((button) => select?.id !== "assetBSelect" || button.dataset.value !== NO_SECONDARY_ASSET);
    if (!buttons.length || !select) return false;
    const selectedIndex = Math.max(0, buttons.findIndex((button) => button.dataset.value === select.value));
    const nextIndex = (selectedIndex + direction + buttons.length) % buttons.length;
    const nextValue = buttons[nextIndex]?.dataset.value;
    if (!nextValue) return false;
    select.value = nextValue;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function syncAllSelectDropdowns() {
    SELECT_DROPDOWN_CONFIGS.forEach(({ selectId, triggerId, menuId }) => syncSelectDropdown(selectId, triggerId, menuId));
  }

  function syncAmountInputWidth() {
    const input = el.amountInput;
    if (!input) return;
    const text = String(input.value || input.placeholder || "0");
    input.style.width = `${Math.max(1, Math.min(10, text.length || 1))}ch`;
  }

  function parseAmountValue(value) {
    const parsed = Number.parseInt(String(value || "").replace(/[^\d]/g, ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function formatAmountValue(value) {
    const parsed = parseAmountValue(value);
    return parsed > 0 ? parsed.toLocaleString("en-US") : "";
  }

  function handleAmountInput() {
    const input = el.amountInput;
    if (!input) return;
    const rawValue = String(input.value || "");
    const rawCaret = Number.isFinite(input.selectionStart) ? input.selectionStart : rawValue.length;
    const digitsBeforeCaret = rawValue.slice(0, rawCaret).replace(/[^\d]/g, "").length;
    const amount = parseAmountValue(rawValue);
    const formatted = formatAmountValue(rawValue);
    input.value = formatted;
    if (document.activeElement === input) {
      const nextCaret = getCaretIndexForDigitPosition(formatted, digitsBeforeCaret);
      input.setSelectionRange(nextCaret, nextCaret);
    }
    syncAmountInputWidth();
    if (!amount) return;
    clearPreResetSnapshot();
    state.settings.amount = amount;
    state.currentIso = state.settings.rangeEnd;
    stopAnimation(false);
    render();
  }

  function bindSelectDropdowns() {
    SELECT_DROPDOWN_CONFIGS.forEach(({ selectId, dropdownId, triggerId, menuId }) => {
      const select = document.getElementById(selectId);
      const dropdown = document.getElementById(dropdownId);
      const trigger = document.getElementById(triggerId);
      const menu = document.getElementById(menuId);
      if (!select || !dropdown || !trigger || !menu || dropdown.dataset.bound === "1") return;
      dropdown.dataset.bound = "1";
      const enclosingChip = dropdown.closest("label.chip");
      const toggleRoot = enclosingChip?.classList.contains("dca-amount-cadence-chip")
        ? dropdown
        : (enclosingChip || dropdown);
      toggleRoot?.classList.add("dca-dropdown-pill");
      toggleRoot?.addEventListener("click", (event) => {
        if (menu.contains(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        const willOpen = !menu.classList.contains("open");
        closeAllSelectDropdowns(willOpen ? dropdown : null);
        setDropdownOpen(dropdown, menu, willOpen);
      });
      menu.addEventListener("click", (event) => {
        const btn = event.target.closest(".dca-option-btn");
        if (!btn) return;
        event.preventDefault();
        event.stopPropagation();
        const nextValue = String(btn.dataset.value || "");
        if (select.value !== nextValue) {
          select.value = nextValue;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        syncSelectDropdown(selectId, triggerId, menuId);
        setDropdownOpen(dropdown, menu, false);
      });
      toggleRoot?.addEventListener("keydown", (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const isUp = event.key === "ArrowUp";
        const isDown = event.key === "ArrowDown";
        if (!isUp && !isDown && event.key !== "Enter" && event.key !== "Escape") return;
        if (event.key === "Escape") {
          setDropdownOpen(dropdown, menu, false);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Enter") {
          if (!menu.classList.contains("open")) {
            closeAllSelectDropdowns(dropdown);
            setDropdownOpen(dropdown, menu, true);
          }
          return;
        }
        if (!menu.classList.contains("open")) {
          closeAllSelectDropdowns(dropdown);
          setDropdownOpen(dropdown, menu, true);
        }
        cycleSelectDropdownOption(select, menu, isDown ? 1 : -1);
        syncSelectDropdown(selectId, triggerId, menuId);
      });
    });
    requestAnimationFrame(() => {
      SELECT_DROPDOWN_CONFIGS.forEach(({ selectId, dropdownId, triggerId }) => sizeSelectDropdownToOptions(selectId, dropdownId, triggerId));
    });
    if (selectDropdownGlobalListenersBound) return;
    selectDropdownGlobalListenersBound = true;
    document.addEventListener("click", (event) => {
      SELECT_DROPDOWN_CONFIGS.forEach(({ dropdownId, menuId }) => {
        const dropdown = document.getElementById(dropdownId);
        const menu = document.getElementById(menuId);
        if (!dropdown || !menu || dropdown.contains(event.target)) return;
        setDropdownOpen(dropdown, menu, false);
      });
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeAllSelectDropdowns();
    });
  }

  function cycleSecondaryAsset(direction) {
    if (!el.assetBSelect || !el.assetASelect) return;
    const primary = el.assetASelect.value;
    const options = Array.from(el.assetBSelect.options)
      .map((option) => option.value)
      .filter((value) => value !== primary && value !== NO_SECONDARY_ASSET);
    if (!options.length) return;

    const current = el.assetBSelect.value;
    const currentIndex = options.indexOf(current);
    const startIndex = currentIndex >= 0 ? currentIndex : (direction > 0 ? -1 : 0);
    const nextIndex = (startIndex + direction + options.length) % options.length;
    const nextValue = options[nextIndex];
    if (!nextValue || nextValue === current) return;

    el.assetBSelect.value = nextValue;
    el.assetBSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function bindSecondaryAssetArrowCycling() {
    const trigger = document.getElementById("assetBDropdownTrigger");
    if (trigger && trigger.dataset.arrowBound !== "1") {
      trigger.dataset.arrowBound = "1";
      trigger.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        event.stopPropagation();
        cycleSecondaryAsset(event.key === "ArrowDown" ? 1 : -1);
      });
    }

    if (secondaryAssetArrowGlobalBound) return;
    secondaryAssetArrowGlobalBound = true;

    const handleGlobalArrow = (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const target = event.target;
      if (target?.closest?.(".dca-dropdown, .dca-dropdown-menu")) return;
      if (isTextEntry(target)) return;
      event.preventDefault();
      cycleSecondaryAsset(event.key === "ArrowDown" ? 1 : -1);
    };

    window.addEventListener("keydown", handleGlobalArrow, true);
  }

  function isoToLocalDate(iso) {
    if (!iso) return null;
    const [year, month, day] = String(iso).split("-").map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    const date = new Date(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function makeDatePicker({ anchorEl, align = "left", getSelected, getMin, getMax, onSelect }) {
    let popup = null;
    let pickerYear;
    let pickerMonth;
    let pickerView = "days";
    let pickerExpandedYear = null;
    const popupAlign = align === "right" ? "right" : "left";

    function buildCalendar() {
      const selectedIso = getSelected();
      const minDate = isoToLocalDate(getMin());
      const maxDate = isoToLocalDate(getMax());
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
        if (pickerMonth < 0) { pickerMonth = 11; pickerYear -= 1; }
        rebuildCalendar();
      });
      const next = document.createElement("button");
      next.className = "date-picker-nav";
      next.textContent = "\u203a";
      next.type = "button";
      next.addEventListener("click", (event) => {
        event.stopPropagation();
        pickerMonth += 1;
        if (pickerMonth > 11) { pickerMonth = 0; pickerYear += 1; }
        rebuildCalendar();
      });
      const label = document.createElement("span");
      label.textContent = monthLabel;
      label.className = "date-picker-header-label";
      label.addEventListener("click", (event) => {
        event.stopPropagation();
        pickerView = "years";
        pickerExpandedYear = null;
        rebuildCalendar();
      });
      header.append(prev, label, next);
      wrap.appendChild(header);
      const grid = document.createElement("div");
      grid.className = "date-picker-grid";
      ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].forEach((dayName) => {
        const day = document.createElement("div");
        day.className = "date-picker-dow";
        day.textContent = dayName;
        grid.appendChild(day);
      });
      const firstDay = new Date(year, month, 1).getDay();
      for (let i = 0; i < firstDay; i += 1) {
        const blank = document.createElement("div");
        blank.className = "date-picker-day dp-empty";
        grid.appendChild(blank);
      }
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      for (let dayNum = 1; dayNum <= daysInMonth; dayNum += 1) {
        const date = new Date(year, month, dayNum);
        date.setHours(0, 0, 0, 0);
        const isoVal = `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
        const outOfRange = (minDate && date < minDate) || (maxDate && date > maxDate);
        const cell = document.createElement("div");
        cell.className = "date-picker-day";
        cell.textContent = String(dayNum);
        if (isoVal === selectedIso) cell.classList.add("dp-selected");
        if (outOfRange) {
          cell.classList.add("dp-disabled");
        } else {
          cell.addEventListener("click", (event) => {
            event.stopPropagation();
            closePopup();
            onSelect(isoVal);
          });
        }
        grid.appendChild(cell);
      }
      wrap.appendChild(grid);
      return wrap;
    }

    function buildYearGrid() {
      const minDate = isoToLocalDate(getMin());
      const maxDate = isoToLocalDate(getMax());
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
      backBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        pickerView = "days";
        rebuildCalendar();
      });
      const label = document.createElement("span");
      label.className = "date-picker-header-label";
      label.textContent = "Select Year";
      header.append(backBtn, label);
      wrap.appendChild(header);
      const grid = document.createElement("div");
      grid.className = "dp-year-grid";
      for (let year = minYear; year <= maxYear; year += 1) {
        const cell = document.createElement("div");
        cell.className = "dp-year-cell";
        if (year === pickerYear) cell.classList.add("dp-year-current");
        const yearLabel = document.createElement("span");
        yearLabel.textContent = String(year);
        const chevron = document.createElement("span");
        chevron.className = "dp-accordion-chevron";
        chevron.textContent = "\u203a";
        cell.append(yearLabel, chevron);
        cell.addEventListener("click", (event) => {
          event.stopPropagation();
          pickerView = "year";
          pickerExpandedYear = year;
          rebuildCalendar();
        });
        grid.appendChild(cell);
      }
      wrap.appendChild(grid);
      return wrap;
    }

    function buildYearAccordion() {
      const minDate = isoToLocalDate(getMin());
      const maxDate = isoToLocalDate(getMax());
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
      backBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        pickerView = "years";
        pickerExpandedYear = null;
        rebuildCalendar();
      });
      const label = document.createElement("span");
      label.className = "date-picker-header-label";
      label.textContent = "Select Month";
      header.append(backBtn, label);
      wrap.appendChild(header);
      const list = document.createElement("div");
      list.className = "dp-accordion-list";
      for (let year = minYear; year <= maxYear; year += 1) {
        const yearRow = document.createElement("div");
        yearRow.className = `dp-accordion-year${year === expandedYear ? " dp-accordion-open" : ""}`;
        const yearBtn = document.createElement("button");
        yearBtn.type = "button";
        yearBtn.className = "dp-accordion-year-btn";
        yearBtn.textContent = String(year);
        const chevron = document.createElement("span");
        chevron.className = "dp-accordion-chevron";
        chevron.textContent = "\u203a";
        yearBtn.appendChild(chevron);
        yearBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          pickerExpandedYear = pickerExpandedYear === year ? null : year;
          rebuildCalendar();
        });
        yearRow.appendChild(yearBtn);
        if (year === expandedYear) {
          const monthGrid = document.createElement("div");
          monthGrid.className = "dp-month-grid";
          monthNames.forEach((name, monthIndex) => {
            const minMonth = minDate && year === minDate.getFullYear() ? minDate.getMonth() : -1;
            const maxMonth = maxDate && year === maxDate.getFullYear() ? maxDate.getMonth() : 12;
            const disabled = monthIndex < minMonth || monthIndex > maxMonth;
            const cell = document.createElement("div");
            cell.className = `dp-month-cell${disabled ? " dp-disabled" : ""}`;
            if (year === pickerYear && monthIndex === pickerMonth) cell.classList.add("dp-month-current");
            cell.textContent = name;
            if (!disabled) {
              cell.addEventListener("click", (event) => {
                event.stopPropagation();
                pickerYear = year;
                pickerMonth = monthIndex;
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
      if (!popup || !anchorEl) return;
      const rect = anchorEl.getBoundingClientRect();
      popup.style.top = `${rect.bottom + 6}px`;
      const idealLeft = popupAlign === "left" ? rect.left : rect.right - popup.offsetWidth;
      const maxLeft = Math.max(4, window.innerWidth - popup.offsetWidth - 4);
      popup.style.left = `${Math.min(Math.max(4, idealLeft), maxLeft)}px`;
    }

    function rebuildCalendar() {
      if (!popup) return;
      const fresh = pickerView === "years" ? buildYearGrid() : pickerView === "year" ? buildYearAccordion() : buildCalendar();
      popup.replaceChildren(...fresh.childNodes);
      popup.className = fresh.className;
      requestAnimationFrame(() => {
        positionPopup();
        if (pickerView === "years") {
          const grid = popup.querySelector(".dp-year-grid");
          const selectedYear = popup.querySelector(".dp-year-current");
          if (grid && selectedYear) {
            grid.scrollTop = Math.max(0, selectedYear.offsetTop + selectedYear.offsetHeight - grid.clientHeight);
          }
        } else if (pickerView === "year") {
          const list = popup.querySelector(".dp-accordion-list");
          const openRow = popup.querySelector(".dp-accordion-year.dp-accordion-open");
          if (list && openRow) {
            const yearButton = openRow.querySelector(".dp-accordion-year-btn");
            const desiredTop = Math.max(0, (yearButton || openRow).offsetTop - 2);
            list.scrollTop = Math.min(desiredTop, Math.max(0, list.scrollHeight - list.clientHeight));
          }
        }
      });
    }

    function openPopup() {
      if (activeDatePickerClose && activeDatePickerClose !== closePopup) activeDatePickerClose();
      closeAllSelectDropdowns();
      const selectedDate = isoToLocalDate(getSelected());
      const fallbackDate = isoToLocalDate(getMax()) || new Date();
      pickerYear = (selectedDate || fallbackDate).getFullYear();
      pickerMonth = (selectedDate || fallbackDate).getMonth();
      pickerView = "days";
      pickerExpandedYear = null;
      popup = buildCalendar();
      activeDatePickerClose = closePopup;
      document.body.appendChild(popup);
      requestAnimationFrame(positionPopup);
      window.addEventListener("scroll", positionPopup, true);
      window.addEventListener("resize", positionPopup);
    }

    function closePopup() {
      if (!popup) return;
      popup.remove();
      popup = null;
      if (activeDatePickerClose === closePopup) activeDatePickerClose = null;
      window.removeEventListener("scroll", positionPopup, true);
      window.removeEventListener("resize", positionPopup);
    }

    function toggle(event) {
      event.stopPropagation();
      if (popup) closePopup();
      else openPopup();
    }

    document.addEventListener("click", closePopup);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closePopup();
    });
    return { toggle, closePopup, rebuildCalendar };
  }

  function fmtUsd(v, digits = 0) {
    if (!Number.isFinite(v)) return "";
    return `$${v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  }

  function fmtKpiUsd(v) {
    if (!Number.isFinite(v)) return "";
    return fmtUsd(v, Math.abs(v) < 1000 ? 2 : 0);
  }

  function fmtInvestedUsd(v, amount) {
    if (!Number.isFinite(v)) return "";
    const amountNumber = Number(amount);
    return fmtUsd(v, Number.isFinite(amountNumber) && Number.isInteger(amountNumber) ? 0 : 2);
  }

  function fmtElapsedYears(startIso, endIso) {
    if (!startIso || !endIso) return "";
    const years = Math.max(0, dayDiff(startIso, endIso)) / 365.25;
    return `${years.toFixed(2)} Years`;
  }

  function fmtUnits(v, unit) {
    if (!Number.isFinite(v)) return "";
    const digits = v >= 100 ? 2 : v >= 1 ? 4 : 6;
    return `${v.toLocaleString("en-US", { maximumFractionDigits: digits })} ${unit}`;
  }

  function assetUnitPhrase(code) {
    if (code === "BTC") return "BTC";
    if (code === "XAU") return "oz gold";
    if (code === "XAG") return "oz silver";
    return ASSETS[code]?.label || code;
  }

  function normalizeAssetCode(code) {
    return LEGACY_ASSET_CODES[code] || code;
  }

  function fmtCrossUnits(value, code) {
    if (!Number.isFinite(value)) return "";
    const digits = code === "BTC" ? 8 : 2;
    return `${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${assetUnitPhrase(code)}`;
  }

  function fmtDcaUnits(value, code) {
    if (!Number.isFinite(value)) return "";
    const digits = code === "BTC" ? 8 : 2;
    return `${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${code === "BTC" ? "BTC" : assetUnitPhrase(code)}`;
  }

  function fmtAxisUsd(v) {
    if (!Number.isFinite(v)) return "";
    if (Math.abs(v) < 1e-9) return "$0";
    if (v < 0) return "";
    if (v >= 1000) return fmtUsdCompactTick(v);
    if (v >= 100) return fmtUsd(v, 0);
    if (v >= 10) return trimUsdLabel(fmtUsd(v, 1));
    return trimUsdLabel(fmtUsd(v, 2));
  }

  function trimUsdLabel(label) {
    return String(label || "")
      .replace(/(\.\d*?[1-9])0+$/, "$1")
      .replace(/\.0+$/, "");
  }

  function fmtUsdCompactTick(value) {
    if (!Number.isFinite(value) || value < 0) return "$0";
    if (value >= 1000000000000) {
      const t = value / 1000000000000;
      return `$${(t >= 10 ? t.toFixed(0) : t.toFixed(1)).replace(/\.0$/, "")}T`;
    }
    if (value >= 1000000000) {
      const b = value / 1000000000;
      return `$${(b >= 10 ? b.toFixed(0) : b.toFixed(1)).replace(/\.0$/, "")}B`;
    }
    if (value >= 1000000) {
      const m = value / 1000000;
      return `$${(m >= 10 ? m.toFixed(0) : m.toFixed(1)).replace(/\.0$/, "")}M`;
    }
    const k = value / 1000;
    return `$${(k >= 100 ? k.toFixed(0) : k >= 10 ? k.toFixed(1) : k.toFixed(2)).replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1")}k`;
  }

  function formatCompactUsdAxisLabel(value) {
    if (!Number.isFinite(value) || value < 0) return "$0";
    if (value === 0) return "$0";
    if (value >= 1000) return fmtUsdCompactTick(value);
    if (value >= 100) return fmtUsd(value, 0);
    if (value >= 10) return trimUsdLabel(fmtUsd(value, 1));
    if (value >= 1) return trimUsdLabel(fmtUsd(value, value < 2 ? 3 : 2));
    const cents = value * 100;
    if (cents >= 1) return `${cents.toFixed(cents >= 10 ? 1 : 2).replace(/\.0$/, "")}¢`;
    return `$${value.toFixed(Math.min(8, Math.max(3, -Math.floor(Math.log10(Math.max(value, 1e-30))) + 1)))}`;
  }

  function formatUsdAxisTickLabels(values) {
    const tickvals = Array.isArray(values) ? values.filter((value) => Number.isFinite(value)) : [];
    if (!tickvals.length) return [];
    const baseLabels = tickvals.map((value) => formatCompactUsdAxisLabel(value));
    if (new Set(baseLabels).size === baseLabels.length) return baseLabels;

    const finiteSorted = tickvals.slice().sort((a, b) => a - b);
    let minStep = Infinity;
    for (let index = 1; index < finiteSorted.length; index += 1) {
      const delta = Math.abs(finiteSorted[index] - finiteSorted[index - 1]);
      if (delta > 0) minStep = Math.min(minStep, delta);
    }
    const neededDecimals = Number.isFinite(minStep) && minStep > 0
      ? Math.max(0, Math.min(8, Math.ceil(-Math.log10(minStep)) + 1))
      : 2;
    const maxDecimals = Math.max(neededDecimals, 2);
    for (let decimals = 1; decimals <= maxDecimals; decimals += 1) {
      const labels = tickvals.map((value) => `$${value.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}`);
      if (new Set(labels).size === labels.length) return labels;
    }
    return tickvals.map((value) => `$${value.toLocaleString("en-US", {
      minimumFractionDigits: maxDecimals,
      maximumFractionDigits: maxDecimals,
    })}`);
  }

  function buildLinearTicks(min, max, count = 5) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
    const targetCount = Math.max(3, count);
    if (Math.abs(max - min) < 1e-12) {
      const scale = Math.max(Math.abs(min), Math.abs(max), LOG_MIN_POSITIVE);
      const epsilon = Math.max(scale * 1e-6, Number.EPSILON * scale * 16);
      const start = min - epsilon;
      const end = max + epsilon;
      return Array.from({ length: targetCount }, (_, index) => start + (((end - start) * index) / (targetCount - 1)));
    }

    const rawStep = (max - min) / (targetCount - 1);
    const exponent = Math.floor(Math.log10(Math.abs(rawStep)));
    const niceBases = [1, 2, 2.5, 5, 10];
    const stepCandidates = [];
    for (let exp = exponent - 3; exp <= exponent + 3; exp += 1) {
      const scale = 10 ** exp;
      niceBases.forEach((base) => stepCandidates.push(base * scale));
    }
    stepCandidates.sort((a, b) => a - b);

    let candidateIndex = stepCandidates.findIndex((step) => step >= rawStep);
    if (candidateIndex < 0) candidateIndex = stepCandidates.length - 1;
    const buildTicksForStep = (step) => {
      const valueScale = Math.max(Math.abs(min), Math.abs(max), LOG_MIN_POSITIVE);
      const eps = Math.max(Math.abs(step) * 1e-9, valueScale * 1e-12, Number.EPSILON * valueScale * 16);
      const start = Math.ceil((min - eps) / step) * step;
      const end = Math.floor((max + eps) / step) * step;
      const ticks = [];
      for (let value = start; value <= end + eps; value += step) ticks.push(Number(value.toPrecision(15)));
      return ticks;
    };
    let ticks = buildTicksForStep(stepCandidates[candidateIndex]);
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
    return ticks.length >= 3
      ? ticks
      : Array.from({ length: targetCount }, (_, index) => min + (((max - min) * index) / (targetCount - 1)));
  }

  function buildLogTicks(min, max) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) return [];
    const minLog = Math.log10(min);
    const maxLog = Math.log10(max);
    const span = maxLog - minLog;
    if (span < 1) {
      const linearTicks = buildLinearTicks(min, max, 6).filter((value) => value > 0).sort((a, b) => a - b);
      return linearTicks.length >= 3 ? linearTicks : buildLinearTicks(min, max, 4).filter((value) => value > 0);
    }

    const factors = span >= 3 ? [1] : span >= 2 ? [1, 5] : [1, 2, 5];
    const ticks = [];
    for (let exp = Math.floor(minLog); exp <= Math.ceil(maxLog); exp += 1) {
      const base = 10 ** exp;
      factors.forEach((factor) => {
        const value = factor * base;
        if (value >= min && value <= max) ticks.push(Number(value.toPrecision(15)));
      });
    }
    const uniqueTicks = Array.from(new Set(ticks)).sort((a, b) => a - b);
    return uniqueTicks.length >= 3 ? uniqueTicks : buildLinearTicks(min, max, 4).filter((value) => value > 0);
  }

  function buildLinearYAxisConfig(values, tickCount = 8, options = {}) {
    const safeValues = values.filter((value) => Number.isFinite(value) && value >= 0);
    const minRequiredMax = Math.max(0, Number(options.minMaxValue) || 0);
    if (!safeValues.length) {
      const max = Math.max(10, minRequiredMax);
      const tickvals = buildLinearTicks(0, max, tickCount);
      return { min: 0, max, tickvals, ticktext: formatUsdAxisTickLabels(tickvals) };
    }
    const dataMax = Math.max(...safeValues);
    const targetMax = Math.max(dataMax, minRequiredMax, 1);
    const min = 0;
    const max = Math.max(targetMax * 1.02, minRequiredMax);
    let tickvals = buildLinearTicks(min, max, tickCount);
    tickvals = tickvals.filter((value) => value >= 0);
    if (!tickvals.some((value) => Math.abs(value) < 1e-9)) tickvals.unshift(0);
    if (!tickvals.length) tickvals = [0, max];
    return { min, max, tickvals, ticktext: formatUsdAxisTickLabels(tickvals) };
  }

  function buildYScaleConfig(values, scaleMode, options = {}) {
    if (scaleMode === "log") {
      const safeValues = values.filter((value) => Number.isFinite(value) && value > 0);
      if (!safeValues.length) {
        const linear = buildLinearYAxisConfig(values, undefined, options);
        return {
          ...linear,
          map(value, plotTop, plotHeight) {
            if (!Number.isFinite(value)) return NaN;
            const ratio = (value - linear.min) / Math.max(1e-9, linear.max - linear.min);
            return plotTop + ((1 - ratio) * plotHeight);
          },
        };
      }
      const dataMin = Math.min(...safeValues);
      const dataMax = Math.max(...safeValues);
      const safeMin = Math.max(dataMin, LOG_MIN_POSITIVE);
      const safeMax = Math.max(dataMax, safeMin * (1 + 1e-15));
      const logSpan = Math.log(safeMax / safeMin);
      const min = logSpan < 1e-6 ? safeMin / 1.02 : safeMin / Math.exp(Math.max(logSpan * 0.02, 1e-6));
      const max = logSpan < 1e-6 ? safeMax * 1.02 : safeMax * Math.exp(Math.max(logSpan * 0.02, 1e-6));
      const tickvals = buildLogTicks(min, max);
      const domainMinLog = Math.log10(min);
      const domainMaxLog = Math.log10(max);
      return {
        min,
        max,
        tickvals,
        ticktext: formatUsdAxisTickLabels(tickvals),
        map(value, plotTop, plotHeight) {
          if (!Number.isFinite(value) || value <= 0) return NaN;
          const ratio = (Math.log10(value) - domainMinLog) / Math.max(1e-9, domainMaxLog - domainMinLog);
          return plotTop + ((1 - ratio) * plotHeight);
        },
      };
    }

    const linear = buildLinearYAxisConfig(values, undefined, options);
    return {
      ...linear,
      map(value, plotTop, plotHeight) {
        if (!Number.isFinite(value)) return NaN;
        const ratio = (value - linear.min) / Math.max(1e-9, linear.max - linear.min);
        return plotTop + ((1 - ratio) * plotHeight);
      },
    };
  }

  function filterTicksByPixelSpacing(tickvals, ticktext, positionForValue, minSpacing, options = {}) {
    const values = Array.isArray(tickvals) ? tickvals : [];
    const text = Array.isArray(ticktext) ? ticktext : [];
    if (values.length <= 2) return { tickvals: values.slice(), ticktext: text.slice() };
    const preserveFirst = options.preserveFirst !== false;
    const preserveLast = options.preserveLast !== false;
    const kept = [];
    let lastPos = null;
    values.forEach((value, index) => {
      const pos = positionForValue(value, index);
      if (!Number.isFinite(pos)) return;
      const isFirst = index === 0;
      const isLast = index === values.length - 1;
      if ((preserveFirst && isFirst) || (preserveLast && isLast) || lastPos == null || Math.abs(pos - lastPos) >= minSpacing) {
        kept.push(index);
        lastPos = pos;
      }
    });
    if (preserveLast && kept[kept.length - 1] !== values.length - 1) kept.push(values.length - 1);
    const uniqueKept = Array.from(new Set(kept)).sort((left, right) => left - right);
    return {
      tickvals: uniqueKept.map((index) => values[index]),
      ticktext: uniqueKept.map((index) => text[index]),
    };
  }

  function getResponsiveChartLabelSizes(width = window.innerWidth) {
    const safeWidth = Number.isFinite(width) ? width : window.innerWidth;
    const progress = Math.max(0, Math.min(1, (safeWidth - 420) / 900));
    const tick = 12 + (progress * 6);
    return {
      tick: Number(tick.toFixed(2)),
      yTick: Number(tick.toFixed(2)),
    };
  }

  function drawChartLegend(ctx, items, xStart, y, fontSize) {
    const swatchWidth = Math.max(22, Math.round(fontSize * 1.6));
    const swatchStroke = Math.max(3, fontSize * 0.22);
    const itemGap = Math.max(18, Math.round(fontSize * 1.15));
    const textGap = Math.max(7, Math.round(fontSize * 0.45));
    let x = xStart;
    ctx.save();
    ctx.font = `400 ${fontSize}px ${CHART_MONO_FONT}`;
    ctx.textBaseline = "middle";
    items.forEach((item) => {
      ctx.beginPath();
      ctx.strokeStyle = item.color;
      ctx.lineWidth = swatchStroke;
      ctx.lineCap = "round";
      ctx.moveTo(x, y);
      ctx.lineTo(x + swatchWidth, y);
      ctx.stroke();
      const textX = x + swatchWidth + textGap;
      ctx.fillStyle = item.textColor;
      ctx.textAlign = "left";
      ctx.fillText(item.label, textX, y);
      x = textX + ctx.measureText(item.label).width + itemGap;
    });
    ctx.restore();
  }

  function syncCustomLegend(items) {
    if (!el.chartLegend) return;
    el.chartLegend.innerHTML = items.map((item) => {
      const swatchClass = item.dashed ? "legend-swatch dashed" : "legend-swatch";
      const swatchStyle = item.dashed
        ? `color: ${item.color};`
        : `background: ${item.color};`;
      return `<span class="legend-item"><span class="${swatchClass}" style="${swatchStyle}"></span>${escapeHtml(item.label)}</span>`;
    }).join("");
  }

  function roundRectPath(ctx, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawCenteredSegments(ctx, segments, centerX, y, font, baseline = "middle", maxWidth = Infinity) {
    const fitFont = (baseFont) => {
      ctx.textAlign = "left";
      ctx.font = baseFont;
      if (!Number.isFinite(maxWidth) || maxWidth <= 0) return baseFont;
      const measured = segments.reduce((sum, segment) => sum + ctx.measureText(segment.text).width, 0);
      if (measured <= maxWidth) return baseFont;
      const match = String(baseFont).match(/(\d+(?:\.\d+)?)px/);
      if (!match) return baseFont;
      const currentSize = Number(match[1]);
      const nextSize = Math.max(18, currentSize * (maxWidth / measured));
      return String(baseFont).replace(/(\d+(?:\.\d+)?)px/, `${nextSize.toFixed(2)}px`);
    };
    ctx.textAlign = "left";
    ctx.font = fitFont(font);
    ctx.textBaseline = baseline;
    const totalWidth = segments.reduce((sum, segment) => sum + ctx.measureText(segment.text).width, 0);
    let x = centerX - (totalWidth / 2);
    segments.forEach((segment) => {
      ctx.fillStyle = segment.color;
      ctx.fillText(segment.text, x, y);
      x += ctx.measureText(segment.text).width;
    });
  }

  function fmtTitleUsd(value) {
    if (!Number.isFinite(value)) return "";
    return fmtUsd(value, Math.abs(value) < 1000 && !Number.isInteger(value) ? 2 : 0);
  }

  function getExportPalette(theme) {
    return theme === "light"
      ? { bg: "#ffffff", panel: "#ffffff", fg: "#1c1b19", muted: "#6f685f", border: "rgba(0, 0, 0, 0.11)", green: "#41b36b" }
      : { bg: "#000000", panel: "#000000", fg: "#f1f5f7", muted: "#95a6ae", border: "rgba(255, 255, 255, 0.14)", green: "#41b36b" };
  }

  function buildExportKpis(latest, settings) {
    const assetA = ASSETS[settings.assetA];
    const hasB = hasSecondaryAsset(settings);
    const assetB = hasB ? ASSETS[settings.assetB] : null;
    const kpis = [
      { title: `1 ${assetUnitPhrase(settings.assetA)}`, value: fmtKpiUsd(latest?.priceA), foot: hasB ? fmtCrossUnits(latest?.priceA / latest?.priceB, settings.assetB) : "", color: null },
      {
        title: `Number of ${cadenceLabel(settings.cadence)}`,
        value: latest?.count?.toLocaleString?.("en-US") || "",
        foot: fmtElapsedYears(settings.dcaStart, latest?.date),
        color: null,
      },
      { title: "Amount Invested", value: fmtInvestedUsd(latest?.invested, settings.amount), foot: "", color: "green" },
      { title: `${assetA.label} DCA Value`, value: fmtKpiUsd(latest?.valueA), foot: fmtDcaUnits(latest?.unitsA, settings.assetA), color: assetA.color },
    ];
    if (hasB) {
      kpis.splice(1, 0, { title: `1 ${assetUnitPhrase(settings.assetB)}`, value: fmtKpiUsd(latest?.priceB), foot: fmtCrossUnits(latest?.priceB / latest?.priceA, settings.assetA), color: null });
      kpis.push({ title: `${assetB.label} DCA Value`, value: fmtKpiUsd(latest?.valueB), foot: fmtDcaUnits(latest?.unitsB, settings.assetB), color: assetB.color });
    }
    return kpis;
  }

  function drawExportKpiCards(ctx, kpis, layout, palette) {
    const { x, y, width } = layout;
    const gap = 8;
    const columns = kpis.length <= 4 ? (width < 900 ? 2 : 4) : (width < 900 ? 3 : 6);
    const rows = Math.ceil(kpis.length / columns);
    const cardH = width < 900 ? 76 : 70;
    const cardW = (width - (gap * (columns - 1))) / columns;
    const titleFontSize = 12;
    const valueFontSize = 21;
    const footFontSize = 12;
    const titleLineH = 14;
    const valueLineH = 24;
    const footLineH = 14;
    const valueGap = 3;
    const textBlockH = titleLineH + valueGap + valueLineH + valueGap + footLineH;
    const textTop = Math.max(0, (cardH - textBlockH) / 2);
    const titleY = textTop + titleLineH / 2;
    const valueY = textTop + titleLineH + valueGap + valueLineH / 2;
    const footY = textTop + titleLineH + valueGap + valueLineH + valueGap + footLineH / 2;
    ctx.textAlign = "center";
    kpis.forEach((kpi, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const cardX = x + col * (cardW + gap);
      const cardY = y + row * (cardH + gap);
      ctx.font = `400 ${titleFontSize}px ${CHART_MONO_FONT}`;
      ctx.fillStyle = palette.muted;
      ctx.textBaseline = "middle";
      ctx.fillText(kpi.title || "", cardX + cardW / 2, cardY + titleY);
      ctx.font = `700 ${valueFontSize}px ${CHART_MONO_FONT}`;
      ctx.fillStyle = kpi.color === "green" ? palette.green : (kpi.color || palette.fg);
      ctx.fillText(kpi.value || "", cardX + cardW / 2, cardY + valueY);
      ctx.font = `400 ${footFontSize}px ${CHART_MONO_FONT}`;
      ctx.fillStyle = palette.muted;
      ctx.fillText(kpi.foot || "", cardX + cardW / 2, cardY + footY);
    });
    return { height: rows * cardH + (rows - 1) * gap };
  }

  function drawExportFrame(canvas, iso, settings, outputDimensions = getExportDimensions(settings)) {
    const ctx = canvas.getContext("2d");
    const { width, height } = getExportBaseDimensions(settings);
    const outputWidth = Math.round(outputDimensions.width || width);
    const outputHeight = Math.round(outputDimensions.height || height);
    const dpr = Math.max(1, outputWidth / width, outputHeight / height);
    if (canvas.width !== outputWidth) canvas.width = outputWidth;
    if (canvas.height !== outputHeight) canvas.height = outputHeight;
    const theme = settings.theme || getTheme();
    const palette = getExportPalette(theme);
    const assetA = ASSETS[settings.assetA];
    const hasB = hasSecondaryAsset(settings);
    const assetB = hasB ? ASSETS[settings.assetB] : null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, width, height);

    const margin = width < 900 ? 18 : 24;
    const titleY = 28;
    const titleSegments = [
      { text: fmtTitleUsd(settings.amount), color: palette.green },
      { text: ` ${cadencePhrase(settings.cadence)}: `, color: palette.fg },
      { text: assetA.label, color: assetA.color },
    ];
    if (hasB) {
      titleSegments.push(
        { text: " vs ", color: palette.fg },
        { text: assetB.label, color: assetB.color },
      );
    }
    drawCenteredSegments(ctx, titleSegments, width / 2, titleY, `700 ${width < 900 ? 20 : 26}px ${getComputedStyle(document.body).fontFamily}`, "middle", width - 96);

    const latest = buildSeries(iso, settings).at(-1);
    const kpiY = 48;
    const kpiMetrics = drawExportKpiCards(ctx, buildExportKpis(latest, settings), {
      x: margin,
      y: kpiY,
      width: width - margin * 2,
    }, palette);
    const footerH = Math.max(34, Math.round(Math.min(width, height) * 0.052));
    const chartTop = kpiY + kpiMetrics.height;
    const chartArea = {
      x: margin,
      y: chartTop,
      width: width - margin * 2,
      height: Math.max(220, height - chartTop - footerH),
    };
    drawChart(canvas, iso, {
      export: true,
      width,
      height,
      dpr,
      scale: settings.scale,
      theme,
      settings,
      chartArea,
      skipBackground: true,
      skipExportFooter: true,
    });
    ctx.fillStyle = palette.muted;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const footerTextSize = Math.max(20, Math.round(footerH * 0.6));
    const footerCenterY = height - footerH * 0.68;
    ctx.font = `500 ${footerTextSize}px ${CHART_MONO_FONT}`;
    ctx.fillText("https://wickedsmartbitcoin.com/dca_comparison", width / 2, footerCenterY);
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = total % 60;
    if (hours) return `${hours}h ${minutes}m ${rest}s`;
    return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
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

  function getShareRouteBaseUrl() {
    const path = String(window.location.pathname || "");
    const dashboardMatch = path.match(/^(.*)\/webapps\/dca_comparison\/dashboard\.html$/i);
    const basePath = dashboardMatch ? (dashboardMatch[1] || "") : path.replace(/\/[^/]*$/, "");
    if (IS_LOCAL_RUNTIME) return `${window.location.origin}${basePath}/dca_comparison.html`;
    return `${window.location.origin}${basePath}/dca_comparison`;
  }

  function setButtonIcon(iconId, svgMarkup) {
    const icon = document.getElementById(iconId);
    if (!icon || !svgMarkup) return;
    icon.outerHTML = svgMarkup.replace("<svg ", `<svg id="${iconId}" `);
  }

  function captureShareState() {
    return {
      dcaStart: state.settings.dcaStart,
      rangeStart: state.settings.rangeStart,
      rangeEnd: state.settings.rangeEnd,
      cadence: state.settings.cadence,
      amount: state.settings.amount,
      assetA: state.settings.assetA,
      assetB: state.settings.assetB,
      preset: state.settings.preset,
      speed: state.settings.speed,
      scale: state.settings.scale,
      currentIso: state.currentIso,
    };
  }

  function getDefaultDashboardState() {
    const endIso = state.maxIso || "";
    const startIso = endIso
      ? clampIso(normalizeCadenceStartIso(getPresetStartIso(DEFAULTS.preset, endIso), DEFAULTS.cadence), state.minIso, state.maxIso)
      : "";
    return {
      ...DEFAULTS,
      dcaStart: startIso,
      rangeStart: startIso,
      rangeEnd: endIso,
      currentIso: endIso,
    };
  }

  function captureResetSnapshot() {
    return captureShareState();
  }

  function statesMatch(current, defaults) {
    return current.dcaStart === defaults.dcaStart
      && current.rangeStart === defaults.rangeStart
      && current.rangeEnd === defaults.rangeEnd
      && current.cadence === defaults.cadence
      && Number(current.amount) === Number(defaults.amount)
      && current.assetA === defaults.assetA
      && current.assetB === defaults.assetB
      && current.preset === defaults.preset
      && Number(current.speed) === Number(defaults.speed)
      && current.scale === defaults.scale
      && current.currentIso === defaults.currentIso;
  }

  function isDefaultState() {
    return statesMatch(captureResetSnapshot(), getDefaultDashboardState());
  }

  function updateResetButtonUi() {
    const btn = el.resetBtn || document.getElementById("resetDashboard");
    if (!btn) return;
    const labelEl = btn.querySelector(".btn-label");
    if (preResetStateSnapshot) {
      if (labelEl) labelEl.textContent = "Undo Restore";
      else btn.textContent = "Undo Restore";
      setButtonIcon("resetDashboardIcon", ICONS.resetUndo);
      btn.classList.add("reset-dashboard-btn--undo");
      btn.setAttribute("aria-label", "Undo the last restore defaults action");
      btn.dataset.tooltip = "Undo the last restore defaults action";
      btn.title = "Undo the last restore defaults action";
      btn.disabled = false;
      return;
    }

    if (labelEl) labelEl.textContent = "Restore Defaults";
    else btn.textContent = "Restore Defaults";
    setButtonIcon("resetDashboardIcon", ICONS.resetDefaults);
    btn.classList.remove("reset-dashboard-btn--undo");
    btn.setAttribute("aria-label", "Restore dashboard defaults");
    btn.dataset.tooltip = "Reset dashboard to defaults";
    btn.title = "Reset dashboard to defaults";
    btn.disabled = isDefaultState();
  }

  function clearPreResetSnapshot() {
    if (preResetStateSnapshot) preResetStateSnapshot = null;
    updateResetButtonUi();
  }

  function restoreResetSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    stopAnimation(false);
    state.settings = { ...DEFAULTS, ...snapshot };
    state.currentIso = typeof snapshot.currentIso === "string" ? snapshot.currentIso : state.settings.rangeEnd;
    normalizeSettings();
    render();
  }

  function restoreDashboardDefaults() {
    preResetStateSnapshot = captureResetSnapshot();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {
      // Ignore storage failures.
    }
    restoreResetSnapshot(getDefaultDashboardState());
    updateResetButtonUi();
  }

  function restorePreviousDashboardState() {
    if (!preResetStateSnapshot) return;
    const snapshot = preResetStateSnapshot;
    preResetStateSnapshot = null;
    restoreResetSnapshot(snapshot);
    updateResetButtonUi();
  }

  function buildShareableDashboardUrl() {
    const defaults = getDefaultDashboardState();
    const payload = captureShareState();
    const compactPayload = {};
    Object.entries(payload).forEach(([key, value]) => {
      if (value === defaults[key]) return;
      if (value === "" || value === null || value === undefined) return;
      compactPayload[key] = value;
    });
    const shareUrl = new URL(getShareRouteBaseUrl());
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
    if (buttonEl.__copyFeedbackTimer) window.clearTimeout(buttonEl.__copyFeedbackTimer);
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

  function getExportDimensions(settings = state.settings) {
    const quality = Number(settings.quality) || DEFAULTS.quality;
    if (settings.orientation === "portrait") return { width: quality, height: Math.round(quality * 16 / 9) };
    if (settings.orientation === "square") return { width: quality, height: quality };
    return { width: Math.round(quality * 16 / 9), height: quality };
  }

  function getExportBaseDimensions(settings = state.settings) {
    if (settings.orientation === "portrait") return { width: 720, height: 1280 };
    if (settings.orientation === "square") return { width: 960, height: 960 };
    return { width: 1280, height: 720 };
  }

  function getExportReferenceDimensions(settings = state.settings) {
    return getExportDimensions({ ...settings, quality: 1440 });
  }

  function getExportChartLineWidth(settings = state.settings) {
    const base = getExportBaseDimensions(settings);
    const reference = getExportReferenceDimensions(settings);
    const scale = Math.min(
      base.width / Math.max(1, reference.width),
      base.height / Math.max(1, reference.height),
    );
    return EXPORT_REFERENCE_CHART_LINE_WIDTH * scale;
  }

  function getSelectedDownloadSetting(groupId, fallback) {
    const group = document.getElementById(groupId);
    const selected = group?.querySelector(".download-setting-option.is-selected[data-value]");
    return selected?.dataset.value || fallback;
  }

  function getExportSettingsSnapshot() {
    const settings = { ...state.settings };
    const exportSettings = { ...DEFAULT_EXPORT_SETTINGS, ...state.exportSettings };
    settings.scale = getSelectedDownloadSetting("downloadScaleSelect", exportSettings.scale);
    settings.orientation = getSelectedDownloadSetting("downloadOrientationSelect", exportSettings.orientation);
    settings.quality = Number(getSelectedDownloadSetting("downloadQualitySelect", exportSettings.quality)) || exportSettings.quality;
    settings.speed = Number(getSelectedDownloadSetting("downloadSpeedSelect", exportSettings.speed)) || exportSettings.speed;
    settings.theme = getSelectedDownloadSetting("downloadThemeSelect", exportSettings.theme || getTheme());
    settings.endFrameHold = !!el.downloadEndFrameHoldToggle?.checked;
    settings.scale = ["linear", "log"].includes(settings.scale) ? settings.scale : DEFAULTS.scale;
    settings.orientation = ["landscape", "portrait", "square"].includes(settings.orientation) ? settings.orientation : DEFAULTS.orientation;
    settings.quality = [720, 1080, 1440, 2160].includes(Number(settings.quality)) ? Number(settings.quality) : DEFAULTS.quality;
    settings.speed = SPEEDS.includes(Number(settings.speed)) ? Number(settings.speed) : DEFAULTS.speed;
    settings.theme = ["light", "dark"].includes(settings.theme) ? settings.theme : getTheme();
    return settings;
  }

  function normalizeExportSettings() {
    const s = state.exportSettings;
    s.scale = ["linear", "log"].includes(s.scale) ? s.scale : DEFAULT_EXPORT_SETTINGS.scale;
    s.orientation = ["landscape", "portrait", "square"].includes(s.orientation) ? s.orientation : DEFAULT_EXPORT_SETTINGS.orientation;
    s.quality = [720, 1080, 1440, 2160].includes(Number(s.quality)) ? Number(s.quality) : DEFAULT_EXPORT_SETTINGS.quality;
    s.speed = SPEEDS.includes(Number(s.speed)) ? Number(s.speed) : DEFAULT_EXPORT_SETTINGS.speed;
    s.theme = ["light", "dark"].includes(s.theme) ? s.theme : getTheme();
    s.endFrameHold = s.endFrameHold !== false;
  }

  function getFrameDates(settings = state.settings) {
    const start = settings.rangeStart;
    const end = settings.rangeEnd;
    const speed = Math.max(0.5, Number(settings.speed) || 1);
    const totalDays = Math.max(0, dayDiff(start, end));
    const dates = [];
    const step = speed >= 1 ? speed : 1;
    const repeats = speed < 1 ? Math.round(1 / speed) : 1;

    for (let i = 0; i <= totalDays; i += step) {
      const iso = addDays(start, Math.round(i));
      for (let repeat = 0; repeat < repeats; repeat += 1) dates.push(iso);
    }
    if (dates[dates.length - 1] !== end) dates.push(end);
    if (settings.endFrameHold) {
      return [
        ...Array(EXPORT_START_HOLD_FRAMES).fill(end),
        ...dates,
        ...Array(EXPORT_END_HOLD_FRAMES).fill(end),
      ];
    }
    return dates;
  }

  function getExportSeconds(settings = state.settings) {
    return getFrameDates(settings).length / EXPORT_FPS;
  }

  function getExportBitrate(settings = state.settings) {
    const { width, height } = getExportDimensions(settings);
    return Math.max(4_000_000, Math.round(width * height * EXPORT_FPS * 0.16));
  }

  function hasDeterministicExportSupport() {
    return !!(window.VideoEncoder && window.VideoFrame && typeof VideoEncoder.isConfigSupported === "function");
  }

  function getDownloadEstimateCalibrationKey(settings, frameDates) {
    const { width, height } = getExportDimensions(settings);
    return [
      settings.assetA,
      settings.assetB,
      settings.cadence,
      settings.amount,
      settings.rangeStart,
      settings.rangeEnd,
      settings.scale,
      settings.orientation,
      settings.quality,
      settings.speed,
      settings.theme,
      settings.endFrameHold ? 1 : 0,
      width,
      height,
      frameDates.length,
      new Set(frameDates).size,
    ].join("|");
  }

  function getRepresentativeExportFrameDates(frameDates) {
    const uniqueDates = Array.from(new Set(frameDates));
    if (uniqueDates.length <= 3) return uniqueDates;
    return [
      uniqueDates[0],
      uniqueDates[Math.floor((uniqueDates.length - 1) / 2)],
      uniqueDates[uniqueDates.length - 1],
    ];
  }

  async function calibrateDownloadEstimate(settings, frameDates, key) {
    if (state.isExporting || downloadEstimateCalibrationCache.has(key) || downloadEstimateCalibrationPending.has(key)) return;
    downloadEstimateCalibrationPending.add(key);
    const requestId = ++downloadEstimateCalibrationRequestId;
    const representativeDates = getRepresentativeExportFrameDates(frameDates);
    if (!representativeDates.length) {
      downloadEstimateCalibrationPending.delete(key);
      return;
    }

    try {
      await document.fonts?.ready;
      if (requestId !== downloadEstimateCalibrationRequestId) return;
      const dimensions = getExportDimensions(settings);
      const canvas = document.createElement("canvas");
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      if (!canvas.getContext("2d")) return;
      const started = performance.now();
      for (const iso of representativeDates) {
        if (requestId !== downloadEstimateCalibrationRequestId) return;
        drawExportFrame(canvas, iso, settings, dimensions);
      }
      const msPerFrame = (performance.now() - started) / representativeDates.length;
      if (!Number.isFinite(msPerFrame) || msPerFrame <= 0) return;
      downloadEstimateCalibrationCache.set(key, { msPerFrame });
      if (requestId === downloadEstimateCalibrationRequestId) updateDownloadEstimates();
    } catch (error) {
      console.warn("Unable to calibrate DCA comparison export estimate.", error);
    } finally {
      downloadEstimateCalibrationPending.delete(key);
    }
  }

  function scheduleDownloadEstimateCalibration(settings, frameDates, key) {
    if (downloadEstimateCalibrationCache.has(key) || downloadEstimateCalibrationPending.has(key)) return;
    if (downloadEstimateCalibrationTimer) {
      window.clearTimeout(downloadEstimateCalibrationTimer);
      downloadEstimateCalibrationTimer = null;
    }
    downloadEstimateCalibrationTimer = window.setTimeout(() => {
      downloadEstimateCalibrationTimer = null;
      calibrateDownloadEstimate({ ...settings }, [...frameDates], key);
    }, 180);
  }

  function updateDownloadEstimates() {
    if (!el.downloadEstimateSize || !el.downloadEstimateLength || !el.downloadEstimateTime) return;
    const settings = getExportSettingsSnapshot();
    const { width, height } = getExportDimensions(settings);
    const seconds = getExportSeconds(settings);
    const frames = getFrameDates(settings);
    const frameCount = Math.max(1, frames.length);
    const megapixels = Math.max(1, (width * height) / (1280 * 720));
    const calibrationKey = getDownloadEstimateCalibrationKey(settings, frames);
    const calibration = downloadEstimateCalibrationCache.get(calibrationKey);
    const deterministicExport = hasDeterministicExportSupport();
    const estimatedMb = Math.max(1, Math.round((getExportBitrate(settings) * seconds) / 8_000_000));
    const fallbackFrameSeconds = deterministicExport ? 0.006 * Math.sqrt(megapixels) : 0.018 * megapixels;
    const estimatedRenderSeconds = calibration
      ? Math.max(1, (frameCount * calibration.msPerFrame) / 1000)
      : Math.max(1, frameCount * fallbackFrameSeconds);
    const estimatedTotalSeconds = deterministicExport ? estimatedRenderSeconds : seconds + estimatedRenderSeconds;
    el.downloadEstimateSize.textContent = `${estimatedMb.toLocaleString("en-US")} MB`;
    el.downloadEstimateLength.textContent = formatDuration(seconds);
    el.downloadEstimateTime.textContent = `~${formatDuration(estimatedTotalSeconds)}`;
    if (!calibration && frames.length) scheduleDownloadEstimateCalibration(settings, frames, calibrationKey);
  }

  function readStoredSettings() {
    try {
      const shareState = getDashboardShareStateFromUrl();
      if (shareState) return { ...DEFAULTS, ...shareState };
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return { ...DEFAULTS, ...(parsed.settings || parsed) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function readStoredExportSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const legacy = parsed.settings ? {} : parsed;
      return {
        ...DEFAULT_EXPORT_SETTINGS,
        ...legacy,
        ...(parsed.exportSettings || {}),
      };
    } catch {
      return { ...DEFAULT_EXPORT_SETTINGS };
    }
  }

  function readStoredPlaybackSession() {
    try {
      if (getDashboardShareStateFromUrl()) return null;
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const session = parsed.pausedPlaybackSession;
      if (
        session
        && typeof session === "object"
        && typeof session.startIso === "string"
        && typeof session.targetEndIso === "string"
        && typeof session.currentIso === "string"
      ) {
        return {
          startIso: session.startIso,
          targetEndIso: session.targetEndIso,
          currentIso: session.currentIso,
        };
      }
    } catch {
      // Ignore invalid cached playback state.
    }
    return null;
  }

  function saveSettings() {
    try {
      const hasPlaybackSession = !!(state.isPlaying || state.paused);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        settings: state.settings,
        exportSettings: state.exportSettings,
        pausedPlaybackSession: hasPlaybackSession ? {
          startIso: state.settings.rangeStart,
          targetEndIso: state.settings.rangeEnd,
          currentIso: state.currentIso,
        } : null,
      }));
    } catch {}
  }

  async function loadData() {
    const [btcText, fxText, indicesText] = await Promise.all([
      fetch("../../assets/daily_price.csv", { cache: "default" }).then((r) => r.text()),
      fetch("../uoa/webapp_data/daily_fx_rates.csv", { cache: "default" }).then((r) => r.text()),
      fetch("webapp_data/market_indices.csv", { cache: "default" }).then((r) => (r.ok ? r.text() : "")).catch(() => ""),
    ]);
    const btcRows = parseCsv(btcText);
    const btcHeader = btcRows.shift();
    const fxRows = parseCsv(fxText);
    const fxHeader = fxRows.shift();
    const indexRows = indicesText ? parseCsv(indicesText) : [];
    const indexHeader = indexRows.length ? indexRows.shift() : [];
    const btcDateIdx = btcHeader.indexOf("date");
    const btcPriceIdx = btcHeader.indexOf("price");
    const fxDateIdx = fxHeader.indexOf("date");
    const xagIdx = fxHeader.indexOf("xagusd");
    const xauIdx = fxHeader.indexOf("xauusd");
    const indexDateIdx = indexHeader.indexOf("date");
    const spyIdx = indexHeader.indexOf("spy");
    const qqqIdx = indexHeader.indexOf("qqq");
    const tltIdx = indexHeader.indexOf("tlt");
    const mstrIdx = indexHeader.indexOf("mstr");
    const byDate = new Map();
    const ensureRow = (iso) => {
      if (!iso) return null;
      let row = byDate.get(iso);
      if (!row) {
        row = { date: iso };
        byDate.set(iso, row);
      }
      return row;
    };
    for (const r of btcRows) {
      const iso = isoFromMaybeUsDate(r[btcDateIdx]);
      const price = Number(r[btcPriceIdx]);
      if (iso && Number.isFinite(price) && price > 0) ensureRow(iso).BTC = price;
    }
    for (const r of fxRows) {
      const iso = isoFromMaybeUsDate(r[fxDateIdx]);
      const target = ensureRow(iso);
      if (!target) continue;
      const xag = Number(r[xagIdx]);
      const xau = Number(r[xauIdx]);
      if (Number.isFinite(xag) && xag > 0) target.XAG = xag;
      if (Number.isFinite(xau) && xau > 0) target.XAU = xau;
    }
    for (const r of indexRows) {
      const iso = isoFromMaybeUsDate(r[indexDateIdx]);
      const target = ensureRow(iso);
      if (!target) continue;
      const spy = Number(r[spyIdx]);
      const qqq = Number(r[qqqIdx]);
      const tlt = Number(r[tltIdx]);
      const mstr = Number(r[mstrIdx]);
      if (Number.isFinite(spy) && spy > 0) target.SPY = spy;
      if (Number.isFinite(qqq) && qqq > 0) target.QQQ = qqq;
      if (Number.isFinite(tlt) && tlt > 0) target.TLT = tlt;
      if (Number.isFinite(mstr) && mstr > 0) target.MSTR = mstr;
    }
    state.rows = [...byDate.values()]
      .filter((r) => Object.keys(ASSETS).some((asset) => Number.isFinite(r[asset]) && r[asset] > 0))
      .sort((a, b) => a.date.localeCompare(b.date));
    state.byDate = new Map(state.rows.map((r) => [r.date, r]));
    state.minIso = state.rows[0]?.date || "";
    state.maxIso = state.rows[state.rows.length - 1]?.date || "";
    state.assetBounds = {};
    Object.keys(ASSETS).forEach((asset) => {
      const assetRows = state.rows.filter((r) => Number.isFinite(r[asset]) && r[asset] > 0);
      if (assetRows.length) {
        state.assetBounds[asset] = {
          minIso: assetRows[0].date,
          maxIso: assetRows[assetRows.length - 1].date,
        };
      }
    });
  }

  function normalizeSettings() {
    const s = state.settings;
    s.assetA = normalizeAssetCode(s.assetA);
    s.assetB = normalizeAssetCode(s.assetB);
    s.assetA = ASSETS[s.assetA] ? s.assetA : DEFAULTS.assetA;
    s.assetB = s.assetB === NO_SECONDARY_ASSET || ASSETS[s.assetB] ? s.assetB : DEFAULTS.assetB;
    if (s.assetA === s.assetB) s.assetB = s.assetA === "BTC" ? "XAU" : "BTC";
    s.amount = Math.max(1, Number(s.amount) || DEFAULTS.amount);
    s.cadence = ["daily", "weekly", "monthly"].includes(s.cadence) ? s.cadence : DEFAULTS.cadence;
    s.speed = SPEEDS.includes(Number(s.speed)) ? Number(s.speed) : 1;
    s.quality = [720, 1080, 1440, 2160].includes(Number(s.quality)) ? Number(s.quality) : DEFAULTS.quality;
    s.scale = ["linear", "log"].includes(s.scale) ? s.scale : DEFAULTS.scale;
    s.orientation = ["landscape", "portrait", "square"].includes(s.orientation) ? s.orientation : DEFAULTS.orientation;
    s.theme = ["light", "dark"].includes(s.theme) ? s.theme : getTheme();
    s.endFrameHold = s.endFrameHold !== false;
    s.preset = ["", "ytd", "1y", "2y", "4y", "8y", "full"].includes(s.preset) ? s.preset : "";
    if (s.preset) {
      s.rangeEnd = getLatestPresetEndIso(s);
      s.rangeStart = getPresetStartIso(s.preset, s.rangeEnd);
      state.desiredRangeStart = s.rangeStart;
      state.desiredRangeEnd = s.rangeEnd;
    }
    const available = getActiveAvailableBounds();
    if (!state.desiredRangeStart) state.desiredRangeStart = s.rangeStart || s.dcaStart || available.minIso;
    if (!state.desiredRangeEnd) state.desiredRangeEnd = s.rangeEnd || available.maxIso;
    s.rangeStart = clampIso(s.rangeStart || s.dcaStart, available.minIso, available.maxIso);
    s.rangeEnd = clampIso(s.rangeEnd || available.maxIso, available.minIso, available.maxIso);
    s.rangeStart = clampIso(normalizeCadenceStartIso(s.rangeStart, s.cadence), available.minIso, available.maxIso);
    if (s.rangeStart > s.rangeEnd) {
      s.rangeEnd = clampIso(s.rangeStart, available.minIso, available.maxIso);
    }
    if (s.rangeStart > s.rangeEnd) s.rangeStart = s.rangeEnd;
    s.preset = inferRangePreset(s.rangeStart, s.rangeEnd);
    s.dcaStart = s.rangeStart;
    state.currentIso = clampIso(state.currentIso || s.rangeEnd, s.rangeStart, s.rangeEnd);
  }

  function setRangeTrackSegment(segmentEl, fromIso, toIso, visualBounds) {
    if (!segmentEl || !fromIso || !toIso || fromIso >= toIso) {
      segmentEl?.classList.remove("active");
      if (segmentEl) {
        segmentEl.style.left = "0";
        segmentEl.style.right = "100%";
      }
      return;
    }
    const startIdx = findDateIndexByMode(fromIso, "ceil");
    const endIdx = findDateIndexByMode(toIso, "floor");
    const minIdx = findDateIndexByMode(visualBounds.minIso, "ceil");
    const maxIdx = findDateIndexByMode(visualBounds.maxIso, "floor");
    const denom = Math.max(1, maxIdx - minIdx);
    const pct = (idx) => ((Math.max(minIdx, Math.min(maxIdx, idx)) - minIdx) / denom * 100);
    segmentEl.style.left = `${pct(startIdx).toFixed(4)}%`;
    segmentEl.style.right = `calc(100% - ${pct(endIdx).toFixed(4)}%)`;
    segmentEl.classList.add("active");
  }

  function setMissingMarker(markerEl, iso, visualBounds) {
    if (!markerEl || !iso) {
      markerEl?.classList.remove("active");
      return;
    }
    const idx = findDateIndexByMode(iso, "nearest");
    const minIdx = findDateIndexByMode(visualBounds.minIso, "ceil");
    const maxIdx = findDateIndexByMode(visualBounds.maxIso, "floor");
    const denom = Math.max(1, maxIdx - minIdx);
    const pct = ((Math.max(minIdx, Math.min(maxIdx, idx)) - minIdx) / denom * 100);
    markerEl.style.left = `${pct.toFixed(4)}%`;
    markerEl.classList.add("active");
  }

  function syncControls() {
    const s = state.settings;
    const available = getActiveAvailableBounds();
    const visual = getVisualBounds();
    el.rangeStartInput.min = available.minIso; el.rangeStartInput.max = s.rangeEnd; el.rangeStartInput.value = s.rangeStart;
    el.rangeEndInput.min = s.rangeStart; el.rangeEndInput.max = available.maxIso; el.rangeEndInput.value = s.rangeEnd;
    if (el.rangeStartBtn) el.rangeStartBtn.innerHTML = datePickerButtonHtml(s.rangeStart);
    if (el.rangeEndBtn) el.rangeEndBtn.innerHTML = datePickerButtonHtml(s.rangeEnd);
    el.cadenceSelect.value = s.cadence;
    el.scaleSelect.value = s.scale;
    if (document.activeElement !== el.amountInput) el.amountInput.value = Number(s.amount).toLocaleString("en-US");
    syncAmountInputWidth();
    el.assetASelect.value = s.assetA;
    el.assetBSelect.value = s.assetB;
    syncAllSelectDropdowns();
    el.speedBtn.textContent = `${s.speed}x`;
    document.querySelectorAll("[data-range-preset]").forEach((b) => b.classList.toggle("is-active", b.dataset.rangePreset === s.preset));
    const exportSettings = state.exportSettings;
    const settingsGroups = {
      downloadScaleSelect: exportSettings.scale,
      downloadOrientationSelect: exportSettings.orientation,
      downloadQualitySelect: String(exportSettings.quality),
      downloadSpeedSelect: String(exportSettings.speed),
      downloadThemeSelect: exportSettings.theme,
    };
    Object.entries(settingsGroups).forEach(([id, value]) => {
      document.querySelectorAll(`#${id} [data-value]`).forEach((b) => {
        const selected = String(b.dataset.value) === String(value);
        b.classList.toggle("is-selected", selected);
        b.setAttribute("aria-pressed", selected ? "true" : "false");
      });
    });
    if (el.downloadEndFrameHoldToggle) el.downloadEndFrameHoldToggle.checked = !!exportSettings.endFrameHold;
    if (el.downloadPanelBtn) {
      el.downloadPanelBtn.classList.toggle("is-stop-download", state.isExporting);
      el.downloadPanelBtn.textContent = state.isExporting ? "Stop Download" : "Download Animation";
    }
    updateDownloadEstimates();
    const playbackActive = state.isPlaying || state.paused;
    el.pauseBtn.disabled = !playbackActive || state.paused;
    el.stopBtn.disabled = !state.isPlaying && !state.paused;
    el.playBtn.disabled = state.isPlaying;
    el.playBtn.classList.toggle("is-playing", state.isPlaying);
    el.pauseBtn.classList.toggle("is-paused", state.paused);

    const visualMinIdx = Math.max(0, findDateIndexByMode(visual.minIso, "ceil"));
    const visualMaxIdx = Math.max(visualMinIdx, findDateIndexByMode(visual.maxIso, "floor"));
    const startIdx = findDateIndex(s.rangeStart);
    const endIdx = findDateIndex(s.rangeEnd);
    const currentIdx = findDateIndex(state.currentIso);
    const maxIdx = visualMaxIdx;
    if (el.startSlider && el.endSlider) {
      el.startSlider.min = String(visualMinIdx); el.startSlider.max = String(visualMaxIdx); el.startSlider.value = String(startIdx);
      el.endSlider.min = String(visualMinIdx); el.endSlider.max = String(visualMaxIdx); el.endSlider.value = String(endIdx);
    }
    if (el.rangeDaysInput) {
      const days = Math.max(1, dayDiff(s.rangeStart, s.rangeEnd) + 1);
      el.rangeDaysInput.dataset.lastValidValue = String(days);
      if (document.activeElement !== el.rangeDaysInput) el.rangeDaysInput.value = days.toLocaleString("en-US");
    }
    if (el.rangeTrackWrap) {
      const denom = Math.max(1, visualMaxIdx - visualMinIdx);
      const styles = window.getComputedStyle(el.rangeTrackWrap);
      const edgePad = Number.parseFloat(styles.getPropertyValue("--slider-edge-pad")) || 0;
      const trackWidth = Math.max(1, el.rangeTrackWrap.clientWidth - edgePad * 2);
      const pct = (idx) => `${(((Math.max(visualMinIdx, Math.min(visualMaxIdx, idx)) - visualMinIdx) / denom) * 100).toFixed(4)}%`;
      const markerPos = (idx) => `${(edgePad + ((Math.max(visualMinIdx, Math.min(visualMaxIdx, idx)) - visualMinIdx) / denom) * trackWidth).toFixed(2)}px`;
      el.rangeTrackWrap.style.setProperty("--slider-start", pct(startIdx));
      el.rangeTrackWrap.style.setProperty("--slider-end", pct(endIdx));
      el.rangeTrackWrap.style.setProperty("--slider-current", pct(currentIdx));
      el.rangeTrackWrap.style.setProperty("--slider-start-marker", markerPos(startIdx));
      el.rangeTrackWrap.style.setProperty("--slider-end-marker", markerPos(endIdx));
      el.rangeTrackWrap.style.setProperty("--slider-current-marker", markerPos(currentIdx));
      setRangeTrackSegment(el.missingDataStart, visual.minIso, available.minIso, visual);
      setRangeTrackSegment(el.missingDataEnd, available.maxIso, visual.maxIso, visual);
      setRangeTrackSegment(el.missingSelectionStart, state.desiredRangeStart, available.minIso, visual);
      setRangeTrackSegment(el.missingSelectionEnd, available.maxIso, state.desiredRangeEnd, visual);
      setMissingMarker(el.missingMarkerStart, state.desiredRangeStart && state.desiredRangeStart < available.minIso ? state.desiredRangeStart : "", visual);
      setMissingMarker(el.missingMarkerEnd, state.desiredRangeEnd && state.desiredRangeEnd > available.maxIso ? state.desiredRangeEnd : "", visual);
      const comparedAssetLabel = hasSecondaryAsset(s) ? `${ASSETS[s.assetA].label} and ${ASSETS[s.assetB].label}` : ASSETS[s.assetA].label;
      const restrictionMessage = state.desiredRangeStart < available.minIso
        ? `${comparedAssetLabel} comparison data starts on ${available.minIso}.`
        : (state.desiredRangeEnd > available.maxIso ? `${comparedAssetLabel} comparison data ends on ${available.maxIso}.` : "");
      if (restrictionMessage) el.rangeTrackWrap.setAttribute("title", restrictionMessage);
      else el.rangeTrackWrap.removeAttribute("title");
      el.rangeTrackWrap.classList.toggle("is-ready", visualMaxIdx > visualMinIdx);
      el.rangeTrackWrap.classList.toggle("is-playing", state.isPlaying);
      el.rangeTrackWrap.classList.toggle("is-paused", state.paused);
    }
  }

  function cadenceLabel(cadence = state.settings.cadence) {
    if (cadence === "daily") return "Days";
    if (cadence === "monthly") return "Months";
    return "Weeks";
  }

  function cadencePhrase(cadence = state.settings.cadence) {
    if (cadence === "daily") return "Daily DCA";
    if (cadence === "monthly") return "Monthly DCA";
    return "Weekly DCA";
  }

  function isDcaDate(iso, startIso, cadence = state.settings.cadence) {
    const days = dayDiff(startIso, iso);
    if (days < 0) return false;
    if (cadence === "daily") return true;
    if (cadence === "weekly") return days % 7 === 0;
    return iso.slice(8, 10) === "01";
  }

  function buildSeries(endIso, settings = state.settings) {
    const s = settings;
    const hasB = hasSecondaryAsset(s);
    let unitsA = 0;
    let unitsB = 0;
    let invested = 0;
    let count = 0;
    const points = [];
    for (const r of state.rows) {
      if (r.date < s.rangeStart || r.date > endIso) continue;
      const priceA = r[s.assetA];
      const priceB = hasB ? r[s.assetB] : NaN;
      if (!Number.isFinite(priceA) || priceA <= 0) continue;
      if (hasB && (!Number.isFinite(priceB) || priceB <= 0)) continue;
      if (r.date >= s.dcaStart && isDcaDate(r.date, s.dcaStart, s.cadence)) {
        invested += s.amount;
        unitsA += s.amount / priceA;
        if (hasB) unitsB += s.amount / priceB;
        count += 1;
      }
      if (r.date >= s.dcaStart && invested > 0) {
        points.push({
          date: r.date,
          priceA,
          priceB: hasB ? priceB : null,
          valueA: unitsA * priceA,
          valueB: hasB ? unitsB * priceB : null,
          invested,
          unitsA,
          unitsB: hasB ? unitsB : null,
          count,
        });
      }
    }
    return points;
  }

  function niceTicks(min, max, count = 5) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [0, max || 1];
    const span = max - min;
    const raw = span / Math.max(1, count - 1);
    const mag = 10 ** Math.floor(Math.log10(raw));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    const start = Math.floor(min / step) * step;
    const end = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = start; v <= end + step / 2; v += step) ticks.push(v);
    return ticks;
  }

  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function makeUtcDate(year, month, day = 1) {
    return new Date(Date.UTC(year, month, day));
  }

  function snapCanvasLineCoord(value, lineWidth = 1, dpr = 1) {
    const safeDpr = Math.max(1, Number(dpr) || 1);
    const deviceLineWidth = Math.max(1, Math.round((Number(lineWidth) || 1) * safeDpr));
    const offset = deviceLineWidth % 2 === 1 ? 0.5 / safeDpr : 0;
    return (Math.round((Number(value) || 0) * safeDpr) / safeDpr) + offset;
  }

  function clampRotatedRightAlignedLabelX(ctx, label, anchorX, angle, fontSize, minX, maxX) {
    const textWidth = ctx.measureText(String(label || "")).width;
    const textHeight = Number(fontSize) * 1.2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const corners = [
      [-textWidth, 0],
      [0, 0],
      [-textWidth, textHeight],
      [0, textHeight],
    ].map(([x0, y0]) => ({
      x: anchorX + x0 * cos - y0 * sin,
      y: x0 * sin + y0 * cos,
    }));
    const boxMinX = Math.min(...corners.map((point) => point.x));
    const boxMaxX = Math.max(...corners.map((point) => point.x));
    if (boxMinX < minX) return anchorX + (minX - boxMinX);
    if (boxMaxX > maxX) return anchorX - (boxMaxX - maxX);
    return anchorX;
  }

  function buildAdaptiveTimeTicks(series, chartW, isExport = false) {
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
      if (ms >= firstMs && ms <= lastMs) monthStarts.push(new Date(ms));
      cursor = makeUtcDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1);
    }
    if (!monthStarts.length) return [];

    const maxTicks = Math.max(4, Math.floor(chartW / (isExport ? 122 : 88)));
    const selectedIndices = new Set();
    if (isMultiYearRange) {
      const tierMonthSets = [
        [0],
        [0, 6],
        [0, 4, 8],
        [0, 3, 6, 9],
        [0, 2, 4, 6, 8, 10],
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      ];
      const buildTierIndices = (monthSet) => {
        const monthLookup = new Set(monthSet);
        const out = [];
        monthStarts.forEach((d, idx) => {
          if (monthLookup.has(d.getUTCMonth())) out.push(idx);
        });
        return out;
      };
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
        const janIndices = buildTierIndices([0]);
        const janStride = Math.max(1, Math.ceil(janIndices.length / maxTicks));
        for (let i = 0; i < janIndices.length; i += janStride) selectedIndices.add(janIndices[i]);
      }
    } else {
      const minStep = Math.max(1, Math.ceil(monthStarts.length / maxTicks));
      const niceMonthSteps = [1, 2, 3, 4, 6, 12, 24, 36, 48, 60, 120];
      const monthStep = niceMonthSteps.find((step) => step >= minStep) || minStep;
      for (let idx = 0; idx < monthStarts.length; idx += monthStep) selectedIndices.add(idx);
    }
    return monthStarts
      .filter((_, idx) => selectedIndices.has(idx))
      .map((d) => ({
        date: d,
        label: d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : MONTH_SHORT[d.getUTCMonth()],
      }));
  }

  function getResponsiveTickLabelFontSize(isExport = false) {
    const width = window.innerWidth;
    const baseSize = width < 640 ? 12 : width < 980 ? 14 : 18;
    return isExport ? Math.round(baseSize * 1.5) : baseSize;
  }

  function getTheme() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  }

  function colorVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function drawChart(canvas, endIso, opts = {}) {
    const ctx = canvas.getContext("2d");
    const dpr = opts.dpr || window.devicePixelRatio || 1;
    const cssW = opts.width || canvas.clientWidth || 1280;
    const cssH = opts.height || canvas.clientHeight || 720;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const theme = opts.theme || getTheme();
    const exportPalette = theme === "light"
      ? { bg: "#ffffff", text: "#1c1b19", muted: "#6f685f", grid: "#e6e6e6", green: "#41b36b" }
      : { bg: "#000000", text: "#f1f5f7", muted: "#95a6ae", grid: "#242424", green: "#41b36b" };
    const bg = opts.export ? exportPalette.bg : (colorVar("--panel") || exportPalette.bg);
    const text = opts.export ? exportPalette.text : (colorVar("--fg") || exportPalette.text);
    const muted = opts.export ? exportPalette.muted : (colorVar("--muted") || exportPalette.muted);
    const grid = exportPalette.grid;
    const green = opts.export ? exportPalette.green : (colorVar("--price-up") || exportPalette.green);
    const chartSettings = opts.settings || state.settings;
    const assetA = ASSETS[chartSettings.assetA];
    const hasB = hasSecondaryAsset(chartSettings);
    const assetB = hasB ? ASSETS[chartSettings.assetB] : null;
    const points = buildSeries(endIso, chartSettings);
    const legendItems = [
      { label: "Amount Invested", color: green, textColor: muted },
      { label: `${assetA.label} DCA Value`, color: assetA.color, textColor: muted },
    ];
    if (hasB) legendItems.push({ label: `${assetB.label} DCA Value`, color: assetB.color, textColor: muted });
    if (!opts.skipBackground) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, cssW, cssH);
    }
    if (!opts.export) syncCustomLegend(legendItems);
    if (!points.length) {
      if (!opts.export && !opts.chartArea) canvas.__dcaChartGeometry = null;
      if (!opts.export) syncCustomLegend([]);
      if (!opts.export) updateKpis(null);
      if (chartArea) ctx.restore();
      return { points };
    }
    const chartArea = opts.chartArea || null;
    const localW = chartArea ? chartArea.width : cssW;
    const localH = chartArea ? chartArea.height : cssH;
    if (chartArea) {
      ctx.save();
      ctx.translate(chartArea.x, chartArea.y);
      ctx.beginPath();
      ctx.rect(0, 0, localW, localH);
      ctx.clip();
    }
    const latest = points[points.length - 1];
    const values = points.flatMap((p) => hasB ? [p.valueA, p.valueB, p.invested] : [p.valueA, p.invested]).filter((v) => Number.isFinite(v));
    const scale = opts.export ? (opts.scale || chartSettings.scale) : chartSettings.scale;
    const yAxis = buildYScaleConfig(values, scale, { minMaxValue: chartSettings.amount * 2 });
    const labelSizes = getResponsiveChartLabelSizes(localW);
    const tickLabelFontSize = opts.export
      ? Number((labelSizes.tick * 0.9).toFixed(2))
      : labelSizes.tick;
    const yTickLabelFontSize = opts.export
      ? Number((labelSizes.yTick * 0.9).toFixed(2))
      : labelSizes.yTick;
    ctx.font = `400 ${tickLabelFontSize}px ${CHART_MONO_FONT}`;
    const xAxisDates = points.map((p) => ({ date: dateFromIso(p.date) }));
    const y0 = xAxisDates[0].date.getUTCFullYear();
    const y1 = xAxisDates[xAxisDates.length - 1].date.getUTCFullYear();
    let maxYearWidth = 0;
    for (let year = y0; year <= y1; year += 1) {
      maxYearWidth = Math.max(maxYearWidth, ctx.measureText(String(year)).width);
    }
    const fontHeight = tickLabelFontSize * 1.2;
    const rotationAngle = -Math.PI / 5;
    const rotatedHeight = Math.abs(maxYearWidth * Math.sin(rotationAngle))
      + Math.abs(fontHeight * Math.cos(rotationAngle));
    const bottomSpacing = opts.export ? 6 : 12;
    const bottomMargin = opts.export ? 4 : 12;
    const rightYearOverhang = Math.abs(fontHeight * Math.sin(rotationAngle));
    ctx.font = `400 ${yTickLabelFontSize}px ${CHART_MONO_FONT}`;
    const yLabelWidth = yAxis.ticktext.reduce((max, label) => Math.max(max, ctx.measureText(String(label || "")).width), 0);
    const left = opts.export ? 8 : 24;
    const right = Math.max(opts.export ? 54 : 72, yLabelWidth + (opts.export ? 10 : 22), rightYearOverhang + (opts.export ? 6 : 4));
    const topTitleY = opts.export ? 24 : 24;
    const top = opts.export ? 48 : 58;
    const bottom = opts.export
      ? Math.max(52, rotatedHeight + bottomSpacing + bottomMargin)
      : rotatedHeight + bottomSpacing + bottomMargin;
    const plotW = Math.max(1, localW - left - right);
    const plotH = Math.max(1, localH - top - bottom);
    if (!opts.export && !opts.chartArea) {
      canvas.__dcaChartGeometry = { left, top, plotW, plotH };
    }
    const startT = dateFromIso(points[0].date).getTime();
    const endT = dateFromIso(points[points.length - 1].date).getTime();
    const x = (iso) => left + ((dateFromIso(iso).getTime() - startT) / Math.max(1, endT - startT)) * plotW;
    const y = (v) => yAxis.map(v, top, plotH);
    const rightTicks = filterTicksByPixelSpacing(
      yAxis.tickvals,
      yAxis.ticktext,
      (value) => y(value),
      yTickLabelFontSize * 1.45,
      { preserveFirst: true, preserveLast: true },
    );

    const gridLineWidth = opts.export ? EXPORT_GRID_LINE_WIDTH : DASHBOARD_GRID_LINE_WIDTH;
    const chartLineWidth = opts.export ? getExportChartLineWidth(chartSettings) : DASHBOARD_CHART_LINE_WIDTH;
    ctx.lineWidth = gridLineWidth;
    ctx.strokeStyle = grid;
    ctx.fillStyle = muted;
    ctx.font = `400 ${yTickLabelFontSize}px ${CHART_MONO_FONT}`;
    ctx.textBaseline = "middle";
    rightTicks.tickvals.forEach((t, index) => {
      const yy = y(t);
      const gridY = snapCanvasLineCoord(yy, ctx.lineWidth, dpr);
      ctx.beginPath(); ctx.moveTo(left, gridY); ctx.lineTo(left + plotW, gridY); ctx.stroke();
      ctx.fillStyle = muted;
      ctx.textAlign = "left";
      ctx.fillText(rightTicks.ticktext[index] || fmtAxisUsd(t), left + plotW + 8, yy);
    });

    const xTicks = buildAdaptiveTimeTicks(xAxisDates, plotW, !!opts.export);
    xTicks.forEach((tick) => {
      const tickIso = tick.date.toISOString().slice(0, 10);
      const idx = points.findIndex((p) => p.date >= tickIso);
      if (idx <= 0) return;
      const xx = left + (idx / Math.max(1, points.length - 1)) * plotW;
      const gridX = snapCanvasLineCoord(xx, ctx.lineWidth, dpr);
      ctx.beginPath();
      ctx.moveTo(gridX, top);
      ctx.lineTo(gridX, top + plotH);
      ctx.stroke();

      ctx.save();
      const tickLabel = String(tick.label);
      const rotation = -Math.PI / 5;
      ctx.font = `400 ${tickLabelFontSize}px ${CHART_MONO_FONT}`;
      const anchorX = opts.export
        ? clampRotatedRightAlignedLabelX(ctx, tickLabel, xx - 8, rotation, tickLabelFontSize, 0, localW)
        : xx - 8;
      ctx.translate(anchorX, top + plotH + bottomSpacing);
      ctx.rotate(rotation);
      ctx.fillStyle = muted;
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText(tickLabel, 0, 0);
      ctx.restore();
    });

    function drawLine(key, color, width) {
      ctx.beginPath();
      points.forEach((p, i) => {
        const xx = x(p.date);
        const yy = y(p[key]);
        if (i === 0) ctx.moveTo(xx, yy);
        else ctx.lineTo(xx, yy);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    drawLine("invested", green, chartLineWidth);
    if (hasB) drawLine("valueB", assetB.color, chartLineWidth);
    drawLine("valueA", assetA.color, chartLineWidth);

    ctx.font = `400 ${Math.max(11, tickLabelFontSize * 0.78)}px ${CHART_MONO_FONT}`;
    ctx.fillStyle = muted;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(points[0].date, left, topTitleY);
    ctx.textAlign = "right";
    ctx.fillText(points[points.length - 1].date, localW - left, topTitleY);
    if (opts.export) {
      ctx.fillStyle = muted;
      ctx.textAlign = "center";
      ctx.font = `26px ${getComputedStyle(document.body).fontFamily}`;
      if (!opts.skipExportFooter) ctx.fillText("https://wickedsmartbitcoin.com/dca_comparison", localW / 2, localH - 28);
    }
    if (!opts.export) updateKpis(latest);
    if (chartArea) ctx.restore();
    return { points, latest };
  }

  function updateKpis(latest) {
    const s = state.settings;
    const a = ASSETS[s.assetA];
    const hasB = hasSecondaryAsset(s);
    const b = hasB ? ASSETS[s.assetB] : null;
    el.statusChips?.classList.toggle("kpi-cards--single", !hasB);
    el.assetAPriceTitle.textContent = `1 ${assetUnitPhrase(s.assetA)}`;
    el.assetBPriceTitle.closest(".kpi-card")?.toggleAttribute("hidden", !hasB);
    el.assetBDcaTitle.closest(".kpi-card")?.toggleAttribute("hidden", !hasB);
    el.assetBPriceTitle.textContent = hasB ? `1 ${assetUnitPhrase(s.assetB)}` : "";
    if (!latest) {
      el.assetAPrice.textContent = "";
      el.assetBPrice.textContent = "";
      el.assetAPriceLabel.textContent = "";
      el.assetBPriceLabel.textContent = "";
      el.countLabel.textContent = `Number of ${cadenceLabel()}`;
      el.countKpi.textContent = "";
      if (el.countYearsKpi) el.countYearsKpi.textContent = "";
      el.investedKpi.textContent = "";
      el.assetADcaTitle.textContent = `${a.label} DCA Value`;
      el.assetBDcaTitle.textContent = hasB ? `${b.label} DCA Value` : "";
      el.assetADcaValue.textContent = "";
      el.assetBDcaValue.textContent = "";
      el.assetADcaUnits.textContent = "";
      el.assetBDcaUnits.textContent = "";
      el.assetADcaValue.style.color = a.color;
      if (hasB) el.assetBDcaValue.style.color = b.color;
      return;
    }
    el.assetAPrice.textContent = fmtKpiUsd(latest.priceA);
    el.assetBPrice.textContent = hasB ? fmtKpiUsd(latest.priceB) : "";
    el.assetAPriceLabel.textContent = hasB ? fmtCrossUnits(latest.priceA / latest.priceB, s.assetB) : "";
    el.assetBPriceLabel.textContent = hasB ? fmtCrossUnits(latest.priceB / latest.priceA, s.assetA) : "";
    el.assetAPrice.style.color = "";
    el.assetBPrice.style.color = "";
    el.assetBPrice.className = "kpi-value";
    el.countLabel.textContent = `Number of ${cadenceLabel()}`;
    el.countKpi.textContent = latest.count.toLocaleString("en-US");
    if (el.countYearsKpi) el.countYearsKpi.textContent = fmtElapsedYears(s.dcaStart, latest.date);
    el.investedKpi.textContent = fmtInvestedUsd(latest.invested, s.amount);
    el.assetADcaTitle.textContent = `${a.label} DCA Value`;
    el.assetBDcaTitle.textContent = hasB ? `${b.label} DCA Value` : "";
    el.assetADcaValue.textContent = fmtKpiUsd(latest.valueA);
    el.assetBDcaValue.textContent = hasB ? fmtKpiUsd(latest.valueB) : "";
    el.assetADcaUnits.textContent = fmtDcaUnits(latest.unitsA, s.assetA);
    el.assetBDcaUnits.textContent = hasB ? fmtDcaUnits(latest.unitsB, s.assetB) : "";
    el.assetADcaValue.style.color = a.color;
    if (hasB) el.assetBDcaValue.style.color = b.color;
  }

  function render() {
    if (!state.rows.length) return;
    normalizeSettings();
    normalizeExportSettings();
    syncControls();
    drawChart(el.canvas, state.currentIso || state.settings.rangeEnd);
    saveSettings();
    updateResetButtonUi();
  }

  function setLastAdjustedHandle(handle) {
    if (handle === "start" || handle === "end") state.lastAdjustedHandle = handle;
  }

  function setDateRangeByIndexes(startIdx, endIdx, preset = "", options = {}) {
    clearPreResetSnapshot();
    const available = getActiveAvailableBounds();
    const minIdx = Math.max(0, findDateIndexByMode(available.minIso, "ceil"));
    const maxIdx = Math.max(minIdx, findDateIndexByMode(available.maxIso, "floor"));
    let safeStartIdx = Math.max(minIdx, Math.min(maxIdx, Math.round(startIdx)));
    let safeEndIdx = Math.max(safeStartIdx, Math.min(maxIdx, Math.round(endIdx)));
    if (options.preserveSpanAfterCadenceSnap) {
      const originalSpan = Math.max(0, safeEndIdx - safeStartIdx);
      const normalizedStartIso = alignCadenceStartIso(
        state.rows[safeStartIdx]?.date,
        state.settings.cadence,
        options.cadenceSnapDirection || "ceil"
      );
      let normalizedStartIdx = findDateIndexByMode(normalizedStartIso, "ceil");
      if (!Number.isFinite(normalizedStartIdx) || normalizedStartIdx < 0) normalizedStartIdx = safeStartIdx;
      normalizedStartIdx = Math.max(minIdx, Math.min(maxIdx, normalizedStartIdx));
      safeStartIdx = normalizedStartIdx;
      safeEndIdx = safeStartIdx + originalSpan;
      if (safeEndIdx > maxIdx) {
        const requestedStartIso = state.rows[Math.max(minIdx, Math.min(maxIdx, Math.round(startIdx)))]?.date || available.minIso;
        const localFloorStartIso = alignCadenceStartIso(requestedStartIso, state.settings.cadence, "floor");
        const localFloorStartIdx = findDateIndexByMode(clampIso(localFloorStartIso, available.minIso, available.maxIso), "floor");
        if (Number.isFinite(localFloorStartIdx) && localFloorStartIdx >= minIdx && localFloorStartIdx + originalSpan <= maxIdx) {
          safeStartIdx = localFloorStartIdx;
          safeEndIdx = safeStartIdx + originalSpan;
        } else {
          const latestStartIdx = Math.max(minIdx, maxIdx - originalSpan);
          const latestStartIso = state.rows[latestStartIdx]?.date || available.minIso;
          const alignedLatestStartIso = alignCadenceStartIso(latestStartIso, state.settings.cadence, "floor");
          const alignedLatestStartIdx = findDateIndexByMode(clampIso(alignedLatestStartIso, available.minIso, available.maxIso), "floor");
          safeStartIdx = Math.max(minIdx, Math.min(maxIdx, Number.isFinite(alignedLatestStartIdx) && alignedLatestStartIdx >= 0
            ? alignedLatestStartIdx
            : latestStartIdx));
          safeEndIdx = Math.min(maxIdx, safeStartIdx + originalSpan);
        }
      }
    }
    const start = state.rows[safeStartIdx]?.date;
    const end = state.rows[safeEndIdx]?.date;
    if (!start || !end) return;
    rememberDesiredRange(start, end);
    state.settings.rangeStart = start;
    state.settings.rangeEnd = end;
    if (state.settings.dcaStart < state.settings.rangeStart) state.settings.dcaStart = state.settings.rangeStart;
    state.currentIso = state.settings.rangeEnd;
    state.settings.preset = preset || inferRangePreset(state.settings.rangeStart, state.settings.rangeEnd);
    render();
  }

  function parseRangeDaysValue(value) {
    const parsed = Number.parseInt(String(value || "").replace(/[^\d]/g, ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function formatRangeDaysValue(value) {
    const parsed = parseRangeDaysValue(value);
    return parsed > 0 ? parsed.toLocaleString("en-US") : "";
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

  function setRangeByDayCount(dayCount) {
    if (!state.rows.length) return;
    clearPreResetSnapshot();
    const days = Math.max(1, Math.round(Number(dayCount) || 1));
    const available = getActiveAvailableBounds();
    const minIdx = Math.max(0, findDateIndexByMode(available.minIso, "ceil"));
    const maxIdx = Math.max(minIdx, findDateIndexByMode(available.maxIso, "floor"));
    let startIdx = findDateIndexByMode(state.settings.rangeStart, "ceil");
    if (startIdx < minIdx) startIdx = minIdx;
    let endIdx = startIdx + days - 1;
    if (endIdx > maxIdx) {
      endIdx = maxIdx;
      startIdx = Math.max(minIdx, endIdx - days + 1);
    }
    setDateRangeByIndexes(startIdx, endIdx, "");
  }

  function commitRangeDaysInput() {
    const input = el.rangeDaysInput;
    if (!input) return;
    const days = parseRangeDaysValue(input.value);
    if (!days) {
      input.value = input.dataset.lastValidValue
        ? Number(input.dataset.lastValidValue).toLocaleString("en-US")
        : "";
      return;
    }
    setRangeByDayCount(days);
  }

  function handleRangeDaysInput() {
    const input = el.rangeDaysInput;
    if (!input) return;
    const rawValue = String(input.value || "");
    const rawCaret = Number.isFinite(input.selectionStart) ? input.selectionStart : rawValue.length;
    const digitsBeforeCaret = rawValue.slice(0, rawCaret).replace(/\D/g, "").length;
    const days = parseRangeDaysValue(input.value);
    const formatted = formatRangeDaysValue(input.value);
    input.value = formatted;
    if (document.activeElement === input) {
      const nextCaret = getCaretIndexForDigitPosition(formatted, digitsBeforeCaret);
      input.setSelectionRange(nextCaret, nextCaret);
    }
    if (days > 0) setRangeByDayCount(days);
  }

  function applyPreset(preset) {
    clearPreResetSnapshot();
    const available = getActiveAvailableBounds();
    const max = getLatestPresetEndIso();
    const start = getPresetStartIso(preset, max);
    state.settings.preset = preset;
    state.desiredRangeStart = start;
    state.desiredRangeEnd = max;
    state.settings.rangeStart = clampIso(start, available.minIso, available.maxIso);
    state.settings.rangeEnd = max;
    if (state.settings.dcaStart < state.settings.rangeStart) state.settings.dcaStart = state.settings.rangeStart;
    state.currentIso = state.settings.rangeEnd;
    stopAnimation(false);
    render();
  }

  function play() {
    if (!state.rows.length) {
      state.pendingSpacePlayback = true;
      return;
    }
    const startIdx = findDateIndexByMode(state.settings.rangeStart, "ceil");
    const endIdx = findDateIndexByMode(state.settings.rangeEnd, "floor");
    if (startIdx < 0 || endIdx < 0 || startIdx >= endIdx) return;
    if (state.isPlaying) return;
    state.isPlaying = true;
    state.paused = false;
    if (findDateIndexByMode(state.currentIso, "floor") >= endIdx) {
      state.currentIso = state.rows[startIdx]?.date || state.settings.rangeStart;
    }
    window.clearInterval(state.timerId);
    const intervalMs = Number(state.settings.speed) < 1
      ? 1000 / (30 * Number(state.settings.speed))
      : 1000 / 30;
    state.timerId = window.setInterval(stepPlayback, intervalMs);
    render();
  }

  function pause() {
    if (!state.isPlaying) return;
    window.clearInterval(state.timerId);
    state.timerId = null;
    state.isPlaying = false;
    state.paused = true;
    render();
  }

  function stopAnimation(resetCurrent = true) {
    window.clearInterval(state.timerId);
    state.timerId = null;
    state.isPlaying = false;
    state.paused = false;
    if (resetCurrent) state.currentIso = state.settings.rangeEnd;
    render();
  }

  function stepPlayback() {
    if (!state.isPlaying) return;
    const currentIdx = findDateIndexByMode(state.currentIso, "floor");
    const endIdx = findDateIndexByMode(state.settings.rangeEnd, "floor");
    if (currentIdx < 0 || endIdx < 0 || currentIdx >= endIdx) {
      state.currentIso = state.settings.rangeEnd;
      stopAnimation(false);
      return;
    }
    const step = Math.max(1, Math.round(Number(state.settings.speed) || 1));
    const nextIdx = Math.min(endIdx, currentIdx + step);
    state.currentIso = state.rows[nextIdx]?.date || state.settings.rangeEnd;
    render();
  }

  function isoFromPointer(clientX) {
    const index = indexFromPointer(clientX);
    return state.rows[index]?.date || state.minIso;
  }

  function indexFromPointer(clientX) {
    const rect = el.rangeTrackWrap.getBoundingClientRect();
    const styles = window.getComputedStyle(el.rangeTrackWrap);
    const edgePad = Number.parseFloat(styles.getPropertyValue("--slider-edge-pad")) || 0;
    const usable = Math.max(1, rect.width - edgePad * 2);
    const pct = Math.min(1, Math.max(0, (clientX - rect.left - edgePad) / usable));
    const visual = getVisualBounds();
    const minIdx = Math.max(0, findDateIndexByMode(visual.minIso, "ceil"));
    const maxIdx = Math.max(minIdx, findDateIndexByMode(visual.maxIso, "floor"));
    return Math.round(minIdx + pct * Math.max(0, maxIdx - minIdx));
  }

  function startDrag(kind, ev) {
    ev.preventDefault();
    ev.stopPropagation();
    if (kind === "start" || kind === "end") setLastAdjustedHandle(kind);
    state.wasPlayingBeforeDrag = state.isPlaying;
    state.wasPausedBeforeDrag = state.paused;
    const startIdx = findDateIndexByMode(state.settings.rangeStart, "ceil");
    const endIdx = findDateIndexByMode(state.settings.rangeEnd, "floor");
    const pointerIdx = indexFromPointer(ev.clientX);
    state.dragInfo = {
      startIdx,
      endIdx,
      pointerIdx,
      targetEndIdx: endIdx,
      targetEndIso: state.settings.rangeEnd,
    };
    if (kind === "playhead") {
      window.clearInterval(state.timerId);
      state.timerId = null;
      state.isPlaying = false;
      state.paused = true;
    } else {
      stopAnimation(false);
    }
    state.drag = kind;
    try { el.rangeTrackWrap?.setPointerCapture?.(ev.pointerId); } catch {}
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", endDrag, { once: true });
    onDragMove(ev);
  }

  function onDragMove(ev) {
    const rawIdx = indexFromPointer(ev.clientX);
    const iso = state.rows[Math.max(0, Math.min(state.rows.length - 1, rawIdx))]?.date || isoFromPointer(ev.clientX);
    const available = getActiveAvailableBounds();
    if (state.drag === "start") {
      state.desiredRangeStart = iso;
      state.settings.rangeStart = clampIso(iso, available.minIso, state.settings.rangeEnd);
      if (state.settings.dcaStart < state.settings.rangeStart) state.settings.dcaStart = state.settings.rangeStart;
      if (state.currentIso < state.settings.rangeStart) state.currentIso = state.settings.rangeStart;
    } else if (state.drag === "end") {
      state.desiredRangeEnd = iso;
      state.settings.rangeEnd = clampIso(iso, state.settings.rangeStart, available.maxIso);
      state.currentIso = state.settings.rangeEnd;
    } else if (state.drag === "playhead") {
      const startIdx = findDateIndexByMode(state.settings.rangeStart, "ceil");
      const maxIdx = findDateIndexByMode(available.maxIso, "floor");
      const nextIdx = Math.max(startIdx, Math.min(maxIdx, rawIdx));
      const nextIso = state.rows[nextIdx]?.date;
      if (nextIso) {
        if (state.dragInfo && nextIdx > state.dragInfo.targetEndIdx) {
          state.settings.rangeEnd = nextIso;
        } else if (state.dragInfo?.targetEndIso) {
          state.settings.rangeEnd = state.dragInfo.targetEndIso;
        }
        state.currentIso = nextIso;
      }
    } else if (state.drag === "range" && state.dragInfo) {
      const shift = Math.round(rawIdx - state.dragInfo.pointerIdx);
      const minShift = Math.max(0, findDateIndexByMode(available.minIso, "ceil")) - state.dragInfo.startIdx;
      const maxShift = Math.max(0, findDateIndexByMode(available.maxIso, "floor")) - state.dragInfo.endIdx;
      const safeShift = Math.max(minShift, Math.min(maxShift, shift));
      const nextStart = state.rows[state.dragInfo.startIdx + safeShift]?.date;
      const nextEnd = state.rows[state.dragInfo.endIdx + safeShift]?.date;
      if (nextStart && nextEnd) {
        state.settings.rangeStart = nextStart;
        state.settings.rangeEnd = nextEnd;
        rememberDesiredRange(nextStart, nextEnd);
        state.currentIso = nextEnd;
      }
    }
    state.settings.preset = "";
    render();
  }

  function endDrag() {
    const releasedPastEnd = state.drag === "playhead"
      && state.dragInfo
      && findDateIndexByMode(state.currentIso, "floor") >= state.dragInfo.targetEndIdx;
    const resume = state.wasPlayingBeforeDrag && state.drag === "playhead" && !releasedPastEnd && state.currentIso < state.settings.rangeEnd;
    const remainPaused = state.wasPausedBeforeDrag && state.drag === "playhead" && !releasedPastEnd;
    state.drag = null;
    state.dragInfo = null;
    state.wasPlayingBeforeDrag = false;
    state.wasPausedBeforeDrag = false;
    window.removeEventListener("pointermove", onDragMove);
    if (resume) play();
    else if (remainPaused) {
      state.isPlaying = false;
      state.paused = true;
      render();
    } else if (releasedPastEnd) {
      state.isPlaying = false;
      state.paused = false;
      state.currentIso = state.settings.rangeEnd;
      render();
    }
  }

  function getCurrentDateRangeIndices() {
    if (!state.rows.length) return null;
    const available = getActiveAvailableBounds();
    const minIdx = Math.max(0, findDateIndexByMode(available.minIso, "ceil"));
    const maxIdx = Math.max(minIdx, findDateIndexByMode(available.maxIso, "floor"));
    let startIdx = findDateIndexByMode(state.settings.rangeStart, "ceil");
    let endIdx = findDateIndexByMode(state.settings.rangeEnd, "floor");
    if (startIdx < 0) startIdx = minIdx;
    if (endIdx < 0) endIdx = maxIdx;
    startIdx = Math.max(minIdx, Math.min(maxIdx, startIdx));
    endIdx = Math.max(minIdx, Math.min(maxIdx, endIdx));
    if (startIdx > endIdx) {
      const tmp = startIdx;
      startIdx = endIdx;
      endIdx = tmp;
    }
    return { startIdx, endIdx, minIdx, maxIdx };
  }

  function shiftDateRangeByIndices(deltaIndex) {
    const current = getCurrentDateRangeIndices();
    if (!current || !Number.isFinite(deltaIndex)) return false;
    const minShift = current.minIdx - current.startIdx;
    const maxShift = current.maxIdx - current.endIdx;
    const shift = Math.max(minShift, Math.min(maxShift, Math.round(deltaIndex)));
    if (!shift) return false;
    stopAnimation(false);
    setDateRangeByIndexes(current.startIdx + shift, current.endIdx + shift, "", {
      preserveSpanAfterCadenceSnap: true,
      cadenceSnapDirection: shift < 0 ? "floor" : "ceil",
    });
    return true;
  }

  function setDateRangeSpanAroundRatio(nextSpan, ratio) {
    const current = getCurrentDateRangeIndices();
    if (!current || !Number.isFinite(nextSpan)) return;
    const maxSpan = Math.max(0, current.maxIdx - current.minIdx);
    const minSpan = maxSpan >= 1 ? 1 : 0;
    const span = Math.max(minSpan, Math.min(maxSpan, Math.round(nextSpan)));
    const safeRatio = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0.5));
    const currentSpan = Math.max(0, current.endIdx - current.startIdx);
    const anchorIndex = current.startIdx + (safeRatio * currentSpan);
    let nextStart = Math.round(anchorIndex - (safeRatio * span));
    let nextEnd = nextStart + span;

    if (nextEnd > current.maxIdx) {
      nextEnd = current.maxIdx;
      nextStart = nextEnd - span;
    }
    if (nextStart < current.minIdx) {
      nextStart = current.minIdx;
      nextEnd = nextStart + span;
    }
    if (nextEnd > current.maxIdx) {
      nextEnd = current.maxIdx;
      nextStart = Math.max(current.minIdx, nextEnd - span);
    }

    stopAnimation(false);
    setDateRangeByIndexes(nextStart, nextEnd, "", {
      preserveSpanAfterCadenceSnap: true,
      cadenceSnapDirection: nextStart < current.startIdx ? "floor" : "ceil",
    });
  }

  function getChartPointerInfo(canvas, event) {
    const geometry = canvas?.__dcaChartGeometry;
    if (!canvas || !geometry) return null;
    const rect = canvas.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || rect.width <= 0 || !Number.isFinite(rect.height) || rect.height <= 0) return null;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const plotLeft = geometry.left;
    const plotRight = geometry.left + geometry.plotW;
    const plotTop = geometry.top;
    const plotBottom = geometry.top + geometry.plotH;
    const inX = x >= plotLeft && x <= plotRight;
    const inPlot = inX && y >= plotTop && y <= plotBottom;
    const onXAxis = inX && y > plotBottom && y <= rect.height;
    const ratio = Math.max(0, Math.min(1, (x - plotLeft) / Math.max(1, geometry.plotW)));
    return {
      inPlot,
      onXAxis,
      ratio,
      plotWidth: Math.max(1, geometry.plotW),
    };
  }

  function handleChartRangeWheel(event) {
    const info = getChartPointerInfo(event.currentTarget, event);
    if (!info || (!info.inPlot && !info.onXAxis)) return;
    event.preventDefault();

    const current = getCurrentDateRangeIndices();
    if (!current) return;
    const currentSpan = Math.max(0, current.endIdx - current.startIdx);

    if (event.deltaX) {
      const deltaX = event.deltaMode === 1 ? event.deltaX * 18 : event.deltaX;
      chartRangePanWheelRemainder += (deltaX / info.plotWidth) * Math.max(1, currentSpan);
      const shift = Math.trunc(chartRangePanWheelRemainder);
      if (shift) {
        chartRangePanWheelRemainder -= shift;
        shiftDateRangeByIndices(shift);
      }
    }

    if (!event.deltaY) return;
    const deltaY = event.deltaMode === 1 ? event.deltaY * 18 : event.deltaY;
    const resizeThreshold = event.deltaMode === 1 ? 6 : 180;
    chartRangeResizeWheelRemainder += deltaY;
    const resizeUnits = Math.trunc(chartRangeResizeWheelRemainder / resizeThreshold);
    if (!resizeUnits) return;
    chartRangeResizeWheelRemainder -= resizeUnits * resizeThreshold;
    const spanStep = Math.max(1, Math.round(Math.max(1, currentSpan) * 0.08)) * Math.abs(resizeUnits);
    const nextSpan = resizeUnits > 0
      ? currentSpan + spanStep
      : currentSpan - spanStep;
    setDateRangeSpanAroundRatio(nextSpan, info.ratio);
  }

  function beginChartRangeDrag(event) {
    if (typeof event.button === "number" && event.button !== 0) return;
    const canvas = event.currentTarget;
    const info = getChartPointerInfo(canvas, event);
    if (!info || (!info.inPlot && !info.onXAxis)) return;
    const current = getCurrentDateRangeIndices();
    if (!current || current.maxIdx <= current.minIdx) return;
    event.preventDefault();
    stopAnimation(false);
    chartRangeDragState = {
      pointerId: Number.isFinite(event.pointerId) ? event.pointerId : null,
      canvas,
      startClientX: event.clientX,
      startIdx: current.startIdx,
      endIdx: current.endIdx,
      minIdx: current.minIdx,
      maxIdx: current.maxIdx,
      plotWidth: info.plotWidth,
    };
    canvas.classList.add("dragging");
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch (_) {
      // Best effort only.
    }
  }

  function moveChartRangeDrag(event) {
    if (!chartRangeDragState) return;
    if (Number.isFinite(chartRangeDragState.pointerId) && event.pointerId !== chartRangeDragState.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - chartRangeDragState.startClientX;
    const span = Math.max(0, chartRangeDragState.endIdx - chartRangeDragState.startIdx);
    const rawShift = Math.round((-dx / Math.max(1, chartRangeDragState.plotWidth)) * Math.max(1, span));
    const minShift = chartRangeDragState.minIdx - chartRangeDragState.startIdx;
    const maxShift = chartRangeDragState.maxIdx - chartRangeDragState.endIdx;
    const shift = Math.max(minShift, Math.min(maxShift, rawShift));
    setDateRangeByIndexes(chartRangeDragState.startIdx + shift, chartRangeDragState.endIdx + shift, "", {
      preserveSpanAfterCadenceSnap: true,
      cadenceSnapDirection: shift < 0 ? "floor" : "ceil",
    });
  }

  function endChartRangeDrag(event) {
    if (!chartRangeDragState) return;
    if (Number.isFinite(chartRangeDragState.pointerId) && event?.pointerId !== chartRangeDragState.pointerId) return;
    const canvas = chartRangeDragState.canvas;
    try {
      canvas?.releasePointerCapture?.(chartRangeDragState.pointerId);
    } catch (_) {
      // Best effort only.
    }
    canvas?.classList.remove("dragging");
    chartRangeDragState = null;
  }

  function bindChartRangeInteractions(canvas) {
    if (!canvas || canvas.dataset.rangeInteractionsBound === "1") return;
    canvas.dataset.rangeInteractionsBound = "1";
    canvas.addEventListener("wheel", handleChartRangeWheel, { passive: false });
    canvas.addEventListener("pointerdown", beginChartRangeDrag);
    canvas.addEventListener("pointermove", moveChartRangeDrag);
    canvas.addEventListener("pointerup", endChartRangeDrag);
    canvas.addEventListener("pointercancel", endChartRangeDrag);
    canvas.addEventListener("lostpointercapture", () => {
      if (chartRangeDragState?.canvas !== canvas) return;
      canvas.classList.remove("dragging");
      chartRangeDragState = null;
    });
  }

  function isTextEntry(active) {
    const textTypes = ["text", "search", "email", "password", "url", "tel", "number"];
    return !!(active && (
      (active.tagName === "INPUT" && textTypes.includes(String(active.type || "").toLowerCase()))
      || active.tagName === "TEXTAREA"
      || active.tagName === "SELECT"
      || active.isContentEditable
    ));
  }

  function blurControlIfFocused() {
    const active = document.activeElement;
    if (
      active === el.startSlider
      || active === el.endSlider
      || active === el.playBtn
      || active === el.pauseBtn
      || active === el.stopBtn
      || active === el.speedBtn
      || active?.matches?.("[data-range-preset]")
    ) {
      active.blur();
    }
  }

  function togglePlayback() {
    if (!state.rows.length) {
      state.pendingSpacePlayback = true;
      return;
    }
    if (state.isPlaying) pause();
    else play();
  }

  function primeKeyboardFocus() {
    if (document.body && !document.body.hasAttribute("tabindex")) {
      document.body.setAttribute("tabindex", "-1");
    }
    try {
      document.body?.focus?.({ preventScroll: true });
    } catch {
      document.body?.focus?.();
    }
  }

  function setCurrentByIndex(index) {
    const startIdx = findDateIndexByMode(state.settings.rangeStart, "ceil");
    const endIdx = findDateIndexByMode(state.settings.rangeEnd, "floor");
    if (startIdx < 0 || endIdx < 0) return false;
    const nextIdx = Math.max(startIdx, Math.min(endIdx, Math.round(index)));
    if (!state.rows[nextIdx]) return false;
    state.currentIso = state.rows[nextIdx].date;
    render();
    return true;
  }

  function getNudgedStartIndex(delta) {
    const cadence = state.settings.cadence;
    const startIso = state.settings.rangeStart;
    const available = getActiveAvailableBounds();
    if (cadence === "weekly") {
      const d = dateFromIso(startIso);
      d.setUTCDate(d.getUTCDate() + (delta > 0 ? 1 : -1));
      const nextIso = delta > 0 ? getNextFridayIso(d.toISOString().slice(0, 10)) : getPreviousFridayIso(d.toISOString().slice(0, 10));
      return findDateIndexByMode(clampIso(nextIso, available.minIso, available.maxIso), delta > 0 ? "ceil" : "floor");
    }
    if (cadence === "monthly") {
      const nextIso = delta > 0 ? getNextMonthFirstIso(`${startIso.slice(0, 8)}02`) : getPreviousMonthFirstIso(startIso);
      return findDateIndexByMode(clampIso(nextIso, available.minIso, available.maxIso), delta > 0 ? "ceil" : "floor");
    }
    const startIdx = findDateIndexByMode(startIso, "ceil");
    return startIdx + delta;
  }

  function nudgeLastAdjustedHandle(delta) {
    if (state.lastAdjustedHandle !== "start" && state.lastAdjustedHandle !== "end") return false;
    const startIdx = findDateIndexByMode(state.settings.rangeStart, "ceil");
    const endIdx = findDateIndexByMode(state.settings.rangeEnd, "floor");
    const available = getActiveAvailableBounds();
    const minIdx = Math.max(0, findDateIndexByMode(available.minIso, "ceil"));
    const maxIdx = Math.max(minIdx, findDateIndexByMode(available.maxIso, "floor"));
    if (startIdx < 0 || endIdx < 0 || maxIdx <= 0) return false;
    const nextStartIdx = state.lastAdjustedHandle === "start"
      ? Math.max(minIdx, Math.min(endIdx, getNudgedStartIndex(delta)))
      : startIdx;
    const nextEndIdx = state.lastAdjustedHandle === "end"
      ? Math.max(startIdx, Math.min(maxIdx, endIdx + delta))
      : endIdx;
    if (nextStartIdx === startIdx && nextEndIdx === endIdx) return false;
    setDateRangeByIndexes(nextStartIdx, nextEndIdx, "");
    return true;
  }

  function handlePlaybackPanelOutsidePointer(event) {
    if (!state.isPlaying && !state.paused) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest(".date-range-panel") || target.closest(".date-picker-popup")) return;
    event.preventDefault();
    event.stopPropagation();
    if (target.closest(".panel") || target.closest(".chart-wrap")) {
      togglePlayback();
      return;
    }
    stopAnimation(true);
  }

  function renderExportProgress(progress = 0) {
    if (!el.downloadBtn) return;
    const pct = `${Math.max(0, Math.min(1, Number(progress) || 0)) * 100}%`;
    const existing = el.downloadBtn.querySelector(".date-range-export-progress");
    if (existing) {
      existing.style.setProperty("--date-range-export-progress", pct);
      return;
    }
    el.downloadBtn.classList.add("is-exporting");
    el.downloadBtn.disabled = false;
    el.downloadBtn.setAttribute("aria-label", "Cancel animation download");
    el.downloadBtn.setAttribute("title", "Cancel download");
    el.downloadBtn.innerHTML = [
      `<span class="date-range-export-progress" style="--date-range-export-progress: ${pct}" aria-hidden="true">`,
      '<span class="date-range-export-stop-square"></span>',
      "</span>",
    ].join("");
    if (el.downloadPanelBtn) {
      el.downloadPanelBtn.classList.add("is-stop-download");
      el.downloadPanelBtn.textContent = "Stop Download";
    }
  }

  function resetExportProgress() {
    if (el.downloadBtn) {
      el.downloadBtn.classList.remove("is-exporting", "is-canceling");
      el.downloadBtn.disabled = false;
      el.downloadBtn.setAttribute("aria-label", "Download date range animation");
      el.downloadBtn.setAttribute("title", "Download animation");
      el.downloadBtn.textContent = "↓";
    }
    if (el.downloadPanelBtn) {
      el.downloadPanelBtn.classList.remove("is-stop-download");
      el.downloadPanelBtn.textContent = "Download Animation";
    }
  }

  function requestExportCancel() {
    if (!state.isExporting) return false;
    state.exportCancelRequested = true;
    el.downloadBtn?.classList.add("is-canceling");
    return true;
  }

  function wait(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
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
      return Uint8Array.of(0x10 | (size >> 24), (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff);
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
      ebmlElement(0x258688, ebmlAscii("DCA Comparison")),
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
        bitrate: getExportBitrate(settings),
        framerate: EXPORT_FPS,
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

  async function encodeExportWebM({ canvas, settings, frameDates }) {
    const encoderConfig = await getSupportedWebCodecsExportConfig(canvas.width, canvas.height, settings);
    if (!encoderConfig) return null;
    const encodedFrames = [];
    const frameDurationUs = Math.round(1000000 / EXPORT_FPS);
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
    for (const iso of frameDates) {
      if (state.exportCancelRequested) break;
      drawExportFrame(canvas, iso, settings, { width: canvas.width, height: canvas.height });
      const frame = new VideoFrame(canvas, {
        timestamp: frameIndex * frameDurationUs,
        duration: frameDurationUs,
      });
      encoder.encode(frame, { keyFrame: frameIndex % EXPORT_FPS === 0 });
      frame.close();
      if (encodeError) throw encodeError;
      frameIndex += 1;
      renderExportProgress(frameIndex / Math.max(1, frameDates.length));
      if (encoder.encodeQueueSize > 8) {
        await encoder.flush();
        await wait(0);
      } else if (frameIndex % 6 === 0) {
        await wait(0);
      }
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
    encoder.close();
    if (state.exportCancelRequested) return null;
    encodedFrames.sort((a, b) => a.timestamp - b.timestamp);
    return buildWebMBlob(encodedFrames, canvas.width, canvas.height, EXPORT_FPS, encoderConfig.webmCodecId);
  }

  function downloadExportBlob(blob, settings) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `dca_comparison_${settings.assetA}_${settings.assetB}_${settings.rangeStart}_${settings.rangeEnd}.webm`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function exportVideo() {
    if (requestExportCancel()) return;
    state.isExporting = true;
    state.exportCancelRequested = false;
    let recorder = null;
    try {
      normalizeSettings();
      normalizeExportSettings();
      const settings = getExportSettingsSnapshot();
      const { width, height } = getExportDimensions(settings);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      if (!canvas.getContext("2d")) throw new Error("Export canvas context unavailable.");
      const frames = getFrameDates(settings);
      const priorTheme = state.settings.theme;
      const exportSettings = { ...settings, theme: settings.theme || priorTheme };
      try {
        const webmBlob = await encodeExportWebM({
          canvas,
          settings: exportSettings,
          frameDates: frames,
        });
        if (webmBlob && !state.exportCancelRequested) {
          renderExportProgress(1);
          downloadExportBlob(webmBlob, settings);
          return;
        }
        if (state.exportCancelRequested) return;
      } catch (error) {
        console.warn("Deterministic WebCodecs WebM export unavailable; falling back to recorder export.", error);
      }
      const paintExportFrame = (iso) => {
        drawExportFrame(canvas, iso, exportSettings, { width, height });
      };
      if (frames.length) paintExportFrame(frames[0]);
      let stream;
      try {
        stream = canvas.captureStream(0);
      } catch (_) {
        stream = canvas.captureStream(EXPORT_FPS);
      }
      let videoTrack = stream.getVideoTracks?.()[0] || null;
      if (!videoTrack || typeof videoTrack.requestFrame !== "function") {
        videoTrack?.stop?.();
        stream = canvas.captureStream(EXPORT_FPS);
        videoTrack = stream.getVideoTracks?.()[0] || null;
      }
      const chunks = [];
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: getExportBitrate(settings),
      });
      recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      const done = new Promise((resolve) => { recorder.onstop = resolve; });
      renderExportProgress(0);
      recorder.start();
      const frameDurationMs = 1000 / EXPORT_FPS;
      let nextFrameAt = performance.now();
      for (let i = 0; i < frames.length; i += 1) {
        if (state.exportCancelRequested) break;
        const iso = frames[i];
        paintExportFrame(iso);
        if (typeof videoTrack?.requestFrame === "function") videoTrack.requestFrame();
        renderExportProgress((i + 1) / frames.length);
        nextFrameAt += frameDurationMs;
        await new Promise((resolve) => {
          setTimeout(resolve, Math.max(0, nextFrameAt - performance.now()));
        });
      }
      if (recorder.state !== "inactive") recorder.stop();
      await done;
      const canceled = state.exportCancelRequested;
      if (canceled) return;
      const blob = new Blob(chunks, { type: "video/webm" });
      downloadExportBlob(blob, settings);
    } catch (err) {
      console.error("Unable to export DCA comparison animation:", err);
      window.alert("The animation export could not be completed in this browser.");
    } finally {
      if (recorder && recorder.state !== "inactive") {
        try { recorder.stop(); } catch {}
      }
      state.isExporting = false;
      state.exportCancelRequested = false;
      resetExportProgress();
    }
  }

  function bindEvents() {
    const closeSettingsPanel = () => {
      el.settingsPanel?.classList.remove("open");
      el.settingsBtn?.classList.remove("is-open");
    };
    bindSelectDropdowns();
    bindSecondaryAssetArrowCycling();
    let startPicker = null;
    let endPicker = null;
    if (el.rangeStartBtn && el.rangeEndBtn && el.rangeStartInput && el.rangeEndInput) {
      startPicker = makeDatePicker({
        anchorEl: el.rangeStartBtn,
        align: "left",
        getSelected: () => el.rangeStartInput.value || state.settings.rangeStart,
        getMin: () => el.rangeStartInput.min || state.minIso,
        getMax: () => el.rangeStartInput.max || state.settings.rangeEnd,
        onSelect: (isoVal) => {
          clearPreResetSnapshot();
          setLastAdjustedHandle("start");
          state.settings.rangeStart = isoVal;
          state.settings.preset = "";
          if (state.settings.dcaStart < state.settings.rangeStart) state.settings.dcaStart = state.settings.rangeStart;
          if (state.currentIso < state.settings.rangeStart) state.currentIso = state.settings.rangeStart;
          stopAnimation(false);
          render();
          endPicker?.rebuildCalendar();
        },
      });
      endPicker = makeDatePicker({
        anchorEl: el.rangeEndBtn,
        align: "left",
        getSelected: () => el.rangeEndInput.value || state.settings.rangeEnd,
        getMin: () => el.rangeEndInput.min || state.settings.rangeStart,
        getMax: () => el.rangeEndInput.max || state.maxIso,
        onSelect: (isoVal) => {
          clearPreResetSnapshot();
          setLastAdjustedHandle("end");
          state.settings.rangeEnd = isoVal;
          state.settings.preset = "";
          state.currentIso = state.settings.rangeEnd;
          stopAnimation(false);
          render();
          startPicker?.rebuildCalendar();
        },
      });
    }
    const openDateInputForButton = (button, event) => {
      if (button === el.rangeStartBtn) startPicker?.toggle(event || new Event("click"));
      else endPicker?.toggle(event || new Event("click"));
    };
    const toggleExpandMode = () => {
      const expanded = !document.body.classList.contains("expanded");
      document.body.classList.toggle("expanded", expanded);
      document.body.classList.toggle("dca-dashboard-expanded", expanded);
      el.expandBtn?.setAttribute("aria-pressed", String(expanded));
      el.expandBtn?.setAttribute("aria-label", expanded ? "Shrink video layout" : "Expand video layout");
      el.expandBtn?.setAttribute("title", expanded ? "Shrink video layout" : "Expand video layout");
      window.parent?.postMessage({ type: "wsb-dca-comparison-dashboard-expanded", expanded }, window.location.origin);
      requestAnimationFrame(render);
    };
    const downloadSettingBindings = {
      downloadScaleSelect: "scale",
      downloadOrientationSelect: "orientation",
      downloadQualitySelect: "quality",
      downloadSpeedSelect: "speed",
      downloadThemeSelect: "theme",
    };
    const handleRangePanelClick = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const handled = () => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        blurControlIfFocused();
      };
      const dateButton = target.closest("#dateRangeStartBtn, #dateRangeEndBtn");
      if (dateButton) {
        handled();
        openDateInputForButton(dateButton, event);
        return;
      }
      const presetButton = target.closest("[data-range-preset]");
      if (presetButton) {
        handled();
        applyPreset(presetButton.dataset.rangePreset || "full");
        return;
      }
      const settingOption = target.closest(".download-setting-option[data-value]");
      if (settingOption) {
        const group = settingOption.closest(".download-setting-button-row");
        const key = group ? downloadSettingBindings[group.id] : "";
        if (!key) return;
        handled();
        const raw = settingOption.dataset.value || "";
        state.exportSettings[key] = key === "quality" || key === "speed" ? Number(raw) : raw;
        normalizeExportSettings();
        render();
        return;
      }
      if (target.closest("#dateRangePlayBtn")) {
        handled();
        play();
        return;
      }
      if (target.closest("#dateRangePauseBtn")) {
        handled();
        pause();
        return;
      }
      if (target.closest("#dateRangeStopBtn")) {
        handled();
        stopAnimation(true);
        return;
      }
      if (target.closest("#dateRangeSpeedBtn")) {
        handled();
        clearPreResetSnapshot();
        normalizeSettings();
        const idx = SPEEDS.indexOf(Number(state.settings.speed));
        state.settings.speed = SPEEDS[(idx + 1) % SPEEDS.length];
        if (state.isPlaying) {
          window.clearInterval(state.timerId);
          state.timerId = null;
          state.isPlaying = false;
          play();
        }
        render();
        return;
      }
      if (target.closest("#dashboardExpandBtn")) {
        handled();
        toggleExpandMode();
        return;
      }
      if (target.closest("#dateRangeDownloadBtn")) {
        handled();
        closeSettingsPanel();
        exportVideo();
        return;
      }
      if (target.closest("#dateRangeSettingsBtn")) {
        handled();
        const open = !el.settingsPanel?.classList.contains("open");
        el.settingsBtn?.classList.toggle("is-open", open);
        el.settingsPanel?.classList.toggle("open", open);
        return;
      }
      if (target.closest("#downloadSettingsDownloadBtn")) {
        handled();
        if (!state.isExporting) closeSettingsPanel();
        exportVideo();
      }
    };
    const updateFromForm = (changedKey = "") => {
      clearPreResetSnapshot();
      const previousAssetA = state.settings.assetA;
      const previousAssetB = state.settings.assetB;
      state.settings.rangeStart = el.rangeStartInput.value;
      state.settings.rangeEnd = el.rangeEndInput.value;
      state.settings.cadence = el.cadenceSelect.value;
      state.settings.scale = el.scaleSelect.value;
      state.settings.amount = parseAmountValue(el.amountInput.value);
      state.settings.assetA = el.assetASelect.value;
      state.settings.assetB = el.assetBSelect.value;
      if (state.settings.assetA === state.settings.assetB) {
        if (changedKey === "assetA") {
          state.settings.assetB = previousAssetA;
        } else if (changedKey === "assetB") {
          state.settings.assetA = previousAssetB;
        }
        if (state.settings.assetA === state.settings.assetB) {
          const replacement = Object.keys(ASSETS).find((asset) => asset !== state.settings.assetA) || DEFAULTS.assetB;
          if (changedKey === "assetB") state.settings.assetA = replacement;
          else state.settings.assetB = replacement;
        }
      }
      if (changedKey === "rangeStart" || changedKey === "rangeEnd") {
        rememberDesiredRange(state.settings.rangeStart, state.settings.rangeEnd);
      } else if (changedKey === "assetA" || changedKey === "assetB") {
        rememberDesiredRange();
      }
      clampSettingsToAvailableRange({ preserveDesired: changedKey !== "rangeStart" && changedKey !== "rangeEnd" });
      state.currentIso = state.settings.rangeEnd;
      if (changedKey !== "assetA" && changedKey !== "assetB") state.settings.preset = "";
      stopAnimation(false);
      render();
    };

    [
      [el.rangeStartInput, "rangeStart"],
      [el.rangeEndInput, "rangeEnd"],
      [el.cadenceSelect, "cadence"],
      [el.scaleSelect, "scale"],
      [el.amountInput, "amount"],
      [el.assetASelect, "assetA"],
      [el.assetBSelect, "assetB"],
    ].forEach(([node, key]) => {
      if (!node) return;
      node.addEventListener("change", () => {
        updateFromForm(key);
      });
    });
    el.amountInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      updateFromForm();
      el.amountInput.blur();
    });
    el.amountInput?.addEventListener("input", handleAmountInput);
    [el.rangeStartBtn, el.rangeEndBtn].forEach((button) => {
      button?.addEventListener("click", () => {
        openDateInputForButton(button);
      });
    });
    el.downloadEndFrameHoldToggle?.addEventListener("change", () => {
      state.exportSettings.endFrameHold = !!el.downloadEndFrameHoldToggle.checked;
      render();
    });
    el.rangePanel?.addEventListener("click", handleRangePanelClick, true);
    el.settingsPanel?.addEventListener("click", (event) => event.stopPropagation());
    if (el.copyLinkBtn && el.copyLinkBtn.dataset.bound !== "1") {
      el.copyLinkBtn.dataset.bound = "1";
      el.copyLinkBtn.addEventListener("click", async () => {
        try {
          await copyDashboardLinkToClipboard(el.copyLinkBtn);
        } catch (error) {
          console.warn("Unable to copy DCA comparison dashboard link.", error);
        }
      });
    }
    if (el.resetBtn && el.resetBtn.dataset.bound !== "1") {
      el.resetBtn.dataset.bound = "1";
      el.resetBtn.addEventListener("click", () => {
        if (preResetStateSnapshot) restorePreviousDashboardState();
        else restoreDashboardDefaults();
      });
    }
    el.startSlider?.addEventListener("input", () => {
      clearPreResetSnapshot();
      setLastAdjustedHandle("start");
      const idx = Math.min(Number(el.startSlider.value), findDateIndex(state.settings.rangeEnd));
      const available = getActiveAvailableBounds();
      const nextIso = state.rows[idx]?.date || state.settings.rangeStart;
      state.desiredRangeStart = nextIso;
      state.settings.rangeStart = clampIso(nextIso, available.minIso, state.settings.rangeEnd);
      if (state.settings.dcaStart < state.settings.rangeStart) state.settings.dcaStart = state.settings.rangeStart;
      state.settings.preset = "";
      render();
    });
    el.endSlider?.addEventListener("input", () => {
      clearPreResetSnapshot();
      setLastAdjustedHandle("end");
      const idx = Math.max(Number(el.endSlider.value), findDateIndex(state.settings.rangeStart));
      const available = getActiveAvailableBounds();
      const nextIso = state.rows[idx]?.date || state.settings.rangeEnd;
      state.desiredRangeEnd = nextIso;
      state.settings.rangeEnd = clampIso(nextIso, state.settings.rangeStart, available.maxIso);
      state.currentIso = state.settings.rangeEnd;
      state.settings.preset = "";
      render();
    });
    el.startMarker?.addEventListener("pointerdown", (event) => startDrag("start", event));
    el.endMarker?.addEventListener("pointerdown", (event) => startDrag("end", event));
    el.currentMarker?.addEventListener("pointerdown", (event) => startDrag("playhead", event));
    el.rangeTrackWrap?.addEventListener("pointerdown", (event) => {
      if (event.target === el.startSlider || event.target === el.endSlider) return;
      const startIdx = findDateIndex(state.settings.rangeStart);
      const endIdx = findDateIndex(state.settings.rangeEnd);
      const clickedIdx = findDateIndex(isoFromPointer(event.clientX));
      const distStart = Math.abs(clickedIdx - startIdx);
      const distEnd = Math.abs(clickedIdx - endIdx);
      if (state.isPlaying || state.paused) startDrag("playhead", event);
      else if (clickedIdx > startIdx && clickedIdx < endIdx) startDrag("range", event);
      else startDrag(distStart <= distEnd ? "start" : "end", event);
    });
    bindChartRangeInteractions(el.canvas);
    el.rangeDaysInput?.addEventListener("focus", () => window.setTimeout(() => el.rangeDaysInput.select(), 0));
    el.rangeDaysInput?.addEventListener("click", () => window.setTimeout(() => el.rangeDaysInput.select(), 0));
    el.rangeDaysInput?.addEventListener("input", handleRangeDaysInput);
    el.rangeDaysInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitRangeDaysInput();
        el.rangeDaysInput.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        const fallback = Number.parseInt(el.rangeDaysInput.dataset.lastValidValue || "0", 10);
        el.rangeDaysInput.value = fallback > 0 ? fallback.toLocaleString("en-US") : "";
        el.rangeDaysInput.blur();
      }
    });
    el.rangeDaysInput?.addEventListener("change", () => {
      commitRangeDaysInput();
    });
    document.addEventListener("click", (event) => {
      if (el.settingsPanel?.contains(event.target) || el.settingsBtn?.contains(event.target)) return;
      closeSettingsPanel();
    });
    document.addEventListener("pointerdown", handlePlaybackPanelOutsidePointer, true);
    window.addEventListener("pagehide", saveSettings);
    window.addEventListener("beforeunload", saveSettings);
    window.addEventListener("resize", render);
    window.addEventListener("keydown", (e) => {
      if ((e.key === " " || e.code === "Space") && !e.altKey && !e.ctrlKey && !e.metaKey && !isTextEntry(document.activeElement)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        blurControlIfFocused();
        togglePlayback();
        requestAnimationFrame(blurControlIfFocused);
        return;
      }
      if (e.key === "Escape") {
        closeSettingsPanel();
        if (state.isPlaying || state.paused) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation?.();
          stopAnimation(true);
        }
        return;
      }
      const isArrowLeft = e.key === "ArrowLeft";
      const isArrowRight = e.key === "ArrowRight";
      const isComma = e.key === "," || e.code === "Comma";
      const isPeriod = e.key === "." || e.code === "Period";
      if (!isArrowLeft && !isArrowRight && !isComma && !isPeriod) return;
      if (e.altKey || e.ctrlKey || e.metaKey || isTextEntry(document.activeElement)) return;
      if (!state.isPlaying && !state.paused) {
        if (!isArrowLeft && !isArrowRight) return;
        if (state.lastAdjustedHandle !== "start" && state.lastAdjustedHandle !== "end") return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        blurControlIfFocused();
        nudgeLastAdjustedHandle(isArrowRight ? 1 : -1);
        requestAnimationFrame(blurControlIfFocused);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      const startIdx = findDateIndexByMode(state.settings.rangeStart, "ceil");
      const endIdx = findDateIndexByMode(state.settings.rangeEnd, "floor");
      const currentIdx = findDateIndexByMode(state.currentIso, "floor");
      const daysPerSecond = 30 * Math.max(0.5, Number(state.settings.speed) || 1);
      const bigStep = Math.max(1, Math.round(10 * daysPerSecond));
      let nextIdx = currentIdx;
      if (isArrowRight) nextIdx = Math.min(endIdx, currentIdx + bigStep);
      else if (isArrowLeft) nextIdx = Math.max(startIdx, currentIdx - bigStep);
      else if (isPeriod) nextIdx = Math.min(endIdx, currentIdx + 1);
      else if (isComma) nextIdx = Math.max(startIdx, currentIdx - 1);
      if (nextIdx !== currentIdx) {
        setCurrentByIndex(nextIdx);
        if (isArrowRight && state.isPlaying && nextIdx === endIdx) pause();
      }
    }, true);
  }

  async function init() {
    try {
      primeKeyboardFocus();
      state.settings = readStoredSettings();
      if (typeof state.settings.currentIso === "string") state.currentIso = state.settings.currentIso;
      state.exportSettings = readStoredExportSettings();
      const pausedPlaybackSession = readStoredPlaybackSession();
      bindEvents();
      await loadData();
      if (!state.settings.rangeEnd) state.settings.rangeEnd = getActiveAvailableBounds().maxIso;
      if (pausedPlaybackSession) {
        const available = getActiveAvailableBounds();
        state.settings.rangeStart = clampIso(pausedPlaybackSession.startIso, available.minIso, available.maxIso);
        state.settings.rangeEnd = clampIso(pausedPlaybackSession.targetEndIso, available.minIso, available.maxIso);
        rememberDesiredRange(pausedPlaybackSession.startIso, pausedPlaybackSession.targetEndIso);
        state.currentIso = clampIso(pausedPlaybackSession.currentIso, state.settings.rangeStart, state.settings.rangeEnd);
        state.isPlaying = false;
        state.paused = true;
        state.settings.preset = "";
      }
      normalizeSettings();
      if (state.settings.preset) state.currentIso = state.settings.rangeEnd;
      normalizeExportSettings();
      render();
      primeKeyboardFocus();
      if (state.pendingSpacePlayback) {
        state.pendingSpacePlayback = false;
        requestAnimationFrame(() => {
          if (!state.isPlaying && !state.paused) play();
        });
      }
    } catch (err) {
      if (el.errorBox) {
        el.errorBox.hidden = false;
        el.errorBox.textContent = `Unable to load DCA comparison data: ${err?.message || err}`;
      } else {
        console.error("Unable to load DCA comparison data:", err);
      }
    }
  }

  init();
})();
