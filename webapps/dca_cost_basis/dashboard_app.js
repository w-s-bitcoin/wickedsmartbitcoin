/* ── theme sync ─────────────────────────────────────────────────── */
(function () {
  const THEME_KEY = "quantum-research-dashboard-theme";
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
    document.dispatchEvent(new CustomEvent("dashboard-theme-change"));
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
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === THEME_KEY && (event.newValue === "light" || event.newValue === "dark")) {
      applyTheme(event.newValue);
    }
  });
}());
/* ────────────────────────────────────────────────────────────────── */

const CONTROLS_STORAGE_KEY = "dca_cost_basis_controls_v2";
const DATE_RANGE_STORAGE_KEY = "dca_cost_basis_date_range_v1";
const DOWNLOAD_SETTINGS_KEY = "dca_cost_basis_download_settings_v1";
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
const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];
const EXPORT_VIDEO_FPS = 30;
const EXPORT_START_HOLD_SECONDS = 1;
const EXPORT_END_HOLD_SECONDS = 3;
const EXPORT_BATCH_MEMORY_BUDGET = 220 * 1024 * 1024;
const EXPORT_MIN_BATCH_FRAMES = 12;
const EXPORT_MAX_BATCH_FRAMES = 90;
const EXPORT_CHART_TEXT_SCALE = 1.72;
const CHART_MONO_FONT = '"IBM Plex Mono", monospace';
const CHART_TITLE_FONT = '"Space Grotesk", "Helvetica Neue", sans-serif';
const CHART_MONO_FONT_ATTR = "IBM Plex Mono, monospace";
const CHART_TITLE_FONT_ATTR = "Space Grotesk, Helvetica Neue, sans-serif";
const MS_PER_DAY = 86400000;
const LOG_MIN_POSITIVE = 1e-12;
const ONE_YEAR_TICK_THRESHOLD_DAYS = 365.25;
const FOUR_MONTH_TICK_THRESHOLD_DAYS = 365.25 * 1.5;
const SIX_MONTH_TICK_THRESHOLD_DAYS = 365.25 * 4;
const TWO_YEAR_TICK_THRESHOLD_DAYS = 365.25 * 10;

const state = {
  cadence: "daily_dca",
  yScale: "linear",
  showHalvings: true,
  timeZone: "UTC",
  metadata: null,
  priceRows: [],
  cadenceCaches: {},
  dateRange: {
    startIso: "",
    endIso: "",
    currentEndIso: "",
    selectedPreset: "full",
    playbackSpeed: 1,
    isPlaying: false,
    isPaused: false,
    pendingSpacePlayback: false,
    timerId: null,
  },
  downloadSettings: {
    scale: "linear",
    orientation: "landscape",
    quality: "720",
    speed: "1",
    theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
    extension: "mp4",
    endFrameHold: true,
  },
  seriesByCadence: {
    daily_dca: [],
    weekly_dca: [],
    monthly_dca: [],
  },
};

const SELECT_DROPDOWN_CONFIGS = [
  {
    selectId: "updatedTimeZoneSelect",
    dropdownId: "updatedTimeZoneDropdown",
    triggerId: "updatedTimeZoneDropdownTrigger",
    menuId: "updatedTimeZoneDropdownMenu",
  },
  {
    selectId: "cadenceSelect",
    dropdownId: "cadenceDropdown",
    triggerId: "cadenceDropdownTrigger",
    menuId: "cadenceDropdownMenu",
  },
  {
    selectId: "scaleSelect",
    dropdownId: "scaleDropdown",
    triggerId: "scaleDropdownTrigger",
    menuId: "scaleDropdownMenu",
  },
];

let selectDropdownGlobalListenersBound = false;
let dateRangeKeyboardShortcutsBound = false;
let dateRangeCurrentMarkerDrag = null;
let dateRangeHandleDrag = null;
let dateRangeLastAdjustedHandle = null;
let activeDatePickerClose = null;
let isDateRangeExporting = false;
let dateRangeExportCancelRequested = false;
let dateRangePlaybackOutsidePointerHandler = null;
let dateRangePlaybackOutsidePointerTouchState = null;
let dateRangeSessionPersistenceBound = false;
let preResetStateSnapshot = null;
let suppressResetSnapshotClear = false;
let customTooltipBound = false;
let customTooltipAnchor = null;
const downloadEstimateCalibrationCache = new Map();
const downloadEstimateCalibrationPending = new Set();
let downloadEstimateCalibrationRequestId = 0;
let downloadEstimateCalibrationTimer = null;

function setDropdownOpen(dropdownEl, menuEl, isOpen) {
  if (!menuEl) return;
  const open = !!isOpen;
  menuEl.classList.toggle("open", open);
  if (dropdownEl) dropdownEl.classList.toggle("is-open", open);
  if (dropdownEl?.parentElement?.classList.contains("chip-menu-wrap")) {
    dropdownEl.parentElement.classList.toggle("is-open", open);
  }
}

function closeAllSelectDropdowns(exceptDropdown = null) {
  SELECT_DROPDOWN_CONFIGS.forEach(({ dropdownId, menuId }) => {
    const dropdown = document.getElementById(dropdownId);
    const menu = document.getElementById(menuId);
    if (!dropdown || !menu) return;
    if (exceptDropdown && dropdown === exceptDropdown) return;
    setDropdownOpen(dropdown, menu, false);
  });
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

function parseCssPx(value, fallback = 0) {
  const n = Number.parseFloat(String(value || "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function sizeUpdatedTimeZoneDropdownMenu(select, dropdown, menu, probeEl) {
  if (!select || !dropdown || !menu || !probeEl) return;

  const style = window.getComputedStyle(probeEl);
  const font = style.font || `${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.font = font;

  let maxTextWidth = 0;
  Array.from(select.options).forEach((option) => {
    const text = String(option.textContent || "");
    maxTextWidth = Math.max(maxTextWidth, ctx.measureText(text).width);
  });

  const menuStyle = window.getComputedStyle(menu);
  const leftPad = parseCssPx(menuStyle.getPropertyValue("--dca-dropdown-content-pad"), 10);
  const rightPad = parseCssPx(menuStyle.getPropertyValue("--dca-dropdown-content-pad"), 10);
  const borderAndSafety = 44;
  const desired = Math.ceil(maxTextWidth + leftPad + rightPad + borderAndSafety);

  const pillWidth = Math.ceil(dropdown.getBoundingClientRect().width + 8);
  const minWidth = Math.max(pillWidth, 360);
  const maxWidth = Math.max(minWidth, Math.floor(window.innerWidth - 24));
  const width = Math.max(minWidth, Math.min(desired, maxWidth));

  // Keep the timezone menu anchored to the left edge of the Updated pill.
  menu.style.left = "0px";
  menu.style.width = `${width}px`;
  menu.style.minWidth = `${width}px`;
  menu.style.maxWidth = `${width}px`;
}

function sizeSelectDropdownToOptions(selectId, dropdownId, triggerId) {
  const select = document.getElementById(selectId);
  const dropdown = document.getElementById(dropdownId);
  const trigger = document.getElementById(triggerId);
  const valueEl = document.getElementById(triggerId.replace("Trigger", "Value"));
  if (!select || !dropdown) return;

  // Updated chip uses overlay behavior and should keep chip-driven width.
  if (selectId === "updatedTimeZoneSelect") return;

  // Only size once — never recompute on selection changes.
  if (dropdown.dataset.fixedWidthPx) return;

  const probeEl = valueEl || trigger;
  if (!probeEl) return;

  const style = window.getComputedStyle(probeEl);
  const measurer = document.createElement("span");
  measurer.style.position = "fixed";
  measurer.style.left = "-99999px";
  measurer.style.top = "-99999px";
  measurer.style.visibility = "hidden";
  measurer.style.pointerEvents = "none";
  measurer.style.whiteSpace = "nowrap";
  measurer.style.font = style.font || `${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;
  measurer.style.letterSpacing = style.letterSpacing;
  measurer.style.textTransform = style.textTransform;
  document.body.appendChild(measurer);

  let maxTextWidth = 0;
  Array.from(select.options).forEach((option) => {
    measurer.textContent = String(option.textContent || "");
    maxTextWidth = Math.max(maxTextWidth, measurer.getBoundingClientRect().width);
  });
  document.body.removeChild(measurer);

  const dropdownStyle = window.getComputedStyle(dropdown);
  const leftPad = parseCssPx(dropdownStyle.getPropertyValue("--dca-dropdown-content-pad"), 10);
  const rightPad = parseCssPx(dropdownStyle.getPropertyValue("--dca-dropdown-arrow-gap"), 18);
  const fudge = 1;
  const measuredWidth = Math.max(54, Math.ceil(maxTextWidth + leftPad + rightPad + fudge));
  const priorLockedWidth = Number.parseFloat(dropdown.dataset.fixedWidthPx || "0");
  const fixedWidth = Number.isFinite(priorLockedWidth) && priorLockedWidth > 0
    ? Math.max(priorLockedWidth, measuredWidth)
    : measuredWidth;
  dropdown.dataset.fixedWidthPx = String(fixedWidth);
  const widthPx = `${fixedWidth}px`;
  dropdown.style.width = widthPx;
  dropdown.style.minWidth = widthPx;
  dropdown.style.maxWidth = widthPx;
  dropdown.style.flexBasis = widthPx;
  const wrapper = dropdown.closest("label.chip") || dropdown.closest(".chip-menu-wrap");
  if (wrapper) {
    const dropdownRect = dropdown.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const prefixWidth = Math.max(0, Math.ceil(wrapperRect.width - dropdownRect.width));
    const measuredWrapperWidth = Math.max(prefixWidth + fixedWidth, Math.ceil(wrapperRect.width));
    const priorWrapperWidth = Number.parseFloat(wrapper.dataset.fixedPillWidthPx || "0");
    const fixedWrapperWidth = Number.isFinite(priorWrapperWidth) && priorWrapperWidth > 0
      ? Math.max(priorWrapperWidth, measuredWrapperWidth)
      : measuredWrapperWidth;
    wrapper.dataset.fixedPillWidthPx = String(fixedWrapperWidth);
    const wrapperWidthPx = `${fixedWrapperWidth}px`;
    wrapper.style.width = wrapperWidthPx;
    wrapper.style.minWidth = wrapperWidthPx;
    wrapper.style.maxWidth = wrapperWidthPx;
    wrapper.style.flexBasis = wrapperWidthPx;
    wrapper.style.flexShrink = "0";
  }
}

function syncSelectDropdown(selectId, triggerId, menuId) {
  const select = document.getElementById(selectId);
  const trigger = document.getElementById(triggerId);
  const dropdown = document.getElementById(triggerId.replace("Trigger", "Dropdown"));
  const menu = document.getElementById(menuId);
  const valueEl = document.getElementById(triggerId.replace("Trigger", "Value"));
  if (!select || !menu) return;

  const selectedOption = select.options[select.selectedIndex];
  if (valueEl && selectId !== "updatedTimeZoneSelect") {
    valueEl.textContent = selectedOption ? selectedOption.textContent : "";
  }
  if (trigger && selectId === "updatedTimeZoneSelect") {
    trigger.textContent = selectedOption ? selectedOption.textContent : "";
  }

  menu.innerHTML = Array.from(select.options)
    .map((option) => {
      const selectedClass = option.value === select.value ? " dca-option-btn--selected" : "";
      return `<button type="button" class="dca-option-btn${selectedClass}" data-value="${escapeHtml(option.value)}">${escapeHtml(option.textContent || "")}</button>`;
    })
    .join("");

  if (selectId === "updatedTimeZoneSelect") {
    sizeUpdatedTimeZoneDropdownMenu(select, dropdown, menu, trigger);
  }
}

function syncAllSelectDropdowns() {
  SELECT_DROPDOWN_CONFIGS.forEach(({ selectId, triggerId, menuId }) => {
    syncSelectDropdown(selectId, triggerId, menuId);
  });
}

function bindSelectDropdowns() {
  SELECT_DROPDOWN_CONFIGS.forEach(({ selectId, dropdownId, triggerId, menuId }) => {
    const select = document.getElementById(selectId);
    const dropdown = document.getElementById(dropdownId);
    const trigger = document.getElementById(triggerId);
    const menu = document.getElementById(menuId);
    if (!select || !dropdown || !trigger || !menu) return;
    if (dropdown.dataset.bound === "1") return;
    dropdown.dataset.bound = "1";

    const isUpdatedChipDropdown = selectId === "updatedTimeZoneSelect";
    const toggleRoot = isUpdatedChipDropdown
      ? document.getElementById("updatedChipWrap")
      : dropdown.closest("label.chip");

    if (toggleRoot) {
      toggleRoot.classList.add("dca-dropdown-pill");
    }

    if (toggleRoot && toggleRoot.dataset.dropdownPillBound !== "1") {
      toggleRoot.dataset.dropdownPillBound = "1";
      toggleRoot.addEventListener("click", (event) => {
        if (menu.contains(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        const willOpen = !menu.classList.contains("open");
        closeAllSelectDropdowns(willOpen ? dropdown : null);
        setDropdownOpen(dropdown, menu, willOpen);
      });
    }

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
  });

  requestAnimationFrame(() => {
    SELECT_DROPDOWN_CONFIGS.forEach(({ selectId, dropdownId, triggerId }) => {
      sizeSelectDropdownToOptions(selectId, dropdownId, triggerId);
    });
  });

  if (selectDropdownGlobalListenersBound) return;
  selectDropdownGlobalListenersBound = true;

  document.addEventListener("click", (event) => {
    const target = event.target;
    SELECT_DROPDOWN_CONFIGS.forEach(({ dropdownId, menuId }) => {
      const dropdown = document.getElementById(dropdownId);
      const menu = document.getElementById(menuId);
      if (!dropdown || !menu) return;
      if (dropdown.contains(target)) return;
      setDropdownOpen(dropdown, menu, false);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeAllSelectDropdowns();
  });
}

function getPreferredDashboardTimeZone() {
  if (!DASHBOARD_TIME?.getPreferredTimeZone) return state.timeZone || "UTC";
  return DASHBOARD_TIME.getPreferredTimeZone();
}

function setPreferredDashboardTimeZone(value) {
  if (!DASHBOARD_TIME?.setPreferredTimeZone) {
    state.timeZone = String(value || "UTC").trim() || "UTC";
    return state.timeZone;
  }
  state.timeZone = DASHBOARD_TIME.setPreferredTimeZone(value);
  return state.timeZone;
}

function getDashboardTimeZoneOptions() {
  if (!DASHBOARD_TIME?.getTimeZoneOptions) {
    return [{ value: "UTC", label: "UTC - Greenwich Mean Time (GMT)" }];
  }
  return DASHBOARD_TIME.getTimeZoneOptions();
}

function formatUpdatedForSelectedTimeZone(value) {
  const raw = String(value || "").trim();
  if (!raw) return "-";

  const withParenthesizedZone = (text) => {
    const normalized = String(text || "").trim();
    if (!normalized) return normalized;
    if (/\([^()]+\)\s*$/.test(normalized)) return normalized;
    const match = normalized.match(/^(.*\d{2}:\d{2})(?:\s+([A-Za-z][A-Za-z0-9_:+\/-]*))$/);
    if (!match) return normalized;
    const prefix = match[1].trimEnd();
    const zone = match[2].trim();
    return `${prefix} (${zone})`;
  };

  if (DASHBOARD_TIME?.formatUtcTimestamp) {
    return withParenthesizedZone(
      DASHBOARD_TIME.formatUtcTimestamp(raw, state.timeZone || "UTC").text
    );
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return withParenthesizedZone(`${parsed.toISOString().replace("T", " ").slice(0, 16)} UTC`);
}

function populateUpdatedTimeZoneSelect() {
  const select = document.getElementById("updatedTimeZoneSelect");
  if (!select) return;
  const preferred = getPreferredDashboardTimeZone();
  state.timeZone = preferred;
  const options = getDashboardTimeZoneOptions();
  select.innerHTML = options.map((opt) => {
    const selected = opt.value === preferred ? " selected" : "";
    return `<option value="${opt.value}"${selected}>${opt.label}</option>`;
  }).join("");
  syncSelectDropdown("updatedTimeZoneSelect", "updatedTimeZoneDropdownTrigger", "updatedTimeZoneDropdownMenu");
}

function bindTimeZoneChipEvents() {
  const select = document.getElementById("updatedTimeZoneSelect");
  if (!select) return;
  select.addEventListener("change", () => {
    setPreferredDashboardTimeZone(select.value);
    select.blur();
    closeAllSelectDropdowns();
    saveControls();
    renderChart();
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];

    if (c === '"') {
      if (inQuotes && n === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (c === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((c === "\n" || c === "\r") && !inQuotes) {
      if (c === "\r" && n === "\n") i += 1;
      row.push(value);
      value = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      continue;
    }

    value += c;
  }

  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).map((r) => {
    const out = {};
    headers.forEach((h, idx) => {
      out[h] = (r[idx] ?? "").trim();
    });
    return out;
  });
}

function toNumber(value) {
  if (value == null || value === "") return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function fmtUsd(value, decimals = 0) {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtUsdCompactTick(value) {
  if (!Number.isFinite(value) || value <= 0) return "";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(value % 1e9 === 0 ? 0 : 1)}b`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(value % 1e6 === 0 ? 0 : 1)}m`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(value % 1e3 === 0 ? 0 : 1)}k`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
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

function loadControls() {
  try {
    const shareState = getDashboardShareStateFromUrl();
    const raw = localStorage.getItem(CONTROLS_STORAGE_KEY);
    if (!raw && !shareState) return;
    const parsed = shareState || JSON.parse(raw);

    if (["daily_dca", "weekly_dca", "monthly_dca"].includes(parsed.cadence)) {
      state.cadence = parsed.cadence;
    }
    if (["linear", "log"].includes(parsed.yScale)) {
      state.yScale = parsed.yScale;
    }
    if (typeof parsed.showHalvings === "boolean") {
      state.showHalvings = parsed.showHalvings;
    }
    if (shareState && typeof parsed.timeZone === "string" && parsed.timeZone.trim()) {
      setPreferredDashboardTimeZone(parsed.timeZone);
    } else if (typeof parsed.timeZone === "string" && parsed.timeZone.trim()) {
      state.timeZone = String(parsed.timeZone).trim();
    }
  } catch (_) {
    // Ignore invalid cached controls.
  }
}

function formatRangeOptionLabel(days) {
  if (!Number.isFinite(days) || days <= 0) return "All";

  const roundedDays = Math.round(days);
  const approxYears = roundedDays / 365.25;
  const wholeWeeks = roundedDays / 7;

  if (approxYears >= 1 && Math.abs(approxYears - Math.round(approxYears)) < 0.03) {
    return `${Math.round(approxYears)}Y`;
  }
  if (roundedDays >= 14 && Number.isInteger(wholeWeeks)) {
    return `${wholeWeeks}W`;
  }
  return `${roundedDays}D`;
}

function ensureCustomRangeOption(rangeSelect, days) {
  if (!rangeSelect || !Number.isFinite(days) || days <= 0) return;

  const value = String(Math.round(days));
  if (Array.from(rangeSelect.options).some((opt) => opt.value === value)) return;

  const customOption = document.createElement("option");
  customOption.value = value;
  customOption.textContent = `${formatRangeOptionLabel(days)} (Custom)`;

  const allOption = Array.from(rangeSelect.options).find((opt) => opt.value === "0");
  if (allOption) {
    rangeSelect.insertBefore(customOption, allOption);
  } else {
    rangeSelect.appendChild(customOption);
  }

  syncSelectDropdown("rangeSelect", "rangeDropdownTrigger", "rangeDropdownMenu");
}

function saveControls() {
  try {
    localStorage.setItem(CONTROLS_STORAGE_KEY, JSON.stringify({
      cadence: state.cadence,
      yScale: state.yScale,
      showHalvings: state.showHalvings,
      timeZone: state.timeZone || "UTC",
    }));
    if (!suppressResetSnapshotClear) clearPreResetSnapshot();
  } catch (_) {
    // Ignore storage failures.
  }
}

function applyControlValuesToUi() {
  const cadenceSelect = document.getElementById("cadenceSelect");
  const scaleSelect = document.getElementById("scaleSelect");
  const toggleHalvings = document.getElementById("toggleHalvings");

  if (cadenceSelect) cadenceSelect.value = state.cadence;
  if (scaleSelect) scaleSelect.value = state.yScale;
  if (toggleHalvings) toggleHalvings.checked = state.showHalvings;
  syncAllSelectDropdowns();
}

async function loadData() {
  const [metadataResp, dailyResp, weeklyResp, monthlyResp] = await Promise.all([
    fetch("webapp_data/dca_cost_basis_metadata.json", { cache: "default" }),
    fetch("webapp_data/daily_dca.csv", { cache: "default" }),
    fetch("webapp_data/weekly_dca.csv", { cache: "default" }),
    fetch("webapp_data/monthly_dca.csv", { cache: "default" }),
  ]);

  if (!metadataResp.ok) throw new Error(`Failed to load metadata (${metadataResp.status}).`);
  if (!dailyResp.ok) throw new Error(`Failed to load daily_dca.csv (${dailyResp.status}).`);
  if (!weeklyResp.ok) throw new Error(`Failed to load weekly_dca.csv (${weeklyResp.status}).`);
  if (!monthlyResp.ok) throw new Error(`Failed to load monthly_dca.csv (${monthlyResp.status}).`);

  state.metadata = await metadataResp.json();

  function parseSeries(text) {
    return parseCsv(text)
      .map((row) => ({
        daysAgo: Number.parseInt(row.days_ago || "0", 10),
        yearsAgo: toNumber(row.years_ago),
        dateIso: row.date_iso,
        timestampUtc: row.timestamp_utc,
        blockHeight: Number.parseInt(row.block_height || "0", 10),
        historicalPrice: toNumber(row.historical_price),
        currentPrice: toNumber(row.current_price),
        dcaBasis: toNumber(row.dca_basis),
        investedUsd: toNumber(row.invested_usd),
        btcAccum: toNumber(row.btc_accum),
        purchaseCount: Number.parseInt(row.purchase_count || "0", 10),
        isPriceAbove: toNumber(row.is_price_above),
      }))
      .filter((row) => Number.isFinite(row.daysAgo) && Number.isFinite(row.historicalPrice));
  }

  state.seriesByCadence.daily_dca = parseSeries(await dailyResp.text());
  state.seriesByCadence.weekly_dca = parseSeries(await weeklyResp.text());
  state.seriesByCadence.monthly_dca = parseSeries(await monthlyResp.text());
  state.priceRows = buildPriceRowsFromSeries(state.seriesByCadence.daily_dca);
  state.cadenceCaches = buildCadenceCaches(state.priceRows);
  initializeDateRangeState();
}

function parseIsoDateMs(iso) {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : NaN;
}

function addDaysIso(iso, days) {
  const ms = parseIsoDateMs(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms + (Math.round(days) * MS_PER_DAY)).toISOString().slice(0, 10);
}

function diffDays(startIso, endIso) {
  const startMs = parseIsoDateMs(startIso);
  const endMs = parseIsoDateMs(endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.round((endMs - startMs) / MS_PER_DAY);
}

function fmtDatePickerLabel(isoVal) {
  if (!isoVal) return "<span class=\"date-range-btn-placeholder\" aria-hidden=\"true\">00/00/00</span>";
  const [year, month, day] = String(isoVal).split("-");
  if (!year || !month || !day) return "<span class=\"date-range-btn-placeholder\" aria-hidden=\"true\">00/00/00</span>";
  return `${month}/${day}/${year.slice(2)}`;
}

function datePickerButtonHtml(isoVal) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${fmtDatePickerLabel(isoVal)}`;
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
    requestAnimationFrame(positionPopup);
  }

  function openPopup() {
    if (activeDatePickerClose && activeDatePickerClose !== closePopup) {
      activeDatePickerClose();
    }
    closeAllSelectDropdowns();
    const selectedIso = getSelected();
    const selectedDate = isoToLocalDate(selectedIso);
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

function buildPriceRowsFromSeries(rows) {
  const seen = new Map();
  rows.forEach((row) => {
    if (!row.dateIso || !Number.isFinite(row.historicalPrice)) return;
    seen.set(row.dateIso, {
      dateIso: row.dateIso,
      timestampUtc: row.timestampUtc,
      blockHeight: row.blockHeight,
      price: row.historicalPrice,
      utcDay: new Date(`${row.dateIso}T00:00:00Z`).getUTCDay(),
      monthDay: Number(row.dateIso.slice(8, 10)),
    });
  });
  return Array.from(seen.values()).sort((a, b) => a.dateIso.localeCompare(b.dateIso));
}

function buildCadenceCaches(priceRows) {
  const masks = {
    daily_dca: priceRows.map(() => true),
    weekly_dca: priceRows.map((row) => row.utcDay === 5),
    monthly_dca: priceRows.map((row) => row.monthDay === 1),
  };

  return Object.fromEntries(Object.entries(masks).map(([cadence, mask]) => {
    const prefixCount = [0];
    const prefixInvPrice = [0];
    const prevBuyIndex = [];
    let lastBuy = -1;
    mask.forEach((isBuy, index) => {
      if (isBuy) lastBuy = index;
      prevBuyIndex[index] = lastBuy;
      prefixCount[index + 1] = prefixCount[index] + (isBuy ? 1 : 0);
      prefixInvPrice[index + 1] = prefixInvPrice[index] + (isBuy ? 1 / priceRows[index].price : 0);
    });
    return [cadence, { mask, prefixCount, prefixInvPrice, prevBuyIndex }];
  }));
}

function getDataBounds() {
  const rows = state.priceRows || [];
  return {
    minIso: rows[0]?.dateIso || "",
    maxIso: rows[rows.length - 1]?.dateIso || "",
  };
}

function findDateIndex(iso, mode = "exact") {
  const rows = state.priceRows || [];
  if (!rows.length || !iso) return -1;
  let lo = 0;
  let hi = rows.length - 1;
  let best = mode === "ceil" ? rows.length : -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const cmp = rows[mid].dateIso.localeCompare(iso);
    if (cmp === 0) return mid;
    if (cmp < 0) {
      if (mode === "floor") best = mid;
      lo = mid + 1;
    } else {
      if (mode === "ceil") best = mid;
      hi = mid - 1;
    }
  }
  if (mode === "ceil") return best < rows.length ? best : -1;
  return best;
}

function clampIsoToData(iso) {
  const { minIso, maxIso } = getDataBounds();
  if (!minIso || !maxIso) return iso || "";
  if (!iso || iso < minIso) return minIso;
  if (iso > maxIso) return maxIso;
  return iso;
}

function normalizeDateRangeState() {
  const { minIso, maxIso } = getDataBounds();
  if (!minIso || !maxIso) return;
  state.dateRange.startIso = clampIsoToData(state.dateRange.startIso || minIso);
  state.dateRange.endIso = clampIsoToData(state.dateRange.endIso || maxIso);
  if (state.dateRange.startIso > state.dateRange.endIso) {
    state.dateRange.startIso = state.dateRange.endIso;
  }
  state.dateRange.currentEndIso = clampIsoToData(state.dateRange.currentEndIso || state.dateRange.endIso);
  if (state.dateRange.currentEndIso < state.dateRange.startIso) {
    state.dateRange.currentEndIso = state.dateRange.startIso;
  }
  if (state.dateRange.currentEndIso > state.dateRange.endIso) {
    state.dateRange.currentEndIso = state.dateRange.endIso;
  }
}

function getPresetStartIso(preset, endIso) {
  const { minIso } = getDataBounds();
  if (!minIso || !endIso) return "";
  if (preset === "full") return minIso;
  if (preset === "ytd") return clampIsoToData(`${endIso.slice(0, 4)}-01-01`);
  const yearCount = Number.parseInt(String(preset).replace("y", ""), 10);
  if (Number.isFinite(yearCount) && yearCount > 0) {
    const end = new Date(`${endIso}T00:00:00Z`);
    const start = new Date(Date.UTC(end.getUTCFullYear() - yearCount, end.getUTCMonth(), end.getUTCDate()));
    if (end.getUTCMonth() === 1 && end.getUTCDate() === 29) {
      start.setUTCDate(28);
    }
    return clampIsoToData(start.toISOString().slice(0, 10));
  }
  return minIso;
}

function loadDateRangeState() {
  try {
    const parsed = getDashboardShareStateFromUrl() || JSON.parse(localStorage.getItem(DATE_RANGE_STORAGE_KEY) || "{}");
    if (typeof parsed.startIso === "string") state.dateRange.startIso = parsed.startIso;
    if (typeof parsed.endIso === "string") state.dateRange.endIso = parsed.endIso;
    if (typeof parsed.selectedPreset === "string") state.dateRange.selectedPreset = parsed.selectedPreset;
    const speed = Number(parsed.playbackSpeed);
    if (PLAYBACK_SPEEDS.includes(speed)) state.dateRange.playbackSpeed = speed;
    if (
      parsed.pausedPlaybackSession
      && typeof parsed.pausedPlaybackSession === "object"
      && typeof parsed.pausedPlaybackSession.startIso === "string"
      && typeof parsed.pausedPlaybackSession.targetEndIso === "string"
      && typeof parsed.pausedPlaybackSession.currentEndIso === "string"
    ) {
      return {
        startIso: clampIsoToData(parsed.pausedPlaybackSession.startIso),
        targetEndIso: clampIsoToData(parsed.pausedPlaybackSession.targetEndIso),
        currentEndIso: clampIsoToData(parsed.pausedPlaybackSession.currentEndIso),
      };
    }
  } catch (_) {
    // Ignore invalid cached date range state.
  }
  return null;
}

function saveDateRangeState() {
  try {
    const hasPlaybackSession = !!(state.dateRange.isPlaying || state.dateRange.isPaused);
    const pausedPlaybackSession = hasPlaybackSession ? {
      startIso: state.dateRange.startIso,
      targetEndIso: state.dateRange.endIso,
      currentEndIso: state.dateRange.currentEndIso,
    } : null;
    localStorage.setItem(DATE_RANGE_STORAGE_KEY, JSON.stringify({
      startIso: state.dateRange.startIso,
      endIso: state.dateRange.endIso,
      selectedPreset: state.dateRange.selectedPreset,
      playbackSpeed: state.dateRange.playbackSpeed,
      pausedPlaybackSession,
    }));
    if (!suppressResetSnapshotClear) clearPreResetSnapshot();
  } catch (_) {
    // Ignore storage failures.
  }
}

function getDefaultDashboardState() {
  const { minIso, maxIso } = getDataBounds();
  return {
    cadence: "daily_dca",
    yScale: "linear",
    showHalvings: true,
    timeZone: "UTC",
    startIso: minIso || "",
    endIso: maxIso || "",
    currentEndIso: maxIso || "",
    selectedPreset: "full",
    playbackSpeed: 1,
  };
}

function captureResetSnapshot() {
  return {
    cadence: state.cadence,
    yScale: state.yScale,
    showHalvings: !!state.showHalvings,
    timeZone: state.timeZone || "UTC",
    startIso: state.dateRange.startIso || "",
    endIso: state.dateRange.endIso || "",
    currentEndIso: state.dateRange.currentEndIso || state.dateRange.endIso || "",
    selectedPreset: state.dateRange.selectedPreset || "custom",
    playbackSpeed: state.dateRange.playbackSpeed || 1,
  };
}

function restoreResetSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return;
  suppressResetSnapshotClear = true;
  try {
    stopDateRangePlayback(false);
    state.cadence = ["daily_dca", "weekly_dca", "monthly_dca"].includes(snapshot.cadence) ? snapshot.cadence : "daily_dca";
    state.yScale = ["linear", "log"].includes(snapshot.yScale) ? snapshot.yScale : "linear";
    state.showHalvings = snapshot.showHalvings !== false;
    setPreferredDashboardTimeZone(String(snapshot.timeZone || "UTC"));

    state.dateRange.startIso = clampIsoToData(snapshot.startIso || "");
    state.dateRange.endIso = clampIsoToData(snapshot.endIso || "");
    state.dateRange.currentEndIso = clampIsoToData(snapshot.currentEndIso || snapshot.endIso || "");
    state.dateRange.selectedPreset = typeof snapshot.selectedPreset === "string" ? snapshot.selectedPreset : "custom";
    const playbackSpeed = Number(snapshot.playbackSpeed);
    state.dateRange.playbackSpeed = PLAYBACK_SPEEDS.includes(playbackSpeed) ? playbackSpeed : 1;
    state.dateRange.isPlaying = false;
    state.dateRange.isPaused = false;
    normalizeDateRangeState();

    saveControls();
    saveDateRangeState();
    populateUpdatedTimeZoneSelect();
    applyControlValuesToUi();
    syncDateRangeControls();
    renderChart();
  } finally {
    suppressResetSnapshotClear = false;
  }
  updateResetButtonUi();
}

function restoreDashboardDefaults() {
  preResetStateSnapshot = captureResetSnapshot();
  try {
    localStorage.removeItem(CONTROLS_STORAGE_KEY);
    localStorage.removeItem(DATE_RANGE_STORAGE_KEY);
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
  return current.cadence === defaults.cadence
    && current.yScale === defaults.yScale
    && current.showHalvings === defaults.showHalvings
    && current.timeZone === defaults.timeZone
    && current.startIso === defaults.startIso
    && current.endIso === defaults.endIso
    && current.currentEndIso === defaults.currentEndIso
    && current.selectedPreset === defaults.selectedPreset
    && Number(current.playbackSpeed) === Number(defaults.playbackSpeed);
}

function isDefaultState() {
  return statesMatch(captureResetSnapshot(), getDefaultDashboardState());
}

function updateResetButtonUi() {
  const btn = document.getElementById("resetDashboard");
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
  const dashboardMatch = path.match(/^(.*)\/webapps\/dca_cost_basis\/dashboard\.html$/i);
  const basePath = dashboardMatch ? (dashboardMatch[1] || "") : path.replace(/\/[^/]*$/, "");
  if (IS_LOCAL_RUNTIME) {
    return `${window.location.origin}${basePath}/dca_cost_basis.html`;
  }
  return `${window.location.origin}${basePath}/dca_cost_basis`;
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
  const copyButton = document.getElementById("copyDashboardLink");
  const resetButton = document.getElementById("resetDashboard");
  bindCustomTooltips();
  setCustomTooltip(copyButton, "Copy shareable dashboard link");
  if (copyButton && copyButton.dataset.bound !== "1") {
    copyButton.dataset.bound = "1";
    copyButton.addEventListener("click", async () => {
      try {
        await copyDashboardLinkToClipboard(copyButton);
      } catch (_) {
        // Clipboard may be unavailable in some browser contexts.
      }
    });
  }

  setCustomTooltip(resetButton, preResetStateSnapshot ? "Undo the last restore defaults action" : "Reset dashboard to defaults");
  if (resetButton && resetButton.dataset.bound !== "1") {
    resetButton.dataset.bound = "1";
    resetButton.addEventListener("click", () => {
      if (preResetStateSnapshot) restorePreviousDashboardState();
      else restoreDashboardDefaults();
    });
  }
  updateResetButtonUi();
}

function initializeDateRangeState() {
  const { minIso, maxIso } = getDataBounds();
  if (!minIso || !maxIso) return;
  state.dateRange.startIso = minIso;
  state.dateRange.endIso = maxIso;
  state.dateRange.currentEndIso = maxIso;
  const pausedPlaybackSession = loadDateRangeState();
  if (pausedPlaybackSession) {
    state.dateRange.startIso = pausedPlaybackSession.startIso;
    state.dateRange.endIso = pausedPlaybackSession.targetEndIso;
    state.dateRange.currentEndIso = pausedPlaybackSession.currentEndIso;
    state.dateRange.isPlaying = false;
    state.dateRange.isPaused = true;
    state.dateRange.selectedPreset = "custom";
  } else if (state.dateRange.selectedPreset && state.dateRange.selectedPreset !== "custom") {
    state.dateRange.endIso = maxIso;
    state.dateRange.startIso = getPresetStartIso(state.dateRange.selectedPreset, maxIso);
    state.dateRange.currentEndIso = state.dateRange.endIso;
  } else {
    state.dateRange.currentEndIso = state.dateRange.endIso;
  }
  normalizeDateRangeState();
  syncDateRangeControls();
  syncDownloadSettingsControls();
  if (state.dateRange.isPaused) {
    bindDateRangePlaybackOutsidePointerActions();
  }
}

function getFrameRows(startIso = state.dateRange.startIso, endIso = state.dateRange.currentEndIso) {
  const priceRows = state.priceRows || [];
  if (!priceRows.length) return [];
  const startIdx = findDateIndex(startIso, "ceil");
  const endIdx = findDateIndex(endIso, "floor");
  if (startIdx < 0 || endIdx < 0 || startIdx > endIdx) return [];

  const cache = state.cadenceCaches[state.cadence] || state.cadenceCaches.daily_dca;
  const endRow = priceRows[endIdx];
  const currentPrice = endRow.price;
  const output = [];

  for (let index = startIdx; index <= endIdx; index += 1) {
    const row = priceRows[index];
    const effectiveStart = state.cadence === "daily_dca"
      ? index
      : Math.max(0, cache.prevBuyIndex[index]);
    const prefixStart = Math.max(0, effectiveStart);
    const purchaseCount = cache.prefixCount[endIdx + 1] - cache.prefixCount[prefixStart];
    const invPrice = cache.prefixInvPrice[endIdx + 1] - cache.prefixInvPrice[prefixStart];
    const investedUsd = purchaseCount;
    const btcAccum = invPrice;
    const dcaBasis = purchaseCount > 0 && btcAccum > 0 ? investedUsd / btcAccum : NaN;
    const daysAgo = endIdx - index + 1;
    const oneDayDaily = state.cadence === "daily_dca" && daysAgo === 1;

    output.push({
      daysAgo,
      yearsAgo: daysAgo / 365.25,
      dateIso: oneDayDaily ? endRow.dateIso : row.dateIso,
      timestampUtc: oneDayDaily ? endRow.timestampUtc : row.timestampUtc,
      blockHeight: oneDayDaily ? endRow.blockHeight : row.blockHeight,
      historicalPrice: oneDayDaily ? currentPrice : row.price,
      currentPrice,
      dcaBasis: oneDayDaily ? currentPrice : dcaBasis,
      investedUsd: oneDayDaily ? 1 : investedUsd,
      btcAccum: oneDayDaily ? 1 / currentPrice : btcAccum,
      purchaseCount: oneDayDaily ? 1 : purchaseCount,
      isPriceAbove: Number.isFinite(dcaBasis) && currentPrice >= dcaBasis ? 1 : 0,
    });
  }

  return output.sort((a, b) => a.daysAgo - b.daysAgo);
}

function getDateRangeFrameDates(startIso = state.dateRange.startIso, endIso = state.dateRange.endIso, speed = state.dateRange.playbackSpeed) {
  const startIdx = findDateIndex(startIso, "ceil");
  const endIdx = findDateIndex(endIso, "floor");
  if (startIdx < 0 || endIdx < 0 || startIdx > endIdx) return [];
  const dates = [];
  const step = speed >= 1 ? Math.max(1, Math.round(speed)) : 1;
  for (let index = startIdx; index <= endIdx; index += step) {
    dates.push(state.priceRows[index].dateIso);
  }
  if (dates[dates.length - 1] !== state.priceRows[endIdx].dateIso) {
    dates.push(state.priceRows[endIdx].dateIso);
  }
  return dates;
}

function getDateRangeExportFrameDates(startIso = state.dateRange.startIso, endIso = state.dateRange.endIso, speed = state.dateRange.playbackSpeed, includeEndFrameHold = true) {
  const motionDates = getDateRangeFrameDates(startIso, endIso, speed);
  if (!motionDates.length) return [];
  const finalDate = motionDates[motionDates.length - 1];
  const startHoldFrames = includeEndFrameHold
    ? Math.max(0, Math.round(EXPORT_START_HOLD_SECONDS * EXPORT_VIDEO_FPS))
    : 0;
  const endHoldFrames = includeEndFrameHold
    ? Math.max(0, Math.round(EXPORT_END_HOLD_SECONDS * EXPORT_VIDEO_FPS))
    : 0;
  const frames = [
    ...Array.from({ length: startHoldFrames }, () => finalDate),
  ];
  motionDates.forEach((dateIso) => {
    frames.push(dateIso);
    if (Number(speed) === 0.5) frames.push(dateIso);
  });
  frames.push(...Array.from({ length: endHoldFrames }, () => finalDate));
  return frames;
}

function syncDateRangeControls() {
  normalizeDateRangeState();
  const { minIso, maxIso } = getDataBounds();
  const startBtn = document.getElementById("dateRangeStartBtn");
  const endBtn = document.getElementById("dateRangeEndBtn");
  const startInput = document.getElementById("dateRangeStartInput");
  const endInput = document.getElementById("dateRangeEndInput");
  const daysInput = document.getElementById("dateRangeDaysInput");
  const sliderWrap = document.getElementById("dateRangeSliderWrap");
  const startSlider = document.getElementById("dateRangeStartSlider");
  const endSlider = document.getElementById("dateRangeEndSlider");
  const speedBtn = document.getElementById("dateRangeSpeedBtn");
  const playBtn = document.getElementById("dateRangePlayBtn");
  const pauseBtn = document.getElementById("dateRangePauseBtn");
  const stopBtn = document.getElementById("dateRangeStopBtn");
  const playbackActive = state.dateRange.isPlaying || state.dateRange.isPaused;

  if (startInput) {
    startInput.min = minIso;
    startInput.max = state.dateRange.endIso || maxIso;
    startInput.value = state.dateRange.startIso;
  }
  if (startBtn) startBtn.innerHTML = datePickerButtonHtml(state.dateRange.startIso);
  if (endInput) {
    endInput.min = state.dateRange.startIso || minIso;
    endInput.max = maxIso;
    endInput.value = state.dateRange.endIso;
  }
  if (endBtn) endBtn.innerHTML = datePickerButtonHtml(state.dateRange.endIso);
  const minIndex = 0;
  const maxIndex = Math.max(0, state.priceRows.length - 1);
  const startIdx = findDateIndex(state.dateRange.startIso, "ceil");
  const endIdx = findDateIndex(state.dateRange.endIso, "floor");
  const rawCurrentIdx = findDateIndex(state.dateRange.currentEndIso, "floor");
  const currentIdx = Math.max(startIdx, Math.min(endIdx, rawCurrentIdx));
  if (startSlider && endSlider) {
    [startSlider, endSlider].forEach((slider) => {
      slider.min = String(minIndex);
      slider.max = String(maxIndex);
      slider.disabled = maxIndex <= 0;
    });
    startSlider.value = String(Math.max(minIndex, Math.min(maxIndex, startIdx)));
    endSlider.value = String(Math.max(minIndex, Math.min(maxIndex, endIdx)));
  }
  if (sliderWrap) {
    const denom = Math.max(1, maxIndex - minIndex);
    const styles = window.getComputedStyle(sliderWrap);
    const edgePad = Number.parseFloat(styles.getPropertyValue("--slider-edge-pad")) || 0;
    const trackWidth = Math.max(1, sliderWrap.clientWidth - edgePad * 2);
    const pct = (index) => `${((Math.max(minIndex, Math.min(maxIndex, index)) - minIndex) / denom * 100).toFixed(4)}%`;
    const markerPos = (index) => {
      const ratio = (Math.max(minIndex, Math.min(maxIndex, index)) - minIndex) / denom;
      return `${(edgePad + ratio * trackWidth).toFixed(2)}px`;
    };
    sliderWrap.style.setProperty("--slider-start", pct(startIdx));
    sliderWrap.style.setProperty("--slider-end", pct(endIdx));
    sliderWrap.style.setProperty("--slider-current", pct(currentIdx));
    sliderWrap.style.setProperty("--slider-start-marker", markerPos(startIdx));
    sliderWrap.style.setProperty("--slider-end-marker", markerPos(endIdx));
    sliderWrap.style.setProperty("--slider-current-marker", markerPos(currentIdx));
    sliderWrap.classList.toggle("is-ready", maxIndex > 0);
    sliderWrap.classList.toggle("is-playing", state.dateRange.isPlaying);
    sliderWrap.classList.toggle("is-paused", state.dateRange.isPaused);
  }
  if (daysInput) {
    const days = Math.max(1, diffDays(state.dateRange.startIso, state.dateRange.endIso) + 1);
    daysInput.dataset.lastValidValue = String(days);
    if (document.activeElement !== daysInput) {
      daysInput.value = days.toLocaleString("en-US");
    }
  }
  if (speedBtn) speedBtn.textContent = `${state.dateRange.playbackSpeed}x`;
  playBtn?.classList.toggle("is-playing", state.dateRange.isPlaying);
  pauseBtn?.classList.toggle("is-paused", state.dateRange.isPaused);
  if (playBtn) playBtn.disabled = !!state.dateRange.isPlaying;
  if (pauseBtn) pauseBtn.disabled = !playbackActive || !!state.dateRange.isPaused;
  if (stopBtn) stopBtn.disabled = !playbackActive;

  document.querySelectorAll("[data-range-preset]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.rangePreset === state.dateRange.selectedPreset);
  });
  updateDownloadEstimates();
}

function setDateRange(startIso, endIso, preset = "custom") {
  stopDateRangePlayback(false);
  state.dateRange.startIso = clampIsoToData(startIso);
  state.dateRange.endIso = clampIsoToData(endIso);
  state.dateRange.currentEndIso = state.dateRange.endIso;
  state.dateRange.selectedPreset = preset;
  normalizeDateRangeState();
  saveDateRangeState();
  syncDateRangeControls();
  renderChart();
}

function parseDateRangeDaysValue(value) {
  const parsed = Number.parseInt(String(value || "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatDateRangeDaysValue(value) {
  const dayCount = parseDateRangeDaysValue(value);
  return dayCount > 0 ? dayCount.toLocaleString("en-US") : "";
}

function setDateRangeByDayCount(dayCount) {
  const rows = state.priceRows || [];
  if (!rows.length) return;
  const desiredDays = Math.max(1, Math.round(Number(dayCount) || 1));
  const maxIdx = Math.max(0, rows.length - 1);
  let startIdx = findDateIndex(state.dateRange.startIso, "ceil");
  if (startIdx < 0) startIdx = 0;
  startIdx = Math.max(0, Math.min(maxIdx, startIdx));
  let endIdx = startIdx + desiredDays - 1;
  if (endIdx > maxIdx) {
    endIdx = maxIdx;
    startIdx = Math.max(0, endIdx - desiredDays + 1);
  }
  startIdx = Math.max(0, Math.min(maxIdx, startIdx));
  endIdx = Math.max(startIdx, Math.min(maxIdx, endIdx));
  const startIso = rows[startIdx]?.dateIso;
  const endIso = rows[endIdx]?.dateIso;
  if (!startIso || !endIso) return;
  setDateRange(startIso, endIso, "custom");
}

function commitDateRangeDaysInput(input) {
  if (!input) return;
  const dayCount = parseDateRangeDaysValue(input.value);
  if (!dayCount) {
    const fallback = Number.parseInt(input.dataset.lastValidValue || "0", 10);
    input.value = fallback > 0 ? fallback.toLocaleString("en-US") : "";
    return;
  }
  setDateRangeByDayCount(dayCount);
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

function handleDateRangeDaysInput(input) {
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
    setDateRangeByDayCount(dayCount);
  }
}

function setLastAdjustedDateRangeHandle(handle) {
  if (handle === "start" || handle === "end") {
    dateRangeLastAdjustedHandle = handle;
  }
}

function nudgeLastAdjustedDateRangeHandle(delta) {
  if (dateRangeLastAdjustedHandle !== "start" && dateRangeLastAdjustedHandle !== "end") return false;
  const startIdx = findDateIndex(state.dateRange.startIso, "ceil");
  const endIdx = findDateIndex(state.dateRange.endIso, "floor");
  const maxIdx = Math.max(0, state.priceRows.length - 1);
  if (startIdx < 0 || endIdx < 0 || maxIdx <= 0) return false;

  let nextStartIdx = startIdx;
  let nextEndIdx = endIdx;
  if (dateRangeLastAdjustedHandle === "start") {
    nextStartIdx = Math.max(0, Math.min(endIdx, startIdx + delta));
  } else {
    nextEndIdx = Math.max(startIdx, Math.min(maxIdx, endIdx + delta));
  }
  if (nextStartIdx === startIdx && nextEndIdx === endIdx) return false;

  const nextStart = state.priceRows[nextStartIdx]?.dateIso;
  const nextEnd = state.priceRows[nextEndIdx]?.dateIso;
  if (!nextStart || !nextEnd) return false;
  state.dateRange.startIso = nextStart;
  state.dateRange.endIso = nextEnd;
  state.dateRange.currentEndIso = nextEnd;
  state.dateRange.selectedPreset = "custom";
  saveDateRangeState();
  syncDateRangeControls();
  renderChart();
  return true;
}

function stepDateRangePlayback() {
  if (!state.dateRange.isPlaying) return;
  const currentIdx = findDateIndex(state.dateRange.currentEndIso, "floor");
  const endIdx = findDateIndex(state.dateRange.endIso, "floor");
  if (currentIdx < 0 || endIdx < 0 || currentIdx >= endIdx) {
    pauseDateRangePlayback();
    syncDateRangeControls();
    return;
  }
  const step = Math.max(1, Math.round(state.dateRange.playbackSpeed));
  const nextIdx = Math.min(endIdx, currentIdx + step);
  state.dateRange.currentEndIso = state.priceRows[nextIdx].dateIso;
  syncDateRangeControls();
  renderChart();
}

function playDateRangePlayback() {
  const startIdx = findDateIndex(state.dateRange.startIso, "ceil");
  const endIdx = findDateIndex(state.dateRange.endIso, "floor");
  if (startIdx < 0 || endIdx < 0 || startIdx >= endIdx) return;
  if (findDateIndex(state.dateRange.currentEndIso, "floor") >= endIdx) {
    state.dateRange.currentEndIso = state.priceRows[startIdx]?.dateIso || state.dateRange.startIso;
    syncDateRangeControls();
    renderChart();
  }
  state.dateRange.isPlaying = true;
  state.dateRange.isPaused = false;
  hideChartTooltip();
  syncDateRangeControls();
  saveDateRangeState();
  window.clearInterval(state.dateRange.timerId);
  const intervalMs = state.dateRange.playbackSpeed < 1
    ? 1000 / (30 * state.dateRange.playbackSpeed)
    : 1000 / 30;
  bindDateRangePlaybackOutsidePointerActions();
  state.dateRange.timerId = window.setInterval(stepDateRangePlayback, intervalMs);
}

function pauseDateRangePlayback() {
  if (!state.dateRange.isPlaying && !state.dateRange.isPaused) return;
  window.clearInterval(state.dateRange.timerId);
  state.dateRange.timerId = null;
  state.dateRange.isPlaying = false;
  state.dateRange.isPaused = true;
  syncDateRangeControls();
  bindDateRangePlaybackOutsidePointerActions();
  saveDateRangeState();
}

function toggleDateRangePlayback() {
  if (!state.priceRows.length) {
    state.dateRange.pendingSpacePlayback = true;
    return;
  }
  if (state.dateRange.isPlaying) {
    pauseDateRangePlayback();
    return;
  }
  playDateRangePlayback();
}

function stopDateRangePlayback(resetToEnd = true) {
  window.clearInterval(state.dateRange.timerId);
  state.dateRange.timerId = null;
  state.dateRange.isPlaying = false;
  state.dateRange.isPaused = false;
  unbindDateRangePlaybackOutsidePointerActions();
  if (resetToEnd) {
    state.dateRange.currentEndIso = state.dateRange.endIso;
  }
  syncDateRangeControls();
  saveDateRangeState();
}

function isDateRangePlaybackActive() {
  return !!(state.dateRange.isPlaying || state.dateRange.isPaused);
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
    || targetElement?.closest("#costBasisChart")
    || eventPath.some((item) => item instanceof Element && (
      item.classList?.contains("chart-wrap")
      || item.id === "costBasisChart"
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
    toggleDateRangePlayback();
    return;
  }
  stopDateRangePlayback(true);
  renderChart();
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
    if (Math.hypot(deltaX, deltaY) > 30) {
      dateRangePlaybackOutsidePointerTouchState.moved = true;
    }
  };

  const trackTouchEnd = (event) => {
    if (!dateRangePlaybackOutsidePointerTouchState || event.pointerId !== dateRangePlaybackOutsidePointerTouchState.pointerId) return;
    const { moved, info } = dateRangePlaybackOutsidePointerTouchState;
    cleanupTouchTracking();
    if (moved) return;
    handleDateRangePlaybackOutsideClick(info);
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

function cyclePlaybackSpeed() {
  const currentIndex = PLAYBACK_SPEEDS.indexOf(state.dateRange.playbackSpeed);
  const next = PLAYBACK_SPEEDS[(currentIndex + 1) % PLAYBACK_SPEEDS.length] || 1;
  state.dateRange.playbackSpeed = next;
  saveDateRangeState();
  syncDateRangeControls();
}

function getDateRangeRawIndexFromClientX(clientX) {
  const sliderWrap = document.getElementById("dateRangeSliderWrap");
  if (!sliderWrap || !state.priceRows.length) return NaN;
  const rect = sliderWrap.getBoundingClientRect();
  if (!Number.isFinite(rect.width) || rect.width <= 0) return NaN;
  const styles = window.getComputedStyle(sliderWrap);
  const edgePad = Number.parseFloat(styles.getPropertyValue("--slider-edge-pad")) || 0;
  const trackLeft = rect.left + edgePad;
  const trackWidth = Math.max(1, rect.width - edgePad * 2);
  const ratio = (clientX - trackLeft) / trackWidth;
  return Math.round(ratio * Math.max(0, state.priceRows.length - 1));
}

function getDateRangeMarkerClientX(index) {
  const sliderWrap = document.getElementById("dateRangeSliderWrap");
  if (!sliderWrap || !state.priceRows.length) return NaN;
  const rect = sliderWrap.getBoundingClientRect();
  if (!Number.isFinite(rect.width) || rect.width <= 0) return NaN;
  const maxIndex = Math.max(0, state.priceRows.length - 1);
  const styles = window.getComputedStyle(sliderWrap);
  const edgePad = Number.parseFloat(styles.getPropertyValue("--slider-edge-pad")) || 0;
  const ratio = Math.max(0, Math.min(maxIndex, index)) / Math.max(1, maxIndex);
  return rect.left + edgePad + ratio * Math.max(1, rect.width - edgePad * 2);
}

function setCurrentEndFromPointerEvent(event) {
  const rawIndex = getDateRangeRawIndexFromClientX(event.clientX);
  if (!Number.isFinite(rawIndex)) return;
  const startIdx = findDateIndex(state.dateRange.startIso, "ceil");
  const endIdx = findDateIndex(state.dateRange.endIso, "floor");
  const maxIndex = Math.max(0, state.priceRows.length - 1);
  const targetEndIdx = Number.isFinite(dateRangeCurrentMarkerDrag?.targetEndIdx)
    ? dateRangeCurrentMarkerDrag.targetEndIdx
    : endIdx;
  const index = Math.max(startIdx, Math.min(maxIndex, rawIndex));
  if (!state.priceRows[index]) return;
  if (dateRangeCurrentMarkerDrag) {
    const targetEndIso = dateRangeCurrentMarkerDrag.targetEndIso || state.dateRange.endIso;
    state.dateRange.endIso = index > targetEndIdx
      ? state.priceRows[index].dateIso
      : targetEndIso;
  }
  state.dateRange.currentEndIso = state.priceRows[index].dateIso;
  if (dateRangeCurrentMarkerDrag) {
    dateRangeCurrentMarkerDrag.lastRawIndex = rawIndex;
    dateRangeCurrentMarkerDrag.lastIndex = index;
  }
  syncDateRangeControls();
  renderChart();
}

function beginDateRangePlaybackScrub(event, captureTarget = event.currentTarget) {
  if (!state.dateRange.isPlaying && !state.dateRange.isPaused) return;
  if (typeof event.button === "number" && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  dateRangeCurrentMarkerDrag = {
    pointerId: Number.isFinite(event.pointerId) ? event.pointerId : null,
    resumeAfterRelease: state.dateRange.isPlaying,
    captureTarget,
    targetEndIdx: findDateIndex(state.dateRange.endIso, "floor"),
    targetEndIso: state.dateRange.endIso,
    lastRawIndex: getDateRangeRawIndexFromClientX(event.clientX),
  };
  if (state.dateRange.isPlaying) {
    pauseDateRangePlayback();
  }
  if (captureTarget && Number.isFinite(event.pointerId) && typeof captureTarget.setPointerCapture === "function") {
    try {
      captureTarget.setPointerCapture(event.pointerId);
    } catch (_) {
      // Best effort only.
    }
  }
  setCurrentEndFromPointerEvent(event);
}

function beginDateRangeCurrentMarkerDrag(event) {
  beginDateRangePlaybackScrub(event, event.currentTarget);
}

function beginDateRangeHandleDrag(event, handle, captureTarget = event.currentTarget) {
  if (typeof event.button === "number" && event.button !== 0) return;
  const startIdx = findDateIndex(state.dateRange.startIso, "ceil");
  const endIdx = findDateIndex(state.dateRange.endIso, "floor");
  if (startIdx < 0 || endIdx < 0) return;
  event.preventDefault();
  event.stopPropagation();
  if (state.dateRange.isPlaying || state.dateRange.isPaused) {
    stopDateRangePlayback(false);
  }
  setLastAdjustedDateRangeHandle(handle);
  dateRangeHandleDrag = {
    pointerId: Number.isFinite(event.pointerId) ? event.pointerId : null,
    handle,
    startClientX: event.clientX,
    startIdx,
    endIdx,
  };
  if (captureTarget && Number.isFinite(event.pointerId) && typeof captureTarget.setPointerCapture === "function") {
    try {
      captureTarget.setPointerCapture(event.pointerId);
    } catch (_) {
      // Best effort only.
    }
  }
  setDateRangeHandleFromPointerEvent(event);
}

function beginDateRangeSliderWrapScrub(event) {
  if (event.target?.closest?.(".date-range-current-marker")) return;
  const staticMarker = event.target?.closest?.(".date-range-static-marker");
  if (staticMarker?.classList.contains("date-range-start-marker")) {
    beginDateRangeHandleDrag(event, "start", event.currentTarget);
    return;
  }
  if (staticMarker?.classList.contains("date-range-end-marker")) {
    beginDateRangeHandleDrag(event, "end", event.currentTarget);
    return;
  }
  if (state.dateRange.isPlaying || state.dateRange.isPaused) {
    beginDateRangePlaybackScrub(event, event.currentTarget);
    return;
  }
  if (typeof event.button === "number" && event.button !== 0) return;
  const startIdx = findDateIndex(state.dateRange.startIso, "ceil");
  const endIdx = findDateIndex(state.dateRange.endIso, "floor");
  if (startIdx < 0 || endIdx < 0) return;
  const startX = getDateRangeMarkerClientX(startIdx);
  const endX = getDateRangeMarkerClientX(endIdx);
  if (!Number.isFinite(startX) || !Number.isFinite(endX)) return;
  const pointerX = event.clientX;
  const handleGuardPx = 12;
  const nearStart = Math.abs(pointerX - startX) <= handleGuardPx;
  const nearEnd = Math.abs(pointerX - endX) <= handleGuardPx;
  const selectedSegment = pointerX > startX + handleGuardPx && pointerX < endX - handleGuardPx;
  if (!nearStart && !nearEnd && !selectedSegment) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = nearStart && nearEnd
    ? (Math.abs(pointerX - startX) <= Math.abs(pointerX - endX) ? "start" : "end")
    : (nearStart ? "start" : "end");
  dateRangeHandleDrag = {
    pointerId: Number.isFinite(event.pointerId) ? event.pointerId : null,
    handle: selectedSegment ? "range" : handle,
    startClientX: pointerX,
    startIdx,
    endIdx,
  };
  if (event.currentTarget && Number.isFinite(event.pointerId) && typeof event.currentTarget.setPointerCapture === "function") {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch (_) {
      // Best effort only.
    }
  }
}

function setDateRangeHandleFromPointerEvent(event) {
  if (!dateRangeHandleDrag) return;
  const rawIndex = getDateRangeRawIndexFromClientX(event.clientX);
  if (!Number.isFinite(rawIndex) || !state.priceRows.length) return;
  const maxIndex = state.priceRows.length - 1;
  const startIdx = findDateIndex(state.dateRange.startIso, "ceil");
  const endIdx = findDateIndex(state.dateRange.endIso, "floor");
  if (startIdx < 0 || endIdx < 0) return;
  const clamped = Math.max(0, Math.min(maxIndex, rawIndex));
  let nextStartIdx = dateRangeHandleDrag.handle === "start" ? Math.min(clamped, endIdx) : startIdx;
  let nextEndIdx = dateRangeHandleDrag.handle === "end" ? Math.max(clamped, startIdx) : endIdx;
  if (dateRangeHandleDrag.handle === "range") {
    const initialStart = Number.isFinite(dateRangeHandleDrag.startIdx) ? dateRangeHandleDrag.startIdx : startIdx;
    const initialEnd = Number.isFinite(dateRangeHandleDrag.endIdx) ? dateRangeHandleDrag.endIdx : endIdx;
    const initialPointerIndex = getDateRangeRawIndexFromClientX(dateRangeHandleDrag.startClientX);
    if (!Number.isFinite(initialPointerIndex)) return;
    const shift = Math.round(rawIndex - initialPointerIndex);
    const minShift = -initialStart;
    const maxShift = maxIndex - initialEnd;
    const safeShift = Math.max(minShift, Math.min(maxShift, shift));
    nextStartIdx = initialStart + safeShift;
    nextEndIdx = initialEnd + safeShift;
  }
  const nextStart = state.priceRows[nextStartIdx]?.dateIso;
  const nextEnd = state.priceRows[nextEndIdx]?.dateIso;
  if (!nextStart || !nextEnd) return;
  if (state.dateRange.startIso === nextStart && state.dateRange.endIso === nextEnd) return;
  if (dateRangeHandleDrag.handle === "start" || dateRangeHandleDrag.handle === "end") {
    setLastAdjustedDateRangeHandle(dateRangeHandleDrag.handle);
  }
  state.dateRange.startIso = nextStart;
  state.dateRange.endIso = nextEnd;
  state.dateRange.currentEndIso = nextEnd;
  state.dateRange.selectedPreset = "custom";
  saveDateRangeState();
  syncDateRangeControls();
  renderChart();
}

function moveDateRangeCurrentMarkerDrag(event) {
  if (dateRangeHandleDrag) {
    if (Number.isFinite(dateRangeHandleDrag.pointerId)
      && Number.isFinite(event.pointerId)
      && event.pointerId !== dateRangeHandleDrag.pointerId) {
      return;
    }
    event.preventDefault();
    setDateRangeHandleFromPointerEvent(event);
    return;
  }
  if (!dateRangeCurrentMarkerDrag) return;
  if (Number.isFinite(dateRangeCurrentMarkerDrag.pointerId)
    && Number.isFinite(event.pointerId)
    && event.pointerId !== dateRangeCurrentMarkerDrag.pointerId) {
    return;
  }
  event.preventDefault();
  setCurrentEndFromPointerEvent(event);
}

function endDateRangeCurrentMarkerDrag(event) {
  if (dateRangeHandleDrag) {
    if (Number.isFinite(dateRangeHandleDrag.pointerId)
      && Number.isFinite(event.pointerId)
      && event.pointerId !== dateRangeHandleDrag.pointerId) {
      return;
    }
    const captureTarget = event.currentTarget;
    if (captureTarget && Number.isFinite(event.pointerId) && typeof captureTarget.releasePointerCapture === "function") {
      try {
        captureTarget.releasePointerCapture(event.pointerId);
      } catch (_) {
        // Best effort only.
      }
    }
    dateRangeHandleDrag = null;
    return;
  }
  if (!dateRangeCurrentMarkerDrag) return;
  if (Number.isFinite(dateRangeCurrentMarkerDrag.pointerId)
    && Number.isFinite(event.pointerId)
    && event.pointerId !== dateRangeCurrentMarkerDrag.pointerId) {
    return;
  }
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

  const endIdx = Number.isFinite(scrubState.targetEndIdx)
    ? scrubState.targetEndIdx
    : findDateIndex(state.dateRange.endIso, "floor");
  const releasedAtOrPastEnd = Number.isFinite(scrubState.lastRawIndex)
    && Number.isFinite(endIdx)
    && scrubState.lastRawIndex >= endIdx;
  if (releasedAtOrPastEnd) {
    state.dateRange.currentEndIso = state.dateRange.endIso;
    stopDateRangePlayback(false);
    renderChart();
    return;
  }

  if (scrubState.resumeAfterRelease) {
    playDateRangePlayback();
  } else {
    saveDateRangeState();
  }
}

function bindDateRangeSessionPersistence() {
  if (dateRangeSessionPersistenceBound) return;
  dateRangeSessionPersistenceBound = true;

  const persistSessionSnapshot = () => {
    saveDateRangeState();
  };

  window.addEventListener("pagehide", persistSessionSnapshot);
  window.addEventListener("beforeunload", persistSessionSnapshot);
}

function isSpaceShortcutTextEntry(active) {
  const textInputTypes = ["text", "search", "email", "password", "url", "tel", "number"];
  return !!(
    active
    && (
      (active.tagName === "INPUT" && textInputTypes.includes(String(active.type || "").toLowerCase()))
      || active.tagName === "TEXTAREA"
      || active.tagName === "SELECT"
      || active.isContentEditable
    )
  );
}

function isArrowShortcutFormEntry(active) {
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
    active === document.getElementById("dateRangeStartSlider")
    || active === document.getElementById("dateRangeEndSlider")
    || active === document.getElementById("dateRangePlayBtn")
    || active === document.getElementById("dateRangePauseBtn")
    || active === document.getElementById("dateRangeStopBtn")
    || active === document.getElementById("dateRangeSpeedBtn")
    || active?.matches?.("[data-range-preset]")
  ) {
    active.blur();
  }
}

function setDateRangeCurrentEndByIndex(index) {
  const startIdx = findDateIndex(state.dateRange.startIso, "ceil");
  const endIdx = findDateIndex(state.dateRange.endIso, "floor");
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return false;
  const nextIndex = Math.max(startIdx, Math.min(endIdx, Math.round(index)));
  if (!state.priceRows[nextIndex]) return false;
  state.dateRange.currentEndIso = state.priceRows[nextIndex].dateIso;
  syncDateRangeControls();
  renderChart();
  return true;
}

function bindDateRangeKeyboardShortcuts() {
  if (dateRangeKeyboardShortcutsBound) return;
  dateRangeKeyboardShortcutsBound = true;

  window.addEventListener("keydown", (event) => {
    if (!(event.key === " " || event.code === "Space")) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (isSpaceShortcutTextEntry(document.activeElement)) return;

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }

    blurDateRangeSliderIfFocused();
    toggleDateRangePlayback();
    requestAnimationFrame(blurDateRangeSliderIfFocused);
  }, true);

  window.addEventListener("keydown", (event) => {
    const isPlaybackActive = state.dateRange.isPlaying || state.dateRange.isPaused;

    if (event.key === "Escape") {
      if (!isPlaybackActive) return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      stopDateRangePlayback(true);
      renderChart();
      return;
    }

    const isArrowLeft = event.key === "ArrowLeft";
    const isArrowRight = event.key === "ArrowRight";
    const isComma = event.key === "," || event.code === "Comma";
    const isPeriod = event.key === "." || event.code === "Period";
    if (!isArrowLeft && !isArrowRight && !isComma && !isPeriod) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (isArrowShortcutFormEntry(document.activeElement)) return;

    if (!isPlaybackActive) {
      if (!isArrowLeft && !isArrowRight) return;
      if (dateRangeLastAdjustedHandle !== "start" && dateRangeLastAdjustedHandle !== "end") return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      blurDateRangeSliderIfFocused();
      nudgeLastAdjustedDateRangeHandle(isArrowRight ? 1 : -1);
      requestAnimationFrame(blurDateRangeSliderIfFocused);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }

    const startIdx = findDateIndex(state.dateRange.startIso, "ceil");
    const endIdx = findDateIndex(state.dateRange.endIso, "floor");
    const currentIdx = findDateIndex(state.dateRange.currentEndIso, "floor");
    if (startIdx < 0 || endIdx < 0 || currentIdx < 0 || endIdx < startIdx) return;

    const daysPerSecond = 30 * Math.max(0.5, Number(state.dateRange.playbackSpeed) || 1);
    const framesFor10Seconds = Math.max(1, Math.round(10 * daysPerSecond));
    let nextIdx = currentIdx;
    if (isArrowRight) {
      nextIdx = Math.min(endIdx, currentIdx + framesFor10Seconds);
    } else if (isArrowLeft) {
      nextIdx = Math.max(startIdx, currentIdx - framesFor10Seconds);
    } else if (isPeriod) {
      nextIdx = Math.min(endIdx, currentIdx + 1);
    } else if (isComma) {
      nextIdx = Math.max(startIdx, currentIdx - 1);
    }

    if (nextIdx !== currentIdx) {
      setDateRangeCurrentEndByIndex(nextIdx);
      if (isArrowRight && state.dateRange.isPlaying && nextIdx === endIdx) {
        pauseDateRangePlayback();
      }
    }
  }, true);
}

function primeKeyboardFocus() {
  // Match the UoA dashboard so the iframe owns the initial keyboard shortcuts.
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
  document.body.classList.toggle("dca-dashboard-expanded", !!expanded);
  const expandBtn = document.getElementById("dashboardExpandBtn");
  if (expandBtn) {
    expandBtn.setAttribute("aria-pressed", String(!!expanded));
    expandBtn.setAttribute("aria-label", expanded ? "Shrink video layout" : "Expand video layout");
    expandBtn.setAttribute("title", expanded ? "Shrink video layout" : "Expand video layout");
  }
  try {
    window.parent?.postMessage({ type: "wsb-dca-dashboard-expanded", expanded: !!expanded }, window.location.origin);
  } catch (_) {
    // Ignore parent messaging failures.
  }
  requestAnimationFrame(() => {
    renderChart();
    requestAnimationFrame(renderChart);
  });
}

function bindDashboardExpandButton() {
  const expandBtn = document.getElementById("dashboardExpandBtn");
  if (!expandBtn || expandBtn.dataset.bound === "1") return;
  expandBtn.dataset.bound = "1";
  expandBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    setDashboardExpandedMode(!document.body.classList.contains("dca-dashboard-expanded"));
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
    scale: ["linear", "log"].includes(settings.scale) ? settings.scale : state.yScale,
    orientation: ["landscape", "portrait", "square"].includes(settings.orientation) ? settings.orientation : "landscape",
    quality: ["720", "1080", "1440", "2160"].includes(String(settings.quality)) ? String(settings.quality) : "720",
    speed: ["0.5", "1", "2", "4"].includes(String(settings.speed)) ? String(settings.speed) : String(state.dateRange.playbackSpeed || 1),
    theme: ["light", "dark"].includes(settings.theme) ? settings.theme : currentTheme,
    extension: ["mp4", "webm"].includes(settings.extension) ? settings.extension : "mp4",
    endFrameHold: settings.endFrameHold !== false,
  };
}

function getDownloadDimensions(settings) {
  const quality = Number(settings.quality) || 720;
  if (settings.orientation === "portrait") return { width: quality, height: Math.round(quality * 16 / 9) };
  if (settings.orientation === "square") return { width: quality, height: quality };
  return { width: Math.round(quality * 16 / 9), height: quality };
}

function getExportReferenceSettings(settings) {
  return { ...settings, quality: "1440" };
}

function getDownloadVideoSeconds(settings = state.downloadSettings) {
  const frameDates = getDateRangeExportFrameDates(
    state.dateRange.startIso,
    state.dateRange.endIso,
    Number(settings.speed) || 1,
    settings.endFrameHold,
  );
  return frameDates.length ? frameDates.length / EXPORT_VIDEO_FPS : 0;
}

function getDownloadEstimateCalibrationKey(settings, frameDates) {
  const { width, height } = getDownloadDimensions(settings);
  return [
    state.cadence,
    state.dateRange.startIso,
    state.dateRange.endIso,
    settings.scale,
    settings.orientation,
    settings.quality,
    settings.speed,
    settings.theme,
    settings.endFrameHold ? "hold" : "no-hold",
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
  if (isDateRangeExporting || downloadEstimateCalibrationCache.has(key) || downloadEstimateCalibrationPending.has(key)) return;
  downloadEstimateCalibrationPending.add(key);
  const requestId = ++downloadEstimateCalibrationRequestId;
  const representativeDates = getRepresentativeExportFrameDates(frameDates);
  if (!representativeDates.length) {
    downloadEstimateCalibrationPending.delete(key);
    return;
  }

  try {
    await waitForDateRangeExportFonts();
    if (requestId !== downloadEstimateCalibrationRequestId) return;

    const { width, height } = getDownloadDimensions(settings);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const palette = getPaletteForTheme(settings.theme);

    const started = performance.now();
    for (const dateIso of representativeDates) {
      if (requestId !== downloadEstimateCalibrationRequestId) return;
      const rows = getFrameRows(state.dateRange.startIso, dateIso);
      await drawExportFrame(ctx, canvas, dateIso, settings, palette, rows);
    }
    const msPerFrame = (performance.now() - started) / representativeDates.length;
    if (!Number.isFinite(msPerFrame) || msPerFrame <= 0) return;
    downloadEstimateCalibrationCache.set(key, {
      msPerFrame,
      sampleCount: representativeDates.length,
    });
    if (requestId === downloadEstimateCalibrationRequestId) updateDownloadEstimates();
  } catch (error) {
    console.warn("Unable to calibrate DCA export estimate.", error);
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

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

function updateDownloadEstimates() {
  const sizeEl = document.getElementById("downloadEstimateSize");
  const lengthEl = document.getElementById("downloadEstimateLength");
  const timeEl = document.getElementById("downloadEstimateTime");
  if (!sizeEl || !lengthEl || !timeEl) return;
  const settings = normalizeDownloadSettings(state.downloadSettings);
  const { width, height } = getDownloadDimensions(settings);
  const seconds = getDownloadVideoSeconds(settings);
  const frameDates = getDateRangeExportFrameDates(state.dateRange.startIso, state.dateRange.endIso, Number(settings.speed) || 1, settings.endFrameHold);
  const uniqueFrameCount = new Set(frameDates).size;
  const calibrationKey = getDownloadEstimateCalibrationKey(settings, frameDates);
  const calibration = downloadEstimateCalibrationCache.get(calibrationKey);
  const bitrate = getDateRangeExportBitrate(settings);
  const extensionMultiplier = settings.extension === "webm" ? 0.78 : 1;
  const bytes = (seconds * bitrate / 8) * extensionMultiplier;
  const mb = bytes / (1024 * 1024);
  const fallbackRenderSeconds = Math.max(1, uniqueFrameCount * 0.035 * (width * height) / (1280 * 720));
  const calibratedRenderSeconds = calibration
    ? Math.max(1, (uniqueFrameCount * calibration.msPerFrame) / 1000)
    : null;
  sizeEl.textContent = `${Math.max(1, Math.round(mb)).toLocaleString("en-US")} MB`;
  lengthEl.textContent = formatDuration(seconds);
  timeEl.textContent = `~${formatDuration(seconds + (calibratedRenderSeconds ?? fallbackRenderSeconds))}`;
  if (!calibration && frameDates.length) {
    scheduleDownloadEstimateCalibration(settings, frameDates, calibrationKey);
  }
}

function syncDownloadSettingsControls() {
  loadDownloadSettings();
  const groups = {
    downloadScaleSelect: state.downloadSettings.scale,
    downloadOrientationSelect: state.downloadSettings.orientation,
    downloadQualitySelect: state.downloadSettings.quality,
    downloadSpeedSelect: state.downloadSettings.speed,
    downloadThemeSelect: state.downloadSettings.theme,
    downloadExtensionSelect: state.downloadSettings.extension,
  };
  Object.entries(groups).forEach(([id, value]) => {
    const group = document.getElementById(id);
    if (!group) return;
    group.querySelectorAll(".download-setting-option[data-value]").forEach((button) => {
      const selected = button.dataset.value === value;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  });
  const endFrameHoldToggle = document.getElementById("downloadEndFrameHoldToggle");
  if (endFrameHoldToggle) endFrameHoldToggle.checked = !!state.downloadSettings.endFrameHold;
  syncDownloadSettingsDownloadButton();
  updateDownloadEstimates();
}

function renderDateRangeDownloadButtonProgress(progress = 0) {
  const downloadBtn = document.getElementById("dateRangeDownloadBtn");
  if (!downloadBtn) return;
  const progressPct = `${Math.max(0, Math.min(1, Number(progress) || 0)) * 100}%`;
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
  const downloadBtn = document.getElementById("dateRangeDownloadBtn");
  if (!downloadBtn) return;
  downloadBtn.classList.remove("is-exporting", "is-canceling");
  downloadBtn.disabled = false;
  downloadBtn.setAttribute("aria-label", "Download date range animation");
  downloadBtn.setAttribute("title", "Download animation");
  downloadBtn.textContent = "↓";
  syncDownloadSettingsDownloadButton();
}

function syncDownloadSettingsDownloadButton() {
  const button = document.getElementById("downloadSettingsDownloadBtn");
  if (!button) return;
  button.classList.toggle("is-stop-download", isDateRangeExporting);
  button.textContent = isDateRangeExporting ? "Stop Download" : "Download Animation";
}

function requestDateRangeExportCancel() {
  if (!isDateRangeExporting) return;
  dateRangeExportCancelRequested = true;
  const downloadBtn = document.getElementById("dateRangeDownloadBtn");
  if (downloadBtn) {
    downloadBtn.classList.add("is-canceling");
    downloadBtn.setAttribute("aria-label", "Canceling animation download");
    downloadBtn.setAttribute("title", "Canceling download");
  }
  syncDownloadSettingsDownloadButton();
}

function broadcastDateRangeExportActive(active) {
  try {
    window.dateRangeExportActive = !!active;
    if (window.parent && window.parent !== window) {
      window.parent.dateRangeExportActive = !!active;
      window.parent.postMessage({ type: "wsb-dca-date-range-export-active", active: !!active }, window.location.origin);
    }
  } catch (_) {
    // Best effort only.
  }
}

function bindDateRangeExportUnloadGuard() {
  if (window.dcaDateRangeExportUnloadGuardBound === true) return;
  window.dcaDateRangeExportUnloadGuardBound = true;
  window.addEventListener("beforeunload", (event) => {
    if (!isDateRangeExporting) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function buildStandaloneChartSvg(rows, width, height, colors, yScale = state.yScale) {
  if (!rows.length) return "";
  const x = rows.map((r) => r.daysAgo);
  const historicalPrice = rows.map((r) => r.historicalPrice);
  const dcaBasis = rows.map((r) => r.dcaBasis);
  const priceUp = rows.map((r) => (r.isPriceAbove === 1 ? r.historicalPrice : null));
  const priceDown = rows.map((r) => (r.isPriceAbove === 0 ? r.historicalPrice : null));
  for (let i = 0; i < rows.length - 1; i += 1) {
    if (rows[i].isPriceAbove === rows[i + 1].isPriceAbove) continue;
    if (rows[i].isPriceAbove === 1) priceUp[i + 1] = rows[i + 1].historicalPrice;
    else priceDown[i + 1] = rows[i + 1].historicalPrice;
  }
  const latestRow = rows[rows.length - 1];
  const rawCurrentPrice = Number.isFinite(latestRow.currentPrice) ? latestRow.currentPrice : latestRow.historicalPrice;
  const maxDays = Math.max(...x);
  const ticks = buildDurationTickConfig(maxDays);
  const dateTicks = buildDateTickConfig(rows, width);
  const allYValues = [
    ...historicalPrice.filter((v) => Number.isFinite(v) && v >= 0),
    ...dcaBasis.filter((v) => Number.isFinite(v) && v >= 0),
  ];
  if (Number.isFinite(rawCurrentPrice) && rawCurrentPrice >= 0) allYValues.push(rawCurrentPrice);
  const currentPrice = Number.isFinite(rawCurrentPrice) && rawCurrentPrice > 0
    ? rawCurrentPrice
    : (allYValues.length ? allYValues[allYValues.length - 1] : NaN);
  const labelSizes = scaleChartLabelSizes(getResponsiveChartLabelSizes(width), EXPORT_CHART_TEXT_SCALE);
  const cadenceLabel = getCadenceLabel();
  const legendFontSize = Math.max(12, Number((labelSizes.tick * 0.76).toFixed(2)));
  const currentPriceOverlayMetrics = getCurrentPriceOverlayMetrics(labelSizes);
  const legendHeight = Math.max(28, Math.round(legendFontSize * 1.95));
  const margins = {
    top: legendHeight + Math.max(78, Math.round(height * 0.068)),
    right: Math.max(104, Math.round(width * 0.055), currentPriceOverlayMetrics.rightMargin + 20),
    bottom: Math.max(96, Math.round(height * 0.086)),
    left: Math.max(32, Math.round(width * 0.018)),
  };
  const topTitleY = legendHeight + Math.round((margins.top - legendHeight) * 0.52);
  const topTickY = margins.top + Math.round(labelSizes.topTick * 0.7);
  const bottomTickY = height - Math.round(margins.bottom * 0.55);
  const bottomTitleY = height - Math.round(margins.bottom * 0.16);
  const plotLeft = margins.left;
  const plotRight = width - margins.right;
  const plotTop = margins.top + 26;
  const plotBottom = height - margins.bottom - 8;
  const yAxis = buildYScaleConfig(allYValues, yScale);
  const xForDay = (day) => {
    const ratio = (maxDays - day) / Math.max(1, maxDays - 1);
    return plotLeft + (ratio * Math.max(1, plotRight - plotLeft));
  };
  const yForValue = (value) => yAxis.map(value, plotTop, Math.max(1, plotBottom - plotTop));
  const rawBottomTicks = maxDays >= 365 && maxDays <= 365 * 4
    ? ticks
    : filterTicksByPixelSpacing(
      ticks.tickvals,
      ticks.ticktext,
      (day) => xForDay(day),
      width < 900 ? 56 : 38,
    );
  const topTicks = filterDateTicksByPixelSpacing(
    dateTicks.tickvals,
    dateTicks.ticktext,
    (day) => xForDay(day),
    width < 900 ? 82 : 58,
  );
  const { bottomTicks, topTicks: balancedTopTicks } = balanceXAxisTickCounts(rawBottomTicks, topTicks);
  const rightTicks = filterTicksByPixelSpacing(
    yAxis.tickvals,
    yAxis.ticktext,
    (value) => yForValue(value),
    labelSizes.yTick * 1.45,
    { preserveFirst: true, preserveLast: true },
  );
  return buildChartSvgMarkup({
    width,
    height,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    xForDay,
    yForValue,
    bottomTicks,
    topTicks: balancedTopTicks,
    rightTicks,
    colors,
    rows,
    priceUp,
    priceDown,
    dcaBasis,
    currentPrice,
    maxDays,
    topTitleY,
    topTickY,
    bottomTickY,
    bottomTitleY,
    labelSizes,
    yScale,
    renderCurrentPriceLabel: true,
    renderLegend: true,
    legendFontSize,
    exportHalvingLabelSpacing: true,
    axisTitleX: width / 2,
    startDateX: margins.left,
    currentDateX: width - margins.left,
    topAxisTitle: `${cadenceLabel} Starting Date`,
    bottomAxisTitle: `${cadenceLabel} Duration`,
    lineWidths: {
      price: 5.8,
      basis: 6.4,
      current: 2.4,
      grid: 1,
    },
  });
}

function scaleChartLabelSizes(labelSizes, scale = 1) {
  return Object.fromEntries(Object.entries(labelSizes || {}).map(([key, value]) => [
    key,
    Number((Number(value || 0) * scale).toFixed(2)),
  ]));
}

function getCadenceLabel(cadence = state.cadence) {
  if (cadence === "weekly_dca") return "Weekly DCA";
  if (cadence === "monthly_dca") return "Monthly DCA";
  return "Daily DCA";
}

function getResponsiveChartLabelSizes(width = window.innerWidth) {
  const safeWidth = Number.isFinite(width) ? width : window.innerWidth;
  const progress = Math.max(0, Math.min(1, (safeWidth - 420) / 900));
  const tick = 12 + (progress * 6);
  return {
    tick: Number(tick.toFixed(2)),
    topTick: Number(Math.max(11, tick - 1).toFixed(2)),
    yTick: Number(tick.toFixed(2)),
    halving: Number(Math.max(11, tick * 0.78).toFixed(2)),
    halvingCostBasis: Number(Math.max(12, tick * 0.9).toFixed(2)),
    title: Number(Math.max(12, tick).toFixed(2)),
    currentPrice: Number((tick * 1.12).toFixed(2)),
  };
}

function getCurrentPriceOverlayMetrics(labelSizes) {
  const fontSize = Number(labelSizes?.currentPrice) || 13;
  const sixDigitPriceChars = "$999,999".length;
  const textWidth = sixDigitPriceChars * fontSize * 0.62;
  const horizontalPadding = 12;
  const borderWidth = 2;
  const minWidth = Math.ceil(textWidth + horizontalPadding + borderWidth);
  return {
    minWidth,
    rightMargin: minWidth + 18,
  };
}

function getPaletteForTheme(theme) {
  const prior = document.documentElement.dataset.theme;
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  }
  const colors = getThemeColors();
  const bg = document.documentElement.dataset.theme === "light" ? "#ffffff" : "#000000";
  const isLight = document.documentElement.dataset.theme === "light";
  if (prior) document.documentElement.dataset.theme = prior;
  else delete document.documentElement.dataset.theme;
  return {
    ...colors,
    bg,
    up: isLight ? "#0f7f42" : "#18a957",
    down: isLight ? "#a92631" : "#c92c39",
  };
}

function imageFromSvg(svgMarkup) {
  return new Promise((resolve, reject) => {
    const markup = String(svgMarkup || "").replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
    const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = "sync";
    image.onload = () => {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to render SVG frame."));
    };
    image.src = url;
  });
}

function scaleSvgRoot(svgMarkup, width, height, viewWidth, viewHeight) {
  return String(svgMarkup || "").replace(
    /<svg\b([^>]*)\bwidth="[^"]+"\s+height="[^"]+"\s+viewBox="[^"]+"/,
    `<svg$1width="${width}" height="${height}" viewBox="0 0 ${viewWidth} ${viewHeight}"`
  );
}

function getSupportedRecorder(extension = "mp4") {
  if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== "function") return null;
  const byExtension = {
    mp4: ["video/mp4;codecs=avc1.42E01E", "video/mp4"],
    webm: ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"],
  };
  const fallback = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const candidates = [...(byExtension[extension] || []), ...fallback];
  const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!mimeType) return null;
  return { mimeType, extension: mimeType.includes("mp4") ? "mp4" : "webm" };
}

function getDateRangeExportBitrate(settings) {
  return Math.max(4_000_000, Number(settings.quality) * 8000);
}

function getDateRangeExportBatchSize(settings) {
  const { width, height } = getDownloadDimensions(settings);
  const frameBytes = Math.max(1, width * height * 4);
  const budgetFrames = Math.floor(EXPORT_BATCH_MEMORY_BUDGET / frameBytes);
  return Math.max(EXPORT_MIN_BATCH_FRAMES, Math.min(EXPORT_MAX_BATCH_FRAMES, budgetFrames));
}

function closeDateRangeExportFrames(frameCache) {
  frameCache.forEach((frame) => {
    if (typeof frame?.close === "function") frame.close();
  });
  frameCache.clear();
}

function transitionMediaRecorder(recorder, eventName, action) {
  return new Promise((resolve, reject) => {
    recorder.addEventListener(eventName, resolve, { once: true });
    recorder.addEventListener("error", () => reject(recorder.error || new Error("Recording failed")), { once: true });
    action();
  });
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
    ebmlElement(0x258688, ebmlAscii("DCA Cost Basis")),
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
      framerate: EXPORT_VIDEO_FPS,
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

async function encodeDateRangeAnimationWebM({ canvas, ctx, settings, theme, palette, frameDates }) {
  const encoderConfig = await getSupportedWebCodecsExportConfig(canvas.width, canvas.height, settings);
  if (!encoderConfig) return null;
  const encodedFrames = [];
  const frameDurationUs = Math.round(1000000 / EXPORT_VIDEO_FPS);
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
  for (const dateIso of frameDates) {
    if (dateRangeExportCancelRequested) break;
    const rows = getFrameRows(state.dateRange.startIso, dateIso);
    await drawExportFrame(ctx, canvas, dateIso, { ...settings, theme }, palette, rows);
    const timestamp = frameIndex * frameDurationUs;
    const frame = new VideoFrame(canvas, {
      timestamp,
      duration: frameDurationUs,
    });
    encoder.encode(frame, { keyFrame: frameIndex % EXPORT_VIDEO_FPS === 0 });
    frame.close();
    if (encodeError) throw encodeError;
    frameIndex += 1;
    renderDateRangeDownloadButtonProgress(frameIndex / Math.max(1, frameDates.length));
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
  if (dateRangeExportCancelRequested) return null;
  encodedFrames.sort((a, b) => a.timestamp - b.timestamp);
  return buildWebMBlob(encodedFrames, canvas.width, canvas.height, EXPORT_VIDEO_FPS, encoderConfig.webmCodecId);
}

async function encodeDateRangeAnimationMp4({ canvas, ctx, settings, theme, palette, frameDates }) {
  const muxer = window.WSBMp4Muxer;
  if (!muxer?.getSupportedAvcConfig || !muxer?.buildMp4Blob) return null;
  const encoderConfig = await muxer.getSupportedAvcConfig(
    canvas.width,
    canvas.height,
    getDateRangeExportBitrate(settings),
    EXPORT_VIDEO_FPS
  );
  if (!encoderConfig) return null;
  const samples = [];
  const frameDurationUs = Math.round(1000000 / EXPORT_VIDEO_FPS);
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
  for (const dateIso of frameDates) {
    if (dateRangeExportCancelRequested) break;
    const rows = getFrameRows(state.dateRange.startIso, dateIso);
    await drawExportFrame(ctx, canvas, dateIso, { ...settings, theme }, palette, rows);
    const timestamp = frameIndex * frameDurationUs;
    const frame = new VideoFrame(canvas, {
      timestamp,
      duration: frameDurationUs,
    });
    encoder.encode(frame, { keyFrame: frameIndex % EXPORT_VIDEO_FPS === 0 });
    frame.close();
    if (encodeError) throw encodeError;
    frameIndex += 1;
    renderDateRangeDownloadButtonProgress(frameIndex / Math.max(1, frameDates.length));
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
  if (dateRangeExportCancelRequested) return null;
  return muxer.buildMp4Blob({
    width: canvas.width,
    height: canvas.height,
    fps: EXPORT_VIDEO_FPS,
    samples,
    avcConfig,
  });
}

async function waitForDateRangeExportFonts() {
  if (!document.fonts?.ready) return;
  try {
    await document.fonts.ready;
  } catch (_) {
    // Font readiness is best-effort only.
  }
}

async function drawExportFrame(ctx, canvas, frameEndIso, settings, palette, precomputedRows = null) {
  const referenceSettings = getExportReferenceSettings(settings);
  const { width: referenceWidth, height: referenceHeight } = getDownloadDimensions(referenceSettings);
  const referenceMinDimension = Math.min(referenceWidth, referenceHeight);
  const referencePanelPad = Math.max(8, Math.round(referenceMinDimension * 0.012));
  const referenceFooterHeight = Math.max(34, Math.round(referenceMinDimension * 0.052));
  const referenceChartWidth = referenceWidth - referencePanelPad * 2;
  const referenceChartHeight = referenceHeight - referencePanelPad * 2 - referenceFooterHeight;
  const scale = canvas.height / Math.max(1, referenceHeight);
  const panelPad = Math.round(referencePanelPad * scale);
  const footerHeight = Math.round(referenceFooterHeight * scale);
  const chartWidth = canvas.width - panelPad * 2;
  const chartHeight = canvas.height - panelPad * 2 - footerHeight;
  const rows = Array.isArray(precomputedRows)
    ? precomputedRows
    : getFrameRows(state.dateRange.startIso, frameEndIso);
  const svg = buildStandaloneChartSvg(rows, referenceChartWidth, referenceChartHeight, palette, settings.scale);
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (svg) {
    const scaledSvg = scaleSvgRoot(svg, chartWidth, chartHeight, referenceChartWidth, referenceChartHeight);
    const image = await imageFromSvg(scaledSvg);
    ctx.drawImage(image, panelPad, panelPad, chartWidth, chartHeight);
  }
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, canvas.height - footerHeight, canvas.width, footerHeight);
  const footerTextSize = Math.max(30, Math.round(footerHeight * 0.6));
  const footerCenterY = canvas.height - footerHeight * 0.68;
  ctx.fillStyle = settings.theme === "dark" ? "#6f7f87" : "#8f887f";
  ctx.font = `500 ${footerTextSize}px ${CHART_MONO_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("https://wickedsmartbitcoin.com/dca_cost_basis", canvas.width / 2, footerCenterY);
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function downloadDateRangeExportBlob(blob, extension, settings) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dca-cost-basis-${state.dateRange.startIso}-${state.dateRange.endIso}-${settings.orientation}-${settings.quality}p.${extension}`;
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

  const settings = normalizeDownloadSettings(state.downloadSettings);

  stopDateRangePlayback(false);
  const { width, height } = getDownloadDimensions(settings);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const theme = settings.theme === "light" ? "light" : "dark";
  const palette = getPaletteForTheme(theme);
  const frameDates = getDateRangeExportFrameDates(state.dateRange.startIso, state.dateRange.endIso, Number(settings.speed) || 1, settings.endFrameHold);
  if (!frameDates.length) return;
  const finalDate = frameDates[frameDates.length - 1];

  isDateRangeExporting = true;
  dateRangeExportCancelRequested = false;
  broadcastDateRangeExportActive(true);
  renderDateRangeDownloadButtonProgress(0);

  try {
    await waitForDateRangeExportFonts();
    await waitForDateRangeExportFonts();
    await drawExportFrame(ctx, canvas, finalDate, { ...settings, theme }, palette, getFrameRows(state.dateRange.startIso, finalDate));
  } catch (error) {
    console.error(error);
    isDateRangeExporting = false;
    dateRangeExportCancelRequested = false;
    broadcastDateRangeExportActive(false);
    resetDateRangeDownloadButton();
    window.alert("The animation export could not be completed in this browser.");
    return;
  }

  if (settings.extension === "mp4") {
    try {
      const mp4Blob = await encodeDateRangeAnimationMp4({
        canvas,
        ctx,
        settings,
        theme,
        palette,
        frameDates,
      });
      if (mp4Blob && !dateRangeExportCancelRequested) {
        renderDateRangeDownloadButtonProgress(1);
        downloadDateRangeExportBlob(mp4Blob, "mp4", settings);
        isDateRangeExporting = false;
        dateRangeExportCancelRequested = false;
        broadcastDateRangeExportActive(false);
        resetDateRangeDownloadButton();
        return;
      }
      if (dateRangeExportCancelRequested) {
        isDateRangeExporting = false;
        dateRangeExportCancelRequested = false;
        broadcastDateRangeExportActive(false);
        resetDateRangeDownloadButton();
        return;
      }
    } catch (error) {
      console.warn("Deterministic WebCodecs MP4 export unavailable; falling back to recorder export.", error);
    }
  }

  if (settings.extension === "webm") {
    try {
      const webmBlob = await encodeDateRangeAnimationWebM({
        canvas,
        ctx,
        settings,
        theme,
        palette,
        frameDates,
      });
      if (webmBlob && !dateRangeExportCancelRequested) {
        renderDateRangeDownloadButtonProgress(1);
        downloadDateRangeExportBlob(webmBlob, "webm", settings);
        isDateRangeExporting = false;
        dateRangeExportCancelRequested = false;
        broadcastDateRangeExportActive(false);
        resetDateRangeDownloadButton();
        return;
      }
      if (dateRangeExportCancelRequested) {
        isDateRangeExporting = false;
        dateRangeExportCancelRequested = false;
        broadcastDateRangeExportActive(false);
        resetDateRangeDownloadButton();
        return;
      }
    } catch (error) {
      console.warn("Deterministic WebCodecs export unavailable; falling back to recorder export.", error);
    }
  }

  const recorderInfo = getSupportedRecorder(settings.extension);
  if (!recorderInfo || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
    isDateRangeExporting = false;
    dateRangeExportCancelRequested = false;
    broadcastDateRangeExportActive(false);
    resetDateRangeDownloadButton();
    window.alert("The animation export could not be completed in this browser.");
    return;
  }

  const chunks = [];
  let stream = null;
  let track = null;
  let recorder = null;
  try {
    try {
      stream = canvas.captureStream(0);
    } catch (_) {
      stream = canvas.captureStream(EXPORT_VIDEO_FPS);
    }
    [track] = stream.getVideoTracks();
    if (!track || typeof track.requestFrame !== "function") {
      if (track) track.stop();
      stream = canvas.captureStream(EXPORT_VIDEO_FPS);
      [track] = stream.getVideoTracks();
    }
    recorder = new MediaRecorder(stream, {
      mimeType: recorderInfo.mimeType,
      videoBitsPerSecond: getDateRangeExportBitrate(settings),
    });
  } catch (error) {
    console.error(error);
    stream?.getTracks?.().forEach((streamTrack) => streamTrack.stop());
    isDateRangeExporting = false;
    dateRangeExportCancelRequested = false;
    broadcastDateRangeExportActive(false);
    resetDateRangeDownloadButton();
    window.alert("The animation export could not be completed in this browser.");
    return;
  }
  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };

  const finished = new Promise((resolve, reject) => {
    recorder.addEventListener("stop", resolve, { once: true });
    recorder.addEventListener("error", () => reject(recorder.error || new Error("Recording failed")), { once: true });
  });

  const totalWork = Math.max(1, frameDates.length * 2);
  let completedWork = 0;
  let wasCanceled = false;
  const batchSize = getDateRangeExportBatchSize(settings);
  const cachedFrames = new Map();
  const cachedRows = new Map();
  let exportSucceeded = false;

  const renderFrameBatch = async (batchStart) => {
    closeDateRangeExportFrames(cachedFrames);
    cachedRows.clear();
    const batchDates = frameDates.slice(batchStart, batchStart + batchSize);
    const uniqueBatchDates = [];
    const seenBatchDates = new Set();
    batchDates.forEach((dateIso) => {
      if (seenBatchDates.has(dateIso)) return;
      seenBatchDates.add(dateIso);
      uniqueBatchDates.push(dateIso);
    });

    for (const dateIso of uniqueBatchDates) {
      if (dateRangeExportCancelRequested) {
        wasCanceled = true;
        break;
      }
      cachedRows.set(dateIso, getFrameRows(state.dateRange.startIso, dateIso));
    }
    if (wasCanceled) return;

    for (const dateIso of uniqueBatchDates) {
      if (dateRangeExportCancelRequested) {
        wasCanceled = true;
        break;
      }
      const rows = cachedRows.get(dateIso) || [];
      await drawExportFrame(ctx, canvas, dateIso, { ...settings, theme }, palette, rows);
      const frameImage = typeof createImageBitmap === "function"
        ? await createImageBitmap(canvas)
        : (() => {
            const fallbackCanvas = document.createElement("canvas");
            fallbackCanvas.width = canvas.width;
            fallbackCanvas.height = canvas.height;
            fallbackCanvas.getContext("2d")?.drawImage(canvas, 0, 0);
            return fallbackCanvas;
          })();
      cachedFrames.set(dateIso, frameImage);
      completedWork += 1;
      renderDateRangeDownloadButtonProgress(completedWork / totalWork);
    }
  };

  try {
    recorder.start();
    if (typeof recorder.pause !== "function" || typeof recorder.resume !== "function") {
      throw new Error("MediaRecorder pause/resume unavailable.");
    }
    if (track && typeof track.requestFrame === "function") track.requestFrame();
    await transitionMediaRecorder(recorder, "pause", () => recorder.pause());

    let recordedFrames = 0;
    const frameDurationMs = 1000 / EXPORT_VIDEO_FPS;
    for (let batchStart = 0; batchStart < frameDates.length; batchStart += batchSize) {
      await renderFrameBatch(batchStart);
      if (wasCanceled || dateRangeExportCancelRequested) {
        wasCanceled = true;
        break;
      }

      await transitionMediaRecorder(recorder, "resume", () => recorder.resume());
      let lastCaptureTime = performance.now() - frameDurationMs;
      const batchEnd = Math.min(frameDates.length, batchStart + batchSize);
      for (let frameIndex = batchStart; frameIndex < batchEnd; frameIndex += 1) {
        const dateIso = frameDates[frameIndex];
        if (dateRangeExportCancelRequested) {
          wasCanceled = true;
          break;
        }
        const frameImage = cachedFrames.get(dateIso);
        if (!frameImage) throw new Error("Cached export frame unavailable.");
        const elapsedSinceLastCapture = performance.now() - lastCaptureTime;
        if (elapsedSinceLastCapture < frameDurationMs) {
          await wait(frameDurationMs - elapsedSinceLastCapture);
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(frameImage, 0, 0);
        if (track && typeof track.requestFrame === "function") track.requestFrame();
        lastCaptureTime = performance.now();
        recordedFrames += 1;
        completedWork += 1;
        renderDateRangeDownloadButtonProgress(completedWork / totalWork);
      }
      if (wasCanceled || dateRangeExportCancelRequested) break;
      if (batchEnd < frameDates.length) {
        await transitionMediaRecorder(recorder, "pause", () => recorder.pause());
      }
    }
    recorder.stop();
    await finished;
    if (wasCanceled || dateRangeExportCancelRequested) {
      chunks.length = 0;
      return;
    }
    renderDateRangeDownloadButtonProgress(1);

    const blob = new Blob(chunks, { type: recorderInfo.mimeType });
    downloadDateRangeExportBlob(blob, recorderInfo.extension, settings);
    exportSucceeded = true;
  } catch (error) {
    if (!wasCanceled && !dateRangeExportCancelRequested) {
      console.error(error);
      window.alert("The animation export could not be completed in this browser.");
    }
  } finally {
    if (recorder.state !== "inactive") recorder.stop();
    stream.getTracks().forEach((streamTrack) => streamTrack.stop());
    closeDateRangeExportFrames(cachedFrames);
    cachedRows.clear();
    if (!exportSucceeded) chunks.length = 0;
    isDateRangeExporting = false;
    dateRangeExportCancelRequested = false;
    broadcastDateRangeExportActive(false);
    resetDateRangeDownloadButton();
  }
}

function getThemeColors() {
  const style = getComputedStyle(document.documentElement);
  const isLight = document.documentElement.dataset.theme === "light";
  return {
    bg: isLight ? "#ffffff" : "#000000",
    fg: style.getPropertyValue("--fg").trim() || (isLight ? "#1c1b19" : "#f1f5f7"),
    muted: style.getPropertyValue("--muted").trim() || (isLight ? "#6f685f" : "#95a6ae"),
    grid: isLight ? "#e6e6e6" : "#242424",
    halvingLine: isLight ? "rgba(0,0,0,0.28)" : "rgba(255,255,255,0.34)",
    halvingCalloutLine: isLight ? "rgba(0,0,0,0.36)" : "rgba(255,255,255,0.42)",
    up: style.getPropertyValue("--price-up").trim() || "#41b36b",
    down: style.getPropertyValue("--price-down").trim() || "#d33a45",
    basis: style.getPropertyValue("--accent").trim() || "#ff9f1c",
    currentLine: isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.65)",
    overlappedTick: isLight ? "rgba(0,0,0,0.26)" : "rgba(255,255,255,0.22)",
  };
}

function getFilteredRows() {
  return getFrameRows();
}

function buildDurationTickConfig(maxDays) {
  const safeMax = Math.max(1, Math.round(maxDays));
  const tickSet = new Set([1]);

  if (safeMax < 365) {
    const dayStep = safeMax <= 21
      ? 7
      : safeMax <= 70
        ? 14
        : safeMax <= 140
          ? 28
          : safeMax <= 240
            ? 56
            : 84;
    for (let day = dayStep; day < safeMax; day += dayStep) {
      tickSet.add(day);
    }
  } else {
    const yearCount = Math.floor(safeMax / 365);
    const monthStep = getStableRangeMonthTickStep(safeMax);
    const yearStep = getStableYearTickStep(safeMax);
    if (yearStep === 1) tickSet.add(365);
    const maxMonths = Math.floor(safeMax / (365 / 12));
    for (let months = monthStep; months <= maxMonths; months += monthStep) {
      if (months % 12 === 0) continue;
      tickSet.add(Math.round(months * 365 / 12));
    }
    for (let y = yearStep; y <= yearCount; y += yearStep) {
      tickSet.add(y * 365);
    }
  }

  const tickvals = Array.from(tickSet)
    .filter((day) => day >= 1 && day <= safeMax)
    .sort((a, b) => a - b);

  const ticktext = tickvals.map((day) => {
    const years = day / 365;
    if (day >= 365 && Number.isInteger(years)) {
      const wholeYears = years;
      return `${wholeYears}Y`;
    }
    const months = Math.round(day / (365 / 12));
    const monthDay = Math.round(months * 365 / 12);
    if (months >= 2 && months % 12 !== 0 && Math.abs(day - monthDay) <= 2) {
      return `${months}M`;
    }
    if (day > 365 && Math.abs(years - Math.round(years * 2) / 2) < 0.02) {
      return `${(Math.round(years * 2) / 2).toFixed(1)}Y`;
    }
    if (day >= 14 && day % 7 === 0) {
      const weeks = day / 7;
      return `${weeks}W`;
    }
    return day === 1 ? "1D" : `${day}D`;
  });

  return { tickvals, ticktext };
}

function buildDateTickConfig(rows, chartWidth = 900) {
  if (!rows.length) return { tickvals: [], ticktext: [] };

  const newestRow = rows.reduce((best, row) => {
    if (!best) return row;
    return Number(row.daysAgo) < Number(best.daysAgo) ? row : best;
  }, null);
  const oldestRow = rows.reduce((best, row) => {
    if (!best) return row;
    return Number(row.daysAgo) > Number(best.daysAgo) ? row : best;
  }, null);
  const newestDateMs = parseIsoDateMs(newestRow?.dateIso);
  const oldestDateMs = parseIsoDateMs(oldestRow?.dateIso);
  if (!Number.isFinite(newestDateMs) || !Number.isFinite(oldestDateMs)) return { tickvals: [], ticktext: [] };

  const dateAxisRefMs = newestDateMs + ((Number(newestRow.daysAgo) - 1) * MS_PER_DAY);
  const startMs = Math.min(oldestDateMs, newestDateMs);
  const endMs = Math.max(oldestDateMs, newestDateMs);
  const maxDays = rows[rows.length - 1].daysAgo;
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthStarts = [];
  let cursor = new Date(Date.UTC(
    new Date(startMs).getUTCFullYear(),
    new Date(startMs).getUTCMonth(),
    1,
  ));
  if (cursor.getTime() < startMs) {
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  while (cursor.getTime() <= endMs) {
    monthStarts.push(new Date(cursor.getTime()));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }

  if (!monthStarts.length) return { tickvals: [], ticktext: [] };

  const monthStep = getStableDateTickMonthStep(maxDays);
  const selected = new Set();

  monthStarts.forEach((date, index) => {
    const absoluteMonth = date.getUTCFullYear() * 12 + date.getUTCMonth();
    if (absoluteMonth % monthStep === 0) {
      selected.add(index);
    }
  });

  if (!selected.size) selected.add(0);

  const ticks = monthStarts
    .filter((_, index) => selected.has(index))
    .map((date) => {
      const daysAgo = Math.round((dateAxisRefMs - date.getTime()) / MS_PER_DAY) + 1;
      const month = date.getUTCMonth();
      return {
        daysAgo,
        label: month === 0 ? String(date.getUTCFullYear()) : monthNames[month],
      };
    })
    .filter((tick) => tick.daysAgo >= 1 && tick.daysAgo <= maxDays)
    .sort((a, b) => b.daysAgo - a.daysAgo);

  return {
    tickvals: ticks.map((tick) => tick.daysAgo),
    ticktext: ticks.map((tick) => tick.label),
  };
}

function getStableYearTickStep(maxDays) {
  const days = Math.max(1, Number(maxDays) || 1);
  return days > TWO_YEAR_TICK_THRESHOLD_DAYS ? 2 : 1;
}

function getStableRangeMonthTickStep(maxDays) {
  const days = Math.max(1, Number(maxDays) || 1);
  if (days <= FOUR_MONTH_TICK_THRESHOLD_DAYS) return 4;
  if (days <= SIX_MONTH_TICK_THRESHOLD_DAYS) return 6;
  if (days <= TWO_YEAR_TICK_THRESHOLD_DAYS) return 12;
  return 24;
}

function getStableDateTickMonthStep(maxDays) {
  const days = Math.max(1, Number(maxDays) || 1);
  if (days > ONE_YEAR_TICK_THRESHOLD_DAYS) {
    return getStableRangeMonthTickStep(days);
  }
  const months = Math.max(1, Math.round(days / 30.4375));
  if (months <= 4) return 1;
  if (months <= 9) return 2;
  if (months <= 16) return 3;
  if (months <= 30) return 6;
  return 12;
}

function getVisibleDateAxisReferenceMs(rows) {
  if (!Array.isArray(rows) || !rows.length) return NaN;
  const newestRow = rows.reduce((best, row) => {
    if (!best) return row;
    return Number(row.daysAgo) < Number(best.daysAgo) ? row : best;
  }, null);
  const newestDateMs = parseIsoDateMs(newestRow?.dateIso);
  const newestDaysAgo = Number(newestRow?.daysAgo);
  if (!Number.isFinite(newestDateMs) || !Number.isFinite(newestDaysAgo)) return NaN;
  return newestDateMs + ((newestDaysAgo - 1) * MS_PER_DAY);
}

function getVisibleHalvings(rows, maxDays) {
  if (!state.showHalvings) return [];
  const halvings = Array.isArray(state.metadata?.halvings) ? state.metadata.halvings : [];
  const referenceMs = getVisibleDateAxisReferenceMs(rows);

  return halvings
    .map((h) => {
      const eventDate = String(h.date || "");
      const eventMs = parseIsoDateMs(eventDate);
      const daysAgo = Number.isFinite(referenceMs) && Number.isFinite(eventMs)
        ? Math.round((referenceMs - eventMs) / MS_PER_DAY)
        : Number(h.days_ago);
      return {
        label: String(h.label || "Halving"),
        date: eventDate,
        daysAgo,
      };
    })
    .filter((h) => Number.isFinite(h.daysAgo) && h.daysAgo >= 1 && h.daysAgo <= maxDays);
}

function updateKpis(rows) {
  if (!rows.length) return;

  const latest = rows.find((row) => row.daysAgo === 1) || rows[rows.length - 1];
  const spot = Number.isFinite(latest.currentPrice) ? latest.currentPrice : latest.historicalPrice;

  const updatedRaw = String(state.metadata?.generated_utc || "").trim();
  const updatedText = updatedRaw ? formatUpdatedForSelectedTimeZone(updatedRaw) : "-";

  const chipUpdatedValue = document.querySelector("#chipUpdated .chip-value");
  const chipHeightValue = document.querySelector("#chipHeight .chip-value");
  const chipSpotValue = document.querySelector("#chipSpot .chip-value");
  if (chipUpdatedValue) chipUpdatedValue.textContent = updatedText;
  if (chipHeightValue) chipHeightValue.textContent = Number(latest.blockHeight || 0).toLocaleString("en-US");
  if (chipSpotValue) chipSpotValue.textContent = fmtUsd(spot, 0);

  const total = rows.length;
  const profitCount = rows.filter((r) => r.isPriceAbove > 0.5).length;
  const lossCount = total - profitCount;
  document.querySelector("#chipProfitPct .chip-pct").textContent =
    total ? `${(profitCount / total * 100).toFixed(1)}%` : "-%";
  document.querySelector("#chipLossPct .chip-pct").textContent =
    total ? `${(lossCount / total * 100).toFixed(1)}%` : "-%";
}

function buildHalvingShapes(maxDays, colors, rows) {
  return getVisibleHalvings(rows, maxDays)
    .map((h) => ({
      type: "line",
      x0: h.daysAgo,
      x1: h.daysAgo,
      y0: 0,
      y1: 1,
      yref: "paper",
      line: { color: colors.halvingLine, width: 1.4 },
    }));
}

function buildHalvingAnnotations(maxDays, colors, rows) {
  return getVisibleHalvings(rows, maxDays)
    .flatMap((h) => {
      const base = {
        x: h.daysAgo,
        y: 1,
        yref: "paper",
        xref: "x",
        yanchor: "top",
        showarrow: false,
        textangle: -90,
        font: {
          family: "IBM Plex Mono, monospace",
          size: 11,
          color: colors.muted,
        },
        yshift: -2,
      };

      return [
        {
          ...base,
          xanchor: "right",
          xshift: -3,
          text: h.label,
        },
        {
          ...base,
          xanchor: "left",
          xshift: 3,
          text: h.date,
        },
      ];
    });
}

function buildHalvingCostBasisCallouts(maxDays, colors, rows, xForDay, yForValue, plotLeft, plotRight, plotTop, plotBottom, labelSizes) {
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const plotHeight = Math.max(1, plotBottom - plotTop);
  const lineLength = Math.min(33, Math.max(19.5, Math.min(plotWidth, plotHeight) * 0.039));
  const crossoverGap = 4;
  const labelGap = 0;
  const labelLineGap = 0;
  const fontSize = Math.max(12, Math.round(Number(labelSizes?.halvingCostBasis) || 12));

  return getVisibleHalvings(rows, maxDays)
    .map((halving) => {
      const row = findNearestRowByDays(rows, halving.daysAgo);
      const basis = Number(row?.dcaBasis);
      if (!Number.isFinite(basis) || basis <= 0) return "";

      const x = xForDay(halving.daysAgo);
      const y = yForValue(basis);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return "";

      const minLineX = plotLeft + 6;
      const minLineY = plotTop + 16;
      const availableLeft = Math.max(0, x - minLineX);
      const transition = Math.max(0, Math.min(1, availableLeft / Math.max(1, lineLength + crossoverGap)));
      const easedTransition = transition * transition * (3 - (2 * transition));
      const effectiveGap = crossoverGap * easedTransition;
      const lineStartX = Math.max(minLineX, Math.min(plotRight - 18, x - effectiveGap));
      const lineStartY = Math.max(minLineY, Math.min(plotBottom - 8, y - effectiveGap));
      const leftSpace = lineStartX - minLineX;
      const topSpace = lineStartY - minLineY;
      const hasFullVerticalRoom = topSpace >= lineLength;
      const constrainedLineLength = Math.max(8, Math.min(lineLength, topSpace));
      const horizontalLength = hasFullVerticalRoom
        ? Math.max(0, Math.min(lineLength, leftSpace))
        : Math.max(0, Math.min(constrainedLineLength, leftSpace));
      const useVerticalCallout = horizontalLength < 1;
      const drawStartX = useVerticalCallout ? x : lineStartX;
      const label = fmtUsd(basis, 0);
      const estimatedTextWidth = label.length * fontSize * 0.62;
      const geometricLineEndX = useVerticalCallout ? x : drawStartX - horizontalLength;
      const centeredTextAnchorX = x + (estimatedTextWidth / 2);
      const rightAlignedTextAnchorX = Math.max(plotLeft + 6 + estimatedTextWidth, geometricLineEndX - labelLineGap);
      const textAnchorX = Math.min(
        centeredTextAnchorX + ((rightAlignedTextAnchorX - centeredTextAnchorX) * easedTransition),
        x + (estimatedTextWidth / 2),
      );
      const labelCenterX = textAnchorX - (estimatedTextWidth / 2);
      const labelLeftShift = Math.max(0, x - labelCenterX);
      const labelDrivenTopShift = Math.min(horizontalLength, labelLeftShift * 0.5);
      const labelEdgeAttachX = Math.min(drawStartX, x, textAnchorX + labelLineGap);
      const lineEndX = useVerticalCallout
        ? x
        : (hasFullVerticalRoom
          ? Math.max(minLineX, Math.min(x - labelDrivenTopShift, labelEdgeAttachX))
          : Math.min(geometricLineEndX, x - labelDrivenTopShift));
      const verticalLength = useVerticalCallout
        ? constrainedLineLength
        : (hasFullVerticalRoom ? lineLength : drawStartX - lineEndX);
      const lineEndY = lineStartY - verticalLength;
      const textY = Math.max(plotTop + fontSize, lineEndY - labelGap);
      const renderedStartX = useVerticalCallout ? x : Math.min(drawStartX, x);
      const renderedEndX = Math.min(lineEndX, renderedStartX, x);

      return `
        <line x1="${renderedEndX.toFixed(2)}" y1="${lineEndY.toFixed(2)}" x2="${renderedStartX.toFixed(2)}" y2="${lineStartY.toFixed(2)}" stroke="${colors.halvingCalloutLine}" stroke-width="1.2" />
        <text x="${textAnchorX.toFixed(2)}" y="${textY.toFixed(2)}" text-anchor="end" dominant-baseline="text-after-edge" fill="${colors.basis}" stroke="${colors.bg || "#000000"}" stroke-width="3" stroke-linejoin="round" paint-order="stroke fill" font-family="${CHART_MONO_FONT_ATTR}" font-size="${fontSize}">${escapeHtml(label)}</text>
      `;
    })
    .join("");
}

function ensureCurrentPriceOverlay(chart) {
  const host = chart?.parentElement;
  if (!host) return null;

  let overlay = host.querySelector(".current-price-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "current-price-overlay";
    overlay.hidden = true;
    host.appendChild(overlay);
  }

  return overlay;
}

function getCurrentPriceLineTop(chart, currentPrice) {
  const geometry = chart?.__dcaChartGeometry;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !geometry || typeof geometry.yForValue !== "function") {
    return NaN;
  }

  const topPx = geometry.yForValue(currentPrice) + (chart?.offsetTop || 0);
  if (!Number.isFinite(topPx)) {
    return NaN;
  }

  const minTop = geometry.plotTop + (chart?.offsetTop || 0);
  const maxTop = geometry.plotBottom + (chart?.offsetTop || 0);
  return Math.max(minTop, Math.min(maxTop, topPx));
}

function syncCurrentPriceOverlay(chart, currentPrice, colors) {
  const overlay = ensureCurrentPriceOverlay(chart);
  if (!overlay) return;

  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    overlay.hidden = true;
    return;
  }

  const topPx = getCurrentPriceLineTop(chart, currentPrice);
  if (!Number.isFinite(topPx)) {
    overlay.hidden = true;
    return;
  }

  overlay.textContent = fmtUsd(currentPrice, 0);
  const geometry = chart?.__dcaChartGeometry;
  const overlayTextPad = 6;
  const leftPx = (chart?.offsetLeft || 0) + (Number(geometry?.plotRight) || 0) + 8 - overlayTextPad;
  const labelSizes = getResponsiveChartLabelSizes(chart?.clientWidth || chart?.parentElement?.clientWidth || window.innerWidth);
  const overlayMetrics = getCurrentPriceOverlayMetrics(labelSizes);
  overlay.style.setProperty("--current-price-overlay-left", `${leftPx}px`);
  overlay.style.setProperty("--current-price-overlay-font-size", `${labelSizes.currentPrice}px`);
  overlay.style.setProperty("--current-price-overlay-min-width", `${overlayMetrics.minWidth}px`);
  overlay.style.top = `${topPx}px`;
  overlay.style.color = colors.fg;
  overlay.hidden = false;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function snapSvgLineCoord(value, strokeWidth = 1) {
  const lineWidth = Math.max(1, Math.round(Number(strokeWidth) || 1));
  const offset = lineWidth % 2 === 1 ? 0.5 : 0;
  return Math.round(Number(value) || 0) + offset;
}

function formatPriceAxisTick(value) {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) < 1e-9) return "$0";
  if (value < 0) return "";
  if (value >= 1000) return fmtUsdCompactTick(value);
  if (value >= 100) return fmtUsd(value, 0);
  if (value >= 10) return fmtUsd(value, 1);
  return fmtUsd(value, 2);
}

function niceNumber(value, shouldRound) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / (10 ** exponent);
  let niceFraction;

  if (shouldRound) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;

  return niceFraction * (10 ** exponent);
}

function formatCompactUsdAxisLabel(value) {
  if (!Number.isFinite(value) || value < 0) return "$0";
  if (value === 0) return "$0";

  let formatted;
  if (value < 1) {
    const cents = value * 100;
    if (cents >= 10) {
      formatted = `${cents.toFixed(cents < 1000 ? 2 : 0)}¢`;
    } else if (cents > 0 && cents < 1e-20) {
      formatted = `${cents.toExponential(2).replace("e+", "e")}¢`;
    } else {
      const magnitude = Math.floor(Math.log10(Math.max(cents, 1e-30)));
      const decimals = cents >= 1 ? 2 : Math.min(24, Math.max(2, (-magnitude) + 2));
      formatted = `${cents.toFixed(decimals)}¢`;
    }
    if (formatted.includes(".") && !formatted.includes("e")) {
      formatted = formatted.replace(/0+(?=¢$)/, "").replace(/\.(?=¢$)/, "");
    }
    return formatted;
  }

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
    formatted = `${k.toFixed(k < 10 ? 2 : 1)}k`;
  } else if (value >= 100) {
    formatted = `${Math.round(value)}`;
  } else if (value >= 10) {
    formatted = `${value.toFixed(1)}`;
  } else if (value >= 1) {
    if (value >= 0.95 && value <= 1.05) formatted = `${value.toFixed(4)}`;
    else if (value < 2) formatted = `${value.toFixed(3)}`;
    else formatted = `${value.toFixed(2)}`;
  } else if (value > 0 && value < 1e-8) {
    formatted = value.toExponential(2).replace("e+", "e").replace(/e-0+/, "e-");
  } else {
    const decimals = value < 0.001
      ? Math.min(24, Math.max(4, -Math.floor(Math.log10(value)) + 2))
      : 3;
    formatted = `${value.toFixed(decimals)}`;
  }

  if (formatted.includes(".") && !formatted.includes("e")) {
    formatted = formatted
      .replace(/\.0+(?=[a-zA-Z]$)/, "")
      .replace(/(\.\d*?[1-9])0+(?=[a-zA-Z]$)/, "$1")
      .replace(/0+$/, "");
    if (formatted.endsWith(".")) formatted = formatted.slice(0, -1);
  }

  return `$${formatted}`;
}

function formatUsdAxisTickLabels(values) {
  const tickvals = Array.isArray(values)
    ? values.filter((value) => Number.isFinite(value))
    : [];
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
    return Array.from({ length: targetCount }, (_, index) => (
      start + (((end - start) * index) / (targetCount - 1))
    ));
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
    for (let value = start; value <= end + eps; value += step) {
      ticks.push(Number(value.toPrecision(15)));
    }
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

  if (ticks.length >= 3) return ticks;
  return Array.from({ length: targetCount }, (_, index) => min + (((max - min) * index) / (targetCount - 1)));
}

function buildLogTicks(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) return [];
  const minLog = Math.log10(min);
  const maxLog = Math.log10(max);
  const span = maxLog - minLog;

  if (span < 1) {
    const linearTicks = buildLinearTicks(min, max, 6)
      .filter((value) => value > 0)
      .sort((a, b) => a - b);
    return linearTicks.length >= 3 ? linearTicks : buildLinearTicks(min, max, 4).filter((value) => value > 0);
  }

  const factors = span >= 3
    ? [1]
    : span >= 2
      ? [1, 5]
      : [1, 2, 5];
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

function buildLinearYAxisConfig(values, tickCount = 8) {
  const safeValues = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (!safeValues.length) {
    return {
      min: 1,
      max: 10,
      tickvals: [1, 5, 10],
      ticktext: formatUsdAxisTickLabels([1, 5, 10]),
    };
  }

  const dataMin = Math.min(...safeValues);
  const dataMax = Math.max(...safeValues);
  const dataRange = dataMax - dataMin;
  const midpoint = (dataMax + dataMin) / 2;
  const hasPositiveMidpoint = Number.isFinite(midpoint) && midpoint > 0;
  const relativeSpread = hasPositiveMidpoint ? (dataRange / midpoint) : Infinity;
  const valueScale = Math.max(Math.abs(dataMin), Math.abs(dataMax), LOG_MIN_POSITIVE);
  const nearConstantByScale = Math.abs(dataRange) <= Math.max(
    valueScale * 1e-12,
    Number.EPSILON * valueScale * 64,
  );
  let min;
  let max;

  if (hasPositiveMidpoint && relativeSpread < 0.01) {
    const lowerPadAmount = midpoint * 0.02;
    const upperPadAmount = midpoint * 0.02;
    min = midpoint - lowerPadAmount;
    max = midpoint + upperPadAmount;
  } else if (nearConstantByScale) {
    const lowerPadAmount = Math.max(valueScale * 0.02, Number.EPSILON * valueScale * 64);
    const upperPadAmount = Math.max(valueScale * 0.02, Number.EPSILON * valueScale * 64);
    min = dataMin - lowerPadAmount;
    max = dataMax + upperPadAmount;
  } else {
    const lowerPadAmount = dataRange * 0.02;
    const upperPadAmount = dataRange * 0.02;
    min = dataMin - lowerPadAmount;
    max = dataMax + upperPadAmount;
  }
  let tickvals = buildLinearTicks(min, max, tickCount);
  if (dataMin >= 0) {
    tickvals = tickvals.filter((value) => value >= 0);
    if (!tickvals.length) tickvals = [0, Math.max(0, dataMax)];
  }

  return {
    min,
    max,
    tickvals,
    ticktext: formatUsdAxisTickLabels(tickvals),
  };
}

function buildYScaleConfig(values, scaleMode) {
  if (scaleMode === "log") {
    const safeValues = values.filter((value) => Number.isFinite(value) && value > 0);
    if (!safeValues.length) {
      const linear = buildLinearYAxisConfig(values);
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
    let min;
    let max;

    if (logSpan < 1e-6) {
      const center = Math.max(safeMin, LOG_MIN_POSITIVE);
      min = center / 1.02;
      max = center * 1.02;
    } else {
      const lowerLogPad = Math.max(logSpan * 0.02, 1e-6);
      const upperLogPad = Math.max(logSpan * 0.02, 1e-6);
      min = safeMin / Math.exp(lowerLogPad);
      max = safeMax * Math.exp(upperLogPad);
    }

    const ticks = buildLogTicks(min, max);
    const ticktext = formatUsdAxisTickLabels(ticks);
    const domainMinLog = Math.log10(min);
    const domainMaxLog = Math.log10(max);

    return {
      min,
      max,
      tickvals: ticks,
      ticktext,
      map(value, plotTop, plotHeight) {
        if (!Number.isFinite(value) || value <= 0) return NaN;
        const ratio = (Math.log10(value) - domainMinLog) / Math.max(1e-9, domainMaxLog - domainMinLog);
        return plotTop + ((1 - ratio) * plotHeight);
      },
    };
  }

  const linear = buildLinearYAxisConfig(values);
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
  if (values.length <= 2) {
    return { tickvals: values.slice(), ticktext: text.slice() };
  }

  const preserveFirst = options.preserveFirst !== false;
  const preserveLast = options.preserveLast !== false;
  const kept = [];
  let lastPos = null;

  values.forEach((value, index) => {
    const pos = positionForValue(value, index);
    if (!Number.isFinite(pos)) return;
    const isFirst = index === 0;
    const isLast = index === values.length - 1;

    if ((preserveFirst && isFirst) || (preserveLast && isLast)) {
      kept.push(index);
      lastPos = pos;
      return;
    }

    if (lastPos == null || Math.abs(pos - lastPos) >= minSpacing) {
      kept.push(index);
      lastPos = pos;
    }
  });

  if (preserveLast && kept[kept.length - 1] !== values.length - 1) {
    kept.push(values.length - 1);
  }

  const uniqueKept = Array.from(new Set(kept)).sort((left, right) => left - right);
  return {
    tickvals: uniqueKept.map((index) => values[index]),
    ticktext: uniqueKept.map((index) => text[index]),
  };
}

function filterDateTicksByPixelSpacing(tickvals, ticktext, positionForValue, minSpacing) {
  const values = Array.isArray(tickvals) ? tickvals : [];
  const text = Array.isArray(ticktext) ? ticktext : [];
  if (values.length <= 2) {
    return { tickvals: values.slice(), ticktext: text.slice() };
  }

  const years = text.map((label) => (/^\d{4}$/.test(String(label || "")) ? Number(label) : NaN));
  const allYears = years.every((year) => Number.isFinite(year));
  if (allYears) {
    return { tickvals: values.slice(), ticktext: text.slice() };
  }
  return filterTicksByPixelSpacing(values, text, positionForValue, minSpacing);
}

function limitTicksToEvenStride(ticks, targetCount) {
  const values = Array.isArray(ticks?.tickvals) ? ticks.tickvals : [];
  const text = Array.isArray(ticks?.ticktext) ? ticks.ticktext : [];
  const desiredCount = Math.max(2, Math.round(targetCount || 0));

  if (values.length <= desiredCount) {
    return {
      tickvals: values.slice(),
      ticktext: text.slice(),
    };
  }

  const stride = Math.max(2, Math.ceil(values.length / desiredCount));
  const indices = [];
  for (let index = 0; index < values.length; index += stride) {
    indices.push(index);
  }

  return {
    tickvals: indices.map((index) => values[index]),
    ticktext: indices.map((index) => text[index]),
  };
}

function limitDateTicksToAnchoredStride(ticks, targetCount) {
  const values = Array.isArray(ticks?.tickvals) ? ticks.tickvals : [];
  const text = Array.isArray(ticks?.ticktext) ? ticks.ticktext : [];
  const desiredCount = Math.max(2, Math.round(targetCount || 0));
  if (values.length <= desiredCount) {
    return {
      tickvals: values.slice(),
      ticktext: text.slice(),
    };
  }

  const years = text.map((label) => (/^\d{4}$/.test(String(label || "")) ? Number(label) : NaN));
  const allYears = years.every((year) => Number.isFinite(year));
  if (!allYears) return limitTicksToEvenStride(ticks, desiredCount);

  const stride = Math.max(2, Math.ceil(values.length / desiredCount));
  const indices = years
    .map((year, index) => ({ year, index }))
    .filter(({ year }) => year % stride === 0)
    .map(({ index }) => index);

  if (indices.length >= 2) {
    return {
      tickvals: indices.map((index) => values[index]),
      ticktext: indices.map((index) => text[index]),
    };
  }

  return limitTicksToEvenStride(ticks, desiredCount);
}

function balanceXAxisTickCounts(bottomTicks, topTicks) {
  const bottomCount = Array.isArray(bottomTicks?.tickvals) ? bottomTicks.tickvals.length : 0;
  const topCount = Array.isArray(topTicks?.tickvals) ? topTicks.tickvals.length : 0;
  if (bottomCount < 3 || topCount < 3) return { bottomTicks, topTicks };

  const topText = Array.isArray(topTicks?.ticktext) ? topTicks.ticktext : [];
  const topIsRangeAnchoredYears = topText.length === topCount
    && topText.every((label) => /^\d{4}$/.test(String(label || "")));
  if (topIsRangeAnchoredYears) return { bottomTicks, topTicks };

  const allowedDelta = 3;
  const largerCount = Math.max(bottomCount, topCount);
  const smallerCount = Math.max(1, Math.min(bottomCount, topCount));
  if (Math.abs(bottomCount - topCount) <= allowedDelta && largerCount / smallerCount < 1.75) {
    return { bottomTicks, topTicks };
  }

  if (bottomCount > topCount) {
    return { bottomTicks, topTicks };
  }

  return {
    bottomTicks,
    topTicks: limitDateTicksToAnchoredStride(topTicks, Math.max(bottomCount + allowedDelta, Math.ceil(bottomCount * 1.5))),
  };
}

function buildLinePath(days, values, xForDay, yForValue) {
  let path = "";
  let started = false;

  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    const value = values[index];
    if (!Number.isFinite(day) || !Number.isFinite(value) || value <= 0) {
      started = false;
      continue;
    }

    const x = xForDay(day);
    const y = yForValue(value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      started = false;
      continue;
    }

    path += `${started ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)} `;
    started = true;
  }

  return path.trim();
}

function buildLegendSvgMarkup(colors, labelSizes, options = {}) {
  const fontSize = Number(options.fontSize) || Number(labelSizes?.tick) || 14;
  const xStart = Number(options.x) || 24;
  const y = Number(options.y) || Math.round(fontSize * 1.45);
  const swatchWidth = Math.max(22, Math.round(fontSize * 1.6));
  const swatchStroke = Math.max(3, fontSize * 0.22);
  const itemGap = Math.max(18, Math.round(fontSize * 1.15));
  const textGap = Math.max(7, Math.round(fontSize * 0.45));
  const charWidth = fontSize * 0.62;
  const items = [
    { label: "Positive ROI", color: colors.up },
    { label: "Negative ROI", color: colors.down },
    { label: "DCA Cost Basis", color: colors.basis },
    { label: "Current Price", color: colors.currentLine, dashed: true },
  ];
  let x = xStart;
  return items.map((item) => {
    const itemStroke = item.dashed ? Math.max(1.5, fontSize * 0.12) : swatchStroke;
    const lineCap = item.dashed ? "butt" : "round";
    const dashAttrs = item.dashed ? ' stroke-dasharray="6 4"' : "";
    const line = `<line x1="${x.toFixed(2)}" y1="${y.toFixed(2)}" x2="${(x + swatchWidth).toFixed(2)}" y2="${y.toFixed(2)}" stroke="${item.color}" stroke-width="${itemStroke.toFixed(2)}" stroke-linecap="${lineCap}"${dashAttrs} />`;
    const textX = x + swatchWidth + textGap;
    const text = `<text x="${textX.toFixed(2)}" y="${(y + fontSize * 0.35).toFixed(2)}" text-anchor="start" fill="${colors.muted}" font-family="${CHART_MONO_FONT_ATTR}" font-size="${fontSize}">${escapeHtml(item.label)}</text>`;
    x = textX + (item.label.length * charWidth) + itemGap;
    return `${line}${text}`;
  }).join("");
}

function buildChartSvgMarkup(options) {
  const {
    width,
    height,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    xForDay,
    yForValue,
    bottomTicks,
    topTicks,
    rightTicks,
    colors,
    rows,
    priceUp,
    priceDown,
    dcaBasis,
    currentPrice,
    maxDays,
    topTitleY,
    topTickY,
    bottomTickY,
    bottomTitleY,
    labelSizes = getResponsiveChartLabelSizes(width),
    yScale = state.yScale,
    renderCurrentPriceLabel = false,
    renderLegend = false,
    legendFontSize = null,
    legendY = null,
    exportHalvingLabelSpacing = false,
    axisTitleX = null,
    startDateX = null,
    currentDateX = null,
    headerTitle = "",
    topAxisTitle = "DCA Starting Date",
    bottomAxisTitle = "DCA Duration",
    lineWidths = {},
  } = options;
  const gridStrokeWidth = Number(lineWidths.grid) || 1;
  const priceStrokeWidth = Number(lineWidths.price) || 2.25;
  const basisStrokeWidth = Number(lineWidths.basis) || 3.5;
  const currentStrokeWidth = Number(lineWidths.current) || 1.5;

  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const axisTitleCenterX = axisTitleX !== null && axisTitleX !== undefined && Number.isFinite(Number(axisTitleX))
    ? Number(axisTitleX)
    : plotLeft + (plotWidth / 2);
  const startDateLabelX = startDateX !== null && startDateX !== undefined && Number.isFinite(Number(startDateX))
    ? Number(startDateX)
    : plotLeft;
  const currentDateLabelX = currentDateX !== null && currentDateX !== undefined && Number.isFinite(Number(currentDateX))
    ? Number(currentDateX)
    : xForDay(1);
  const xDays = rows.map((row) => row.daysAgo);
  const basisPath = buildLinePath(xDays, dcaBasis, xForDay, yForValue);
  const upPath = buildLinePath(xDays, priceUp, xForDay, yForValue);
  const downPath = buildLinePath(xDays, priceDown, xForDay, yForValue);
  const currentY = yForValue(currentPrice);
  const currentDateRow = rows.reduce((best, row) => {
    if (!best) return row;
    return Number(row.daysAgo) < Number(best.daysAgo) ? row : best;
  }, null);
  const currentDateLabel = currentDateRow?.dateIso || "";
  const startDateRow = rows.reduce((best, row) => {
    if (!best) return row;
    return Number(row.daysAgo) > Number(best.daysAgo) ? row : best;
  }, null);
  const startDateLabel = startDateRow?.dateIso || "";

  const topVerticalGrid = topTicks.tickvals.map((day) => {
    const x = snapSvgLineCoord(xForDay(day), gridStrokeWidth);
    return `<line class="chart-grid-line" x1="${x.toFixed(2)}" y1="${plotTop}" x2="${x.toFixed(2)}" y2="${plotBottom}" stroke="${colors.grid}" stroke-width="${gridStrokeWidth}" shape-rendering="crispEdges" />`;
  }).join("");

  const verticalGrid = bottomTicks.tickvals.map((day) => {
    const x = snapSvgLineCoord(xForDay(day), gridStrokeWidth);
    return `<line class="chart-grid-line" x1="${x.toFixed(2)}" y1="${plotTop}" x2="${x.toFixed(2)}" y2="${plotBottom}" stroke="${colors.grid}" stroke-width="${gridStrokeWidth}" shape-rendering="crispEdges" />`;
  }).join("");

  const horizontalGrid = rightTicks.tickvals.map((value) => {
    const y = snapSvgLineCoord(yForValue(value), gridStrokeWidth);
    return `<line class="chart-grid-line" x1="${plotLeft}" y1="${y.toFixed(2)}" x2="${plotRight}" y2="${y.toFixed(2)}" stroke="${colors.grid}" stroke-width="${gridStrokeWidth}" shape-rendering="crispEdges" />`;
  }).join("");

  const bottomTickLabels = bottomTicks.tickvals.map((day, index) => {
    const x = xForDay(day);
    return `<text x="${x.toFixed(2)}" y="${bottomTickY}" text-anchor="middle" fill="${colors.muted}" font-family="${CHART_MONO_FONT_ATTR}" font-size="${labelSizes.tick}">${escapeHtml(bottomTicks.ticktext[index] || "")}</text>`;
  }).join("");

  const topTickLabels = topTicks.tickvals.map((day, index) => {
    const x = xForDay(day);
    return `<text x="${x.toFixed(2)}" y="${topTickY}" text-anchor="middle" fill="${colors.muted}" font-family="${CHART_MONO_FONT_ATTR}" font-size="${labelSizes.topTick}">${escapeHtml(topTicks.ticktext[index] || "")}</text>`;
  }).join("");

  const currentPriceLabelHeight = Math.max(1, Number(labelSizes.currentPrice) || 13);
  const yTickLabelHeight = Math.max(1, Number(labelSizes.yTick) || 13);
  const currentPriceOverlapRadius = Number.isFinite(currentY)
    ? ((currentPriceLabelHeight + yTickLabelHeight) / 2) + 2
    : 0;
  const rightTickLabels = rightTicks.tickvals.map((value, index) => {
    const y = yForValue(value);
    const overlapsCurrentPrice = Number.isFinite(currentY)
      && Math.abs(y - currentY) < currentPriceOverlapRadius;
    const fill = overlapsCurrentPrice ? (colors.overlappedTick || colors.muted || colors.fg) : colors.muted;
    return `<text x="${plotRight + 8}" y="${(y + (labelSizes.yTick * 0.36)).toFixed(2)}" text-anchor="start" fill="${fill}" font-family="${CHART_MONO_FONT_ATTR}" font-size="${labelSizes.yTick}">${escapeHtml(rightTicks.ticktext[index] || "")}</text>`;
  }).join("");

  const halvingLines = buildHalvingShapes(maxDays, colors, rows).map((shape) => {
    const x = xForDay(shape.x0);
    return `<line x1="${x.toFixed(2)}" y1="${plotTop}" x2="${x.toFixed(2)}" y2="${plotBottom}" stroke="${shape.line.color}" stroke-width="${shape.line.width}" />`;
  }).join("");

  const halvingLabels = buildHalvingAnnotations(maxDays, colors, rows).map((annotation) => {
    const lineX = xForDay(annotation.x);
    const isLeftLabel = annotation.xanchor === "right";
    const isLogScale = yScale === "log";
    const anchorY = isLogScale ? plotBottom - 6 : plotTop + 6;
    const leftOffset = exportHalvingLabelSpacing ? -32 : -18;
    const rightOffset = exportHalvingLabelSpacing ? 18 : 9;
    const logLeftOffset = exportHalvingLabelSpacing ? -18 : -9;
    const logRightOffset = exportHalvingLabelSpacing ? 30 : 18;
    const anchorX = lineX + (isLogScale
      ? (isLeftLabel ? logLeftOffset : logRightOffset)
      : (isLeftLabel ? leftOffset : rightOffset));
    if (!isLeftLabel && anchorX + labelSizes.halving > plotRight - 6) {
      return "";
    }
    const textAnchor = isLogScale ? "start" : "end";
    const dominantBaseline = isLogScale ? "auto" : "hanging";
    return `<text x="${anchorX.toFixed(2)}" y="${anchorY.toFixed(2)}" transform="rotate(270 ${anchorX.toFixed(2)} ${anchorY.toFixed(2)})" text-anchor="${textAnchor}" dominant-baseline="${dominantBaseline}" fill="${annotation.font.color}" font-family="${CHART_MONO_FONT_ATTR}" font-size="${labelSizes.halving}">${escapeHtml(annotation.text)}</text>`;
  }).join("");

  const halvingCostBasisCallouts = buildHalvingCostBasisCallouts(
    maxDays,
    colors,
    rows,
    xForDay,
    yForValue,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    labelSizes,
  );

  const frameLines = [
    `<line class="chart-grid-line" x1="${snapSvgLineCoord(plotRight, gridStrokeWidth).toFixed(2)}" y1="${plotTop}" x2="${snapSvgLineCoord(plotRight, gridStrokeWidth).toFixed(2)}" y2="${plotBottom}" stroke="${colors.grid}" stroke-width="${gridStrokeWidth}" shape-rendering="crispEdges" />`,
  ].join("");

  const currentLine = Number.isFinite(currentY)
    ? `<line x1="${plotLeft}" y1="${currentY.toFixed(2)}" x2="${plotRight}" y2="${currentY.toFixed(2)}" stroke="${colors.currentLine}" stroke-width="${currentStrokeWidth}" stroke-dasharray="6 4" />`
    : "";
  const currentPriceLabel = renderCurrentPriceLabel && Number.isFinite(currentY) && Number.isFinite(currentPrice) && currentPrice > 0
    ? `<text x="${plotRight + 8}" y="${currentY.toFixed(2)}" text-anchor="start" dominant-baseline="central" fill="${colors.fg}" stroke="${colors.bg || "#000000"}" stroke-width="5" stroke-linejoin="round" paint-order="stroke fill" font-family="${CHART_MONO_FONT_ATTR}" font-size="${labelSizes.currentPrice}">${escapeHtml(fmtUsd(currentPrice, 0))}</text>`
    : "";
  const headerTitleMarkup = headerTitle
    ? `<text x="${(width / 2).toFixed(2)}" y="${Math.max(24, labelSizes.title * 1.5).toFixed(2)}" text-anchor="middle" fill="${colors.fg}" font-family="${CHART_TITLE_FONT_ATTR}" font-weight="700" font-size="${Math.max(24, labelSizes.title * 1.28).toFixed(2)}">${escapeHtml(headerTitle)}</text>`
    : "";

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-label="DCA cost basis chart" role="img">
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
      ${headerTitleMarkup}
      ${renderLegend ? buildLegendSvgMarkup(colors, labelSizes, { x: plotLeft, y: Number(legendY) || Math.max(18, (Number(legendFontSize) || labelSizes.tick) * 1.35), fontSize: legendFontSize }) : ""}
      ${topVerticalGrid}
      ${verticalGrid}
      ${horizontalGrid}
      ${frameLines}
      ${halvingLines}
      ${currentLine}
      ${upPath ? `<path d="${upPath}" fill="none" stroke="${colors.up}" stroke-width="${priceStrokeWidth}" stroke-linecap="round" stroke-linejoin="round"></path>` : ""}
      ${downPath ? `<path d="${downPath}" fill="none" stroke="${colors.down}" stroke-width="${priceStrokeWidth}" stroke-linecap="round" stroke-linejoin="round"></path>` : ""}
      ${basisPath ? `<path d="${basisPath}" fill="none" stroke="${colors.basis}" stroke-width="${basisStrokeWidth}" stroke-linecap="round" stroke-linejoin="round"></path>` : ""}
      ${halvingCostBasisCallouts}
      <line class="dca-hover-line" x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}" stroke="${colors.fg}" stroke-width="1" stroke-dasharray="5 4" visibility="hidden"></line>
      ${bottomTickLabels}
      ${topTickLabels}
      ${rightTickLabels}
      ${currentPriceLabel}
      ${halvingLabels}
      ${startDateLabel ? `<text x="${startDateLabelX.toFixed(2)}" y="${topTitleY}" text-anchor="start" fill="${colors.muted}" font-family="${CHART_MONO_FONT_ATTR}" font-size="${labelSizes.halving}">${escapeHtml(startDateLabel)}</text>` : ""}
      ${currentDateLabel ? `<text x="${currentDateLabelX.toFixed(2)}" y="${topTitleY}" text-anchor="end" fill="${colors.muted}" font-family="${CHART_MONO_FONT_ATTR}" font-size="${labelSizes.halving}">${escapeHtml(currentDateLabel)}</text>` : ""}
      <text x="${axisTitleCenterX.toFixed(2)}" y="${bottomTitleY}" text-anchor="middle" fill="${colors.muted}" font-family="${CHART_TITLE_FONT_ATTR}" font-size="${labelSizes.title}">${escapeHtml(bottomAxisTitle)}</text>
      <text x="${axisTitleCenterX.toFixed(2)}" y="${topTitleY}" text-anchor="middle" fill="${colors.muted}" font-family="${CHART_TITLE_FONT_ATTR}" font-size="${labelSizes.title}">${escapeHtml(topAxisTitle)}</text>
    </svg>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getCadenceDurationText(purchaseCount) {
  const count = Math.max(0, Math.round(Number(purchaseCount) || 0));
  if (state.cadence === "weekly_dca") return `${count.toLocaleString("en-US")} ${count === 1 ? "Week" : "Weeks"}`;
  if (state.cadence === "monthly_dca") return `${count.toLocaleString("en-US")} ${count === 1 ? "Month" : "Months"}`;
  return `${count.toLocaleString("en-US")} ${count === 1 ? "Day" : "Days"}`;
}

function findNearestRowByDays(rows, daysAgo) {
  if (!rows.length || !Number.isFinite(daysAgo)) return null;
  let best = rows[0];
  let bestDelta = Math.abs(rows[0].daysAgo - daysAgo);
  for (let i = 1; i < rows.length; i += 1) {
    const delta = Math.abs(rows[i].daysAgo - daysAgo);
    if (delta < bestDelta) {
      best = rows[i];
      bestDelta = delta;
    }
  }
  return best;
}

function findTooltipStartRow(rows, hoverRow) {
  if (!hoverRow || !rows.length || state.cadence === "daily_dca") return hoverRow;

  const idx = rows.findIndex((r) => r.daysAgo === hoverRow.daysAgo);
  if (idx < 0) return hoverRow;

  let anchorIdx = idx;
  while (anchorIdx + 1 < rows.length && rows[anchorIdx + 1].purchaseCount === hoverRow.purchaseCount) {
    anchorIdx += 1;
  }
  return rows[anchorIdx] || hoverRow;
}

function ensureChartTooltip() {
  return document.getElementById("chartTooltip");
}

function hideChartTooltip() {
  const tooltip = ensureChartTooltip();
  if (!tooltip) return;
  tooltip.classList.remove("show", "is-below");
}

function placeChartTooltip(tooltip, clientX, clientY, panelRect) {
  const pad = 12;
  const xOffset = 14;
  const yOffset = 14;

  const panelLeft = Number.isFinite(panelRect?.left) ? panelRect.left : 0;
  const panelRight = Number.isFinite(panelRect?.right) ? panelRect.right : window.innerWidth;
  const minX = Math.max(pad, panelLeft + pad);
  const maxX = Math.min(window.innerWidth - pad, panelRight - pad);

  tooltip.style.left = `${clientX}px`;
  tooltip.style.top = `${clientY}px`;

  const rect = tooltip.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  let left = clientX + xOffset;
  if (left + width > maxX) {
    left = clientX - width - xOffset;
  }
  left = Math.max(minX, Math.min(left, maxX - width));

  let top = clientY - height - yOffset;
  if (top < pad) {
    top = clientY + yOffset;
  }
  top = Math.max(pad, Math.min(top, window.innerHeight - pad - height));

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function showChartTooltip(chart, hoverRow, hoverEvent) {
  const tooltip = ensureChartTooltip();
  if (!tooltip || !hoverRow) return;

  const rows = chart.__dcaTooltipRows || [];
  const startRow = findTooltipStartRow(rows, hoverRow);
  const startDate = startRow?.dateIso || hoverRow.dateIso || "-";
  const startPrice = Number.isFinite(startRow?.historicalPrice) ? startRow.historicalPrice : hoverRow.historicalPrice;
  const basis = hoverRow.dcaBasis;
  const currentPrice = Number.isFinite(hoverRow.currentPrice) ? hoverRow.currentPrice : hoverRow.historicalPrice;
  const roi = Number.isFinite(basis) && basis > 0 && Number.isFinite(currentPrice)
    ? ((currentPrice - basis) / basis) * 100
    : NaN;
  const roiClass = Number.isFinite(roi) && roi >= 0 ? "tooltip-value-profit" : "tooltip-value-loss";
  const roiText = Number.isFinite(roi) ? `${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%` : "-";

  tooltip.innerHTML = [
    `<div class="tooltip-row"><span class="tooltip-label">&nbsp;Starting Date:</span><span>${escapeHtml(startDate)}</span></div>`,
    `<div class="tooltip-row"><span class="tooltip-label">&nbsp;&nbsp;DCA Duration:</span><span>${escapeHtml(getCadenceDurationText(hoverRow.purchaseCount))}</span></div>`,
    `<div class="tooltip-row"><span class="tooltip-label">Starting Price:</span><span>${escapeHtml(fmtUsd(startPrice, 2))}</span></div>`,
    `<div class="tooltip-row"><span class="tooltip-label">&nbsp;Current Price:</span><span>${escapeHtml(fmtUsd(currentPrice, 2))}</span></div>`,
    `<div class="tooltip-row"><span class="tooltip-label">DCA Cost Basis:</span><span class="tooltip-value-accent">${escapeHtml(fmtUsd(basis, 2))}</span></div>`,
    `<div class="tooltip-row"><span class="tooltip-label">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;ROI:</span><span class="${roiClass}">${escapeHtml(roiText)}</span></div>`,
  ].join("");

  tooltip.classList.add("show");

  const clientX = Number(hoverEvent?.clientX);
  const clientY = Number(hoverEvent?.clientY);
  const panelRect = chart.getBoundingClientRect();
  if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
    placeChartTooltip(tooltip, clientX, clientY, panelRect);
    return;
  }

  placeChartTooltip(tooltip, panelRect.left + (panelRect.width / 2), panelRect.top + 28, panelRect);
}

function bindChartTooltip(chart) {
  if (!chart || chart.dataset.customTooltipBound === "1") return;
  chart.dataset.customTooltipBound = "1";

  chart.addEventListener("mousemove", (event) => {
    const rows = chart.__dcaTooltipRows || [];
    const geometry = chart.__dcaChartGeometry;
    const hoverLine = chart.querySelector(".dca-hover-line");
    if (state.dateRange.isPlaying) {
      if (hoverLine) hoverLine.setAttribute("visibility", "hidden");
      hideChartTooltip();
      return;
    }
    if (!rows.length || !geometry || !hoverLine) {
      hideChartTooltip();
      return;
    }

    const rect = chart.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    if (
      localX < geometry.plotLeft ||
      localX > geometry.plotRight ||
      localY < geometry.plotTop ||
      localY > geometry.plotBottom
    ) {
      hoverLine.setAttribute("visibility", "hidden");
      hideChartTooltip();
      return;
    }

    const ratio = (localX - geometry.plotLeft) / Math.max(1, geometry.plotRight - geometry.plotLeft);
    const estimatedDaysAgo = geometry.maxDays - (ratio * (geometry.maxDays - 1));
    const hoverRow = rows.find((row) => row.daysAgo === Math.round(estimatedDaysAgo)) || findNearestRowByDays(rows, estimatedDaysAgo);
    if (!hoverRow) {
      hoverLine.setAttribute("visibility", "hidden");
      hideChartTooltip();
      return;
    }

    const hoverX = geometry.xForDay(hoverRow.daysAgo);
    hoverLine.setAttribute("x1", hoverX.toFixed(2));
    hoverLine.setAttribute("x2", hoverX.toFixed(2));
    hoverLine.setAttribute("y1", geometry.plotTop.toFixed(2));
    hoverLine.setAttribute("y2", geometry.plotBottom.toFixed(2));
    hoverLine.setAttribute("visibility", "visible");
    showChartTooltip(chart, hoverRow, event);
  });

  chart.addEventListener("mouseleave", () => {
    const hoverLine = chart.querySelector(".dca-hover-line");
    if (hoverLine) hoverLine.setAttribute("visibility", "hidden");
    hideChartTooltip();
  });
}

function syncCustomLegend(traces, colors) {
  const legendEl = document.getElementById("chartLegend");
  if (!legendEl) return;

  const items = traces
    .filter((t) => t.name && t.showlegend !== false)
    .map((t) => {
      const color = t.line?.color || colors.fg;
      const isDashed = t.line?.dash === "dash";
      const swatchStyle = isDashed
        ? `color: ${color};`
        : `background: ${color};`;
      const swatchClass = isDashed ? "legend-swatch dashed" : "legend-swatch";
      return `<span class="legend-item"><span class="${swatchClass}" style="${swatchStyle}"></span>${escapeHtml(t.name)}</span>`;
    });

  legendEl.innerHTML = items.join("");
}

function renderChart() {
  const rows = getFilteredRows();
  if (rows.length) {
    updateKpis(rows);
  }

  const chart = document.getElementById("costBasisChart");
  if (!chart) return;

  if (!rows.length) {
    chart.innerHTML = "";
    hideChartTooltip();
    return;
  }

  chart.__dcaTooltipRows = rows;

  const colors = getThemeColors();
  const x = rows.map((r) => r.daysAgo);
  const historicalPrice = rows.map((r) => r.historicalPrice);
  const dcaBasis = rows.map((r) => r.dcaBasis);
  const priceUp = rows.map((r) => (r.isPriceAbove === 1 ? r.historicalPrice : null));
  const priceDown = rows.map((r) => (r.isPriceAbove === 0 ? r.historicalPrice : null));
  const custom = rows.map((r) => [r.dateIso, r.purchaseCount]);

  // Bridge transitions using the color of the right-side segment (lower day count).
  for (let i = 0; i < rows.length - 1; i += 1) {
    const curr = rows[i];
    const next = rows[i + 1];
    if (curr.isPriceAbove === next.isPriceAbove) continue;

    if (curr.isPriceAbove === 1) {
      priceUp[i + 1] = next.historicalPrice;
    } else {
      priceDown[i + 1] = next.historicalPrice;
    }
  }

  const latestRow = rows[rows.length - 1];
  const rawCurrentPrice = Number.isFinite(latestRow.currentPrice)
    ? latestRow.currentPrice
    : latestRow.historicalPrice;

  const traces = [
    {
      name: "Positive ROI",
      type: "scatter",
      mode: "lines",
      x,
      y: priceUp,
      line: { color: colors.up, width: 2 },
      customdata: custom,
      hoverinfo: "none",
    },
    {
      name: "Negative ROI",
      type: "scatter",
      mode: "lines",
      x,
      y: priceDown,
      line: { color: colors.down, width: 2 },
      customdata: custom,
      hoverinfo: "none",
    },
    {
      name: "DCA Cost Basis",
      type: "scatter",
      mode: "lines",
      x,
      y: dcaBasis,
      line: { color: colors.basis, width: 4 },
      customdata: custom,
      hoverinfo: "none",
    },
  ];

  const maxDays = Math.max(...x);

  const allYValues = [
    ...historicalPrice.filter((v) => Number.isFinite(v) && v >= 0),
    ...dcaBasis.filter((v) => Number.isFinite(v) && v >= 0),
  ];
  if (Number.isFinite(rawCurrentPrice) && rawCurrentPrice >= 0) {
    allYValues.push(rawCurrentPrice);
  }

  const currentPrice = Number.isFinite(rawCurrentPrice) && rawCurrentPrice > 0
    ? rawCurrentPrice
    : (allYValues.length ? allYValues[allYValues.length - 1] : NaN);

  traces.push({
    name: "Current Price",
    type: "scatter",
    mode: "lines",
    x: [null],
    y: [null],
    line: { color: colors.currentLine, width: 1.5, dash: "dash" },
    hoverinfo: "skip",
    showlegend: true,
  });

  traces.push({
    type: "scatter",
    mode: "lines",
    x: [1, maxDays],
    y: [null, null],
    xaxis: "x2",
    yaxis: "y",
    hoverinfo: "skip",
    showlegend: false,
    line: { width: 0 },
    opacity: 0,
  });

  // Render legend first so height measurements are consistent on initial load.
  syncCustomLegend(traces, colors);

  // Clear before measuring so the old SVG's pixel height doesn't inflate
  // chart.parentElement.clientHeight and cause the chart to grow on resize.
  chart.innerHTML = "";

  const legendEl = document.getElementById("chartLegend");
  const hostHeight = chart.parentElement?.clientHeight || chart.clientHeight || 420;
  const legendHeight = legendEl?.offsetHeight || 0;
  const width = Math.max(320, Math.round(chart.clientWidth || chart.parentElement?.clientWidth || 900));
  const height = Math.max(280, Math.round(hostHeight - legendHeight));
  const labelSizes = getResponsiveChartLabelSizes(width);
  const currentPriceOverlayMetrics = getCurrentPriceOverlayMetrics(labelSizes);
  const margins = {
    top: 28,
    right: Math.max(88, currentPriceOverlayMetrics.rightMargin),
    bottom: 58,
    left: 24,
  };
  const topTitleY = 24;
  const topTickY = 52;
  const bottomTickY = height - 48;
  const bottomTitleY = height - 20;
  const plotLeft = margins.left;
  const plotRight = width - margins.right;
  const plotTop = margins.top + 30;
  const plotBottom = height - margins.bottom - 8;
  const yAxis = buildYScaleConfig(allYValues, state.yScale);
  const ticks = buildDurationTickConfig(maxDays);
  const dateTicks = buildDateTickConfig(rows, width);
  const xForDay = (day) => {
    const ratio = (maxDays - day) / Math.max(1, maxDays - 1);
    return plotLeft + (ratio * Math.max(1, plotRight - plotLeft));
  };
  const yForValue = (value) => yAxis.map(value, plotTop, Math.max(1, plotBottom - plotTop));
  const rawBottomTicks = maxDays >= 365 && maxDays <= 365 * 4
    ? ticks
    : filterTicksByPixelSpacing(
      ticks.tickvals,
      ticks.ticktext,
      (day) => xForDay(day),
      width < 520 ? 56 : width < 860 ? 42 : 32,
    );
  const topTicks = filterDateTicksByPixelSpacing(
    dateTicks.tickvals,
    dateTicks.ticktext,
    (day) => xForDay(day),
    width < 520 ? 86 : width < 860 ? 68 : 54,
  );
  const { bottomTicks, topTicks: balancedTopTicks } = balanceXAxisTickCounts(rawBottomTicks, topTicks);
  const rightTicks = filterTicksByPixelSpacing(
    yAxis.tickvals,
    yAxis.ticktext,
    (value) => yForValue(value),
    labelSizes.yTick * 1.45,
    { preserveFirst: true, preserveLast: true },
  );
  chart.innerHTML = buildChartSvgMarkup({
    width,
    height,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    xForDay,
    yForValue,
    bottomTicks,
    topTicks: balancedTopTicks,
    rightTicks,
    colors,
    rows,
    priceUp,
    priceDown,
    dcaBasis,
    currentPrice,
    maxDays,
    topTitleY,
    topTickY,
    bottomTickY,
    bottomTitleY,
    labelSizes,
  });
  chart.__dcaChartGeometry = {
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    maxDays,
    xForDay,
    yForValue,
  };
  bindChartTooltip(chart);
  window.requestAnimationFrame(() => {
    syncCurrentPriceOverlay(chart, currentPrice, colors);
  });
}

function bindControls() {
  const cadenceSelect = document.getElementById("cadenceSelect");
  const scaleSelect = document.getElementById("scaleSelect");
  const toggleHalvings = document.getElementById("toggleHalvings");
  const startBtn = document.getElementById("dateRangeStartBtn");
  const endBtn = document.getElementById("dateRangeEndBtn");
  const startInput = document.getElementById("dateRangeStartInput");
  const endInput = document.getElementById("dateRangeEndInput");
  const daysInput = document.getElementById("dateRangeDaysInput");
  const sliderWrap = document.getElementById("dateRangeSliderWrap");
  const startSlider = document.getElementById("dateRangeStartSlider");
  const endSlider = document.getElementById("dateRangeEndSlider");
  const currentMarker = document.querySelector(".date-range-current-marker");
  const playBtn = document.getElementById("dateRangePlayBtn");
  const pauseBtn = document.getElementById("dateRangePauseBtn");
  const stopBtn = document.getElementById("dateRangeStopBtn");
  const speedBtn = document.getElementById("dateRangeSpeedBtn");
  const downloadBtn = document.getElementById("dateRangeDownloadBtn");
  const settingsBtn = document.getElementById("dateRangeSettingsBtn");
  const settingsMenu = document.getElementById("dateRangeSettingsMenu");
  const settingsDownloadBtn = document.getElementById("downloadSettingsDownloadBtn");
  bindDashboardActionButtons();
  bindDashboardExpandButton();
  const closeDownloadSettingsMenu = () => {
    settingsMenu?.classList.remove("open");
    settingsBtn?.classList.remove("is-open");
  };

  cadenceSelect?.addEventListener("change", () => {
    state.cadence = cadenceSelect.value;
    syncSelectDropdown("cadenceSelect", "cadenceDropdownTrigger", "cadenceDropdownMenu");
    saveControls();
    renderChart();
  });

  scaleSelect?.addEventListener("change", () => {
    state.yScale = scaleSelect.value;
    syncSelectDropdown("scaleSelect", "scaleDropdownTrigger", "scaleDropdownMenu");
    saveControls();
    renderChart();
  });

  toggleHalvings?.addEventListener("change", () => {
    state.showHalvings = toggleHalvings.checked;
    saveControls();
    renderChart();
  });

  startInput?.addEventListener("change", () => {
    setLastAdjustedDateRangeHandle("start");
    setDateRange(startInput.value, state.dateRange.endIso, "custom");
  });

  endInput?.addEventListener("change", () => {
    setLastAdjustedDateRangeHandle("end");
    setDateRange(state.dateRange.startIso, endInput.value, "custom");
  });

  daysInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitDateRangeDaysInput(daysInput);
      daysInput.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      const fallback = Number.parseInt(daysInput.dataset.lastValidValue || "0", 10);
      daysInput.value = fallback > 0 ? fallback.toLocaleString("en-US") : "";
      daysInput.blur();
    }
  });

  daysInput?.addEventListener("focus", () => selectDateRangeDaysInput(daysInput));
  daysInput?.addEventListener("click", () => selectDateRangeDaysInput(daysInput));
  daysInput?.addEventListener("input", () => handleDateRangeDaysInput(daysInput));

  daysInput?.addEventListener("blur", () => {
    commitDateRangeDaysInput(daysInput);
  });

  if (startBtn && endBtn && startInput && endInput) {
    const startPicker = makeDatePicker({
      anchorEl: startBtn,
      align: "left",
      getSelected: () => startInput.value || state.dateRange.startIso,
      getMin: () => startInput.min || getDataBounds().minIso,
      getMax: () => startInput.max || state.dateRange.endIso,
      onSelect: (isoVal) => {
        setLastAdjustedDateRangeHandle("start");
        setDateRange(isoVal, state.dateRange.endIso, "custom");
        endPicker.rebuildCalendar();
      },
    });
    const endPicker = makeDatePicker({
      anchorEl: endBtn,
      align: "left",
      getSelected: () => endInput.value || state.dateRange.endIso,
      getMin: () => endInput.min || state.dateRange.startIso,
      getMax: () => endInput.max || getDataBounds().maxIso,
      onSelect: (isoVal) => {
        setLastAdjustedDateRangeHandle("end");
        setDateRange(state.dateRange.startIso, isoVal, "custom");
        startPicker.rebuildCalendar();
      },
    });
    startBtn.addEventListener("click", startPicker.toggle);
    endBtn.addEventListener("click", endPicker.toggle);
  }

  startSlider?.addEventListener("input", () => {
    stopDateRangePlayback(false);
    setLastAdjustedDateRangeHandle("start");
    const rawIndex = Number.parseInt(startSlider.value || "0", 10);
    const endIndex = findDateIndex(state.dateRange.endIso, "floor");
    const index = Math.max(0, Math.min(rawIndex, Math.max(0, endIndex)));
    if (!state.priceRows[index]) return;
    state.dateRange.startIso = state.priceRows[index].dateIso;
    state.dateRange.currentEndIso = state.dateRange.endIso;
    state.dateRange.selectedPreset = "custom";
    saveDateRangeState();
    syncDateRangeControls();
    renderChart();
  });

  endSlider?.addEventListener("input", () => {
    stopDateRangePlayback(false);
    setLastAdjustedDateRangeHandle("end");
    const rawIndex = Number.parseInt(endSlider.value || "0", 10);
    const startIndex = findDateIndex(state.dateRange.startIso, "ceil");
    const index = Math.max(Math.max(0, startIndex), Math.min(rawIndex, state.priceRows.length - 1));
    if (!state.priceRows[index]) return;
    state.dateRange.endIso = state.priceRows[index].dateIso;
    state.dateRange.currentEndIso = state.dateRange.endIso;
    state.dateRange.selectedPreset = "custom";
    saveDateRangeState();
    syncDateRangeControls();
    renderChart();
  });

  currentMarker?.addEventListener("pointerdown", beginDateRangeCurrentMarkerDrag);
  currentMarker?.addEventListener("pointermove", moveDateRangeCurrentMarkerDrag);
  currentMarker?.addEventListener("pointerup", endDateRangeCurrentMarkerDrag);
  currentMarker?.addEventListener("pointercancel", endDateRangeCurrentMarkerDrag);
  document.querySelector(".date-range-start-marker")?.addEventListener("pointerdown", (event) => {
    beginDateRangeHandleDrag(event, "start", sliderWrap || event.currentTarget);
  });
  document.querySelector(".date-range-end-marker")?.addEventListener("pointerdown", (event) => {
    beginDateRangeHandleDrag(event, "end", sliderWrap || event.currentTarget);
  });
  sliderWrap?.addEventListener("pointerdown", beginDateRangeSliderWrapScrub);
  sliderWrap?.addEventListener("pointermove", moveDateRangeCurrentMarkerDrag);
  sliderWrap?.addEventListener("pointerup", endDateRangeCurrentMarkerDrag);
  sliderWrap?.addEventListener("pointercancel", endDateRangeCurrentMarkerDrag);

  document.querySelectorAll("[data-range-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const preset = button.dataset.rangePreset || "full";
      const { maxIso } = getDataBounds();
      const endIso = maxIso;
      setDateRange(getPresetStartIso(preset, endIso), endIso, preset);
    });
  });

  playBtn?.addEventListener("click", playDateRangePlayback);
  pauseBtn?.addEventListener("click", pauseDateRangePlayback);
  stopBtn?.addEventListener("click", () => {
    stopDateRangePlayback(true);
    syncDateRangeControls();
    renderChart();
  });
  speedBtn?.addEventListener("click", cyclePlaybackSpeed);
  downloadBtn?.addEventListener("click", () => {
    closeDownloadSettingsMenu();
    downloadDateRangeAnimation();
  });
  settingsDownloadBtn?.addEventListener("click", () => {
    if (isDateRangeExporting) {
      requestDateRangeExportCancel();
      return;
    }
    saveDownloadSettings();
    closeDownloadSettingsMenu();
    downloadDateRangeAnimation();
  });

  settingsBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = !settingsMenu?.classList.contains("open");
    settingsMenu?.classList.toggle("open", open);
    settingsBtn.classList.toggle("is-open", open);
  });

  document.addEventListener("click", (event) => {
    if (!settingsMenu?.classList.contains("open")) return;
    if (settingsMenu.contains(event.target) || settingsBtn?.contains(event.target)) return;
    closeDownloadSettingsMenu();
  });

  [
    "downloadScaleSelect",
    "downloadOrientationSelect",
    "downloadQualitySelect",
    "downloadSpeedSelect",
    "downloadThemeSelect",
    "downloadExtensionSelect",
  ].forEach((groupId) => {
    const group = document.getElementById(groupId);
    group?.addEventListener("click", (event) => {
      const button = event.target.closest(".download-setting-option[data-value]");
      if (!button) return;
      const key = groupId
        .replace("download", "")
        .replace("Select", "")
        .replace(/^./, (char) => char.toLowerCase());
      state.downloadSettings[key] = button.dataset.value;
      state.downloadSettings = normalizeDownloadSettings(state.downloadSettings);
      saveDownloadSettings();
      syncDownloadSettingsControls();
    });
  });
  document.getElementById("downloadEndFrameHoldToggle")?.addEventListener("change", (event) => {
    state.downloadSettings.endFrameHold = !!event.target.checked;
    state.downloadSettings = normalizeDownloadSettings(state.downloadSettings);
    saveDownloadSettings();
    syncDownloadSettingsControls();
  });

  window.addEventListener("resize", () => {
    syncDateRangeControls();
    renderChart();
  });

  document.addEventListener("dashboard-theme-change", () => {
    renderChart();
  });
}

function showError(message) {
  const error = document.createElement("div");
  error.className = "error";
  error.textContent = message;
  document.querySelector("main")?.prepend(error);
}

function notifyParentHalFinneyOverlayState(isOpen) {
  if (window.self === window.top) return;
  try {
    window.parent?.postMessage(
      { type: "dca-hal-finney-overlay", open: !!isOpen },
      window.location.origin
    );
  } catch (_err) {
    // Best effort only.
  }
}

function bindHalFinneyEasterEgg() {
  const trigger = document.getElementById("halFinneyBtn");
  const overlay = document.getElementById("halFinneyOverlay");
  const overlayImage = document.getElementById("halFinneyOverlayImage");
  if (!trigger || !overlay || !overlayImage) return;

  const applyThemeVariant = () => {
    const isLight = document.documentElement.dataset.theme === "light";
    overlayImage.src = isLight
      ? "webapp_data/hal-finney-dca-light.jpeg"
      : "webapp_data/hal-finney-dca-dark.jpeg";
  };

  const close = () => {
    overlay.hidden = true;
    notifyParentHalFinneyOverlayState(false);
  };

  applyThemeVariant();

  trigger.addEventListener("click", () => {
    applyThemeVariant();
    overlay.hidden = false;
    notifyParentHalFinneyOverlayState(true);
  });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !overlay.hidden) {
      close();
    }
  });

  document.addEventListener("dashboard-theme-change", applyThemeVariant);
}

async function init() {
  try {
    loadControls();
    bindSelectDropdowns();
    populateUpdatedTimeZoneSelect();
    bindTimeZoneChipEvents();
    bindHalFinneyEasterEgg();
    applyControlValuesToUi();
    bindControls();
    bindDateRangeKeyboardShortcuts();
    bindDateRangeSessionPersistence();
    bindDateRangeExportUnloadGuard();
    primeKeyboardFocus();

    if (DASHBOARD_TIME?.CHANGE_EVENT) {
      window.addEventListener(DASHBOARD_TIME.CHANGE_EVENT, (event) => {
        const changedTimeZone = String(event?.detail?.timeZone || "").trim();
        if (!changedTimeZone) return;
        state.timeZone = changedTimeZone;
        populateUpdatedTimeZoneSelect();
        renderChart();
      });
    }
    if (DASHBOARD_TIME?.STORAGE_KEY) {
      window.addEventListener("storage", (event) => {
        if (event.key !== DASHBOARD_TIME.STORAGE_KEY) return;
        const changedTimeZone = getPreferredDashboardTimeZone();
        if (changedTimeZone === state.timeZone) return;
        state.timeZone = changedTimeZone;
        populateUpdatedTimeZoneSelect();
        renderChart();
      });
    }

    await loadData();
    renderChart();
    updateResetButtonUi();
    primeKeyboardFocus();
    if (state.dateRange.pendingSpacePlayback) {
      state.dateRange.pendingSpacePlayback = false;
      requestAnimationFrame(() => {
        if (!state.dateRange.isPlaying && !state.dateRange.isPaused) {
          playDateRangePlayback();
        }
      });
    }
  } catch (err) {
    console.error(err);
    showError(String(err?.message || err));
  }
}

init();
