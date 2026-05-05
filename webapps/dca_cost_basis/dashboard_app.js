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
const DASHBOARD_TIME = window.WSBDashboardTime || null;

const state = {
  cadence: "daily_dca",
  rangeDays: 0,
  yScale: "linear",
  showHalvings: true,
  timeZone: "UTC",
  metadata: null,
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
    selectId: "rangeSelect",
    dropdownId: "rangeDropdown",
    triggerId: "rangeDropdownTrigger",
    menuId: "rangeDropdownMenu",
  },
  {
    selectId: "scaleSelect",
    dropdownId: "scaleDropdown",
    triggerId: "scaleDropdownTrigger",
    menuId: "scaleDropdownMenu",
  },
];

let selectDropdownGlobalListenersBound = false;

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

  const probeEl = valueEl || trigger;
  if (!probeEl) return;

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

  const dropdownStyle = window.getComputedStyle(dropdown);
  const leftPad = parseCssPx(dropdownStyle.getPropertyValue("--dca-dropdown-content-pad"), 10);
  const rightPad = parseCssPx(dropdownStyle.getPropertyValue("--dca-dropdown-arrow-gap"), 18);
  const fudge = 1;
  const width = Math.ceil(maxTextWidth + leftPad + rightPad + fudge);
  dropdown.style.width = `${Math.max(54, width)}px`;
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

  sizeSelectDropdownToOptions(selectId, triggerId.replace("Trigger", "Dropdown"), triggerId);
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
      const nextValue = String(btn.dataset.value || "");
      if (select.value !== nextValue) {
        select.value = nextValue;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      syncSelectDropdown(selectId, triggerId, menuId);
      setDropdownOpen(dropdown, menu, false);
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

function buildLogTickConfig(values) {
  const safeValues = values.filter((v) => Number.isFinite(v) && v > 0);
  if (!safeValues.length) return { tickvals: [], ticktext: [] };

  const minY = Math.min(...safeValues);
  const maxY = Math.max(...safeValues);
  const minExp = Math.floor(Math.log10(minY));
  const maxExp = Math.ceil(Math.log10(maxY));
  const spanDecades = Math.log10(maxY) - Math.log10(minY);

  let multipliers;
  if (spanDecades <= 0.35) {
    multipliers = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9];
  } else if (spanDecades <= 0.7) {
    multipliers = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9];
  } else if (spanDecades <= 1.2) {
    multipliers = [1, 2, 3, 4, 5, 6, 8];
  } else if (spanDecades <= 1.8) {
    multipliers = [1, 2, 3, 5, 7];
  } else {
    multipliers = [1, 2, 5];
  }

  const tickSet = new Set();
  for (let exp = minExp; exp <= maxExp; exp += 1) {
    const base = 10 ** exp;
    multipliers.forEach((mult) => {
      const tick = mult * base;
      if (tick >= minY * 0.97 && tick <= maxY * 1.03) {
        tickSet.add(Number(tick.toPrecision(10)));
      }
    });
  }

  const tickvals = Array.from(tickSet).sort((a, b) => a - b);
  const ticktext = tickvals.map((v) => fmtUsdCompactTick(v));
  return { tickvals, ticktext };
}

function loadControls() {
  try {
    const raw = localStorage.getItem(CONTROLS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);

    if (["daily_dca", "weekly_dca", "monthly_dca"].includes(parsed.cadence)) {
      state.cadence = parsed.cadence;
    }
    const parsedRange = Number(parsed.rangeDays);
    if (Number.isFinite(parsedRange) && parsedRange >= 0) {
      state.rangeDays = Math.round(parsedRange);
    }
    if (["linear", "log"].includes(parsed.yScale)) {
      state.yScale = parsed.yScale;
    }
    if (typeof parsed.showHalvings === "boolean") {
      state.showHalvings = parsed.showHalvings;
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
      rangeDays: state.rangeDays,
      yScale: state.yScale,
      showHalvings: state.showHalvings,
    }));
  } catch (_) {
    // Ignore storage failures.
  }
}

function applyControlValuesToUi() {
  const cadenceSelect = document.getElementById("cadenceSelect");
  const rangeSelect = document.getElementById("rangeSelect");
  const scaleSelect = document.getElementById("scaleSelect");
  const toggleHalvings = document.getElementById("toggleHalvings");

  if (cadenceSelect) cadenceSelect.value = state.cadence;
  if (rangeSelect) {
    ensureCustomRangeOption(rangeSelect, state.rangeDays);
    rangeSelect.value = String(state.rangeDays);
  }
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
}

function getThemeColors() {
  const style = getComputedStyle(document.documentElement);
  const isLight = document.documentElement.dataset.theme === "light";
  return {
    fg: style.getPropertyValue("--fg").trim() || (isLight ? "#1c1b19" : "#f1f5f7"),
    muted: style.getPropertyValue("--muted").trim() || (isLight ? "#6f685f" : "#95a6ae"),
    grid: isLight ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.14)",
    halvingLine: isLight ? "rgba(0,0,0,0.28)" : "rgba(255,255,255,0.34)",
    up: style.getPropertyValue("--price-up").trim() || "#41b36b",
    down: style.getPropertyValue("--price-down").trim() || "#d33a45",
    basis: style.getPropertyValue("--accent").trim() || "#ff9f1c",
    currentLine: isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.65)",
  };
}

function getFilteredRows() {
  const all = state.seriesByCadence[state.cadence] || [];
  if (!all.length) return [];

  const scoped = state.rangeDays > 0
    ? all.filter((row) => row.daysAgo <= state.rangeDays)
    : all.slice();

  return scoped.sort((a, b) => a.daysAgo - b.daysAgo);
}

function buildDurationTickConfig(maxDays, selectedRangeDays = 0) {
  const safeMax = Math.max(1, Math.round(maxDays));
  const tickSet = new Set([1]);
  const isAllRange = selectedRangeDays === 0;

  // For the 1Y preset, use explicit 10-week intervals for consistent readability.
  if (selectedRangeDays === 365) {
    const weeklyStepDays = 70; // 10 weeks
    for (let day = weeklyStepDays; day <= safeMax; day += weeklyStepDays) {
      tickSet.add(day);
    }
    tickSet.add(365);

    const tickvals = Array.from(tickSet)
      .filter((day) => day >= 1 && day <= safeMax)
      .sort((a, b) => a - b);

    const ticktext = tickvals.map((day) => {
      if (day === 365) return "1Y";
      if (day >= 7 && day % 7 === 0) return `${day / 7}W`;
      return day === 1 ? "1D" : `${day}D`;
    });

    return { tickvals, ticktext };
  }

  const yearCount = Math.floor(safeMax / 365.25);
  if (yearCount >= 1) {
    const isEightYearPreset = selectedRangeDays === 2920;
    const desiredYearTicks = isAllRange ? 8 : (isEightYearPreset ? 8 : 4);
    const rawYearStep = Math.max(1, Math.round(yearCount / desiredYearTicks));
    const niceYearSteps = [1, 2, 3, 4, 5, 10];
    const yearStep = niceYearSteps.find((step) => step >= rawYearStep) || rawYearStep;
    for (let y = yearStep; y <= yearCount; y += yearStep) {
      tickSet.add(Math.round(y * 365.25));
    }
  } else {
    const desiredTicks = 5;
    const target = safeMax / desiredTicks;
    const niceDaySteps = [1, 2, 3, 5, 7, 10, 14, 21, 28, 35, 42, 56, 70, 84, 112, 140, 168, 210, 280];
    const dayStep = niceDaySteps.find((step) => step >= target) || niceDaySteps[niceDaySteps.length - 1];
    for (let day = dayStep; day <= safeMax; day += dayStep) {
      tickSet.add(day);
    }
  }

  if (!isAllRange) {
    tickSet.add(safeMax);
  }

  const tickvals = Array.from(tickSet)
    .filter((day) => day >= 1 && day <= safeMax)
    .sort((a, b) => a - b);

  const ticktext = tickvals.map((day) => {
    const years = day / 365.25;
    if (day >= 365 && Math.abs(years - Math.round(years)) < 0.03) {
      const wholeYears = Math.round(years);
      return `${wholeYears}Y`;
    }
    if (day >= 14 && day % 7 === 0) {
      const weeks = day / 7;
      return `${weeks}W`;
    }
    return day === 1 ? "1D" : `${day}D`;
  });

  return { tickvals, ticktext };
}

function buildDateTickConfig(rows) {
  if (!rows.length) return { tickvals: [], ticktext: [] };

  // Derive "today" from the most recent row (rows sorted ascending by daysAgo)
  const newestRow = rows[0];
  if (!newestRow.dateIso) return { tickvals: [], ticktext: [] };
  const newestDate = new Date(newestRow.dateIso + "T00:00:00Z");
  if (isNaN(newestDate.getTime())) return { tickvals: [], ticktext: [] };
  const todayUtc = new Date(newestDate.getTime() + newestRow.daysAgo * 86400000);

  const maxDays = rows[rows.length - 1].daysAgo;
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const useYearsOnly = maxDays > 730;
  const tickvals = [];
  const ticktext = [];

  if (useYearsOnly) {
    const candidates = [];
    for (let y = todayUtc.getUTCFullYear(); y >= 2009; y--) {
      const jan1 = new Date(Date.UTC(y, 0, 1));
      const daysAgo = Math.round((todayUtc.getTime() - jan1.getTime()) / 86400000);
      if (daysAgo >= 1 && daysAgo <= maxDays) {
        candidates.push({ daysAgo, label: String(y) });
      }
    }
    // Thin ticks to avoid crowding (target ≤ 10 visible ticks)
    const niceSteps = [1, 2, 3, 4, 5, 10];
    const rawStep = Math.ceil(candidates.length / 10);
    const step = niceSteps.find((s) => s >= rawStep) || rawStep;
    candidates
      .filter((_, i) => i % step === 0)
      .forEach((c) => { tickvals.push(c.daysAgo); ticktext.push(c.label); });
  } else {
    const todayYear = todayUtc.getUTCFullYear();
    const todayMonth = todayUtc.getUTCMonth();
    for (let y = todayYear; y >= 2009; y--) {
      const mEnd = y === todayYear ? todayMonth : 11;
      for (let m = mEnd; m >= 0; m--) {
        const monthStart = new Date(Date.UTC(y, m, 1));
        const daysAgo = Math.round((todayUtc.getTime() - monthStart.getTime()) / 86400000);
        if (daysAgo < 1 || daysAgo > maxDays) continue;
        tickvals.push(daysAgo);
        ticktext.push(m === 0 ? String(y) : monthNames[m]);
      }
    }
  }

  return { tickvals, ticktext };
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

function buildHalvingShapes(maxDays, colors) {
  if (!state.showHalvings) return [];
  const halvings = Array.isArray(state.metadata?.halvings) ? state.metadata.halvings : [];

  return halvings
    .map((h) => ({ label: String(h.label || "Halving"), daysAgo: Number(h.days_ago) }))
    .filter((h) => Number.isFinite(h.daysAgo) && h.daysAgo >= 1 && h.daysAgo <= maxDays)
    .map((h) => ({
      type: "line",
      x0: h.daysAgo,
      x1: h.daysAgo,
      y0: 0,
      y1: 1,
      yref: "paper",
      line: { color: colors.halvingLine, width: 1.4, dash: "dot" },
    }));
}

function buildHalvingAnnotations(maxDays, colors) {
  if (!state.showHalvings) return [];
  const halvings = Array.isArray(state.metadata?.halvings) ? state.metadata.halvings : [];

  return halvings
    .map((h) => ({ label: String(h.label || "Halving"), date: String(h.date || ""), daysAgo: Number(h.days_ago) }))
    .filter((h) => Number.isFinite(h.daysAgo) && h.daysAgo >= 1 && h.daysAgo <= maxDays)
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
  overlay.style.top = `${topPx}px`;
  overlay.style.color = colors.fg;
  overlay.style.borderColor = colors.grid;
  overlay.style.background = document.documentElement.dataset.theme === "light"
    ? "rgba(255,255,255,0.90)"
    : "rgba(0,0,0,0.82)";
  overlay.hidden = false;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

function buildLinearYAxisConfig(values, tickCount = 10) {
  const safeValues = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (!safeValues.length) {
    return {
      min: 1,
      max: 10,
      tickvals: [1, 5, 10],
      ticktext: [fmtUsd(1, 0), fmtUsd(5, 0), fmtUsd(10, 0)],
    };
  }

  const minValue = Math.min(...safeValues);
  const maxValue = Math.max(...safeValues);
  const rawSpan = maxValue - minValue;
  const span = rawSpan > 1e-9 ? rawSpan : Math.max(Math.abs(maxValue) * 0.1, 1);
  const pad = span * 0.05;
  const paddedMin = minValue - pad;
  const paddedMax = maxValue + pad;
  const range = niceNumber(Math.max(paddedMax - paddedMin, Math.abs(maxValue) * 0.15), false);
  const step = niceNumber(range / Math.max(2, tickCount - 1), true);
  const minTick = Math.ceil(paddedMin / step) * step;
  const maxTick = Math.floor(paddedMax / step) * step;
  const tickvals = [];

  for (let value = minTick; value <= maxTick + (step * 0.5); value += step) {
    tickvals.push(Number(value.toPrecision(12)));
  }

  if (!tickvals.length) {
    tickvals.push(Number(paddedMax.toPrecision(12)));
  }

  return {
    min: paddedMin,
    max: paddedMax,
    tickvals,
    ticktext: tickvals.map((value) => formatPriceAxisTick(value)),
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

    let minValue = Math.min(...safeValues);
    let maxValue = Math.max(...safeValues);

    if (Math.abs(maxValue - minValue) < 1e-9) {
      minValue *= 0.92;
      maxValue *= 1.08;
    }

    const minLog = Math.log10(minValue);
    const maxLog = Math.log10(maxValue);
    const logSpan = Math.max(1e-9, maxLog - minLog);
    const logPad = logSpan * 0.05;
    const domainMinLog = minLog - logPad;
    const domainMaxLog = maxLog + logPad;
    const min = 10 ** domainMinLog;
    const max = 10 ** domainMaxLog;
    const ticks = buildLogTickConfig(safeValues)
      .tickvals
      .filter((value) => value >= min && value <= max);
    const ticktext = ticks.map((value) => fmtUsdCompactTick(value));

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

function limitTicksToCount(ticks, targetCount) {
  const values = Array.isArray(ticks?.tickvals) ? ticks.tickvals : [];
  const text = Array.isArray(ticks?.ticktext) ? ticks.ticktext : [];
  const desiredCount = Math.max(2, Math.round(targetCount || 0));

  if (values.length <= desiredCount) {
    return {
      tickvals: values.slice(),
      ticktext: text.slice(),
    };
  }

  const lastIndex = values.length - 1;
  const kept = new Set([0, lastIndex]);

  // Keep all whole-year duration markers (e.g. 1Y, 2Y, 4Y) so key anchors
  // are never dropped when matching top-axis density.
  text.forEach((label, index) => {
    if (/^\d+Y$/i.test(String(label || "").trim())) {
      kept.add(index);
    }
  });

  for (let i = 1; i < desiredCount - 1; i += 1) {
    const ratio = i / Math.max(1, desiredCount - 1);
    kept.add(Math.round(ratio * lastIndex));
  }

  const indices = Array.from(kept).sort((left, right) => left - right);
  return {
    tickvals: indices.map((index) => values[index]),
    ticktext: indices.map((index) => text[index]),
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
  } = options;

  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const xDays = rows.map((row) => row.daysAgo);
  const basisPath = buildLinePath(xDays, dcaBasis, xForDay, yForValue);
  const upPath = buildLinePath(xDays, priceUp, xForDay, yForValue);
  const downPath = buildLinePath(xDays, priceDown, xForDay, yForValue);
  const currentY = yForValue(currentPrice);

  const topVerticalGrid = topTicks.tickvals.map((day) => {
    const x = xForDay(day);
    return `<line x1="${x.toFixed(2)}" y1="${plotTop}" x2="${x.toFixed(2)}" y2="${plotBottom}" stroke="${colors.grid}" stroke-width="1" />`;
  }).join("");

  const verticalGrid = bottomTicks.tickvals.map((day) => {
    const x = xForDay(day);
    return `<line x1="${x.toFixed(2)}" y1="${plotTop}" x2="${x.toFixed(2)}" y2="${plotBottom}" stroke="${colors.grid}" stroke-width="1" />`;
  }).join("");

  const horizontalGrid = rightTicks.tickvals.map((value) => {
    const y = yForValue(value);
    return `<line x1="${plotLeft}" y1="${y.toFixed(2)}" x2="${plotRight}" y2="${y.toFixed(2)}" stroke="${colors.grid}" stroke-width="1" />`;
  }).join("");

  const bottomTickLabels = bottomTicks.tickvals.map((day, index) => {
    const x = xForDay(day);
    return `<text x="${x.toFixed(2)}" y="${bottomTickY}" text-anchor="middle" fill="${colors.fg}" font-family="IBM Plex Mono, monospace" font-size="12">${escapeHtml(bottomTicks.ticktext[index] || "")}</text>`;
  }).join("");

  const topTickLabels = topTicks.tickvals.map((day, index) => {
    const x = xForDay(day);
    return `<text x="${x.toFixed(2)}" y="${topTickY}" text-anchor="middle" fill="${colors.fg}" font-family="IBM Plex Mono, monospace" font-size="11">${escapeHtml(topTicks.ticktext[index] || "")}</text>`;
  }).join("");

  const rightTickLabels = rightTicks.tickvals.map((value, index) => {
    const y = yForValue(value);
    return `<text x="${plotRight + 8}" y="${(y + 4).toFixed(2)}" text-anchor="start" fill="${colors.fg}" font-family="IBM Plex Mono, monospace" font-size="11">${escapeHtml(rightTicks.ticktext[index] || "")}</text>`;
  }).join("");

  const halvingLines = buildHalvingShapes(maxDays, colors).map((shape) => {
    const x = xForDay(shape.x0);
    return `<line x1="${x.toFixed(2)}" y1="${plotTop}" x2="${x.toFixed(2)}" y2="${plotBottom}" stroke="${shape.line.color}" stroke-width="${shape.line.width}" stroke-dasharray="4 4" />`;
  }).join("");

  const halvingLabels = buildHalvingAnnotations(maxDays, colors).map((annotation) => {
    const lineX = xForDay(annotation.x);
    const isLeftLabel = annotation.xanchor === "right";
    const anchorY = plotTop + 6;
    const anchorX = lineX + (isLeftLabel ? -18 : 9);
    const textAnchor = "end";
    return `<text x="${anchorX.toFixed(2)}" y="${anchorY.toFixed(2)}" transform="rotate(270 ${anchorX.toFixed(2)} ${anchorY.toFixed(2)})" text-anchor="${textAnchor}" dominant-baseline="hanging" fill="${annotation.font.color}" font-family="IBM Plex Mono, monospace" font-size="${annotation.font.size}">${escapeHtml(annotation.text)}</text>`;
  }).join("");

  const frameLines = [
    `<line x1="${plotRight}" y1="${plotTop}" x2="${plotRight}" y2="${plotBottom}" stroke="${colors.grid}" stroke-width="1" />`,
  ].join("");

  const currentLine = Number.isFinite(currentY)
    ? `<line x1="${plotLeft}" y1="${currentY.toFixed(2)}" x2="${plotRight}" y2="${currentY.toFixed(2)}" stroke="${colors.currentLine}" stroke-width="1.5" stroke-dasharray="6 4" />`
    : "";

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-label="DCA cost basis chart" role="img">
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
      ${topVerticalGrid}
      ${verticalGrid}
      ${horizontalGrid}
      ${frameLines}
      ${halvingLines}
      ${currentLine}
      ${upPath ? `<path d="${upPath}" fill="none" stroke="${colors.up}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"></path>` : ""}
      ${downPath ? `<path d="${downPath}" fill="none" stroke="${colors.down}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"></path>` : ""}
      ${basisPath ? `<path d="${basisPath}" fill="none" stroke="${colors.basis}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></path>` : ""}
      <line class="dca-hover-line" x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}" stroke="${colors.fg}" stroke-width="1" stroke-dasharray="5 4" visibility="hidden"></line>
      ${bottomTickLabels}
      ${topTickLabels}
      ${rightTickLabels}
      ${halvingLabels}
      <text x="${(plotLeft + (plotWidth / 2)).toFixed(2)}" y="${bottomTitleY}" text-anchor="middle" fill="${colors.fg}" font-family="Space Grotesk, sans-serif" font-size="12">DCA Duration</text>
      <text x="${(plotLeft + (plotWidth / 2)).toFixed(2)}" y="${topTitleY}" text-anchor="middle" fill="${colors.fg}" font-family="Space Grotesk, sans-serif" font-size="12">DCA Starting Date</text>
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
  const ticks = buildDurationTickConfig(maxDays, state.rangeDays);
  const dateTicks = buildDateTickConfig(rows);

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

  const logTicks = state.yScale === "log"
    ? buildLogTickConfig(allYValues)
    : { tickvals: [], ticktext: [] };

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
  const margins = { top: 28, right: 88, bottom: 58, left: 24 };
  const topTitleY = 24;
  const topTickY = 44;
  const bottomTickY = height - 40;
  const bottomTitleY = height - 20;
  const plotLeft = margins.left;
  const plotRight = width - margins.right;
  const plotTop = margins.top + 22;
  const plotBottom = height - margins.bottom;
  const yAxis = buildYScaleConfig(allYValues, state.yScale);
  const xForDay = (day) => {
    const ratio = (maxDays - day) / Math.max(1, maxDays - 1);
    return plotLeft + (ratio * Math.max(1, plotRight - plotLeft));
  };
  const yForValue = (value) => yAxis.map(value, plotTop, Math.max(1, plotBottom - plotTop));
  const rawBottomTicks = filterTicksByPixelSpacing(
    ticks.tickvals,
    ticks.ticktext,
    (day) => xForDay(day),
    width < 520 ? 56 : width < 860 ? 42 : 32,
  );
  const topTicks = filterTicksByPixelSpacing(
    dateTicks.tickvals,
    dateTicks.ticktext,
    (day) => xForDay(day),
    width < 520 ? 86 : width < 860 ? 68 : 54,
  );
  const bottomTicks = limitTicksToCount(rawBottomTicks, topTicks.tickvals.length);
  const rightTicks = filterTicksByPixelSpacing(
    state.yScale === "log" ? logTicks.tickvals : yAxis.tickvals,
    state.yScale === "log" ? logTicks.ticktext : yAxis.ticktext,
    (value) => yForValue(value),
    18,
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
  const rangeSelect = document.getElementById("rangeSelect");
  const scaleSelect = document.getElementById("scaleSelect");
  const toggleHalvings = document.getElementById("toggleHalvings");

  cadenceSelect?.addEventListener("change", () => {
    state.cadence = cadenceSelect.value;
    syncSelectDropdown("cadenceSelect", "cadenceDropdownTrigger", "cadenceDropdownMenu");
    saveControls();
    renderChart();
  });

  rangeSelect?.addEventListener("change", () => {
    state.rangeDays = Number(rangeSelect.value || "0");
    syncSelectDropdown("rangeSelect", "rangeDropdownTrigger", "rangeDropdownMenu");
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

  window.addEventListener("resize", () => {
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

    if (DASHBOARD_TIME?.CHANGE_EVENT) {
      window.addEventListener(DASHBOARD_TIME.CHANGE_EVENT, (event) => {
        const changedTimeZone = String(event?.detail?.timeZone || "").trim();
        if (!changedTimeZone) return;
        state.timeZone = changedTimeZone;
        populateUpdatedTimeZoneSelect();
        renderChart();
      });
    }

    await loadData();
    renderChart();
  } catch (err) {
    console.error(err);
    showError(String(err?.message || err));
  }
}

init();
