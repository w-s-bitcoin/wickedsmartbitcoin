(function () {
  const THEME_KEY = "quantum-research-dashboard-theme";
  const UOA_FILTERS_KEY = "uoa-dashboard-filters-v1";
  const DASHBOARD_TIME = window.WSBDashboardTime || null;
  const REDENOMINATION_EVENTS = {
    VES: [
      { date: "2018-05-29", ratio: 100000, ratioLabel: "100,000:1" },
      { date: "2018-08-20", ratio: 100000, ratioLabel: "100,000:1" },
      { date: "2021-10-01", ratio: 1000000, ratioLabel: "1,000,000:1" },
    ],
    BYN: [
      { date: "2016-07-01", ratio: 10000, ratioLabel: "10,000:1" },
    ],
  };
  const NOTABLE_EVENTS = {
    VES: [
      {
        date: "2013-02-19",
        label: "devaluation (Maduro regime)",
        devaluationEstimate: "estimated devaluation: ~65%",
      },
      {
        date: "2016-03-08",
        label: "devaluation announcement",
        devaluationEstimate: "estimated devaluation: ~70%",
      },
      {
        date: "2018-02-06",
        label: "devaluation (new market rate)",
        devaluationEstimate: "estimated devaluation: ~250,000%",
      },
      {
        date: "2018-08-20",
        label: "devaluation with 100,000:1 redenomination",
        devaluationEstimate: "estimated devaluation: ~50% + redenomination",
      },
    ],
    SDG: [
      {
        date: "2021-02-25",
        label: "official rate unification / managed-float reset",
        devaluationEstimate: "estimated devaluation: ~582%",
      },
    ],
  };
  const LOG_MIN_POSITIVE = 1e-300;
  const DEFAULT_RANGE_PLAYBACK_FPS = 60;

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
    updatedKpiValue: document.getElementById("updatedKpiValue"),
    blockHeightKpiValue: document.getElementById("blockHeightKpiValue"),
    pairKpiValue: document.getElementById("pairKpiValue"),
    primaryRankKpiValue: document.getElementById("primaryRankKpiValue"),
    secondaryRankKpiValue: document.getElementById("secondaryRankKpiValue"),
    startDateBtn: document.getElementById("startDateBtn"),
    endDateBtn: document.getElementById("endDateBtn"),
    rangeDaysLabel: document.getElementById("rangeDaysLabel"),
    dateRangePresets: document.getElementById("dateRangePresets"),
    dateRangePlaybackControls: document.getElementById("dateRangePlaybackControls"),
    dateRangePlayBtn: document.getElementById("dateRangePlayBtn"),
    dateRangePauseBtn: document.getElementById("dateRangePauseBtn"),
    dateRangeStopBtn: document.getElementById("dateRangeStopBtn"),
    dateRangeFpsTrigger: document.getElementById("dateRangeFpsTrigger"),
    dateRangeFpsMenu: document.getElementById("dateRangeFpsMenu"),
    startDateInput: document.getElementById("startDateInput"),
    endDateInput: document.getElementById("endDateInput"),
    dateRangeSliderWrap: document.getElementById("dateRangeSliderWrap"),
    dateRangeStartSlider: document.getElementById("dateRangeStartSlider"),
    dateRangeEndSlider: document.getElementById("dateRangeEndSlider"),
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
  const overlayClosers = new Set();
  let usdParityStartIso = "";
  let uoaPairs = null; // Metadata from uoa_pairs.json
  let fxRatesByDate = {}; // { "2026-05-08": { "EUR/USD": 1.176100 } }
  let availableCurrencies = ["BTC", "USD"]; // Will be populated from uoaPairs
  let lastPrimaryUoa = "BTC";
  let lastSecondaryUoa = "USD";
  let updatedKpiTimeZone = DASHBOARD_TIME?.getPreferredTimeZone?.() || "UTC";
  let refreshedAtText = "";
  const chartEventMarkersById = {
    usdBtcChart: [],
    btcUsdChart: [],
  };
  let chartEventTooltipEl = null;
  let dateRangeDragState = null;
  let dateRangePlaybackOutsidePointerHandler = null;
  let dateRangeFpsMenuOutsideHandler = null;
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

  function safeReadJson(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
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

  function shiftIsoByYearsPreservingDate(isoValue, yearDelta) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoValue || ""))) return "";
    const [yRaw, mRaw, dRaw] = isoValue.split("-");
    const sourceYear = Number(yRaw);
    const sourceMonth = Number(mRaw);
    const sourceDay = Number(dRaw);
    const targetYear = sourceYear + Number(yearDelta || 0);
    if (!Number.isFinite(targetYear)) return "";

    // Leap-day handling rule requested by user:
    // Feb 29 -> Feb 28 when target isn't leap, and vice versa when target is leap.
    if (sourceMonth === 2 && sourceDay === 29 && !isLeapYear(targetYear)) {
      return `${targetYear}-${String(sourceMonth).padStart(2, "0")}-28`;
    }
    if (sourceMonth === 2 && sourceDay === 28 && !isLeapYear(sourceYear) && isLeapYear(targetYear)) {
      return `${targetYear}-${String(sourceMonth).padStart(2, "0")}-29`;
    }

    const lastDay = new Date(Date.UTC(targetYear, sourceMonth, 0)).getUTCDate();
    const day = Math.min(sourceDay, lastDay);
    return `${targetYear}-${String(sourceMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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

  function getPresetDateIndices(presetKey, anchorEndIndex = null) {
    if (!allRows.length) return null;
    const maxIndex = Math.max(0, allRows.length - 1);
    const endIndex = Number.isFinite(anchorEndIndex) ? Math.max(0, Math.min(maxIndex, anchorEndIndex)) : maxIndex;
    const endIso = toIsoDate(allRows[endIndex].date);

    if (presetKey === "full") {
      return { startIndex: 0, endIndex: maxIndex };
    }

    if (presetKey === "ytd") {
      const year = endIso.slice(0, 4);
      const startIsoTarget = `${year}-01-01`;
      const startIndex = Math.max(0, Math.min(endIndex, getDateIndexOnOrAfter(startIsoTarget)));
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

    const startIsoTarget = shiftIsoByYearsPreservingDate(endIso, -years);
    let startIndex = getDateIndexOnOrAfter(startIsoTarget);
    if (startIndex < 0) startIndex = 0;
    startIndex = Math.min(startIndex, endIndex);
    return { startIndex, endIndex };
  }

  function updateRangePresetActiveState() {
    if (!el.dateRangePresets || !allRows.length) return;
    const buttons = Array.from(el.dateRangePresets.querySelectorAll(".date-range-preset-btn[data-range]"));
    if (!buttons.length) return;

    const startIso = String(el.startDateInput?.value || "").trim();
    const endIso = String(el.endDateInput?.value || "").trim();
    let startIndex = getDateIndexFromIso(startIso);
    let endIndex = getDateIndexFromIso(endIso);
    const maxIndex = Math.max(0, allRows.length - 1);
    if (startIndex < 0) startIndex = getDateIndexOnOrAfter(startIso);
    if (endIndex < 0) endIndex = getDateIndexOnOrBefore(endIso);
    if (startIndex < 0) startIndex = 0;
    if (endIndex < 0) endIndex = maxIndex;

    let activeKey = "";
    if (endIndex === maxIndex) {
      for (const btn of buttons) {
        const key = String(btn.dataset.range || "").toLowerCase();
        const preset = getPresetDateIndices(key, endIndex);
        if (!preset) continue;
        if (preset.startIndex === startIndex && preset.endIndex === endIndex) {
          activeKey = key;
          break;
        }
      }
    }

    buttons.forEach((btn) => {
      const isActive = String(btn.dataset.range || "").toLowerCase() === activeKey;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  function applyRangePreset(presetKey) {
    stopDateRangePlayback();
    if (!allRows.length || !el.startDateInput || !el.endDateInput) return;
    const todayIso = toIsoDate(new Date());
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

    el.startDateInput.value = toIsoDate(allRows[startIndex].date);
    el.endDateInput.value = todayIso;
    applyFilters();
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

  function getSelectedDateRangePlaybackFps() {
    const triggerFps = Number(el.dateRangeFpsTrigger?.dataset.fps);
    if (Number.isFinite(triggerFps) && triggerFps > 0) return triggerFps;
    return DEFAULT_RANGE_PLAYBACK_FPS;
  }

  function setDateRangePlaybackFps(nextFps) {
    const normalizedFps = Number.isFinite(Number(nextFps)) ? Number(nextFps) : DEFAULT_RANGE_PLAYBACK_FPS;
    if (el.dateRangeFpsTrigger) {
      el.dateRangeFpsTrigger.dataset.fps = String(normalizedFps);
      el.dateRangeFpsTrigger.textContent = `${normalizedFps} FPS`;
    }
    if (el.dateRangeFpsMenu) {
      const options = Array.from(el.dateRangeFpsMenu.querySelectorAll(".date-range-fps-option[data-fps]"));
      options.forEach((option) => {
        const optionFps = Number(option.dataset.fps);
        const isSelected = optionFps === normalizedFps;
        option.classList.toggle("is-selected", isSelected);
        option.setAttribute("aria-selected", isSelected ? "true" : "false");
      });
    }
    dateRangePlaybackState.fps = normalizedFps;
  }

  function closeDateRangeFpsMenu() {
    if (el.dateRangeFpsMenu) el.dateRangeFpsMenu.classList.remove("open");
    if (el.dateRangeFpsTrigger) {
      el.dateRangeFpsTrigger.classList.remove("is-open");
      el.dateRangeFpsTrigger.setAttribute("aria-expanded", "false");
    }
    if (dateRangeFpsMenuOutsideHandler) {
      document.removeEventListener("pointerdown", dateRangeFpsMenuOutsideHandler, true);
      dateRangeFpsMenuOutsideHandler = null;
    }
  }

  function openDateRangeFpsMenu() {
    if (!el.dateRangeFpsMenu || !el.dateRangeFpsTrigger) return;
    el.dateRangeFpsMenu.classList.add("open");
    el.dateRangeFpsTrigger.classList.add("is-open");
    el.dateRangeFpsTrigger.setAttribute("aria-expanded", "true");
    if (!dateRangeFpsMenuOutsideHandler) {
      dateRangeFpsMenuOutsideHandler = (event) => {
        const target = event.target;
        const inTrigger = target === el.dateRangeFpsTrigger || el.dateRangeFpsTrigger.contains(target);
        const inMenu = target === el.dateRangeFpsMenu || el.dateRangeFpsMenu.contains(target);
        if (inTrigger || inMenu) return;
        closeDateRangeFpsMenu();
      };
      document.addEventListener("pointerdown", dateRangeFpsMenuOutsideHandler, true);
    }
  }

  function toggleDateRangeFpsMenu() {
    if (!el.dateRangeFpsMenu) return;
    if (el.dateRangeFpsMenu.classList.contains("open")) {
      closeDateRangeFpsMenu();
      return;
    }
    openDateRangeFpsMenu();
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
    el.dateRangePauseBtn.disabled = !hasSession;
    el.dateRangePauseBtn.classList.toggle("is-paused", hasSession && !isPlaying);
  }

  function updateDateRangeStopButton() {
    if (!el.dateRangeStopBtn) return;
    el.dateRangeStopBtn.disabled = !dateRangePlaybackState.hasSession;
  }

  function bindDateRangePlaybackOutsidePointerCancel() {
    if (dateRangePlaybackOutsidePointerHandler) return;
    dateRangePlaybackOutsidePointerHandler = (event) => {
      if (!dateRangePlaybackState.isPlaying) return;
      const target = event.target;
      const isPauseButtonClick = (!!el.dateRangePlayBtn && (target === el.dateRangePlayBtn || el.dateRangePlayBtn.contains(target)))
        || (!!el.dateRangePauseBtn && (target === el.dateRangePauseBtn || el.dateRangePauseBtn.contains(target)));
      const isFpsDropdownClick = (el.dateRangeFpsTrigger && (target === el.dateRangeFpsTrigger || el.dateRangeFpsTrigger.contains(target)))
        || (el.dateRangeFpsMenu && (target === el.dateRangeFpsMenu || el.dateRangeFpsMenu.contains(target)));
      if (isPauseButtonClick || isFpsDropdownClick) return;

      event.preventDefault();
      event.stopPropagation();
      stopDateRangePlayback({ restoreOriginalRange: true });
    };
    document.addEventListener("pointerdown", dateRangePlaybackOutsidePointerHandler, true);
  }

  function unbindDateRangePlaybackOutsidePointerCancel() {
    if (!dateRangePlaybackOutsidePointerHandler) return;
    document.removeEventListener("pointerdown", dateRangePlaybackOutsidePointerHandler, true);
    dateRangePlaybackOutsidePointerHandler = null;
  }

  function pauseDateRangePlayback() {
    if (dateRangePlaybackState.rafId) {
      cancelAnimationFrame(dateRangePlaybackState.rafId);
    }
    unbindDateRangePlaybackOutsidePointerCancel();
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

    if (shouldRestore && Number.isFinite(restoreStartIndex) && Number.isFinite(restoreEndIndex)) {
      setDateRangeByIndices(restoreStartIndex, restoreEndIndex);
    }

    updateDateRangePlayButton();
    updateDateRangePauseButton();
    updateDateRangeStopButton();
  }

  function setDateRangeByIndices(startIndex, endIndex) {
    if (!allRows.length) return false;
    const maxIndex = Math.max(0, allRows.length - 1);
    let safeStart = Number.isFinite(startIndex) ? Math.round(startIndex) : 0;
    let safeEnd = Number.isFinite(endIndex) ? Math.round(endIndex) : maxIndex;
    safeStart = Math.max(0, Math.min(maxIndex, safeStart));
    safeEnd = Math.max(0, Math.min(maxIndex, safeEnd));

    if (maxIndex >= 1 && safeStart >= safeEnd) {
      if (safeStart >= maxIndex) {
        safeStart = Math.max(0, maxIndex - 1);
        safeEnd = maxIndex;
      } else {
        safeEnd = Math.min(maxIndex, safeStart + 1);
      }
    }

    if (el.dateRangeStartSlider) el.dateRangeStartSlider.value = String(safeStart);
    if (el.dateRangeEndSlider) el.dateRangeEndSlider.value = String(safeEnd);
    updateDateRangeSliderFill(safeStart, safeEnd, maxIndex);
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

    if (!Number.isFinite(dateRangePlaybackState.targetEndIndex) || dateRangePlaybackState.targetEndIndex < 1) {
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
    if (!Number.isFinite(currentEndIndex)) currentEndIndex = 1;

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
    
    const maxIndex = Math.max(0, allRows.length - 1);
    if (maxIndex < 1) return;

    if (!dateRangePlaybackState.hasSession) {
      const currentStartIso = String(el.startDateInput?.value || "").trim();
      const currentEndIso = String(el.endDateInput?.value || "").trim();
      let startIndex = getDateIndexFromIso(currentStartIso);
      let targetEndIndex = getDateIndexFromIso(currentEndIso);
      if (startIndex < 0) startIndex = Number(el.dateRangeStartSlider?.value);
      if (targetEndIndex < 0) targetEndIndex = Number(el.dateRangeEndSlider?.value);
      if (!Number.isFinite(startIndex)) startIndex = 0;
      if (!Number.isFinite(targetEndIndex)) targetEndIndex = maxIndex;
      startIndex = Math.max(0, Math.min(maxIndex, startIndex));
      targetEndIndex = Math.max(0, Math.min(maxIndex, targetEndIndex));

      if (targetEndIndex <= startIndex) return;

      const playbackEndStartIndex = Math.min(targetEndIndex, startIndex + 1);
      const selectedFps = getSelectedDateRangePlaybackFps();

      setDateRangeByIndices(startIndex, playbackEndStartIndex);
      dateRangePlaybackState.hasSession = true;
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
      if (resumeEndIndex >= dateRangePlaybackState.targetEndIndex) return;
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
    unbindDateRangePlaybackOutsidePointerCancel();
  }

  function toggleDateRangePlayback() {
    if (!allRows.length) return;
    if (dateRangePlaybackState.isPlaying) {
      pauseDateRangePlayback();
      return;
    }

    const maxIndex = Math.max(0, allRows.length - 1);
    if (maxIndex < 1) return;

    if (!dateRangePlaybackState.hasSession) {
      const currentStartIso = String(el.startDateInput?.value || "").trim();
      const currentEndIso = String(el.endDateInput?.value || "").trim();
      let startIndex = getDateIndexFromIso(currentStartIso);
      let targetEndIndex = getDateIndexFromIso(currentEndIso);
      if (startIndex < 0) startIndex = Number(el.dateRangeStartSlider?.value);
      if (targetEndIndex < 0) targetEndIndex = Number(el.dateRangeEndSlider?.value);
      if (!Number.isFinite(startIndex)) startIndex = 0;
      if (!Number.isFinite(targetEndIndex)) targetEndIndex = maxIndex;
      startIndex = Math.max(0, Math.min(maxIndex, startIndex));
      targetEndIndex = Math.max(0, Math.min(maxIndex, targetEndIndex));

      if (targetEndIndex <= startIndex) return;

      const playbackEndStartIndex = Math.min(targetEndIndex, startIndex + 1);
      const selectedFps = getSelectedDateRangePlaybackFps();

      setDateRangeByIndices(startIndex, playbackEndStartIndex);
      dateRangePlaybackState.hasSession = true;
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
      if (resumeEndIndex >= dateRangePlaybackState.targetEndIndex) return;
      setDateRangeByIndices(dateRangePlaybackState.startIndex, resumeEndIndex);
    }

    dateRangePlaybackState.isPlaying = true;
    dateRangePlaybackState.rafId = 0;
    dateRangePlaybackState.lastTimestampMs = 0;
    dateRangePlaybackState.accumulatedMs = 0;
    updateDateRangePlayButton();
    updateDateRangeStopButton();
    bindDateRangePlaybackOutsidePointerCancel();
    dateRangePlaybackState.rafId = requestAnimationFrame(stepDateRangePlayback);
  }

  function stopAndResetDateRangePlayback() {
    stopDateRangePlayback({ restoreOriginalRange: true });
  }

  function bindDateRangePlaybackFpsButtons() {
    if (el.dateRangeFpsTrigger && el.dateRangeFpsTrigger.dataset.bound !== "1") {
      el.dateRangeFpsTrigger.dataset.bound = "1";
      el.dateRangeFpsTrigger.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleDateRangeFpsMenu();
      });
    }

    if (el.dateRangeFpsMenu) {
      const options = Array.from(el.dateRangeFpsMenu.querySelectorAll(".date-range-fps-option[data-fps]"));
      options.forEach((option) => {
        if (option.dataset.bound === "1") return;
        option.dataset.bound = "1";
        option.addEventListener("click", () => {
          const nextFps = Number(option.dataset.fps);
          if (!Number.isFinite(nextFps) || nextFps <= 0) return;
          setDateRangePlaybackFps(nextFps);
          persistFilters();
          closeDateRangeFpsMenu();
        });
      });
    }

    setDateRangePlaybackFps(getSelectedDateRangePlaybackFps());
  }

  function getFallbackSecondary(primary) {
    const preferred = ["USD", "EUR", "BTC"];
    for (const code of preferred) {
      if (code !== primary && availableCurrencies.includes(code)) return code;
    }
    return availableCurrencies.find((code) => code !== primary) || "USD";
  }

  function loadStoredFilters(bounds) {
    const stored = safeReadJson(UOA_FILTERS_KEY) || {};

    const validPrimary = availableCurrencies.includes(stored.primaryUoa) ? stored.primaryUoa : "BTC";
    const validSecondaryCandidate = availableCurrencies.includes(stored.secondaryUoa)
      ? stored.secondaryUoa
      : getFallbackSecondary(validPrimary);
    const validSecondary = validSecondaryCandidate === validPrimary
      ? getFallbackSecondary(validPrimary)
      : validSecondaryCandidate;

    const defaultStart = usdParityStartIso || bounds.min;
    const startDate = clampIsoDate(stored.startDate, bounds.min, bounds.max, defaultStart);
    const endDate = clampIsoDate(stored.endDate, bounds.min, bounds.max, bounds.max);
    const scale = stored.scaleMode === "linear" ? "linear" : "log";
    const orderMode = ORDER_MODES.includes(stored.orderMode) ? stored.orderMode : "alpha-asc";
    const smoothVesRedenom = stored.smoothVesRedenom === false ? false : true;
    const storedPlaybackFps = Number(stored.playbackFps);
    const playbackFps = Number.isFinite(storedPlaybackFps) && storedPlaybackFps > 0
      ? storedPlaybackFps
      : DEFAULT_RANGE_PLAYBACK_FPS;

    return {
      startDate,
      endDate,
      primaryUoa: validPrimary,
      secondaryUoa: validSecondary,
      scaleMode: scale,
      orderMode,
      smoothVesRedenom,
      playbackFps,
    };
  }

  function persistFilters() {
    try {
      const payload = {
        startDate: el.startDateInput?.value || "",
        endDate: el.endDateInput?.value || "",
        primaryUoa: el.primaryUoaSelect?.value || "",
        secondaryUoa: el.secondaryUoaSelect?.value || "",
        scaleMode: el.scaleSelect?.value === "linear" ? "linear" : "log",
        orderMode: ORDER_MODES.includes(el.orderBySelect?.value) ? el.orderBySelect.value : "alpha-asc",
        smoothVesRedenom: !!el.vesRedenomAdjustToggle?.checked,
        playbackFps: getSelectedDateRangePlaybackFps(),
      };
      localStorage.setItem(UOA_FILTERS_KEY, JSON.stringify(payload));
    } catch (_) {
      // Ignore storage write errors (private mode / quotas).
    }
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
    },
    {
      selectId: "secondaryUoaSelect",
      dropdownId: "secondaryUoaDropdown",
      triggerId: "secondaryUoaDropdownTrigger",
      menuId: "secondaryUoaDropdownMenu",
      valueId: "secondaryUoaValue",
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

    syncAllDropdowns();
  }

  function getActiveOrderMode() {
    const selected = el.orderBySelect?.value;
    return ORDER_MODES.includes(selected) ? selected : "alpha-asc";
  }

  function getLatestCurrencySatsValues() {
    const rowPool = rows.length ? rows : allRows;
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
      XAU: "g gold",
      XAG: "g silver",
      XPT: "g platinum",
      XPD: "g palladium",
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

  function formatGramAmount(gramsValue) {
    if (!Number.isFinite(gramsValue) || gramsValue <= 0) return "0 g";

    let decimals;
    if (gramsValue >= 100) {
      decimals = 2;
    } else if (gramsValue >= 1) {
      decimals = 4;
    } else {
      decimals = Math.min(8, Math.max(4, Math.ceil(-Math.log10(gramsValue)) + 2));
    }

    let txt = gramsValue.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

    if (txt.includes(".")) {
      txt = txt.replace(/0+$/, "");
      if (txt.endsWith(".")) txt = txt.slice(0, -1);
    }

    return `${txt} g`;
  }

  function formatCompactGramYAxisLabel(gramsValue) {
    if (!Number.isFinite(gramsValue) || gramsValue < 0) return "0";
    if (gramsValue === 0) return "0 g";

    let formatted;
    if (gramsValue >= 1000000000000) {
      const t = gramsValue / 1000000000000;
      formatted = t >= 10 ? `${t.toFixed(0)}T` : `${t.toFixed(1)}T`;
    } else if (gramsValue >= 1000000000) {
      const b = gramsValue / 1000000000;
      formatted = b >= 10 ? `${b.toFixed(0)}B` : `${b.toFixed(1)}B`;
    } else if (gramsValue >= 1000000) {
      const m = gramsValue / 1000000;
      formatted = m >= 10 ? `${m.toFixed(0)}M` : `${m.toFixed(1)}M`;
    } else if (gramsValue >= 100000) {
      const k = gramsValue / 1000;
      formatted = k >= 100 ? `${k.toFixed(0)}k` : `${k.toFixed(1)}k`;
    } else if (gramsValue >= 1000) {
      const k = gramsValue / 1000;
      const kDecimals = k < 10 ? 2 : 1;
      formatted = `${k.toFixed(kDecimals)}k`;
    } else if (gramsValue >= 100) {
      formatted = `${Math.round(gramsValue)}`;
    } else if (gramsValue >= 10) {
      formatted = `${gramsValue.toFixed(1)}`;
    } else if (gramsValue >= 1) {
      formatted = `${gramsValue.toFixed(2)}`;
    } else {
      if (gramsValue > 0 && gramsValue < 1e-8) {
        formatted = gramsValue
          .toExponential(2)
          .replace("e+", "e")
          .replace(/e-0+/, "e-");
      } else {
        let decimals = 4;
        if (gramsValue < 0.01) {
          decimals = 5;
        }
        if (gramsValue < 0.001) {
          decimals = Math.min(24, Math.max(6, -Math.floor(Math.log10(gramsValue)) + 3));
        }
        formatted = `${gramsValue.toFixed(decimals)}`;
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

    return `${formatted} g`;
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
        .filter((event) => event.date && Number.isFinite(event.ratio) && event.ratio > 1)
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
    DROPDOWNS.forEach(({ dropdownId, menuId }) => {
      const dropdown = document.getElementById(dropdownId);
      const menu = document.getElementById(menuId);
      if (!dropdown || !menu) return;
      if (exceptDropdown && dropdown === exceptDropdown) return;
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
    if (!dropdown || !valueEl || !Array.isArray(options) || !options.length) return;

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

    const longestWidth = options.reduce((max, option) => {
      const label = option.textContent || "";
      return Math.max(max, ctx.measureText(label).width);
    }, 0);

    const contentPad = parseFloat(styles.getPropertyValue("--dca-dropdown-content-pad")) || 10;
    const arrowGap = parseFloat(styles.getPropertyValue("--dca-dropdown-arrow-gap")) || 18;
    const extraBuffer = 2;
    // right padding already includes the caret area via --dca-dropdown-arrow-gap
    const desired = Math.ceil(longestWidth + contentPad + arrowGap + extraBuffer);
    const maxAllowed = Math.max(120, window.innerWidth - 48);

    dropdown.style.minWidth = `${Math.min(desired, maxAllowed)}px`;
  }

  function syncDropdownMenu(config) {
    const select = document.getElementById(config.selectId);
    const menu = document.getElementById(config.menuId);
    const valueEl = config.valueId ? document.getElementById(config.valueId) : null;
    if (!select || !menu) return;

    const selectedOption = select.options[select.selectedIndex];
    if (valueEl) valueEl.textContent = selectedOption ? selectedOption.textContent : "";

    let optionsToShow = Array.from(select.options);
    // Secondary dropdown should not offer the currently selected primary.
    if (config.selectId === "secondaryUoaSelect") {
      const primaryValue = el.primaryUoaSelect?.value;
      if (primaryValue) {
        optionsToShow = optionsToShow.filter((opt) => opt.value !== primaryValue);
      }
    }

    autoSizeDropdown(config, optionsToShow);

    menu.innerHTML = optionsToShow
      .map((option) => {
        const selectedClass = option.value === select.value ? " dca-option-btn--selected" : "";
        return `<button type=\"button\" class=\"dca-option-btn${selectedClass}\" data-value=\"${option.value}\">${option.textContent || ""}</button>`;
      })
      .join("");
  }

  function populateUpdatedTimeZoneSelect() {
    const select = document.getElementById("updatedTimeZoneSelect");
    if (!select) return;

    const options = DASHBOARD_TIME?.getTimeZoneOptions?.() || [{ value: "UTC", label: "UTC" }];
    select.innerHTML = options
      .map((option) => `<option value="${option.value}">${option.label}</option>`)
      .join("");

    const preferred = DASHBOARD_TIME?.getPreferredTimeZone?.() || "UTC";
    const hasPreferred = options.some((option) => option.value === preferred);
    updatedKpiTimeZone = hasPreferred ? preferred : (options[0]?.value || "UTC");
    select.value = updatedKpiTimeZone;
  }

  function formatUpdatedKpiTimestamp(dateValue) {
    if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return "--";
    if (!DASHBOARD_TIME?.formatUtcTimestamp) return fmtDate(dateValue);
    const formatted = DASHBOARD_TIME.formatUtcTimestamp(dateValue.toISOString(), updatedKpiTimeZone || "UTC");
    return formatted?.text || fmtDate(dateValue);
  }

  function formatUpdatedDisplayText(rawText) {
    const cleaned = String(rawText || "").trim();
    if (!cleaned) return "--";
    if (!DASHBOARD_TIME?.formatUtcTimestamp) return cleaned;
    const formatted = DASHBOARD_TIME.formatUtcTimestamp(cleaned, updatedKpiTimeZone || "UTC");
    return formatted?.text || cleaned;
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

      trigger.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const willOpen = !menu.classList.contains("open");
        closeAllOverlays();
        closeAllDropdowns(willOpen ? dropdown : null);
        setDropdownOpen(dropdown, menu, willOpen);
      });

      menu.addEventListener("click", (event) => {
        const btn = event.target.closest(".dca-option-btn");
        if (!btn) return;
        const nextValue = String(btn.dataset.value || "");
        if (select.value !== nextValue) {
          select.value = nextValue;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        syncDropdownMenu(config);
        setDropdownOpen(dropdown, menu, false);
      });
    });

    syncAllDropdowns();

    if (dropdownGlobalListenersBound) return;
    dropdownGlobalListenersBound = true;

    document.addEventListener("click", (event) => {
      const target = event.target;
      DROPDOWNS.forEach(({ dropdownId, menuId }) => {
        const dropdown = document.getElementById(dropdownId);
        const menu = document.getElementById(menuId);
        if (!dropdown || !menu) return;
        if (dropdown.contains(target) || menu.contains(target)) return;
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
    if (el.startDateBtn) {
      el.startDateBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${fmtDatePickerLabel(el.startDateInput?.value || "")}`;
    }
    if (el.endDateBtn) {
      el.endDateBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${fmtDatePickerLabel(el.endDateInput?.value || "")}`;
    }
    if (el.rangeDaysLabel) {
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
      const daysText = days > 0 ? String(days) : "--";
      el.rangeDaysLabel.innerHTML = `Range <span class="range-days-value">${daysText} Days</span>`;
    }
    updateRangePresetActiveState();
    syncDateRangeSlidersFromInputs();
  }

  function getDateIndexFromIso(isoValue) {
    if (!isoValue || !allRows.length) return -1;
    for (let i = 0; i < allRows.length; i += 1) {
      if (toIsoDate(allRows[i].date) === isoValue) return i;
    }
    return -1;
  }

  function updateDateRangeSliderFill(startIndex, endIndex, maxIndex) {
    if (!el.dateRangeSliderWrap) return;
    const safeMax = Math.max(1, maxIndex);
    const startPct = Math.max(0, Math.min(100, (startIndex / safeMax) * 100));
    const endPct = Math.max(0, Math.min(100, (endIndex / safeMax) * 100));
    el.dateRangeSliderWrap.style.setProperty("--slider-start", `${startPct}%`);
    el.dateRangeSliderWrap.style.setProperty("--slider-end", `${endPct}%`);
  }

  function syncDateRangeSlidersFromInputs() {
    if (!el.dateRangeStartSlider || !el.dateRangeEndSlider || !allRows.length) return;
    const maxIndex = Math.max(0, allRows.length - 1);
    const startIso = el.startDateInput?.value || toIsoDate(allRows[0].date);
    const endIso = el.endDateInput?.value || toIsoDate(allRows[maxIndex].date);

    let startIndex = getDateIndexFromIso(startIso);
    let endIndex = getDateIndexFromIso(endIso);
    if (startIndex < 0) startIndex = 0;
    if (endIndex < 0) endIndex = maxIndex;
    if (maxIndex >= 1 && startIndex >= endIndex) {
      if (startIndex >= maxIndex) {
        startIndex = Math.max(0, maxIndex - 1);
        endIndex = maxIndex;
      } else {
        endIndex = Math.min(maxIndex, startIndex + 1);
      }
    } else if (startIndex > endIndex) {
      startIndex = endIndex;
    }

    el.dateRangeStartSlider.min = "0";
    el.dateRangeStartSlider.max = String(maxIndex);
    el.dateRangeEndSlider.min = "0";
    el.dateRangeEndSlider.max = String(maxIndex);
    el.dateRangeStartSlider.value = String(startIndex);
    el.dateRangeEndSlider.value = String(endIndex);

    updateDateRangeSliderFill(startIndex, endIndex, maxIndex);
  }

  function handleDateRangeSliderInput(changed) {
    stopDateRangePlayback();
    if (!el.dateRangeStartSlider || !el.dateRangeEndSlider || !allRows.length) return;
    const maxIndex = Math.max(0, allRows.length - 1);
    let startIndex = Number(el.dateRangeStartSlider.value);
    let endIndex = Number(el.dateRangeEndSlider.value);

    if (!Number.isFinite(startIndex)) startIndex = 0;
    if (!Number.isFinite(endIndex)) endIndex = maxIndex;

    if (maxIndex >= 1) {
      if (changed === "start" && startIndex >= endIndex) {
        startIndex = Math.max(0, endIndex - 1);
        el.dateRangeStartSlider.value = String(startIndex);
      }
      if (changed === "end" && endIndex <= startIndex) {
        endIndex = Math.min(maxIndex, startIndex + 1);
        el.dateRangeEndSlider.value = String(endIndex);
      }
      if (startIndex >= endIndex) {
        if (startIndex >= maxIndex) {
          startIndex = Math.max(0, maxIndex - 1);
          endIndex = maxIndex;
        } else {
          endIndex = Math.min(maxIndex, startIndex + 1);
        }
        el.dateRangeStartSlider.value = String(startIndex);
        el.dateRangeEndSlider.value = String(endIndex);
      }
    } else {
      startIndex = 0;
      endIndex = maxIndex;
      el.dateRangeStartSlider.value = String(startIndex);
      el.dateRangeEndSlider.value = String(endIndex);
    }

    updateDateRangeSliderFill(startIndex, endIndex, maxIndex);

    const startIso = toIsoDate(allRows[startIndex].date);
    const endIso = toIsoDate(allRows[endIndex].date);
    if (el.startDateInput) el.startDateInput.value = startIso;
    if (el.endDateInput) el.endDateInput.value = endIso;
    applyFilters();
  }

  function beginDateRangeSegmentDrag(event) {
    stopDateRangePlayback();
    if (!el.dateRangeSliderWrap || !el.dateRangeStartSlider || !el.dateRangeEndSlider || !allRows.length) return;
    if (event.button !== 0) return;

    const maxIndex = Math.max(0, allRows.length - 1);
    if (maxIndex < 1) return;

    const wrapRect = el.dateRangeSliderWrap.getBoundingClientRect();
    if (!Number.isFinite(wrapRect.width) || wrapRect.width <= 0) return;

    const safeMax = Math.max(1, maxIndex);
    const startIndex = Number(el.dateRangeStartSlider.value);
    const endIndex = Number(el.dateRangeEndSlider.value);
    if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex) || startIndex >= endIndex) return;

    const startX = wrapRect.left + (startIndex / safeMax) * wrapRect.width;
    const endX = wrapRect.left + (endIndex / safeMax) * wrapRect.width;
    const pointerX = event.clientX;
    const handleGuardPx = 12;

    // Only start drag when clicking the highlighted middle segment, not near handles.
    if (pointerX <= startX + handleGuardPx || pointerX >= endX - handleGuardPx) return;
    if (pointerX < startX || pointerX > endX) return;

    event.preventDefault();

    dateRangeDragState = {
      pointerId: event.pointerId,
      startClientX: pointerX,
      startIndex,
      endIndex,
      maxIndex,
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
    if (!dateRangeDragState || !el.dateRangeStartSlider || !el.dateRangeEndSlider || !allRows.length) return;
    if (event.pointerId !== dateRangeDragState.pointerId) return;

    const {
      startClientX,
      startIndex,
      endIndex,
      maxIndex,
      wrapWidth,
    } = dateRangeDragState;

    const safeMax = Math.max(1, maxIndex);
    const deltaPx = event.clientX - startClientX;
    const deltaIndex = Math.round((deltaPx / wrapWidth) * safeMax);

    const minShift = -startIndex;
    const maxShift = maxIndex - endIndex;
    const shift = Math.max(minShift, Math.min(maxShift, deltaIndex));

    const nextStart = startIndex + shift;
    const nextEnd = endIndex + shift;
    if (Number(el.dateRangeStartSlider.value) === nextStart && Number(el.dateRangeEndSlider.value) === nextEnd) return;

    el.dateRangeStartSlider.value = String(nextStart);
    el.dateRangeEndSlider.value = String(nextEnd);

    updateDateRangeSliderFill(nextStart, nextEnd, maxIndex);

    const startIso = toIsoDate(allRows[nextStart].date);
    const endIso = toIsoDate(allRows[nextEnd].date);
    if (el.startDateInput) el.startDateInput.value = startIso;
    if (el.endDateInput) el.endDateInput.value = endIso;
    applyFilters();
  }

  function endDateRangeSegmentDrag(event) {
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

  function measureLabelWidth(ticks, fontSpec = "500 18px Space Grotesk") {
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
    el.pairKpiValue.innerHTML = `
      <span class="pair-primary">${primary}</span>
      <span class="pair-separator">/</span>
      <span class="pair-secondary">${secondary}</span>
    `;
  }

  function syncPairControls(changedControlId) {
    if (!el.primaryUoaSelect || !el.secondaryUoaSelect) return;
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

    syncAllDropdowns();
    persistFilters();
    renderAll();
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

    let start = String(el.startDateInput?.value || bounds.min);
    let end = String(el.endDateInput?.value || bounds.max);

    const maxIndex = Math.max(0, allRows.length - 1);
    if (maxIndex >= 1) {
      let startIndex = getDateIndexFromIso(start);
      let endIndex = getDateIndexFromIso(end);
      if (startIndex < 0) startIndex = 0;
      if (endIndex < 0) endIndex = maxIndex;

      if (startIndex >= endIndex) {
        if (startIndex >= maxIndex) {
          startIndex = Math.max(0, maxIndex - 1);
          endIndex = maxIndex;
        } else {
          endIndex = Math.min(maxIndex, startIndex + 1);
        }
        start = toIsoDate(allRows[startIndex].date);
        end = toIsoDate(allRows[endIndex].date);
        if (el.startDateInput) el.startDateInput.value = start;
        if (el.endDateInput) el.endDateInput.value = end;
      }
    }

    const startDate = new Date(`${start}T00:00:00Z`);
    const endDate = new Date(`${end}T23:59:59Z`);

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
    if (!bounds) return;
    const saved = loadStoredFilters(bounds);

    if (el.startDateInput) {
      el.startDateInput.min = bounds.min;
      el.startDateInput.max = bounds.max;
      el.startDateInput.value = saved.startDate;
      el.startDateInput.addEventListener("change", () => {
        stopDateRangePlayback();
        applyFilters();
      });
    }
    if (el.endDateInput) {
      el.endDateInput.min = bounds.min;
      el.endDateInput.max = bounds.max;
      el.endDateInput.value = saved.endDate;
      el.endDateInput.addEventListener("change", () => {
        stopDateRangePlayback();
        applyFilters();
      });
    }
    if (el.dateRangeStartSlider && el.dateRangeEndSlider) {
      el.dateRangeStartSlider.addEventListener("input", () => {
        handleDateRangeSliderInput("start");
      });
      el.dateRangeEndSlider.addEventListener("input", () => {
        handleDateRangeSliderInput("end");
      });
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
    bindDateRangePlaybackFpsButtons();
    setDateRangePlaybackFps(saved.playbackFps);

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
        updatedKpiTimeZone = DASHBOARD_TIME?.setPreferredTimeZone
          ? DASHBOARD_TIME.setPreferredTimeZone(next)
          : next;
        syncAllDropdowns();
        renderAll();
      });
    }

    syncPairControls();
    bindCustomDropdowns();
    bindSecondaryArrowCycling();
    initDatePickers();
    bindRangePresetButtons();
    updateDateRangePlayButton();
    updateDateRangeStopButton();
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

    const maxTicks = Math.max(4, Math.floor(chartW / 88));
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
    const vals = series
      .map((s) => s.value)
      .filter((v) => Number.isFinite(v) && (isLinear || v > 0));
    if (!vals.length) {
      if (canvas.id) chartEventMarkersById[canvas.id] = [];
      return;
    }

    let min = Math.min(...vals);
    let max = Math.max(...vals);
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
      tickValues = buildLinearTicks(min, max, 8);
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
      tickValues = buildLogTicks(min, max);
    }

    // Measure tick labels to determine required left padding.
    ctx.font = "500 18px Space Grotesk";
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
    const y0 = series[0].date.getFullYear();
    const y1 = series[series.length - 1].date.getFullYear();
    let maxYearWidth = 0;
    for (let y = y0; y <= y1; y++) {
      const metrics = ctx.measureText(String(y));
      maxYearWidth = Math.max(maxYearWidth, metrics.width);
    }
    // Account for rotation (-π/5 radians = -36 degrees)
    const fontHeight = 18 * 1.2; // approximate line height
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

    const xFor = (i) => pad.left + (i / Math.max(1, series.length - 1)) * chartW;

    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--line").trim();
    ctx.lineWidth = 1;

    ticksToDraw.forEach((tick) => {
      if (tick.value < min || tick.value > max) return;
      const y = yFor(tick.value);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + chartW, y);
      ctx.stroke();

      ctx.fillStyle = opts.color;
      ctx.font = "500 18px Space Grotesk";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const tx = pad.left - yLabelSpacing;
      ctx.fillText(tick.label, tx, y);
    });

    const xTicks = buildAdaptiveTimeTicks(series, chartW);

    xTicks.forEach((tick) => {
      const idx = series.findIndex((s) => s.date >= tick.date);
      if (idx <= 0) return;
      const x = xFor(idx);
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + chartH);
      ctx.stroke();

      ctx.save();
      ctx.translate(x - 8, pad.top + chartH + bottomSpacing);
      ctx.rotate(-Math.PI / 5);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--line").trim();
      ctx.font = "500 18px Space Grotesk";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText(String(tick.label), 0, 0);
      ctx.restore();
    });

    // Clip line rendering to chart area so strokes never overlap date labels.
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, pad.top, chartW, chartH);
    ctx.clip();

    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--ghost").trim();
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    series.forEach((s, i) => {
      const x = xFor(i);
      const y = yFor(s.value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.strokeStyle = opts.color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    series.forEach((s, i) => {
      const x = xFor(i);
      const y = yFor(s.value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();

    const markerStates = [];
    const eventMarkers = Array.isArray(opts.eventMarkers) ? opts.eventMarkers : [];
    
    // Get the date range of the series for date-based positioning
    const firstDate = series.length > 0 ? series[0].date : null;
    const lastDate = series.length > 0 ? series[series.length - 1].date : null;
    const dateRangeMs = firstDate && lastDate ? lastDate.getTime() - firstDate.getTime() : 1;
    
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

      // Calculate x position based on the actual event date, not array index
      let x = xFor(idx); // fallback to index-based positioning
      if (firstDate && lastDate && dateRangeMs > 0) {
        const eventOffsetMs = eventDate.getTime() - firstDate.getTime();
        const dateProgress = Math.max(0, Math.min(1, eventOffsetMs / dateRangeMs));
        x = pad.left + dateProgress * chartW;
      }
      
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

    const scaleMode = el.scaleSelect?.value === "linear" ? "linear" : "log";
    const primaryCurrency = el.primaryUoaSelect?.value || "BTC";
    const secondaryCurrency = el.secondaryUoaSelect?.value || "USD";
    
    if (el.usdBtcScaleLabel) el.usdBtcScaleLabel.textContent = scaleMode.toUpperCase();
    if (el.btcUsdScaleLabel) el.btcUsdScaleLabel.textContent = scaleMode.toUpperCase();

    // Update pair KPI
    renderPairKpiValue(primaryCurrency, secondaryCurrency);

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
      if (el.primaryRankKpiValue) el.primaryRankKpiValue.textContent = "--";
      if (el.secondaryRankKpiValue) el.secondaryRankKpiValue.textContent = "--";
      if (el.blockHeightText) el.blockHeightText.textContent = "BLOCK HEIGHT: --";
      if (el.rightAsOf) el.rightAsOf.textContent = "--";
      if (el.updatedKpiValue) el.updatedKpiValue.textContent = formatUpdatedDisplayText(refreshedAtText);
      if (el.blockHeightKpiValue) el.blockHeightKpiValue.textContent = "--";
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
      if (el.primaryRankKpiValue) el.primaryRankKpiValue.textContent = "--";
      if (el.secondaryRankKpiValue) el.secondaryRankKpiValue.textContent = "--";
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
    const TROY_OUNCE_TO_GRAMS = 31.1034768;
    const leftMainValue = isPreciousMetalCurrency(primaryCurrency)
      ? latest.inversePrice * TROY_OUNCE_TO_GRAMS
      : latest.inversePrice;
    const rightMainValue = isPreciousMetalCurrency(secondaryCurrency)
      ? latest.directPrice * TROY_OUNCE_TO_GRAMS
      : latest.directPrice;
    const showSubtext = hasBtcInPair || hasPreciousMetalInPair;
    if (el.satUsdText) el.satUsdText.style.display = showSubtext ? "" : "none";
    if (el.usdSatText) el.usdSatText.style.display = showSubtext ? "" : "none";

    el.usdBtcBig.textContent = primaryCurrency === "BTC"
      ? fmtSats(latest.satsPerSecondary)
      : isPreciousMetalCurrency(primaryCurrency)
        ? formatGramAmount(leftMainValue)
        : formatRateValue(leftMainValue, primaryCurrency);
    el.btcUsdBig.textContent = secondaryCurrency === "BTC"
      ? fmtSats(latest.directPrice * 100000000)
      : isPreciousMetalCurrency(secondaryCurrency)
        ? formatGramAmount(rightMainValue)
        : formatRateValue(rightMainValue, secondaryCurrency);

    const primaryUnit = formatCurrencyUnit(primaryCurrency);
    const secondaryUnit = formatCurrencyUnit(secondaryCurrency);

    if (hasBtcInPair) {
      if (primaryCurrency === "BTC") {
        el.satUsdText.textContent = fmtCurrencyToBtcSubtext(secondaryUnit, latest.inversePrice);
        el.usdSatText.textContent = `1 sat = ${formatSatValue(latest.satValueInSecondary, secondaryCurrency)}`;
      } else {
        const satValueInPrimary = latest.inversePrice / 100000000;
        el.satUsdText.textContent = `1 sat = ${formatSatValue(satValueInPrimary, primaryCurrency)}`;
        el.usdSatText.textContent = `${primaryUnit} = ${fmtBtc(latest.directPrice)}`;
      }
    } else if (hasPreciousMetalInPair) {
      if (primaryCurrency !== secondaryCurrency) {
        let nonMetalCurrency;
        let nonMetalPerGram;
        let ouncesPerNonMetal;

        if (isPreciousMetalCurrency(primaryCurrency) && !isPreciousMetalCurrency(secondaryCurrency)) {
          nonMetalCurrency = secondaryCurrency;
          nonMetalPerGram = latest.directPrice / TROY_OUNCE_TO_GRAMS;
          ouncesPerNonMetal = latest.inversePrice;
        } else if (!isPreciousMetalCurrency(primaryCurrency) && isPreciousMetalCurrency(secondaryCurrency)) {
          nonMetalCurrency = primaryCurrency;
          nonMetalPerGram = latest.inversePrice / TROY_OUNCE_TO_GRAMS;
          ouncesPerNonMetal = latest.directPrice;
        }

        if (nonMetalCurrency && Number.isFinite(nonMetalPerGram) && Number.isFinite(ouncesPerNonMetal)) {
          el.satUsdText.textContent = `1 g = ${formatRateValue(nonMetalPerGram, nonMetalCurrency)}`;
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

    if (el.blockHeightText) {
      el.blockHeightText.textContent = latestOriginal.blockHeight ? `BLOCK HEIGHT: ${latestOriginal.blockHeight}` : "BLOCK HEIGHT: --";
    }
    if (el.rightAsOf) el.rightAsOf.textContent = fmtDate(latestOriginal.date);
    if (el.updatedKpiValue) {
      el.updatedKpiValue.textContent = refreshedAtText
        ? formatUpdatedDisplayText(refreshedAtText)
        : formatUpdatedKpiTimestamp(latestOriginal.date);
    }
    if (el.blockHeightKpiValue) el.blockHeightKpiValue.textContent = latestOriginal.blockHeight ? String(latestOriginal.blockHeight) : "--";

    const ranksByCurrency = getCurrencyRanksByValue();
    if (el.primaryRankKpiValue) el.primaryRankKpiValue.textContent = ranksByCurrency[primaryCurrency] ? String(ranksByCurrency[primaryCurrency]) : "--";
    if (el.secondaryRankKpiValue) el.secondaryRankKpiValue.textContent = ranksByCurrency[secondaryCurrency] ? String(ranksByCurrency[secondaryCurrency]) : "--";

    // Determine colors and labels based on pair
    const leftColor = getComputedStyle(document.documentElement).getPropertyValue("--left").trim();
    const rightColor = getComputedStyle(document.documentElement).getPropertyValue("--right").trim();

    const leftSeries = adjustedRows.map((r) => {
      const baseValue = primaryCurrency === "BTC" ? r.satsPerSecondary : r.inversePrice;
      return {
        date: r.date,
        value: isPreciousMetalCurrency(primaryCurrency)
          ? baseValue * TROY_OUNCE_TO_GRAMS
          : baseValue,
      };
    });
    const rightSeries = adjustedRows.map((r) => {
      const baseValue = secondaryCurrency === "BTC" ? r.directPrice * 100000000 : r.directPrice;
      return {
        date: r.date,
        value: isPreciousMetalCurrency(secondaryCurrency)
          ? baseValue * TROY_OUNCE_TO_GRAMS
          : baseValue,
      };
    });

    const leftFormatter = (value) => {
      if (!Number.isFinite(value) || value < 0) return "0";
      if (primaryCurrency === "BTC") return fmtSatAxisLabel(value);
      if (isPreciousMetalCurrency(primaryCurrency)) {
        return formatCompactGramYAxisLabel(value);
      }
      return formatCompactYAxisLabel(value, primaryCurrency);
    };
    const rightFormatter = (value) => {
      if (!Number.isFinite(value) || value < 0) return "0";
      if (secondaryCurrency === "BTC") return fmtSatAxisLabel(value);
      if (isPreciousMetalCurrency(secondaryCurrency)) {
        return formatCompactGramYAxisLabel(value);
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
          tooltip: `${event.date}\n${event.ratioLabel} redenomination`,
        });
        rightEventMarkers.push({
          dateIso: event.date,
          tooltip: `${event.date}\n${event.ratioLabel} redenomination`,
        });
      });

      if (!applyRedenomAdjustment) {
        // Stars remain visible even without redenomination adjustment; slash labels remain off.
      } else {
      const leftRawSeries = transformedRows.map((r) => ({
        date: r.date,
        value: primaryCurrency === "BTC" ? r.satsPerSecondary : r.inversePrice,
      }));
      const leftRawSeriesAll = transformedAllRows.map((r) => ({
        date: r.date,
        value: primaryCurrency === "BTC" ? r.satsPerSecondary : r.inversePrice,
      }));
      const leftNumeratorCurrency = secondaryCurrency;
      const leftDenominatorCurrency = primaryCurrency;
      const rightRawSeries = transformedRows.map((r) => ({
        date: r.date,
        value: secondaryCurrency === "BTC" ? r.directPrice * 100000000 : r.directPrice,
      }));
      const rightRawSeriesAll = transformedAllRows.map((r) => ({
        date: r.date,
        value: secondaryCurrency === "BTC" ? r.directPrice * 100000000 : r.directPrice,
      }));
      const leftSeriesAll = adjustedAllRows.map((r) => ({
        date: r.date,
        value: primaryCurrency === "BTC" ? r.satsPerSecondary : r.inversePrice,
      }));
      const rightSeriesAll = adjustedAllRows.map((r) => ({
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

      const boundaryCrossesTick = (prePoints, postPoints, tickValue) => {
        if (!Array.isArray(prePoints) || !Array.isArray(postPoints)) return false;
        if (!prePoints.length || !postPoints.length || !Number.isFinite(tickValue) || tickValue <= 0) return false;
        const preLast = prePoints[prePoints.length - 1]?.value;
        const postFirst = postPoints[0]?.value;
        if (!Number.isFinite(preLast) || !Number.isFinite(postFirst) || preLast <= 0 || postFirst <= 0) return false;
        return (preLast <= tickValue && postFirst >= tickValue) || (preLast >= tickValue && postFirst <= tickValue);
      };

      const valueInSegmentRange = (points, value) => {
        if (!Array.isArray(points) || !points.length || !Number.isFinite(value) || value <= 0) return false;
        let minValue = Number.POSITIVE_INFINITY;
        let maxValue = Number.NEGATIVE_INFINITY;
        for (const point of points) {
          const v = point?.value;
          if (!Number.isFinite(v) || v <= 0) continue;
          minValue = Math.min(minValue, v);
          maxValue = Math.max(maxValue, v);
        }
        if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return false;
        const eps = Math.max((maxValue - minValue) * 1e-9, minValue * 1e-9, LOG_MIN_POSITIVE);
        return value >= (minValue - eps) && value <= (maxValue + eps);
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

      const leftRawDomain = computePaddedLogDomain(leftRawSeries);
      const rightRawDomain = computePaddedLogDomain(rightRawSeries);
      const leftAdjustedDomain = computePaddedLogDomain(leftSeries);
      const rightAdjustedDomain = computePaddedLogDomain(rightSeries);

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
        const leftPreAdjPoints = leftSeriesAll
          .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, false))
          .filter((point) => Number.isFinite(point.value) && point.value > 0);
        const leftPostRawPoints = leftRawSeriesAll
          .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, true))
          .filter((point) => Number.isFinite(point.value) && point.value > 0);
        const leftPostAdjPoints = leftSeriesAll
          .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, true))
          .filter((point) => Number.isFinite(point.value) && point.value > 0);
        const leftPreAdjVisiblePoints = leftSeries
          .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, false))
          .filter((point) => Number.isFinite(point.value) && point.value > 0);
        const leftPostAdjVisiblePoints = leftSeries
          .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, true))
          .filter((point) => Number.isFinite(point.value) && point.value > 0);
        
        // Include boundary point: extend pre-segments with the boundary point scaled to pre-event space
        let leftPreRawPointsExt = [...leftPreRawPoints];
        let leftPreAdjPointsExt = [...leftPreAdjPoints];
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
            preRawPoints: leftPreRawPointsExt,
            preAdjPoints: leftPreAdjPointsExt,
            postAdjPoints: leftPostAdjPoints,
            preVisibleInWindow: leftPreAdjVisiblePoints.length > 0,
            postVisibleInWindow: leftPostAdjVisiblePoints.length > 0,
          });
        }

        const rightPreRawPoints = rightRawSeriesAll
          .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, false))
          .filter((point) => Number.isFinite(point.value) && point.value > 0);
        const rightPreAdjPoints = rightSeriesAll
          .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, false))
          .filter((point) => Number.isFinite(point.value) && point.value > 0);
        const rightPostRawPoints = rightRawSeriesAll
          .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, true))
          .filter((point) => Number.isFinite(point.value) && point.value > 0);
        const rightPostAdjPoints = rightSeriesAll
          .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, true))
          .filter((point) => Number.isFinite(point.value) && point.value > 0);
        const rightPreAdjVisiblePoints = rightSeries
          .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, false))
          .filter((point) => Number.isFinite(point.value) && point.value > 0);
        const rightPostAdjVisiblePoints = rightSeries
          .filter((point) => eventSegmentFilter(point, eventDate, prevEventDate, nextEventDate, true))
          .filter((point) => Number.isFinite(point.value) && point.value > 0);
        
        // Include boundary point: extend pre-segments with the boundary point scaled to pre-event space
        let rightPreRawPointsExt = [...rightPreRawPoints];
        let rightPreAdjPointsExt = [...rightPreAdjPoints];
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
            preRawPoints: rightPreRawPointsExt,
            preAdjPoints: rightPreAdjPointsExt,
            postAdjPoints: rightPostAdjPoints,
            preVisibleInWindow: rightPreAdjVisiblePoints.length > 0,
            postVisibleInWindow: rightPostAdjVisiblePoints.length > 0,
          });
        }
      });

      leftOverlapRanges.sort((a, b) => b.eventDate - a.eventDate);
      rightOverlapRanges.sort((a, b) => b.eventDate - a.eventDate);

      if (leftOverlapRanges.length) {
        const hasRedenomAnchorDate = redenomAnchorDate instanceof Date && !Number.isNaN(redenomAnchorDate.getTime());
        const totalRedenomFactor = redenomEvents.reduce((acc, e) => {
          const eventDate = parseIsoDateUtc(e.date);
          if (hasRedenomAnchorDate && eventDate && eventDate > redenomAnchorDate) return acc;
          return acc * (Number(e.ratio) || 1);
        }, 1);
        leftOverlapLabelFn = (tickValue, baseLabel) => {
          // Keep upper padded ticks in adjusted units when they sit above the plotted adjusted domain.
          if (leftAdjustedDomain && tickValue > leftAdjustedDomain.max) return baseLabel;

          for (const range of leftOverlapRanges) {
            const preVisibleInWindow = !!range.preVisibleInWindow;
            const postVisibleInWindow = !!range.postVisibleInWindow;
            if (!preVisibleInWindow && !postVisibleInWindow) continue;

            const preAdjCross = segmentCrossesTick(range.preAdjPoints, tickValue);
            const postAdjCross = segmentCrossesTick(range.postAdjPoints, tickValue);
            const hasAnyAdjustedOverlap = preAdjCross || postAdjCross;
            if (!hasAnyAdjustedOverlap) continue;

            if (!preVisibleInWindow && postVisibleInWindow) {
              return baseLabel;
            }

            if (!postVisibleInWindow && preVisibleInWindow) {
              if (!preAdjCross) continue;
            }

            if (preVisibleInWindow && postVisibleInWindow && !preAdjCross && postAdjCross) {
              return baseLabel;
            }

            const oldValue = convertAdjustedTickToRawByFactor(
              tickValue,
              range.preFactor,
              leftDenominatorCurrency,
              leftNumeratorCurrency,
              redenominationCurrency
            );
            if (!Number.isFinite(oldValue) || oldValue <= 0) continue;
            // Do not hard-stop at raw segment/domain bounds; keep axis-extreme ticks
            // converted so top/bottom labels remain redenomination-aware.

            if (preAdjCross && !postAdjCross) {
              return leftFormatter(oldValue);
            }
            if (preVisibleInWindow && postVisibleInWindow && preAdjCross && postAdjCross) {
              return `${leftFormatter(oldValue)}/${baseLabel}`;
            }
          }
          // No overlapping chart lines found for this tick. If it sits outside the
          // adjusted segments, convert it using all redenomination factors so the label
          // shows the historical raw equivalent rather than the unadjusted baseLabel.
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
        const hasRedenomAnchorDate = redenomAnchorDate instanceof Date && !Number.isNaN(redenomAnchorDate.getTime());
        const totalRedenomFactor = redenomEvents.reduce((acc, e) => {
          const eventDate = parseIsoDateUtc(e.date);
          if (hasRedenomAnchorDate && eventDate && eventDate > redenomAnchorDate) return acc;
          return acc * (Number(e.ratio) || 1);
        }, 1);
        rightOverlapLabelFn = (tickValue, baseLabel) => {
          for (const range of rightOverlapRanges) {
            const preVisibleInWindow = !!range.preVisibleInWindow;
            const postVisibleInWindow = !!range.postVisibleInWindow;
            if (!preVisibleInWindow && !postVisibleInWindow) continue;

            const preAdjCross = segmentCrossesTick(range.preAdjPoints, tickValue);
            const postAdjCross = segmentCrossesTick(range.postAdjPoints, tickValue);
            const hasAnyAdjustedOverlap = preAdjCross || postAdjCross;
            if (!hasAnyAdjustedOverlap) continue;

            if (!preVisibleInWindow && postVisibleInWindow) {
              return baseLabel;
            }

            if (!postVisibleInWindow && preVisibleInWindow) {
              if (!preAdjCross) continue;
            }

            if (preVisibleInWindow && postVisibleInWindow && !preAdjCross && postAdjCross) {
              return baseLabel;
            }

            const oldValue = convertAdjustedTickToRawByFactor(
              tickValue,
              range.preFactor,
              rightDenominatorCurrency,
              rightNumeratorCurrency,
              redenominationCurrency
            );
            if (!Number.isFinite(oldValue) || oldValue <= 0) continue;
            // Do not hard-stop at raw segment/domain bounds; keep axis-extreme ticks
            // converted so top/bottom labels remain redenomination-aware.

            if (preAdjCross && !postAdjCross) {
              return rightFormatter(oldValue);
            }
            if (preVisibleInWindow && postVisibleInWindow && preAdjCross && postAdjCross) {
              return `${rightFormatter(oldValue)}/${baseLabel}`;
            }
          }
          // No overlapping chart lines found for this tick. Convert it using all
          // redenomination factors so the label shows the historical raw equivalent
          // rather than the unadjusted baseLabel.
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
      }
    }

    // Left chart: secondary currency in terms of primary
    drawChart(
      el.usdBtcChart,
      leftSeries,
      {
        scaleMode,
        color: leftColor,
        tickSide: "left",
        linearFormatter: leftFormatter,
        overlapLabelFn: leftOverlapLabelFn,
        eventMarkers: leftEventMarkers,
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
        scaleMode,
        color: rightColor,
        tickSide: "left",
        linearFormatter: rightFormatter,
        overlapLabelFn: rightOverlapLabelFn,
        eventMarkers: rightEventMarkers,
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
    allRows = loaded.rows;
    usdParityStartIso = computeUsdParityStartIso();
    rows = [...allRows];

    // Populate dropdowns from metadata
    populateCurrencyDropdowns();
    populateUpdatedTimeZoneSelect();

    initControls();
    bindChartEventHover(el.usdBtcChart);
    bindChartEventHover(el.btcUsdChart);
    primeKeyboardFocus();
    applyFilters();
    window.addEventListener("resize", () => {
      renderAll();
    });
  }

  init().catch((err) => {
    console.error(err);
  });
}());
