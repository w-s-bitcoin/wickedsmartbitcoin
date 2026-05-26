(() => {
  const DATA_URL = "webapp_data/patoshi_blocks.csv";
  const META_URL = "webapp_data/patoshi_metadata.json";
  const STORAGE_KEY = "wsb_patoshi_pattern_state_v6";
  const SHARE_STATE_PARAM = "state";
  const LOCAL_RUNTIME_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
  const IS_LOCAL_RUNTIME = LOCAL_RUNTIME_HOSTS.has(window.location.hostname);
  const ICONS = {
    copyLink: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
    copyCopied: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>',
    resetDefaults: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>',
    resetUndo: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>',
  };
  const DAY = 86400000;
  const HOUR = 3600000;
  const GENESIS_MS = Date.UTC(2009, 0, 3, 18, 15, 0);
  const DEFAULT_ANIMATION_START_MS = GENESIS_MS;
  const DEFAULT_ANIMATION_END_MS = Date.UTC(2010, 5, 1, 0, 0);
  const SPENT_REWARDS_PAGE_SIZE = 100;
  const SPENT_REWARDS_BOTTOM_THRESHOLD_PX = 4;
  const SPENT_REWARDS_LOAD_DELAY_MS = 250;
  const AUTO_REFRESH_MS = 60000;
  const EXPORT_FPS = 30;
  const EXPORT_START_HOLD_FRAMES = EXPORT_FPS;
  const EXPORT_END_HOLD_FRAMES = EXPORT_FPS * 3;
  const EXPORT_SPEEDS = [0.5, 1, 2, 4];
  const DASHBOARD_TIME = window.WSBDashboardTime || null;
  const COLORS = {
    patoshi: "#ff9900",
    other: "#0065ff",
    spentDark: "#7f8d94",
    spentLight: "#a8b3ba",
    gridDark: "#242424",
    gridLight: "#dedede",
    green: "#41b36b",
    red: "#d33a45",
    grey: "#95a6ae",
    greyLight: "#c9d2d7",
  };

  const DEFAULT_EXPORT_SETTINGS = {
    orientation: "landscape",
    quality: 720,
    speed: 1,
    theme: "dark",
    endFrameHold: true,
  };

  function getDefaultMarkerScale() {
    return window.matchMedia?.("(max-width: 750px)")?.matches ? 0.5 : 1;
  }

  const state = {
    startMs: Date.UTC(2008, 11, 4, 18, 15, 0),
    endMs: Date.UTC(2009, 0, 3, 18, 15, 0),
    animationStartMs: DEFAULT_ANIMATION_START_MS,
    animationEndMs: DEFAULT_ANIMATION_END_MS,
    finalEndMs: DEFAULT_ANIMATION_END_MS,
    yMode: "rolling_patoshi",
    yMaxCustom: 2650,
    countMetric: "spent",
    hashrateWindowMatch: true,
    hashrateWindowDays: 30,
    patoshiPattern: "updated",
    patoshiIncludeBlocks: "",
    patoshiExcludeBlocks: "",
    spentRewardsSort: "latest_spent",
    spentRewardsPatoshiOnly: false,
    blockClickAction: "mempool",
    markerScale: getDefaultMarkerScale(),
    showSpent: true,
    markSpent: false,
    showPatoshiLine: true,
    showOrder: false,
    speedIndex: 1,
    playing: false,
    paused: false,
    isExporting: false,
    exportCancelRequested: false,
    exportSettings: { ...DEFAULT_EXPORT_SETTINGS },
  };

  const speeds = [
    { label: "0.5x", multiplier: 0.5 },
    { label: "1x", multiplier: 1 },
    { label: "2x", multiplier: 2 },
    { label: "4x", multiplier: 4 },
  ];

  let rows = [];
  let maxDatasetExtraNonce = null;
  let rowsByHeight = new Map();
  let metadata = null;
  let dataSignature = null;
  let autoRefreshTimer = 0;
  let refreshCheckInFlight = false;
  let minMs = 0;
  let maxMs = 1;
  let rafId = 0;
  let lastFrameTime = 0;
  let selectedHandle = "end";
  let lastAdjustedHandle = null;
  let rangeDrag = null;
  let chartDrag = null;
  let chartResizeWheelRemainder = 0;
  let blockClickTimer = 0;
  let suppressNextChartClick = false;
  let activeDatePicker = null;
  let theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  let updatedKpiTimeZone = DASHBOARD_TIME?.getPreferredTimeZone?.() || "UTC";
  let diffMarkerHitboxes = [];
  let blockMarkerHitboxes = [];
  let chartPlotArea = null;
  let xAxisHitArea = null;
  let yAxisHitArea = null;
  let yAxisRestoreMode = null;
  let spentRewardsPanelOpen = false;
  let highlightedSpentBlockHeight = null;
  let highlightedSpentBlockSource = null;
  let highlightedSpentBlockCentered = false;
  let spentRewardsVisibleCount = SPENT_REWARDS_PAGE_SIZE;
  let spentRewardsLoading = false;
  let spentRewardsLoadGeneration = 0;
  let blockSearchHighlightTimer = 0;
  let layoutSyncRaf = 0;
  let rangeResizeObserver = null;
  let downloadEstimateCalibrationTimer = null;
  let downloadEstimateCalibrationRequestId = 0;
  let exportRenderRect = null;
  let patoshiIncludeSet = new Set();
  let patoshiExcludeSet = new Set();
  let patternBlockPickMode = null;
  let preResetStateSnapshot = null;
  let pendingShareState = null;
  const downloadEstimateCalibrationCache = new Map();
  const downloadEstimateCalibrationPending = new Set();

  const $ = (id) => document.getElementById(id);
  let canvas = $("patoshiChart");
  let ctx = canvas.getContext("2d", { alpha: false });
  const els = {
    loadingRing: $("loadingRing"),
    startInput: $("startInput"),
    endInput: $("endInput"),
    startRange: $("startRange"),
    endRange: $("endRange"),
    rangeLine: $("rangeLine"),
    rangeAnimationFill: $("rangeAnimationFill"),
    rangeFill: $("rangeFill"),
    startMarker: $("startMarker"),
    endMarker: $("endMarker"),
    windowDaysInput: $("windowDaysInput"),
    windowDaysSuffix: $("windowDaysSuffix"),
    playBtn: $("playBtn"),
    pauseBtn: $("pauseBtn"),
    stopBtn: $("stopBtn"),
    speedBtn: $("speedBtn"),
    expandBtn: $("expandBtn"),
    downloadBtn: $("downloadBtn"),
    settingsBtn: $("settingsBtn"),
    settingsPanel: $("settingsPanel"),
    downloadPanelBtn: $("downloadSettingsDownloadBtn"),
    downloadEndFrameHoldToggle: $("downloadEndFrameHoldToggle"),
    downloadEstimateSize: $("downloadEstimateSize"),
    downloadEstimateLength: $("downloadEstimateLength"),
    downloadEstimateTime: $("downloadEstimateTime"),
    chartTooltip: $("chartTooltip"),
    filtersBtn: $("filtersBtn"),
    filtersPanel: $("filtersPanel"),
    filtersClose: $("filtersClose"),
    spentRewardsPanelBtn: $("spentRewardsPanelBtn"),
    spentRewardsPanel: $("spentRewardsPanel"),
    spentRewardsPanelClose: $("spentRewardsPanelClose"),
    spentRewardsList: $("spentRewardsList"),
    spentRewardsSort: $("spentRewardsSort"),
    spentRewardsPatoshiOnly: $("spentRewardsPatoshiOnly"),
    blockSearchPill: $("blockSearchPill"),
    blockSearchInput: $("blockSearchInput"),
    blockSearchClear: $("blockSearchClear"),
    updatedKpiValue: $("updatedKpiValue"),
    updatedTimeZoneSelect: $("updatedTimeZoneSelect"),
    copyLinkBtn: $("copyLinkBtn"),
    restoreBtn: $("restoreBtn"),
    startBtn: $("startBtn"),
    endBtn: $("endBtn"),
    startBtnLabel: $("startBtnLabel"),
    endBtnLabel: $("endBtnLabel"),
    yMode: $("yMode"),
    yMaxInput: $("yMaxInput"),
    countMetric: $("countMetric"),
    hashrateWindowInput: $("hashrateWindowInput"),
    hashrateWindowSuffix: $("hashrateWindowSuffix"),
    hashrateWindowMatch: $("hashrateWindowMatch"),
    patoshiPatternButtons: Array.from(document.querySelectorAll("[data-patoshi-pattern]")),
    patoshiIncludeInput: $("patoshiIncludeInput"),
    patoshiExcludeInput: $("patoshiExcludeInput"),
    patoshiIncludePickBtn: $("patoshiIncludePickBtn"),
    patoshiExcludePickBtn: $("patoshiExcludePickBtn"),
    blockClickButtons: Array.from(document.querySelectorAll("[data-block-click-action]")),
    markerScaleInput: $("markerScaleInput"),
    markerScaleMinus: $("markerScaleMinus"),
    markerScalePlus: $("markerScalePlus"),
    showSpent: $("showSpent"),
    markSpent: $("markSpent"),
    showPatoshiLine: $("showPatoshiLine"),
    showOrder: $("showOrder"),
  };

  function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    const header = lines.shift().split(",");
    return lines.map((line) => {
      const parts = line.split(",");
      const item = {};
      header.forEach((key, index) => { item[key] = parts[index]; });
      return {
        height: Number(item.height),
        timestamp: Number(item.timestamp),
        ms: Number(item.timestamp) * 1000,
        datetime: item.datetime,
        extranonce: Number(item.extranonce),
        isSpent: item.is_spent === "1",
        spendingHeight: item.spending_height ? Number(item.spending_height) : null,
        spendingTimestamp: item.spending_timestamp ? Number(item.spending_timestamp) : null,
        spendingDatetime: item.spending_datetime || "",
        patoshi: item.patoshi === "1",
        patoshiOriginal: item.patoshi_original ? item.patoshi_original === "1" : item.patoshi === "1",
        patoshiUpdated: item.patoshi_updated ? item.patoshi_updated === "1" : item.patoshi === "1",
        difficulty: Number(item.difficulty),
        targetHashrate: Number(item.target_hashrate),
      };
    });
  }

  function saveState({ preserveResetUndo = false } = {}) {
    try {
      if (preResetStateSnapshot && !preserveResetUndo) {
        preResetStateSnapshot = null;
      }
      const copy = {
        ...state,
        playing: false,
        paused: state.playing || state.paused,
        sidePanelOpen: spentRewardsPanelOpen,
        highlightedSpentBlockHeight: Number.isFinite(highlightedSpentBlockHeight) ? highlightedSpentBlockHeight : null,
        highlightedSpentBlockSource,
        highlightedSpentBlockCentered,
        updatedKpiTimeZone,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(copy));
      updateResetButtonUi();
    } catch (_) {}
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

  function loadState() {
    try {
      const shareState = getDashboardShareStateFromUrl();
      if (shareState) {
        pendingShareState = shareState;
        return true;
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      spentRewardsPanelOpen = !!parsed.sidePanelOpen;
      const savedHighlightedHeight = parsed.highlightedSpentBlockHeight;
      const highlightedHeight = Number(savedHighlightedHeight);
      highlightedSpentBlockHeight = savedHighlightedHeight !== null
        && savedHighlightedHeight !== undefined
        && Number.isFinite(highlightedHeight)
        ? highlightedHeight
        : null;
      highlightedSpentBlockSource = Number.isFinite(highlightedSpentBlockHeight)
        ? (parsed.highlightedSpentBlockSource === "search" ? "search" : "panel")
        : null;
      highlightedSpentBlockCentered = Number.isFinite(highlightedSpentBlockHeight) && parsed.highlightedSpentBlockCentered !== false;
      delete parsed.sidePanelOpen;
      delete parsed.highlightedSpentBlockHeight;
      delete parsed.highlightedSpentBlockSource;
      delete parsed.highlightedSpentBlockCentered;
      Object.assign(state, parsed);
      state.playing = false;
      state.paused = !!state.paused;
      state.isExporting = false;
      state.exportCancelRequested = false;
      if (state.yMode === "fixed_2650") state.yMode = "custom";
      if (!["rolling_patoshi", "window_patoshi", "window_all", "custom"].includes(state.yMode)) {
        state.yMode = "rolling_patoshi";
      }
      state.yMaxCustom = normalizeYMaxCustom(state.yMaxCustom);
      state.hashrateWindowMatch = parsed.hashrateWindowMatch !== false;
      state.hashrateWindowDays = normalizeHashrateWindowDays(parsed.hashrateWindowDays);
      if (!["updated", "original", "none"].includes(state.patoshiPattern)) state.patoshiPattern = "updated";
      if (!["latest_spent", "earliest_spent", "latest_height", "earliest_height"].includes(state.spentRewardsSort)) {
        state.spentRewardsSort = "latest_spent";
      }
      state.spentRewardsPatoshiOnly = !!parsed.spentRewardsPatoshiOnly;
      if (!["mempool", "highlight"].includes(state.blockClickAction)) state.blockClickAction = "mempool";
      state.patoshiIncludeBlocks = sanitizePatternBlocksText(state.patoshiIncludeBlocks);
      state.patoshiExcludeBlocks = sanitizePatternBlocksText(state.patoshiExcludeBlocks);
      syncPatternBlockSets();
      state.showPatoshiLine = state.showPatoshiLine !== false;
      if (typeof parsed.updatedKpiTimeZone === "string" && parsed.updatedKpiTimeZone.trim()) {
        updatedKpiTimeZone = parsed.updatedKpiTimeZone.trim();
      }
      return true;
    } catch (_) {}
    return false;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function fmtInt(value) {
    return Math.round(value).toLocaleString("en-US");
  }

  function getMaxDatasetExtraNonce() {
    if (Number.isFinite(maxDatasetExtraNonce)) return maxDatasetExtraNonce;
    if (!rows.length) return Infinity;
    maxDatasetExtraNonce = Math.max(1, Math.ceil(rows.reduce((max, row) => {
      const value = Number(row.extranonce);
      return Number.isFinite(value) ? Math.max(max, value) : max;
    }, 1)));
    return maxDatasetExtraNonce;
  }

  function normalizeYMaxCustom(value) {
    const maxExtraNonce = getMaxDatasetExtraNonce();
    const parsed = Number(String(value ?? "").replace(/,/g, ""));
    const normalized = !Number.isFinite(parsed) || parsed <= 0 ? 2650 : Math.max(1, Math.round(parsed));
    return Number.isFinite(maxExtraNonce) ? Math.min(normalized, maxExtraNonce) : normalized;
  }

  function normalizeHashrateWindowDays(value) {
    const parsed = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
    return Number.isFinite(parsed) && parsed > 0 ? Math.max(0.1, Math.round(parsed * 10) / 10) : 30;
  }

  function formatYMaxInput(value) {
    return fmtInt(normalizeYMaxCustom(value));
  }

  function fmtDifficulty(value) {
    return Number(value).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function fmtAdjustment(value) {
    if (!Number.isFinite(value)) return "0.00%";
    const sign = value > 0 ? "+" : value < 0 ? "-" : "";
    return `${sign}${Math.abs(value).toFixed(2)}%`;
  }

  function fmtDateTime(ms, withTime = true) {
    const date = new Date(ms);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    if (!withTime) return `${y}-${m}-${d}`;
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const mm = String(date.getUTCMinutes()).padStart(2, "0");
    return `${y}-${m}-${d} ${hh}:${mm} UTC`;
  }

  function fmtTimeUtc(ms) {
    const date = new Date(ms);
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const mm = String(date.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm} UTC`;
  }

  function getSpentRewardRows() {
    const spendHeight = (row, fallback) => Number.isFinite(row.spendingHeight) ? row.spendingHeight : fallback;
    return rows
      .filter((row) => row.isSpent && Number.isFinite(row.height) && row.height < 100000)
      .filter((row) => !state.spentRewardsPatoshiOnly || isPatoshiRow(row))
      .sort((a, b) => {
        switch (state.spentRewardsSort) {
          case "earliest_spent":
            return spendHeight(a, Infinity) - spendHeight(b, Infinity) || a.height - b.height;
          case "latest_height":
            return b.height - a.height || spendHeight(b, -Infinity) - spendHeight(a, -Infinity);
          case "earliest_height":
            return a.height - b.height || spendHeight(a, Infinity) - spendHeight(b, Infinity);
          case "latest_spent":
          default:
            return spendHeight(b, -Infinity) - spendHeight(a, -Infinity) || b.height - a.height;
        }
      });
  }

  function getSpentRewardDate(row) {
    if (Number.isFinite(row.spendingTimestamp)) return fmtDateTime(row.spendingTimestamp * 1000);
    if (row.spendingDatetime) {
      const ms = Date.parse(row.spendingDatetime);
      if (Number.isFinite(ms)) return fmtDateTime(ms);
    }
    const spendRow = rowsByHeight.get(row.spendingHeight);
    if (spendRow) return fmtDateTime(spendRow.ms);
    return "Spend time unavailable";
  }

  function getHighlightedSpentRow() {
    return Number.isFinite(highlightedSpentBlockHeight) ? rowsByHeight.get(highlightedSpentBlockHeight) : null;
  }

  function formatBlockSearchHeight(value) {
    const clean = String(value || "").replace(/[^\d]/g, "");
    if (!clean) return "";
    return Math.min(Number(clean), 99999).toLocaleString("en-US");
  }

  function syncBlockSearchClearButton() {
    const hasValue = !!String(els.blockSearchInput?.value || "").trim();
    els.blockSearchPill?.classList.toggle("has-value", hasValue);
    if (els.blockSearchClear) els.blockSearchClear.hidden = !hasValue;
  }

  function clearHighlightedSpentReward() {
    if (!Number.isFinite(highlightedSpentBlockHeight)) return;
    highlightedSpentBlockHeight = null;
    highlightedSpentBlockSource = null;
    highlightedSpentBlockCentered = false;
    if (els.blockSearchInput) els.blockSearchInput.value = "";
    syncBlockSearchClearButton();
    if (spentRewardsPanelOpen) syncSpentRewardsActiveItem();
    saveState();
    render();
  }

  function clearPanelHighlightIfHiddenFromSpentRewards() {
    if (highlightedSpentBlockSource !== "panel" || !Number.isFinite(highlightedSpentBlockHeight)) return;
    if (spentRewardsPanelOpen && getSpentRewardRows().some((row) => row.height === highlightedSpentBlockHeight)) return;
    clearHighlightedSpentReward();
  }

  function setHighlightedBlock(row, options = {}) {
    if (!row || !Number.isFinite(row.height)) return;
    const { source = "panel", updateInput = true, center = true } = options;
    highlightedSpentBlockHeight = row.height;
    highlightedSpentBlockSource = source;
    highlightedSpentBlockCentered = !!center;
    if (updateInput && els.blockSearchInput) els.blockSearchInput.value = formatBlockSearchHeight(row.height);
    syncBlockSearchClearButton();
    if (spentRewardsPanelOpen) syncSpentRewardsActiveItem();
    if (!center || !centerChartOnRow(row)) {
      saveState();
      render();
    }
  }

  function centerChartOnRow(row) {
    if (!row) return false;
    const windowMs = getWindowMs();
    const centeredRange = getRangeCenteredOnRow(row, windowMs);
    if (!centeredRange) return false;
    setLastAdjustedHandle("range");
    setRange(centeredRange.startMs, centeredRange.endMs);
    return true;
  }

  function getRangeCenteredOnRow(row, windowMs) {
    if (!row || !Number.isFinite(row.ms)) return null;
    const timelineMin = getTimelineMinMs(windowMs);
    const minStart = Math.min(timelineMin, row.ms - windowMs);
    const maxStart = Math.max(minStart, maxMs - windowMs);
    const safeStart = clamp(row.ms - windowMs / 2, minStart, maxStart);
    return { startMs: safeStart, endMs: safeStart + windowMs };
  }

  function renderSpentRewardsPanel() {
    const previousScrollTop = els.spentRewardsList ? els.spentRewardsList.scrollTop : 0;
    document.body?.classList.toggle("patoshi-side-panel-open", spentRewardsPanelOpen);
    if (els.spentRewardsPanel) {
      els.spentRewardsPanel.classList.toggle("open", spentRewardsPanelOpen);
    }
    if (els.spentRewardsPanelBtn) {
      els.spentRewardsPanelBtn.classList.toggle("is-open", spentRewardsPanelOpen);
      els.spentRewardsPanelBtn.setAttribute("aria-expanded", String(spentRewardsPanelOpen));
      els.spentRewardsPanelBtn.setAttribute("aria-label", spentRewardsPanelOpen ? "Hide spent rewards" : "Show spent pre-100,000 coinbase rewards");
    }
    if (!els.spentRewardsList || !spentRewardsPanelOpen) return;
    const rewards = getSpentRewardRows();
    const highlightedIndex = Number.isFinite(highlightedSpentBlockHeight)
      ? rewards.findIndex((row) => row.height === highlightedSpentBlockHeight)
      : -1;
    if (highlightedIndex >= spentRewardsVisibleCount) {
      spentRewardsVisibleCount = Math.ceil((highlightedIndex + 1) / SPENT_REWARDS_PAGE_SIZE) * SPENT_REWARDS_PAGE_SIZE;
    }
    if (!rewards.length) {
      els.spentRewardsList.innerHTML = `<div class="spent-reward-date">No spent pre-height-100,000 rewards found.</div>`;
      spentRewardsLoading = false;
      return;
    }
    const visibleCount = Math.min(spentRewardsVisibleCount, rewards.length);
    const visibleRewards = rewards.slice(0, visibleCount);
    const footerHtml = visibleCount < rewards.length
      ? `<div id="spentRewardsFooter" class="spent-rewards-footer is-hidden">${
          spentRewardsLoading
            ? '<span class="spent-rewards-loading" aria-label="Loading more spent rewards" role="status"></span>'
            : '<span class="spent-rewards-pull" aria-hidden="true"></span>'
        }</div>`
      : "";
    els.spentRewardsList.innerHTML = visibleRewards.map((row) => {
      const isActive = row.height === highlightedSpentBlockHeight;
      const titleClass = isPatoshiRow(row) ? "is-patoshi" : "is-other";
      const spendHeight = Number.isFinite(row.spendingHeight) ? `Spent ${fmtInt(row.spendingHeight)}` : "Spend height unavailable";
      return `
        <button type="button" class="spent-reward-item${isActive ? " is-active" : ""}" data-height="${row.height}">
          <span class="spent-reward-title ${titleClass}">Block ${fmtInt(row.height)}</span>
          <span class="spent-reward-meta">${spendHeight}</span>
          <span class="spent-reward-date">${getSpentRewardDate(row)}</span>
        </button>`;
    }).join("") + footerHtml;
    els.spentRewardsList.scrollTop = previousScrollTop;
    syncSpentRewardsLoadMoreVisibility();
  }

  function syncSpentRewardsActiveItem() {
    if (!els.spentRewardsList) return;
    els.spentRewardsList.querySelectorAll(".spent-reward-item.is-active").forEach((item) => {
      item.classList.remove("is-active");
    });
    if (!Number.isFinite(highlightedSpentBlockHeight)) return;
    const activeItem = els.spentRewardsList.querySelector(`.spent-reward-item[data-height="${highlightedSpentBlockHeight}"]`);
    activeItem?.classList.add("is-active");
  }

  function syncSpentRewardsLoadMoreVisibility() {
    const container = els.spentRewardsList;
    const footer = $("spentRewardsFooter");
    if (!container || !footer) return;
    const remainingScroll = container.scrollHeight - container.scrollTop - container.clientHeight;
    const atBottom = remainingScroll <= SPENT_REWARDS_BOTTOM_THRESHOLD_PX;
    footer.classList.toggle("is-hidden", !atBottom && !spentRewardsLoading);
  }

  function tryLoadMoreSpentRewards() {
    if (spentRewardsLoading) return;
    const container = els.spentRewardsList;
    if (!container) return;
    const rewards = getSpentRewardRows();
    if (spentRewardsVisibleCount >= rewards.length) return;
    const remainingScroll = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (remainingScroll > SPENT_REWARDS_BOTTOM_THRESHOLD_PX) return;
    spentRewardsLoading = true;
    const loadGeneration = ++spentRewardsLoadGeneration;
    renderSpentRewardsPanel();
    window.setTimeout(() => {
      if (loadGeneration !== spentRewardsLoadGeneration) return;
      spentRewardsVisibleCount = Math.min(rewards.length, spentRewardsVisibleCount + SPENT_REWARDS_PAGE_SIZE);
      spentRewardsLoading = false;
      renderSpentRewardsPanel();
    }, SPENT_REWARDS_LOAD_DELAY_MS);
  }

  function toInputValue(ms) {
    const date = new Date(ms);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}T${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  }

  function toShortDateTime(ms) {
    const date = new Date(ms);
    return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCFullYear()).slice(-2)} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  }

  function fromInputValue(value) {
    const ms = Date.parse(`${value}:00Z`);
    return Number.isFinite(ms) ? ms : null;
  }

  function isTextEntry(element) {
    if (!element) return false;
    const tagName = element.tagName;
    return element.isContentEditable
      || tagName === "INPUT"
      || tagName === "TEXTAREA"
      || tagName === "SELECT";
  }

  function blurControlIfFocused() {
    const active = document.activeElement;
    if (active && active !== document.body && typeof active.blur === "function") active.blur();
  }

  function setLastAdjustedHandle(handle) {
    if (handle === "start" || handle === "end") {
      selectedHandle = handle;
      lastAdjustedHandle = handle;
    }
  }

  function syncControls() {
    const timelineMin = getTimelineMinMs();
    const animationMin = getAnimationStartMinMs();
    els.startInput.value = toInputValue(state.animationStartMs);
    els.endInput.value = toInputValue(state.animationEndMs);
    els.startBtnLabel.textContent = toShortDateTime(state.animationStartMs);
    els.endBtnLabel.textContent = toShortDateTime(state.animationEndMs);
    els.startRange.min = String(animationMin);
    els.startRange.max = String(maxMs);
    els.endRange.min = String(animationMin);
    els.endRange.max = String(maxMs);
    els.startRange.value = String(state.animationStartMs);
    els.endRange.value = String(state.animationEndMs);
    els.yMode.value = state.yMode;
    if (els.yMaxInput) {
      const maxExtraNonce = getMaxDatasetExtraNonce();
      if (Number.isFinite(maxExtraNonce)) els.yMaxInput.max = String(maxExtraNonce);
      els.yMaxInput.value = formatYMaxInput(state.yMaxCustom);
    }
    els.countMetric.value = state.countMetric;
    syncHashrateWindowControls();
    syncPatternBlockSets();
    els.patoshiPatternButtons.forEach((button) => {
      const active = button.dataset.patoshiPattern === state.patoshiPattern;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    els.blockClickButtons.forEach((button) => {
      const active = button.dataset.blockClickAction === state.blockClickAction;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    if (els.patoshiIncludeInput && document.activeElement !== els.patoshiIncludeInput) {
      els.patoshiIncludeInput.value = state.patoshiIncludeBlocks || "";
    }
    if (els.patoshiExcludeInput && document.activeElement !== els.patoshiExcludeInput) {
      els.patoshiExcludeInput.value = state.patoshiExcludeBlocks || "";
    }
    if (els.spentRewardsSort) els.spentRewardsSort.value = state.spentRewardsSort;
    if (els.spentRewardsPatoshiOnly) els.spentRewardsPatoshiOnly.checked = !!state.spentRewardsPatoshiOnly;
    if (els.blockSearchInput && document.activeElement !== els.blockSearchInput) {
      els.blockSearchInput.value = Number.isFinite(highlightedSpentBlockHeight) ? formatBlockSearchHeight(highlightedSpentBlockHeight) : "";
    }
    syncBlockSearchClearButton();
    updateMarkerScaleControls();
    syncDropdownLabels();
    els.showSpent.checked = state.showSpent;
    els.markSpent.checked = state.markSpent;
    els.showPatoshiLine.checked = state.showPatoshiLine;
    els.showOrder.checked = state.showOrder;
    els.speedBtn.textContent = speeds[state.speedIndex]?.label || "1x";
    updateSettingsOptions();
    updateRangeFill();
    updateActiveButtons();
    updateResetButtonUi();
  }

  function getMinWindowMs() {
    return Math.min(DAY, Math.max(HOUR, maxMs - minMs));
  }

  function normalizeMarkerScale(value) {
    const parsed = Number(value);
    const normalized = Number.isFinite(parsed) ? parsed : 1;
    return Math.round(clamp(normalized, 0.1, 2) * 10) / 10;
  }

  function formatMarkerScale(value) {
    return normalizeMarkerScale(value).toFixed(1).replace(/\.0$/, "");
  }

  function updateMarkerScaleControls(syncValue = true) {
    if (!els.markerScaleInput) return;
    state.markerScale = normalizeMarkerScale(state.markerScale);
    if (syncValue) els.markerScaleInput.value = formatMarkerScale(state.markerScale);
    els.markerScaleMinus.disabled = state.markerScale <= 0.1;
    els.markerScalePlus.disabled = state.markerScale >= 2;
  }

  function getMarkerScale() {
    return normalizeMarkerScale(state.markerScale);
  }

  function getPatoshiLineScale() {
    return Math.min(1, getMarkerScale());
  }

  function getDiffMarkerScale() {
    return clamp(getMarkerScale(), 0.5, 1);
  }

  function sanitizePatternBlocksText(value) {
    return String(value ?? "")
      .replace(/[^\d,\s]/g, "")
      .replace(/[,\s]+/g, ",")
      .replace(/\d+/g, (match) => {
        const parsed = Number(match);
        if (!Number.isFinite(parsed)) return "";
        return String(Math.min(99999, Math.max(0, Math.trunc(parsed))));
      });
  }

  function parsePatternBlockSet(value) {
    const set = new Set();
    String(value ?? "").split(/[,\s]+/).forEach((token) => {
      if (!token) return;
      const parsed = Number(token);
      if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 99999) set.add(parsed);
    });
    return set;
  }

  function syncPatternBlockSets() {
    state.patoshiIncludeBlocks = sanitizePatternBlocksText(state.patoshiIncludeBlocks);
    state.patoshiExcludeBlocks = sanitizePatternBlocksText(state.patoshiExcludeBlocks);
    patoshiIncludeSet = parsePatternBlockSet(state.patoshiIncludeBlocks);
    patoshiExcludeSet = parsePatternBlockSet(state.patoshiExcludeBlocks);
  }

  function syncPatternBlockPickButtons() {
    const includeActive = patternBlockPickMode === "include";
    const excludeActive = patternBlockPickMode === "exclude";
    els.patoshiIncludePickBtn?.classList.toggle("is-active", includeActive);
    els.patoshiExcludePickBtn?.classList.toggle("is-active", excludeActive);
    els.patoshiIncludePickBtn?.setAttribute("aria-pressed", String(includeActive));
    els.patoshiExcludePickBtn?.setAttribute("aria-pressed", String(excludeActive));
    canvas.classList.toggle("target-pick-include", includeActive);
    canvas.classList.toggle("target-pick-exclude", excludeActive);
    if (!includeActive && !excludeActive) {
      canvas.classList.remove("target-pick-hover", "target-pick-include", "target-pick-exclude");
    }
  }

  function clearPatternBlockPickMode() {
    patternBlockPickMode = null;
    hideChartTooltip();
    syncPatternBlockPickButtons();
  }

  function setPatternBlockPickMode(mode) {
    patternBlockPickMode = patternBlockPickMode === mode ? null : mode;
    hideChartTooltip();
    syncPatternBlockPickButtons();
  }

  function addPatternBlockFromMarker(mode, height) {
    const key = mode === "include" ? "patoshiIncludeBlocks" : "patoshiExcludeBlocks";
    const otherKey = mode === "include" ? "patoshiExcludeBlocks" : "patoshiIncludeBlocks";
    const input = mode === "include" ? els.patoshiIncludeInput : els.patoshiExcludeInput;
    const otherInput = mode === "include" ? els.patoshiExcludeInput : els.patoshiIncludeInput;
    const block = Math.min(99999, Math.max(0, Math.trunc(Number(height))));
    if (!Number.isFinite(block)) return;
    const next = String(block);
    const uniqueValues = (value) => {
      const seen = new Set();
      return sanitizePatternBlocksText(value)
        .split(",")
        .filter(Boolean)
        .filter((item) => {
          if (seen.has(item)) return false;
          seen.add(item);
          return true;
        });
    };
    let values = uniqueValues(state[key]);
    let otherValues = uniqueValues(state[otherKey]);
    if (values.includes(next)) {
      values = values.filter((item) => item !== next);
    } else {
      otherValues = otherValues.filter((item) => item !== next);
      values.push(next);
    }
    state[key] = values.join(",");
    state[otherKey] = otherValues.join(",");
    if (input) input.value = state[key];
    if (otherInput) otherInput.value = state[otherKey];
    syncPatternBlockSets();
    render();
    saveState();
  }

  function isPatoshiRow(row) {
    if (!row) return false;
    const height = Number(row.height);
    if (Number.isFinite(height)) {
      if (patoshiExcludeSet.has(height)) return false;
      if (patoshiIncludeSet.has(height)) return true;
    }
    if (state.patoshiPattern === "none") return false;
    if (state.patoshiPattern === "original") return !!row.patoshiOriginal;
    return !!row.patoshiUpdated;
  }

  function getTimelineMinMs(windowMs = getWindowMs()) {
    return minMs - Math.max(getMinWindowMs(), windowMs);
  }

  function getDefaultAnimationEndMs() {
    return Number.isFinite(maxMs) && maxMs > getAnimationStartMinMs()
      ? maxMs
      : DEFAULT_ANIMATION_END_MS;
  }

  function getDefaultWindowMs() {
    return Math.max(getMinWindowMs(), getDefaultAnimationEndMs() - getAnimationStartMinMs());
  }

  function getAnimationStartMinMs() {
    return Math.max(minMs, DEFAULT_ANIMATION_START_MS);
  }

  function moveWindowToAnimationStart() {
    const windowMs = getWindowMs();
    const timelineMin = getTimelineMinMs(windowMs);
    const windowEnd = clamp(state.animationStartMs, timelineMin, maxMs);
    state.endMs = windowEnd;
    state.startMs = Math.max(timelineMin, windowEnd - windowMs);
  }

  function applyDefaultState() {
    const animationStartMs = getAnimationStartMinMs();
    const animationEndMs = getDefaultAnimationEndMs();
    highlightedSpentBlockHeight = null;
    highlightedSpentBlockSource = null;
    Object.assign(state, {
      startMs: animationStartMs,
      endMs: animationEndMs,
      animationStartMs,
      animationEndMs,
      finalEndMs: animationEndMs,
      yMode: "rolling_patoshi",
      yMaxCustom: 2650,
      countMetric: "spent",
      hashrateWindowMatch: true,
      hashrateWindowDays: 30,
      patoshiPattern: "updated",
      patoshiIncludeBlocks: "",
      patoshiExcludeBlocks: "",
      spentRewardsSort: "latest_spent",
      spentRewardsPatoshiOnly: false,
      blockClickAction: "mempool",
      markerScale: getDefaultMarkerScale(),
      showSpent: true,
      markSpent: false,
      showPatoshiLine: true,
      showOrder: false,
      speedIndex: 1,
      playing: false,
      paused: false,
      isExporting: false,
      exportCancelRequested: false,
      exportSettings: { ...DEFAULT_EXPORT_SETTINGS },
    });
  }

  function normalizeExportSettings() {
    state.exportSettings = {
      ...DEFAULT_EXPORT_SETTINGS,
      ...(state.exportSettings || {}),
    };
    state.exportSettings.orientation = ["landscape", "portrait", "square"].includes(state.exportSettings.orientation)
      ? state.exportSettings.orientation
      : DEFAULT_EXPORT_SETTINGS.orientation;
    state.exportSettings.quality = [720, 1080, 1440, 2160].includes(Number(state.exportSettings.quality))
      ? Number(state.exportSettings.quality)
      : DEFAULT_EXPORT_SETTINGS.quality;
    state.exportSettings.speed = EXPORT_SPEEDS.includes(Number(state.exportSettings.speed))
      ? Number(state.exportSettings.speed)
      : DEFAULT_EXPORT_SETTINGS.speed;
    if (state.exportSettings.theme !== "light" && state.exportSettings.theme !== "dark") {
      state.exportSettings.theme = theme;
    }
    state.exportSettings.endFrameHold = state.exportSettings.endFrameHold !== false;
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(seconds || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours) return `${hours}h ${minutes}m ${secs}s`;
    return minutes ? `${minutes}m ${secs}s` : `${secs}s`;
  }

  function captureDashboardState() {
    normalizeExportSettings();
    return {
      startMs: Math.round(Number(state.startMs) || 0),
      endMs: Math.round(Number(state.endMs) || 0),
      animationStartMs: Math.round(Number(state.animationStartMs) || 0),
      animationEndMs: Math.round(Number(state.animationEndMs) || 0),
      finalEndMs: Math.round(Number(state.finalEndMs) || 0),
      yMode: state.yMode,
      yMaxCustom: normalizeYMaxCustom(state.yMaxCustom),
      countMetric: state.countMetric,
      hashrateWindowMatch: !!state.hashrateWindowMatch,
      hashrateWindowDays: normalizeHashrateWindowDays(state.hashrateWindowDays),
      patoshiPattern: state.patoshiPattern,
      patoshiIncludeBlocks: sanitizePatternBlocksText(state.patoshiIncludeBlocks),
      patoshiExcludeBlocks: sanitizePatternBlocksText(state.patoshiExcludeBlocks),
      spentRewardsSort: state.spentRewardsSort,
      spentRewardsPatoshiOnly: !!state.spentRewardsPatoshiOnly,
      blockClickAction: state.blockClickAction,
      markerScale: normalizeMarkerScale(state.markerScale),
      showSpent: !!state.showSpent,
      markSpent: !!state.markSpent,
      showPatoshiLine: !!state.showPatoshiLine,
      showOrder: !!state.showOrder,
      speedIndex: clamp(Math.round(Number(state.speedIndex) || 1), 0, speeds.length - 1),
      exportSettings: { ...DEFAULT_EXPORT_SETTINGS, ...(state.exportSettings || {}) },
      updatedKpiTimeZone: updatedKpiTimeZone || getPreferredDashboardTimeZone(),
      sidePanelOpen: !!spentRewardsPanelOpen,
      highlightedSpentBlockHeight: Number.isFinite(highlightedSpentBlockHeight) ? highlightedSpentBlockHeight : null,
      highlightedSpentBlockSource,
      highlightedSpentBlockCentered,
    };
  }

  function getDefaultDashboardState() {
    const animationStartMs = getAnimationStartMinMs();
    const animationEndMs = getDefaultAnimationEndMs();
    return {
      startMs: animationStartMs,
      endMs: animationEndMs,
      animationStartMs,
      animationEndMs,
      finalEndMs: animationEndMs,
      yMode: "rolling_patoshi",
      yMaxCustom: normalizeYMaxCustom(2650),
      countMetric: "spent",
      hashrateWindowMatch: true,
      hashrateWindowDays: 30,
      patoshiPattern: "updated",
      patoshiIncludeBlocks: "",
      patoshiExcludeBlocks: "",
      spentRewardsSort: "latest_spent",
      spentRewardsPatoshiOnly: false,
      blockClickAction: "mempool",
      markerScale: getDefaultMarkerScale(),
      showSpent: true,
      markSpent: false,
      showPatoshiLine: true,
      showOrder: false,
      speedIndex: 1,
      exportSettings: { ...DEFAULT_EXPORT_SETTINGS },
      updatedKpiTimeZone: getPreferredDashboardTimeZone(),
      sidePanelOpen: false,
      highlightedSpentBlockHeight: null,
      highlightedSpentBlockCentered: false,
    };
  }

  function valuesMatch(current, defaults) {
    const normalize = (value) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.keys(value).sort().reduce((out, key) => {
          out[key] = normalize(value[key]);
          return out;
        }, {});
      }
      if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
      return value;
    };
    return JSON.stringify(normalize(current)) === JSON.stringify(normalize(defaults));
  }

  function isDefaultState() {
    if (!rows.length) return false;
    return valuesMatch(captureDashboardState(), getDefaultDashboardState());
  }

  function setButtonIcon(button, svgMarkup) {
    const iconEl = button?.querySelector(".btn-icon");
    if (iconEl && svgMarkup) iconEl.innerHTML = svgMarkup;
  }

  function updateResetButtonUi() {
    const btn = els.restoreBtn;
    if (!btn) return;
    const labelEl = btn.querySelector(".btn-label");
    if (preResetStateSnapshot) {
      if (labelEl) labelEl.textContent = "Undo Restore";
      setButtonIcon(btn, ICONS.resetUndo);
      btn.classList.add("reset-dashboard-btn--undo");
      btn.setAttribute("aria-label", "Undo the last restore defaults action");
      btn.dataset.tooltip = "Undo the last restore defaults action";
      btn.title = "Undo the last restore defaults action";
      btn.disabled = false;
      return;
    }
    if (labelEl) labelEl.textContent = "Restore Defaults";
    setButtonIcon(btn, ICONS.resetDefaults);
    btn.classList.remove("reset-dashboard-btn--undo");
    btn.setAttribute("aria-label", "Restore dashboard defaults");
    btn.dataset.tooltip = "Reset dashboard to defaults";
    btn.title = "Reset dashboard to defaults";
    btn.disabled = isDefaultState();
  }

  function restoreDashboardSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    Object.assign(state, {
      startMs: Number(snapshot.startMs),
      endMs: Number(snapshot.endMs),
      animationStartMs: Number(snapshot.animationStartMs),
      animationEndMs: Number(snapshot.animationEndMs),
      finalEndMs: Number(snapshot.finalEndMs),
      yMode: snapshot.yMode,
      yMaxCustom: snapshot.yMaxCustom,
      countMetric: snapshot.countMetric,
      hashrateWindowMatch: snapshot.hashrateWindowMatch !== false,
      hashrateWindowDays: snapshot.hashrateWindowDays,
      patoshiPattern: snapshot.patoshiPattern,
      patoshiIncludeBlocks: snapshot.patoshiIncludeBlocks,
      patoshiExcludeBlocks: snapshot.patoshiExcludeBlocks,
      spentRewardsSort: snapshot.spentRewardsSort,
      spentRewardsPatoshiOnly: !!snapshot.spentRewardsPatoshiOnly,
      blockClickAction: snapshot.blockClickAction,
      markerScale: snapshot.markerScale,
      showSpent: !!snapshot.showSpent,
      markSpent: !!snapshot.markSpent,
      showPatoshiLine: snapshot.showPatoshiLine !== false,
      showOrder: !!snapshot.showOrder,
      speedIndex: snapshot.speedIndex,
      playing: false,
      paused: false,
      isExporting: false,
      exportCancelRequested: false,
      exportSettings: { ...DEFAULT_EXPORT_SETTINGS, ...(snapshot.exportSettings || {}) },
    });
    if (typeof snapshot.updatedKpiTimeZone === "string" && snapshot.updatedKpiTimeZone.trim()) {
      setPreferredDashboardTimeZone(snapshot.updatedKpiTimeZone);
      syncUpdatedTimeZoneSelect(snapshot.updatedKpiTimeZone);
    }
    spentRewardsPanelOpen = !!snapshot.sidePanelOpen;
    const snapshotHighlightedHeight = Number(snapshot.highlightedSpentBlockHeight);
    highlightedSpentBlockHeight = Number.isFinite(snapshotHighlightedHeight) ? snapshotHighlightedHeight : null;
    highlightedSpentBlockSource = Number.isFinite(highlightedSpentBlockHeight)
      ? (snapshot.highlightedSpentBlockSource === "search" ? "search" : "panel")
      : null;
    highlightedSpentBlockCentered = Number.isFinite(highlightedSpentBlockHeight) && snapshot.highlightedSpentBlockCentered !== false;
    syncPatternBlockSets();
    normalizeExportSettings();
    state.yMaxCustom = normalizeYMaxCustom(state.yMaxCustom);
    state.hashrateWindowDays = normalizeHashrateWindowDays(state.hashrateWindowDays);
    state.markerScale = normalizeMarkerScale(state.markerScale);
    state.speedIndex = clamp(Math.round(Number(state.speedIndex) || 1), 0, speeds.length - 1);
    if (!["rolling_patoshi", "window_patoshi", "window_all", "custom"].includes(state.yMode)) state.yMode = "rolling_patoshi";
    if (!["spent", "time"].includes(state.countMetric)) state.countMetric = "spent";
    if (!["updated", "original", "none"].includes(state.patoshiPattern)) state.patoshiPattern = "updated";
    if (!["mempool", "highlight"].includes(state.blockClickAction)) state.blockClickAction = "mempool";
    syncControls();
    renderSpentRewardsPanel();
    render();
  }

  function restoreDashboardDefaults() {
    if (isDefaultState()) return;
    preResetStateSnapshot = captureDashboardState();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
    restoreDashboardSnapshot(getDefaultDashboardState());
    saveState({ preserveResetUndo: true });
    updateResetButtonUi();
  }

  function restorePreviousDashboardState() {
    if (!preResetStateSnapshot) return;
    const snapshot = preResetStateSnapshot;
    preResetStateSnapshot = null;
    restoreDashboardSnapshot(snapshot);
    saveState();
    updateResetButtonUi();
  }

  function getShareRouteBaseUrl() {
    const path = String(window.location.pathname || "");
    const dashboardMatch = path.match(/^(.*)\/webapps\/patoshi_pattern\/dashboard\.html$/i);
    const basePath = dashboardMatch ? (dashboardMatch[1] || "") : path.replace(/\/[^/]*$/, "");
    if (IS_LOCAL_RUNTIME) return `${window.location.origin}${basePath}/patoshi_pattern.html`;
    return `${window.location.origin}${basePath}/patoshi_pattern`;
  }

  function buildShareableDashboardUrl() {
    const defaults = getDefaultDashboardState();
    const payload = captureDashboardState();
    const compactPayload = {};
    Object.entries(payload).forEach(([key, value]) => {
      if (valuesMatch({ value }, { value: defaults[key] })) return;
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
    const labelEl = buttonEl?.querySelector(".btn-label");
    const original = labelEl ? labelEl.textContent : "";
    if (buttonEl?.__copyFeedbackTimer) window.clearTimeout(buttonEl.__copyFeedbackTimer);
    setButtonIcon(buttonEl, ICONS.copyCopied);
    if (labelEl) labelEl.textContent = "Copied!";
    buttonEl.__copyFeedbackTimer = window.setTimeout(() => {
      setButtonIcon(buttonEl, ICONS.copyLink);
      if (labelEl) labelEl.textContent = original || "Copy Link";
      buttonEl.__copyFeedbackTimer = null;
    }, 1400);
  }

  function getSelectedDownloadSetting(groupId, fallback) {
    const group = document.getElementById(groupId);
    const selected = group?.querySelector(".download-setting-option.is-selected[data-value]");
    return selected?.dataset.value || fallback;
  }

  function getExportSettingsSnapshot() {
    normalizeExportSettings();
    const settings = { ...state.exportSettings };
    settings.orientation = getSelectedDownloadSetting("downloadOrientationSelect", settings.orientation);
    settings.quality = Number(getSelectedDownloadSetting("downloadQualitySelect", settings.quality)) || settings.quality;
    settings.speed = Number(getSelectedDownloadSetting("downloadSpeedSelect", settings.speed)) || settings.speed;
    settings.theme = getSelectedDownloadSetting("downloadThemeSelect", settings.theme || theme);
    settings.endFrameHold = !!els.downloadEndFrameHoldToggle?.checked;
    settings.orientation = ["landscape", "portrait", "square"].includes(settings.orientation) ? settings.orientation : DEFAULT_EXPORT_SETTINGS.orientation;
    settings.quality = [720, 1080, 1440, 2160].includes(Number(settings.quality)) ? Number(settings.quality) : DEFAULT_EXPORT_SETTINGS.quality;
    settings.speed = EXPORT_SPEEDS.includes(Number(settings.speed)) ? Number(settings.speed) : DEFAULT_EXPORT_SETTINGS.speed;
    settings.theme = ["light", "dark"].includes(settings.theme) ? settings.theme : theme;
    return settings;
  }

  function getExportDimensions(settings = state.exportSettings) {
    const quality = Number(settings.quality) || DEFAULT_EXPORT_SETTINGS.quality;
    if (settings.orientation === "portrait") return { width: quality, height: Math.round(quality * 16 / 9) };
    if (settings.orientation === "square") return { width: quality, height: quality };
    return { width: Math.round(quality * 16 / 9), height: quality };
  }

  function getExportBaseDimensions(settings = state.exportSettings) {
    if (settings.orientation === "portrait") return { width: 720, height: 1280 };
    if (settings.orientation === "square") return { width: 960, height: 960 };
    return { width: 1280, height: 720 };
  }

  function getExportBitrate(settings = state.exportSettings) {
    const { width, height } = getExportDimensions(settings);
    return Math.max(4_000_000, Math.round(width * height * EXPORT_FPS * 0.16));
  }

  function getExportFrameEndTimes(settings = state.exportSettings) {
    const windowMs = Math.max(getMinWindowMs(), getWindowMs());
    const startEndMs = clamp(state.animationStartMs, getAnimationStartMinMs(), maxMs);
    const finalEndMs = Math.max(startEndMs, clamp(state.animationEndMs, getAnimationStartMinMs(), maxMs));
    const speed = Math.max(0.5, Number(settings.speed) || 1);
    const baseHoursPerSecond = Math.max(1 / 60, (windowMs / HOUR) / 15);
    const frameShiftMs = Math.max(1, (baseHoursPerSecond * speed * HOUR) / EXPORT_FPS);
    const frames = [];
    for (let ms = startEndMs; ms < finalEndMs; ms += frameShiftMs) frames.push(ms);
    frames.push(finalEndMs);
    if (settings.endFrameHold) {
      return [
        ...Array(EXPORT_START_HOLD_FRAMES).fill(startEndMs),
        ...frames,
        ...Array(EXPORT_END_HOLD_FRAMES).fill(finalEndMs),
      ];
    }
    return frames;
  }

  function getExportSeconds(settings = state.exportSettings) {
    return getExportFrameEndTimes(settings).length / EXPORT_FPS;
  }

  function hasDeterministicExportSupport() {
    return !!(window.VideoEncoder && window.VideoFrame && typeof VideoEncoder.isConfigSupported === "function");
  }

  function getDownloadEstimateCalibrationKey(settings, frameEnds) {
    const { width, height } = getExportDimensions(settings);
    const windowHours = Math.round(getWindowMs() / HOUR);
    return [
      Math.round(state.animationStartMs),
      Math.round(state.animationEndMs),
      windowHours,
      state.yMode,
      state.countMetric,
      state.hashrateWindowMatch ? "match" : state.hashrateWindowDays,
      state.patoshiPattern,
      state.patoshiIncludeBlocks,
      state.patoshiExcludeBlocks,
      state.markerScale,
      state.blockClickAction,
      state.showSpent ? 1 : 0,
      state.markSpent ? 1 : 0,
      state.showPatoshiLine ? 1 : 0,
      state.showOrder ? 1 : 0,
      settings.orientation,
      settings.quality,
      settings.speed,
      settings.theme,
      settings.endFrameHold ? 1 : 0,
      width,
      height,
      frameEnds.length,
      new Set(frameEnds.map((ms) => Math.round(ms))).size,
    ].join("|");
  }

  function getRepresentativeExportFrameEnds(frameEnds) {
    const uniqueEnds = Array.from(new Set(frameEnds.map((ms) => Math.round(ms))));
    if (uniqueEnds.length <= 3) return uniqueEnds;
    return [
      uniqueEnds[0],
      uniqueEnds[Math.floor((uniqueEnds.length - 1) / 2)],
      uniqueEnds[uniqueEnds.length - 1],
    ];
  }

  async function calibrateDownloadEstimate(settings, frameEnds, key) {
    if (
      state.isExporting
      || state.playing
      || downloadEstimateCalibrationCache.has(key)
      || downloadEstimateCalibrationPending.has(key)
    ) return;
    const representativeEnds = getRepresentativeExportFrameEnds(frameEnds);
    if (!representativeEnds.length) return;
    downloadEstimateCalibrationPending.add(key);
    const requestId = ++downloadEstimateCalibrationRequestId;
    let calibrated = false;
    try {
      await document.fonts?.ready;
      if (requestId !== downloadEstimateCalibrationRequestId || state.playing) return;
      const dimensions = getExportDimensions(settings);
      const canvas = document.createElement("canvas");
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      if (!canvas.getContext("2d")) return;
      const started = performance.now();
      representativeEnds.forEach((endMs) => {
        if (requestId !== downloadEstimateCalibrationRequestId) return;
        drawExportFrame(canvas, endMs, settings, dimensions);
      });
      const msPerFrame = (performance.now() - started) / representativeEnds.length;
      if (Number.isFinite(msPerFrame) && msPerFrame > 0) {
        downloadEstimateCalibrationCache.set(key, { msPerFrame });
        calibrated = true;
      }
    } catch (error) {
      console.warn("Unable to calibrate Patoshi export estimate.", error);
    } finally {
      render();
      downloadEstimateCalibrationPending.delete(key);
      if (calibrated && requestId === downloadEstimateCalibrationRequestId) updateDownloadEstimate();
    }
  }

  function scheduleDownloadEstimateCalibration(settings, frameEnds, key) {
    if (
      !rows.length
      || state.playing
      || downloadEstimateCalibrationCache.has(key)
      || downloadEstimateCalibrationPending.has(key)
    ) return;
    if (downloadEstimateCalibrationTimer) {
      window.clearTimeout(downloadEstimateCalibrationTimer);
      downloadEstimateCalibrationTimer = null;
    }
    downloadEstimateCalibrationTimer = window.setTimeout(() => {
      downloadEstimateCalibrationTimer = null;
      calibrateDownloadEstimate({ ...settings }, [...frameEnds], key);
    }, 180);
  }

  function updateDownloadEstimate() {
    if (!els.downloadEstimateSize || !els.downloadEstimateLength || !els.downloadEstimateTime) return;
    const settings = getExportSettingsSnapshot();
    const { width, height } = getExportDimensions(settings);
    const frameEnds = getExportFrameEndTimes(settings);
    const frameCount = Math.max(1, frameEnds.length);
    const seconds = getExportSeconds(settings);
    const megapixels = Math.max(1, (width * height) / (1280 * 720));
    const calibrationKey = getDownloadEstimateCalibrationKey(settings, frameEnds);
    const calibration = downloadEstimateCalibrationCache.get(calibrationKey);
    const deterministicExport = hasDeterministicExportSupport();
    const estimatedMb = Math.max(1, Math.round((getExportBitrate(settings) * seconds) / 8_000_000));
    const fallbackFrameSeconds = deterministicExport ? 0.006 * Math.sqrt(megapixels) : 0.018 * megapixels;
    const estimatedRenderSeconds = calibration
      ? Math.max(1, (frameCount * calibration.msPerFrame) / 1000)
      : Math.max(1, frameCount * fallbackFrameSeconds);
    const estimatedTotalSeconds = deterministicExport ? estimatedRenderSeconds : seconds + estimatedRenderSeconds;
    els.downloadEstimateSize.textContent = `${estimatedMb.toLocaleString("en-US")} MB`;
    els.downloadEstimateLength.textContent = formatDuration(seconds);
    els.downloadEstimateTime.textContent = `~${formatDuration(estimatedTotalSeconds)}`;
    if (!calibration && frameEnds.length) scheduleDownloadEstimateCalibration(settings, frameEnds, calibrationKey);
  }

  function updateSettingsOptions() {
    normalizeExportSettings();
    document.querySelectorAll("[data-export-setting]").forEach((button) => {
      const key = button.dataset.exportSetting;
      button.classList.toggle("is-selected", String(state.exportSettings[key]) === String(button.dataset.value));
    });
    if (els.downloadEndFrameHoldToggle) {
      els.downloadEndFrameHoldToggle.checked = !!state.exportSettings.endFrameHold;
    }
    if (els.downloadPanelBtn) {
      els.downloadPanelBtn.classList.toggle("is-stop-download", !!state.isExporting);
      els.downloadPanelBtn.textContent = state.isExporting ? "Stop Download" : "Download Animation";
    }
    updateDownloadEstimate();
  }

  function withTemporaryRenderCanvas(targetCanvas, dimensions, fn) {
    const priorCanvas = canvas;
    const priorCtx = ctx;
    const priorRect = exportRenderRect;
    canvas = targetCanvas;
    ctx = targetCanvas.getContext("2d", { alpha: false });
    exportRenderRect = {
      width: dimensions.width,
      height: dimensions.height,
      dpr: dimensions.dpr || 1,
    };
    try {
      return fn();
    } finally {
      canvas = priorCanvas;
      ctx = priorCtx;
      exportRenderRect = priorRect;
    }
  }

  function withExportState(endMs, settings, fn) {
    const priorState = {
      startMs: state.startMs,
      endMs: state.endMs,
      finalEndMs: state.finalEndMs,
      playing: state.playing,
      paused: state.paused,
    };
    const priorTheme = document.documentElement.dataset.theme;
    const windowMs = Math.max(getMinWindowMs(), getWindowMs());
    state.endMs = clamp(endMs, state.animationStartMs, state.animationEndMs);
    state.startMs = Math.max(getTimelineMinMs(windowMs), state.endMs - windowMs);
    state.finalEndMs = state.animationEndMs;
    state.playing = false;
    state.paused = false;
    document.documentElement.dataset.theme = settings.theme || priorTheme || theme;
    try {
      return fn();
    } finally {
      Object.assign(state, priorState);
      document.documentElement.dataset.theme = priorTheme || theme;
    }
  }

  function readKpiExportCards() {
    const hashrateSub = $("kpiHashrateSub");
    const hashrateSubParts = hashrateSub
      ? [
        { text: hashrateSub.querySelector(".hashrate-split-left")?.textContent || "", color: COLORS.patoshi },
        { text: hashrateSub.querySelector(".hashrate-split-divider")?.textContent || "|", color: null },
        { text: hashrateSub.querySelector(".hashrate-split-right")?.textContent || "", color: COLORS.other },
      ].filter((part) => part.text)
      : null;
    const difficultyEl = $("kpiDiffChange");
    const difficultySub = difficultyEl?.textContent || "";
    const difficultyInlineColor = difficultyEl?.style.color || "";
    const difficultySubColor = difficultyInlineColor === COLORS.green || difficultyInlineColor === COLORS.red
      ? difficultyInlineColor
      : null;
    return [
      { label: "Block Height", value: $("kpiHeight")?.textContent || "", sub: "" },
      { label: "Satoshi Total Block Count", value: $("kpiPatoshi")?.textContent || "", sub: $("kpiPatoshiSub")?.textContent || "", valueColor: COLORS.patoshi },
      { label: "Other Total Block Count", value: $("kpiOther")?.textContent || "", sub: $("kpiOtherSub")?.textContent || "", valueColor: COLORS.other },
      { label: $("kpiHashrateLabel")?.textContent || "Hashrate", value: $("kpiHashrate")?.textContent || "", sub: hashrateSub?.textContent || "", subParts: hashrateSubParts },
      { label: "Difficulty", value: $("kpiDifficulty")?.textContent || "", sub: difficultySub, subColor: difficultySubColor },
    ];
  }

  function captureDashboardKpis() {
    return [
      ["kpiHeight", "textContent"],
      ["kpiDifficulty", "textContent"],
      ["kpiDiffChange", "textContent"],
      ["kpiPatoshi", "textContent"],
      ["kpiPatoshiSub", "textContent"],
      ["kpiOther", "textContent"],
      ["kpiOtherSub", "textContent"],
      ["kpiHashrateLabel", "textContent"],
      ["kpiHashrate", "textContent"],
      ["kpiHashrateSub", "innerHTML"],
    ].map(([id, property]) => {
      const el = $(id);
      return { id, property, value: el ? el[property] : "" };
    });
  }

  function restoreDashboardKpis(snapshot) {
    snapshot.forEach(({ id, property, value }) => {
      const el = $(id);
      if (el) el[property] = value;
    });
  }

  function getExportPalette(settings) {
    const isLight = settings.theme === "light";
    return {
      bg: isLight ? "#f4f5f7" : "#000000",
      panel: isLight ? "#ffffff" : "#000000",
      border: isLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.14)",
      text: isLight ? "#1c1b19" : "#f1f5f7",
      muted: isLight ? "#6f685f" : "#95a6ae",
    };
  }

  function drawExportKpis(targetCtx, cards, dimensions, palette) {
    const pad = Math.max(16, Math.round(dimensions.width * 0.018));
    const gap = Math.max(6, Math.round(dimensions.width * 0.007));
    const cardH = Math.max(70, Math.round(dimensions.height * 0.105));
    const cardW = (dimensions.width - pad * 2 - gap * (cards.length - 1)) / cards.length;
    targetCtx.save();
    targetCtx.textAlign = "center";
    targetCtx.textBaseline = "middle";
    cards.forEach((card, index) => {
      const x0 = pad + index * (cardW + gap);
      const y0 = pad;
      targetCtx.fillStyle = palette.panel;
      targetCtx.beginPath();
      targetCtx.roundRect(x0, y0, cardW, cardH, 8);
      targetCtx.fill();
      targetCtx.fillStyle = palette.muted;
      targetCtx.font = `700 ${Math.max(8, Math.round(dimensions.width / 140))}px "IBM Plex Mono"`;
      targetCtx.fillText(card.label.toUpperCase(), x0 + cardW / 2, y0 + cardH * 0.24, cardW - 14);
      targetCtx.fillStyle = card.valueColor || palette.text;
      targetCtx.font = `700 ${Math.max(14, Math.round(dimensions.width / 68))}px "IBM Plex Mono"`;
      targetCtx.fillText(card.value, x0 + cardW / 2, y0 + cardH * 0.53, cardW - 12);
      targetCtx.fillStyle = palette.muted;
      targetCtx.font = `500 ${Math.max(8, Math.round(dimensions.width / 130))}px "IBM Plex Mono"`;
      if (card.subParts?.length) {
        const dividerGap = Math.max(5, Math.round(dimensions.width / 180));
        const partWidths = card.subParts.map((part) => targetCtx.measureText(part.text).width);
        const totalW = partWidths.reduce((sum, width) => sum + width, 0) + dividerGap * Math.max(0, card.subParts.length - 1);
        let partX = x0 + cardW / 2 - totalW / 2;
        card.subParts.forEach((part, partIndex) => {
          targetCtx.fillStyle = part.color || palette.muted;
          targetCtx.textAlign = "left";
          targetCtx.fillText(part.text, partX, y0 + cardH * 0.78);
          partX += partWidths[partIndex] + dividerGap;
        });
        targetCtx.textAlign = "center";
      } else {
        targetCtx.fillStyle = card.subColor || palette.muted;
        targetCtx.fillText(card.sub, x0 + cardW / 2, y0 + cardH * 0.78, cardW - 12);
      }
    });
    targetCtx.restore();
    return { pad, gap, cardH, bottom: pad + cardH };
  }

  function drawExportFrame(targetCanvas, endMs, settings, dimensions = getExportDimensions(settings)) {
    const targetCtx = targetCanvas.getContext("2d", { alpha: false });
    const baseDimensions = getExportBaseDimensions(settings);
    const outputWidth = Math.round(dimensions.width || baseDimensions.width);
    const outputHeight = Math.round(dimensions.height || baseDimensions.height);
    const dpr = Math.max(
      1,
      outputWidth / Math.max(1, baseDimensions.width),
      outputHeight / Math.max(1, baseDimensions.height),
    );
    const layout = baseDimensions;
    const palette = getExportPalette(settings);
    const chartCanvas = document.createElement("canvas");
    const outerPad = Math.max(10, Math.round(layout.width * 0.01));
    const chartTopGap = Math.max(8, Math.round(layout.height * 0.012));
    const footerH = Math.max(34, Math.round(Math.min(layout.width, layout.height) * 0.052));
    const dashboardKpis = captureDashboardKpis();
    let cards = [];

    targetCanvas.width = outputWidth;
    targetCanvas.height = outputHeight;
    targetCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    targetCtx.fillStyle = palette.bg;
    targetCtx.fillRect(0, 0, layout.width, layout.height);

    try {
      withExportState(endMs, settings, () => {
        const kpiProbeHeight = Math.max(70, Math.round(layout.height * 0.105));
        const chartY = outerPad + kpiProbeHeight + chartTopGap;
        const chartDimensions = {
          width: layout.width - outerPad * 2,
          height: Math.max(260, layout.height - chartY - footerH),
        };
        chartCanvas.width = Math.floor(chartDimensions.width * dpr);
        chartCanvas.height = Math.floor(chartDimensions.height * dpr);
        withTemporaryRenderCanvas(chartCanvas, { ...chartDimensions, dpr }, () => render());
        cards = readKpiExportCards();
      });
    } finally {
      restoreDashboardKpis(dashboardKpis);
    }

    const kpiLayout = drawExportKpis(targetCtx, cards, layout, palette);
    const chartY = kpiLayout.bottom + chartTopGap;
    const chartW = layout.width - outerPad * 2;
    const chartH = Math.max(1, layout.height - chartY - footerH);
    targetCtx.save();
    targetCtx.beginPath();
    targetCtx.roundRect(outerPad, chartY, chartW, chartH, 12);
    targetCtx.clip();
    targetCtx.drawImage(chartCanvas, outerPad, chartY, chartW, chartH);
    targetCtx.restore();

    targetCtx.fillStyle = palette.muted;
    targetCtx.textAlign = "center";
    targetCtx.textBaseline = "middle";
    const footerTextSize = Math.max(20, Math.round(footerH * 0.6));
    const footerCenterY = layout.height - footerH * 0.68;
    targetCtx.font = `500 ${footerTextSize}px "IBM Plex Mono"`;
    targetCtx.fillText("https://wickedsmartbitcoin.com/patoshi_pattern", layout.width / 2, footerCenterY);
  }

  function updateRangeFill() {
    const timelineMin = getTimelineMinMs();
    const span = Math.max(1, maxMs - timelineMin);
    const left = ((state.startMs - timelineMin) / span) * 100;
    const right = ((state.endMs - timelineMin) / span) * 100;
    const animationLeft = ((state.animationStartMs - timelineMin) / span) * 100;
    const animationRight = ((state.animationEndMs - timelineMin) / span) * 100;
    if (els.rangeLine) {
      const styles = window.getComputedStyle(els.rangeLine);
      const edgePad = Number.parseFloat(styles.getPropertyValue("--slider-edge-pad")) || 0;
      const trackWidth = Math.max(1, els.rangeLine.clientWidth - edgePad * 2);
      const markerPos = (pct) => `${(edgePad + clamp(pct, 0, 100) / 100 * trackWidth).toFixed(2)}px`;
      const windowLeftPx = edgePad + clamp(left, 0, 100) / 100 * trackWidth;
      const windowRightPx = edgePad + clamp(right, 0, 100) / 100 * trackWidth;
      const windowWidthPx = Math.max(0, windowRightPx - windowLeftPx);
      const windowMinPx = Number.parseFloat(styles.getPropertyValue("--slider-window-min")) || 18;
      const windowHeightPx = Number.parseFloat(styles.getPropertyValue("--slider-window-h")) || 10;
      const displayWidthPx = Math.max(windowMinPx, windowWidthPx);
      const displayHeightPx = windowWidthPx < windowMinPx ? displayWidthPx : windowHeightPx;
      const displayLeftPx = windowWidthPx < windowMinPx
        ? (windowLeftPx + windowRightPx) / 2 - displayWidthPx / 2
        : windowLeftPx;
      els.rangeLine.style.setProperty("--slider-start", `${animationLeft}%`);
      els.rangeLine.style.setProperty("--slider-end", `${animationRight}%`);
      els.rangeLine.style.setProperty("--slider-window-left", `${displayLeftPx.toFixed(2)}px`);
      els.rangeLine.style.setProperty("--slider-window-width", `${displayWidthPx.toFixed(2)}px`);
      els.rangeLine.style.setProperty("--slider-window-height", `${displayHeightPx.toFixed(2)}px`);
      els.rangeLine.style.setProperty("--slider-start-marker", markerPos(animationLeft));
      els.rangeLine.style.setProperty("--slider-end-marker", markerPos(animationRight));
    }
    if (els.windowDaysInput) {
      const windowMs = Math.max(getMinWindowMs(), state.endMs - state.startMs);
      const value = Math.max(1, Math.round((windowMs / DAY) * 10) / 10);
      els.windowDaysInput.dataset.lastValidValue = String(value);
      if (document.activeElement !== els.windowDaysInput) els.windowDaysInput.value = formatWindowDaysValue(value);
    }
    if (els.windowDaysSuffix) {
      const dayCount = Number.parseFloat(els.windowDaysInput?.dataset.lastValidValue || "0");
      els.windowDaysSuffix.textContent = dayCount === 1 ? "Day" : "Days";
    }
    if (state.hashrateWindowMatch) syncHashrateWindowControls();
  }

  function getEffectiveHashrateWindowDays() {
    if (!state.hashrateWindowMatch) return normalizeHashrateWindowDays(state.hashrateWindowDays);
    const windowDays = Math.max(getMinWindowMs(), state.endMs - state.startMs) / DAY;
    return Math.max(0.1, Math.round(Math.min(30, windowDays) * 10) / 10);
  }

  function getEffectiveHashrateWindowMs() {
    return Math.max(HOUR, getEffectiveHashrateWindowDays() * DAY);
  }

  function syncHashrateWindowControls() {
    const input = els.hashrateWindowInput;
    const days = getEffectiveHashrateWindowDays();
    if (input) {
      input.dataset.lastValidValue = String(days);
      if (document.activeElement !== input) input.value = formatWindowDaysValue(days);
    }
    if (els.hashrateWindowSuffix) {
      els.hashrateWindowSuffix.textContent = days === 1 ? "Day" : "Days";
    }
    if (els.hashrateWindowMatch) {
      els.hashrateWindowMatch.checked = !!state.hashrateWindowMatch;
    }
    document.querySelectorAll("[data-hashrate-range]").forEach((button) => {
      const active = Math.abs(days - Number(button.dataset.hashrateRange)) < 0.05;
      button.classList.toggle("active", active);
      button.classList.toggle("is-active", active);
    });
  }

  function scheduleLayoutSync() {
    if (layoutSyncRaf) return;
    layoutSyncRaf = requestAnimationFrame(() => {
      layoutSyncRaf = 0;
      if (els.filtersPanel?.classList.contains("open")) positionFiltersPanel();
      updateRangeFill();
      render();
    });
  }

  function updateActiveButtons() {
    const playable = state.animationEndMs - state.animationStartMs > HOUR / 2;
    const windowMs = state.endMs - state.startMs;
    const allStartMs = getAnimationStartMinMs();
    const allWindowMs = Math.max(getMinWindowMs(), maxMs - allStartMs);
    const allDataWindow = Math.abs(windowMs - allWindowMs) < HOUR
      && Math.abs(state.startMs - allStartMs) < HOUR
      && Math.abs(state.endMs - maxMs) < HOUR
      && Math.abs(state.animationStartMs - allStartMs) < HOUR
      && Math.abs(state.animationEndMs - maxMs) < HOUR;
    els.playBtn.classList.toggle("active", state.playing);
    els.playBtn.classList.toggle("is-playing", state.playing);
    els.playBtn.disabled = !playable;
    els.pauseBtn.classList.toggle("active", state.paused);
    els.pauseBtn.classList.toggle("is-paused", state.paused);
    els.pauseBtn.disabled = !state.playing && !state.paused;
    els.stopBtn.disabled = !state.playing && !state.paused;
    els.settingsBtn.classList.toggle("active", els.settingsPanel.classList.contains("open"));
    els.settingsBtn.classList.toggle("is-open", els.settingsPanel.classList.contains("open"));
    document.querySelectorAll("[data-range]").forEach((button) => {
      const preset = button.dataset.range;
      let active = false;
      if (preset === "all") active = allDataWindow;
      else active = Math.abs(windowMs - Number(preset) * DAY) < HOUR;
      button.classList.toggle("active", active);
      button.classList.toggle("is-active", active);
    });
  }

  function applyWindowPreset(value) {
    if (value === "all") {
      state.animationStartMs = getAnimationStartMinMs();
      state.animationEndMs = maxMs;
      setRange(state.animationStartMs, state.animationEndMs);
      return;
    }
    setWindowByCount(Number(value), { centerHighlighted: true });
  }

  function snapWindowToClosestPreset() {
    const allDays = Math.max(1, (maxMs - getAnimationStartMinMs()) / DAY);
    const currentDays = Math.max(1, getWindowMs() / DAY);
    const presets = [1, 3, 7, 14, 30, 60, 90]
      .map((days) => ({ value: String(days), days }))
      .concat({ value: "all", days: allDays });
    const closest = presets.reduce((best, preset) => (
      Math.abs(preset.days - currentDays) < Math.abs(best.days - currentDays) ? preset : best
    ), presets[0]);
    applyWindowPreset(closest.value);
  }

  function getOptionLabel(selectEl, value) {
    const option = Array.from(selectEl.options).find((item) => item.value === String(value));
    return option ? option.textContent : String(value);
  }

  function syncDropdownLabels() {
    [
      ["countMetric", "countMetricDropdownValue"],
      ["yMode", "yModeDropdownValue"],
      ["spentRewardsSort", "spentRewardsSortDropdownValue"],
    ].forEach(([selectId, valueId]) => {
      const selectEl = $(selectId);
      const valueEl = $(valueId);
      if (selectEl && valueEl) valueEl.textContent = getOptionLabel(selectEl, selectEl.value);
    });
  }

  function syncYMaxInput(value) {
    if (!els.yMaxInput || document.activeElement === els.yMaxInput) return;
    els.yMaxInput.value = formatYMaxInput(value);
  }

  function parseCssPx(value, fallback = 0) {
    const n = Number.parseFloat(String(value || "").trim());
    return Number.isFinite(n) ? n : fallback;
  }

  function sizeUpdatedTimeZoneDropdownMenu(select, dropdown, menu, probeEl) {
    if (!select || !dropdown || !menu || !probeEl) return;
    const style = window.getComputedStyle(probeEl);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;
    context.font = style.font || `${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;

    let maxTextWidth = 0;
    Array.from(select.options).forEach((option) => {
      maxTextWidth = Math.max(maxTextWidth, context.measureText(String(option.textContent || "")).width);
    });

    const menuStyle = window.getComputedStyle(menu);
    const leftPad = parseCssPx(menuStyle.getPropertyValue("--dca-dropdown-content-pad"), 10);
    const rightPad = parseCssPx(menuStyle.getPropertyValue("--dca-dropdown-content-pad"), 10);
    const desired = Math.ceil(maxTextWidth + leftPad + rightPad + 44);
    const pillWidth = Math.ceil(dropdown.getBoundingClientRect().width + 8);
    const minWidth = Math.max(pillWidth, 360);
    const maxWidth = Math.max(minWidth, Math.floor(window.innerWidth - 24));
    const width = Math.max(minWidth, Math.min(desired, maxWidth));

    menu.style.left = "0px";
    menu.style.width = `${width}px`;
    menu.style.minWidth = `${width}px`;
    menu.style.maxWidth = `${width}px`;
  }

  function normalizeTimeZoneText(text) {
    const clean = String(text || "").trim();
    return clean.replace(/\s+([A-Z]{2,5}|GMT[+-]?\d{1,2}|UTC)$/, " ($1)");
  }

  function getDashboardTimeZoneOptions() {
    return DASHBOARD_TIME?.getTimeZoneOptions?.() || [
      { value: "UTC", label: "UTC - Greenwich Mean Time (GMT)" },
    ];
  }

  function getPreferredDashboardTimeZone() {
    return DASHBOARD_TIME?.getPreferredTimeZone?.() || updatedKpiTimeZone || "UTC";
  }

  function setPreferredDashboardTimeZone(value) {
    updatedKpiTimeZone = String(value || "UTC").trim() || "UTC";
    if (DASHBOARD_TIME?.setPreferredTimeZone) {
      updatedKpiTimeZone = DASHBOARD_TIME.setPreferredTimeZone(updatedKpiTimeZone);
    }
    updateUpdatedKpi();
    return updatedKpiTimeZone;
  }

  function formatUpdatedKpiText() {
    const raw = metadata?.generated_at;
    if (!raw) return "-";
    const height = Number(
      metadata?.spending_height_last_queried_height
      ?? metadata?.source_block_height
      ?? metadata?.latest_block_height
      ?? metadata?.block_height
    );
    const heightText = Number.isFinite(height) && height > 0 ? height.toLocaleString("en-US") : "";
    const withHeight = (text) => {
      const normalized = String(text || "").trim();
      return normalized && heightText ? `${normalized} | ${heightText}` : normalized;
    };
    if (DASHBOARD_TIME?.formatUtcTimestamp) {
      const formatted = DASHBOARD_TIME.formatUtcTimestamp(raw, updatedKpiTimeZone);
      return withHeight(normalizeTimeZoneText(formatted.text));
    }
    return withHeight(new Date(raw).toISOString().replace("T", " ").replace(/\.\d+Z$/, " (UTC)"));
  }

  function updateUpdatedKpi() {
    if (els.updatedKpiValue) els.updatedKpiValue.textContent = formatUpdatedKpiText();
  }

  function getDataSignature(meta) {
    if (!meta || typeof meta !== "object") return "";
    return [
      meta.generated_at,
      meta.block_count,
      meta.patoshi_count,
      meta.patoshi_original_count,
      meta.patoshi_updated_count,
      meta.spent_count,
      meta.spending_height_count,
      meta.spending_height_last_queried_height,
      meta.max_extranonce,
    ].map((value) => value ?? "").join("|");
  }

  async function fetchLatestDataSignature() {
    const url = `${META_URL}?refresh=${Date.now()}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to load ${META_URL} (${response.status})`);
    return getDataSignature(await response.json());
  }

  async function refreshIfDataChanged() {
    if (!dataSignature || refreshCheckInFlight) return;
    refreshCheckInFlight = true;
    try {
      const latestSignature = await fetchLatestDataSignature();
      if (!latestSignature || latestSignature === dataSignature) return;
      saveState();
      window.location.reload();
    } catch (error) {
      console.warn("Patoshi auto-refresh check failed:", error);
    } finally {
      refreshCheckInFlight = false;
    }
  }

  function triggerRefreshCheckSoon(delayMs = 150) {
    window.setTimeout(refreshIfDataChanged, delayMs);
  }

  function setupAutoRefreshChecks() {
    if (autoRefreshTimer) window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = window.setInterval(refreshIfDataChanged, AUTO_REFRESH_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") triggerRefreshCheckSoon(0);
    });
    window.addEventListener("focus", () => triggerRefreshCheckSoon(0));
    window.addEventListener("pageshow", () => triggerRefreshCheckSoon(0));
    window.addEventListener("online", () => triggerRefreshCheckSoon(0));
  }

  function syncUpdatedTimeZoneSelect(value = getPreferredDashboardTimeZone()) {
    updatedKpiTimeZone = value || "UTC";
    if (els.updatedTimeZoneSelect) {
      els.updatedTimeZoneSelect.value = updatedKpiTimeZone;
    }
    const trigger = $("updatedTimeZoneDropdownTrigger");
    if (trigger) trigger.textContent = "";
    sizeUpdatedTimeZoneDropdownMenu(els.updatedTimeZoneSelect, $("updatedTimeZoneDropdown"), $("updatedTimeZoneDropdownMenu"), trigger);
    updateUpdatedKpi();
  }

  function installUpdatedTimeZoneDropdown() {
    const selectEl = els.updatedTimeZoneSelect;
    const dropdown = $("updatedTimeZoneDropdown");
    const menu = $("updatedTimeZoneDropdownMenu");
    const chipWrap = $("updatedChipWrap");
    if (!selectEl || !dropdown || !menu) return;
    const options = getDashboardTimeZoneOptions();
    selectEl.innerHTML = "";
    options.forEach((option) => {
      const item = document.createElement("option");
      item.value = option.value;
      item.textContent = option.label;
      selectEl.appendChild(item);
    });
    syncUpdatedTimeZoneSelect();

    const renderMenu = () => {
      menu.innerHTML = "";
      options.forEach((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "dca-option-btn";
        button.textContent = option.label;
        button.classList.toggle("dca-option-btn--selected", option.value === updatedKpiTimeZone);
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          setPreferredDashboardTimeZone(option.value);
          syncUpdatedTimeZoneSelect(option.value);
          saveState();
          closeDropdowns();
        });
        menu.appendChild(button);
      });
    };

    renderMenu();
    (chipWrap || dropdown).addEventListener("click", (event) => {
      if (menu.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      const isOpen = menu.classList.contains("open");
      closeDropdowns(dropdown);
      renderMenu();
      menu.classList.toggle("open", !isOpen);
      dropdown.classList.toggle("is-open", !isOpen);
      chipWrap?.classList.toggle("is-open", !isOpen);
    });
    selectEl.addEventListener("change", () => {
      setPreferredDashboardTimeZone(selectEl.value);
      syncUpdatedTimeZoneSelect(selectEl.value);
      selectEl.blur();
      closeDropdowns();
      saveState();
    });
    if (DASHBOARD_TIME?.CHANGE_EVENT) {
      window.addEventListener(DASHBOARD_TIME.CHANGE_EVENT, (event) => {
        const next = String(event.detail?.timeZone || "").trim() || getPreferredDashboardTimeZone();
        syncUpdatedTimeZoneSelect(next);
      });
    }
    if (DASHBOARD_TIME?.STORAGE_KEY) {
      window.addEventListener("storage", (event) => {
        if (event.key !== DASHBOARD_TIME.STORAGE_KEY) return;
        syncUpdatedTimeZoneSelect(getPreferredDashboardTimeZone());
      });
    }
  }

  function closeDropdowns(except = null) {
    $("updatedChipWrap")?.classList.toggle("is-open", !!except && except.id === "updatedTimeZoneDropdown");
    document.querySelectorAll(".dca-dropdown").forEach((dropdown) => {
      if (dropdown !== except) dropdown.classList.remove("is-open");
    });
    document.querySelectorAll(".dca-dropdown-menu").forEach((menu) => {
      if (!except || !except.contains(menu)) menu.classList.remove("open");
    });
  }

  function eventTargetIsInsideDropdown(target) {
    return !!target?.closest?.(".dca-dropdown, .dca-dropdown-menu, #updatedChipWrap");
  }

  function installDropdown(selectId, dropdownId, valueId, menuId) {
    const selectEl = $(selectId);
    const dropdown = $(dropdownId);
    const valueEl = $(valueId);
    const menu = $(menuId);
    if (!selectEl || !dropdown || !valueEl || !menu) return;
    const renderMenu = () => {
      menu.innerHTML = "";
      const options = Array.from(selectEl.options);
      const longestLabel = options.reduce((longest, option) => Math.max(longest, option.textContent.length), 0);
      menu.style.minWidth = `${Math.max(dropdown.offsetWidth + 8, longestLabel * 8.4 + 34)}px`;
      options.forEach((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "dca-option-btn";
        button.textContent = option.textContent;
        button.dataset.value = option.value;
        button.classList.toggle("is-selected", option.value === selectEl.value);
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          selectEl.value = option.value;
          selectEl.dispatchEvent(new Event("input", { bubbles: true }));
          closeDropdowns();
          syncDropdownLabels();
        });
        menu.appendChild(button);
      });
    };
    renderMenu();
    dropdown.addEventListener("click", (event) => {
      event.stopPropagation();
      const isOpen = menu.classList.contains("open");
      closeDropdowns(dropdown);
      menu.classList.toggle("open", !isOpen);
      dropdown.classList.toggle("is-open", !isOpen);
      renderMenu();
    });
  }

  function setFiltersPanelOpen(open) {
    if (!els.filtersBtn || !els.filtersPanel) return;
    if (open) positionFiltersPanel();
    if (!open) clearPatternBlockPickMode();
    els.filtersPanel.classList.toggle("open", open);
    els.filtersBtn.classList.toggle("is-open", open);
    els.filtersBtn.setAttribute("aria-expanded", String(open));
  }

  function positionFiltersPanel() {
    const topbar = els.filtersBtn?.closest(".topbar");
    if (!topbar || !els.filtersBtn || !els.filtersPanel) return;
    const topbarRect = topbar.getBoundingClientRect();
    const buttonRect = els.filtersBtn.getBoundingClientRect();
    const topbarStyle = window.getComputedStyle(topbar);
    const contentLeft = topbarRect.left + (parseFloat(topbarStyle.paddingLeft) || 0);
    els.filtersPanel.style.setProperty("--filters-panel-left", `${Math.round(contentLeft - buttonRect.left)}px`);
    const panelTop = buttonRect.bottom + 8;
    const playbackPanel = document.querySelector(".date-range-panel");
    const playbackBottom = playbackPanel?.getBoundingClientRect().bottom || (window.innerHeight - 12);
    const viewportBottom = window.innerHeight - 12;
    const availableHeight = Math.min(playbackBottom, viewportBottom) - panelTop;
    els.filtersPanel.style.setProperty("--filters-panel-max-height", `${Math.max(1, Math.floor(availableHeight))}px`);
  }

  function toggleFiltersPanel(event) {
    event?.stopPropagation();
    const shouldOpen = !els.filtersPanel?.classList.contains("open");
    closeDropdowns();
    closeDatePicker();
    setFiltersPanelOpen(shouldOpen);
  }

  function closeDatePicker() {
    if (!activeDatePicker) return;
    activeDatePicker.remove();
    activeDatePicker = null;
  }

  function monthLabel(year, month) {
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(year, month, 1)));
  }

  function timeValue(ms) {
    const date = new Date(ms);
    return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  }

  function dayFloor(ms) {
    const date = new Date(ms);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  function combineDateAndTime(year, month, day, time) {
    const [hh = "0", mm = "0"] = String(time || "00:00").split(":");
    return Date.UTC(year, month, day, Number(hh), Number(mm), 0, 0);
  }

  function installDateTimePicker({ button, getMs, setMs }) {
    if (!button) return;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      closeDropdowns();
      closeDatePicker();
      const current = new Date(getMs());
      let viewYear = current.getUTCFullYear();
      let viewMonth = current.getUTCMonth();
      let pickerView = "days";
      let pickerExpandedYear = null;
      const minDay = dayFloor(getAnimationStartMinMs());
      const maxDay = dayFloor(maxMs);
      const popup = document.createElement("div");
      popup.className = "date-picker-popup";
      activeDatePicker = popup;

      const positionPopup = () => {
        const rect = button.getBoundingClientRect();
        const width = popup.offsetWidth || 236;
        const height = popup.offsetHeight || 260;
        popup.style.left = `${clamp(rect.left, 8, window.innerWidth - width - 8)}px`;
        popup.style.top = `${clamp(rect.bottom + 8, 8, window.innerHeight - height - 8)}px`;
      };

      const renderView = () => {
        if (pickerView === "years") renderYearGrid();
        else if (pickerView === "year") renderYearAccordion();
        else renderMonth();
      };

      const renderMonth = () => {
        const selected = new Date(getMs());
        const selectedDay = dayFloor(getMs());
        const firstDay = new Date(Date.UTC(viewYear, viewMonth, 1));
        const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
        const offset = firstDay.getUTCDay();
        popup.innerHTML = "";
        popup.className = "date-picker-popup";

        const header = document.createElement("div");
        header.className = "date-picker-header";
        const prev = document.createElement("button");
        prev.type = "button";
        prev.className = "date-picker-nav";
        prev.textContent = "‹";
        const label = document.createElement("span");
        label.className = "date-picker-header-label";
        label.textContent = monthLabel(viewYear, viewMonth);
        label.addEventListener("click", (clickEvent) => {
          clickEvent.stopPropagation();
          pickerView = "years";
          pickerExpandedYear = null;
          renderView();
        });
        const next = document.createElement("button");
        next.type = "button";
        next.className = "date-picker-nav";
        next.textContent = "›";
        header.append(prev, label, next);
        popup.appendChild(header);

        const grid = document.createElement("div");
        grid.className = "date-picker-grid";
        ["S", "M", "T", "W", "T", "F", "S"].forEach((dow) => {
          const cell = document.createElement("div");
          cell.className = "date-picker-dow";
          cell.textContent = dow;
          grid.appendChild(cell);
        });
        for (let index = 0; index < offset; index += 1) {
          const blank = document.createElement("div");
          blank.className = "date-picker-day dp-empty";
          grid.appendChild(blank);
        }

        const timeInput = document.createElement("input");
        timeInput.type = "time";
        timeInput.value = timeValue(getMs());

        for (let day = 1; day <= daysInMonth; day += 1) {
          const cell = document.createElement("button");
          cell.type = "button";
          cell.className = "date-picker-day";
          cell.textContent = String(day);
          const dateMs = Date.UTC(viewYear, viewMonth, day);
          const disabled = dateMs < minDay || dateMs > maxDay;
          cell.disabled = disabled;
          cell.classList.toggle("dp-disabled", disabled);
          cell.classList.toggle("dp-selected", dateMs === selectedDay);
          cell.addEventListener("click", (clickEvent) => {
            clickEvent.stopPropagation();
            setMs(combineDateAndTime(viewYear, viewMonth, day, timeInput.value));
            closeDatePicker();
          });
          grid.appendChild(cell);
        }
        popup.appendChild(grid);

        const timeRow = document.createElement("label");
        timeRow.className = "patoshi-time-row";
        timeRow.textContent = "Time";
        timeInput.addEventListener("click", (clickEvent) => clickEvent.stopPropagation());
        timeInput.addEventListener("change", () => {
          setMs(combineDateAndTime(
            selected.getUTCFullYear(),
            selected.getUTCMonth(),
            selected.getUTCDate(),
            timeInput.value
          ));
        });
        timeRow.appendChild(timeInput);
        popup.appendChild(timeRow);

        prev.addEventListener("click", (clickEvent) => {
          clickEvent.stopPropagation();
          viewMonth -= 1;
          if (viewMonth < 0) {
            viewMonth = 11;
            viewYear -= 1;
          }
          renderView();
        });
        next.addEventListener("click", (clickEvent) => {
          clickEvent.stopPropagation();
          viewMonth += 1;
          if (viewMonth > 11) {
            viewMonth = 0;
            viewYear += 1;
          }
          renderView();
        });
        positionPopup();
      };

      const renderYearGrid = () => {
        const minDate = new Date(minDay);
        const maxDate = new Date(maxDay);
        const minYear = minDate.getUTCFullYear();
        const maxYear = maxDate.getUTCFullYear();
        popup.innerHTML = "";
        popup.className = "date-picker-popup dp-year-grid-popup";

        const header = document.createElement("div");
        header.className = "date-picker-header";
        const back = document.createElement("button");
        back.type = "button";
        back.className = "date-picker-nav";
        back.textContent = "‹";
        back.addEventListener("click", (clickEvent) => {
          clickEvent.stopPropagation();
          pickerView = "days";
          renderView();
        });
        const label = document.createElement("span");
        label.className = "date-picker-header-label";
        label.textContent = "Select Year";
        header.append(back, label);
        popup.appendChild(header);

        const grid = document.createElement("div");
        grid.className = "dp-year-grid";
        for (let year = minYear; year <= maxYear; year += 1) {
          const cell = document.createElement("div");
          cell.className = "dp-year-cell";
          if (year === viewYear) cell.classList.add("dp-year-current");
          const yearLabel = document.createElement("span");
          yearLabel.textContent = String(year);
          const chevron = document.createElement("span");
          chevron.className = "dp-accordion-chevron";
          chevron.textContent = "›";
          cell.append(yearLabel, chevron);
          cell.addEventListener("click", (clickEvent) => {
            clickEvent.stopPropagation();
            pickerView = "year";
            pickerExpandedYear = year;
            renderView();
          });
          grid.appendChild(cell);
        }
        popup.appendChild(grid);
        requestAnimationFrame(() => {
          positionPopup();
          const selectedYear = popup.querySelector(".dp-year-current");
          if (selectedYear) grid.scrollTop = Math.max(0, selectedYear.offsetTop + selectedYear.offsetHeight - grid.clientHeight);
        });
      };

      const renderYearAccordion = () => {
        const minDate = new Date(minDay);
        const maxDate = new Date(maxDay);
        const minYear = minDate.getUTCFullYear();
        const maxYear = maxDate.getUTCFullYear();
        const expandedYear = pickerExpandedYear !== null ? pickerExpandedYear : viewYear;
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        popup.innerHTML = "";
        popup.className = "date-picker-popup dp-year-grid-popup";

        const header = document.createElement("div");
        header.className = "date-picker-header";
        const back = document.createElement("button");
        back.type = "button";
        back.className = "date-picker-nav";
        back.textContent = "‹";
        back.addEventListener("click", (clickEvent) => {
          clickEvent.stopPropagation();
          pickerView = "years";
          pickerExpandedYear = null;
          renderView();
        });
        const label = document.createElement("span");
        label.className = "date-picker-header-label";
        label.textContent = "Select Month";
        header.append(back, label);
        popup.appendChild(header);

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
          chevron.textContent = "›";
          yearBtn.appendChild(chevron);
          yearBtn.addEventListener("click", (clickEvent) => {
            clickEvent.stopPropagation();
            pickerExpandedYear = pickerExpandedYear === year ? null : year;
            renderView();
          });
          yearRow.appendChild(yearBtn);

          if (year === expandedYear) {
            const monthGrid = document.createElement("div");
            monthGrid.className = "dp-month-grid";
            monthNames.forEach((name, monthIndex) => {
              const minMonth = year === minYear ? minDate.getUTCMonth() : -1;
              const maxMonth = year === maxYear ? maxDate.getUTCMonth() : 12;
              const disabled = monthIndex < minMonth || monthIndex > maxMonth;
              const cell = document.createElement("button");
              cell.type = "button";
              cell.className = `dp-month-cell${disabled ? " dp-disabled" : ""}`;
              cell.disabled = disabled;
              if (year === viewYear && monthIndex === viewMonth) cell.classList.add("dp-month-current");
              cell.textContent = name;
              if (!disabled) {
                cell.addEventListener("click", (clickEvent) => {
                  clickEvent.stopPropagation();
                  viewYear = year;
                  viewMonth = monthIndex;
                  pickerView = "days";
                  pickerExpandedYear = null;
                  renderView();
                });
              }
              monthGrid.appendChild(cell);
            });
            yearRow.appendChild(monthGrid);
          }
          list.appendChild(yearRow);
        }
        popup.appendChild(list);
        requestAnimationFrame(() => {
          positionPopup();
          const openRow = popup.querySelector(".dp-accordion-year.dp-accordion-open");
          if (openRow) {
            const yearButton = openRow.querySelector(".dp-accordion-year-btn");
            const desiredTop = Math.max(0, (yearButton || openRow).offsetTop - 2);
            list.scrollTop = Math.min(desiredTop, Math.max(0, list.scrollHeight - list.clientHeight));
          }
        });
      };

      popup.addEventListener("click", (clickEvent) => clickEvent.stopPropagation());
      document.body.appendChild(popup);
      renderView();
    });
  }

  function getWindowMs() {
    return Math.max(getMinWindowMs(), state.endMs - state.startMs);
  }

  function parseWindowDaysValue(value) {
    const parsed = Number.parseFloat(sanitizeWindowDaysValue(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function sanitizeWindowDaysValue(value) {
    let out = "";
    let hasDecimal = false;
    for (const char of String(value || "")) {
      if (/\d/.test(char)) {
        out += char;
      } else if (char === "." && !hasDecimal) {
        out += char;
        hasDecimal = true;
      }
    }
    const [whole = "", decimal = ""] = out.split(".");
    const cleanWhole = whole.replace(/^0+(?=\d)/, "");
    if (!hasDecimal) return cleanWhole;
    return `${cleanWhole || "0"}.${decimal.slice(0, 1)}`;
  }

  function formatWindowDaysValue(value, { editing = false } = {}) {
    const clean = sanitizeWindowDaysValue(value);
    if (!clean) return "";
    const [wholeRaw = "0", decimalRaw] = clean.split(".");
    const whole = Number.parseInt(wholeRaw || "0", 10);
    const formattedWhole = Number.isFinite(whole) ? whole.toLocaleString("en-US") : "";
    if (editing && clean.includes(".")) return `${formattedWhole}.${decimalRaw || ""}`;
    const parsed = Number.parseFloat(clean);
    return parsed > 0
      ? parsed.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      : "";
  }

  function getCaretIndexForNumericPosition(value, numericCount) {
    if (numericCount <= 0) return 0;
    let seenNumeric = 0;
    for (let i = 0; i < value.length; i += 1) {
      if (!/[\d.]/.test(value[i])) continue;
      seenNumeric += 1;
      if (seenNumeric >= numericCount) return i + 1;
    }
    return value.length;
  }

  function setWindowByCount(count, { centerHighlighted = highlightedSpentBlockCentered } = {}) {
    const value = Math.max(1, Math.round((Number(count) || 1) * 10) / 10);
    const windowMs = Math.max(getMinWindowMs(), value * DAY);
    if (centerHighlighted && highlightedSpentBlockCentered) {
      const centeredRange = getRangeCenteredOnRow(getHighlightedSpentRow(), windowMs);
      if (centeredRange) {
        state.animationStartMs = Math.max(getAnimationStartMinMs(), state.animationStartMs);
        if (state.animationEndMs < state.animationStartMs + windowMs) {
          state.animationEndMs = Math.min(maxMs, state.animationStartMs + windowMs);
        }
        state.finalEndMs = state.animationEndMs;
        setLastAdjustedHandle("range");
        setRange(centeredRange.startMs, centeredRange.endMs);
        return;
      }
    }
    const oldTimelineMin = getTimelineMinMs();
    const timelineMin = getTimelineMinMs(windowMs);
    const wasPinnedToEarliest = Math.abs(state.startMs - oldTimelineMin) < HOUR / 2
      || Math.abs(state.endMs - state.animationStartMs) < HOUR / 2;
    state.animationStartMs = Math.max(getAnimationStartMinMs(), state.animationStartMs);
    if (state.animationEndMs < state.animationStartMs + windowMs) {
      state.animationEndMs = Math.min(maxMs, state.animationStartMs + windowMs);
    }
    let endMs = wasPinnedToEarliest ? state.animationStartMs : Math.max(state.endMs, timelineMin + windowMs);
    let startMs = Math.max(timelineMin, endMs - windowMs);
    if (endMs > state.animationEndMs) {
      endMs = state.animationEndMs;
      startMs = Math.max(timelineMin, endMs - windowMs);
    }
    state.finalEndMs = state.animationEndMs;
    setRange(startMs, endMs);
  }

  function commitWindowDaysInput() {
    const input = els.windowDaysInput;
    if (!input) return;
    const days = parseWindowDaysValue(input.value);
    if (!days) {
      input.value = input.dataset.lastValidValue
        ? formatWindowDaysValue(input.dataset.lastValidValue)
        : "";
      return;
    }
    setWindowByCount(days);
  }

  function handleWindowDaysInput() {
    const input = els.windowDaysInput;
    if (!input) return;
    const rawValue = String(input.value || "");
    const rawCaret = Number.isFinite(input.selectionStart) ? input.selectionStart : rawValue.length;
    const numericBeforeCaret = rawValue.slice(0, rawCaret).replace(/[^\d.]/g, "").length;
    const days = parseWindowDaysValue(input.value);
    const formatted = formatWindowDaysValue(input.value, { editing: true });
    input.value = formatted;
    if (document.activeElement === input) {
      const nextCaret = getCaretIndexForNumericPosition(formatted, numericBeforeCaret);
      input.setSelectionRange(nextCaret, nextCaret);
    }
    if (days > 0) setWindowByCount(days);
  }

  function commitHashrateWindowInput() {
    const input = els.hashrateWindowInput;
    if (!input) return;
    const days = parseWindowDaysValue(input.value);
    if (!days) {
      input.value = input.dataset.lastValidValue
        ? formatWindowDaysValue(input.dataset.lastValidValue)
        : "";
      return;
    }
    state.hashrateWindowMatch = false;
    state.hashrateWindowDays = normalizeHashrateWindowDays(days);
    syncHashrateWindowControls();
    render();
    saveState();
  }

  function handleHashrateWindowInput() {
    const input = els.hashrateWindowInput;
    if (!input) return;
    const rawValue = String(input.value || "");
    const rawCaret = Number.isFinite(input.selectionStart) ? input.selectionStart : rawValue.length;
    const numericBeforeCaret = rawValue.slice(0, rawCaret).replace(/[^\d.]/g, "").length;
    const days = parseWindowDaysValue(input.value);
    const formatted = formatWindowDaysValue(input.value, { editing: true });
    input.value = formatted;
    if (document.activeElement === input) {
      const nextCaret = getCaretIndexForNumericPosition(formatted, numericBeforeCaret);
      input.setSelectionRange(nextCaret, nextCaret);
    }
    if (days > 0) {
      state.hashrateWindowMatch = false;
      state.hashrateWindowDays = normalizeHashrateWindowDays(days);
      syncHashrateWindowControls();
      render();
      saveState();
    }
  }

  function applyHashrateWindowPreset(value) {
    state.hashrateWindowMatch = false;
    state.hashrateWindowDays = normalizeHashrateWindowDays(value);
    syncHashrateWindowControls();
    render();
    saveState();
  }

  function setHashrateWindowMatch(match) {
    const currentDays = getEffectiveHashrateWindowDays();
    state.hashrateWindowMatch = !!match;
    if (!state.hashrateWindowMatch) {
      state.hashrateWindowDays = currentDays;
    }
    syncHashrateWindowControls();
    render();
    saveState();
  }

  function setMarkerScale(value, { syncValue = true } = {}) {
    state.markerScale = normalizeMarkerScale(value);
    updateMarkerScaleControls(syncValue);
    render();
    saveState();
  }

  function setRange(startMs, endMs, { preserveFinal = false } = {}) {
    const desiredWindowMs = Math.max(getMinWindowMs(), endMs - startMs || getWindowMs());
    const timelineMin = getTimelineMinMs(desiredWindowMs);
    startMs = clamp(startMs, timelineMin, maxMs);
    endMs = clamp(endMs, timelineMin, maxMs);
    if (startMs > endMs) {
      if (selectedHandle === "start") endMs = startMs;
      else startMs = endMs;
    }
    const minWindowMs = getMinWindowMs();
    if (endMs - startMs < minWindowMs) {
      if (selectedHandle === "start") startMs = Math.max(timelineMin, endMs - minWindowMs);
      else endMs = Math.min(maxMs, startMs + minWindowMs);
      if (endMs - startMs < minWindowMs) {
        startMs = Math.max(timelineMin, endMs - minWindowMs);
      }
    }
    state.startMs = startMs;
    state.endMs = endMs;
    if (!preserveFinal) state.finalEndMs = state.animationEndMs;
    syncControls();
    render();
    saveState();
  }

  function setAnimationBounds(startMs, endMs, { syncWindow = false, originalWindowStart = state.startMs, originalWindowEnd = state.endMs } = {}) {
    const minSpan = getMinWindowMs();
    const windowMs = getWindowMs();
    const timelineMin = getTimelineMinMs(windowMs);
    const animationMin = getAnimationStartMinMs();
    startMs = clamp(startMs, animationMin, maxMs);
    endMs = clamp(endMs, animationMin, maxMs);
    if (startMs > endMs - HOUR) {
      if (selectedHandle === "start") startMs = Math.max(animationMin, endMs - HOUR);
      else endMs = Math.min(maxMs, startMs + HOUR);
    }
    state.animationStartMs = startMs;
    state.animationEndMs = endMs;
    state.finalEndMs = endMs;
    if (syncWindow) {
      if (selectedHandle === "start") {
        const shouldShiftWindow = startMs > originalWindowEnd;
        const windowEnd = shouldShiftWindow ? clamp(startMs, timelineMin, maxMs) : originalWindowEnd;
        state.endMs = windowEnd;
        state.startMs = shouldShiftWindow
          ? Math.max(timelineMin, windowEnd - windowMs)
          : originalWindowStart;
      } else if (selectedHandle === "end") {
        let windowEnd = originalWindowEnd;
        if (endMs < originalWindowEnd) windowEnd = endMs;
        windowEnd = clamp(windowEnd, Math.min(maxMs, timelineMin + windowMs), maxMs);
        state.endMs = windowEnd;
        state.startMs = Math.max(timelineMin, windowEnd - windowMs);
      }
    }
    if (state.animationEndMs - state.animationStartMs <= minSpan) {
      state.playing = false;
      state.paused = false;
      cancelAnimationFrame(rafId);
      rafId = 0;
      lastFrameTime = 0;
    }
    syncControls();
    render();
    saveState();
  }

  function msFromRangePointer(clientX) {
    const rect = els.rangeLine.getBoundingClientRect();
    const styles = window.getComputedStyle(els.rangeLine);
    const edgePad = Number.parseFloat(styles.getPropertyValue("--slider-edge-pad")) || 0;
    const usable = Math.max(1, rect.width - edgePad * 2);
    const pct = clamp((clientX - rect.left - edgePad) / usable, 0, 1);
    const timelineMin = getTimelineMinMs();
    return timelineMin + pct * Math.max(1, maxMs - timelineMin);
  }

  function getRangePointerGeometry(event) {
    if (!els.rangeLine) return null;
    const rect = els.rangeLine.getBoundingClientRect();
    const styles = window.getComputedStyle(els.rangeLine);
    const left = Number.parseFloat(styles.getPropertyValue("--slider-window-left")) || 0;
    const width = Number.parseFloat(styles.getPropertyValue("--slider-window-width")) || 0;
    const height = Number.parseFloat(styles.getPropertyValue("--slider-window-height")) || 10;
    const startMarker = Number.parseFloat(styles.getPropertyValue("--slider-start-marker")) || 0;
    const endMarker = Number.parseFloat(styles.getPropertyValue("--slider-end-marker")) || 0;
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const centerY = rect.height / 2;
    return { rect, left, width, height, startMarker, endMarker, localX, localY, centerY };
  }

  function isPointerOnRangeMarker(event, kind) {
    const geometry = getRangePointerGeometry(event);
    if (!geometry) return false;
    const markerX = kind === "start" ? geometry.startMarker : geometry.endMarker;
    const markerHalfW = 10;
    const markerHalfH = 17;
    return (
      geometry.localX >= markerX - markerHalfW &&
      geometry.localX <= markerX + markerHalfW &&
      geometry.localY >= geometry.centerY - markerHalfH &&
      geometry.localY <= geometry.centerY + markerHalfH
    );
  }

  function isPointerOnWindowBar(event) {
    const geometry = getRangePointerGeometry(event);
    if (!geometry) return false;
    const pad = 8;
    if (
      geometry.localX >= geometry.left - pad &&
      geometry.localX <= geometry.left + geometry.width + pad &&
      geometry.localY >= geometry.centerY - geometry.height / 2 - pad &&
      geometry.localY <= geometry.centerY + geometry.height / 2 + pad
    ) return true;
    const clickedMs = msFromRangePointer(event.clientX);
    return clickedMs > state.startMs && clickedMs < state.endMs;
  }

  function isPointerInAnimationSpan(event) {
    const clickedMs = msFromRangePointer(event.clientX);
    return clickedMs >= state.animationStartMs && clickedMs <= state.animationEndMs;
  }

  function updateRangeCursor(event) {
    if (!els.rangeLine || rangeDrag) return;
    let cursor = "default";
    if (isPointerOnRangeMarker(event, "start") || isPointerOnRangeMarker(event, "end")) {
      cursor = "pointer";
    } else if (isPointerOnWindowBar(event) || isPointerInAnimationSpan(event)) {
      cursor = "ew-resize";
    }
    els.rangeLine.style.setProperty("--range-cursor", cursor);
  }

  function setWindowEndFromPointer(pointerMs) {
    const windowMs = getWindowMs();
    const minEnd = Math.min(state.animationEndMs, state.animationStartMs);
    const safeEnd = clamp(pointerMs, minEnd, state.animationEndMs);
    const safeStart = Math.max(getTimelineMinMs(windowMs), safeEnd - windowMs);
    lastAdjustedHandle = "range";
    setRange(safeStart, safeEnd);
  }

  function startRangePointerDrag(kind, event) {
    event.preventDefault();
    event.stopPropagation();
    if (kind === "start" || kind === "end") setLastAdjustedHandle(kind);
    if (state.playing) pauseAnimation();
    rangeDrag = {
      kind,
      pointerMs: msFromRangePointer(event.clientX),
      startMs: state.startMs,
      endMs: state.endMs,
      animationStartMs: state.animationStartMs,
      animationEndMs: state.animationEndMs,
    };
    try { els.rangeLine.setPointerCapture?.(event.pointerId); } catch (_) {}
    window.addEventListener("pointermove", handleRangePointerMove);
    window.addEventListener("pointerup", endRangePointerDrag, { once: true });
    handleRangePointerMove(event);
  }

  function handleRangePointerMove(event) {
    if (!rangeDrag) return;
    const pointerMs = msFromRangePointer(event.clientX);
    if (rangeDrag.kind === "start") {
      setLastAdjustedHandle("start");
      setAnimationBounds(pointerMs, state.animationEndMs, {
        syncWindow: true,
        originalWindowStart: rangeDrag.startMs,
        originalWindowEnd: rangeDrag.endMs,
      });
    } else if (rangeDrag.kind === "end") {
      setLastAdjustedHandle("end");
      setAnimationBounds(state.animationStartMs, pointerMs, {
        syncWindow: true,
        originalWindowStart: rangeDrag.startMs,
        originalWindowEnd: rangeDrag.endMs,
      });
    } else if (rangeDrag.kind === "range") {
      const shift = pointerMs - rangeDrag.pointerMs;
      const minShift = state.animationStartMs - rangeDrag.endMs;
      const maxShift = state.animationEndMs - rangeDrag.endMs;
      const safeShift = clamp(shift, minShift, maxShift);
      lastAdjustedHandle = "range";
      setRange(rangeDrag.startMs + safeShift, rangeDrag.endMs + safeShift);
    } else if (rangeDrag.kind === "window-end") {
      setWindowEndFromPointer(pointerMs);
    }
  }

  function endRangePointerDrag() {
    rangeDrag = null;
    if (els.rangeLine) els.rangeLine.style.setProperty("--range-cursor", "default");
    window.removeEventListener("pointermove", handleRangePointerMove);
  }

  function stopAnimation() {
    state.playing = false;
    state.paused = false;
    cancelAnimationFrame(rafId);
    rafId = 0;
    lastFrameTime = 0;
    moveWindowToAnimationStart();
    syncControls();
    render();
    saveState();
  }

  function pauseAnimation() {
    if (!state.playing) return;
    state.playing = false;
    state.paused = true;
    cancelAnimationFrame(rafId);
    rafId = 0;
    syncControls();
    saveState();
  }

  function playAnimation() {
    if (!rows.length) return;
    hideChartTooltip();
    state.finalEndMs = state.animationEndMs;
    if (!state.paused && state.endMs >= state.animationEndMs - HOUR / 2) {
      moveWindowToAnimationStart();
    }
    state.playing = true;
    state.paused = false;
    lastFrameTime = 0;
    syncControls();
    rafId = requestAnimationFrame(tickAnimation);
  }

  function togglePlayback() {
    state.playing ? pauseAnimation() : playAnimation();
  }

  function nudgeLastAdjustedHandle(delta) {
    if (lastAdjustedHandle !== "start" && lastAdjustedHandle !== "end" && lastAdjustedHandle !== "range") return false;
    if (lastAdjustedHandle === "range") {
      const minShift = state.animationStartMs - state.endMs;
      const maxShift = state.animationEndMs - state.endMs;
      const safeShift = clamp(delta, minShift, maxShift);
      setRange(state.startMs + safeShift, state.endMs + safeShift);
      return true;
    }
    if (lastAdjustedHandle === "start") setAnimationBounds(state.animationStartMs + delta, state.animationEndMs, { syncWindow: true });
    else setAnimationBounds(state.animationStartMs, state.animationEndMs + delta, { syncWindow: true });
    return true;
  }

  function getPlaybackFrameMs(speedMultiplier = null) {
    const speed = speeds[state.speedIndex] || speeds[1];
    const baseMsPerSecond = Math.max(HOUR / 60, getWindowMs() / 15);
    const multiplier = Number.isFinite(speedMultiplier) ? speedMultiplier : (speed.multiplier || 1);
    return baseMsPerSecond * multiplier / 30;
  }

  function tickAnimation(now) {
    if (!state.playing) return;
    if (!lastFrameTime) lastFrameTime = now;
    const elapsed = Math.max(0, now - lastFrameTime) / 1000;
    lastFrameTime = now;
    const speed = speeds[state.speedIndex] || speeds[1];
    const windowMs = getWindowMs();
    const baseHoursPerSecond = Math.max(1 / 60, (windowMs / HOUR) / 15);
    const shift = baseHoursPerSecond * (speed.multiplier || 1) * HOUR * elapsed;
    state.startMs += shift;
    state.endMs += shift;
    const finalEndMs = state.finalEndMs || state.animationEndMs;
    if (state.endMs >= finalEndMs) {
      state.endMs = finalEndMs;
      state.startMs = Math.max(getTimelineMinMs(windowMs), state.endMs - windowMs);
      state.playing = false;
      state.paused = false;
    }
    syncControls();
    render();
    saveState();
    if (state.playing) rafId = requestAnimationFrame(tickAnimation);
  }

  function getVisibleRows() {
    return rows.filter((row) => row.ms >= state.startMs && row.ms <= state.endMs);
  }

  function getRowsThroughEnd() {
    return rows.filter((row) => row.ms <= state.endMs);
  }

  function getThemeColors() {
    theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    return {
      bg: theme === "light" ? "#ffffff" : "#000000",
      fg: theme === "light" ? "#1c1b19" : "#f1f5f7",
      muted: theme === "light" ? "#6f685f" : "#95a6ae",
      grid: theme === "light" ? COLORS.gridLight : COLORS.gridDark,
      faint: theme === "light" ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.22)",
    };
  }

  function resizeCanvas() {
    const rect = exportRenderRect || canvas.getBoundingClientRect();
    const dpr = exportRenderRect ? Math.max(1, exportRenderRect.dpr || 1) : Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(360, Math.floor(rect.height));
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return false;
  }

  function niceTicks(min, max, target = 6) {
    const span = Math.max(1, max - min);
    const rough = span / target;
    const power = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 5, 10].find((m) => rough <= m * power) * power;
    const start = Math.ceil(min / step) * step;
    const ticks = [];
    for (let value = start; value <= max + step * 0.25; value += step) ticks.push(value);
    return ticks;
  }

  function makeUtcDate(year, month, day = 1) {
    return new Date(Date.UTC(year, month, day));
  }

  function buildAdaptiveMonthTicks(start, end) {
    const first = new Date(start);
    const last = new Date(end);
    const span = Math.max(1, end - start);
    const startYear = first.getUTCFullYear();
    const endYear = last.getUTCFullYear();
    const isMultiYearRange = endYear > startYear;
    const monthStarts = [];
    let cursor = makeUtcDate(startYear, first.getUTCMonth(), 1);
    while (cursor <= last) {
      const ms = cursor.getTime();
      if (ms >= start && ms <= end) monthStarts.push(new Date(ms));
      cursor = makeUtcDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1);
    }
    if (!monthStarts.length) return [];

    if (span <= 760 * DAY) {
      return monthStarts.map((date) => {
        const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
        return {
          ms: date.getTime(),
          type: "major",
          label: date.getUTCMonth() === 0 ? String(date.getUTCFullYear()) : month,
        };
      });
    }

    const chartW = (exportRenderRect || canvas.getBoundingClientRect()).width;
    const maxTicks = Math.max(4, Math.floor(chartW / 88));
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
        monthStarts.forEach((date, idx) => {
          if (monthLookup.has(date.getUTCMonth())) out.push(idx);
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
      .map((date) => {
        const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
        return {
          ms: date.getTime(),
          type: "major",
          label: date.getUTCMonth() === 0 ? String(date.getUTCFullYear()) : month,
        };
      });
  }

  function utcDayStart(ms) {
    const date = new Date(ms);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  function monthDayLabel(ms) {
    const date = new Date(ms);
    const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    return `${month} ${date.getUTCDate()}`;
  }

  function hourLabel(ms) {
    const hour = new Date(ms).getUTCHours();
    return `${hour % 12 || 12}${hour < 12 ? "AM" : "PM"}`;
  }

  function xTickItems(start, end) {
    const span = Math.max(1, end - start);
    if (span <= 45 * DAY) {
      const ticks = [];
      const firstDay = utcDayStart(start);
      const showHourTicks = span <= 25 * DAY;
      let hourStep = 8;
      if (span <= DAY + HOUR) hourStep = 1;
      else if (span <= 3 * DAY + HOUR) hourStep = 3;
      else if (span <= 4 * DAY) hourStep = 6;
      for (let day = firstDay; day <= end + DAY; day += DAY) {
        if (day >= start && day <= end) ticks.push({ ms: day, type: "day", label: monthDayLabel(day) });
        const hourMarks = [];
        if (showHourTicks) {
          if (span > 14 * DAY) {
            hourMarks.push(12);
          } else {
            for (let hour = span <= 4 * DAY ? 0 : 8; hour < 24; hour += hourStep) hourMarks.push(hour);
            if (span > 4 * DAY) hourMarks.splice(0, hourMarks.length, 8, 16);
          }
        }
        hourMarks.forEach((hour) => {
          const ms = day + hour * HOUR;
          if (ms > start && ms < end && ms !== day) ticks.push({ ms, type: "hour", label: hourLabel(ms) });
        });
      }
      return ticks.sort((a, b) => a.ms - b.ms);
    }
    if (span <= 120 * DAY) {
      const ticks = [];
      const firstDay = utcDayStart(start);
      const tickDays = new Set([1, 8, 15, 22]);
      for (let day = firstDay; day <= end + DAY; day += DAY) {
        const date = new Date(day);
        if (day >= start && day <= end && tickDays.has(date.getUTCDate())) {
          ticks.push({ ms: day, type: "day", label: monthDayLabel(day) });
        }
      }
      return ticks;
    }
    return buildAdaptiveMonthTicks(start, end);
  }

  function yMaxFor(visible, throughEnd) {
    const safe = visible.length ? visible : rows;
    let yMax;
    if (state.yMode === "custom") yMax = normalizeYMaxCustom(state.yMaxCustom);
    else if (state.yMode === "window_all") yMax = Math.max(100, ...safe.map((row) => row.extranonce));
    else if (state.yMode === "window_patoshi") yMax = Math.max(100, ...safe.filter(isPatoshiRow).map((row) => row.extranonce), 420);
    else yMax = Math.max(420, ...throughEnd.filter(isPatoshiRow).map((row) => row.extranonce), 100);
    const highlighted = getHighlightedSpentRow();
    if (highlighted && highlighted.ms >= state.startMs && highlighted.ms <= state.endMs) {
      yMax = highlighted.extranonce > yMax
        ? Math.max(yMax, highlighted.extranonce * 1.08)
        : Math.max(yMax, highlighted.extranonce);
    }
    return yMax;
  }

  function getCurrentEffectiveYMax() {
    if (!rows.length) return normalizeYMaxCustom(state.yMaxCustom);
    return normalizeYMaxCustom(yMaxFor(getVisibleRows(), getRowsThroughEnd()));
  }

  function rememberYModeBeforeAxisCustom() {
    if (state.yMode !== "custom") yAxisRestoreMode = state.yMode;
  }

  function setYMaxCustomFromAxis(value, options = {}) {
    const remember = options.remember !== false;
    if (remember) rememberYModeBeforeAxisCustom();
    state.yMode = "custom";
    state.yMaxCustom = normalizeYMaxCustom(value);
    if (els.yMode) els.yMode.value = "custom";
    syncDropdownLabels();
    syncYMaxInput(state.yMaxCustom);
    render();
    if (options.persist !== false) saveState();
  }

  function adjustYMaxCustomByFactor(factor) {
    const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
    setYMaxCustomFromAxis(getCurrentEffectiveYMax() * safeFactor);
  }

  function restoreYModeBeforeAxisCustom() {
    if (!yAxisRestoreMode) return;
    state.yMode = yAxisRestoreMode;
    if (els.yMode) els.yMode.value = state.yMode;
    yAxisRestoreMode = null;
    syncDropdownLabels();
    render();
    saveState();
  }

  function resetYModeToRollingPatoshi() {
    state.yMode = "rolling_patoshi";
    if (els.yMode) els.yMode.value = state.yMode;
    yAxisRestoreMode = null;
    syncDropdownLabels();
    render();
    saveState();
  }

  function drawText(text, x, y, options = {}) {
    ctx.save();
    ctx.font = options.font || `${options.weight || 500} ${options.size || 14}px "IBM Plex Mono"`;
    ctx.fillStyle = options.color || getThemeColors().fg;
    ctx.textAlign = options.align || "left";
    ctx.textBaseline = options.baseline || "middle";
    if (options.shadow) {
      ctx.shadowColor = options.shadow;
      ctx.shadowBlur = 4;
    } else {
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function textWidth(text, size = 14, weight = 500) {
    ctx.save();
    ctx.font = `${weight} ${size}px "IBM Plex Mono"`;
    const width = ctx.measureText(String(text)).width;
    ctx.restore();
    return width;
  }

  function drawLine(points, color, width = 2, dash = [], clipArea = null) {
    if (points.length < 2) return;
    ctx.save();
    if (clipArea) {
      ctx.beginPath();
      ctx.rect(clipArea.left, clipArea.top, clipArea.right - clipArea.left, clipArea.bottom - clipArea.top);
      ctx.clip();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.setLineDash(dash);
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();
  }

  function rowsWithLeftContinuity(visibleRows, predicate) {
    const drawable = visibleRows.filter(predicate);
    const previous = rows.slice().reverse().find((row) => row.ms < state.startMs && predicate(row));
    return previous ? [previous, ...drawable] : drawable;
  }

  function updateKpis(visible, throughEnd) {
    const last = throughEnd[throughEnd.length - 1] || rows[rows.length - 1];
    const windowRows = visible.length ? visible : [];
    const cumulativeRows = throughEnd.length ? throughEnd : [];
    const cumulativePatoshiRows = cumulativeRows.filter(isPatoshiRow);
    const cumulativeOtherRows = cumulativeRows.filter((row) => !isPatoshiRow(row));
    const spentPatoshi = cumulativePatoshiRows.filter((row) => row.isSpent).length;
    const spentOther = cumulativeOtherRows.filter((row) => row.isSpent).length;
    const totalCumulativeBlocks = Math.max(1, cumulativeRows.length);
    const lastPatoshi = throughEnd.slice().reverse().find(isPatoshiRow);
    const lastOther = throughEnd.slice().reverse().find((row) => !isPatoshiRow(row));

    $("kpiHeight").textContent = last ? fmtInt(last.height) : "";
    $("kpiPatoshi").textContent = `${fmtInt(cumulativePatoshiRows.length)} (${(cumulativePatoshiRows.length / totalCumulativeBlocks * 100).toFixed(1)}%)`;
    $("kpiOther").textContent = `${fmtInt(cumulativeOtherRows.length)} (${(cumulativeOtherRows.length / totalCumulativeBlocks * 100).toFixed(1)}%)`;
    if (state.countMetric === "time") {
      $("kpiPatoshiSub").textContent = lastPatoshi ? `${Math.max(0, (state.endMs - lastPatoshi.ms) / HOUR).toFixed(1)}h since last` : "";
      $("kpiOtherSub").textContent = lastOther ? `${Math.max(0, (state.endMs - lastOther.ms) / HOUR).toFixed(1)}h since last` : "";
    } else {
      $("kpiPatoshiSub").textContent = `${fmtInt(spentPatoshi)}/${fmtInt(cumulativePatoshiRows.length)} (${(cumulativePatoshiRows.length ? spentPatoshi / cumulativePatoshiRows.length * 100 : 0).toFixed(1)}%) Spent`;
      $("kpiOtherSub").textContent = `${fmtInt(spentOther)}/${fmtInt(cumulativeOtherRows.length)} (${(cumulativeOtherRows.length ? spentOther / cumulativeOtherRows.length * 100 : 0).toFixed(1)}%) Spent`;
    }
    $("kpiDifficulty").textContent = last ? fmtDifficulty(last.difficulty) : "";
    const prevDiff = throughEnd.slice().reverse().find((row) => row.height < last.height && row.difficulty !== last.difficulty);
    const diffPct = prevDiff && last ? ((last.difficulty / prevDiff.difficulty - 1) * 100) : 0;
    $("kpiDiffChange").textContent = prevDiff ? `${diffPct >= 0 ? "▲" : "▼"} ${Math.abs(diffPct).toFixed(2)}%` : "▲ 0.00%";
    $("kpiDiffChange").style.color = diffPct > 0 ? COLORS.green : diffPct < 0 ? COLORS.red : "var(--muted)";
    const hashrateWindowMs = getEffectiveHashrateWindowMs();
    const hashrateStartMs = state.endMs - hashrateWindowMs;
    const hashrateRows = rows.filter((row) => row.ms >= hashrateStartMs && row.ms <= state.endMs);
    const hashrateDurationSeconds = Math.max(1, hashrateWindowMs / 1000);
    const workFor = (items) => items.reduce((sum, row) => sum + row.difficulty * 2 ** 32, 0);
    const avgHashrate = workFor(hashrateRows) / hashrateDurationSeconds;
    const patoshiHashrate = workFor(hashrateRows.filter(isPatoshiRow)) / hashrateDurationSeconds;
    const otherHashrate = workFor(hashrateRows.filter((row) => !isPatoshiRow(row))) / hashrateDurationSeconds;
    const hashrateWindowDays = Math.max(1, hashrateWindowMs / DAY);
    $("kpiHashrateLabel").textContent = `Hashrate (${trimFixed(hashrateWindowDays, 1)}D Average)`;
    $("kpiHashrate").textContent = hashrateRows.length ? formatHashrate(avgHashrate) : "";
    $("kpiHashrateSub").innerHTML = hashrateRows.length
      ? `<span class="hashrate-split"><span class="hashrate-split-left" style="color:${COLORS.patoshi}">${formatHashrate(patoshiHashrate)}</span><span class="hashrate-split-divider">|</span><span class="hashrate-split-right" style="color:${COLORS.other}">${formatHashrate(otherHashrate)}</span></span>`
      : "";
  }

  function trimFixed(value, decimals = 2) {
    return Number(value).toFixed(decimals).replace(/\.?0+$/, "");
  }

  function formatHashrate(value) {
    if (!Number.isFinite(value)) return "";
    if (value >= 1e18) return `${(value / 1e18).toFixed(2)} EH/s`;
    if (value >= 1e15) return `${(value / 1e15).toFixed(2)} PH/s`;
    if (value >= 1e12) return `${(value / 1e12).toFixed(2)} TH/s`;
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)} GH/s`;
    return `${(value / 1e6).toFixed(2)} MH/s`;
  }

  function render() {
    if (!rows.length) {
      chartPlotArea = null;
      xAxisHitArea = null;
      yAxisHitArea = null;
      return;
    }
    resizeCanvas();
    const c = getThemeColors();
    const rect = exportRenderRect || canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, rect.width, rect.height);

    const visible = getVisibleRows();
    const throughEnd = getRowsThroughEnd();
    updateKpis(visible, throughEnd);

    const mobile = rect.width < 620;
    const yMax = yMaxFor(visible, throughEnd);
    syncYMaxInput(yMax);
    const yTicks = niceTicks(0, yMax, mobile ? 5 : 7);
    const yTickFontSize = mobile ? 11 : 13;
    const yTickMaxWidth = Math.max(...yTicks.map((tick) => textWidth(fmtInt(tick), yTickFontSize)), 0);
    const yLabelFontSize = mobile ? 12 : 14;
    const yLabelHalfWidth = yLabelFontSize * 0.58;
    const yLabelX = mobile ? 8 : 12;
    const plot = {
      left: Math.max(mobile ? 42 : 54, yLabelX + yLabelHalfWidth + (mobile ? 8 : 10) + yTickMaxWidth + (mobile ? 9 : 12)),
      right: rect.width - (mobile ? 6 : 10),
      top: mobile ? 66 : 62,
      bottom: rect.height - (mobile ? 62 : 72),
    };
    chartPlotArea = plot;
    yAxisHitArea = {
      left: 0,
      right: plot.left + (mobile ? 4 : 6),
      top: plot.top - (mobile ? 8 : 10),
      bottom: plot.bottom + (mobile ? 8 : 10),
    };
    const width = Math.max(1, plot.right - plot.left);
    const height = Math.max(1, plot.bottom - plot.top);
    const xDomainPad = (state.endMs - state.startMs) * 0.006;
    const xDomainStart = state.startMs - xDomainPad;
    const xDomainEnd = state.endMs + xDomainPad;
    const yMin = -yMax * 0.022;
    const yDomainMax = yMax * 1.025;
    const x = (ms) => plot.left + ((ms - xDomainStart) / (xDomainEnd - xDomainStart)) * width;
    const y = (value) => plot.bottom - ((value - yMin) / (yDomainMax - yMin)) * height;

    ctx.save();
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1;
    yTicks.forEach((tick) => {
      const yy = y(tick);
      ctx.beginPath();
      ctx.moveTo(plot.left - (mobile ? 5 : 8), yy);
      ctx.lineTo(plot.left - 2, yy);
      ctx.stroke();
      drawText(fmtInt(tick), plot.left - (mobile ? 8 : 12), yy, { align: "right", color: c.fg, size: yTickFontSize });
    });
    const xt = xTickItems(state.startMs, state.endMs);
    const xTickLabelY = plot.bottom + (mobile ? 24 : 28);
    xAxisHitArea = {
      left: 0,
      right: rect.width,
      top: plot.bottom - (mobile ? 6 : 8),
      bottom: rect.height,
    };
    xt.forEach((tick) => {
      const xx = x(tick.ms);
      const isHour = tick.type === "hour";
      const tickTop = plot.bottom + (isHour ? 1 : 0);
      const dayTickLength = (mobile ? 20 : 24) * 0.9;
      const tickBottom = plot.bottom + (isHour ? (mobile ? 16 : 18) : dayTickLength);
      ctx.beginPath();
      ctx.strokeStyle = isHour ? c.faint : c.muted;
      ctx.moveTo(xx, tickTop);
      ctx.lineTo(xx, tickBottom);
      ctx.stroke();
      ctx.save();
      ctx.translate(xx, xTickLabelY);
      ctx.rotate(-Math.PI / 4);
      drawText(tick.label, 0, 0, {
        align: "right",
        color: isHour ? c.faint : c.fg,
        size: mobile ? 11 : 14,
      });
      ctx.restore();
    });
    ctx.restore();

    ctx.save();
    ctx.translate(yLabelX, (plot.top + plot.bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    drawText("ExtraNonce", 0, 0, { align: "center", color: c.muted, size: yLabelFontSize });
    ctx.restore();

    const points = visible.map((row) => [x(row.ms), y(row.extranonce), row]);
    diffMarkerHitboxes = [];
    blockMarkerHitboxes = [];
    const isDrawableRow = (row) => state.showSpent || !row.isSpent;
    const orderRows = rowsWithLeftContinuity(visible, isDrawableRow);
    if (state.showOrder) {
      drawLine(
        orderRows.map((row) => [x(row.ms), y(row.extranonce)]),
        "rgba(140,140,140,0.32)",
        1.3,
        [],
        { ...plot, top: 0 }
      );
    }

    const drawableRows = rowsWithLeftContinuity(visible, (row) => isDrawableRow(row) && isPatoshiRow(row));
    const drawablePoints = points.filter(([, , row]) => state.showSpent || !row.isSpent);
    drawSpecialMarkers(visible, x, y, plot, c, mobile);
    drawPoints(drawablePoints, c, mobile, (row) => !isPatoshiRow(row));
    if (state.showPatoshiLine && state.patoshiPattern !== "none") drawPatoshiSegments(drawableRows, x, y, plot);
    drawPoints(drawablePoints, c, mobile, isPatoshiRow);
    drawHighlightedSpentReward(x, y, plot, c, mobile);

    const dateLabelInset = rect.width - plot.right;
    const lightMode = document.documentElement.dataset.theme === "light";
    const dateShadow = lightMode ? false : "rgba(0, 0, 0, 0.9)";
    const dateColor = lightMode ? "#000000" : c.muted;
    drawText(fmtDateTime(state.startMs, false), dateLabelInset, plot.top - 44, { color: dateColor, size: mobile ? 11 : 13, weight: lightMode ? 700 : 500, shadow: dateShadow });
    drawText(fmtTimeUtc(state.startMs), dateLabelInset, plot.top - 26, { color: dateColor, size: mobile ? 10 : 12, weight: lightMode ? 700 : 500, shadow: dateShadow });
    drawText(fmtDateTime(state.endMs, false), rect.width - dateLabelInset, plot.top - 44, { align: "right", color: dateColor, size: mobile ? 11 : 13, weight: lightMode ? 700 : 500, shadow: dateShadow });
    drawText(fmtTimeUtc(state.endMs), rect.width - dateLabelInset, plot.top - 26, { align: "right", color: dateColor, size: mobile ? 10 : 12, weight: lightMode ? 700 : 500, shadow: dateShadow });
  }

  function drawPatoshiSegments(visible, x, y, plot) {
    const patoshi = visible.filter(isPatoshiRow);
    const lineClip = { ...plot, top: 0 };
    const pointForRow = (row) => [
      x(row.ms),
      y(row.extranonce),
    ];
    let segment = [];
    patoshi.forEach((row, index) => {
      const prev = patoshi[index - 1];
      if (prev && row.extranonce > prev.extranonce) {
        if (!segment.length) segment.push(pointForRow(prev));
        segment.push(pointForRow(row));
      } else {
        drawLine(segment, "rgba(255, 153, 0, 0.75)", Math.max(0.35, 2.2 * getPatoshiLineScale()), [], lineClip);
        segment = [pointForRow(row)];
      }
    });
    drawLine(segment, "rgba(255, 153, 0, 0.75)", Math.max(0.35, 2.2 * getPatoshiLineScale()), [], lineClip);
  }

  function drawPoints(points, c, mobile, includeRow = () => true) {
    const radius = (mobile ? 2.2 : 2.8) * getMarkerScale();
    ctx.save();
    points.forEach(([xx, yy, row]) => {
      if (!includeRow(row)) return;
      ctx.globalAlpha = 1;
      if (state.markSpent && row.isSpent) {
        ctx.strokeStyle = theme === "light" ? COLORS.spentLight : COLORS.spentDark;
        ctx.lineWidth = 1.5;
        const s = radius * 1.75;
        ctx.beginPath();
        ctx.moveTo(xx - s, yy - s);
        ctx.lineTo(xx + s, yy + s);
        ctx.moveTo(xx + s, yy - s);
        ctx.lineTo(xx - s, yy + s);
        ctx.stroke();
      }
      ctx.fillStyle = isPatoshiRow(row) ? COLORS.patoshi : COLORS.other;
      ctx.beginPath();
      ctx.arc(xx, yy, radius, 0, Math.PI * 2);
      ctx.fill();
      blockMarkerHitboxes.push({
        x: xx,
        y: yy,
        r: Math.max(mobile ? 8 : 10, radius * 2.5),
        row,
      });
    });
    ctx.restore();
  }

  function drawHighlightedSpentReward(x, y, plot, c, mobile) {
    const row = getHighlightedSpentRow();
    if (!row || row.ms < state.startMs || row.ms > state.endMs) return;
    const xx = x(row.ms);
    const yy = y(row.extranonce);
    if (xx < plot.left - 2 || xx > plot.right + 2 || yy < plot.top - 24 || yy > plot.bottom + 2) return;
    const ringRadius = Math.max(mobile ? 6 : 8, (mobile ? 5.5 : 7) * getMarkerScale());
    const label = fmtInt(row.height);
    const labelSize = mobile ? 11 : 13;
    const labelY = Math.max(plot.top + labelSize, yy - ringRadius - 9);
    const labelX = clamp(xx, plot.left + textWidth(label, labelSize) / 2 + 2, plot.right - textWidth(label, labelSize) / 2 - 2);
    ctx.save();
    const lightMode = theme === "light";
    const highlightColor = lightMode ? "#000000" : c.fg;
    ctx.strokeStyle = highlightColor;
    ctx.lineWidth = mobile ? 2 : 2.4;
    ctx.beginPath();
    ctx.arc(xx, yy, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
    drawText(label, labelX, labelY, {
      align: "center",
      color: highlightColor,
      size: labelSize,
      weight: 700,
      shadow: lightMode ? false : "rgba(0, 0, 0, 0.95)",
    });
    ctx.restore();
  }

  function drawSpecialMarkers(visible, x, y, plot, c, mobile) {
    visible.forEach((row) => {
      if (row.height > 0 && row.height % 2016 === 0) {
        const previous = rows.find((candidate) => candidate.height === row.height - 1);
        const diffChange = previous ? row.difficulty / previous.difficulty - 1 : 0;
        const diffPct = diffChange * 100;
        const diffDirection = diffChange > 0 ? "up" : diffChange < 0 ? "down" : "flat";
        const xx = x(row.ms);
        const markerSize = Math.max(mobile ? 4.5 : 5.5, (mobile ? 9 : 11) * getDiffMarkerScale());
        const markerTop = plot.bottom;
        const yy = markerTop + markerSize * 0.58;
        ctx.save();
        ctx.fillStyle = diffDirection === "up" ? COLORS.green : diffDirection === "down" ? COLORS.red : (theme === "light" ? COLORS.greyLight : c.muted);
        ctx.beginPath();
        if (diffDirection === "down") {
          ctx.moveTo(xx - markerSize * 0.68, markerTop);
          ctx.lineTo(xx + markerSize * 0.68, markerTop);
          ctx.lineTo(xx, markerTop + markerSize * 1.25);
        } else {
          ctx.moveTo(xx, markerTop);
          ctx.lineTo(xx + markerSize * 0.68, markerTop + markerSize * 1.25);
          ctx.lineTo(xx - markerSize * 0.68, markerTop + markerSize * 1.25);
        }
        ctx.closePath();
        ctx.fill();
        diffMarkerHitboxes.push({
          x: xx,
          y: yy,
          r: Math.max(mobile ? 8 : 10, markerSize * 1.45),
          epoch: row.height / 2016,
          difficulty: row.difficulty,
          adjustment: diffPct,
        });
        ctx.restore();
      }
    });
  }

  function hideChartTooltip() {
    if (!els.chartTooltip) return;
    els.chartTooltip.style.display = "none";
  }

  function showDiffTooltip(event, marker) {
    if (!els.chartTooltip) return;
    const adjustmentColor = marker.adjustment > 0 ? COLORS.green : marker.adjustment < 0 ? COLORS.red : getThemeColors().muted;
    els.chartTooltip.innerHTML =
      `<strong>Diff epoch</strong> ${fmtInt(marker.epoch)}<br>` +
      `<strong>Difficulty</strong> ${fmtDifficulty(marker.difficulty)}<br>` +
      `<strong>Adjustment</strong> <span style="color:${adjustmentColor}">${fmtAdjustment(marker.adjustment)}</span>`;
    positionChartTooltip(event);
  }

  function showBlockTooltip(event, marker) {
    if (!els.chartTooltip) return;
    const row = marker.row;
    const ownerColor = isPatoshiRow(row) ? COLORS.patoshi : COLORS.other;
    const statusText = row.isSpent
      ? `Spent${Number.isFinite(row.spendingHeight) ? ` ${fmtInt(row.spendingHeight)}` : ""}`
      : "Unspent";
    els.chartTooltip.innerHTML =
      `<strong>Block</strong> ${fmtInt(row.height)}<br>` +
      `<strong>Date</strong> ${fmtDateTime(row.ms)}<br>` +
      `<strong>ExtraNonce</strong> ${fmtInt(row.extranonce)}<br>` +
      `<strong>Miner</strong> <span style="color:${ownerColor}">${isPatoshiRow(row) ? "Satoshi" : "Other"}</span><br>` +
      `<strong>Status</strong> ${statusText}`;
    positionChartTooltip(event);
  }

  function positionChartTooltip(event) {
    if (!els.chartTooltip) return;
    els.chartTooltip.style.display = "block";
    const pad = 10;
    const rect = els.chartTooltip.getBoundingClientRect();
    els.chartTooltip.style.left = `${clamp(event.clientX + 14, pad, window.innerWidth - rect.width - pad)}px`;
    els.chartTooltip.style.top = `${clamp(event.clientY + 14, pad, window.innerHeight - rect.height - pad)}px`;
  }

  function toggleExpandMode() {
    const expanded = !document.body.classList.contains("patoshi-dashboard-expanded");
    document.body.classList.toggle("patoshi-dashboard-expanded", expanded);
    if (els.expandBtn) {
      els.expandBtn.setAttribute("aria-pressed", String(expanded));
      els.expandBtn.setAttribute("aria-label", expanded ? "Shrink video layout" : "Expand video layout");
      els.expandBtn.setAttribute("title", expanded ? "Shrink video layout" : "Expand video layout");
    }
    window.parent?.postMessage({ type: "wsb-patoshi-pattern-dashboard-expanded", expanded }, window.location.origin);
    requestAnimationFrame(render);
  }

  function openSettingsPanel() {
    if (!els.settingsPanel) return;
    els.settingsPanel.classList.add("open");
    updateSettingsOptions();
    updateActiveButtons();
  }

  function renderExportProgress(progress = 0) {
    if (!els.downloadBtn) return;
    const pct = `${Math.max(0, Math.min(1, Number(progress) || 0)) * 100}%`;
    const existing = els.downloadBtn.querySelector(".date-range-export-progress");
    if (existing) {
      existing.style.setProperty("--date-range-export-progress", pct);
      return;
    }
    els.downloadBtn.classList.add("is-exporting");
    els.downloadBtn.disabled = false;
    els.downloadBtn.setAttribute("aria-label", "Cancel animation download");
    els.downloadBtn.setAttribute("title", "Cancel download");
    els.downloadBtn.innerHTML = [
      `<span class="date-range-export-progress" style="--date-range-export-progress: ${pct}" aria-hidden="true">`,
      '<span class="date-range-export-stop-square"></span>',
      "</span>",
    ].join("");
    if (els.downloadPanelBtn) {
      els.downloadPanelBtn.classList.add("is-stop-download");
      els.downloadPanelBtn.textContent = "Stop Download";
    }
  }

  function resetExportProgress() {
    if (els.downloadBtn) {
      els.downloadBtn.classList.remove("is-exporting", "is-canceling");
      els.downloadBtn.disabled = false;
      els.downloadBtn.setAttribute("aria-label", "Download window animation");
      els.downloadBtn.setAttribute("title", "Download animation");
      els.downloadBtn.textContent = "↓";
    }
    if (els.downloadPanelBtn) {
      els.downloadPanelBtn.classList.remove("is-stop-download");
      els.downloadPanelBtn.textContent = "Download Animation";
    }
  }

  function requestExportCancel() {
    if (!state.isExporting) return false;
    state.exportCancelRequested = true;
    els.downloadBtn?.classList.add("is-canceling");
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
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(padded.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  }

  function ebmlSizeBytes(size) {
    if (size < 0x7f) return Uint8Array.of(0x80 | size);
    if (size < 0x3fff) return Uint8Array.of(0x40 | (size >> 8), size & 0xff);
    if (size < 0x1fffff) return Uint8Array.of(0x20 | (size >> 16), (size >> 8) & 0xff, size & 0xff);
    if (size < 0x0fffffff) return Uint8Array.of(0x10 | (size >> 24), (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff);
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
    let length = byteLength || 1;
    if (!byteLength) {
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
      ebmlElement(0x258688, ebmlAscii("Patoshi Pattern")),
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
      } catch (_) {}
    }
    return null;
  }

  async function encodeExportWebM({ canvas: exportCanvas, settings, frameEnds }) {
    const encoderConfig = await getSupportedWebCodecsExportConfig(exportCanvas.width, exportCanvas.height, settings);
    if (!encoderConfig) return null;
    const encodedFrames = [];
    const frameDurationUs = Math.round(1000000 / EXPORT_FPS);
    let frameIndex = 0;
    let encodeError = null;
    const encoder = new VideoEncoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        encodedFrames.push({ timestamp: chunk.timestamp, type: chunk.type, data });
      },
      error: (error) => { encodeError = error; },
    });
    encoder.configure(encoderConfig.config);
    for (const endMs of frameEnds) {
      if (state.exportCancelRequested) break;
      drawExportFrame(exportCanvas, endMs, settings, { width: exportCanvas.width, height: exportCanvas.height });
      const frame = new VideoFrame(exportCanvas, {
        timestamp: frameIndex * frameDurationUs,
        duration: frameDurationUs,
      });
      encoder.encode(frame, { keyFrame: frameIndex % EXPORT_FPS === 0 });
      frame.close();
      if (encodeError) throw encodeError;
      frameIndex += 1;
      renderExportProgress(frameIndex / Math.max(1, frameEnds.length));
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
    return buildWebMBlob(encodedFrames, exportCanvas.width, exportCanvas.height, EXPORT_FPS, encoderConfig.webmCodecId);
  }

  function downloadExportBlob(blob, settings) {
    const a = document.createElement("a");
    const start = fmtDateTime(state.animationStartMs, false).replace(/[^0-9A-Za-z]+/g, "_");
    const end = fmtDateTime(state.animationEndMs, false).replace(/[^0-9A-Za-z]+/g, "_");
    a.href = URL.createObjectURL(blob);
    a.download = `patoshi_pattern_${start}_${end}_${settings.quality}p.webm`;
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
      normalizeExportSettings();
      const settings = getExportSettingsSnapshot();
      const { width, height } = getExportDimensions(settings);
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = width;
      exportCanvas.height = height;
      if (!exportCanvas.getContext("2d")) throw new Error("Export canvas context unavailable.");
      const frames = getExportFrameEndTimes(settings);
      try {
        const webmBlob = await encodeExportWebM({ canvas: exportCanvas, settings, frameEnds: frames });
        if (webmBlob && !state.exportCancelRequested) {
          renderExportProgress(1);
          downloadExportBlob(webmBlob, settings);
          return;
        }
        if (state.exportCancelRequested) return;
      } catch (error) {
        console.warn("Deterministic WebCodecs WebM export unavailable; falling back to recorder export.", error);
      }

      const paintExportFrame = (endMs) => drawExportFrame(exportCanvas, endMs, settings, { width, height });
      if (frames.length) paintExportFrame(frames[0]);
      let stream;
      try {
        stream = exportCanvas.captureStream(0);
      } catch (_) {
        stream = exportCanvas.captureStream(EXPORT_FPS);
      }
      let videoTrack = stream.getVideoTracks?.()[0] || null;
      if (!videoTrack || typeof videoTrack.requestFrame !== "function") {
        videoTrack?.stop?.();
        stream = exportCanvas.captureStream(EXPORT_FPS);
        videoTrack = stream.getVideoTracks?.()[0] || null;
      }
      const chunks = [];
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: getExportBitrate(settings) });
      recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      const done = new Promise((resolve) => { recorder.onstop = resolve; });
      renderExportProgress(0);
      recorder.start();
      const frameDurationMs = 1000 / EXPORT_FPS;
      let nextFrameAt = performance.now();
      for (let i = 0; i < frames.length; i += 1) {
        if (state.exportCancelRequested) break;
        paintExportFrame(frames[i]);
        if (typeof videoTrack?.requestFrame === "function") videoTrack.requestFrame();
        renderExportProgress((i + 1) / frames.length);
        nextFrameAt += frameDurationMs;
        await wait(Math.max(0, nextFrameAt - performance.now()));
      }
      if (recorder.state !== "inactive") recorder.stop();
      await done;
      if (state.exportCancelRequested) return;
      downloadExportBlob(new Blob(chunks, { type: "video/webm" }), settings);
    } catch (error) {
      console.error("Unable to export Patoshi animation:", error);
      window.alert("The animation export could not be completed in this browser.");
    } finally {
      if (recorder && recorder.state !== "inactive") {
        try { recorder.stop(); } catch {}
      }
      state.isExporting = false;
      state.exportCancelRequested = false;
      resetExportProgress();
      render();
    }
  }

  function handleChartPointerMove(event) {
    if (chartDrag) {
      canvas.classList.remove("target-pick-hover");
      hideChartTooltip();
      return;
    }
    if (patternBlockPickMode) {
      const marker = getNearestBlockMarkerAt(event);
      canvas.classList.toggle("target-pick-hover", !!marker);
    } else {
      canvas.classList.remove("target-pick-hover");
    }
    if (state.playing) {
      hideChartTooltip();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const nearestHit = (items) => items.reduce((best, item) => {
      const dx = px - item.x;
      const dy = py - item.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > item.r * item.r) return best;
      if (!best || distanceSquared < best.distanceSquared) return { item, distanceSquared };
      return best;
    }, null);
    const blockMarker = nearestHit(blockMarkerHitboxes)?.item;
    if (blockMarker) {
      showBlockTooltip(event, blockMarker);
      return;
    }
    const diffMarker = nearestHit(diffMarkerHitboxes)?.item;
    if (!diffMarker) {
      hideChartTooltip();
      return;
    }
    showDiffTooltip(event, diffMarker);
  }

  function getNearestBlockMarkerAt(event) {
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    return blockMarkerHitboxes.reduce((best, item) => {
      const dx = px - item.x;
      const dy = py - item.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > item.r * item.r) return best;
      if (!best || distanceSquared < best.distanceSquared) return { item, distanceSquared };
      return best;
    }, null)?.item || null;
  }

  function highlightBlockMarker(marker) {
    if (!marker?.row) return;
    setHighlightedBlock(marker.row, { source: "search", center: false });
  }

  function highlightAndCenterBlockMarker(marker) {
    if (!marker?.row) return;
    setHighlightedBlock(marker.row, { source: "search", center: true });
  }

  function openBlockInMempool(marker) {
    if (!marker?.row || !Number.isFinite(marker.row.height)) return;
    window.open(`https://mempool.space/block/${marker.row.height}`, "_blank", "noopener,noreferrer");
  }

  function handleChartClick(event) {
    if (suppressNextChartClick) {
      suppressNextChartClick = false;
      return;
    }
    if (patternBlockPickMode) {
      const marker = getNearestBlockMarkerAt(event);
      if (marker) addPatternBlockFromMarker(patternBlockPickMode, marker.row.height);
      return;
    }
    if (state.playing) return;
    const marker = getNearestBlockMarkerAt(event);
    if (!marker) return;
    if (blockClickTimer) window.clearTimeout(blockClickTimer);
    blockClickTimer = window.setTimeout(() => {
      blockClickTimer = 0;
      if (state.blockClickAction === "highlight") highlightBlockMarker(marker);
      else openBlockInMempool(marker);
    }, 220);
  }

  function eventIsOnXAxis(event) {
    if (!xAxisHitArea) return false;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return x >= xAxisHitArea.left
      && x <= xAxisHitArea.right
      && y >= xAxisHitArea.top
      && y <= xAxisHitArea.bottom;
  }

  function eventIsOnYAxis(event) {
    if (!yAxisHitArea) return false;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return x >= yAxisHitArea.left
      && x <= yAxisHitArea.right
      && y >= yAxisHitArea.top
      && y <= yAxisHitArea.bottom;
  }

  function handleChartDoubleClick(event) {
    if (blockClickTimer) {
      window.clearTimeout(blockClickTimer);
      blockClickTimer = 0;
    }
    if (!patternBlockPickMode) {
      const marker = getNearestBlockMarkerAt(event);
      if (marker) {
        event.preventDefault();
        event.stopPropagation();
        hideChartTooltip();
        if (state.playing) pauseAnimation();
        highlightAndCenterBlockMarker(marker);
        return;
      }
    }
    if (eventIsOnYAxis(event)) {
      event.preventDefault();
      event.stopPropagation();
      hideChartTooltip();
      resetYModeToRollingPatoshi();
      return;
    }
    if (!eventIsOnXAxis(event)) return;
    event.preventDefault();
    event.stopPropagation();
    hideChartTooltip();
    snapWindowToClosestPreset();
  }

  function toggleSpentRewardsPanel(event) {
    event?.stopPropagation?.();
    spentRewardsPanelOpen = !spentRewardsPanelOpen;
    clearPanelHighlightIfHiddenFromSpentRewards();
    saveState();
    renderSpentRewardsPanel();
    window.requestAnimationFrame(render);
  }

  function closeSpentRewardsPanel(event) {
    event?.stopPropagation?.();
    if (!spentRewardsPanelOpen) return;
    spentRewardsPanelOpen = false;
    clearPanelHighlightIfHiddenFromSpentRewards();
    saveState();
    renderSpentRewardsPanel();
    window.requestAnimationFrame(render);
  }

  function handleSpentRewardsPanelClick(event) {
    event.stopPropagation();
    if (!eventTargetIsInsideDropdown(event.target)) closeDropdowns();
    const item = event.target.closest(".spent-reward-item");
    if (!item) return;
    const height = Number(item.dataset.height);
    const row = rowsByHeight.get(height);
    if (!row) return;
    if (highlightedSpentBlockSource === "panel" && highlightedSpentBlockHeight === row.height) {
      clearHighlightedSpentReward();
      return;
    }
    setHighlightedBlock(row);
  }

  function parseBlockSearchHeight(value) {
    const clean = String(value || "").replace(/[^\d]/g, "");
    if (!clean) return null;
    const height = Number(clean);
    return Number.isInteger(height) && height >= 0 && height <= 99999 ? height : null;
  }

  function commitBlockSearch() {
    if (!els.blockSearchInput) return;
    window.clearTimeout(blockSearchHighlightTimer);
    blockSearchHighlightTimer = 0;
    const raw = els.blockSearchInput.value;
    if (!String(raw).trim()) {
      clearHighlightedSpentReward();
      return;
    }
    const height = parseBlockSearchHeight(raw);
    const row = Number.isFinite(height) ? rowsByHeight.get(height) : null;
    if (!row) {
      els.blockSearchInput.value = Number.isFinite(highlightedSpentBlockHeight) ? formatBlockSearchHeight(highlightedSpentBlockHeight) : "";
      syncBlockSearchClearButton();
      return;
    }
    setHighlightedBlock(row, { source: "search" });
  }

  function clearBlockSearch() {
    window.clearTimeout(blockSearchHighlightTimer);
    blockSearchHighlightTimer = 0;
    if (els.blockSearchInput) {
      els.blockSearchInput.value = "";
      els.blockSearchInput.focus();
    }
    syncBlockSearchClearButton();
    clearHighlightedSpentReward();
  }

  function scheduleBlockSearchHighlight(value) {
    window.clearTimeout(blockSearchHighlightTimer);
    blockSearchHighlightTimer = window.setTimeout(() => {
      blockSearchHighlightTimer = 0;
      const height = parseBlockSearchHeight(value);
      const row = Number.isFinite(height) ? rowsByHeight.get(height) : null;
      if (row) {
        setHighlightedBlock(row, { source: "search", updateInput: false });
      } else if (!value) {
        clearHighlightedSpentReward();
      }
    }, 35);
  }

  function shiftWindowBy(deltaMs) {
    const windowMs = getWindowMs();
    const timelineMin = getTimelineMinMs(windowMs);
    const safeEnd = clamp(state.endMs + deltaMs, state.animationStartMs, state.animationEndMs);
    const safeStart = Math.max(timelineMin, safeEnd - windowMs);
    setLastAdjustedHandle("range");
    setRange(safeStart, safeEnd);
  }

  function getChartCursorXRatio(event) {
    if (!chartPlotArea) return 0.5;
    const rect = canvas.getBoundingClientRect();
    const plotWidth = Math.max(1, chartPlotArea.right - chartPlotArea.left);
    const x = event.clientX - rect.left;
    return clamp((x - chartPlotArea.left) / plotWidth, 0, 1);
  }

  function setWindowMsAroundChartPoint(nextWindowMs, event) {
    const maxWindowMs = Math.max(getMinWindowMs(), maxMs - minMs);
    const windowMs = clamp(nextWindowMs, getMinWindowMs(), maxWindowMs);
    if (highlightedSpentBlockCentered) {
      const centeredRange = getRangeCenteredOnRow(getHighlightedSpentRow(), windowMs);
      if (centeredRange) {
        setLastAdjustedHandle("range");
        setRange(centeredRange.startMs, centeredRange.endMs);
        return;
      }
    }
    const currentWindowMs = Math.max(getMinWindowMs(), getWindowMs());
    const ratio = getChartCursorXRatio(event);
    const anchorMs = state.startMs + ratio * currentWindowMs;
    const timelineMin = getTimelineMinMs(windowMs);
    const upperBound = Math.min(maxMs, state.animationEndMs);
    let startMs = anchorMs - ratio * windowMs;
    let endMs = startMs + windowMs;

    if (endMs > upperBound) {
      endMs = upperBound;
      startMs = endMs - windowMs;
    }
    if (startMs < timelineMin) {
      startMs = timelineMin;
      endMs = startMs + windowMs;
    }
    if (endMs > upperBound) {
      endMs = upperBound;
      startMs = Math.max(timelineMin, endMs - windowMs);
    }

    setLastAdjustedHandle("range");
    setRange(startMs, endMs);
  }

  function handleChartWheel(event) {
    event.preventDefault();
    hideChartTooltip();
    if (eventIsOnYAxis(event) && event.deltaY) {
      const normalizedDelta = event.deltaMode === 1 ? event.deltaY * 18 : event.deltaY;
      const safeDelta = clamp(normalizedDelta, -600, 600);
      adjustYMaxCustomByFactor(Math.exp(safeDelta / 900));
      return;
    }
    const horizontalStep = getPlaybackFrameMs(4) * 4;
    if (event.deltaX) {
      const horizontalScale = event.deltaMode === 1 ? 8 : 120;
      const horizontalIntensity = Math.min(8, Math.abs(event.deltaX) / horizontalScale);
      const horizontalUnits = horizontalIntensity < 1
        ? horizontalIntensity * 0.45
        : Math.pow(horizontalIntensity, 1.35);
      if (horizontalUnits > 0.01) {
        shiftWindowBy(Math.sign(event.deltaX) * horizontalStep * horizontalUnits);
      }
    }
    if (!event.deltaY) return;
    const resizeThreshold = event.deltaMode === 1 ? 6 : 180;
    chartResizeWheelRemainder += event.deltaY;
    const resizeUnits = Math.trunc(chartResizeWheelRemainder / resizeThreshold);
    if (!resizeUnits) return;
    chartResizeWheelRemainder -= resizeUnits * resizeThreshold;
    const currentDays = Math.max(1, getWindowMs() / DAY);
    const dayStep = Math.max(0.1, Math.round(currentDays * 0.4) / 10) * Math.abs(resizeUnits);
    const nextDays = resizeUnits > 0
      ? currentDays + dayStep
      : currentDays - dayStep;
    setWindowMsAroundChartPoint(nextDays * DAY, event);
  }

  function startChartDrag(event) {
    if (event.button != null && event.button !== 0) return;
    if (patternBlockPickMode && getNearestBlockMarkerAt(event)) {
      event.preventDefault();
      hideChartTooltip();
      return;
    }
    event.preventDefault();
    hideChartTooltip();
    if (state.playing) pauseAnimation();
    if (eventIsOnYAxis(event)) {
      chartDrag = {
        kind: "y-axis",
        pointerId: event.pointerId,
        clientY: event.clientY,
        startYMax: getCurrentEffectiveYMax(),
        moved: false,
      };
      canvas.classList.add("dragging");
      try { canvas.setPointerCapture?.(event.pointerId); } catch (_) {}
      return;
    }
    chartDrag = {
      kind: "chart-pan",
      pointerId: event.pointerId,
      clientX: event.clientX,
      startMs: state.startMs,
      endMs: state.endMs,
      moved: false,
    };
    canvas.classList.add("dragging");
    try { canvas.setPointerCapture?.(event.pointerId); } catch (_) {}
  }

  function moveChartDrag(event) {
    if (!chartDrag) return;
    event.preventDefault();
    if (chartDrag.kind === "y-axis") {
      const dy = event.clientY - chartDrag.clientY;
      if (Math.abs(dy) > 3) chartDrag.moved = true;
      setYMaxCustomFromAxis(chartDrag.startYMax * Math.exp(dy / 260), {
        remember: false,
        persist: false,
      });
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const dx = event.clientX - chartDrag.clientX;
    if (Math.abs(dx) > 3) chartDrag.moved = true;
    const domainMs = Math.max(getMinWindowMs(), chartDrag.endMs - chartDrag.startMs);
    const shift = (-dx / Math.max(1, rect.width)) * domainMs;
    const windowMs = chartDrag.endMs - chartDrag.startMs;
    const timelineMin = getTimelineMinMs(windowMs);
    const minShift = state.animationStartMs - chartDrag.endMs;
    const maxShift = state.animationEndMs - chartDrag.endMs;
    const safeShift = clamp(shift, minShift, maxShift);
    const nextStart = Math.max(timelineMin, chartDrag.startMs + safeShift);
    setLastAdjustedHandle("range");
    setRange(nextStart, nextStart + windowMs);
  }

  function endChartDrag() {
    if (!chartDrag) return;
    const wasYAxisDrag = chartDrag.kind === "y-axis";
    suppressNextChartClick = chartDrag.moved;
    chartDrag = null;
    canvas.classList.remove("dragging");
    if (wasYAxisDrag) saveState();
    window.setTimeout(() => {
      suppressNextChartClick = false;
    }, 0);
  }

  function installEvents() {
    installUpdatedTimeZoneDropdown();
    installDropdown("countMetric", "countMetricDropdown", "countMetricDropdownValue", "countMetricDropdownMenu");
    installDropdown("yMode", "yModeDropdown", "yModeDropdownValue", "yModeDropdownMenu");
    installDropdown("spentRewardsSort", "spentRewardsSortDropdown", "spentRewardsSortDropdownValue", "spentRewardsSortDropdownMenu");
    els.yMaxInput?.addEventListener("input", () => {
      const parsed = Number(String(els.yMaxInput.value || "").replace(/,/g, ""));
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      state.yMaxCustom = normalizeYMaxCustom(parsed);
      const rounded = Math.max(1, Math.round(parsed));
      if (state.yMaxCustom !== rounded) {
        els.yMaxInput.value = formatYMaxInput(state.yMaxCustom);
      }
      state.yMode = "custom";
      if (els.yMode) els.yMode.value = "custom";
      syncDropdownLabels();
      render();
      saveState();
    });
    els.yMaxInput?.addEventListener("blur", () => {
      els.yMaxInput.value = formatYMaxInput(state.yMaxCustom);
    });
    els.yMaxInput?.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        els.yMaxInput.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        els.yMaxInput.value = formatYMaxInput(state.yMaxCustom);
        els.yMaxInput.blur();
      }
    });
    installDateTimePicker({
      button: els.startBtn,
      getMs: () => state.animationStartMs,
      setMs: (ms) => {
        setLastAdjustedHandle("start");
        setAnimationBounds(ms, state.animationEndMs, { syncWindow: true });
      },
    });
    installDateTimePicker({
      button: els.endBtn,
      getMs: () => state.animationEndMs,
      setMs: (ms) => {
        setLastAdjustedHandle("end");
        setAnimationBounds(state.animationStartMs, ms, { syncWindow: true });
      },
    });
    els.startInput.addEventListener("change", () => {
      const ms = fromInputValue(els.startInput.value);
      if (ms !== null) {
        setLastAdjustedHandle("start");
        setAnimationBounds(ms, state.animationEndMs, { syncWindow: true });
      }
    });
    els.endInput.addEventListener("change", () => {
      const ms = fromInputValue(els.endInput.value);
      if (ms !== null) {
        setLastAdjustedHandle("end");
        setAnimationBounds(state.animationStartMs, ms, { syncWindow: true });
      }
    });
    els.startRange.addEventListener("input", () => {
      setLastAdjustedHandle("start");
      if (state.playing) pauseAnimation();
      setAnimationBounds(Number(els.startRange.value), state.animationEndMs, { syncWindow: true });
    });
    els.endRange.addEventListener("input", () => {
      setLastAdjustedHandle("end");
      if (state.playing) pauseAnimation();
      setAnimationBounds(state.animationStartMs, Number(els.endRange.value), { syncWindow: true });
    });
    els.rangeLine?.addEventListener("pointermove", updateRangeCursor);
    els.rangeLine?.addEventListener("pointerleave", () => {
      if (!rangeDrag) els.rangeLine.style.setProperty("--range-cursor", "default");
    });
    els.rangeLine?.addEventListener("pointerdown", (event) => {
      if (isPointerOnRangeMarker(event, "start")) {
        startRangePointerDrag("start", event);
      } else if (isPointerOnRangeMarker(event, "end")) {
        startRangePointerDrag("end", event);
      } else if (isPointerOnWindowBar(event)) {
        startRangePointerDrag("range", event);
      } else if (isPointerInAnimationSpan(event)) {
        startRangePointerDrag("window-end", event);
      }
    }, { capture: true });
    els.startMarker?.addEventListener("pointerdown", (event) => startRangePointerDrag("start", event));
    els.endMarker?.addEventListener("pointerdown", (event) => startRangePointerDrag("end", event));
    els.rangeLine?.addEventListener("pointerdown", (event) => {
      if (event.target === els.startRange || event.target === els.endRange || event.target === els.startMarker || event.target === els.endMarker) return;
      const clickedMs = msFromRangePointer(event.clientX);
      if (clickedMs >= state.animationStartMs && clickedMs <= state.animationEndMs) startRangePointerDrag("window-end", event);
    });
    document.querySelectorAll("[data-range]").forEach((button) => {
      button.addEventListener("click", () => applyWindowPreset(button.dataset.range));
    });
    els.windowDaysInput?.addEventListener("focus", () => window.setTimeout(() => els.windowDaysInput.select(), 0));
    els.windowDaysInput?.addEventListener("click", () => window.setTimeout(() => els.windowDaysInput.select(), 0));
    els.windowDaysInput?.addEventListener("input", handleWindowDaysInput);
    els.windowDaysInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitWindowDaysInput();
        els.windowDaysInput.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        const fallback = Number.parseFloat(els.windowDaysInput.dataset.lastValidValue || "0");
        els.windowDaysInput.value = fallback > 0 ? formatWindowDaysValue(fallback) : "";
        els.windowDaysInput.blur();
      }
    });
    els.windowDaysInput?.addEventListener("change", commitWindowDaysInput);
    document.querySelectorAll("[data-hashrate-range]").forEach((button) => {
      button.addEventListener("click", () => applyHashrateWindowPreset(button.dataset.hashrateRange));
    });
    els.hashrateWindowInput?.addEventListener("focus", () => window.setTimeout(() => els.hashrateWindowInput.select(), 0));
    els.hashrateWindowInput?.addEventListener("click", () => window.setTimeout(() => els.hashrateWindowInput.select(), 0));
    els.hashrateWindowInput?.addEventListener("input", handleHashrateWindowInput);
    els.hashrateWindowInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitHashrateWindowInput();
        els.hashrateWindowInput.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        const fallback = Number.parseFloat(els.hashrateWindowInput.dataset.lastValidValue || "0");
        els.hashrateWindowInput.value = fallback > 0 ? formatWindowDaysValue(fallback) : "";
        els.hashrateWindowInput.blur();
      }
    });
    els.hashrateWindowInput?.addEventListener("change", commitHashrateWindowInput);
    els.hashrateWindowMatch?.addEventListener("change", () => setHashrateWindowMatch(els.hashrateWindowMatch.checked));
    els.playBtn.addEventListener("click", playAnimation);
    els.pauseBtn.addEventListener("click", pauseAnimation);
    els.stopBtn.addEventListener("click", stopAnimation);
    els.speedBtn.addEventListener("click", () => {
      state.speedIndex = (state.speedIndex + 1) % speeds.length;
      syncControls();
      saveState();
    });
    els.expandBtn?.addEventListener("click", toggleExpandMode);
    els.downloadBtn?.addEventListener("click", exportVideo);
    els.downloadPanelBtn?.addEventListener("click", exportVideo);
    els.filtersBtn?.addEventListener("click", toggleFiltersPanel);
    els.filtersClose?.addEventListener("click", (event) => {
      event.stopPropagation();
      setFiltersPanelOpen(false);
      closeDropdowns();
    });
    els.filtersPanel?.addEventListener("click", (event) => {
      if (!eventTargetIsInsideDropdown(event.target)) closeDropdowns();
      const keepsTargetPickActive = [
        els.patoshiIncludePickBtn,
        els.patoshiExcludePickBtn,
        els.patoshiIncludeInput,
        els.patoshiExcludeInput,
      ].some((element) => element?.contains(event.target));
      if (!keepsTargetPickActive) clearPatternBlockPickMode();
      event.stopPropagation();
    });
    els.spentRewardsPanelBtn?.addEventListener("click", toggleSpentRewardsPanel);
    els.spentRewardsPanelClose?.addEventListener("click", closeSpentRewardsPanel);
    els.spentRewardsPanel?.addEventListener("click", handleSpentRewardsPanelClick);
    els.spentRewardsList?.addEventListener("scroll", () => {
      syncSpentRewardsLoadMoreVisibility();
      tryLoadMoreSpentRewards();
    });
    els.blockSearchInput?.addEventListener("input", () => {
      const input = els.blockSearchInput;
      const selectionStart = input.selectionStart ?? input.value.length;
      const digitsBeforeCursor = input.value.slice(0, selectionStart).replace(/[^\d]/g, "").length;
      const formatted = formatBlockSearchHeight(input.value);
      if (input.value !== formatted) {
        input.value = formatted;
        let nextCursor = formatted.length;
        let seenDigits = 0;
        for (let index = 0; index < formatted.length; index += 1) {
          if (/\d/.test(formatted[index])) seenDigits += 1;
          if (seenDigits >= digitsBeforeCursor) {
            nextCursor = index + 1;
            break;
          }
        }
        input.setSelectionRange(nextCursor, nextCursor);
      }
      syncBlockSearchClearButton();
      scheduleBlockSearchHighlight(formatted);
    });
    els.blockSearchClear?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearBlockSearch();
    });
    els.blockSearchInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      commitBlockSearch();
    });
    els.blockSearchInput?.addEventListener("change", commitBlockSearch);
    els.settingsBtn.addEventListener("click", () => {
      els.settingsPanel.classList.toggle("open");
      updateSettingsOptions();
      updateActiveButtons();
    });
    document.addEventListener("click", (event) => {
      closeDropdowns();
      closeDatePicker();
      if (!els.settingsPanel.classList.contains("open")) return;
      if (els.settingsPanel.contains(event.target) || els.settingsBtn.contains(event.target) || els.downloadBtn?.contains(event.target)) return;
      els.settingsPanel.classList.remove("open");
      updateActiveButtons();
    });
    els.restoreBtn.addEventListener("click", () => {
      if (preResetStateSnapshot) restorePreviousDashboardState();
      else restoreDashboardDefaults();
    });
    els.copyLinkBtn.addEventListener("click", async () => {
      try {
        await copyDashboardLinkToClipboard(els.copyLinkBtn);
      } catch (error) {
        console.warn("Unable to copy Patoshi dashboard link.", error);
      }
    });
    document.querySelectorAll("[data-export-setting]").forEach((button) => {
      button.addEventListener("click", () => {
        normalizeExportSettings();
        const key = button.dataset.exportSetting;
        const value = button.dataset.value;
        state.exportSettings[key] = key === "quality" || key === "speed" ? Number(value) : value;
        updateSettingsOptions();
        saveState();
      });
    });
    els.downloadEndFrameHoldToggle?.addEventListener("change", () => {
      normalizeExportSettings();
      state.exportSettings.endFrameHold = !!els.downloadEndFrameHoldToggle.checked;
      updateSettingsOptions();
      saveState();
    });

    function setPatoshiPattern(value) {
      if (!["none", "original", "updated"].includes(value) || value === state.patoshiPattern) return;
      const previousPattern = state.patoshiPattern;
      const previousYMode = state.yMode;
      const frozenYMax = value === "none" && previousPattern !== "none" && ["rolling_patoshi", "window_patoshi"].includes(previousYMode)
        ? getCurrentEffectiveYMax()
        : null;
      state.patoshiPattern = value;
      if (frozenYMax !== null) {
        yAxisRestoreMode = previousYMode;
        state.yMaxCustom = normalizeYMaxCustom(frozenYMax);
        state.yMode = "custom";
        if (els.yMode) els.yMode.value = "custom";
      }
      syncControls();
      render();
      saveState();
    }

    els.patoshiPatternButtons.forEach((button) => {
      button.addEventListener("click", () => setPatoshiPattern(button.dataset.patoshiPattern));
    });

    els.blockClickButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const value = button.dataset.blockClickAction;
        if (!["mempool", "highlight"].includes(value) || value === state.blockClickAction) return;
        state.blockClickAction = value;
        syncControls();
        saveState();
      });
    });

    els.patoshiIncludePickBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setPatternBlockPickMode("include");
    });
    els.patoshiExcludePickBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setPatternBlockPickMode("exclude");
    });

    function rejectInvalidPatternBlockInput(event) {
      if (event.inputType && !event.inputType.startsWith("insert")) return;
      if (typeof event.data === "string" && event.data && !/^[\d,\s]+$/.test(event.data)) {
        event.preventDefault();
      }
    }

    function handlePatternBlocksInput(input, key) {
      const raw = input.value;
      const cursor = input.selectionStart ?? raw.length;
      const sanitized = sanitizePatternBlocksText(raw);
      if (sanitized !== raw) {
        const beforeCursor = sanitizePatternBlocksText(raw.slice(0, cursor));
        input.value = sanitized;
        const nextCursor = Math.min(beforeCursor.length, sanitized.length);
        input.setSelectionRange(nextCursor, nextCursor);
      }
      state[key] = input.value;
      syncPatternBlockSets();
      render();
      saveState();
    }

    [
      [els.patoshiIncludeInput, "patoshiIncludeBlocks"],
      [els.patoshiExcludeInput, "patoshiExcludeBlocks"],
    ].forEach(([input, key]) => {
      if (!input) return;
      input.addEventListener("beforeinput", rejectInvalidPatternBlockInput);
      input.addEventListener("input", () => handlePatternBlocksInput(input, key));
      input.addEventListener("paste", (event) => {
        event.preventDefault();
        const text = sanitizePatternBlocksText(event.clipboardData?.getData("text") || "");
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        input.setRangeText(text, start, end, "end");
        handlePatternBlocksInput(input, key);
      });
    });

    [
      "yMode", "countMetric", "spentRewardsSort", "spentRewardsPatoshiOnly", "showSpent", "markSpent", "showPatoshiLine", "showOrder",
    ].forEach((id) => {
      const el = els[id];
      if (!el) return;
      el.addEventListener(el.type === "checkbox" ? "change" : "input", () => {
        const previousYMode = state.yMode;
        state[id] = el.type === "checkbox" ? el.checked : el.value;
        if (id === "yMode") {
          if (state.yMode === "custom") {
            if (previousYMode !== "custom") yAxisRestoreMode = previousYMode;
            state.yMaxCustom = normalizeYMaxCustom(els.yMaxInput?.value || state.yMaxCustom);
          } else {
            yAxisRestoreMode = state.yMode;
          }
        }
        if (id === "spentRewardsSort" || id === "spentRewardsPatoshiOnly") {
          spentRewardsVisibleCount = SPENT_REWARDS_PAGE_SIZE;
          spentRewardsLoading = false;
          spentRewardsLoadGeneration += 1;
          if (els.spentRewardsList) els.spentRewardsList.scrollTop = 0;
          clearPanelHighlightIfHiddenFromSpentRewards();
          renderSpentRewardsPanel();
          render();
          saveState();
          return;
        }
        render();
        saveState();
      });
    });
    els.markerScaleMinus?.addEventListener("click", () => setMarkerScale(Math.round((state.markerScale - 0.1) * 10) / 10));
    els.markerScalePlus?.addEventListener("click", () => setMarkerScale(Math.round((state.markerScale + 0.1) * 10) / 10));
    els.markerScaleInput?.addEventListener("input", () => {
      const value = String(els.markerScaleInput.value || "").trim();
      if (value === "" || value === "." || value === "0.") return;
      setMarkerScale(value, { syncValue: false });
    });
    els.markerScaleInput?.addEventListener("change", () => setMarkerScale(els.markerScaleInput.value));
    canvas.addEventListener("mousemove", handleChartPointerMove);
    canvas.addEventListener("pointerdown", startChartDrag);
    canvas.addEventListener("pointermove", moveChartDrag);
    canvas.addEventListener("pointerup", endChartDrag);
    canvas.addEventListener("pointercancel", endChartDrag);
    canvas.addEventListener("click", handleChartClick);
    canvas.addEventListener("dblclick", handleChartDoubleClick);
    canvas.addEventListener("mouseleave", () => {
      canvas.classList.remove("target-pick-hover");
      hideChartTooltip();
    });
    canvas.addEventListener("wheel", handleChartWheel, { passive: false });
    window.addEventListener("resize", scheduleLayoutSync);
    if ("ResizeObserver" in window && els.rangeLine) {
      rangeResizeObserver = new ResizeObserver(scheduleLayoutSync);
      rangeResizeObserver.observe(els.rangeLine);
    }
    window.addEventListener("message", (event) => {
      const msg = event.data || {};
      if (msg.type === "quantum-dashboard-theme" && (msg.theme === "light" || msg.theme === "dark")) {
        document.documentElement.dataset.theme = msg.theme;
        theme = msg.theme;
        render();
        return;
      }
      if (msg.type === "wsb-patoshi-pattern-toggle-playback") {
        blurControlIfFocused();
        togglePlayback();
        requestAnimationFrame(blurControlIfFocused);
      }
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && els.filtersPanel?.classList.contains("open")) {
        closeDropdowns();
      }
      if ((event.key === " " || event.code === "Space") && !event.altKey && !event.ctrlKey && !event.metaKey && !isTextEntry(document.activeElement)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        blurControlIfFocused();
        togglePlayback();
        requestAnimationFrame(blurControlIfFocused);
        return;
      }
      if (event.key === "Escape" && (state.playing || state.paused)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        stopAnimation();
        return;
      }
      const isArrowLeft = event.key === "ArrowLeft";
      const isArrowRight = event.key === "ArrowRight";
      const isComma = event.key === "," || event.code === "Comma";
      const isPeriod = event.key === "." || event.code === "Period";
      if ((isArrowLeft || isArrowRight || isComma || isPeriod) && !event.altKey && !event.ctrlKey && !event.metaKey && !isTextEntry(document.activeElement)) {
        if (state.playing || state.paused) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          blurControlIfFocused();
          const frameStep = getPlaybackFrameMs();
          const bigStep = frameStep * 300;
          let delta = 0;
          if (isArrowRight) delta = bigStep;
          else if (isArrowLeft) delta = -bigStep;
          else if (isPeriod) delta = frameStep;
          else if (isComma) delta = -frameStep;
          const minShift = state.animationStartMs - state.endMs;
          const maxShift = state.animationEndMs - state.endMs;
          const safeShift = clamp(delta, minShift, maxShift);
          setLastAdjustedHandle("range");
          setRange(state.startMs + safeShift, state.endMs + safeShift);
          if (isArrowRight && state.playing && safeShift === maxShift) pauseAnimation();
          requestAnimationFrame(blurControlIfFocused);
          return;
        }
        if (!isArrowLeft && !isArrowRight) return;
        if (lastAdjustedHandle !== "start" && lastAdjustedHandle !== "end" && lastAdjustedHandle !== "range") return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        blurControlIfFocused();
        const step = lastAdjustedHandle === "range" ? getPlaybackFrameMs() : HOUR;
        nudgeLastAdjustedHandle(event.key === "ArrowRight" ? step : -step);
        requestAnimationFrame(blurControlIfFocused);
      }
    }, true);
  }

  async function init() {
    const hasSavedState = loadState();
    installEvents();
    const [csvText, metaText] = await Promise.all([
      fetch(DATA_URL, { cache: "no-store" }).then((r) => r.text()),
      fetch(META_URL, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ]);
    rows = parseCsv(csvText);
    maxDatasetExtraNonce = getMaxDatasetExtraNonce();
    state.yMaxCustom = normalizeYMaxCustom(state.yMaxCustom);
    rowsByHeight = new Map(rows.map((row) => [row.height, row]));
    if (Number.isFinite(highlightedSpentBlockHeight) && !rowsByHeight.has(highlightedSpentBlockHeight)) {
      highlightedSpentBlockHeight = null;
      highlightedSpentBlockSource = null;
      highlightedSpentBlockCentered = false;
      saveState();
    }
    metadata = metaText;
    dataSignature = getDataSignature(metadata);
    updateUpdatedKpi();
    minMs = rows[0].ms;
    maxMs = rows[rows.length - 1].ms;
    if (pendingShareState) {
      const shared = pendingShareState;
      applyDefaultState();
      Object.assign(state, shared);
      spentRewardsPanelOpen = !!shared.sidePanelOpen;
      const sharedHighlightedHeight = Number(shared.highlightedSpentBlockHeight);
      highlightedSpentBlockHeight = Number.isFinite(sharedHighlightedHeight) ? sharedHighlightedHeight : null;
      highlightedSpentBlockSource = Number.isFinite(highlightedSpentBlockHeight)
        ? (shared.highlightedSpentBlockSource === "search" ? "search" : "panel")
        : null;
      highlightedSpentBlockCentered = Number.isFinite(highlightedSpentBlockHeight) && shared.highlightedSpentBlockCentered !== false;
      state.playing = false;
      state.paused = false;
      if (state.yMode === "fixed_2650") state.yMode = "custom";
      if (!["rolling_patoshi", "window_patoshi", "window_all", "custom"].includes(state.yMode)) state.yMode = "rolling_patoshi";
      state.yMaxCustom = normalizeYMaxCustom(state.yMaxCustom);
      state.hashrateWindowMatch = shared.hashrateWindowMatch !== false;
      state.hashrateWindowDays = normalizeHashrateWindowDays(shared.hashrateWindowDays);
      if (!["updated", "original", "none"].includes(state.patoshiPattern)) state.patoshiPattern = "updated";
      if (!["latest_spent", "earliest_spent", "latest_height", "earliest_height"].includes(state.spentRewardsSort)) {
        state.spentRewardsSort = "latest_spent";
      }
      state.spentRewardsPatoshiOnly = !!shared.spentRewardsPatoshiOnly;
      if (!["mempool", "highlight"].includes(state.blockClickAction)) state.blockClickAction = "mempool";
      state.patoshiIncludeBlocks = sanitizePatternBlocksText(state.patoshiIncludeBlocks);
      state.patoshiExcludeBlocks = sanitizePatternBlocksText(state.patoshiExcludeBlocks);
      syncPatternBlockSets();
      state.showPatoshiLine = state.showPatoshiLine !== false;
      if (typeof shared.updatedKpiTimeZone === "string" && shared.updatedKpiTimeZone.trim()) {
        updatedKpiTimeZone = shared.updatedKpiTimeZone.trim();
      }
      pendingShareState = null;
    } else if (!hasSavedState) {
      applyDefaultState();
    }
    if (Number.isFinite(highlightedSpentBlockHeight) && !rowsByHeight.has(highlightedSpentBlockHeight)) {
      highlightedSpentBlockHeight = null;
      highlightedSpentBlockSource = null;
      highlightedSpentBlockCentered = false;
    }
    const currentWindowMs = Math.max(getMinWindowMs(), state.endMs - state.startMs || getDefaultWindowMs());
    const timelineMin = getTimelineMinMs(currentWindowMs);
    const animationMin = getAnimationStartMinMs();
    state.animationStartMs = Number.isFinite(state.animationStartMs) ? clamp(state.animationStartMs, animationMin, maxMs) : animationMin;
    state.animationEndMs = Number.isFinite(state.animationEndMs) ? clamp(state.animationEndMs, animationMin, maxMs) : getDefaultAnimationEndMs();
    if (state.animationStartMs >= state.animationEndMs) {
      state.animationStartMs = animationMin;
      state.animationEndMs = getDefaultAnimationEndMs();
    }
    state.startMs = clamp(state.startMs, timelineMin, maxMs);
    state.endMs = clamp(state.endMs, timelineMin, maxMs);
    if (state.startMs >= state.endMs) {
      state.startMs = Math.max(timelineMin, state.endMs - getDefaultWindowMs());
    }
    if (state.endMs - state.startMs < getMinWindowMs()) {
      state.startMs = Math.max(timelineMin, state.endMs - getMinWindowMs());
      state.endMs = Math.min(maxMs, state.startMs + getMinWindowMs());
    }
    if (state.startMs < state.animationStartMs || state.endMs > state.animationEndMs) {
      const windowMs = getWindowMs();
      state.endMs = clamp(state.endMs, state.animationStartMs, state.animationEndMs);
      state.startMs = Math.max(getTimelineMinMs(windowMs), state.endMs - windowMs);
    }
    state.finalEndMs = state.animationEndMs;
    syncUpdatedTimeZoneSelect(updatedKpiTimeZone);
    els.loadingRing.style.display = "none";
    syncControls();
    renderSpentRewardsPanel();
    render();
    setupAutoRefreshChecks();
  }

  init().catch((error) => {
    console.error(error);
    els.loadingRing.style.display = "none";
    ctx.font = "16px IBM Plex Mono";
    ctx.fillStyle = "#ff9f1c";
    ctx.fillText("Unable to load Patoshi data", 24, 42);
  });
})();
