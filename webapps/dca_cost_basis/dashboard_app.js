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
}

async function ensurePlotlyLoaded() {
  if (window.Plotly) return;

  const cdnUrls = [
    "https://cdn.plot.ly/plotly-2.35.2.min.js",
    "https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js",
    "https://unpkg.com/plotly.js-dist-min@2.35.2/plotly.min.js",
  ];

  for (const src of cdnUrls) {
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      if (window.Plotly) return;
    } catch (_) {
      // Try next CDN.
    }
  }

  throw new Error("Plotly failed to load from all CDN sources.");
}

async function loadData() {
  const [metadataResp, dailyResp, weeklyResp, monthlyResp] = await Promise.all([
    fetch("webapp_data/dca_cost_basis_metadata.json", { cache: "no-store" }),
    fetch("webapp_data/daily_dca.csv", { cache: "no-store" }),
    fetch("webapp_data/weekly_dca.csv", { cache: "no-store" }),
    fetch("webapp_data/monthly_dca.csv", { cache: "no-store" }),
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
    const desiredYearTicks = isAllRange ? 8 : 4;
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
  const shapeNode = chart?.querySelector(".shapelayer path, .shapelayer line");
  const hostRect = chart?.parentElement?.getBoundingClientRect();

  if (shapeNode && hostRect) {
    const shapeRect = shapeNode.getBoundingClientRect();
    if (Number.isFinite(shapeRect.top) && Number.isFinite(shapeRect.height)) {
      return (shapeRect.top - hostRect.top) + (shapeRect.height / 2);
    }
  }

  const yAxis = chart?._fullLayout?.yaxis;
  const plotHeight = chart?._fullLayout?._size?.h;
  const plotTop = chart?._fullLayout?._size?.t;

  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !yAxis || typeof yAxis.c2p !== "function" || !Number.isFinite(plotHeight) || !Number.isFinite(plotTop)) {
    return NaN;
  }

  const topPx = yAxis.c2p(currentPrice);
  if (!Number.isFinite(topPx)) {
    return NaN;
  }

  const minTop = plotTop;
  const maxTop = plotTop + plotHeight;
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getCadencePurchaseLabel() {
  if (state.cadence === "weekly_dca") return "Weekly Purchases";
  if (state.cadence === "monthly_dca") return "Monthly Purchases";
  return "Daily Purchases";
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
    `<div class="tooltip-row"><span class="tooltip-label">Start Date:</span><span>${escapeHtml(startDate)}</span></div>`,
    `<div class="tooltip-row"><span class="tooltip-label">Start Price:</span><span>${escapeHtml(fmtUsd(startPrice, 2))}</span></div>`,
    `<div class="tooltip-row"><span class="tooltip-label">${escapeHtml(getCadencePurchaseLabel())}:</span><span>${escapeHtml(Number(hoverRow.purchaseCount || 0).toLocaleString("en-US"))}</span></div>`,
    `<div class="tooltip-row"><span class="tooltip-label">Current Price:</span><span>${escapeHtml(fmtUsd(currentPrice, 2))}</span></div>`,
    `<div class="tooltip-row"><span class="tooltip-label">DCA Cost Basis:</span><span class="tooltip-value-accent">${escapeHtml(fmtUsd(basis, 2))}</span></div>`,
    `<div class="tooltip-row"><span class="tooltip-label">ROI:</span><span class="${roiClass}">${escapeHtml(roiText)}</span></div>`,
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

  chart.on("plotly_hover", (eventData) => {
    const rows = chart.__dcaTooltipRows || [];
    if (!rows.length) {
      hideChartTooltip();
      return;
    }

    const daysAgo = Number(eventData?.points?.[0]?.x);
    const hoverRow = rows.find((r) => r.daysAgo === daysAgo) || findNearestRowByDays(rows, daysAgo);
    if (!hoverRow) {
      hideChartTooltip();
      return;
    }

    showChartTooltip(chart, hoverRow, eventData?.event);
  });

  chart.on("plotly_unhover", () => {
    hideChartTooltip();
  });

  chart.addEventListener("mouseleave", () => {
    hideChartTooltip();
  });
}

function renderChart() {
  const chart = document.getElementById("costBasisChart");
  if (!chart || !window.Plotly) return;

  const rows = getFilteredRows();
  if (!rows.length) {
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

  const allYValues = [
    ...historicalPrice.filter((v) => Number.isFinite(v) && v > 0),
    ...dcaBasis.filter((v) => Number.isFinite(v) && v > 0),
  ];
  if (Number.isFinite(rawCurrentPrice) && rawCurrentPrice > 0) {
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

  const logTicks = state.yScale === "log"
    ? buildLogTickConfig(allYValues)
    : { tickvals: [], ticktext: [] };

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    margin: { l: 24, r: 88, t: 22, b: 52 },
    hovermode: "x unified",
    hoverdistance: 5,
    hoverlabel: {
      font: { family: "IBM Plex Mono, monospace", size: 12, color: colors.fg },
      bgcolor: document.documentElement.dataset.theme === "light" ? "#ffffff" : "#000000",
      bordercolor: document.documentElement.dataset.theme === "light" ? "rgba(0,0,0,0.12)" : "#223038",
    },
    legend: {
      orientation: "h",
      x: 0,
      y: 1.11,
      xanchor: "left",
      yanchor: "top",
      itemclick: false,
      itemdoubleclick: false,
      font: { family: "IBM Plex Mono, monospace", size: 11, color: colors.muted },
    },
    xaxis: {
      type: "linear",
      autorange: "reversed",
      showgrid: true,
      gridcolor: colors.grid,
      showspikes: true,
      spikemode: "across",
      spikesnap: "cursor",
      spikecolor: colors.fg,
      spikethickness: 1,
      spikedash: "dash",
      tickmode: "array",
      tickvals: ticks.tickvals,
      ticktext: ticks.ticktext,
      tickangle: 0,
      automargin: true,
      tickfont: { family: "IBM Plex Mono, monospace", color: colors.fg, size: 12 },
      title: {
        text: "DCA Duration",
        font: { family: "Space Grotesk, sans-serif", size: 12, color: colors.fg },
        standoff: 8,
      },
    },
    yaxis: {
      type: state.yScale,
      side: "right",
      showgrid: true,
      gridcolor: colors.grid,
      showspikes: false,
      tickmode: state.yScale === "log" ? "array" : "auto",
      tickvals: state.yScale === "log" ? logTicks.tickvals : undefined,
      ticktext: state.yScale === "log" ? logTicks.ticktext : undefined,
      tickprefix: state.yScale === "log" ? undefined : "$",
      separatethousands: state.yScale === "log" ? undefined : true,
      tickfont: { family: "IBM Plex Mono, monospace", color: colors.fg, size: 11 },
    },
    shapes: [
      {
        type: "line",
        x0: maxDays,
        x1: 1,
        y0: currentPrice,
        y1: currentPrice,
        line: { color: colors.currentLine, width: 1.5, dash: "dash" },
      },
      ...buildHalvingShapes(maxDays, colors),
    ],
    annotations: [
      ...buildHalvingAnnotations(maxDays, colors),
    ],
  };

  const config = {
    responsive: true,
    displaylogo: false,
    displayModeBar: false,
  };

  Plotly.react(chart, traces, layout, config).then(() => {
    bindChartTooltip(chart);
    window.requestAnimationFrame(() => {
      syncCurrentPriceOverlay(chart, currentPrice, colors);
    });
  });
  updateKpis(rows);
}

function bindControls() {
  const cadenceSelect = document.getElementById("cadenceSelect");
  const rangeSelect = document.getElementById("rangeSelect");
  const scaleSelect = document.getElementById("scaleSelect");
  const toggleHalvings = document.getElementById("toggleHalvings");

  cadenceSelect?.addEventListener("change", () => {
    state.cadence = cadenceSelect.value;
    saveControls();
    renderChart();
  });

  rangeSelect?.addEventListener("change", () => {
    state.rangeDays = Number(rangeSelect.value || "0");
    saveControls();
    renderChart();
  });

  scaleSelect?.addEventListener("change", () => {
    state.yScale = scaleSelect.value;
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

async function init() {
  try {
    loadControls();
    populateUpdatedTimeZoneSelect();
    bindTimeZoneChipEvents();
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

    await Promise.race([
      ensurePlotlyLoaded(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out loading Plotly.")), 12000)),
    ]);

    await loadData();
    renderChart();
  } catch (err) {
    console.error(err);
    showError(String(err?.message || err));
  }
}

init();
