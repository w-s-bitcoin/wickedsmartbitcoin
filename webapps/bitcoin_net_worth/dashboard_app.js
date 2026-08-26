// ── Shared theme IIFE (must run before any rendering) ────────────────────────
(function () {
  const SHARED_THEME_KEY = 'quantum-research-dashboard-theme';
  function applySharedTheme(t) {
    document.documentElement.dataset.theme = (t === 'light' ? 'light' : 'dark');
    document.dispatchEvent(new CustomEvent('dashboard-theme-change'));
  }
  try {
    const stored = localStorage.getItem(SHARED_THEME_KEY);
    applySharedTheme(stored === 'light' || stored === 'dark' ? stored
      : 'dark');
  } catch (_) { applySharedTheme('dark'); }
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'quantum-dashboard-theme') applySharedTheme(e.data.theme);
  });
  window.addEventListener('storage', function (e) {
    if (e.key === SHARED_THEME_KEY && (e.newValue === 'light' || e.newValue === 'dark')) applySharedTheme(e.newValue);
  });
}());
// ─────────────────────────────────────────────────────────────────────────────

const KRAKEN_URL = "https://api.kraken.com/0/public/Ticker?pair=USDCUSD,XBTUSDC";
const PUBLISHED_DEMO_HISTORY_URL = "webapp_data/demo_history.csv";
const HIST_PRICE_URL = "../../assets/daily_price.csv";
const HIST_PRICE_MARKER_URL = "../../assets/last_updated.txt";
const PUBLISHED_DATA_SIGNATURE_SEPARATOR = "\n---WSB-DATA-SIGNATURE-PART---\n";
const MIN_PUBLISHED_DEMO_SNAPSHOTS = 12;
const MIN_PUBLISHED_HISTORICAL_PRICE_ROWS = 3650;
const LATEST_ALLOWED_PRICE_HISTORY_START_MS = Date.parse("2010-01-01T00:00:00Z");
const STORE_KEY_DEMO = "bitcoinNetWorthTrackerSnapshotsDemoV1";
const STORE_KEY_LIVE = "bitcoinNetWorthTrackerSnapshotsLiveV1";
const FORM_KEY_DEMO = "bitcoinNetWorthTrackerFormDemoV1";
const FORM_KEY_LIVE = "bitcoinNetWorthTrackerFormLiveV1";
const STORE_KEY_LIVE_ENC = "bitcoinNetWorthTrackerSnapshotsLiveEncV1";
const FORM_KEY_LIVE_ENC = "bitcoinNetWorthTrackerFormLiveEncV1";
const LIVE_ENCRYPTION_ENABLED_KEY = "bitcoinNetWorthTrackerLiveEncryptionEnabledV1";
const LIVE_HISTORY_FILE_KEY = "bitcoinNetWorthTrackerLiveFileV1";
const LIVE_LAST_VIEWED_FILE_KEY = "bitcoinNetWorthTrackerLastViewedLiveFileV1";
const MODE_KEY = "bitcoinNetWorthTrackerModeV1";
const BTCUSD_CACHE_KEY = "bitcoinNetWorthTrackerBtcusdCacheV1";
const FILTER_KEY_DEMO = "bitcoinNetWorthTrackerFiltersDemoV1";
const FILTER_KEY_LIVE = "bitcoinNetWorthTrackerFiltersLiveV1";
const AL_CHART_MODE_KEY = "bitcoinNetWorthTrackerAlChartModeV1";
const AL_CHART_AXES_MODE_KEY = "bitcoinNetWorthTrackerAlChartAxesModeV1";
const NET_CHART_AXES_MODE_KEY = "bitcoinNetWorthTrackerNetChartAxesModeV1";
const UOA_SELECTION_KEY = "bitcoinNetWorthTrackerUoaSelectionsV1";
const RESET_LIVE_DATA_ACTION = "__reset_live_data__";
const QUOTE_AUTO_REFRESH_MS = 60_000;
const QUOTE_AUTO_REFRESH_OFFSET_MS = 1_000;

const FX_RATE_URLS = [
  "../uoa/webapp_data/daily_fx_rates.csv",
  "/webapps/uoa/webapp_data/daily_fx_rates.csv",
  "webapps/uoa/webapp_data/daily_fx_rates.csv"
];

const UOA_UNITS = [
  { code: "BTC", name: "bitcoin", decimals: 8, color: "#ff9900" },
  { code: "USD", name: "United States dollar", decimals: 2, symbol: "$" },
  { code: "EUR", name: "euro", decimals: 2, symbol: "€" },
  { code: "JPY", name: "Japanese yen", decimals: 0, symbol: "¥" },
  { code: "GBP", name: "British pound sterling", decimals: 2, symbol: "£" },
  { code: "CNY", name: "Chinese Renminbi yuan", decimals: 2, symbol: "¥" },
  { code: "AUD", name: "Australian dollar", decimals: 2, symbol: "A$" },
  { code: "CAD", name: "Canadian dollar", decimals: 2, symbol: "C$" },
  { code: "CHF", name: "Swiss franc", decimals: 2, symbol: "CHF" },
  { code: "HKD", name: "Hong Kong dollar", decimals: 2, symbol: "HK$" },
  { code: "SGD", name: "Singapore dollar", decimals: 2, symbol: "S$" },
  { code: "SEK", name: "Swedish krona", decimals: 2, symbol: "kr" },
  { code: "KRW", name: "South Korean won", decimals: 0, symbol: "₩" },
  { code: "NOK", name: "Norwegian krone", decimals: 2, symbol: "kr" },
  { code: "NZD", name: "New Zealand dollar", decimals: 2, symbol: "NZ$" },
  { code: "MXN", name: "Mexican peso", decimals: 2, symbol: "MX$" },
  { code: "INR", name: "Indian rupee", decimals: 2, symbol: "₹" },
  { code: "RUB", name: "Russian ruble", decimals: 2, symbol: "₽" },
  { code: "ZAR", name: "South African rand", decimals: 2, symbol: "R" },
  { code: "TRY", name: "Turkish lira", decimals: 2, symbol: "₺" },
  { code: "BRL", name: "Brazilian real", decimals: 2, symbol: "R$" },
  { code: "XAU", name: "gold", decimals: 4, suffix: "oz gold", color: "#ffd21a" },
  { code: "XAG", name: "silver", decimals: 4, suffix: "oz silver", color: "#c8d2dc" }
];
const UOA_UNIT_MAP = new Map(UOA_UNITS.map((unit) => [unit.code, unit]));
const ROW_UNIT_CODES = ["USD", "BTC", "sats", ...UOA_UNITS.map((u) => u.code).filter((code) => code !== "USD" && code !== "BTC")];

// Returns a fresh default formState for the given mode, seeded with the last
// known BTC price so the exchange rate is never lost across resets.
function freshFormState(mode) {
  const base = mode === "demo"
    ? structuredClone(DEFAULT_FORM_DEMO)
    : structuredClone(DEFAULT_FORM_LIVE);
  if (!base.btcusd || base.btcusd === 0) {
    const cached = Number(localStorage.getItem(BTCUSD_CACHE_KEY) || 0);
    if (cached > 0) base.btcusd = cached;
  }
  return base;
}

// Migrate any existing data from the old single keys into mode-specific keys.
// Old data was always demo (demo was the only mode), so migrate into demo keys.
(function migrateOldStore() {
  const OLD_STORE = "bitcoinNetWorthTrackerSnapshotsV1";
  const OLD_FORM  = "bitcoinNetWorthTrackerFormV1";
  const oldSnap = localStorage.getItem(OLD_STORE);
  if (oldSnap && !localStorage.getItem(STORE_KEY_DEMO)) {
    localStorage.setItem(STORE_KEY_DEMO, oldSnap);
    localStorage.removeItem(OLD_STORE);
  }
  const oldForm = localStorage.getItem(OLD_FORM);
  if (oldForm && !localStorage.getItem(FORM_KEY_DEMO)) {
    localStorage.setItem(FORM_KEY_DEMO, oldForm);
    localStorage.removeItem(OLD_FORM);
  }
  // One-time fix: earlier migration incorrectly copied demo data into the live
  // store. Clear it so live starts clean. Guard with a flag so we only do this once.
  const FIX_KEY = "bitcoinNetWorthTrackerLiveMigrationFixV1";
  if (!localStorage.getItem(FIX_KEY)) {
    localStorage.removeItem(STORE_KEY_LIVE);
    localStorage.removeItem(FORM_KEY_LIVE);
    localStorage.setItem(FIX_KEY, "1");
  }
})();

let currentMode = localStorage.getItem(MODE_KEY) || "demo";

const DEFAULT_FORM_DEMO = {
  btcusd: 0,
  manualBtcusd: null,
  useManualBtcusd: false,
  comments: "",
  assets: [
    { name: "bitcoin", amount: 1, unit: "BTC" },
    { name: "cash", amount: 1000, unit: "USD" },
    { name: "stocks", amount: 2000, unit: "USD" },
    { name: "car_value", amount: 5000, unit: "USD" },
    { name: "home_value", amount: 250000, unit: "USD" }
  ],
  liabilities: [
    { name: "credit_card_debt", amount: 2500, unit: "USD" },
    { name: "student_loans", amount: 10000, unit: "USD" },
    { name: "car_loans", amount: 4000, unit: "USD" },
    { name: "mortgage", amount: 220000, unit: "USD" }
  ]
};

const DEFAULT_FORM_LIVE = {
  btcusd: 0,
  manualBtcusd: null,
  useManualBtcusd: false,
  comments: "",
  assets: [],
  liabilities: []
};

const COLORS = [
  "#f7931a", "#2bb5ff", "#39d7a4", "#ef6f6c", "#ffd166",
  "#b48cf0", "#86efac", "#f9a8d4", "#67e8f9", "#fca5a5"
];
const CHART_PAD = { l: 130, r: 22, t: 34, b: 64 };
let currentTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

let formState = loadForm();
let snapshots = loadSnapshots();
let pendingRowFocus = null;
let pendingRowFieldFocus = null;
let manualEditedThisSession = false;
let historicalPrices = {}; // MMDDYY -> USD price, loaded from remote CSV on init
let fxRatesByDate = new Map();
let fxRateDates = [];
let fxRatesLoaded = false;
let fxRatesLoadingPromise = null;
let uoaSelections = loadUoaSelections();
let editingSnapshotDate = mmddyy(new Date());
let hasUnsavedAssetLiabilityChanges = false;
let hoveredSnapshotDate = null;
let hoveredCanvasY = null;
let liveEncryptionEnabled = localStorage.getItem(LIVE_ENCRYPTION_ENABLED_KEY) === "1";
let liveEncryptionPassword = null; // session-only, never persisted
let liveHistoryFile = localStorage.getItem(LIVE_HISTORY_FILE_KEY)
  || localStorage.getItem(LIVE_LAST_VIEWED_FILE_KEY)
  || "my_history.csv";
let liveAccessLocked = false;
let chartRange = { startDate: null, endDate: null };
let excludedAssets = new Set();
let excludedLiabilities = new Set();
let publishedDemoRefreshRenderPending = false;
let publishedDemoSnapshotCount = 0;
let publishedDemoEarliestDateMs = 0;
let publishedDemoLatestDateMs = 0;
let publishedHistoricalPriceCount = 0;
let publishedHistoricalPriceEarliestDateMs = 0;
let publishedHistoricalPriceLatestDateMs = 0;
let publishedDemoInstalledSignature = "";

function filterKeyForMode(mode) {
  return mode === "live" ? FILTER_KEY_LIVE : FILTER_KEY_DEMO;
}

function persistLiveFileSelection(file, { setCurrent = true } = {}) {
  const normalized = String(file || "").trim();
  if (!normalized) return;
  localStorage.setItem(LIVE_LAST_VIEWED_FILE_KEY, normalized);
  if (setCurrent) localStorage.setItem(LIVE_HISTORY_FILE_KEY, normalized);
}

function saveFilters(mode) {
  const payload = {
    excludedAssets: Array.from(excludedAssets),
    excludedLiabilities: Array.from(excludedLiabilities)
  };
  localStorage.setItem(filterKeyForMode(mode), JSON.stringify(payload));
}

function loadFilters(mode) {
  try {
    const raw = localStorage.getItem(filterKeyForMode(mode));
    if (!raw) return;
    const { excludedAssets: ea = [], excludedLiabilities: el = [] } = JSON.parse(raw);
    excludedAssets = new Set(ea);
    excludedLiabilities = new Set(el);
  } catch {
    excludedAssets = new Set();
    excludedLiabilities = new Set();
  }
}

function normalizeUoaCode(code, fallback = "USD") {
  const upper = String(code || fallback || "USD").trim().toUpperCase();
  return UOA_UNIT_MAP.has(upper) ? upper : fallback;
}

function loadUoaSelections() {
  try {
    const raw = localStorage.getItem(UOA_SELECTION_KEY);
    if (!raw) return { primary: "BTC", secondary: "USD" };
    const parsed = JSON.parse(raw);
    const primary = normalizeUoaCode(parsed?.primary, "BTC");
    let secondary = normalizeUoaCode(parsed?.secondary, "USD");
    if (secondary === primary) secondary = firstSecondaryUoa(primary);
    return { primary, secondary };
  } catch {
    return { primary: "BTC", secondary: "USD" };
  }
}

function firstSecondaryUoa(primary) {
  return (UOA_UNITS.find((unit) => unit.code !== primary)?.code) || "USD";
}

function saveUoaSelections() {
  try {
    localStorage.setItem(UOA_SELECTION_KEY, JSON.stringify(uoaSelections));
  } catch {}
}

function uoaUnitMeta(unit) {
  return UOA_UNIT_MAP.get(normalizeUoaCode(unit, "USD")) || UOA_UNIT_MAP.get("USD");
}

function unitNeedsFx(unit) {
  const normalized = normalizeUnit(unit);
  return normalized !== "BTC" && normalized !== "USD" && normalized !== "sats";
}

function currentUoaNeedsFx() {
  return unitNeedsFx(uoaSelections.primary) || unitNeedsFx(uoaSelections.secondary);
}

function currentRowsNeedFx() {
  const rows = [...(formState.assets || []), ...(formState.liabilities || [])];
  return rows.some((row) => unitNeedsFx(row?.unit));
}

function currentSnapshotsNeedFx() {
  return (snapshots || []).some((snap) =>
    [...(snap.assets || []), ...(snap.liabilities || [])].some((row) => unitNeedsFx(row?.unit))
  );
}

function scheduleFxLoadIfNeeded() {
  if (fxRatesLoaded || fxRatesLoadingPromise) return;
  if (!currentUoaNeedsFx() && !currentRowsNeedFx() && !currentSnapshotsNeedFx()) return;
  ensureFxRatesLoaded().then(() => {
    renderAll();
  }).catch((err) => {
    console.warn("Could not load UoA FX rates:", err);
  });
}
const chartInteractionState = {
  alChart: { labels: [], markerDates: [] },
  netChart: { labels: [], markerDates: [] }
};
let metricPieChartState = {
  netWorth: { hoveredIndex: null, slices: [] },
  assets: { hoveredIndex: null, slices: [] },
  liabilities: { hoveredIndex: null, slices: [] }
};
const MAX_ACTION_HISTORY = 200;
let undoStack = [];
let redoStack = [];
let actionLog = [];
let isApplyingHistory = false;
let isTrackingAction = false;
let quoteRefreshTimer = null;
let quoteRefreshAlignTimer = null;
let quoteRefreshInFlight = false;
let quoteRefreshAbortController = null;
let pendingQuoteUiUpdate = false;
let pendingBackgroundQuoteRefresh = false;
let editorRowsFocused = false;
let lastQuoteRefreshAt = null;
let suppressNextEditorFocusRestore = false;
let alChartMode = localStorage.getItem(AL_CHART_MODE_KEY) === "ratio" ? "ratio" : "value";
let alChartSeparateAxes = localStorage.getItem(AL_CHART_AXES_MODE_KEY) === "separate";
let netChartSeparateAxes = localStorage.getItem(NET_CHART_AXES_MODE_KEY) === "separate";

if (currentMode === "demo") {
  formState = freshFormState("demo");
  editingSnapshotDate = mmddyy(new Date());
}

// Initial encrypted-live boot should render a blank dashboard until unlocked.
if (currentMode === "live" && liveEncryptionEnabled && !liveEncryptionPassword) {
  snapshots = [];
  formState = freshFormState("live");
  editingSnapshotDate = mmddyy(new Date());
  hasUnsavedAssetLiabilityChanges = false;
  hoveredSnapshotDate = null;
}

// Always start on the real price source; manual field will be populated from real price after first fetch.
formState.useManualBtcusd = false;
formState.manualBtcusd = null;
editingSnapshotDate = mmddyy(new Date());
if (!(currentMode === "live" && liveEncryptionEnabled && !liveEncryptionPassword)) {
  seedTodayFormStateFromHistory({ save: false });
}
loadFilters(currentMode);

const el = {
  realPriceCard: document.getElementById("realPriceCard"),
  quoteTime: document.getElementById("quoteTime"),
  manualBtcusd: document.getElementById("manualBtcusd"),
  assetsPanelTitle: document.getElementById("assetsPanelTitle"),
  assetsCount: document.getElementById("assetsCount"),
  assetsRows: document.getElementById("assetsRows"),
  liabilitiesPanelTitle: document.getElementById("liabilitiesPanelTitle"),
  liabilitiesCount: document.getElementById("liabilitiesCount"),
  liabilitiesRows: document.getElementById("liabilitiesRows"),
  assetsMetric: document.getElementById("assetsMetric"),
  assetsMetricUsd: document.getElementById("assetsMetricUsd"),
  liabilitiesMetric: document.getElementById("liabilitiesMetric"),
  liabilitiesMetricUsd: document.getElementById("liabilitiesMetricUsd"),
  netMetric: document.getElementById("netMetric"),
  netMetricUsd: document.getElementById("netMetricUsd"),
  historyCount: document.getElementById("historyCount"),
  historyTableBody: document.getElementById("historyTableBody"),
  alChart: document.getElementById("alChart"),
  alChartLoader: document.getElementById("alChartLoader"),
  alChartTitle: document.getElementById("alChartTitle"),
  alChartLegend: document.getElementById("alChartLegend"),
  alChartModeToggle: document.getElementById("alChartModeToggle"),
  alModeValueBtn: document.getElementById("alModeValueBtn"),
  alModeRatioBtn: document.getElementById("alModeRatioBtn"),
  alChartSeparateAxes: document.getElementById("alChartSeparateAxes"),
  alChartAxisToggleWrap: document.getElementById("alChartAxisToggleWrap"),
  netChartSeparateAxes: document.getElementById("netChartSeparateAxes"),
  netChartLegend: document.getElementById("netChartLegend"),
  netChart: document.getElementById("netChart"),
  netChartLoader: document.getElementById("netChartLoader"),
  undoBtn: document.getElementById("undoBtn"),
  redoBtn: document.getElementById("redoBtn"),
  clearDataBtn: document.getElementById("clearDataBtn"),
  lockDataBtn: document.getElementById("lockDataBtn"),
  saveDataBtn: document.getElementById("saveDataBtn"),
  chartStartDate: document.getElementById("chartStartDate"),
  chartEndDate: document.getElementById("chartEndDate"),
  assetsFilterBtn: document.getElementById("assetsFilterBtn"),
  assetsFilterLabel: document.getElementById("assetsFilterLabel"),
  assetsFilterPanel: document.getElementById("assetsFilterPanel"),
  liabilitiesFilterBtn: document.getElementById("liabilitiesFilterBtn"),
  liabilitiesFilterLabel: document.getElementById("liabilitiesFilterLabel"),
  liabilitiesFilterPanel: document.getElementById("liabilitiesFilterPanel"),
  liveEncryptionEnabled: document.getElementById("liveEncryptionEnabled"),
  encryptionToggleWrap: document.getElementById("encryptionToggleWrap"),
  primaryUoaSelect: document.getElementById("primaryUoaSelect"),
  secondaryUoaSelect: document.getElementById("secondaryUoaSelect"),
  primaryUoaDropdown: document.getElementById("primaryUoaDropdown"),
  secondaryUoaDropdown: document.getElementById("secondaryUoaDropdown"),
  primaryUoaDropdownMenu: document.getElementById("primaryUoaDropdownMenu"),
  secondaryUoaDropdownMenu: document.getElementById("secondaryUoaDropdownMenu"),
  primaryUoaValue: document.getElementById("primaryUoaValue"),
  secondaryUoaValue: document.getElementById("secondaryUoaValue"),
  primaryUoaDropdownTrigger: document.getElementById("primaryUoaDropdownTrigger"),
  secondaryUoaDropdownTrigger: document.getElementById("secondaryUoaDropdownTrigger"),
  loadLiveFileBtn: document.getElementById("loadLiveFileBtn"),
  liveFileInput: document.getElementById("liveFileInput"),
};

function syncEditorRowsFocusedFromDom() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) {
    editorRowsFocused = false;
    return;
  }
  // Exclude delete buttons from focus tracking - they're in the rows but shouldn't block renders
  if (active.classList?.contains("remove-btn")) {
    editorRowsFocused = false;
    return;
  }
  // Block refresh when a comment field is focused
  if (active.classList?.contains("snapshot-comment-field")) {
    editorRowsFocused = true;
    return;
  }
  const wasInAssets = Boolean(el.assetsRows && el.assetsRows.contains(active));
  const wasInLiabilities = Boolean(el.liabilitiesRows && el.liabilitiesRows.contains(active));
  editorRowsFocused = wasInAssets || wasInLiabilities;
}

function focusBodyWithoutScroll() {
  const prevTabIndex = document.body.getAttribute("tabindex");
  document.body.setAttribute("tabindex", "-1");
  try {
    document.body.focus({ preventScroll: true });
  } catch {
    document.body.focus();
  }
  if (prevTabIndex === null) {
    document.body.removeAttribute("tabindex");
  } else {
    document.body.setAttribute("tabindex", prevTabIndex);
  }
}

function initEditorFocusTracking() {
  const focusIn = () => {
    editorRowsFocused = true;
    pauseAutoQuoteRefresh();
    if (quoteRefreshAbortController) {
      quoteRefreshAbortController.abort();
    }
  };
  const focusOut = () => {
    // Let the next activeElement settle (e.g., tabbing to another row field)
    setTimeout(() => {
      syncEditorRowsFocusedFromDom();
      if (!editorRowsFocused) {
        flushDeferredQuoteUiRefresh();
        resumeAutoQuoteRefresh();
      }
    }, 0);
  };
  [el.assetsRows, el.liabilitiesRows].forEach((container) => {
    if (!container) return;
    container.addEventListener("focusin", focusIn);
    container.addEventListener("focusout", focusOut);
  });
}

updateModeToggleUI();

applyTheme();
initEditorFocusTracking();
initUoaControls();

document.addEventListener('dashboard-theme-change', function () {
  const t = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  if (t !== currentTheme) { currentTheme = t; renderAll(); }
});

document.getElementById("refreshQuoteBtn").addEventListener("click", () => {
  void runTrackedAction("quote-refresh", () => refreshQuote());
});
if (el.undoBtn) {
  el.undoBtn.addEventListener("click", () => undoLastAction());
}
if (el.redoBtn) {
  el.redoBtn.addEventListener("click", () => redoLastAction());
}
if (el.lockDataBtn) {
  el.lockDataBtn.addEventListener("click", () => { void handleLockDataButtonClick(); });
}
if (el.saveDataBtn) {
  el.saveDataBtn.addEventListener("click", () => { void handleSaveDataButtonClick(); });
}
el.manualBtcusd.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    commitManualQuote();
    el.manualBtcusd.blur();
  }
});
el.manualBtcusd.addEventListener("focus", () => {
  captureEditorFieldBaseline(el.manualBtcusd);
  const num = Number(el.manualBtcusd.value.replace(/[$,]/g, "").trim());
  el.manualBtcusd.value = Number.isFinite(num) && num > 0 ? String(num) : "";
  el.manualBtcusd.select();
});
el.manualBtcusd.addEventListener("blur", commitManualQuote);
document.getElementById("modeDemoBtn").addEventListener("click", () => { void switchMode(currentMode === "demo" ? "live" : "demo"); });
document.getElementById("modeLiveBtn").addEventListener("click", () => { void switchMode(currentMode === "live" ? "demo" : "live"); });
document.getElementById("clearDataBtn").addEventListener("click", () => {
  const confirmed = window.confirm(
    "Clearing data will permanently delete any unsaved changes.\n\nClick Confirm to clear live data, or Cancel to keep your current data."
  );
  if (confirmed) {
    resetLiveDataToEmpty();
    renderAll();
  }
});
el.liveEncryptionEnabled.addEventListener("change", () => {
  if (el.liveEncryptionEnabled.checked) {
    void enableLiveEncryption();
  } else {
    void disableLiveEncryption();
  }
});
if (el.loadLiveFileBtn && el.liveFileInput) {
  el.loadLiveFileBtn.addEventListener("click", () => {
    if (currentMode !== "live") {
      alert("Switch to Live mode to load a local CSV or ENC file.");
      return;
    }
    el.liveFileInput.value = "";
    el.liveFileInput.click();
  });
  el.liveFileInput.addEventListener("change", () => {
    const file = el.liveFileInput.files && el.liveFileInput.files[0];
    if (!file) return;
    void importLiveFileFromLocal(file);
  });
}
document.querySelectorAll(".add-row-btn").forEach((btn) => {
  if (btn.dataset.target) btn.addEventListener("click", () => addRow(btn.dataset.target));
});

if (el.alChartModeToggle && el.alModeValueBtn && el.alModeRatioBtn) {
  const syncAlChartModeUI = () => {
    updateAlChartModeLabels();
    const isValue = alChartMode === "value";
    el.alModeValueBtn.classList.toggle("active", isValue);
    el.alModeRatioBtn.classList.toggle("active", !isValue);
    el.alModeValueBtn.setAttribute("aria-pressed", isValue ? "true" : "false");
    el.alModeRatioBtn.setAttribute("aria-pressed", isValue ? "false" : "true");
    const axisDisabled = !isValue;
    if (el.alChartSeparateAxes) {
      el.alChartSeparateAxes.disabled = axisDisabled;
      el.alChartSeparateAxes.setAttribute("aria-disabled", axisDisabled ? "true" : "false");
    }
    if (el.alChartAxisToggleWrap) {
      el.alChartAxisToggleWrap.classList.toggle("is-disabled", axisDisabled);
      el.alChartAxisToggleWrap.setAttribute("aria-disabled", axisDisabled ? "true" : "false");
    }
  };

  const setAlChartMode = (mode) => {
    if (mode !== "value" && mode !== "ratio") return;
    if (alChartMode === mode) return;
    alChartMode = mode;
    localStorage.setItem(AL_CHART_MODE_KEY, alChartMode);
    syncAlChartModeUI();
    renderChartsOnly();
  };

  const toggleAlChartMode = () => {
    setAlChartMode(alChartMode === "value" ? "ratio" : "value");
  };

  el.alModeValueBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (alChartMode === "value") {
      runTrackedAction("al-chart-mode-toggle", () => toggleAlChartMode());
      return;
    }
    runTrackedAction("al-chart-mode-value", () => setAlChartMode("value"));
  });
  el.alModeRatioBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (alChartMode === "ratio") {
      runTrackedAction("al-chart-mode-toggle", () => toggleAlChartMode());
      return;
    }
    runTrackedAction("al-chart-mode-ratio", () => setAlChartMode("ratio"));
  });
  el.alChartModeToggle.addEventListener("click", () => {
    runTrackedAction("al-chart-mode-toggle", () => toggleAlChartMode());
  });
  syncAlChartModeUI();
}

if (el.alChartSeparateAxes) {
  el.alChartSeparateAxes.checked = alChartSeparateAxes;
  el.alChartSeparateAxes.addEventListener("change", () => {
    alChartSeparateAxes = Boolean(el.alChartSeparateAxes.checked);
    localStorage.setItem(AL_CHART_AXES_MODE_KEY, alChartSeparateAxes ? "separate" : "shared");
    renderChartsOnly();
  });
}

if (el.netChartSeparateAxes) {
  el.netChartSeparateAxes.checked = netChartSeparateAxes;
  el.netChartSeparateAxes.addEventListener("change", () => {
    netChartSeparateAxes = Boolean(el.netChartSeparateAxes.checked);
    localStorage.setItem(NET_CHART_AXES_MODE_KEY, netChartSeparateAxes ? "separate" : "shared");
    renderChartsOnly();
  });
}

// ── Global overlay registry (one open at a time) ────────────────────────────
const _overlayClosers = new Set();
function closeAllOverlays() {
  _overlayClosers.forEach((fn) => fn());
  closeAllFilterDropdowns();
}

// ── Reusable custom date picker ───────────────────────────────────────────────
// opts.anchorEl   – element to position below
// opts.getSelected – () => "YYYY-MM-DD" or ""   (currently selected value)
// opts.getMin      – () => "YYYY-MM-DD" or ""   (earliest selectable, inclusive)
// opts.getMax      – () => "YYYY-MM-DD" or ""   (latest selectable, inclusive)
// opts.isDisabled  – (isoVal) => bool            (extra per-day disabled check)
// opts.onSelect    – (isoVal) => void
function makeDatePicker(opts) {
  return window.WSBDashboardComponents.createDatePicker(opts);
}

// ── History panel date picker ─────────────────────────────────────────────────
(function initHistoryDatePicker() {
  const btn = document.getElementById("addHistoryDateBtn");
  const picker = makeDatePicker({
    align: "right",
    anchorEl: btn,
    getSelected: () => "",
    getMin: () => "2012-01-01",
    getMax: () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const y = yesterday.getFullYear();
      const m = String(yesterday.getMonth() + 1).padStart(2, "0");
      const d = String(yesterday.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    },
    isDisabled: (isoVal) => snapshots.some((s) => mmddyyToInputValue(s.date) === isoVal),
    onSelect: (isoVal) => addSnapshotForDate(inputValueToMMDDYY(isoVal))
  });
  btn.addEventListener("click", picker.toggle);
})();

// ── Chart date range pickers ──────────────────────────────────────────────────
(function initChartDatePickers() {
  const startBtn = document.getElementById("chartStartDateBtn");
  const endBtn   = document.getElementById("chartEndDateBtn");

  function fmtLabel(isoVal) {
    if (!isoVal) return "—";
    const [y, m, d] = isoVal.split("-");
    return `${m}/${d}/${y.slice(2)}`;
  }

  function refreshBtnLabels() {
    startBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${fmtLabel(el.chartStartDate.value)}`;
    endBtn.innerHTML   = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${fmtLabel(el.chartEndDate.value)}`;
  }

  // Patch syncChartRange side-effects so buttons update too
  const _origRenderChartsOnly = renderChartsOnly;
  window._chartDatePickersRefresh = refreshBtnLabels;

  const startPicker = makeDatePicker({
    align: "left",
    anchorEl: startBtn,
    getSelected: () => el.chartStartDate.value,
    getMin: () => el.chartStartDate.min || "",
    getMax: () => el.chartStartDate.max || "",
    isDisabled: () => false,
    onSelect: (isoVal) => {
      el.chartStartDate.value = isoVal;
      updateChartDateRangeFromInputs("start");
      refreshBtnLabels();
      endPicker.rebuildCalendar();
    }
  });

  const endPicker = makeDatePicker({
    align: "left",
    anchorEl: endBtn,
    getSelected: () => el.chartEndDate.value,
    getMin: () => el.chartEndDate.min || "",
    getMax: () => el.chartEndDate.max || "",
    isDisabled: () => false,
    onSelect: (isoVal) => {
      el.chartEndDate.value = isoVal;
      updateChartDateRangeFromInputs("end");
      refreshBtnLabels();
      startPicker.rebuildCalendar();
    }
  });

  startBtn.addEventListener("click", startPicker.toggle);
  endBtn.addEventListener("click", endPicker.toggle);

  // Expose so renderChartsOnly can keep labels fresh
  window._chartDatePickersRefresh = refreshBtnLabels;
})();


document.getElementById("assetsFilterDropdown").addEventListener("click", (e) => {
  if (e.target.closest(".filter-dropdown-panel")) return;
  if (document.getElementById("assetsFilterBtn")?.disabled) return;
  toggleFilterDropdown("assets");
});
document.getElementById("liabilitiesFilterDropdown").addEventListener("click", (e) => {
  if (e.target.closest(".filter-dropdown-panel")) return;
  if (document.getElementById("liabilitiesFilterBtn")?.disabled) return;
  toggleFilterDropdown("liabilities");
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".filter-dropdown")) closeAllFilterDropdowns();
});
document.addEventListener("keydown", handleUndoRedoHotkeys);
attachChartInteractions();
updateUndoRedoButtons();

// Resize canvas buffers to match display pixels so fonts don't squish at narrow widths.
(function attachChartResizeObserver() {
  let pending = false;
  function syncCanvasSizes() {
    let changed = false;
    [el.alChart, el.netChart].forEach((canvas) => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
        changed = true;
      }
    });
    if (changed) renderChartsOnly();
    pending = false;
  }
  const ro = new ResizeObserver(() => {
    if (!pending) {
      pending = true;
      requestAnimationFrame(syncCanvasSizes);
    }
  });
  [el.alChart, el.netChart].forEach((c) => ro.observe(c));
  // Initial sync on first frame
  requestAnimationFrame(syncCanvasSizes);
}());

// ── Metric Pie Chart Resize Observer & Event Listeners ──────────────────────
(function attachMetricPieChartInteractions() {
  const metricCharts = [
    { canvas: document.getElementById("netWorthPieChart"), type: "netWorth" },
    { canvas: document.getElementById("assetsPieChart"), type: "assets" },
    { canvas: document.getElementById("liabilitiesPieChart"), type: "liabilities" }
  ];

  // Attach mouse events for tooltips
  metricCharts.forEach(({ canvas, type }) => {
    if (!canvas) return;
    
    canvas.addEventListener("mousemove", (e) => {
      showMetricPieChartTooltip(canvas, e.clientX, e.clientY, type);
    });
    
    canvas.addEventListener("mouseleave", () => {
      const state = metricPieChartState[type];
      if (state.hoveredIndex !== null) {
        state.hoveredIndex = null;
        if (type === "netWorth") {
          const snap = getDisplaySnapshot();
          renderNetWorthPieChart(snap);
        } else if (type === "assets") {
          const snap = getDisplaySnapshot();
          renderAssetsPieChart(snap);
        } else if (type === "liabilities") {
          const snap = getDisplaySnapshot();
          renderLiabilitiesPieChart(snap);
        }
      }
      hideMetricPieTooltip();
    });
  });

  // Attach resize observer for metric cards
  let pending = false;
  function syncMetricCanvasSizes() {
    let changed = false;
    metricCharts.forEach(({ canvas }) => {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
        changed = true;
      }
    });
    if (changed) {
      const snap = getDisplaySnapshot();
      renderNetWorthPieChart(snap);
      renderAssetsPieChart(snap);
      renderLiabilitiesPieChart(snap);
    }
    pending = false;
  }

  const ro = new ResizeObserver(() => {
    if (!pending) {
      pending = true;
      requestAnimationFrame(syncMetricCanvasSizes);
    }
  });

  metricCharts.forEach(({ canvas }) => {
    if (canvas) {
      const parent = canvas.closest(".metric-card");
      if (parent) ro.observe(parent);
    }
  });

  // Initial render after first frame
  requestAnimationFrame(() => {
    const snap = getDisplaySnapshot();
    renderNetWorthPieChart(snap);
    renderAssetsPieChart(snap);
    renderLiabilitiesPieChart(snap);
  });
}());

void bootstrap();

function mmddyy(date = new Date()) {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  return `${mm}${dd}${yy}`;
}

function parseMMDDYY(tag) {
  const mm = Number(tag.slice(0, 2));
  const dd = Number(tag.slice(2, 4));
  const yy = Number(tag.slice(4, 6));
  return new Date(2000 + yy, mm - 1, dd);
}

function formatDisplayDate(tag) {
  const d = parseMMDDYY(tag);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function formatQuoteTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function themeValue(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function applyTheme() {
  document.documentElement.dataset.theme = (currentTheme === "light" ? "light" : "dark");
}

function updateAlChartModeLabels() {
  if (el.alModeValueBtn) {
    el.alModeValueBtn.textContent = `${uoaSelections.primary} Value`;
  }
  if (el.alModeRatioBtn) {
    el.alModeRatioBtn.textContent = "LTA Ratio";
  }
}

function uoaOptionLabel(unit) {
  return `${unit.code} - ${unit.name}`;
}

function renderUoaDropdowns() {
  [el.primaryUoaSelect, el.secondaryUoaSelect].forEach((select, index) => {
    if (!select) return;
    const isSecondary = index === 1;
    const selected = isSecondary ? uoaSelections.secondary : uoaSelections.primary;
    const omit = isSecondary ? uoaSelections.primary : null;
    const options = UOA_UNITS.filter((unit) => unit.code !== omit);
    select.innerHTML = "";
    options.forEach((unit) => {
      const option = document.createElement("option");
      option.value = unit.code;
      option.textContent = unit.code;
      select.appendChild(option);
    });
    select.value = selected;
  });

  updateUoaDropdownInput(el.primaryUoaValue, uoaSelections.primary);
  updateUoaDropdownInput(el.secondaryUoaValue, uoaSelections.secondary);
  updateAlChartModeLabels();
}

function updateUoaDropdownInput(input, code) {
  if (!input || document.activeElement === input) return;
  input.value = code;
  input.style.width = "";
}

function configureUoaDropdown(kind) {
  const isPrimary = kind === "primary";
  const dropdown = isPrimary ? el.primaryUoaDropdown : el.secondaryUoaDropdown;
  const input = isPrimary ? el.primaryUoaValue : el.secondaryUoaValue;
  const menu = isPrimary ? el.primaryUoaDropdownMenu : el.secondaryUoaDropdownMenu;
  const trigger = isPrimary ? el.primaryUoaDropdownTrigger : el.secondaryUoaDropdownTrigger;
  const select = isPrimary ? el.primaryUoaSelect : el.secondaryUoaSelect;
  if (!dropdown || !input || !menu || !trigger || !select) return;

  let highlightedIndex = -1;
  const availableOptions = () => UOA_UNITS.filter((unit) => !isPrimary ? unit.code !== uoaSelections.primary : true);
  const selectedCode = () => isPrimary ? uoaSelections.primary : uoaSelections.secondary;

  const close = () => {
    dropdown.classList.remove("open");
    dropdown.setAttribute("aria-expanded", "false");
    menu.innerHTML = "";
    highlightedIndex = -1;
    input.value = selectedCode();
    input.style.width = "";
  };

  const open = (query = "") => {
    dropdown.classList.add("open");
    dropdown.setAttribute("aria-expanded", "true");
    renderOptions(query);
  };

  const selectCode = (code) => {
    const normalized = normalizeUoaCode(code, selectedCode());
    if (isPrimary) {
      const previousPrimary = uoaSelections.primary;
      uoaSelections.primary = normalized;
      if (uoaSelections.secondary === normalized) {
        uoaSelections.secondary = previousPrimary !== normalized ? previousPrimary : firstSecondaryUoa(normalized);
      }
    } else {
      if (normalized === uoaSelections.primary) return;
      uoaSelections.secondary = normalized;
    }
    saveUoaSelections();
    saveForm();
    close();
    renderAll();
  };

  const optionMatches = (unit, query) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return unit.code.toLowerCase().includes(q) || unit.name.toLowerCase().includes(q);
  };

  const renderOptions = (query = "") => {
    const options = availableOptions().filter((unit) => optionMatches(unit, query));
    menu.innerHTML = "";
    highlightedIndex = options.findIndex((unit) => unit.code === selectedCode());
    if (highlightedIndex < 0 && options.length) highlightedIndex = 0;
    options.forEach((unit, idx) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dca-option-btn";
      button.dataset.value = unit.code;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", unit.code === selectedCode() ? "true" : "false");
      button.classList.toggle("dca-option-btn--selected", unit.code === selectedCode());
      button.classList.toggle("dca-option-btn--highlighted", idx === highlightedIndex);
      button.textContent = uoaOptionLabel(unit);
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        selectCode(unit.code);
      });
      menu.appendChild(button);
    });
  };

  const moveHighlight = (delta) => {
    const buttons = Array.from(menu.querySelectorAll(".dca-option-btn"));
    if (!buttons.length) return;
    highlightedIndex = (highlightedIndex + delta + buttons.length) % buttons.length;
    buttons.forEach((button, idx) => {
      button.classList.toggle("dca-option-btn--highlighted", idx === highlightedIndex);
      if (idx === highlightedIndex) button.scrollIntoView({ block: "nearest" });
    });
  };

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    dropdown.classList.contains("open") ? close() : open("");
    input.focus({ preventScroll: true });
    input.select();
  });

  input.addEventListener("focus", () => {
    open("");
    input.select();
  });

  input.addEventListener("input", () => {
    const prior = input.value;
    renderOptions(prior);
    if (prior && !menu.querySelector(".dca-option-btn")) {
      input.value = prior.slice(0, -1);
      renderOptions(input.value);
    }
    input.style.width = `${Math.max(42, (input.value.length + 2) * 9)}px`;
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!dropdown.classList.contains("open")) open(input.value);
      moveHighlight(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!dropdown.classList.contains("open")) open(input.value);
      moveHighlight(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const exact = availableOptions().find((unit) => unit.code === input.value.trim().toUpperCase());
      const highlighted = menu.querySelectorAll(".dca-option-btn")[highlightedIndex];
      if (exact) selectCode(exact.code);
      else if (highlighted) selectCode(highlighted.dataset.value);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      input.blur();
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (!dropdown.contains(document.activeElement)) close();
    }, 0);
  });

  select.addEventListener("change", () => selectCode(select.value));
}

function initUoaControls() {
  configureUoaDropdown("primary");
  configureUoaDropdown("secondary");
  renderUoaDropdowns();
}

function trackedStateSnapshot() {
  return {
    formState: structuredClone(formState),
    snapshots: structuredClone(snapshots),
    chartRange: structuredClone(chartRange),
    excludedAssets: Array.from(excludedAssets).sort(),
    excludedLiabilities: Array.from(excludedLiabilities).sort(),
    uoaSelections: structuredClone(uoaSelections),
    alChartMode,
    editingSnapshotDate,
    hasUnsavedAssetLiabilityChanges
  };
}

function trackedStateEquals(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function recordActionEntry(action, before, after) {
  undoStack.push({ action, before, after });
  if (undoStack.length > MAX_ACTION_HISTORY) undoStack.shift();
  redoStack = [];
  actionLog.push({ action, at: new Date().toISOString(), direction: "forward" });
  if (actionLog.length > MAX_ACTION_HISTORY * 4) actionLog.shift();
  updateUndoRedoButtons();
}

function restoreTrackedState(state) {
  formState = structuredClone(state.formState);
  snapshots = structuredClone(state.snapshots);
  chartRange = structuredClone(state.chartRange || { startDate: null, endDate: null });
  excludedAssets = new Set(state.excludedAssets || []);
  excludedLiabilities = new Set(state.excludedLiabilities || []);
  if (state.uoaSelections) {
    uoaSelections = loadUoaSelections();
    uoaSelections.primary = normalizeUoaCode(state.uoaSelections.primary, "BTC");
    uoaSelections.secondary = normalizeUoaCode(state.uoaSelections.secondary, "USD");
    if (uoaSelections.secondary === uoaSelections.primary) {
      uoaSelections.secondary = firstSecondaryUoa(uoaSelections.primary);
    }
    saveUoaSelections();
    renderUoaDropdowns();
  }
  if (state.alChartMode === "ratio" || state.alChartMode === "value") {
    alChartMode = state.alChartMode;
  }
  localStorage.setItem(AL_CHART_MODE_KEY, alChartMode);
  if (el.alModeValueBtn && el.alModeRatioBtn) {
    const isValue = alChartMode === "value";
    el.alModeValueBtn.classList.toggle("active", isValue);
    el.alModeRatioBtn.classList.toggle("active", !isValue);
    el.alModeValueBtn.setAttribute("aria-pressed", isValue ? "true" : "false");
    el.alModeRatioBtn.setAttribute("aria-pressed", isValue ? "false" : "true");
  }
  if (el.alChartSeparateAxes) {
    el.alChartSeparateAxes.checked = Boolean(alChartSeparateAxes);
    const axisDisabled = alChartMode !== "value";
    el.alChartSeparateAxes.disabled = axisDisabled;
    el.alChartSeparateAxes.setAttribute("aria-disabled", axisDisabled ? "true" : "false");
  }
  if (el.alChartAxisToggleWrap) {
    const axisDisabled = alChartMode !== "value";
    el.alChartAxisToggleWrap.classList.toggle("is-disabled", axisDisabled);
    el.alChartAxisToggleWrap.setAttribute("aria-disabled", axisDisabled ? "true" : "false");
  }
  editingSnapshotDate = state.editingSnapshotDate;
  hasUnsavedAssetLiabilityChanges = Boolean(state.hasUnsavedAssetLiabilityChanges);
  saveForm();
  saveSnapshots();
  saveFilters(currentMode);
  renderAll();
}

function runTrackedAction(action, fn) {
  if (isApplyingHistory || isTrackingAction) return fn();
  isTrackingAction = true;
  const before = trackedStateSnapshot();
  try {
    const result = fn();
    const finalize = () => {
      const after = trackedStateSnapshot();
      if (!trackedStateEquals(before, after)) {
        recordActionEntry(action, before, after);
      }
      isTrackingAction = false;
    };
    if (result && typeof result.then === "function") {
      return result.finally(finalize);
    }
    finalize();
    return result;
  } catch (e) {
    isTrackingAction = false;
    throw e;
  }
}

function runTrackedActionFromBefore(action, before, fn) {
  if (isApplyingHistory || isTrackingAction) return fn();
  isTrackingAction = true;
  try {
    const result = fn();
    const finalize = () => {
      const after = trackedStateSnapshot();
      if (!trackedStateEquals(before, after)) {
        recordActionEntry(action, before, after);
      }
      isTrackingAction = false;
    };
    if (result && typeof result.then === "function") {
      return result.finally(finalize);
    }
    finalize();
    return result;
  } catch (e) {
    isTrackingAction = false;
    throw e;
  }
}

function captureEditorFieldBaseline(el) {
  if (!el._trackedBeforeState) {
    el._trackedBeforeState = trackedStateSnapshot();
  }
}

function consumeEditorFieldBaseline(el) {
  const before = el._trackedBeforeState || trackedStateSnapshot();
  el._trackedBeforeState = null;
  return before;
}

function undoLastAction() {
  if (!undoStack.length) return;
  const entry = undoStack.pop();
  isApplyingHistory = true;
  restoreTrackedState(entry.before);
  isApplyingHistory = false;
  redoStack.push(entry);
  actionLog.push({ action: entry.action, at: new Date().toISOString(), direction: "undo" });
  updateUndoRedoButtons();
}

function redoLastAction() {
  if (!redoStack.length) return;
  const entry = redoStack.pop();
  isApplyingHistory = true;
  restoreTrackedState(entry.after);
  isApplyingHistory = false;
  undoStack.push(entry);
  actionLog.push({ action: entry.action, at: new Date().toISOString(), direction: "redo" });
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  if (el.undoBtn) el.undoBtn.disabled = undoStack.length === 0;
  if (el.redoBtn) el.redoBtn.disabled = redoStack.length === 0;
}

function handleUndoRedoHotkeys(event) {
  const zKey = String(event.key || "").toLowerCase() === "z";
  if (!zKey) return;
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
  event.preventDefault();
  if (event.shiftKey) {
    redoLastAction();
  } else {
    undoLastAction();
  }
}

function mmddyyToInputValue(tag) {
  const d = parseMMDDYY(tag);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function inputValueToMMDDYY(value) {
  if (!value) return null;
  return yyyymmddToMMDDYY(value.replaceAll("-", ""));
}

function yyyymmddToMMDDYY(yyyymmdd) {
  const yyyy = yyyymmdd.slice(0, 4);
  const mm = yyyymmdd.slice(4, 6);
  const dd = yyyymmdd.slice(6, 8);
  const yy = yyyy.slice(-2);
  return `${mm}${dd}${yy}`;
}

function snapshotRowsToFormRows(rows) {
  return (rows || []).map((r) => ({
    name: String(r.name || ""),
    amount: parseRowAmount(r.value),
    unit: normalizeUnit(r.unit)
  }));
}

function latestSnapshot() {
  if (!snapshots.length) return null;
  return snapshots.slice().sort((a, b) => parseMMDDYY(b.date) - parseMMDDYY(a.date))[0];
}

function todayOrLatestSnapshot() {
  const today = mmddyy(new Date());
  return snapshots.find((s) => s.date === today) || latestSnapshot();
}

function seedTodayFormStateFromHistory({ save = true } = {}) {
  const today = mmddyy(new Date());
  if (editingSnapshotDate !== today) return;
  const base = todayOrLatestSnapshot();
  if (!base) return;
  formState.assets = snapshotRowsToFormRows(base.assets);
  formState.liabilities = snapshotRowsToFormRows(base.liabilities);
  hasUnsavedAssetLiabilityChanges = false;
  if (save) saveForm();
}

function todayHistoryRowSnapshot() {
  const today = mmddyy(new Date());
  const existingToday = snapshots.find((s) => s.date === today);
  if (existingToday) return existingToday;

  // Always base the synthetic today row on the latest saved snapshot's assets/liabilities
  // valued at the current live exchange rate — not the currently selected form state.
  const base = latestSnapshot();
  const price = activeBtcusd() || (base && Number(base.btcusd) > 0 ? Number(base.btcusd) : 0);
  const assets = base ? (base.assets || []).map((a) => ({ ...a })) : [];
  const liabilities = base ? (base.liabilities || []).map((l) => ({ ...l })) : [];
  const totals = computeTotals(assets, liabilities, price, today);

  return {
    date: today,
    timestamp: new Date().toISOString(),
    btcusd: price,
    assets,
    liabilities,
    totals,
    synthetic: true
  };
}

function historyDatesIncludingToday() {
  const today = mmddyy(new Date());
  const out = new Set((snapshots || []).map((s) => s.date));
  out.add(today);
  return Array.from(out);
}

function chartXAtIndex(index, labelCount, x0, chartW) {
  if (labelCount <= 1) return x0 + (chartW * 0.99) / 2;
  // Add 1% margin on the right by using 99% of available width
  return x0 + (chartW * 0.99 * index) / (labelCount - 1);
}

function nearestHistoryDateForCanvasPoint(canvas, xPx) {
  const state = chartInteractionState[canvas.id];
  if (!state || !state.labels.length || !state.markerDates.length) return null;
  const labels = state.labels;
  const labelToIndex = new Map(labels.map((d, i) => [d, i]));
  const x0 = Number.isFinite(state.plotX0) ? state.plotX0 : CHART_PAD.l;
  const chartW = Number.isFinite(state.plotW)
    ? state.plotW
    : (canvas.width - CHART_PAD.l - CHART_PAD.r);
  if (chartW <= 0) return null;

  let best = null;
  state.markerDates.forEach((date) => {
    const idx = labelToIndex.get(date);
    if (!Number.isInteger(idx)) return;
    const mx = chartXAtIndex(idx, labels.length, x0, chartW);
    const dist = Math.abs(xPx - mx);
    if (!best || dist < best.dist) best = { date, dist };
  });
  return best ? best.date : null;
}

function chartMouseX(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
  return (event.clientX - rect.left) * scaleX;
}

function syncChartRange(chartSnapshots, rangeState, startInputEl, endInputEl) {
  if (!chartSnapshots.length) {
    startInputEl.value = "";
    endInputEl.value = "";
    startInputEl.min = "";
    startInputEl.max = "";
    endInputEl.min = "";
    endInputEl.max = "";
    startInputEl.disabled = true;
    endInputEl.disabled = true;
    return { range: { startDate: null, endDate: null }, filtered: [] };
  }

  const minDate = chartSnapshots[0].date;
  const maxDate = chartSnapshots[chartSnapshots.length - 1].date;
  let startDate = rangeState.startDate || minDate;
  let endDate = rangeState.endDate || maxDate;

  if (parseMMDDYY(startDate) < parseMMDDYY(minDate)) startDate = minDate;
  if (parseMMDDYY(startDate) > parseMMDDYY(maxDate)) startDate = maxDate;
  if (parseMMDDYY(endDate) > parseMMDDYY(maxDate)) endDate = maxDate;
  if (parseMMDDYY(endDate) < parseMMDDYY(minDate)) endDate = minDate;
  if (parseMMDDYY(endDate) < parseMMDDYY(startDate)) endDate = startDate;

  const minInput = mmddyyToInputValue(minDate);
  const maxInput = mmddyyToInputValue(maxDate);
  const startInput = mmddyyToInputValue(startDate);
  const endInput = mmddyyToInputValue(endDate);

  startInputEl.disabled = false;
  endInputEl.disabled = false;
  startInputEl.min = minInput;
  startInputEl.max = endInput;
  endInputEl.min = startInput;
  endInputEl.max = maxInput;
  startInputEl.value = startInput;
  endInputEl.value = endInput;

  return {
    range: { startDate, endDate },
    filtered: chartSnapshots.filter((snap) => {
      const date = parseMMDDYY(snap.date);
      return date >= parseMMDDYY(startDate) && date <= parseMMDDYY(endDate);
    })
  };
}

function getAllAssetNames() {
  const names = new Set();
  snapshots.forEach((s) => (s.assets || []).forEach((a) => { if (a.name) names.add(a.name); }));
  (formState.assets || []).forEach((r) => { const n = String(r.name || "").trim(); if (n) names.add(n); });
  return Array.from(names).sort();
}

function getAllLiabilityNames() {
  const names = new Set();
  snapshots.forEach((s) => (s.liabilities || []).forEach((l) => { if (l.name) names.add(l.name); }));
  (formState.liabilities || []).forEach((r) => { const n = String(r.name || "").trim(); if (n) names.add(n); });
  return Array.from(names).sort();
}

function buildFilterPanel(panelEl, names, excluded, onChange, actionName) {
  panelEl.innerHTML = "";
  if (!names.length) {
    const msg = document.createElement("div");
    msg.className = "filter-empty-msg";
    msg.textContent = "No items";
    panelEl.appendChild(msg);
    return;
  }

  const itemCheckboxes = [];
  const syncAllCheckbox = () => {
    allCb.checked = itemCheckboxes.every((cb) => cb.checked);
  };

  const allLabel = document.createElement("label");
  allLabel.className = "filter-checkbox-item filter-checkbox-item-all";
  const allCb = document.createElement("input");
  allCb.type = "checkbox";
  allCb.checked = excluded.size === 0;
  allCb.addEventListener("change", () => {
    runTrackedAction(actionName, () => {
      if (allCb.checked) {
        excluded.clear();
      } else {
        names.forEach((name) => excluded.add(name));
      }
      itemCheckboxes.forEach((cb) => {
        cb.checked = allCb.checked;
      });
      onChange();
    });
  });
  allLabel.appendChild(allCb);
  allLabel.appendChild(document.createTextNode("All"));
  panelEl.appendChild(allLabel);

  names.forEach((name) => {
    const label = document.createElement("label");
    label.className = "filter-checkbox-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !excluded.has(name);
    itemCheckboxes.push(cb);
    cb.addEventListener("change", () => {
      runTrackedAction(actionName, () => {
        if (cb.checked) excluded.delete(name);
        else excluded.add(name);
        syncAllCheckbox();
        onChange();
      });
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(name));
    panelEl.appendChild(label);
  });

  syncAllCheckbox();
}

function updateFilterDropdownLabel(labelEl, btnEl, total, excluded) {
  const hidden = excluded.size;
  if (hidden === 0) {
    labelEl.textContent = "All";
    btnEl.classList.remove("has-exclusions");
  } else {
    labelEl.textContent = `${total - hidden} / ${total}`;
    btnEl.classList.add("has-exclusions");
  }
}

function populateFilterDropdowns() {
  const assetNames = getAllAssetNames();
  const liabilityNames = getAllLiabilityNames();

  buildFilterPanel(el.assetsFilterPanel, assetNames, excludedAssets, () => {
    updateFilterDropdownLabel(el.assetsFilterLabel, el.assetsFilterBtn, assetNames.length, excludedAssets);
    saveFilters(currentMode);
    renderChartsOnly();
    updateKPIs();
  }, "filter-assets");
  buildFilterPanel(el.liabilitiesFilterPanel, liabilityNames, excludedLiabilities, () => {
    updateFilterDropdownLabel(el.liabilitiesFilterLabel, el.liabilitiesFilterBtn, liabilityNames.length, excludedLiabilities);
    saveFilters(currentMode);
    renderChartsOnly();
    updateKPIs();
  }, "filter-liabilities");
  updateFilterDropdownLabel(el.assetsFilterLabel, el.assetsFilterBtn, assetNames.length, excludedAssets);
  updateFilterDropdownLabel(el.liabilitiesFilterLabel, el.liabilitiesFilterBtn, liabilityNames.length, excludedLiabilities);
}

function toggleFilterDropdown(type) {
  const dropdown = document.getElementById(type === "assets" ? "assetsFilterDropdown" : "liabilitiesFilterDropdown");
  const panel = type === "assets" ? el.assetsFilterPanel : el.liabilitiesFilterPanel;
  const isOpen = !panel.hidden;
  closeAllOverlays();
  if (!isOpen) {
    panel.hidden = false;
    dropdown.classList.add("open");
  }
}

function closeAllFilterDropdowns() {
  ["assetsFilterDropdown", "liabilitiesFilterDropdown"].forEach((id) => {
    const d = document.getElementById(id);
    if (d) d.classList.remove("open");
  });
  if (el.assetsFilterPanel) el.assetsFilterPanel.hidden = true;
  if (el.liabilitiesFilterPanel) el.liabilitiesFilterPanel.hidden = true;
}

function updateChartDateRangeFromInputs(changedField, { tracked = true } = {}) {
  const applyRangeFromInputs = () => {
    const startDate = inputValueToMMDDYY(el.chartStartDate.value);
    const endDate = inputValueToMMDDYY(el.chartEndDate.value);

    if (!startDate || !endDate) return;

    if (parseMMDDYY(endDate) < parseMMDDYY(startDate)) {
      if (changedField === "start") {
        el.chartEndDate.value = el.chartStartDate.value;
      } else {
        el.chartStartDate.value = el.chartEndDate.value;
      }
    }

    chartRange = {
      startDate: inputValueToMMDDYY(el.chartStartDate.value),
      endDate: inputValueToMMDDYY(el.chartEndDate.value)
    };
    renderChartsOnly();
  };

  if (!tracked || isApplyingHistory || isTrackingAction) {
    applyRangeFromInputs();
    return;
  }
  runTrackedAction(`chart-range-${changedField}`, applyRangeFromInputs);
}

function updateChartControlsDisabledState() {
  const hasSnapshots = snapshots.length > 0;
  const hasAssets = getAllAssetNames().length > 0;
  const hasLiabilities = getAllLiabilityNames().length > 0;

  const startBtn = document.getElementById("chartStartDateBtn");
  const endBtn   = document.getElementById("chartEndDateBtn");
  const assetsBtn = document.getElementById("assetsFilterBtn");
  const liabsBtn  = document.getElementById("liabilitiesFilterBtn");

  if (startBtn) startBtn.disabled = !hasSnapshots;
  if (endBtn)   endBtn.disabled   = !hasSnapshots;
  if (assetsBtn) assetsBtn.disabled = !hasAssets;
  if (liabsBtn)  liabsBtn.disabled  = !hasLiabilities;
}

function renderChartsOnly() {
  const displayPrice = activeBtcusd();
  const chartSnapshots = snapshotsForCharts(displayPrice, excludedAssets, excludedLiabilities);
  const synced = syncChartRange(chartSnapshots, chartRange, el.chartStartDate, el.chartEndDate);
  chartRange = synced.range;

  updateChartControlsDisabledState();
  renderAssetLiabilityChart(synced.filtered);
  renderNetChangeChart(synced.filtered);
  if (window._chartDatePickersRefresh) window._chartDatePickersRefresh();
}

function attachChartInteractions() {
  [el.alChart, el.netChart].forEach((canvas) => {
    canvas.addEventListener("mousemove", (event) => {
      const x = chartMouseX(canvas, event);
      const rect = canvas.getBoundingClientRect();
      const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
      const nextY = (event.clientY - rect.top) * scaleY;
      const nextHover = nearestHistoryDateForCanvasPoint(canvas, x);
      const yChanged = Math.abs((hoveredCanvasY ?? nextY) - nextY) >= 1;
      hoveredCanvasY = nextY;
      if (nextHover !== hoveredSnapshotDate || (nextHover && yChanged)) {
        hoveredSnapshotDate = nextHover;
        renderChartsOnly();
      }
    });

    canvas.addEventListener("mouseleave", () => {
      hoveredCanvasY = null;
      if (hoveredSnapshotDate !== null) {
        hoveredSnapshotDate = null;
        renderChartsOnly();
      }
    });

    canvas.addEventListener("click", (event) => {
      const x = chartMouseX(canvas, event);
      const date = nearestHistoryDateForCanvasPoint(canvas, x);
      if (!date) return;
      hoveredSnapshotDate = date;
      selectSnapshot(date);
    });
  });
}

function parseSnapshotsRaw(raw) {
  const parsed = JSON.parse(raw);
  const arr = Array.isArray(parsed) ? parsed : [];
  return arr.sort((a, b) => parseMMDDYY(b.date) - parseMMDDYY(a.date));
}

async function bootstrap() {
  try {
    // Always start from a neutral view.
    snapshots = [];
    formState = freshFormState(currentMode === "demo" ? "demo" : "live");
    editingSnapshotDate = mmddyy(new Date());

    renderAll();
    startAutoQuoteRefresh();
    requestBackgroundQuoteRefresh();
    updateModeToggleUI();
    const publishedDataPromise = fetchPublishedDemoCandidate((url, init) => fetch(url, init));

    if (currentMode === "demo") {
      const loadedDemo = await loadDemoData(publishedDataPromise);
      if (!loadedDemo) {
        snapshots = loadSnapshots();
        renderAll();
      }
    } else {
      try {
        const candidate = await publishedDataPromise;
        if (!validatePublishedDemoCandidate(candidate)) {
          throw new Error("Published demo data failed completeness validation.");
        }
        installPublishedDemoCandidate(candidate, { startup: true });
      } catch (error) {
        console.warn("Could not load published demo data:", error);
      }
      formState = loadForm();
      if (liveEncryptionEnabled && localStorage.getItem(STORE_KEY_LIVE_ENC)) {
        const pw = await promptForPasswordWithLiveReset({
          confirm: false,
          message: "Enter your encryption password to unlock live data.",
          forceDemoOnCancel: false,
          returnClearAction: true,
          validator: async (p) => {
            const ok = await unlockLiveEncryptedData(p);
            return ok ? null : "Incorrect password. Please try again.";
          }
        });
        if (pw === RESET_LIVE_DATA_ACTION) {
          currentMode = "live";
          localStorage.setItem(MODE_KEY, currentMode);
          snapshots = loadSnapshots();
          formState = loadForm();
          liveEncryptionPassword = null;
        } else if (pw) {
          liveEncryptionPassword = pw;
        } else {
          currentMode = "demo";
          localStorage.setItem(MODE_KEY, currentMode);
          formState = freshFormState("demo");
          snapshots = loadSnapshots();
        }
      } else {
        snapshots = loadSnapshots();
      }
      seedTodayFormStateFromHistory({ save: true });
    }

    renderAll();
    registerPublishedDemoDataRefresh();
  } finally {
    window.WSBDashboardComponents?.bindChartLoaders?.([el.netChartLoader, el.alChartLoader])?.hide?.();
  }
}

function clearAutoQuoteRefreshTimers() {
  if (quoteRefreshTimer !== null) {
    clearInterval(quoteRefreshTimer);
    quoteRefreshTimer = null;
  }
  if (quoteRefreshAlignTimer !== null) {
    clearTimeout(quoteRefreshAlignTimer);
    quoteRefreshAlignTimer = null;
  }
}

function startAutoQuoteRefresh() {
  clearAutoQuoteRefreshTimers();

  const now = Date.now();
  const msUntilNextMinute = QUOTE_AUTO_REFRESH_MS - (now % QUOTE_AUTO_REFRESH_MS);
  const firstDelay = msUntilNextMinute + QUOTE_AUTO_REFRESH_OFFSET_MS;

  quoteRefreshAlignTimer = setTimeout(() => {
    requestBackgroundQuoteRefresh();
    quoteRefreshTimer = setInterval(() => {
      requestBackgroundQuoteRefresh();
    }, QUOTE_AUTO_REFRESH_MS);
  }, firstDelay);
}

function pauseAutoQuoteRefresh() {
  clearAutoQuoteRefreshTimers();
}

function resumeAutoQuoteRefresh() {
  startAutoQuoteRefresh();
}

function requestBackgroundQuoteRefresh() {
  if (isManualOverrideActive()) return;
  if (isAssetLiabilityEditorFocused()) {
    pendingBackgroundQuoteRefresh = true;
    return;
  }
  pendingBackgroundQuoteRefresh = false;
  void refreshQuote({ background: true });
}

function parseFormFromRaw(raw, defaultForm) {
  const parsed = JSON.parse(raw);
  const merged = {
    ...structuredClone(defaultForm),
    ...parsed
  };

  if ((!Array.isArray(merged.assets) || !merged.assets.length) && (Array.isArray(parsed.assetsBtc) || Array.isArray(parsed.assetsUsd))) {
    const migratedAssets = [];
    (parsed.assetsBtc || []).forEach((r) => migratedAssets.push({
      name: String(r.name || ""),
      amount: Number(r.amount || 0),
      unit: "BTC"
    }));
    (parsed.assetsUsd || []).forEach((r) => migratedAssets.push({
      name: String(r.name || ""),
      amount: Number(r.amount || 0),
      unit: "USD"
    }));
    merged.assets = migratedAssets;
  }

  merged.assets = (merged.assets || []).map((r) => ({
    name: String(r.name || ""),
    amount: Number(r.amount || 0),
    unit: normalizeUnit(r.unit)
  }));

  if ((!Array.isArray(merged.liabilities) || !merged.liabilities.length) && (Array.isArray(parsed.liabilitiesBtc) || Array.isArray(parsed.liabilitiesUsd))) {
    const migratedLiabilities = [];
    (parsed.liabilitiesBtc || []).forEach((r) => migratedLiabilities.push({
      name: String(r.name || ""),
      amount: Number(r.amount || 0),
      unit: "BTC"
    }));
    (parsed.liabilitiesUsd || []).forEach((r) => migratedLiabilities.push({
      name: String(r.name || ""),
      amount: Number(r.amount || 0),
      unit: "USD"
    }));
    merged.liabilities = migratedLiabilities;
  }

  merged.liabilities = (merged.liabilities || []).map((r) => ({
    name: String(r.name || ""),
    amount: Number(r.amount || 0),
    unit: normalizeUnit(r.unit)
  }));

  const manual = Number(merged.manualBtcusd);
  merged.manualBtcusd = Number.isFinite(manual) && manual > 0 ? manual : null;
  merged.useManualBtcusd = Boolean(merged.useManualBtcusd) && Number.isFinite(merged.manualBtcusd);
  return merged;
}

// ── Client-side AES-GCM encryption (Web Crypto API) ─────────────────────────

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function deriveAesKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 210_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptText(plaintext, password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveAesKey(password, salt);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, key, enc.encode(plaintext)
  );
  // Format: base64(salt) + "." + base64(iv) + "." + base64(ciphertext)
  return `${bytesToBase64(salt)}.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipherBuf))}`;
}

async function decryptText(payload, password) {
  const parts = payload.split(".");
  if (parts.length !== 3) throw new Error("Invalid encrypted payload");
  const salt   = base64ToBytes(parts[0]);
  const iv     = base64ToBytes(parts[1]);
  const cipher = base64ToBytes(parts[2]);
  const key    = await deriveAesKey(password, salt);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(plainBuf);
}

async function promptForPassword({
  confirm: needConfirm = false,
  message = "",
  validator = null,
  extraActionLabel = "",
  extraActionValue = null,
  extraActionClassName = ""
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "enc-overlay";

    const box = document.createElement("div");
    box.className = "enc-dialog";

    const msg = document.createElement("p");
    msg.textContent = message || (needConfirm ? "Set a password to encrypt your live data." : "Enter your password to unlock live data.");
    box.appendChild(msg);

    const pwInput = document.createElement("input");
    pwInput.type = "password";
    pwInput.placeholder = "Password";
    pwInput.className = "enc-input";
    box.appendChild(pwInput);

    let confirmInput = null;
    if (needConfirm) {
      confirmInput = document.createElement("input");
      confirmInput.type = "password";
      confirmInput.placeholder = "Confirm password";
      confirmInput.className = "enc-input";
      box.appendChild(confirmInput);
    }

    const errMsg = document.createElement("p");
    errMsg.className = "enc-error";
    errMsg.style.display = "none";
    box.appendChild(errMsg);

    const btnRow = document.createElement("div");
    btnRow.className = "enc-btn-row";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.className = "enc-btn enc-btn-cancel";
    cancelBtn.type = "button";

    let extraBtn = null;
    if (extraActionLabel) {
      extraBtn = document.createElement("button");
      extraBtn.textContent = extraActionLabel;
      extraBtn.className = `enc-btn ${extraActionClassName || "enc-btn-cancel"}`;
      extraBtn.type = "button";
    }

    const okBtn = document.createElement("button");
    okBtn.textContent = needConfirm ? "Set password" : "Unlock";
    okBtn.className = "enc-btn enc-btn-ok";
    okBtn.type = "button";

    if (extraBtn) btnRow.appendChild(extraBtn);
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(okBtn);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const cleanup = (val) => {
      document.body.removeChild(overlay);
      resolve(val);
    };

    cancelBtn.addEventListener("click", () => cleanup(null));
    if (extraBtn) {
      extraBtn.addEventListener("click", () => cleanup(extraActionValue));
    }
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(null); });

    const submit = async () => {
      const pw = pwInput.value;
      if (!pw) {
        errMsg.textContent = "Password cannot be empty.";
        errMsg.style.display = "";
        return;
      }
      if (confirmInput && pw !== confirmInput.value) {
        errMsg.textContent = "Passwords do not match.";
        errMsg.style.display = "";
        return;
      }
      if (validator) {
        okBtn.disabled = true;
        cancelBtn.disabled = true;
        if (extraBtn) extraBtn.disabled = true;
        const err = await validator(pw);
        okBtn.disabled = false;
        cancelBtn.disabled = false;
        if (extraBtn) extraBtn.disabled = false;
        if (err) {
          errMsg.textContent = err;
          errMsg.style.display = "";
          pwInput.select();
          pwInput.focus();
          return;
        }
      }
      cleanup(pw);
    };

    okBtn.addEventListener("click", submit);
    pwInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    if (confirmInput) confirmInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

    setTimeout(() => pwInput.focus(), 50);
  });
}

// Parse my_history.csv text into snapshots array.
function parseLiveHistoryCsv(text, { legacyUnitSelections = null } = {}) {
  if (!text || !text.trim()) {
    const empty = [];
    empty._legacyConverted = false;
    return empty;
  }
  try {
    const isLegacy = isLegacyHistoryCsv(text);
    const rows = parseCsv(text);
    const parsed = rows.map((row) => {
      const mmddyyDate = parseCsvDateToMMDDYY(row.date);
      if (!mmddyyDate) return null;

      const btcusd = Number(row.btcusd || historicalPrices[mmddyyDate] || formState.btcusd || 0);
      let assets = [];
      let liabilities = [];

      if (isLegacy) {
        const usdAssets = parseLegacyDictField(row.assets_usd || row.assets);
        const btcAssets = parseLegacyDictField(row.assets_btc);
        const usdLiabs = parseLegacyDictField(row.liabilities_usd || row.liabilities);
        const btcLiabs = parseLegacyDictField(row.liabilities_btc);

        const assetNames = new Set([
          ...Object.keys(usdAssets || {}),
          ...Object.keys(btcAssets || {}),
          ...Object.keys((legacyUnitSelections && legacyUnitSelections.assets) || {})
        ]);
        const liabilityNames = new Set([
          ...Object.keys(usdLiabs || {}),
          ...Object.keys(btcLiabs || {}),
          ...Object.keys((legacyUnitSelections && legacyUnitSelections.liabilities) || {})
        ]);

        const pickRows = (names, usdDict, btcDict, selectedUnits = {}) => {
          const out = [];
          names.forEach((rawName) => {
            const name = String(rawName || "").trim();
            if (!name) return;
            const chosen = String(selectedUnits[name] || "USD");
            const usdValRaw = Number(usdDict?.[name]);
            const btcValRaw = Number(btcDict?.[name]);
            let usdVal = Number.isFinite(usdValRaw) ? usdValRaw : NaN;
            let btcVal = Number.isFinite(btcValRaw) ? btcValRaw : NaN;
            const fx = Number.isFinite(btcusd) && btcusd > 0 ? btcusd : NaN;

            // Legacy files normally store both USD and BTC dictionaries for the same items.
            // If one side is missing, derive it from the other using row BTCUSD.
            if (!Number.isFinite(usdVal) && Number.isFinite(btcVal) && Number.isFinite(fx)) {
              usdVal = btcVal * fx;
            }
            if (!Number.isFinite(btcVal) && Number.isFinite(usdVal) && Number.isFinite(fx)) {
              btcVal = usdVal / fx;
            }

            let value = 0;
            let unit = "USD";

            if (chosen === "BTC") {
              unit = "BTC";
              value = Number.isFinite(btcVal) ? btcVal : 0;
            } else if (chosen === "sats") {
              unit = "sats";
              value = Number.isFinite(btcVal) ? btcVal * 100000000 : 0;
            } else {
              unit = "USD";
              value = Number.isFinite(usdVal) ? usdVal : 0;
            }

            if (!Number.isFinite(value) || value === 0) return;
            out.push({ name, value, unit });
          });
          return out;
        };

        assets = pickRows(
          assetNames,
          usdAssets,
          btcAssets,
          (legacyUnitSelections && legacyUnitSelections.assets) || {}
        );
        liabilities = pickRows(
          liabilityNames,
          usdLiabs,
          btcLiabs,
          (legacyUnitSelections && legacyUnitSelections.liabilities) || {}
        );
      } else {
        assets = typeof row.assets === "string" ? JSON.parse(row.assets) : (row.assets || []);
        liabilities = typeof row.liabilities === "string" ? JSON.parse(row.liabilities) : (row.liabilities || []);
      }

      if (!Array.isArray(assets)) assets = [];
      if (!Array.isArray(liabilities)) liabilities = [];

      return {
        date: mmddyyDate,
        timestamp: row.timestamp || parseMMDDYY(mmddyyDate).toISOString(),
        btcusd,
        assets,
        liabilities,
        comments: row.comment || row.comments || "",
        totals: computeTotals(assets, liabilities, btcusd, mmddyyDate)
      };
    }).filter(Boolean);

    parsed._legacyConverted = isLegacy;
    return parsed;
  } catch {
    const empty = [];
    empty._legacyConverted = false;
    return empty;
  }
}

// Serialize snapshots to CSV string for my_history.csv.
function snapshotsToCsv(snaps) {
  const sorted = snaps.slice().sort((a, b) => parseMMDDYY(b.date) - parseMMDDYY(a.date));
  const header = "date,assets,liabilities,comment";
  const rows = sorted.map((s) => {
    const yyyymmdd = mmddyyToInputValue(s.date).replaceAll("-", "");
    const assets = JSON.stringify(s.assets || []);
    const liabilities = JSON.stringify(s.liabilities || []);
    const comment = String(s.comments || "");
    // CSV-quote each field that may contain commas or quotes
    const q = (v) => `"${String(v).replaceAll('"', '""')}"`;
    return `${yyyymmdd},${q(assets)},${q(liabilities)},${q(comment)}`;
  });
  return [header, ...rows].join("\n");
}

function csvHeaderNames(text) {
  const normalized = String(text || "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n").filter((l) => l.trim());
  if (!lines.length) return [];
  return parseCsvRow(lines[0]).map((h) => String(h || "").trim().replace(/^\uFEFF/, "").toLowerCase());
}

function isLegacyHistoryCsv(text) {
  const headers = csvHeaderNames(text);
  if (!headers.length) return false;
  return headers.includes("assets_usd")
    || headers.includes("liabilities_usd")
    || headers.includes("assets_btc")
    || headers.includes("liabilities_btc");
}

function parseCsvDateToMMDDYY(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d{8}$/.test(raw)) return yyyymmddToMMDDYY(raw);

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slash) {
    const mm = String(Number(slash[1])).padStart(2, "0");
    const dd = String(Number(slash[2])).padStart(2, "0");
    const yyRaw = String(slash[3]);
    const yy = yyRaw.length === 4 ? yyRaw.slice(-2) : yyRaw.padStart(2, "0");
    return `${mm}${dd}${yy}`;
  }

  const dash = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dash) {
    return `${dash[2]}${dash[3]}${dash[1].slice(-2)}`;
  }
  return null;
}

function parseLegacyDictField(rawValue) {
  if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) return rawValue;
  const text = String(rawValue || "").trim();
  if (!text) return {};

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // Fall through and try Python-dict style parsing.
  }

  try {
    const normalized = text
      .replace(/([{,]\s*)'([^']*)'\s*:/g, '$1"$2":')
      .replace(/:\s*'([^']*)'/g, ': "$1"');
    const parsed = JSON.parse(normalized);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // Ignore malformed dictionaries.
  }
  return {};
}

function collectLegacyFieldNames(rows, kind) {
  const usdKey = `${kind}_usd`;
  const btcKey = `${kind}_btc`;
  const fallbackKey = kind;
  const names = new Set();
  rows.forEach((row) => {
    const usdDict = parseLegacyDictField(row[usdKey] || row[fallbackKey]);
    const btcDict = parseLegacyDictField(row[btcKey]);
    Object.keys(usdDict).forEach((k) => { if (k) names.add(String(k).trim()); });
    Object.keys(btcDict).forEach((k) => { if (k) names.add(String(k).trim()); });
  });
  return Array.from(names).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

async function promptForLegacyUnitSelections(rawCsv, filename = "") {
  const rows = parseCsv(rawCsv);
  const assetNames = collectLegacyFieldNames(rows, "assets");
  const liabilityNames = collectLegacyFieldNames(rows, "liabilities");

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "enc-overlay";

    const box = document.createElement("div");
    box.className = "enc-dialog legacy-convert-dialog";

    const title = document.createElement("p");
    title.className = "legacy-convert-title";
    title.textContent = "Legacy file detected";
    box.appendChild(title);

    const msg = document.createElement("p");
    msg.textContent = `${filename || "This file"} uses the old dashboard format. Choose units for each item before conversion.`;
    box.appendChild(msg);

    const makeSection = (headingText, names) => {
      const section = document.createElement("div");
      section.className = "legacy-convert-section";

      const heading = document.createElement("div");
      heading.className = "legacy-convert-heading";
      heading.textContent = headingText;
      section.appendChild(heading);

      if (!names.length) {
        const empty = document.createElement("div");
        empty.className = "legacy-convert-empty";
        empty.textContent = "No items found";
        section.appendChild(empty);
        return { section, selects: new Map() };
      }

      const list = document.createElement("div");
      list.className = "legacy-convert-list";
      const selects = new Map();
      names.forEach((name) => {
        const row = document.createElement("label");
        row.className = "legacy-convert-row";

        const nameEl = document.createElement("span");
        nameEl.className = "legacy-convert-name";
        nameEl.textContent = name;

        const sel = document.createElement("select");
        sel.className = "legacy-convert-select";
        ["USD", "BTC", "sats"].forEach((unit) => {
          const opt = document.createElement("option");
          opt.value = unit;
          opt.textContent = unit;
          if (unit === "USD") opt.selected = true;
          sel.appendChild(opt);
        });

        row.appendChild(nameEl);
        row.appendChild(sel);
        list.appendChild(row);
        selects.set(name, sel);
      });
      section.appendChild(list);
      return { section, selects };
    };

    const assetsSection = makeSection("Assets", assetNames);
    const liabsSection = makeSection("Liabilities", liabilityNames);
    box.appendChild(assetsSection.section);
    box.appendChild(liabsSection.section);

    const btnRow = document.createElement("div");
    btnRow.className = "enc-btn-row";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.className = "enc-btn enc-btn-cancel";
    cancelBtn.type = "button";

    const okBtn = document.createElement("button");
    okBtn.textContent = "Convert File";
    okBtn.className = "enc-btn enc-btn-ok";
    okBtn.type = "button";

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(okBtn);
    box.appendChild(btnRow);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const cleanup = (val) => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      resolve(val);
    };

    cancelBtn.addEventListener("click", () => cleanup(null));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(null); });

    okBtn.addEventListener("click", () => {
      const selected = {
        assets: {},
        liabilities: {}
      };
      assetsSection.selects.forEach((sel, name) => {
        selected.assets[name] = sel.value || "USD";
      });
      liabsSection.selects.forEach((sel, name) => {
        selected.liabilities[name] = sel.value || "USD";
      });
      cleanup(selected);
    });
  });
}

function hasCommentCsvColumn(text) {
  const headers = csvHeaderNames(text);
  return headers.includes("comment") || headers.includes("comments");
}

async function migrateCsvToIncludeCommentColumnIfMissing(rawCsv, parsedSnapshots, {
  encrypted = false,
  filename = null
} = {}) {
  void parsedSnapshots;
  void encrypted;
  void filename;
  const needsLegacyUpgrade = isLegacyHistoryCsv(rawCsv);
  const needsCommentUpgrade = !hasCommentCsvColumn(rawCsv);
  if (!needsLegacyUpgrade && !needsCommentUpgrade) return;
}

async function parseHistoryCsvWithLegacyPrompt(rawCsv, filename, { encrypted = false } = {}) {
  if (!isLegacyHistoryCsv(rawCsv)) {
    return { parsed: parseLiveHistoryCsv(rawCsv), cancelled: false };
  }

  const selections = await promptForLegacyUnitSelections(rawCsv, filename);
  if (!selections) {
    return { parsed: [], cancelled: true };
  }

  const parsed = parseLiveHistoryCsv(rawCsv, { legacyUnitSelections: selections });
  await migrateCsvToIncludeCommentColumnIfMissing(rawCsv, parsed, {
    encrypted,
    filename
  });
  return { parsed, cancelled: false };
}

function resetLiveDataToEmpty() {
  const prevBtcusd = formState.btcusd;
  const prevManualBtcusd = formState.manualBtcusd;
  const prevUseManual = formState.useManualBtcusd;

  snapshots = [];
  formState = structuredClone(DEFAULT_FORM_LIVE);
  formState.btcusd = prevBtcusd;
  formState.manualBtcusd = prevManualBtcusd;
  formState.useManualBtcusd = prevUseManual;

  liveAccessLocked = false;
  liveEncryptionEnabled = false;
  liveEncryptionPassword = null;
  liveHistoryFile = "";
  localStorage.removeItem(LIVE_HISTORY_FILE_KEY);
  localStorage.setItem(LIVE_ENCRYPTION_ENABLED_KEY, "0");
  localStorage.setItem(STORE_KEY_LIVE, JSON.stringify([]));
  localStorage.setItem(FORM_KEY_LIVE, JSON.stringify(formState));
  localStorage.removeItem(STORE_KEY_LIVE_ENC);
  localStorage.removeItem(FORM_KEY_LIVE_ENC);
  if (el.liveEncryptionEnabled) el.liveEncryptionEnabled.checked = false;

  editingSnapshotDate = mmddyy(new Date());
  hasUnsavedAssetLiabilityChanges = false;
  hoveredSnapshotDate = null;
  chartRange = { startDate: null, endDate: null };
  netChartRange = { startDate: null, endDate: null };
  alChartRange = { startDate: null, endDate: null };
  if (el.chartStartDate) el.chartStartDate.value = "";
  if (el.chartEndDate) el.chartEndDate.value = "";
  closeAllFilterDropdowns();
  updateModeToggleUI();
  renderAll();
}

function forceDashboardToDemoMode() {
  currentMode = "demo";
  localStorage.setItem(MODE_KEY, currentMode);
  liveAccessLocked = false;
  liveEncryptionPassword = null;

  hoveredSnapshotDate = null;
  chartRange = { startDate: null, endDate: null };
  netChartRange = { startDate: null, endDate: null };
  alChartRange = { startDate: null, endDate: null };
  if (el.chartStartDate) el.chartStartDate.value = "";
  if (el.chartEndDate) el.chartEndDate.value = "";

  loadFilters(currentMode);
  snapshots = loadSnapshots();
  formState = freshFormState("demo");
  seedTodayFormStateFromHistory({ save: true });
  formState.useManualBtcusd = false;
  formState.manualBtcusd = null;

  updateModeToggleUI();
  renderAll();
}

async function promptForPasswordWithLiveReset(options = {}) {
  const {
    forceDemoOnCancel = true,
    returnClearAction = false,
    ...promptOptions
  } = options;

  const result = await promptForPassword({
    ...promptOptions,
    extraActionLabel: "Clear Data",
    extraActionValue: RESET_LIVE_DATA_ACTION,
    extraActionClassName: "enc-btn-danger"
  });

  if (result === RESET_LIVE_DATA_ACTION) {
    const confirmed = window.confirm(
      "Clearing data will permanently delete any unsaved changes.\n\nClick Confirm to clear live data, or Cancel to keep your current data."
    );
    if (!confirmed) {
      return null;
    }
    resetLiveDataToEmpty();
    renderAll();
    return returnClearAction ? RESET_LIVE_DATA_ACTION : null;
  }

  if (!result) {
    if (forceDemoOnCancel) {
      forceDashboardToDemoMode();
    }
    return null;
  }

  return result;
}

async function promptUnlockOrResetLiveData() {
  const result = await promptForPasswordWithLiveReset({
    confirm: false,
    message: "Live data is locked. Enter your password to unlock, or reset live data to empty.",
    validator: async (p) => {
      const ok = await unlockLiveEncryptedData(p);
      return ok ? null : "Incorrect password. Please try again.";
    }
  });

  if (!result) return;

  liveEncryptionPassword = result;
  liveAccessLocked = false;
  if (el.liveEncryptionEnabled) el.liveEncryptionEnabled.checked = true;
  seedTodayFormStateFromHistory({ save: true });
  updateModeToggleUI();
  renderAll();
}

async function handleLockDataButtonClick() {
  if (currentMode !== "live" || !liveEncryptionEnabled) return;
  if (!liveAccessLocked) {
    setLiveAccessLocked();
  }
  await promptUnlockOrResetLiveData();
}

function baseHistoryFilename() {
  const raw = String(liveHistoryFile || "live_history").trim();
  const stem = raw.replace(/\.(csv|enc)$/i, "") || "live_history";
  return stem.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

async function saveContentToFile({ content, mimeType, extension, description }) {
  const suggestedName = `${baseHistoryFilename()}${extension}`;
  const canPick = typeof window.showSaveFilePicker === "function";

  if (canPick) {
    const picker = await window.showSaveFilePicker({
      suggestedName,
      types: [{
        description,
        accept: { [mimeType]: [extension] }
      }]
    });
    const writable = await picker.createWritable();
    await writable.write(content);
    await writable.close();
    return;
  }

  // Fallback for browsers without File System Access API.
  download(suggestedName, content, mimeType);
}

async function handleSaveDataButtonClick() {
  if (currentMode !== "live") {
    alert("Switch to Live mode to save a CSV or ENC file.");
    return;
  }
  if (liveAccessLocked) {
    alert("Unlock live data before saving.");
    return;
  }

  const isEncrypted = Boolean(liveEncryptionEnabled);
  const csv = snapshotsToCsv(snapshots);

  try {
    if (isEncrypted) {
      let password = liveEncryptionPassword;
      if (!password) {
        const pw = await promptForPasswordWithLiveReset({
          confirm: false,
          message: "Enter your encryption password to save the ENC file.",
          validator: async (p) => {
            const ok = await unlockLiveEncryptedData(p);
            return ok ? null : "Incorrect password. Please try again.";
          }
        });
        if (!pw) return;
        password = pw;
        liveEncryptionPassword = pw;
      }

      const encryptedPayload = await encryptText(csv, password);
      await saveContentToFile({
        content: encryptedPayload,
        mimeType: "text/plain",
        extension: ".enc",
        description: "Encrypted History File"
      });
      return;
    }

    await saveContentToFile({
      content: csv,
      mimeType: "text/csv",
      extension: ".csv",
      description: "CSV History File"
    });
  } catch (err) {
    // Ignore abort errors from cancelled save dialogs.
    if (err && (err.name === "AbortError" || err.message === "The user aborted a request.")) return;
    const reason = (err && err.message) ? err.message : String(err);
    alert(`Could not save file: ${reason}`);
  }
}

async function importLiveFileFromLocal(file) {
  if (!(file instanceof File)) return;
  const filename = String(file.name || "").trim();
  if (!filename) return;

  const lower = filename.toLowerCase();
  const isCsv = lower.endsWith(".csv");
  const isEnc = lower.endsWith(".enc");
  if (!isCsv && !isEnc) {
    alert("Unsupported file type. Please choose a .csv or .enc file.");
    return;
  }

  try {
    const raw = await file.text();
    if (!raw || !raw.trim()) {
      alert("The selected file is empty.");
      return;
    }

    let parsedSnapshots = [];
    let encPassword = null;

    if (isEnc) {
      const pw = await promptForPasswordWithLiveReset({
        confirm: false,
        message: `Enter password for ${filename}.`,
        validator: async (entered) => {
          try {
            await decryptText(raw, entered);
            return null;
          } catch {
            return "Incorrect password. Please try again.";
          }
        }
      });
      if (!pw) return;
      encPassword = pw;
      const plain = await decryptText(raw, pw);
      const result = await parseHistoryCsvWithLegacyPrompt(plain, filename, { encrypted: true });
      if (result.cancelled) return;
      parsedSnapshots = result.parsed;
    } else {
      const result = await parseHistoryCsvWithLegacyPrompt(raw, filename, { encrypted: false });
      if (result.cancelled) return;
      parsedSnapshots = result.parsed;
    }

    snapshots = Array.isArray(parsedSnapshots)
      ? parsedSnapshots.slice().sort((a, b) => parseMMDDYY(b.date) - parseMMDDYY(a.date))
      : [];

    const prevBtcusd = formState.btcusd;
    const prevManualBtcusd = formState.manualBtcusd;
    const prevUseManual = formState.useManualBtcusd;

    formState = structuredClone(DEFAULT_FORM_LIVE);
    formState.btcusd = prevBtcusd;
    formState.manualBtcusd = prevManualBtcusd;
    formState.useManualBtcusd = prevUseManual;

    liveHistoryFile = filename;
    persistLiveFileSelection(liveHistoryFile);
    liveAccessLocked = false;

    if (isEnc) {
      liveEncryptionEnabled = true;
      liveEncryptionPassword = encPassword;
      if (el.liveEncryptionEnabled) el.liveEncryptionEnabled.checked = true;
      localStorage.setItem(LIVE_ENCRYPTION_ENABLED_KEY, "1");
      localStorage.setItem(STORE_KEY_LIVE_ENC, raw);
      localStorage.removeItem(STORE_KEY_LIVE);
      localStorage.removeItem(FORM_KEY_LIVE);
    } else {
      liveEncryptionEnabled = false;
      liveEncryptionPassword = null;
      if (el.liveEncryptionEnabled) el.liveEncryptionEnabled.checked = false;
      localStorage.setItem(LIVE_ENCRYPTION_ENABLED_KEY, "0");
      localStorage.setItem(STORE_KEY_LIVE, JSON.stringify(snapshots));
      localStorage.removeItem(STORE_KEY_LIVE_ENC);
      localStorage.removeItem(FORM_KEY_LIVE_ENC);
    }

    seedTodayFormStateFromHistory({ save: true });
    saveSnapshots();
    renderAll();
    updateModeToggleUI();
  } catch (err) {
    const reason = (err && err.message) ? err.message : String(err);
    alert(`Could not load file: ${reason}`);
  }
}

function setLiveAccessLocked() {
  const prevBtcusd = formState.btcusd;
  const prevManualBtcusd = formState.manualBtcusd;
  const prevUseManual = formState.useManualBtcusd;

  liveAccessLocked = true;
  liveEncryptionPassword = null;
  liveHistoryFile = "";
  localStorage.removeItem(LIVE_HISTORY_FILE_KEY);
  snapshots = [];
  formState = structuredClone(DEFAULT_FORM_LIVE);
  formState.btcusd = prevBtcusd;
  formState.manualBtcusd = prevManualBtcusd;
  formState.useManualBtcusd = prevUseManual;
  editingSnapshotDate = mmddyy(new Date());
  hasUnsavedAssetLiabilityChanges = false;
  hoveredSnapshotDate = null;
  chartRange = { startDate: null, endDate: null };
  netChartRange = { startDate: null, endDate: null };
  alChartRange = { startDate: null, endDate: null };
  if (el.chartStartDate) el.chartStartDate.value = "";
  if (el.chartEndDate) el.chartEndDate.value = "";
  closeAllFilterDropdowns();
  updateModeToggleUI();
  renderAll();
}

function loadForm() {
  // Synchronous path: demo mode, or live without encryption.
  // Encrypted live data is loaded separately via loadLiveEncryptedData().
  const key = currentMode === "demo" ? FORM_KEY_DEMO : FORM_KEY_LIVE;
  const defaultForm = currentMode === "demo" ? DEFAULT_FORM_DEMO : DEFAULT_FORM_LIVE;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return structuredClone(defaultForm);
    return parseFormFromRaw(raw, defaultForm);
  } catch {
    const defaultForm = currentMode === "demo" ? DEFAULT_FORM_DEMO : DEFAULT_FORM_LIVE;
    return structuredClone(defaultForm);
  }
}

function saveForm() {
  if (currentMode === "live" && liveEncryptionEnabled && liveEncryptionPassword) {
    // Fire-and-forget async encrypt save
    encryptText(JSON.stringify(formState), liveEncryptionPassword)
      .then((enc) => localStorage.setItem(FORM_KEY_LIVE_ENC, enc))
      .catch(() => {});
    return;
  }
  const key = currentMode === "demo" ? FORM_KEY_DEMO : FORM_KEY_LIVE;
  localStorage.setItem(key, JSON.stringify(formState));
}

function loadSnapshots() {
  try {
    // Keep encrypted live hidden until explicit unlock.
    if (currentMode === "live" && liveEncryptionEnabled) return [];
    const key = currentMode === "demo" ? STORE_KEY_DEMO : STORE_KEY_LIVE;
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return parseSnapshotsRaw(raw);
  } catch {
    return [];
  }
}

function saveSnapshots() {
  if (currentMode === "live") {
    if (liveAccessLocked) return;
    // Web version: always save to localStorage (no local server available)
    if (liveEncryptionEnabled && liveEncryptionPassword) {
      encryptText(JSON.stringify(snapshots), liveEncryptionPassword)
        .then((enc) => localStorage.setItem(STORE_KEY_LIVE_ENC, enc))
        .catch(() => {});
    } else {
      const sorted = snapshots.slice().sort((a, b) => parseMMDDYY(b.date) - parseMMDDYY(a.date));
      localStorage.setItem(STORE_KEY_LIVE, JSON.stringify(sorted));
    }
    return;
  }
  // Demo mode: localStorage-only in website dashboard.
  const sorted = snapshots.slice().sort((a, b) => parseMMDDYY(b.date) - parseMMDDYY(a.date));
  localStorage.setItem(STORE_KEY_DEMO, JSON.stringify(sorted));
}

async function refreshQuote({ background = false } = {}) {
  if (quoteRefreshInFlight) return;
  quoteRefreshInFlight = true;
  quoteRefreshAbortController = new AbortController();
  try {
    const response = await fetch(KRAKEN_URL, { cache: "no-cache", signal: quoteRefreshAbortController.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const usdcusd = Number(payload.result.USDCUSD.a[0]);
    const btcusdc = Number(payload.result.XBTUSDC.a[0]);
    const price = btcusdc / usdcusd;
    formState.btcusd = price;
    lastQuoteRefreshAt = new Date();
    // Persist price globally so it survives mode/file switches.
    localStorage.setItem(BTCUSD_CACHE_KEY, String(price));
    // Refresh always returns the UI to live exchange rate mode.
    formState.useManualBtcusd = false;
    formState.manualBtcusd = null;
    manualEditedThisSession = false;
    saveForm();

    // Also update the other mode's stored price so today's row is current in both modes
    const otherKey = currentMode === "demo" ? FORM_KEY_LIVE : FORM_KEY_DEMO;
    try {
      const otherRaw = localStorage.getItem(otherKey);
      const otherForm = otherRaw ? JSON.parse(otherRaw) : {};
      otherForm.btcusd = price;
      if (!otherForm.useManualBtcusd) {
        otherForm.manualBtcusd = price;
      }
      localStorage.setItem(otherKey, JSON.stringify(otherForm));
    } catch { /* ignore */ }

    if (background) {
      if (isAssetLiabilityEditorFocused()) {
        pendingQuoteUiUpdate = true;
      } else {
        applyBackgroundQuoteUiRefresh();
      }
    } else {
      renderAll();
    }
  } catch (err) {
    if (err && err.name === "AbortError") {
      // Expected when editor focus starts during an in-flight background refresh.
    } else {
      el.quoteTime.textContent = `Quote refresh failed: ${String(err)}`;
    }
  } finally {
    quoteRefreshAbortController = null;
    quoteRefreshInFlight = false;
  }
}

function isAssetLiabilityEditorFocused() {
  if (editorRowsFocused) return true;
  syncEditorRowsFocusedFromDom();
  return editorRowsFocused;
}

function applyBackgroundQuoteUiRefresh() {
  const manualActive = isManualOverrideActive();
  const manualDisplayValue = manualActive
    ? Number(formState.manualBtcusd)
    : Number(formState.btcusd || 0);
  if (document.activeElement !== el.manualBtcusd) {
    el.manualBtcusd.value = manualDisplayValue > 0 ? formatUsd(manualDisplayValue) : "";
  }
  el.quoteTime.textContent = manualActive
    ? "Manual price override"
    : (formState.btcusd ? `Updated · ${formatQuoteTimestamp(lastQuoteRefreshAt || new Date())}` : "No quote loaded");
  updateKPIs();
  renderHistoryTable();
  renderChartsOnly();
}

function flushDeferredQuoteUiRefresh() {
  if (isAssetLiabilityEditorFocused()) return;
  if (pendingBackgroundQuoteRefresh) {
    if (!quoteRefreshInFlight) {
      pendingBackgroundQuoteRefresh = false;
      void refreshQuote({ background: true });
    }
    return;
  }
  if (!pendingQuoteUiUpdate) return;
  pendingQuoteUiUpdate = false;
  applyBackgroundQuoteUiRefresh();
}

function commitManualQuote() {
  const before = consumeEditorFieldBaseline(el.manualBtcusd);
  runTrackedActionFromBefore("manual-btcusd", before, () => {
    const raw = el.manualBtcusd.value.replace(/[$,]/g, "").trim();
    if (!raw) {
      formState.manualBtcusd = Number(formState.btcusd || 0) || null;
      activateManualSource();
      return;
    }
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) {
      renderAll();
      return;
    }
    manualEditedThisSession = true;
    formState.manualBtcusd = num;
    activateManualSource();
  });
}

function activateManualSource() {
  if (!Number.isFinite(Number(formState.manualBtcusd)) || Number(formState.manualBtcusd) <= 0) {
    const fallback = Number(formState.btcusd || 0);
    formState.manualBtcusd = fallback > 0 ? fallback : null;
  }
  if (!Number.isFinite(Number(formState.manualBtcusd)) || Number(formState.manualBtcusd) <= 0) {
    formState.useManualBtcusd = false;
    saveForm();
    renderAll();
    return;
  }
  formState.useManualBtcusd = true;
  saveForm();
  renderAll();
}

function isManualOverrideActive() {
  return Boolean(formState.useManualBtcusd) && Number.isFinite(Number(formState.manualBtcusd)) && Number(formState.manualBtcusd) > 0;
}

function activeBtcusd() {
  if (isManualOverrideActive()) {
    return Number(formState.manualBtcusd);
  }
  return Number(formState.btcusd || 0);
}

function addRow(target) {
  const map = {
    assetsRows: "assets",
    liabilitiesRows: "liabilities"
  };
  const key = map[target];
  if (!key) return;
  runTrackedAction("row-add", () => {
    formState[key].unshift({ name: "", amount: 0, unit: "USD", _fresh: true });
    hasUnsavedAssetLiabilityChanges = true;
    pendingRowFocus = { key, idx: 0 };
    saveForm();
    persistSnapshotForActiveSelection({ render: true, onlyIfDirty: true, trackAction: false });
  });
}

function removeRow(key, idx) {
  runTrackedAction("row-delete", () => {
    formState[key].splice(idx, 1);
    hasUnsavedAssetLiabilityChanges = true;
    saveForm();
    persistSnapshotForActiveSelection({ render: true, onlyIfDirty: true, trackAction: false });
  });
}

function canonicalRowName(name) {
  return String(name || "").trim().toLowerCase();
}

function duplicateRowIndices(rows) {
  const counts = new Map();
  const duplicates = new Set();
  (rows || []).forEach((row) => {
    const key = canonicalRowName(row?.name);
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  (rows || []).forEach((row, idx) => {
    const key = canonicalRowName(row?.name);
    if (!key) return;
    if ((counts.get(key) || 0) > 1) {
      duplicates.add(idx);
    }
  });
  return duplicates;
}

function uniqueValidRows(rows) {
  const seen = new Set();
  const unique = [];
  (rows || []).slice().reverse().forEach((row) => {
    const name = String(row?.name || "").trim();
    const amountSource = typeof row?.amount !== "undefined" ? row.amount : row?.value;
    const amount = parseRowAmount(amountSource);
    const unit = normalizeUnit(row?.unit);
    const key = canonicalRowName(name);
    if (!key || !Number.isFinite(amount) || seen.has(key)) return;
    seen.add(key);
    unique.unshift({ name, amount, unit });
  });
  return unique;
}

function parseRowAmount(value) {
  if (value === "" || value === null || typeof value === "undefined") return NaN;
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

function isRowComplete(row) {
  const name = String(row.name || "").trim();
  const amount = parseRowAmount(row.amount);
  return Boolean(name) && Number.isFinite(amount);
}

function mmddyyToIsoOrToday(dateKey) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) return String(dateKey);
  return mmddyyToInputValue(dateKey || editingSnapshotDate || mmddyy(new Date())) || new Date().toISOString().slice(0, 10);
}

function fxDateOnOrBefore(isoDate) {
  if (!fxRateDates.length) return null;
  let lo = 0;
  let hi = fxRateDates.length - 1;
  let best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fxRateDates[mid] <= isoDate) {
      best = fxRateDates[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function usdPerUnit(unitRaw, btcusdRaw, dateKey) {
  const unit = normalizeUnit(unitRaw);
  const btcusd = Math.max(Number(btcusdRaw || 0), 1e-12);
  if (unit === "BTC") return btcusd;
  if (unit === "sats") return btcusd / 1e8;
  if (unit === "USD") return 1;
  const iso = mmddyyToIsoOrToday(dateKey);
  const row = fxRatesByDate.get(iso) || fxRatesByDate.get(fxDateOnOrBefore(iso));
  const value = Number(row?.[unit]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function rowValueInUsd(row, btcusdRaw, dateKey) {
  const amount = parseRowAmount(typeof row?.amount !== "undefined" ? row.amount : row?.value);
  if (!Number.isFinite(amount)) return 0;
  const rate = usdPerUnit(row?.unit, btcusdRaw, dateKey);
  if (rate === null) return 0;
  return amount * rate;
}

function usdToUnitValue(usdValue, unitRaw, btcusdRaw, dateKey) {
  const parsedUsd = Number(usdValue || 0);
  const rate = usdPerUnit(unitRaw, btcusdRaw, dateKey);
  if (rate === null || rate <= 0) return null;
  return parsedUsd / rate;
}

function splitAssetRows(rows, btcusdOverride = null, dateKeyOverride = null) {
  const assetsBtc = {};
  const assetsUsd = {};
  const dateKey = dateKeyOverride || editingSnapshotDate || mmddyy(new Date());
  const btcusd = btcusdOverride === null ? activeBtcusd() : Number(btcusdOverride || 0);

  uniqueValidRows(rows).forEach((r) => {
    const name = r.name;
    const usdValue = rowValueInUsd(r, btcusd, dateKey);
    assetsUsd[name] = (assetsUsd[name] || 0) + usdValue;
  });

  return { assetsBtc, assetsUsd };
}

function splitLiabilityRows(rows, btcusdOverride = null, dateKeyOverride = null) {
  const liabilitiesBtc = {};
  const liabilitiesUsd = {};
  const dateKey = dateKeyOverride || editingSnapshotDate || mmddyy(new Date());
  const btcusd = btcusdOverride === null ? activeBtcusd() : Number(btcusdOverride || 0);

  uniqueValidRows(rows).forEach((r) => {
    const name = r.name;
    const usdValue = rowValueInUsd(r, btcusd, dateKey);
    liabilitiesUsd[name] = (liabilitiesUsd[name] || 0) + usdValue;
  });

  return { liabilitiesBtc, liabilitiesUsd };
}

function normalizedSnapshot(btcusdOverride = null) {
  const sourcePrice = btcusdOverride === null ? Number(formState.btcusd || 0) : Number(btcusdOverride || 0);
  const btcusd = Math.max(sourcePrice, 1e-12);
  const uniqueAssets = uniqueValidRows(formState.assets || []);
  const uniqueLiabilities = uniqueValidRows(formState.liabilities || []);
  const dateKey = editingSnapshotDate || mmddyy(new Date());
  const splitAssets = splitAssetRows(formState.assets || [], btcusd, dateKey);
  const splitLiabilities = splitLiabilityRows(formState.liabilities || [], btcusd, dateKey);
  const assetsBtc = splitAssets.assetsBtc;
  const assetsUsd = splitAssets.assetsUsd;
  const liabilitiesBtc = splitLiabilities.liabilitiesBtc;
  const liabilitiesUsd = splitLiabilities.liabilitiesUsd;

  Object.entries(assetsBtc).forEach(([name, v]) => {
    assetsUsd[name] = v * btcusd;
  });
  Object.entries(assetsUsd).forEach(([name, v]) => {
    assetsBtc[name] = v / btcusd;
  });

  Object.entries(liabilitiesBtc).forEach(([name, v]) => {
    liabilitiesUsd[name] = v * btcusd;
  });
  Object.entries(liabilitiesUsd).forEach(([name, v]) => {
    liabilitiesBtc[name] = v / btcusd;
  });

  const totalAssetsBtc = sum(Object.values(assetsBtc));
  const totalAssetsUsd = sum(Object.values(assetsUsd));
  const totalLiabilitiesBtc = sum(Object.values(liabilitiesBtc));
  const totalLiabilitiesUsd = sum(Object.values(liabilitiesUsd));

  return {
    date: dateKey,
    timestamp: new Date().toISOString(),
    btcusd,
    assets: uniqueAssets.map((r) => ({ name: r.name, value: r.amount, unit: r.unit })),
    liabilities: uniqueLiabilities.map((r) => ({ name: r.name, value: r.amount, unit: r.unit })),
    comments: formState.comments || "",
    totals: {
      assets_btc: totalAssetsBtc,
      assets_usd: totalAssetsUsd,
      liabilities_btc: totalLiabilitiesBtc,
      liabilities_usd: totalLiabilitiesUsd,
      net_btc: totalAssetsBtc - totalLiabilitiesBtc,
      net_usd: totalAssetsUsd - totalLiabilitiesUsd
    }
  };
}

function sum(arr) {
  return arr.reduce((acc, n) => acc + Number(n || 0), 0);
}

function propagateNameRenameAcrossSnapshots(rowKey, oldNameRaw, newNameRaw, currentDate) {
  const oldName = String(oldNameRaw || "").trim();
  const newName = String(newNameRaw || "").trim();
  if (!oldName || !newName || oldName === newName) return;

  if (rowKey !== "assets" && rowKey !== "liabilities") return;

  for (const snap of snapshots) {
    if (snap.date === currentDate) continue;
    for (const row of (snap[rowKey] || [])) {
      if (String(row.name || "").trim() === oldName) {
        row.name = newName;
      }
    }
  }

  const excludedSet = rowKey === "assets" ? excludedAssets : excludedLiabilities;
  if (excludedSet.has(oldName)) {
    excludedSet.delete(oldName);
    excludedSet.add(newName);
  }
}

function propagateUnitChangeAcrossSnapshots(rowKey, rowNameRaw, oldUnitRaw, newUnitRaw, currentDate) {
  const rowName = String(rowNameRaw || "").trim();
  const oldUnit = normalizeUnit(oldUnitRaw);
  const newUnit = normalizeUnit(newUnitRaw);
  if (!rowName || oldUnit === newUnit) return;

  if (rowKey !== "assets" && rowKey !== "liabilities") return;

  for (const snap of snapshots) {
    if (snap.date === currentDate) continue;
    const datePrice = Number(snap.btcusd || historicalPrices[snap.date] || activeBtcusd());
    for (const row of (snap[rowKey] || [])) {
      if (String(row.name || "").trim() !== rowName) continue;
      const sourceAmount = typeof row.value !== "undefined" ? row.value : row.amount;
      const converted = convertAmountBetweenUnits(sourceAmount, oldUnit, newUnit, datePrice, snap.date);
      if (typeof row.value !== "undefined") row.value = converted;
      else row.amount = converted;
      row.unit = newUnit;
    }
  }
}

function persistSnapshotForActiveSelection({ render = true, onlyIfDirty = false, trackAction = true, actionLabel = "snapshot-update" } = {}) {
  if (currentMode === "live" && (liveAccessLocked || !liveHistoryFile)) {
    if (render) {
      editorRowsFocused = false;
      renderAll();
    }
    return;
  }

  const applyPersist = () => {
    if (onlyIfDirty && !hasUnsavedAssetLiabilityChanges) {
      if (render) {
        editorRowsFocused = false;
        renderAll();
      }
      return;
    }
    const targetDate = editingSnapshotDate || mmddyy(new Date());
    const existing = snapshots.find((s) => s.date === targetDate);

    // If all assets and liabilities have been removed, delete the snapshot entirely
    const hasAnyRows =
      (formState.assets || []).some((r) => r.name && parseRowAmount(r.amount) > 0) ||
      (formState.liabilities || []).some((r) => r.name && parseRowAmount(r.amount) > 0);
    if (!hasAnyRows && existing) {
      snapshots = snapshots.filter((s) => s.date !== targetDate);
      hasUnsavedAssetLiabilityChanges = false;
      saveSnapshots();
      if (render) {
        editorRowsFocused = false;
        renderAll();
      }
      return;
    }

    const sourcePrice = existing && Number(existing.btcusd) > 0 ? Number(existing.btcusd) : Number(formState.btcusd || 0);
    const snap = normalizedSnapshot(sourcePrice);
    snap.date = targetDate;
    snap.timestamp = existing?.timestamp || new Date().toISOString();
    
    const idx = snapshots.findIndex((s) => s.date === targetDate);
    if (idx >= 0) snapshots[idx] = snap;
    else snapshots.push(snap);
    snapshots.sort((a, b) => parseMMDDYY(a.date) - parseMMDDYY(b.date));
    hasUnsavedAssetLiabilityChanges = false;
    saveSnapshots();
    saveFilters(currentMode);
    if (render) {
      editorRowsFocused = false;
      renderAll();
    }
  };

  if (!trackAction) {
    applyPersist();
    return;
  }
  runTrackedAction(actionLabel, applyPersist);
}

function comparableRowsFromForm(rows) {
  return (rows || [])
    .map((r) => ({
      name: String(r.name || "").trim(),
      value: parseRowAmount(r.amount),
      unit: normalizeUnit(r.unit)
    }))
    .filter((r) => r.name && Number.isFinite(r.value))
    .sort((a, b) => (a.name + a.unit).localeCompare(b.name + b.unit));
}

function selectSnapshot(date) {
  const today = mmddyy(new Date());
  
  // Persist any unsaved changes to the current snapshot before switching
  if (hasUnsavedAssetLiabilityChanges && editingSnapshotDate && editingSnapshotDate !== date) {
    persistSnapshotForActiveSelection({ render: false, trackAction: true });
  }
  
  editingSnapshotDate = date;
  const snap = snapshots.find((s) => s.date === date);
  if (!snap) {
    if (date === today) {
      seedTodayFormStateFromHistory({ save: true });
      hasUnsavedAssetLiabilityChanges = false;
      saveForm();
      renderAll();
    }
    return;
  }
  formState.assets = (snap.assets || []).map((a) => ({
    name: String(a.name || ""),
    amount: parseRowAmount(a.value),
    unit: normalizeUnit(a.unit)
  }));
  formState.liabilities = (snap.liabilities || []).map((l) => ({
    name: String(l.name || ""),
    amount: parseRowAmount(l.value),
    unit: normalizeUnit(l.unit)
  }));
  formState.comments = snap.comments || "";
  hasUnsavedAssetLiabilityChanges = false;
  saveForm();
  renderAll();
}

function addSnapshotForDate(mmddyyDate) {
  if (snapshots.some((s) => s.date === mmddyyDate)) return;

  const sorted = snapshots.slice().sort((a, b) => parseMMDDYY(a.date) - parseMMDDYY(b.date));
  const targetMs = parseMMDDYY(mmddyyDate).getTime();

  let prevSnap = null;
  let nextSnap = null;
  for (const s of sorted) {
    const ms = parseMMDDYY(s.date).getTime();
    if (ms < targetMs) prevSnap = s;
    else if (ms > targetMs && !nextSnap) nextSnap = s;
  }

  const seedSnap = prevSnap || nextSnap;
  const btcusd = Number(historicalPrices[mmddyyDate] || formState.btcusd || 0);
  const assets = (seedSnap ? (seedSnap.assets || []) : []).map((a) => ({ ...a }));
  const liabilities = (seedSnap ? (seedSnap.liabilities || []) : []).map((l) => ({ ...l }));

  const newSnap = {
    date: mmddyyDate,
    timestamp: parseMMDDYY(mmddyyDate).toISOString(),
    btcusd,
    assets,
    liabilities,
    comments: "",
    totals: computeTotals(assets, liabilities, btcusd, mmddyyDate)
  };

  runTrackedAction("snapshot-add-date", () => {
    const isEarlierThanAll = prevSnap === null && sorted.length > 0;
    snapshots.push(newSnap);
    editingSnapshotDate = mmddyyDate;
    formState.assets = assets.map((a) => ({
      name: String(a.name || ""),
      amount: parseRowAmount(a.value),
      unit: normalizeUnit(a.unit)
    }));
    formState.liabilities = liabilities.map((l) => ({
      name: String(l.name || ""),
      amount: parseRowAmount(l.value),
      unit: normalizeUnit(l.unit)
    }));
    hasUnsavedAssetLiabilityChanges = false;
    saveForm();
    saveSnapshots();
    if (isEarlierThanAll) {
      el.chartStartDate.value = mmddyyToInputValue(mmddyyDate);
      chartRange = {
        startDate: mmddyyDate,
        endDate: inputValueToMMDDYY(el.chartEndDate.value) || mmddyyDate
      };
    }
    renderAll();
    setTimeout(() => {
      const activeRow = document.querySelector("#historyTableBody tr.active-snapshot");
      if (activeRow) activeRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  });
}

function deleteSnapshot(date) {
  runTrackedAction("snapshot-delete", () => {
    const idx = snapshots.findIndex((s) => s.date === date);
    if (idx < 0) return;
    const today = mmddyy(new Date());
    const deletingToday = date === today;
    snapshots.splice(idx, 1);

    if (editingSnapshotDate === date) {
      const replacement = latestSnapshot();
      if (deletingToday) {
        // Stay on today but revert form values to the most recent remaining snapshot.
        editingSnapshotDate = today;
        if (replacement) {
          formState.assets = (replacement.assets || []).map((a) => ({
            name: String(a.name || ""),
            amount: parseRowAmount(a.value),
            unit: normalizeUnit(a.unit)
          }));
          formState.liabilities = (replacement.liabilities || []).map((l) => ({
            name: String(l.name || ""),
            amount: parseRowAmount(l.value),
            unit: normalizeUnit(l.unit)
          }));
        } else {
          formState.assets = [];
          formState.liabilities = [];
        }
      } else if (replacement) {
        editingSnapshotDate = replacement.date;
        formState.assets = (replacement.assets || []).map((a) => ({
          name: String(a.name || ""),
          amount: parseRowAmount(a.value),
          unit: normalizeUnit(a.unit)
        }));
        formState.liabilities = (replacement.liabilities || []).map((l) => ({
          name: String(l.name || ""),
          amount: parseRowAmount(l.value),
          unit: normalizeUnit(l.unit)
        }));
      } else {
        editingSnapshotDate = today;
        formState.assets = [];
        formState.liabilities = [];
      }
    }

    hasUnsavedAssetLiabilityChanges = false;
    saveForm();
    saveSnapshots();
    renderAll();
  });
}

function formatUsd(v) {
  return `$${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatBtc(v) {
  return `${Number(v || 0).toFixed(8)} BTC`;
}

function normalizeUnit(unit) {
  const upper = String(unit || "USD").trim().toUpperCase();
  if (upper === "BTC") return "BTC";
  if (upper === "SATS") return "sats";
  if (UOA_UNIT_MAP.has(upper)) return upper;
  return "USD";
}

function decimalsForUnit(unit) {
  const normalized = normalizeUnit(unit);
  if (normalized === "sats") return 0;
  return uoaUnitMeta(normalized).decimals;
}

function stepForUnit(unit) {
  if (unit === "BTC") return "0.00000001";
  if (unit === "sats") return "1";
  return "0.01";
}

function formatAmountInputValue(amount, unit) {
  const parsed = parseRowAmount(amount);
  if (!Number.isFinite(parsed)) return "";
  return parsed.toFixed(decimalsForUnit(unit));
}

function formatUoaAmount(value, unitRaw, { minimumFractionDigits = null } = {}) {
  const unit = normalizeUnit(unitRaw);
  const meta = unit === "sats" ? { code: "sats", decimals: 0, suffix: "sats" } : uoaUnitMeta(unit);
  const parsed = Number(value || 0);
  const maxDigits = meta.decimals;
  const minDigits = minimumFractionDigits === null ? Math.min(maxDigits, unit === "BTC" ? 8 : 2) : minimumFractionDigits;
  const formatted = parsed.toLocaleString(undefined, {
    minimumFractionDigits: Math.min(minDigits, maxDigits),
    maximumFractionDigits: maxDigits
  });
  if (unit === "BTC") return `${formatted} BTC`;
  if (unit === "sats") return `${Math.round(parsed).toLocaleString()} sats`;
  if (meta.suffix) return `${formatted} ${meta.suffix}`;
  if (meta.symbol) return `${meta.symbol}${formatted}`;
  return `${formatted} ${unit}`;
}

function formatUsdAsUnit(usdValue, unitRaw, btcusdRaw, dateKey) {
  const converted = usdToUnitValue(usdValue, unitRaw, btcusdRaw, dateKey);
  if (converted === null) return "—";
  return formatUoaAmount(converted, unitRaw);
}

function formatPrimaryValue(usdValue, btcusdRaw, dateKey) {
  return formatUsdAsUnit(usdValue, uoaSelections.primary, btcusdRaw, dateKey);
}

function formatSecondaryValue(usdValue, btcusdRaw, dateKey) {
  return formatUsdAsUnit(usdValue, uoaSelections.secondary, btcusdRaw, dateKey);
}

function convertAmountBetweenUnits(amount, fromUnitRaw, toUnitRaw, btcusdRaw, dateKey = editingSnapshotDate) {
  const fromUnit = normalizeUnit(fromUnitRaw);
  const toUnit = normalizeUnit(toUnitRaw);
  const parsedAmount = parseRowAmount(amount);
  if (!Number.isFinite(parsedAmount)) return amount;
  if (fromUnit === toUnit) return parsedAmount;

  const datePrice = Math.max(Number(btcusdRaw), 1e-12);
  const usdValue = parsedAmount * (usdPerUnit(fromUnit, datePrice, dateKey) || 0);
  const nextValue = usdToUnitValue(usdValue, toUnit, datePrice, dateKey);
  if (nextValue === null) return parsedAmount;
  if (toUnit === "sats") return Math.round(nextValue);
  return Number(nextValue.toFixed(decimalsForUnit(toUnit)));
}

function renderEditor(container, key) {
  container.innerHTML = "";
  formState[key].forEach((row, idx) => {
    const wrap = document.createElement("div");
    wrap.className = key === "assets" || key === "liabilities" ? "row-editor four-col" : "row-editor";
    const unitValue = normalizeUnit(row.unit);

    const name = document.createElement("input");
    name.placeholder = "name";
    name.value = row.name;
    name.dataset.rowKey = key;
    name.dataset.rowIndex = String(idx);
    name.dataset.field = "name";
    // Direct focus tracking on input element
    name.addEventListener("focusin", () => {
      editorRowsFocused = true;
      pauseAutoQuoteRefresh();
      if (quoteRefreshAbortController) quoteRefreshAbortController.abort();
    });
    name.addEventListener("focusout", () => {
      setTimeout(() => {
        syncEditorRowsFocusedFromDom();
        if (!editorRowsFocused) {
          flushDeferredQuoteUiRefresh();
          resumeAutoQuoteRefresh();
        }
      }, 0);
    });
    name.addEventListener("focus", () => captureEditorFieldBaseline(name));
    name.addEventListener("focus", () => {
      name.dataset.originalName = String(formState[key][idx]?.name || "").trim();
    });
    name.addEventListener("input", () => {
      const wasComplete = isRowComplete(formState[key][idx]);
      const prevName = formState[key][idx].name;
      formState[key][idx].name = name.value;
      if (prevName !== name.value) {
        hasUnsavedAssetLiabilityChanges = true;
      }
      saveForm();
      updateEditorDuplicateWarnings(container, key);
      updateKPIs();
      if (!wasComplete && isRowComplete(formState[key][idx])) {
        persistSnapshotForActiveSelection({ render: false, onlyIfDirty: true, trackAction: false });
      }
    });
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        name.blur();
      }
    });
    name.addEventListener("blur", (e) => {
      // Ignore synthetic blur triggered when rerender removes this input from the DOM.
      if (!e.target.isConnected) {
        setTimeout(flushDeferredQuoteUiRefresh, 0);
        return;
      }
      const before = consumeEditorFieldBaseline(name);
      runTrackedActionFromBefore(`${key}-name-edit`, before, () => {
        hasUnsavedAssetLiabilityChanges = true;
        const oldName = String(name.dataset.originalName || "").trim();
        const newName = String(name.value || "").trim();
        if ((key === "assets" || key === "liabilities") && oldName && newName && oldName !== newName) {
          const targetDate = editingSnapshotDate || mmddyy(new Date());
          propagateNameRenameAcrossSnapshots(key, oldName, newName, targetDate);
        }
        const next = e.relatedTarget;
        const stayingInSameRow = Boolean(next && wrap.contains(next));
        persistSnapshotForActiveSelection({ render: !stayingInSameRow, onlyIfDirty: false, trackAction: false });
      });
      setTimeout(flushDeferredQuoteUiRefresh, 0);
    });

    const amount = document.createElement("input");
    amount.type = "number";
    amount.min = "0";
    amount.step = stepForUnit(unitValue);
    amount.placeholder = "amount";
    amount.value = formatAmountInputValue(row.amount, unitValue);
    amount.dataset.rowKey = key;
    amount.dataset.rowIndex = String(idx);
    amount.dataset.field = "amount";
    // Direct focus tracking on input element
    amount.addEventListener("focusin", () => {
      editorRowsFocused = true;
      pauseAutoQuoteRefresh();
      if (quoteRefreshAbortController) quoteRefreshAbortController.abort();
    });
    amount.addEventListener("focusout", () => {
      setTimeout(() => {
        syncEditorRowsFocusedFromDom();
        if (!editorRowsFocused) {
          flushDeferredQuoteUiRefresh();
          resumeAutoQuoteRefresh();
        }
      }, 0);
    });
    amount.addEventListener("focus", () => captureEditorFieldBaseline(amount));
    amount.addEventListener("input", () => {
      const wasComplete = isRowComplete(formState[key][idx]);
      const prevAmount = formState[key][idx].amount;
      const next = amount.value === "" ? "" : Math.max(0, Number(amount.value));
      formState[key][idx].amount = next;
      // Once the user explicitly types an amount, the row is no longer "fresh"
      if (next !== "" && next !== 0) delete formState[key][idx]._fresh;
      if (String(prevAmount) !== String(next)) {
        hasUnsavedAssetLiabilityChanges = true;
      }
      saveForm();
      updateKPIs();
      if (!wasComplete && isRowComplete(formState[key][idx])) {
        persistSnapshotForActiveSelection({ render: false, onlyIfDirty: true, trackAction: false });
      }
    });
    amount.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        suppressNextEditorFocusRestore = true;
        pendingRowFieldFocus = null;
        amount.blur();
        setTimeout(() => {
          // Ensure Enter commits and the amount field does not retain focus.
          if (document.activeElement === amount) {
            amount.blur();
          }
          focusBodyWithoutScroll();
          editorRowsFocused = false;
        }, 0);
      }
      if (e.key === "Tab" && !e.shiftKey && (key === "assets" || key === "liabilities")) {
        // Keep focus flow predictable inside a row: Name -> Unit -> Amount
        e.preventDefault();
        const nextWrap = wrap.nextElementSibling;
        if (nextWrap) {
          const nextName = nextWrap.querySelector("input");
          if (nextName) {
            nextName.focus();
            nextName.select();
            return;
          }
        }
        const addBtn = document.querySelector(`.add-row-btn[data-target="${container.id}"]`);
        if (addBtn) addBtn.focus();
      }
    });
    amount.addEventListener("blur", (e) => {
      // Ignore synthetic blur triggered when rerender removes this input from the DOM.
      if (!e.target.isConnected) {
        setTimeout(flushDeferredQuoteUiRefresh, 0);
        return;
      }
      const before = consumeEditorFieldBaseline(amount);
      const cur = formState[key][idx].amount;
      if (cur !== "") {
        amount.value = formatAmountInputValue(cur, normalizeUnit(formState[key][idx].unit));
      }
      runTrackedActionFromBefore(`${key}-amount-edit`, before, () => {
        hasUnsavedAssetLiabilityChanges = true;
        const next = e.relatedTarget;
        const stayingInSameRow = Boolean(next && wrap.contains(next));
        persistSnapshotForActiveSelection({ render: !stayingInSameRow, onlyIfDirty: false, trackAction: false });
      });
      setTimeout(flushDeferredQuoteUiRefresh, 0);
    });

    let unit = null;
    if (key === "assets" || key === "liabilities") {
      unit = document.createElement("select");
      ROW_UNIT_CODES.forEach((code) => {
        const option = document.createElement("option");
        option.value = code;
        option.textContent = code;
        unit.appendChild(option);
      });
      unit.value = unitValue;
      unit.dataset.rowKey = key;
      unit.dataset.rowIndex = String(idx);
      unit.dataset.field = "unit";
      // Direct focus tracking on select element
      unit.addEventListener("focusin", () => {
        editorRowsFocused = true;
        pauseAutoQuoteRefresh();
        if (quoteRefreshAbortController) quoteRefreshAbortController.abort();
      });
      unit.addEventListener("focusout", () => {
        setTimeout(() => {
          syncEditorRowsFocusedFromDom();
          if (!editorRowsFocused) {
            flushDeferredQuoteUiRefresh();
            resumeAutoQuoteRefresh();
          }
        }, 0);
      });
      unit.addEventListener("blur", () => {
        setTimeout(flushDeferredQuoteUiRefresh, 0);
      });
      unit.addEventListener("change", () => {
        pendingRowFieldFocus = { key, idx, field: "amount" };
        const before = trackedStateSnapshot();
        const applyUnitChange = () => runTrackedActionFromBefore(`${key}-unit-edit`, before, () => {
          const rowName = String(formState[key][idx].name || "").trim();
          const prevUnit = normalizeUnit(formState[key][idx].unit);
          const nextUnit = normalizeUnit(unit.value);
          let nextAmount = formState[key][idx].amount;
          const parsedAmount = parseRowAmount(nextAmount);
          // Skip conversion for fresh rows (user hasn't committed an amount yet)
          const isFresh = Boolean(formState[key][idx]._fresh);
          if (!isFresh && Number.isFinite(parsedAmount)) {
            const datePrice = Number(historicalPrices[editingSnapshotDate]) || activeBtcusd();
            nextAmount = convertAmountBetweenUnits(parsedAmount, prevUnit, nextUnit, datePrice, editingSnapshotDate);
          }
          formState[key][idx].amount = nextAmount;
          formState[key][idx].unit = nextUnit;
          const targetDate = editingSnapshotDate || mmddyy(new Date());
          propagateUnitChangeAcrossSnapshots(key, rowName, prevUnit, nextUnit, targetDate);
          // Update the amount input display to match new unit formatting
          amount.step = stepForUnit(nextUnit);
          amount.value = formatAmountInputValue(nextAmount, nextUnit);
          hasUnsavedAssetLiabilityChanges = true;
          saveForm();
          // Drop focus from the select so render can run and restore focus to amount.
          unit.blur();
          persistSnapshotForActiveSelection({ render: true, onlyIfDirty: true, trackAction: false });
        });
        const prevUnit = normalizeUnit(formState[key][idx].unit);
        const nextUnit = normalizeUnit(unit.value);
        if ((unitNeedsFx(prevUnit) || unitNeedsFx(nextUnit)) && !fxRatesLoaded) {
          ensureFxRatesLoaded().then(applyUnitChange).catch(() => applyUnitChange());
        } else {
          applyUnitChange();
        }
      });

      name.addEventListener("keydown", (e) => {
        if (e.key === "Tab" && !e.shiftKey) {
          e.preventDefault();
          unit.focus();
        }
      });

      unit.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          amount.focus();
          amount.select();
          return;
        }
        if (e.key !== "Tab" || e.shiftKey) return;
        e.preventDefault();
        amount.focus();
        amount.select();
      });
    }

    const del = document.createElement("button");
    del.className = "small-btn remove-btn";
    del.textContent = "×";
    del.title = "Remove";
    del.addEventListener("click", () => removeRow(key, idx));

    if (unit) {
      wrap.append(name, unit, amount, del);
    } else {
      wrap.append(name, amount, del);
    }
    container.appendChild(wrap);

    if (pendingRowFocus && pendingRowFocus.key === key && pendingRowFocus.idx === idx) {
      setTimeout(() => {
        name.focus();
      }, 0);
      pendingRowFocus = null;
    }

    if (pendingRowFieldFocus && pendingRowFieldFocus.key === key && pendingRowFieldFocus.idx === idx) {
      const focusTarget = pendingRowFieldFocus;
      pendingRowFieldFocus = null;
      setTimeout(() => {
        if (focusTarget.field === "unit") {
          const unitEl = wrap.querySelector("select");
          if (unitEl) unitEl.focus();
        } else if (focusTarget.field === "amount") {
          const amountEl = wrap.querySelector(`input[data-row-key="${key}"][data-field="amount"]`);
          if (amountEl) {
            amountEl.focus();
            amountEl.select();
          }
        }
      }, 0);
    }
  });

  updateEditorDuplicateWarnings(container, key);
}

function updateEditorDuplicateWarnings(container, key) {
  if (key !== "assets" && key !== "liabilities") return;
  const rows = formState[key] || [];
  const duplicates = duplicateRowIndices(rows);
  const hasUnnamed = rows.some((r) => !canonicalRowName(r?.name));
  const addBtn = document.querySelector(`.add-row-btn[data-target="${container.id}"]`);
  if (addBtn) {
    const blocked = duplicates.size > 0 || hasUnnamed;
    addBtn.disabled = blocked;
    addBtn.title = blocked
      ? "Resolve duplicate or unnamed rows before adding more"
      : (key === "assets" ? "Add Asset" : "Add Liability");
  }
  Array.from(container.children).forEach((wrap, idx) => {
    const isDuplicate = duplicates.has(idx);
    wrap.classList.toggle("row-editor-duplicate", isDuplicate);
    const nameInput = wrap.querySelector(`input[data-row-key="${key}"]`);
    if (nameInput) {
      nameInput.classList.toggle("duplicate-row-name", false);
      nameInput.title = "";
    }
    let warning = wrap.querySelector(".row-duplicate-warning");
    if (isDuplicate && !warning) {
      warning = document.createElement("span");
      warning.className = "row-duplicate-warning";
      warning.title = "Duplicated names are not allowed. Later duplicate rows are ignored until the duplication is resolved.";
      wrap.appendChild(warning);
    }
    if (isDuplicate && warning && nameInput) {
      warning.style.left = `${Math.max(2, nameInput.offsetLeft - 10)}px`;
      warning.style.top = `${nameInput.offsetTop + Math.round(nameInput.offsetHeight / 2)}px`;
    }
    if (!isDuplicate && warning) {
      warning.remove();
    }
  });
}

function renderHistoryTable() {
  // Preserve which accordion rows are currently open before rebuilding.
  const openDates = new Set();
  document.querySelectorAll(".history-accordion-row.open").forEach((row) => {
    if (row.dataset.snapshotDate) openDates.add(row.dataset.snapshotDate);
  });

  el.historyTableBody.innerHTML = "";
  const today = mmddyy(new Date());
  const historyRows = snapshots
    .slice()
    .sort((a, b) => parseMMDDYY(b.date) - parseMMDDYY(a.date));
  if (!historyRows.some((s) => s.date === today)) {
    const todaySnap = todayHistoryRowSnapshot();
    if (todaySnap) {
      historyRows.unshift(todaySnap);
    }
  }

  historyRows.forEach((snap) => {
    const tr = document.createElement("tr");
    tr.classList.toggle("active-snapshot", snap.date === editingSnapshotDate);
    tr.title = "Click to load and edit this snapshot";
    tr.innerHTML = `
      <td><button class="history-toggle-btn" type="button" title="Show comment" aria-hidden="true">></button>${formatDisplayDate(snap.date)}</td>
      <td>${formatUsd(snap.btcusd)}</td>
      <td>${formatBtc(snap.totals.net_btc)}</td>
      <td>${formatUsd(snap.totals.net_usd)}</td>
      <td class="history-actions-cell"><button class="small-btn history-delete-btn" type="button" title="Delete snapshot" ${snap.synthetic ? 'style="visibility:hidden"' : ""}>×</button></td>
    `;
    tr.addEventListener("click", (e) => {
      if (!e.target.closest(".history-toggle-btn") && !e.target.closest(".history-delete-btn")) {
        selectSnapshot(snap.date);
      }
    });
    
    const toggleBtn = tr.querySelector(".history-toggle-btn");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        const accordionRow = tr.nextElementSibling;
        if (accordionRow && accordionRow.classList.contains("history-accordion-row")) {
          accordionRow.classList.toggle("open");
          toggleBtn.classList.toggle("open");
        }
      });
    }
    
    if (!snap.synthetic) {
      const delBtn = tr.querySelector(".history-delete-btn");
      if (delBtn) {
        delBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          deleteSnapshot(snap.date);
        });
      }
    }
    el.historyTableBody.appendChild(tr);
    
    // Add accordion row for comments
    const accordionRow = document.createElement("tr");
    accordionRow.classList.add("history-accordion-row");
    accordionRow.dataset.snapshotDate = snap.date;
    accordionRow.innerHTML = `
      <td colspan="6" class="history-accordion-content">
        <textarea class="snapshot-comment-field" placeholder="Add a comment for this snapshot..." rows="3">${snap.comments || ""}</textarea>
      </td>
    `;
    
    const commentField = accordionRow.querySelector(".snapshot-comment-field");
    if (commentField) {
      commentField.addEventListener("focusin", () => {
        editorRowsFocused = true;
        pauseAutoQuoteRefresh();
        if (quoteRefreshAbortController) quoteRefreshAbortController.abort();
      });
      commentField.addEventListener("focusout", () => {
        setTimeout(() => {
          syncEditorRowsFocusedFromDom();
          if (!editorRowsFocused) {
            flushDeferredQuoteUiRefresh();
            resumeAutoQuoteRefresh();
          }
        }, 0);
      });
      commentField.addEventListener("blur", () => {
        const comment = commentField.value;
        
        if (snap.synthetic) {
          // If synthetic row has a comment, create a real snapshot for today
          if (!comment.trim()) return;
          
          const today = mmddyy(new Date());
          // Update formState so normalizedSnapshot captures the comment
          formState.comments = comment;
          saveForm();
          editingSnapshotDate = today;
          // Let persistSnapshotForActiveSelection create the real snapshot from formState
          persistSnapshotForActiveSelection({ render: false, trackAction: false });
          // Re-render history table only (preserves open accordions via openDates)
          renderHistoryTable();
          return;
        }
        
        const snapIdx = snapshots.findIndex((s) => s.date === snap.date);
        if (snapIdx >= 0) {
          snapshots[snapIdx].comments = comment;
          if (editingSnapshotDate === snap.date) {
            formState.comments = comment;
            saveForm();
          }
          persistSnapshotForActiveSelection({ render: false, trackAction: false });
        }
      });
    }
    
    el.historyTableBody.appendChild(accordionRow);

    // Restore open state if this accordion was open before the re-render.
    if (openDates.has(snap.date)) {
      accordionRow.classList.add("open");
      toggleBtn && toggleBtn.classList.add("open");
    }
  });
  el.historyCount.textContent = `${snapshots.length} snapshot${snapshots.length === 1 ? "" : "s"}`;
}

function captureEditorFocusState() {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLSelectElement)) return null;
  const rowKey = active.dataset.rowKey;
  const rowIndex = active.dataset.rowIndex;
  const field = active.dataset.field;
  if (!rowKey || rowIndex === undefined || !field) return null;
  const state = { rowKey, rowIndex, field };
  if (active instanceof HTMLInputElement) {
    state.selectionStart = active.selectionStart;
    state.selectionEnd = active.selectionEnd;
  }
  return state;
}

function restoreEditorFocusState(state) {
  if (!state) return;
  const target = document.querySelector(
    `[data-row-key="${state.rowKey}"][data-row-index="${state.rowIndex}"][data-field="${state.field}"]`
  );
  if (!target || !(target instanceof HTMLElement)) return;
  target.focus();
  if (target instanceof HTMLInputElement && Number.isInteger(state.selectionStart) && Number.isInteger(state.selectionEnd)) {
    try {
      target.setSelectionRange(state.selectionStart, state.selectionEnd);
    } catch {
      // Ignore unsupported input types.
    }
  }
}

function updateKPIs() {
  scheduleFxLoadIfNeeded();
  const today = mmddyy(new Date());
  const isHistorical = editingSnapshotDate && editingSnapshotDate !== today;
  const existingSnap = isHistorical ? snapshots.find((s) => s.date === editingSnapshotDate) : null;
  const historicalPrice = existingSnap && Number(existingSnap.btcusd) > 0
    ? Number(existingSnap.btcusd)
    : (isHistorical && Number(historicalPrices[editingSnapshotDate]) > 0
        ? Number(historicalPrices[editingSnapshotDate])
        : null);
  const displayPrice = historicalPrice !== null ? historicalPrice : activeBtcusd();
  const snap = applyExclusionFilters(normalizedSnapshot(displayPrice), excludedAssets, excludedLiabilities, displayPrice);
  renderMetricValues(snap, displayPrice, editingSnapshotDate || today);
  
  // Update pie charts
  renderNetWorthPieChart(snap);
  renderAssetsPieChart(snap);
  renderLiabilitiesPieChart(snap);
}

function renderMetricValues(snap, btcusd, dateKey) {
  el.assetsMetric.textContent = formatPrimaryValue(snap.totals.assets_usd, btcusd, dateKey);
  el.assetsMetricUsd.textContent = formatSecondaryValue(snap.totals.assets_usd, btcusd, dateKey);
  el.liabilitiesMetric.textContent = formatPrimaryValue(snap.totals.liabilities_usd, btcusd, dateKey);
  el.liabilitiesMetricUsd.textContent = formatSecondaryValue(snap.totals.liabilities_usd, btcusd, dateKey);
  el.netMetric.textContent = formatPrimaryValue(snap.totals.net_usd, btcusd, dateKey);
  el.netMetricUsd.textContent = formatSecondaryValue(snap.totals.net_usd, btcusd, dateKey);
}

function renderNetWorthPieChart(snap) {
  const canvas = document.getElementById("netWorthPieChart");
  if (!canvas) return;
  
  const assets = Number(snap.totals.assets_btc || 0);
  const liabilities = Number(snap.totals.liabilities_btc || 0);
  const total = assets + liabilities;
  
  const slices = [];
  if (total > 0) {
    slices.push({ name: "Assets", value: assets, color: "#39d7a4" });
    slices.push({ name: "Liabilities", value: liabilities, color: "#ef6f6c" });
  }
  
  metricPieChartState.netWorth.slices = slices;
  drawMetricPieChart(canvas, slices, metricPieChartState.netWorth.hoveredIndex, "netWorth");
}

function darkenHexColor(hex, amount) {
  const cleaned = String(hex || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return hex;
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  const factor = Math.max(0, Math.min(1, 1 - Number(amount || 0)));
  const rr = clamp(r * factor).toString(16).padStart(2, "0");
  const gg = clamp(g * factor).toString(16).padStart(2, "0");
  const bb = clamp(b * factor).toString(16).padStart(2, "0");
  return `#${rr}${gg}${bb}`;
}

function renderAssetsPieChart(snap) {
  const canvas = document.getElementById("assetsPieChart");
  if (!canvas) return;
  
  const assets = snap.assets || [];
  const btcusd = snap.btcusd || formState.btcusd || 1;
  const dateKey = snap.date || editingSnapshotDate || mmddyy(new Date());
  
  const slices = assets
    .map((a) => {
      const usdValue = rowValueInUsd(a, btcusd, dateKey);
      const btcValue = usdValue / Math.max(Number(btcusd || 0), 1e-12);
      return { name: a.name, value: btcValue };
    })
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
  
  // Start at KPI green, then darken each subsequent slice.
  const baseGreen = "#39d7a4";
  slices.forEach((s, i) => {
    const darkenAmount = Math.min(i * 0.09, 0.72);
    s.color = darkenHexColor(baseGreen, darkenAmount);
  });
  
  metricPieChartState.assets.slices = slices;
  drawMetricPieChart(canvas, slices, metricPieChartState.assets.hoveredIndex, "assets");
}

function renderLiabilitiesPieChart(snap) {
  const canvas = document.getElementById("liabilitiesPieChart");
  if (!canvas) return;
  
  const liabilities = snap.liabilities || [];
  const btcusd = snap.btcusd || formState.btcusd || 1;
  const dateKey = snap.date || editingSnapshotDate || mmddyy(new Date());
  
  const slices = liabilities
    .map((l) => {
      const usdValue = rowValueInUsd(l, btcusd, dateKey);
      const btcValue = usdValue / Math.max(Number(btcusd || 0), 1e-12);
      return { name: l.name, value: btcValue };
    })
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
  
  // Start at KPI red, then darken each subsequent slice.
  const baseRed = "#ef6f6c";
  slices.forEach((s, i) => {
    const darkenAmount = Math.min(i * 0.09, 0.72);
    s.color = darkenHexColor(baseRed, darkenAmount);
  });
  
  metricPieChartState.liabilities.slices = slices;
  drawMetricPieChart(canvas, slices, metricPieChartState.liabilities.hoveredIndex, "liabilities");
}

function drawMetricPieChart(canvas, slices, hoveredIndex, chartType) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  
  // Set canvas resolution for crisp rendering
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  
  ctx.scale(dpr, dpr);
  
  const w = rect.width;
  const h = rect.height;
  const centerX = w / 2;
  const centerY = h / 2;
  
  // Calculate radius to fit nicely with equal spacing
  const maxRadius = Math.min(w, h) / 2;
  const spacing = 6; // pixels for spacing
  const radius = Math.max(maxRadius - spacing, 20);
  
  if (!slices.length || slices.every(s => s.value === 0)) {
    // No data
    ctx.fillStyle = themeValue("--muted");
    ctx.font = "12px Space Grotesk";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("—", centerX, centerY);
    return;
  }
  
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return;

  let hoveredStartAngle = null;
  let hoveredEndAngle = null;
  const seamAngle = -Math.PI / 2;
  const dividerLineWidth = 0.6;
  const separatorAngles = [];
  
  // Draw pie slices starting from top (12 o'clock = -Math.PI / 2)
  let currentAngle = seamAngle;
  
  slices.forEach((slice, index) => {
    const sliceAngle = (slice.value / total) * 2 * Math.PI;
    const startAngle = currentAngle;
    const endAngle = currentAngle + sliceAngle;
    
    // Draw slice
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.closePath();
    
    // Fill slice
    ctx.fillStyle = slice.color;
    ctx.fill();

    if (index === hoveredIndex) {
      hoveredStartAngle = startAngle;
      hoveredEndAngle = endAngle;
    }
    
    // Draw separators only between adjacent slices.
    // Skip the last edge and draw the seam once after the loop.
    if (index < slices.length - 1) {
      separatorAngles.push(endAngle);
    }
    
    currentAngle = endAngle;
  });

  if (slices.length > 1) {
    separatorAngles.push(seamAngle);

    const twoPi = 2 * Math.PI;
    const normalizeAngle = (a) => {
      let out = a % twoPi;
      if (out < 0) out += twoPi;
      return out;
    };

    const dedupeThreshold = 1.5 / Math.max(radius, 1); // about 1.5px at edge
    const normalized = separatorAngles.map(normalizeAngle).sort((a, b) => a - b);
    const unique = [];
    normalized.forEach((a) => {
      if (!unique.length || Math.abs(a - unique[unique.length - 1]) > dedupeThreshold) {
        unique.push(a);
      }
    });
    if (unique.length > 1) {
      const wrapGap = (unique[0] + twoPi) - unique[unique.length - 1];
      if (wrapGap <= dedupeThreshold) unique.shift();
    }

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = dividerLineWidth;
    unique.forEach((angle) => {
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(
        centerX + Math.cos(angle) * radius,
        centerY + Math.sin(angle) * radius
      );
      ctx.stroke();
    });
  }

  // Outer rim matches divider styling for a clean pie edge in all themes.
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = dividerLineWidth;
  ctx.stroke();

  // Draw hovered slice outline last so it always overlays delimiter lines.
  if (hoveredStartAngle !== null && hoveredEndAngle !== null) {
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, hoveredStartAngle, hoveredEndAngle);
    ctx.closePath();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  
  // Store slice info for hit testing
  metricPieChartState[chartType].slices = slices;
}

function getMetricPieChartSliceAtPoint(canvas, x, y, chartType) {
  const rect = canvas.getBoundingClientRect();
  const localX = x - rect.left;
  const localY = y - rect.top;
  
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  
  const maxRadius = Math.min(rect.width, rect.height) / 2;
  const spacing = 8;
  const radius = Math.max(maxRadius - spacing, 20);
  
  const dx = localX - centerX;
  const dy = localY - centerY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  if (distance > radius || distance < 2) return -1; // Outside pie or too close to center
  
  const angle = Math.atan2(dy, dx) + Math.PI / 2; // Adjust to start from top
  const normalizedAngle = angle < 0 ? angle + 2 * Math.PI : angle;
  
  const slices = metricPieChartState[chartType].slices;
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return -1;
  
  let currentAngle = 0;
  for (let i = 0; i < slices.length; i++) {
    const sliceAngle = (slices[i].value / total) * 2 * Math.PI;
    if (normalizedAngle >= currentAngle && normalizedAngle < currentAngle + sliceAngle) {
      return i;
    }
    currentAngle += sliceAngle;
  }
  
  return -1;
}

function showMetricPieChartTooltip(canvas, x, y, chartType) {
  const sliceIndex = getMetricPieChartSliceAtPoint(canvas, x, y, chartType);
  const state = metricPieChartState[chartType];
  
  if (sliceIndex !== state.hoveredIndex) {
    state.hoveredIndex = sliceIndex;
    
    if (chartType === "netWorth") {
      const snap = getDisplaySnapshot();
      renderNetWorthPieChart(snap);
    } else if (chartType === "assets") {
      const snap = getDisplaySnapshot();
      renderAssetsPieChart(snap);
    } else if (chartType === "liabilities") {
      const snap = getDisplaySnapshot();
      renderLiabilitiesPieChart(snap);
    }
  }
  
  // Show tooltip if hovering over a slice
  if (sliceIndex >= 0) {
    const slices = state.slices;
    const slice = slices[sliceIndex];
    const tooltipText = `${slice.name}: ${Number(slice.value).toFixed(8)} BTC`;
    
    showMetricPieTooltip(canvas, x, y, tooltipText);
  } else {
    hideMetricPieTooltip();
  }
}

let metricPieTooltipEl = null;

function showMetricPieTooltip(canvas, mouseX, mouseY, text) {
  if (!metricPieTooltipEl) {
    metricPieTooltipEl = document.createElement("div");
    metricPieTooltipEl.className = "metric-pie-tooltip";
    document.body.appendChild(metricPieTooltipEl);
  }
  
  metricPieTooltipEl.textContent = text;
  metricPieTooltipEl.style.display = "block";
  
  // Position tooltip with offset from cursor
  const offsetX = 10;
  const offsetY = 10;
  metricPieTooltipEl.style.left = (mouseX + offsetX) + "px";
  metricPieTooltipEl.style.top = (mouseY + offsetY) + "px";
  
  // Ensure tooltip doesn't go off-screen
  requestAnimationFrame(() => {
    const rect = metricPieTooltipEl.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      metricPieTooltipEl.style.left = (mouseX - rect.width - offsetX) + "px";
    }
    if (rect.bottom > window.innerHeight) {
      metricPieTooltipEl.style.top = (mouseY - rect.height - offsetY) + "px";
    }
  });
}

function hideMetricPieTooltip() {
  if (metricPieTooltipEl) {
    metricPieTooltipEl.style.display = "none";
  }
}

function getDisplaySnapshot() {
  const today = mmddyy(new Date());
  const isHistorical = editingSnapshotDate && editingSnapshotDate !== today;
  const existingSnap = isHistorical ? snapshots.find((s) => s.date === editingSnapshotDate) : null;
  const historicalPrice = existingSnap && Number(existingSnap.btcusd) > 0
    ? Number(existingSnap.btcusd)
    : (isHistorical && Number(historicalPrices[editingSnapshotDate]) > 0
        ? Number(historicalPrices[editingSnapshotDate])
        : null);
  const displayPrice = historicalPrice !== null ? historicalPrice : activeBtcusd();
  return applyExclusionFilters(normalizedSnapshot(displayPrice), excludedAssets, excludedLiabilities, displayPrice);
}

function renderAll() {
  updateModeToggleUI();
  scheduleFxLoadIfNeeded();
  renderUoaDropdowns();

  // GUARD: Never rerender while an editor row field is actively focused
  // This prevents focus loss and partial saves during user editing
  if (isAssetLiabilityEditorFocused()) {
    return;
  }
  
  const editorFocus = captureEditorFocusState();
  const displayDate = formatDisplayDate(editingSnapshotDate);
  const aCount = formState.assets.length;
  const lCount = formState.liabilities.length;
  el.assetsPanelTitle.textContent = `Assets on ${displayDate}`;
  el.assetsCount.textContent = `${aCount} item${aCount === 1 ? "" : "s"}`;
  el.liabilitiesPanelTitle.textContent = `Liabilities on ${displayDate}`;
  el.liabilitiesCount.textContent = `${lCount} item${lCount === 1 ? "" : "s"}`;
  renderEditor(el.assetsRows, "assets");
  renderEditor(el.liabilitiesRows, "liabilities");

  const today = mmddyy(new Date());
  const isHistorical = editingSnapshotDate && editingSnapshotDate !== today;
  const existingSnap = isHistorical ? snapshots.find((s) => s.date === editingSnapshotDate) : null;
  const historicalPrice = existingSnap && Number(existingSnap.btcusd) > 0
    ? Number(existingSnap.btcusd)
    : (isHistorical && Number(historicalPrices[editingSnapshotDate]) > 0
        ? Number(historicalPrices[editingSnapshotDate])
        : null);
  const displayPrice = historicalPrice !== null ? historicalPrice : activeBtcusd();
  const snap = applyExclusionFilters(normalizedSnapshot(displayPrice), excludedAssets, excludedLiabilities, displayPrice);
  const chartSnapshots = snapshotsForCharts(displayPrice);

  const manualActive = isManualOverrideActive();
  const manualDisplayValue = manualActive
    ? Number(formState.manualBtcusd)
    : Number(formState.btcusd || 0);
  if (document.activeElement !== el.manualBtcusd) {
    el.manualBtcusd.value = manualDisplayValue > 0 ? formatUsd(manualDisplayValue) : "";
  }
  el.quoteTime.textContent = manualActive
    ? "Manual price override"
    : (formState.btcusd ? `Updated · ${formatQuoteTimestamp(lastQuoteRefreshAt || new Date())}` : "No quote loaded");

  renderMetricValues(snap, displayPrice, editingSnapshotDate || today);

  renderNetWorthPieChart(snap);
  renderAssetsPieChart(snap);
  renderLiabilitiesPieChart(snap);

  renderHistoryTable();
  populateFilterDropdowns();
  renderChartsOnly();
  if (editorFocus && !suppressNextEditorFocusRestore) {
    restoreEditorFocusState(editorFocus);
  }
  suppressNextEditorFocusRestore = false;
}

function computeTotals(assets, liabilities, btcusd, dateKeyOverride = null) {
  const p = Math.max(Number(btcusd) || 0, 1e-12);
  const dateKey = dateKeyOverride || editingSnapshotDate || mmddyy(new Date());
  const assetRows = (assets || []).map((a) => ({ name: a.name, amount: a.value, unit: a.unit }));
  const liabilityRows = (liabilities || []).map((l) => ({ name: l.name, amount: l.value, unit: l.unit }));
  const splitA = splitAssetRows(assetRows, p, dateKey);
  const splitL = splitLiabilityRows(liabilityRows, p, dateKey);
  const aB = splitA.assetsBtc; const aU = splitA.assetsUsd;
  const lB = splitL.liabilitiesBtc; const lU = splitL.liabilitiesUsd;
  Object.entries(aB).forEach(([n, v]) => { aU[n] = v * p; });
  Object.entries(aU).forEach(([n, v]) => { aB[n] = v / p; });
  Object.entries(lB).forEach(([n, v]) => { lU[n] = v * p; });
  Object.entries(lU).forEach(([n, v]) => { lB[n] = v / p; });
  const tAB = sum(Object.values(aB)); const tAU = sum(Object.values(aU));
  const tLB = sum(Object.values(lB)); const tLU = sum(Object.values(lU));
  return { assets_btc: tAB, assets_usd: tAU, liabilities_btc: tLB, liabilities_usd: tLU, net_btc: tAB - tLB, net_usd: tAU - tLU };
}

function applyExclusionFilters(snap, exclAssets, exclLiabs, priceOverride) {
  if (!exclAssets?.size && !exclLiabs?.size) return snap;
  const filteredA = exclAssets?.size ? (snap.assets || []).filter(a => !exclAssets.has(a.name)) : (snap.assets || []);
  const filteredL = exclLiabs?.size ? (snap.liabilities || []).filter(l => !exclLiabs.has(l.name)) : (snap.liabilities || []);
  const price = priceOverride !== undefined ? priceOverride : Number(snap.btcusd || 0);
  return { ...snap, assets: filteredA, liabilities: filteredL, totals: computeTotals(filteredA, filteredL, price, snap.date) };
}

function snapshotsForCharts(displayPrice, exclAssets, exclLiabs) {
  const today = mmddyy(new Date());
  const todayMs = parseMMDDYY(today).getTime();
  const sorted = snapshots.slice().sort((a, b) => parseMMDDYY(a.date) - parseMMDDYY(b.date));
  const snapshotByDate = new Map(sorted.map((s) => [s.date, s]));
  const hasEnteredFormRows = comparableRowsFromForm(formState.assets).length > 0 || comparableRowsFromForm(formState.liabilities).length > 0;

  // No historical prices loaded yet — fall back to sparse snapshot list
  if (Object.keys(historicalPrices).length === 0) {
    const syntheticToday = todayHistoryRowSnapshot();
    const baseList = sorted.some((s) => s.date === today)
      ? sorted
      : (syntheticToday && (sorted.length > 0 || hasEnteredFormRows))
        ? [...sorted, syntheticToday].sort((a, b) => parseMMDDYY(a.date) - parseMMDDYY(b.date))
        : sorted;
    const list = baseList.map((s) => applyExclusionFilters({ ...s, totals: { ...s.totals } }, exclAssets, exclLiabs));
    if (Number.isFinite(displayPrice) && displayPrice > 0 && isManualOverrideActive()) {
      const live = applyExclusionFilters(normalizedSnapshot(displayPrice), exclAssets, exclLiabs, displayPrice);
      const idx = list.findIndex((s) => s.date === today);
      if (idx >= 0) list[idx] = live;
      else { list.push(live); list.sort((a, b) => parseMMDDYY(a.date) - parseMMDDYY(b.date)); }
    }
    return list;
  }

  // If no saved snapshots, use the synthetic today row (current formState) so charts draw immediately
  if (!sorted.length) {
    if (!hasEnteredFormRows) return [];
    const syntheticToday = todayHistoryRowSnapshot();
    return syntheticToday ? [applyExclusionFilters(syntheticToday, exclAssets, exclLiabs)] : [];
  }

  // Pre-compute snapshot timestamps for efficient carry-forward lookup
  const snapMs = sorted.map((s) => parseMMDDYY(s.date).getTime());
  const result = [];
  const cur = new Date(snapMs[0]);
  let si = 0;

  while (cur.getTime() <= todayMs) {
    const curMs = cur.getTime();
    // Advance pointer to last snapshot on or before cur
    while (si + 1 < sorted.length && snapMs[si + 1] <= curMs) si++;
    const snap = sorted[si];
    const dateKey = mmddyy(cur);
    const exactSnapshot = snapshotByDate.get(dateKey);

    let price;
    if (dateKey === today) {
      price = Number.isFinite(displayPrice) && displayPrice > 0 ? displayPrice : Number(snap.btcusd || 0);
    } else {
      // Snapshot dates must use their recorded exchange rate.
      if (exactSnapshot && Number(exactSnapshot.btcusd) > 0) {
        price = Number(exactSnapshot.btcusd);
      } else {
        price = Number(historicalPrices[dateKey] || 0);
        // Keep chart continuity when historical feed doesn't cover this date.
        if (price <= 0 && Number(snap.btcusd) > 0) {
          price = Number(snap.btcusd);
        }
      }
    }
    if (price <= 0) { cur.setDate(cur.getDate() + 1); continue; }

    let totals;
    if (dateKey === today && isManualOverrideActive()) {
      const live = applyExclusionFilters(normalizedSnapshot(price), exclAssets, exclLiabs, price);
      totals = live.totals;
    } else {
      const filteredA = exclAssets?.size ? (snap.assets || []).filter(a => !exclAssets.has(a.name)) : (snap.assets || []);
      const filteredL = exclLiabs?.size ? (snap.liabilities || []).filter(l => !exclLiabs.has(l.name)) : (snap.liabilities || []);
      totals = computeTotals(filteredA, filteredL, price, dateKey);
    }

    result.push({ date: dateKey, btcusd: price, totals });
    cur.setDate(cur.getDate() + 1);
  }

  return result;
}

function niceTicks(lo, hi, targetCount = 5) {
  const range = hi - lo;
  if (range === 0) return { ticks: [lo], step: 1 };
  const roughStep = range / Math.max(targetCount - 1, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const norm = roughStep / mag;
  const ladder = [1, 2, 2.5, 5, 10];
  // Choose the nearest "nice" step to avoid abrupt jumps when range changes slightly.
  let niceNorm = ladder[0];
  let minDelta = Math.abs(norm - niceNorm);
  for (let i = 1; i < ladder.length; i++) {
    const candidate = ladder[i];
    const delta = Math.abs(norm - candidate);
    if (delta < minDelta || (Math.abs(delta - minDelta) < 1e-9 && candidate < niceNorm)) {
      minDelta = delta;
      niceNorm = candidate;
    }
  }
  const step = niceNorm * mag;
  const tMin = Math.floor(lo / step) * step;
  const tMax = Math.ceil(hi / step) * step;
  const n = Math.round((tMax - tMin) / step);
  const ticks = Array.from({ length: n + 1 }, (_, i) =>
    Math.round((tMin + i * step) * 1e10) / 1e10
  );
  return { ticks, step };
}

function formatTickValue(v, step, isPercent) {
  const absMag = step > 0 ? Math.floor(Math.log10(step)) : 0;
  const isHalfStep = Math.abs((step / Math.pow(10, absMag)) - 2.5) < 1e-9;
  const decimals = isHalfStep ? Math.max(0, 1 - absMag) : Math.max(0, -absMag);
  return v.toFixed(decimals) + (isPercent ? '%' : '');
}

function thinDateTicks(candidates, maxTicks = 8) {
  if (candidates.length <= maxTicks) return candidates;
  const out = [];
  const step = (candidates.length - 1) / (maxTicks - 1);
  for (let i = 0; i < maxTicks; i++) {
    out.push(candidates[Math.round(i * step)]);
  }
  return out.filter((t, i, arr) => i === 0 || t.i !== arr[i - 1].i);
}

function buildDateLabelTicks(labels, maxTicks = 8) {
  if (!labels.length) return [];
  const monthShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const endpointLabel = (d) => (d.getMonth() === 0 && d.getDate() === 1)
    ? String(d.getFullYear())
    : `${d.getMonth() + 1}/${d.getDate()}`;
  const parsed = labels.map((l) => (/^\d{6}$/.test(l) ? parseMMDDYY(l) : null));
  if (parsed.some((d) => !d)) return [];

  const n = labels.length;
  const spanDays = Math.max(0, Math.round((parsed[n - 1].getTime() - parsed[0].getTime()) / 86400000));

  if (spanDays <= 45) {
    const tickCount = Math.min(maxTicks, n);
    const ticks = [];
    for (let k = 0; k < tickCount; k++) {
      const i = tickCount === 1 ? 0 : Math.round((k * (n - 1)) / (tickCount - 1));
      const d = parsed[i];
      ticks.push({ i, text: `${d.getMonth() + 1}/${d.getDate()}` });
    }
    return ticks.filter((t, idx, arr) => idx === 0 || t.i !== arr[idx - 1].i);
  }

  if (spanDays <= 730) {
    const monthStarts = [];
    parsed.forEach((d, i) => {
      if (d.getDate() === 1) {
        monthStarts.push({ i, d });
      }
    });
    if (!monthStarts.length) return [];

    const allowedSteps = [1, 2, 3, 4, 6];
    let chosenStep = 6;
    for (const step of allowedSteps) {
      const count = monthStarts.filter(({ d }) => ((d.getFullYear() * 12 + d.getMonth()) % step) === 0).length;
      if (count > 0 && count <= maxTicks) {
        chosenStep = step;
        break;
      }
    }

    const ticks = monthStarts
      .filter(({ d }) => ((d.getFullYear() * 12 + d.getMonth()) % chosenStep) === 0)
      .map(({ i, d }) => {
        const month = d.getMonth();
        return { i, text: month === 0 ? String(d.getFullYear()) : monthShort[month] };
      });

    return ticks;
  }

  const yearCandidates = [];
  parsed.forEach((d, i) => {
    if (d.getMonth() === 0 && d.getDate() === 1) {
      yearCandidates.push({ i, text: String(d.getFullYear()) });
    }
  });
  if (!yearCandidates.length || yearCandidates[0].i !== 0) {
    yearCandidates.unshift({ i: 0, text: endpointLabel(parsed[0]) });
  }
  if (yearCandidates[yearCandidates.length - 1].i !== n - 1) {
    yearCandidates.push({ i: n - 1, text: endpointLabel(parsed[n - 1]) });
  }
  return thinDateTicks(yearCandidates, maxTicks);
}

function formatChartTooltipValue(v, isPercent) {
  if (isPercent) return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
  return Number(v).toFixed(6);
}

function buildAxisScale(values, {
  paddingPct = 0,
  paddingMinPct = null,
  paddingMaxPct = null,
  targetTicks = 5,
  includeZeroTick = false,
  includeZeroTickIfInRange = false,
  minZero = false
} = {}) {
  const nums = (values || []).map(Number).filter((v) => Number.isFinite(v));
  if (!nums.length) {
    return { dataMin: -1, dataMax: 1, min: -1, max: 1, ticks: [0], step: 1 };
  }

  let dataMin = Math.min(...nums);
  let dataMax = Math.max(...nums);
  if (dataMin === dataMax) {
    const expand = Math.abs(dataMin) || 1;
    dataMin -= expand;
    dataMax += expand;
  }

  const range = dataMax - dataMin;
  const defaultPadPct = Math.max(0, Number(paddingPct) || 0);
  const lowPadPct = paddingMinPct == null ? defaultPadPct : Math.max(0, Number(paddingMinPct) || 0);
  const highPadPct = paddingMaxPct == null ? defaultPadPct : Math.max(0, Number(paddingMaxPct) || 0);
  const lowPad = Math.abs(range) * lowPadPct;
  const highPad = Math.abs(range) * highPadPct;
  dataMin -= lowPad;
  dataMax += highPad;

  if (minZero) dataMin = Math.min(0, dataMin);
  if (includeZeroTick) {
    if (dataMin > 0) dataMin = 0;
    if (dataMax < 0) dataMax = 0;
  }
  if (dataMin === dataMax) {
    dataMin -= 1;
    dataMax += 1;
  }

  const { ticks: rawTicks, step } = niceTicks(dataMin, dataMax, targetTicks);
  const eps = 1e-9;
  const ticks = rawTicks.filter((t) => t >= dataMin - eps && t <= dataMax + eps);
  if (includeZeroTick && !ticks.some((t) => Math.abs(t) < eps)) ticks.push(0);
  if (!includeZeroTick && includeZeroTickIfInRange && dataMin <= eps && dataMax >= -eps && !ticks.some((t) => Math.abs(t) < eps)) {
    ticks.push(0);
  }
  ticks.sort((a, b) => a - b);

  return {
    dataMin,
    dataMax,
    min: dataMin,
    max: dataMax,
    ticks,
    step
  };
}

function drawLineChart(canvas, datasets, labels, opts = {}) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  // Canvas buffer is kept in sync with display pixels by ResizeObserver,
  // so font sizes in canvas pixels equal their intended CSS-pixel size.
  const dpr = window.devicePixelRatio || 1;
  const horizontalScale = Math.min(1, Math.max(0.5, (width / dpr) / 900));
  const pad = {
    r: CHART_PAD.r,
    t: CHART_PAD.t,
    b: CHART_PAD.b
  };
  const fs = (px) => px;
  const canvasBg = themeValue("--canvas-bg") || "rgba(0,0,0,0.42)";
  const chartTick = themeValue("--chart-tick") || "#a2a2a2";
  const chartGrid = themeValue("--chart-grid") || "rgba(255,255,255,0.14)";
  const chartAxis = themeValue("--chart-axis") || "rgba(255,255,255,0.28)";
  const chartMarker = themeValue("--chart-marker") || "#f5f5f5";
  const tooltipBg = themeValue("--chart-tooltip-bg") || "rgba(10,10,10,0.78)";
  const tooltipBorder = themeValue("--chart-tooltip-border") || "rgba(255,255,255,0.18)";
  const tooltipTitle = themeValue("--chart-tooltip-title") || "#f3f3f3";
  const tooltipText = themeValue("--chart-tooltip-text") || "#d0d0d0";
  const snapshotHighlightDot = themeValue("--snapshot-highlight-dot") || "#66b2ff";
  const snapshotHighlightRing = themeValue("--snapshot-highlight-ring") || "rgba(102,178,255,0.22)";

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = canvasBg;
  ctx.fillRect(0, 0, width, height);

  const allValues = datasets.flatMap((d) => d.values);
  if (!allValues.length) {
    ctx.fillStyle = chartTick;
    ctx.font = `${fs(30)}px Space Grotesk`;
    ctx.fillText(opts.emptyMessage || "No saved data yet. Add an asset or liability.", 28, 46);
    return;
  }

  const axis = opts.yAxisScale || buildAxisScale(allValues, {
    paddingPct: opts.axisPaddingPct || 0,
    paddingMinPct: opts.axisPaddingMinPct,
    paddingMaxPct: opts.axisPaddingMaxPct,
    includeZeroTick: Boolean(opts.includeZeroTick),
    includeZeroTickIfInRange: Boolean(opts.includeZeroTickIfInRange),
    minZero: Boolean(opts.minZero)
  });
  const ticks = axis.ticks;
  const step = axis.step;
  const min = axis.min;
  const max = axis.max;
  const yTickLabelGap = 10;
  const yTickEdgePad = opts.leftAxisLabelPad ?? 16;

  ctx.font = `${fs(23)}px IBM Plex Mono`;
  const yTickLabels = ticks.map((tickVal) => (
    opts.yTickFormatter
      ? opts.yTickFormatter(tickVal, step)
      : formatTickValue(tickVal, step, Boolean(opts.percent)) + (opts.percent ? "" : (opts.yTickSuffix || ""))
  ));
  const maxLabelWidth = yTickLabels.reduce((maxWidth, label) => Math.max(maxWidth, ctx.measureText(label).width), 0);
  const baseLeftPad = Math.round((opts.leftAxisBasePad ?? 92) * horizontalScale);
  const dynamicLeftPad = Math.max(baseLeftPad, Math.ceil(maxLabelWidth + yTickLabelGap + yTickEdgePad));

  const x0 = dynamicLeftPad;
  const y0 = height - pad.b;
  const chartW = width - dynamicLeftPad - pad.r;
  const chartH = height - pad.t - pad.b;
  if (chartInteractionState[canvas.id]) {
    chartInteractionState[canvas.id].plotX0 = x0;
    chartInteractionState[canvas.id].plotW = chartW;
  }

  ctx.strokeStyle = chartGrid;
  ctx.lineWidth = 1;

  ctx.fillStyle = chartTick;
  ctx.font = `${fs(23)}px IBM Plex Mono`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  ticks.forEach((tickVal, tickIndex) => {
    const y = pad.t + ((max - tickVal) / (max - min)) * chartH;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + chartW, y);
    ctx.stroke();

    ctx.fillText(yTickLabels[tickIndex], x0 - yTickLabelGap, y + 1);
  });

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  ctx.strokeStyle = chartAxis;
  ctx.beginPath();
  ctx.moveTo(x0, pad.t);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x0 + chartW, y0);
  ctx.stroke();

  const labelToIndex = new Map(labels.map((d, i) => [d, i]));
  const markerDates = Array.isArray(opts.historyMarkerDates) ? opts.historyMarkerDates : [];
  const markerIndices = markerDates
    .map((d) => labelToIndex.get(d))
    .filter((i) => Number.isInteger(i));
  const seenMarker = new Set();
  ctx.fillStyle = chartMarker;
  markerIndices.forEach((i) => {
    if (seenMarker.has(i)) return;
    seenMarker.add(i);
    const x = chartXAtIndex(i, labels.length, x0, chartW);
    ctx.beginPath();
    ctx.arc(x, y0, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  if (opts.selectedHistoryDate && labelToIndex.has(opts.selectedHistoryDate)) {
    const i = labelToIndex.get(opts.selectedHistoryDate);
    const x = chartXAtIndex(i, labels.length, x0, chartW);
    // Large dot at the baseline behind the history marker for the selected date.
    ctx.fillStyle = snapshotHighlightRing;
    ctx.beginPath();
    ctx.arc(x, y0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = snapshotHighlightDot;
    ctx.beginPath();
    ctx.arc(x, y0, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  if (opts.hoveredHistoryDate && labelToIndex.has(opts.hoveredHistoryDate)) {
    const i = labelToIndex.get(opts.hoveredHistoryDate);
    const x = chartXAtIndex(i, labels.length, x0, chartW);

    ctx.strokeStyle = tooltipBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, y0);
    ctx.stroke();
  }

  // Draw lines in reverse order so dataset[0] (BTC) renders on top.
  datasets.slice().reverse().forEach((ds, revIdx) => {
    const idx = datasets.length - 1 - revIdx;
    ctx.strokeStyle = ds.color || COLORS[idx % COLORS.length];
    ctx.lineWidth = 3;
    if (labels.length > 1) {
      ctx.beginPath();
      ds.values.forEach((v, i) => {
        const x = chartXAtIndex(i, labels.length, x0, chartW);
        const y = pad.t + ((max - v) / (max - min)) * chartH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    } else if (ds.values.length === 1) {
      // Single point: render a centered scatter marker instead of a degenerate line.
      const x = chartXAtIndex(0, labels.length, x0, chartW);
      const y = pad.t + ((max - ds.values[0]) / (max - min)) * chartH;
      ctx.fillStyle = ds.color || COLORS[idx % COLORS.length];
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  if (opts.drawLegend !== false) {
    // Draw legend in original order so labels match tooltip ordering.
    datasets.forEach((ds, idx) => {
      const lx = x0 + 10;
      const ly = pad.t + 26 + idx * 26;
      ctx.fillStyle = ds.color || COLORS[idx % COLORS.length];
      ctx.fillRect(lx, ly - 10, 18, 3);
      ctx.fillStyle = tooltipText;
      ctx.font = `${fs(23)}px Space Grotesk`;
      ctx.fillText(ds.label, lx + 26, ly);
    });
  }

  // Draw tooltip on top of everything.
  if (opts.hoveredHistoryDate && labelToIndex.has(opts.hoveredHistoryDate)) {
    const i = labelToIndex.get(opts.hoveredHistoryDate);
    const x = chartXAtIndex(i, labels.length, x0, chartW);

    // lines: array of segment arrays [{text, color}]
    const lines = [[{ text: formatDisplayDate(opts.hoveredHistoryDate), color: tooltipTitle }]];
    datasets.forEach((ds) => {
      const val = Number(ds.values[i] || 0);
      const dsColor = ds.color || tooltipText;
      if (ds.rawValues && ds.rawFormatter) {
        const rawStr = ds.rawFormatter(ds.rawValues[i]);
        const pctStr = formatChartTooltipValue(val, true);
        const pctColor = val >= 0 ? "#39d7a4" : "#ff5555";
        lines.push([
          { text: `${rawStr} `, color: dsColor },
          { text: pctStr, color: pctColor }
        ]);
      } else {
        const pctStr = formatChartTooltipValue(val, Boolean(opts.percent));
        const pctColor = val >= 0 ? "#39d7a4" : "#ff5555";
        const valColor = opts.percent
          ? (opts.percentValueColor || pctColor)
          : dsColor;
        const valStr = ds.valueFormatter ? ds.valueFormatter(val) : pctStr;
        lines.push([{ text: valStr, color: valColor }]);
      }
    });

    ctx.font = `${fs(26)}px IBM Plex Mono`;
    const textW = Math.max(...lines.map((segs) => segs.reduce((w, s) => w + ctx.measureText(s.text).width, 0)));
    const boxW = textW + 16;
    const boxH = lines.length * 28 + 14;
    let boxX = x + 10;
    if (boxX + boxW > x0 + chartW) boxX = x - boxW - 10;
    const cursorY = (opts.hoverY != null) ? opts.hoverY : (pad.t + chartH / 2);
    const boxY = Math.max(pad.t, cursorY - boxH - 14);

    ctx.fillStyle = tooltipBg;
    ctx.strokeStyle = tooltipBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(boxX, boxY, boxW, boxH);
    ctx.fill();
    ctx.stroke();

    lines.forEach((segs, li) => {
      let xOff = boxX + 8;
      segs.forEach((seg) => {
        ctx.fillStyle = seg.color;
        ctx.fillText(seg.text, xOff, boxY + 26 + li * 28);
        xOff += ctx.measureText(seg.text).width;
      });
    });
  }

  let xTicks = buildDateLabelTicks(labels, 8);
  if (!xTicks.length) {
    const xEvery = Math.max(1, Math.floor(labels.length / 6));
    xTicks = labels
      .map((label, i) => ({ label, i }))
      .filter((p) => p.i % xEvery === 0 || p.i === labels.length - 1)
      .map((p) => ({ i: p.i, text: p.label }));
  }

  ctx.fillStyle = chartTick;
  ctx.font = `${fs(23)}px IBM Plex Mono`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  xTicks.forEach((tick) => {
    const x = chartXAtIndex(tick.i, labels.length, x0, chartW);
    ctx.fillText(tick.text, x, y0 + 18);
  });
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawLineChartDualYAxis(canvas, datasets, labels, opts = {}) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const dpr = window.devicePixelRatio || 1;
  const horizontalScale = Math.min(1, Math.max(0.5, (width / dpr) / 900));
  const pad = {
    t: CHART_PAD.t,
    b: CHART_PAD.b
  };
  const fs = (px) => px;
  const canvasBg = themeValue("--canvas-bg") || "rgba(0,0,0,0.42)";
  const chartTick = themeValue("--chart-tick") || "#a2a2a2";
  const chartGrid = themeValue("--chart-grid") || "rgba(255,255,255,0.14)";
  const chartAxis = themeValue("--chart-axis") || "rgba(255,255,255,0.28)";
  const chartMarker = themeValue("--chart-marker") || "#f5f5f5";
  const tooltipBg = themeValue("--chart-tooltip-bg") || "rgba(10,10,10,0.78)";
  const tooltipBorder = themeValue("--chart-tooltip-border") || "rgba(255,255,255,0.18)";
  const tooltipTitle = themeValue("--chart-tooltip-title") || "#f3f3f3";
  const tooltipText = themeValue("--chart-tooltip-text") || "#d0d0d0";
  const snapshotHighlightDot = themeValue("--snapshot-highlight-dot") || "#66b2ff";
  const snapshotHighlightRing = themeValue("--snapshot-highlight-ring") || "rgba(102,178,255,0.22)";

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = canvasBg;
  ctx.fillRect(0, 0, width, height);

  if (!datasets.length || !datasets[0]?.values?.length || !datasets[1]?.values?.length) {
    ctx.fillStyle = chartTick;
    ctx.font = `${fs(30)}px Space Grotesk`;
    ctx.fillText(opts.emptyMessage || "No saved data yet. Add an asset or liability.", 28, 46);
    return;
  }

  const leftAxis = opts.leftAxisScale || buildAxisScale(datasets[0].values, {
    paddingPct: opts.axisPaddingPct || 0,
    paddingMinPct: opts.axisPaddingMinPct,
    paddingMaxPct: opts.axisPaddingMaxPct,
    includeZeroTick: Boolean(opts.includeZeroTick),
    includeZeroTickIfInRange: Boolean(opts.includeZeroTickIfInRange),
    minZero: Boolean(opts.minZero)
  });
  const rightAxis = opts.rightAxisScale || buildAxisScale(datasets[1].values, {
    paddingPct: opts.axisPaddingPct || 0,
    paddingMinPct: opts.axisPaddingMinPct,
    paddingMaxPct: opts.axisPaddingMaxPct,
    includeZeroTick: Boolean(opts.includeZeroTick),
    includeZeroTickIfInRange: Boolean(opts.includeZeroTickIfInRange),
    minZero: Boolean(opts.minZero)
  });

  const resetAxisBounds = (axis, min, max) => {
    const scale = buildAxisScale([min, max], {
      paddingPct: opts.axisPaddingPct || 0,
      paddingMinPct: opts.axisPaddingMinPct,
      paddingMaxPct: opts.axisPaddingMaxPct,
      includeZeroTick: Boolean(opts.includeZeroTick),
      includeZeroTickIfInRange: Boolean(opts.includeZeroTickIfInRange),
      minZero: Boolean(opts.minZero)
    });
    axis.dataMin = scale.dataMin;
    axis.dataMax = scale.dataMax;
    axis.min = scale.min;
    axis.max = scale.max;
    axis.ticks = scale.ticks;
    axis.step = scale.step;
  };

  if (opts.alignZero) {
    const globalMin = Math.min(leftAxis.dataMin, rightAxis.dataMin);
    const globalMax = Math.max(leftAxis.dataMax, rightAxis.dataMax);
    const denom = globalMax - globalMin;
    const zeroPos = denom > 0 ? (globalMax / denom) : 0.5;

    const forceZeroPosition = (axis) => {
      if (zeroPos >= 1) {
        const forcedMax = Math.max(axis.dataMax, 0);
        resetAxisBounds(axis, 0, forcedMax === 0 ? 1 : forcedMax);
        return;
      }
      if (zeroPos <= 0) {
        const forcedMin = Math.min(axis.dataMin, 0);
        resetAxisBounds(axis, forcedMin === 0 ? -1 : forcedMin, 0);
        return;
      }

      const maxNeededForMin = (-axis.dataMin * zeroPos) / (1 - zeroPos);
      const forcedMax = Math.max(axis.dataMax, maxNeededForMin);
      const forcedMin = -(forcedMax * (1 - zeroPos)) / zeroPos;
      resetAxisBounds(axis, forcedMin, forcedMax);
    };

    forceZeroPosition(leftAxis);
    forceZeroPosition(rightAxis);
  }

  ctx.font = `${fs(23)}px IBM Plex Mono`;
  const leftTickLabels = leftAxis.ticks.map((tickVal) => (
    opts.yTickFormatter
      ? opts.yTickFormatter(tickVal, leftAxis.step, 0)
      : formatTickValue(tickVal, leftAxis.step, Boolean(opts.percent)) + (opts.percent ? "" : (opts.yTickSuffix || ""))
  ));
  const rightTickLabels = rightAxis.ticks.map((tickVal) => (
    opts.yTickFormatter
      ? opts.yTickFormatter(tickVal, rightAxis.step, 1)
      : formatTickValue(tickVal, rightAxis.step, Boolean(opts.percent)) + (opts.percent ? "" : (opts.yTickSuffix || ""))
  ));

  const leftMaxLabelWidth = leftTickLabels.reduce((maxWidth, label) => Math.max(maxWidth, ctx.measureText(label).width), 0);
  const rightMaxLabelWidth = rightTickLabels.reduce((maxWidth, label) => Math.max(maxWidth, ctx.measureText(label).width), 0);
  const yTickLabelGap = 10;
  const leftTickEdgePad = opts.leftAxisLabelPad ?? 16;
  const rightTickEdgePad = opts.rightAxisLabelPad ?? 16;

  const baseLeftPad = Math.round((opts.leftAxisBasePad ?? 92) * horizontalScale);
  const baseRightPad = Math.round((opts.rightAxisBasePad ?? 92) * horizontalScale);
  const dynamicLeftPad = Math.max(baseLeftPad, Math.ceil(leftMaxLabelWidth + yTickLabelGap + leftTickEdgePad));
  const dynamicRightPad = Math.max(baseRightPad, Math.ceil(rightMaxLabelWidth + yTickLabelGap + rightTickEdgePad));

  const x0 = dynamicLeftPad;
  const y0 = height - pad.b;
  const chartW = width - dynamicLeftPad - dynamicRightPad;
  const chartH = height - pad.t - pad.b;
  if (chartInteractionState[canvas.id]) {
    chartInteractionState[canvas.id].plotX0 = x0;
    chartInteractionState[canvas.id].plotW = chartW;
  }

  ctx.strokeStyle = chartGrid;
  ctx.lineWidth = 1;
  leftAxis.ticks.forEach((tickVal) => {
    const y = pad.t + ((leftAxis.max - tickVal) / (leftAxis.max - leftAxis.min)) * chartH;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + chartW, y);
    ctx.stroke();
  });

  if (opts.rightAxisGridLines !== false) {
    ctx.save();
    ctx.strokeStyle = opts.rightAxisGridColor || chartGrid;
    ctx.lineWidth = 1;
    rightAxis.ticks.forEach((tickVal) => {
      const y = pad.t + ((rightAxis.max - tickVal) / (rightAxis.max - rightAxis.min)) * chartH;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + chartW, y);
      ctx.stroke();
    });
    ctx.restore();
  }

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.font = `${fs(23)}px IBM Plex Mono`;
  leftAxis.ticks.forEach((tickVal, tickIndex) => {
    const y = pad.t + ((leftAxis.max - tickVal) / (leftAxis.max - leftAxis.min)) * chartH;
    ctx.fillStyle = opts.leftAxisColor || datasets[0].color || chartTick;
    ctx.fillText(leftTickLabels[tickIndex], x0 - yTickLabelGap, y + 1);
  });

  ctx.textAlign = "left";
  rightAxis.ticks.forEach((tickVal, tickIndex) => {
    const y = pad.t + ((rightAxis.max - tickVal) / (rightAxis.max - rightAxis.min)) * chartH;
    ctx.fillStyle = opts.rightAxisColor || datasets[1].color || chartTick;
    ctx.fillText(rightTickLabels[tickIndex], x0 + chartW + yTickLabelGap, y + 1);
  });

  ctx.strokeStyle = chartAxis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, pad.t);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x0 + chartW, y0);
  ctx.moveTo(x0 + chartW, pad.t);
  ctx.lineTo(x0 + chartW, y0);
  ctx.stroke();

  const labelToIndex = new Map(labels.map((d, i) => [d, i]));
  const markerDates = Array.isArray(opts.historyMarkerDates) ? opts.historyMarkerDates : [];
  const markerIndices = markerDates
    .map((d) => labelToIndex.get(d))
    .filter((i) => Number.isInteger(i));
  const seenMarker = new Set();
  ctx.fillStyle = chartMarker;
  markerIndices.forEach((i) => {
    if (seenMarker.has(i)) return;
    seenMarker.add(i);
    const x = chartXAtIndex(i, labels.length, x0, chartW);
    ctx.beginPath();
    ctx.arc(x, y0, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  if (opts.selectedHistoryDate && labelToIndex.has(opts.selectedHistoryDate)) {
    const i = labelToIndex.get(opts.selectedHistoryDate);
    const x = chartXAtIndex(i, labels.length, x0, chartW);
    ctx.fillStyle = snapshotHighlightRing;
    ctx.beginPath();
    ctx.arc(x, y0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = snapshotHighlightDot;
    ctx.beginPath();
    ctx.arc(x, y0, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  if (opts.hoveredHistoryDate && labelToIndex.has(opts.hoveredHistoryDate)) {
    const i = labelToIndex.get(opts.hoveredHistoryDate);
    const x = chartXAtIndex(i, labels.length, x0, chartW);
    ctx.strokeStyle = tooltipBorder;
    ctx.beginPath();
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, y0);
    ctx.stroke();
  }

  datasets.slice().reverse().forEach((ds, revIdx) => {
    const idx = datasets.length - 1 - revIdx;
    const axis = idx === 0 ? leftAxis : rightAxis;
    ctx.strokeStyle = ds.color || COLORS[idx % COLORS.length];
    ctx.lineWidth = 3;
    if (labels.length > 1) {
      ctx.beginPath();
      ds.values.forEach((v, i) => {
        const x = chartXAtIndex(i, labels.length, x0, chartW);
        const y = pad.t + ((axis.max - v) / (axis.max - axis.min)) * chartH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    } else if (ds.values.length === 1) {
      const x = chartXAtIndex(0, labels.length, x0, chartW);
      const y = pad.t + ((axis.max - ds.values[0]) / (axis.max - axis.min)) * chartH;
      ctx.fillStyle = ds.color || COLORS[idx % COLORS.length];
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  if (opts.drawLegend !== false) {
    datasets.forEach((ds, idx) => {
      const lx = x0 + 10;
      const ly = pad.t + 26 + idx * 26;
      ctx.fillStyle = ds.color || COLORS[idx % COLORS.length];
      ctx.fillRect(lx, ly - 10, 18, 3);
      ctx.fillStyle = tooltipText;
      ctx.font = `${fs(23)}px Space Grotesk`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(ds.label, lx + 26, ly);
    });
  }

  if (opts.hoveredHistoryDate && labelToIndex.has(opts.hoveredHistoryDate)) {
    const i = labelToIndex.get(opts.hoveredHistoryDate);
    const x = chartXAtIndex(i, labels.length, x0, chartW);
    const lines = [[{ text: formatDisplayDate(opts.hoveredHistoryDate), color: tooltipTitle }]];
    datasets.forEach((ds) => {
      const val = Number(ds.values[i] || 0);
      const dsColor = ds.color || tooltipText;
      if (ds.rawValues && ds.rawFormatter) {
        const rawStr = ds.rawFormatter(ds.rawValues[i]);
        const pctStr = formatChartTooltipValue(val, true);
        const pctColor = val >= 0 ? "#39d7a4" : "#ff5555";
        lines.push([
          { text: `${rawStr} `, color: dsColor },
          { text: pctStr, color: pctColor }
        ]);
      } else {
        const pctStr = formatChartTooltipValue(val, Boolean(opts.percent));
        const pctColor = val >= 0 ? "#39d7a4" : "#ff5555";
        const valColor = opts.percent
          ? (opts.percentValueColor || pctColor)
          : dsColor;
        const valStr = ds.valueFormatter ? ds.valueFormatter(val) : pctStr;
        lines.push([{ text: valStr, color: valColor }]);
      }
    });

    ctx.font = `${fs(26)}px IBM Plex Mono`;
    const textW = Math.max(...lines.map((segs) => segs.reduce((w, s) => w + ctx.measureText(s.text).width, 0)));
    const boxW = textW + 16;
    const boxH = lines.length * 28 + 14;
    let boxX = x + 10;
    if (boxX + boxW > x0 + chartW) boxX = x - boxW - 10;
    const cursorY = (opts.hoverY != null) ? opts.hoverY : (pad.t + chartH / 2);
    const boxY = Math.max(pad.t, cursorY - boxH - 14);

    ctx.fillStyle = tooltipBg;
    ctx.strokeStyle = tooltipBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(boxX, boxY, boxW, boxH);
    ctx.fill();
    ctx.stroke();

    lines.forEach((segs, li) => {
      let xOff = boxX + 8;
      segs.forEach((seg) => {
        ctx.fillStyle = seg.color;
        ctx.fillText(seg.text, xOff, boxY + 26 + li * 28);
        xOff += ctx.measureText(seg.text).width;
      });
    });
  }

  let xTicks = buildDateLabelTicks(labels, 8);
  if (!xTicks.length) {
    const xEvery = Math.max(1, Math.floor(labels.length / 6));
    xTicks = labels
      .map((label, i) => ({ label, i }))
      .filter((p) => p.i % xEvery === 0 || p.i === labels.length - 1)
      .map((p) => ({ i: p.i, text: p.label }));
  }

  ctx.fillStyle = chartTick;
  ctx.font = `${fs(23)}px IBM Plex Mono`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  xTicks.forEach((tick) => {
    const x = chartXAtIndex(tick.i, labels.length, x0, chartW);
    ctx.fillText(tick.text, x, y0 + 18);
  });
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function renderChartLegendRow(container, datasets = []) {
  if (!container) return;
  container.innerHTML = "";
  datasets.forEach((ds) => {
    const item = document.createElement("span");
    item.className = "chart-legend-item";

    const swatch = document.createElement("span");
    swatch.className = "chart-legend-swatch";
    swatch.style.backgroundColor = ds.color || themeValue("--chart-tooltip-text") || "#d0d0d0";

    const label = document.createElement("span");
    label.textContent = String(ds.label || "");

    item.appendChild(swatch);
    item.appendChild(label);
    container.appendChild(item);
  });
}

function renderAssetLiabilityChart(chartSnapshots = snapshots) {
  if (el.alChartTitle) {
    el.alChartTitle.textContent = alChartMode === "ratio"
      ? "Liabilities-to-Assets Ratio"
      : "Assets & Liabilities";
  }

  if (alChartMode === "ratio") {
    const allAssetNames = getAllAssetNames();
    const allAssetsExcluded = allAssetNames.length > 0 && excludedAssets.size >= allAssetNames.length;
    const plottedSnapshots = chartSnapshots.filter((s) => {
      const assetsBtc = Number(s.totals?.assets_btc || 0);
      return assetsBtc > 0;
    });

    if (!plottedSnapshots.length) {
      chartInteractionState.alChart = { labels: [], markerDates: [] };
      renderChartLegendRow(el.alChartLegend, []);
      drawLineChart(el.alChart, [], [], {
        emptyMessage: allAssetsExcluded
          ? "No LTA Ratio to show because all assets are excluded by filters."
          : "No saved data yet. Add an asset or liability."
      });
      return;
    }

    const labels = plottedSnapshots.map((s) => s.date);
    const markerDates = historyDatesIncludingToday().filter((d) => labels.includes(d));
    chartInteractionState.alChart = { labels, markerDates };

    const ratiosPct = plottedSnapshots.map((s) => {
      const assets = Number(s.totals?.assets_btc || 0);
      const liabilities = Number(s.totals?.liabilities_btc || 0);
      if (assets <= 0) return 0;
      return (liabilities / assets) * 100;
    });

    const datasets = [
      {
        label: "LTA Ratio",
        color: "#2bb5ff",
        values: ratiosPct,
        valueFormatter: (v) => `${Number(v).toFixed(2)}%`
      }
    ];

    renderChartLegendRow(el.alChartLegend, datasets);

    drawLineChart(el.alChart, datasets, labels, {
      percent: true,
      percentValueColor: "#2bb5ff",
      axisPaddingMinPct: 0.05,
      axisPaddingMaxPct: 0.01,
      drawLegend: false,
      historyMarkerDates: markerDates,
      selectedHistoryDate: editingSnapshotDate,
      hoveredHistoryDate: hoveredSnapshotDate,
      hoverY: hoveredCanvasY
    });
    return;
  }

  const shouldSuppressZeroPoints = excludedAssets.size > 0 || excludedLiabilities.size > 0;
  const plottedSnapshots = shouldSuppressZeroPoints
    ? chartSnapshots.filter((s) => {
        const assetsBtc = Number(s.totals?.assets_btc || 0);
        const liabilitiesBtc = Number(s.totals?.liabilities_btc || 0);
        return assetsBtc !== 0 || liabilitiesBtc !== 0;
      })
    : chartSnapshots;

  if (!plottedSnapshots.length) {
    chartInteractionState.alChart = { labels: [], markerDates: [] };
    renderChartLegendRow(el.alChartLegend, []);
    drawLineChart(el.alChart, [], []);
    return;
  }

  const unit = uoaSelections.primary;

  const labels = plottedSnapshots.map((s) => s.date);
  const markerDates = historyDatesIncludingToday().filter((d) => labels.includes(d));
  chartInteractionState.alChart = { labels, markerDates };
  const datasets = [
    {
      label: "Assets",
      color: "#39d7a4",
      values: plottedSnapshots.map((s) => usdToUnitValue(s.totals?.assets_usd || 0, unit, s.btcusd, s.date) || 0),
      valueFormatter: (v) => formatUoaAmount(v, unit)
    },
    {
      label: "Liabilities",
      color: "#ff6f86",
      values: plottedSnapshots.map((s) => usdToUnitValue(s.totals?.liabilities_usd || 0, unit, s.btcusd, s.date) || 0),
      valueFormatter: (v) => formatUoaAmount(v, unit)
    }
  ];

  renderChartLegendRow(el.alChartLegend, datasets);
  const chartOpts = {
    axisPaddingMinPct: 0.05,
    axisPaddingMaxPct: 0.01,
    includeZeroTickIfInRange: true,
    drawLegend: false,
    historyMarkerDates: markerDates,
    selectedHistoryDate: editingSnapshotDate,
    hoveredHistoryDate: hoveredSnapshotDate,
    hoverY: hoveredCanvasY,
    yTickFormatter: (v) => formatUoaAmount(v, unit, { minimumFractionDigits: 0 })
  };

  if (alChartSeparateAxes) {
    drawLineChartDualYAxis(el.alChart, datasets, labels, {
      ...chartOpts,
      rightAxisLabelPad: 26,
      leftAxisColor: datasets[0].color,
      rightAxisColor: datasets[1].color,
      yTickFormatter: (v) => formatUoaAmount(v, unit, { minimumFractionDigits: 0 })
    });
  } else {
    drawLineChart(el.alChart, datasets, labels, chartOpts);
  }
}

function renderNetChangeChart(chartSnapshots = snapshots) {
  const plottedSnapshots = chartSnapshots.filter((s) => {
    const assetsBtc = Number(s.totals?.assets_btc || 0);
    const liabilitiesBtc = Number(s.totals?.liabilities_btc || 0);
    return assetsBtc !== 0 || liabilitiesBtc !== 0;
  });

  if (!plottedSnapshots.length) {
    chartInteractionState.netChart = { labels: [], markerDates: [] };
    renderChartLegendRow(el.netChartLegend, []);
    drawLineChart(el.netChart, [], []);
    return;
  }

  const labels = plottedSnapshots.map((s) => s.date);
  const markerDates = historyDatesIncludingToday().filter((d) => labels.includes(d));
  chartInteractionState.netChart = { labels, markerDates };
  const primaryUnit = uoaSelections.primary;
  const secondaryUnit = uoaSelections.secondary;
  const primaryRaw = plottedSnapshots.map((s) => usdToUnitValue(s.totals.net_usd, primaryUnit, s.btcusd, s.date) || 0);
  const secondaryRaw = plottedSnapshots.map((s) => usdToUnitValue(s.totals.net_usd, secondaryUnit, s.btcusd, s.date) || 0);
  const basePrimary = Number(primaryRaw[0]) || 1e-12;
  const baseSecondary = Number(secondaryRaw[0]) || 1e-12;

  const primaryChanges = primaryRaw.map((v) => ((Number(v) - basePrimary) / basePrimary) * 100);
  const secondaryChanges = secondaryRaw.map((v) => ((Number(v) - baseSecondary) / baseSecondary) * 100);

  const datasets = [
    {
      label: `${primaryUnit} Net Worth`,
      color: uoaUnitMeta(primaryUnit).color || "#f7931a",
      values: primaryChanges,
      rawValues: primaryRaw,
      rawFormatter: (v) => formatUoaAmount(v, primaryUnit)
    },
    {
      label: `${secondaryUnit} Net Worth`,
      color: themeValue("--networth-usd-line") || "#d7dde3",
      values: secondaryChanges,
      rawValues: secondaryRaw,
      rawFormatter: (v) => formatUoaAmount(v, secondaryUnit)
    }
  ];

  renderChartLegendRow(el.netChartLegend, datasets);

  if (netChartSeparateAxes) {
    drawLineChartDualYAxis(el.netChart, datasets, labels, {
      percent: true,
      axisPaddingMinPct: 0.05,
      axisPaddingMaxPct: 0.01,
      includeZeroTick: true,
      drawLegend: false,
      leftAxisColor: datasets[0].color,
      rightAxisColor: datasets[1].color,
      historyMarkerDates: markerDates,
      selectedHistoryDate: editingSnapshotDate,
      hoveredHistoryDate: hoveredSnapshotDate,
      hoverY: hoveredCanvasY
    });
  } else {
    drawLineChart(el.netChart, datasets, labels, {
      percent: true,
      axisPaddingMinPct: 0.05,
      axisPaddingMaxPct: 0.01,
      includeZeroTick: true,
      drawLegend: false,
      historyMarkerDates: markerDates,
      selectedHistoryDate: editingSnapshotDate,
      hoveredHistoryDate: hoveredSnapshotDate,
      hoverY: hoveredCanvasY
    });
  }
}

function parseCsvRow(line) {
  const fields = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      let field = '';
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++;
          break;
        } else {
          field += line[i++];
        }
      }
      if (line[i] === ',') i++;
      fields.push(field);
    } else {
      const end = line.indexOf(',', i);
      if (end === -1) {
        fields.push(line.slice(i));
        i = line.length;
      } else {
        fields.push(line.slice(i, end));
        i = end + 1;
      }
    }
  }
  return fields;
}

function parseCsv(text) {
  const normalized = String(text || "").replace(/\r\n?/g, "\n");
  const lines = normalized.trim().split("\n").filter((l) => l.trim());
  if (!lines.length) return [];
  const headers = parseCsvRow(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvRow(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim()] = values[i] ?? ''; });
    return obj;
  });
}

async function ensureFxRatesLoaded() {
  if (fxRatesLoaded) return true;
  if (fxRatesLoadingPromise) return fxRatesLoadingPromise;

  fxRatesLoadingPromise = (async () => {
    let text = "";
    let loaded = false;
    for (const url of FX_RATE_URLS) {
      try {
        const res = await fetch(url, { cache: "no-cache" });
        if (!res.ok) continue;
        text = await res.text();
        loaded = true;
        break;
      } catch {
        // Try the next path.
      }
    }
    if (!loaded) throw new Error("daily_fx_rates.csv was unavailable");

    const normalized = text.replace(/\r\n?/g, "\n");
    const lines = normalized.trim().split("\n").filter((line) => line.trim());
    if (lines.length < 2) throw new Error("daily_fx_rates.csv had no rows");
    const headers = parseCsvRow(lines[0]).map((h) => h.trim().toLowerCase());
    const dateIndex = headers.indexOf("date");
    const codeIndex = new Map();
    UOA_UNITS.forEach((unit) => {
      if (unit.code === "BTC" || unit.code === "USD") return;
      const idx = headers.indexOf(`${unit.code.toLowerCase()}usd`);
      if (idx >= 0) codeIndex.set(unit.code, idx);
    });

    const byDate = new Map();
    const dates = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = parseCsvRow(lines[i]);
      const iso = String(parts[dateIndex] || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
      const row = {};
      codeIndex.forEach((idx, code) => {
        const value = Number(parts[idx]);
        if (Number.isFinite(value) && value > 0) row[code] = value;
      });
      if (Object.keys(row).length) {
        byDate.set(iso, row);
        dates.push(iso);
      }
    }

    fxRatesByDate = byDate;
    fxRateDates = dates.sort();
    fxRatesLoaded = true;
    return true;
  })().finally(() => {
    fxRatesLoadingPromise = null;
  });

  return fxRatesLoadingPromise;
}

function parseHistoricalPrices(text) {
  // Some legacy rows have the ISO datetime split across two lines; retain the
  // existing continuation handling while building a detached candidate map.
  const rawLines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const fullLines = [];
  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^\d+\/\d+\/\d+/.test(trimmed)) {
      fullLines.push(trimmed);
    } else if (fullLines.length > 0) {
      fullLines[fullLines.length - 1] += `,${trimmed}`;
    }
  }

  const prices = {};
  let earliestDateMs = Number.POSITIVE_INFINITY;
  let latestDateMs = 0;
  for (const line of fullLines) {
    const parts = line.split(",");
    const dateParts = String(parts[0] || "").trim().split("/");
    if (dateParts.length !== 3) continue;
    const month = Number(dateParts[0]);
    const day = Number(dateParts[1]);
    const rawYear = Number(dateParts[2]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const date = new Date(year, month - 1, day);
    if (!Number.isInteger(month) || !Number.isInteger(day)
        || !Number.isInteger(year) || date.getFullYear() !== year
        || date.getMonth() !== month - 1 || date.getDate() !== day) {
      continue;
    }

    let price = 0;
    for (let index = 2; index < parts.length; index += 1) {
      const value = Number(parts[index].trim());
      if (Number.isFinite(value) && value > 0) {
        price = value;
        break;
      }
    }
    if (price <= 0) continue;

    const key = `${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}${String(year).slice(-2)}`;
    prices[key] = price;
    earliestDateMs = Math.min(earliestDateMs, date.getTime());
    latestDateMs = Math.max(latestDateMs, date.getTime());
  }

  const count = Object.keys(prices).length;
  if (!count || !latestDateMs) {
    throw new Error("Published BTC price history has no usable rows.");
  }
  return { prices, count, earliestDateMs, latestDateMs };
}

function updateModeToggleUI() {
  document.getElementById("modeDemoBtn").classList.toggle("active", currentMode === "demo");
  document.getElementById("modeLiveBtn").classList.toggle("active", currentMode === "live");
  const isLive = currentMode === "live";
  const hasLiveData = isLive && snapshots.length > 0;
  const isEnc = isLive && liveEncryptionEnabled;
  const isLiveLocked = isLive && liveAccessLocked;
  if (el.clearDataBtn) {
    el.clearDataBtn.disabled = !hasLiveData;
    el.clearDataBtn.title = !isLive
      ? "Switch to Live mode to clear data"
      : (hasLiveData ? "Clear all live data" : "No live data to clear");
  }
  if (el.lockDataBtn) {
    el.lockDataBtn.disabled = !isEnc;
    el.lockDataBtn.title = !isEnc
      ? "Only available when encryption is enabled"
      : (liveAccessLocked ? "Unlock encrypted data" : "Lock encrypted data");
  }
  if (el.saveDataBtn) {
    el.saveDataBtn.disabled = !isLive || isLiveLocked;
    el.saveDataBtn.title = !isLive
      ? "Switch to Live mode to save a file"
      : (isEnc ? "Save encrypted history (.enc)" : "Save history as CSV (.csv)");
  }

  if (el.encryptionToggleWrap) {
    el.encryptionToggleWrap.classList.add("visible");
    el.encryptionToggleWrap.classList.toggle("disabled", !isLive);
  }
  if (el.liveEncryptionEnabled) {
    el.liveEncryptionEnabled.checked = isLive ? liveEncryptionEnabled : false;
  }
  if (el.liveEncryptionEnabled) {
    el.liveEncryptionEnabled.disabled = !isLive || isLiveLocked;
  }
  if (el.loadLiveFileBtn) {
    el.loadLiveFileBtn.disabled = !isLive || isLiveLocked;
    el.loadLiveFileBtn.title = !isLive
      ? "Switch to Live mode to load local data"
      : "Load local CSV or ENC data";
  }

  const lockableSelectors = [
    "#refreshQuoteBtn",
    "#manualBtcusd",
    "#chartStartDateBtn",
    "#chartEndDateBtn",
    "#assetsFilterBtn",
    "#liabilitiesFilterBtn",
    "#primaryUoaValue",
    "#secondaryUoaValue",
    "#primaryUoaDropdownTrigger",
    "#secondaryUoaDropdownTrigger",
    "#primaryUoaSelect",
    "#secondaryUoaSelect",
    ".add-row-btn",
    ".small-btn",
    "#assetsRows input",
    "#assetsRows select",
    "#liabilitiesRows input",
    "#liabilitiesRows select"
  ];
  lockableSelectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => {
      node.disabled = Boolean(isLiveLocked);
    });
  });
}

// Try to decrypt and load live encrypted data. Returns true on success.
async function unlockLiveEncryptedData(password) {
  const encSnap = localStorage.getItem(STORE_KEY_LIVE_ENC);
  const encForm = localStorage.getItem(FORM_KEY_LIVE_ENC);
  const defaultForm = DEFAULT_FORM_LIVE;
  try {
    if (encSnap) {
      const plain = await decryptText(encSnap, password);
      snapshots = parseSnapshotsRaw(plain);
    } else {
      snapshots = [];
    }
    if (encForm) {
      const plain = await decryptText(encForm, password);
      formState = parseFormFromRaw(plain, defaultForm);
    } else {
      formState = structuredClone(defaultForm);
    }
    return true;
  } catch {
    return false;
  }
}

async function enableLiveEncryption() {
  const pw = await promptForPassword({ confirm: true, message: "Set an encryption password for live data." });
  if (!pw) { el.liveEncryptionEnabled.checked = false; return; }

  try {
    const sorted = snapshots.slice().sort((a, b) => parseMMDDYY(b.date) - parseMMDDYY(a.date));
    const encSnapshots = await encryptText(JSON.stringify(sorted), pw);
    const encForm = await encryptText(JSON.stringify(formState), pw);
    localStorage.setItem(STORE_KEY_LIVE_ENC, encSnapshots);
    localStorage.setItem(FORM_KEY_LIVE_ENC, encForm);
    localStorage.removeItem(STORE_KEY_LIVE);
    localStorage.removeItem(FORM_KEY_LIVE);
    localStorage.setItem(LIVE_ENCRYPTION_ENABLED_KEY, "1");
    liveEncryptionPassword = pw;
    liveEncryptionEnabled = true;
  } catch (err) {
    el.liveEncryptionEnabled.checked = false;
    liveEncryptionEnabled = false;
    liveEncryptionPassword = null;
    try { localStorage.setItem(LIVE_ENCRYPTION_ENABLED_KEY, "0"); } catch {}
    const reason = (err && err.message) ? err.message : String(err);
    alert(`Could not enable encryption: ${reason}`);
  }
  updateModeToggleUI();
}

async function disableLiveEncryption() {
  const hasLocalEnc = Boolean(localStorage.getItem(STORE_KEY_LIVE_ENC));
  if (!hasLocalEnc) {
    el.liveEncryptionEnabled.checked = false;
    liveEncryptionEnabled = false;
    liveEncryptionPassword = null;
    localStorage.setItem(LIVE_ENCRYPTION_ENABLED_KEY, "0");
    updateModeToggleUI();
    return;
  }

  let decryptedSnapshots = null;
  let decryptedFormState = null;

  const pw = await promptForPasswordWithLiveReset({
    confirm: false,
    message: "Enter your encryption password to decrypt and disable encryption.",
    validator: async (p) => {
      const encSnap = localStorage.getItem(STORE_KEY_LIVE_ENC);
      if (!encSnap) return "No encrypted data found in local storage.";
      try {
        const plain = await decryptText(encSnap, p);
        decryptedSnapshots = parseSnapshotsRaw(plain);
      } catch {
        decryptedSnapshots = null;
        return "Incorrect password. Please try again.";
      }
      const encForm = localStorage.getItem(FORM_KEY_LIVE_ENC);
      if (encForm) {
        try {
          decryptedFormState = parseFormFromRaw(await decryptText(encForm, p), DEFAULT_FORM_LIVE);
        } catch {}
      }
      return null;
    }
  });

  if (!pw) {
    el.liveEncryptionEnabled.checked = true;
    return;
  }

  if (decryptedSnapshots === null) {
    el.liveEncryptionEnabled.checked = true;
    return;
  }

  snapshots = decryptedSnapshots;
  if (decryptedFormState) formState = decryptedFormState;
  liveEncryptionPassword = pw;
  localStorage.setItem(STORE_KEY_LIVE, JSON.stringify(snapshots));
  localStorage.setItem(FORM_KEY_LIVE, JSON.stringify(formState));
  localStorage.removeItem(STORE_KEY_LIVE_ENC);
  localStorage.removeItem(FORM_KEY_LIVE_ENC);
  liveEncryptionEnabled = false;
  liveEncryptionPassword = null;
  localStorage.setItem(LIVE_ENCRYPTION_ENABLED_KEY, "0");
  updateModeToggleUI();
}

async function switchMode(newMode) {
  if (newMode === currentMode) return;

  currentMode = newMode;
  localStorage.setItem(MODE_KEY, currentMode);
  hoveredSnapshotDate = null;
  chartRange = { startDate: null, endDate: null };
  netChartRange = { startDate: null, endDate: null };
  alChartRange = { startDate: null, endDate: null };
  el.chartStartDate.value = "";
  el.chartEndDate.value = "";
  editingSnapshotDate = mmddyy(new Date());
  hasUnsavedAssetLiabilityChanges = false;
  loadFilters(currentMode);

  if (currentMode === "live") {
    formState = loadForm();
    if (liveEncryptionEnabled) {
      const hasEncData = Boolean(localStorage.getItem(STORE_KEY_LIVE_ENC));
      if (hasEncData && liveEncryptionPassword) {
        const ok = await unlockLiveEncryptedData(liveEncryptionPassword);
        if (!ok) {
          // Session password no longer valid — fall back to demo
          currentMode = "demo";
          localStorage.setItem(MODE_KEY, currentMode);
          formState = freshFormState("demo");
        }
      } else if (hasEncData) {
        const pw = await promptForPasswordWithLiveReset({
          confirm: false,
          forceDemoOnCancel: false,
          returnClearAction: true,
          validator: async (p) => {
            const ok = await unlockLiveEncryptedData(p);
            return ok ? null : "Incorrect password. Please try again.";
          }
        });
        if (pw === RESET_LIVE_DATA_ACTION) {
          currentMode = "live";
          localStorage.setItem(MODE_KEY, currentMode);
          snapshots = loadSnapshots();
          formState = loadForm();
          liveEncryptionPassword = null;
        } else if (pw) {
          liveEncryptionPassword = pw;
        } else {
          // Cancelled — revert to demo mode
          currentMode = "demo";
          localStorage.setItem(MODE_KEY, currentMode);
          formState = freshFormState("demo");
        }
      } else {
        snapshots = loadSnapshots();
      }
    } else {
      snapshots = loadSnapshots();
    }
  } else {
    // Switching to demo — clear session password so re-auth is required on return.
    liveEncryptionPassword = null;
    snapshots = loadSnapshots();
    formState = freshFormState("demo");
  }

  seedTodayFormStateFromHistory({ save: true });
  formState.useManualBtcusd = false;
  formState.manualBtcusd = null;
  renderAll();
  if (currentMode === "demo") {
    // Final guard: ensure charts are not constrained by any previous live range.
    chartRange = { startDate: null, endDate: null };
    el.chartStartDate.value = "";
    el.chartEndDate.value = "";
    renderChartsOnly();
  }
  updateModeToggleUI();
}

function composePublishedDataSignature(historyText, priceMarkerText) {
  return [historyText, priceMarkerText]
    .map((text) => String(text || "").trim())
    .join(PUBLISHED_DATA_SIGNATURE_SEPARATOR);
}

function parsePublishedDemoHistory(text, priceMap) {
  const rows = parseCsv(text);
  if (!rows.length) {
    throw new Error("Published demo history is empty.");
  }

  const parsedSnapshots = rows.map((row) => {
    const yyyymmddDate = String(row.date || "").trim();
    if (!/^\d{8}$/.test(yyyymmddDate)) {
      throw new Error(`Published demo history has an invalid date: ${yyyymmddDate || "missing"}.`);
    }
    const mmddyyDate = yyyymmddToMMDDYY(yyyymmddDate);
    const btcusd = Number(priceMap?.[mmddyyDate] || 0);
    if (!Number.isFinite(btcusd) || btcusd <= 0) {
      throw new Error(`Published BTC prices do not cover demo snapshot ${yyyymmddDate}.`);
    }
    const assetsRaw = row.assets;
    const liabilitiesRaw = row.liabilities;
    const assets = typeof assetsRaw === "string" ? JSON.parse(assetsRaw) : (assetsRaw || []);
    const liabilities = typeof liabilitiesRaw === "string" ? JSON.parse(liabilitiesRaw) : (liabilitiesRaw || []);
    if (!Array.isArray(assets) || !Array.isArray(liabilities)) {
      throw new Error(`Published demo history has invalid holdings for ${yyyymmddDate}.`);
    }

    return {
      date: mmddyyDate,
      timestamp: parseMMDDYY(mmddyyDate).toISOString(),
      btcusd,
      assets,
      liabilities,
      comments: row.comment || row.comments || "",
      totals: computeTotals(assets, liabilities, btcusd, mmddyyDate)
    };
  });

  const dates = new Set(parsedSnapshots.map((snapshot) => snapshot.date));
  if (dates.size !== parsedSnapshots.length) {
    throw new Error("Published demo history contains duplicate dates.");
  }
  return parsedSnapshots;
}

async function fetchPublishedDataSignature(fetchResource) {
  const [historyResponse, priceMarkerResponse] = await Promise.all([
    fetchResource(PUBLISHED_DEMO_HISTORY_URL, { cache: "no-store" }),
    fetchResource(HIST_PRICE_MARKER_URL, { cache: "no-store" }),
  ]);
  if (!historyResponse?.ok) {
    throw new Error(`Published demo history failed to load (${historyResponse?.status || "network error"}).`);
  }
  if (!priceMarkerResponse?.ok) {
    throw new Error(`Published BTC price marker failed to load (${priceMarkerResponse?.status || "network error"}).`);
  }

  const [historyText, priceMarkerText] = await Promise.all([
    historyResponse.text(),
    priceMarkerResponse.text(),
  ]);
  if (!String(priceMarkerText || "").trim()) {
    throw new Error("Published BTC price marker is empty.");
  }
  return {
    historyText,
    priceMarkerText,
    signature: composePublishedDataSignature(historyText, priceMarkerText),
  };
}

async function fetchPublishedDemoCandidate(fetchResource, expectedSignature = "") {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const signatureBefore = await fetchPublishedDataSignature(fetchResource);
      const priceResponse = await fetchResource(HIST_PRICE_URL, { cache: "no-store" });
      if (!priceResponse?.ok) {
        throw new Error(`Published BTC price history failed to load (${priceResponse?.status || "network error"}).`);
      }
      const priceText = await priceResponse.text();
      const signatureAfter = await fetchPublishedDataSignature(fetchResource);
      if (signatureBefore.signature !== signatureAfter.signature) {
        throw new Error("Published Net Worth generation changed during candidate loading.");
      }

      const historyText = signatureAfter.historyText;
      const priceCandidate = parseHistoricalPrices(priceText);
      const candidateSnapshots = parsePublishedDemoHistory(historyText, priceCandidate.prices);
      const snapshotTimes = candidateSnapshots.map((snapshot) => parseMMDDYY(snapshot.date).getTime());
      return {
        historyText,
        priceText,
        prices: priceCandidate.prices,
        priceCount: priceCandidate.count,
        earliestPriceDateMs: priceCandidate.earliestDateMs,
        latestPriceDateMs: priceCandidate.latestDateMs,
        snapshots: candidateSnapshots,
        latestSnapshotDateMs: Math.max(...snapshotTimes),
        earliestSnapshotDateMs: Math.min(...snapshotTimes),
        signature: signatureAfter.signature,
        matchesExpectedSignature: !expectedSignature || signatureAfter.signature === expectedSignature,
      };
    } catch (error) {
      lastError = error;
      if (attempt >= 2) break;
      await new Promise((resolve) => window.setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  throw lastError || new Error("Could not load a stable published Net Worth generation.");
}

function validatePublishedDemoCandidate(candidate) {
  if (!candidate || !Array.isArray(candidate.snapshots) || candidate.snapshots.length === 0) return false;
  if (!candidate.prices || typeof candidate.prices !== "object") return false;
  if (candidate.matchesExpectedSignature === false) return false;

  if (candidate.snapshots.length < Math.max(MIN_PUBLISHED_DEMO_SNAPSHOTS, publishedDemoSnapshotCount)
      || (publishedDemoEarliestDateMs > 0
        && candidate.earliestSnapshotDateMs > publishedDemoEarliestDateMs)
      || candidate.latestSnapshotDateMs < publishedDemoLatestDateMs
      || candidate.priceCount < Math.max(MIN_PUBLISHED_HISTORICAL_PRICE_ROWS, publishedHistoricalPriceCount)
      || candidate.earliestPriceDateMs > LATEST_ALLOWED_PRICE_HISTORY_START_MS
      || (publishedHistoricalPriceEarliestDateMs > 0
        && candidate.earliestPriceDateMs > publishedHistoricalPriceEarliestDateMs)
      || candidate.latestPriceDateMs < publishedHistoricalPriceLatestDateMs
      || candidate.latestPriceDateMs < candidate.latestSnapshotDateMs) {
    return false;
  }

  const snapshotsCovered = candidate.snapshots.every((snapshot) => {
    const candidatePrice = Number(candidate.prices[snapshot.date]);
    return Number.isFinite(candidatePrice)
      && candidatePrice > 0
      && candidatePrice === Number(snapshot.btcusd);
  });
  if (!snapshotsCovered) return false;

  // The charts interpolate every calendar day between demo snapshots. Reject
  // an otherwise plausible file with a missing interior section rather than
  // silently carrying a stale snapshot price through that gap.
  const cursor = new Date(candidate.earliestSnapshotDateMs);
  while (cursor.getTime() <= candidate.latestPriceDateMs) {
    if (!(Number(candidate.prices[mmddyy(cursor)]) > 0)) return false;
    cursor.setDate(cursor.getDate() + 1);
  }
  return true;
}

function applyPublishedSnapshotToFormState(snapshot) {
  if (!snapshot) return;
  formState.assets = (snapshot.assets || []).map((asset) => ({
    name: String(asset.name || ""),
    amount: parseRowAmount(asset.value),
    unit: normalizeUnit(asset.unit)
  }));
  formState.liabilities = (snapshot.liabilities || []).map((liability) => ({
    name: String(liability.name || ""),
    amount: parseRowAmount(liability.value),
    unit: normalizeUnit(liability.unit)
  }));
  formState.comments = snapshot.comments || "";
}

function flushPublishedDemoRefreshRender() {
  if (!publishedDemoRefreshRenderPending) return false;
  if (document.visibilityState === "hidden" || isAssetLiabilityEditorFocused()) return false;
  renderAll();
  publishedDemoRefreshRenderPending = false;
  return true;
}

function installPublishedDemoCandidate(candidate, { startup = false } = {}) {
  const sortedPublishedSnapshots = candidate.snapshots.slice().sort(
    (a, b) => parseMMDDYY(b.date) - parseMMDDYY(a.date)
  );
  const serializedPublishedSnapshots = JSON.stringify(sortedPublishedSnapshots);

  // A full localStorage quota must not leave half of a generation installed in
  // memory or turn an otherwise valid background refresh into a retry loop.
  try {
    localStorage.setItem(STORE_KEY_DEMO, serializedPublishedSnapshots);
  } catch (error) {
    console.warn("Could not cache refreshed published demo history:", error);
  }

  historicalPrices = candidate.prices;
  publishedDemoSnapshotCount = sortedPublishedSnapshots.length;
  publishedDemoEarliestDateMs = candidate.earliestSnapshotDateMs;
  publishedDemoLatestDateMs = candidate.latestSnapshotDateMs;
  publishedHistoricalPriceCount = candidate.priceCount;
  publishedHistoricalPriceEarliestDateMs = candidate.earliestPriceDateMs;
  publishedHistoricalPriceLatestDateMs = candidate.latestPriceDateMs;
  publishedDemoInstalledSignature = candidate.signature;

  if (currentMode === "demo") {
    if (startup) {
      snapshots = sortedPublishedSnapshots;
      editingSnapshotDate = mmddyy(new Date());
      hasUnsavedAssetLiabilityChanges = false;
      seedTodayFormStateFromHistory({ save: true });
      chartRange = { startDate: null, endDate: null };
    } else {
      const selectedDate = editingSnapshotDate;
      const preserveEditorState = hasUnsavedAssetLiabilityChanges || isAssetLiabilityEditorFocused();
      snapshots = sortedPublishedSnapshots;
      if (!preserveEditorState) {
        const selectedSnapshot = snapshots.find((snapshot) => snapshot.date === selectedDate);
        if (selectedSnapshot) {
          applyPublishedSnapshotToFormState(selectedSnapshot);
          saveForm();
        } else if (selectedDate === mmddyy(new Date())) {
          seedTodayFormStateFromHistory({ save: true });
        }
      }
    }
  }

  if (startup) return true;
  publishedDemoRefreshRenderPending = true;
  if (document.visibilityState === "hidden" || isAssetLiabilityEditorFocused()) return true;
  flushPublishedDemoRefreshRender();
  return true;
}

function registerPublishedDemoDataRefresh() {
  const controller = window.WSBWebappDataAutoRefresh;
  if (!controller?.register) return;

  controller.register({
    getInstalledSignature: () => publishedDemoInstalledSignature,
    async prepare(context) {
      return fetchPublishedDemoCandidate(context.fetchFresh, context.signature);
    },
    validate(candidate) {
      return validatePublishedDemoCandidate(candidate);
    },
    commit(candidate) {
      return installPublishedDemoCandidate(candidate);
    },
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") flushPublishedDemoRefreshRender();
  });
  document.addEventListener("focusout", () => {
    window.setTimeout(flushPublishedDemoRefreshRender, 0);
  });
}

async function loadDemoData(candidatePromise) {
  try {
    const candidate = await candidatePromise;
    if (!validatePublishedDemoCandidate(candidate)) return false;
    await migrateCsvToIncludeCommentColumnIfMissing(candidate.historyText, candidate.snapshots, {
      encrypted: false,
      filename: "demo_history.csv"
    });
    installPublishedDemoCandidate(candidate, { startup: true });
    renderAll();
    return true;
  } catch (e) {
    console.warn("Could not load demo data:", e);
    return false;
  }
}

function download(filename, content, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
