const SATS_PER_BTC = 100_000_000;
const BLOCKS_PER_DAY = 144;
const SCRIPT_TYPES_ORDER = ["P2PK", "P2PKH", "P2SH", "P2WPKH", "P2WSH", "P2TR", "Other"];
const SPEND_TYPES_ORDER = ["never_spent", "inactive", "active"];

const state = {
  aggregatesRows: [],
  ge1Rows: [],
  scriptPanelMode: "bars",
  supplyDisplayMode: "total",
  historicalSeries: [],
  historicalSeriesLoading: false,
  historicalSeriesGe1Loading: false,
  historicalSeriesGe1AbortController: null,
  historicalSeriesGe1ActiveFilterKey: null,
  historicalSeriesGe1LoadProgress: null,
  historicalSeriesGe1LastCompletedFilterKey: null,
  historicalSeriesGe1FallbackFilterKey: null,
  historicalProgressiveYMaxSats: null,
  blockDatetimeByHeight: {},
  snapshotLabelDatetimeByHeight: {},
  snapshotHeight: null,
  availableSnapshots: [],
  selectedDetailTags: ["All"],
  selectedIdentityGroups: ["All"],
  selectedIdentityTags: ["All"],
  topExposureAddressQuery: "",
  identityGroupsByName: {},
  identityToGroupNames: {},
  identityGroupsLoaded: false,
  identityGroupsLoadingPromise: null,
  identityTagFilterQuery: "",
  snapshotDataCache: new Map(),
  topExposuresDataCache: new Map(),
  topExposuresVisibleCount: 250,
  topExposuresTotalCount: 0,
  topExposuresLoading: false,
  topExposuresFiltersCollapsed: false,
  scriptPanelDetailsCollapsed: false,
  balanceAutoForcedFromAllByTopFilters: false,
  pendingPersistedSnapshotPreference: null,
  pendingPersistedSnapshotHeight: null,
  archivedSnapshotsEnabled: false,
  archivedSnapshotsAvailable: false,
  snapshotLocationByHeight: {},
  preResetStateSnapshot: null,
  pendingIdentityTagExclusions: null,
  ge1FullDataLoadTriggered: false,
  ge1IsUsingEcoSubset: false,
  snapshotReportCache: new Map(),
};

const TOP_EXPOSURES_PAGE_SIZE = 250;
const ECO_TOP_EXPOSURES_INITIAL_COUNT = 50;
const ECO_TOP_EXPOSURES_PREFETCH_COUNT = 100;
const TOP_EXPOSURES_BOTTOM_THRESHOLD_PX = 4;
const TOP_EXPOSURES_LOAD_DELAY_MS = 250;
const SHARE_EXCLUDE_TOKEN = "__share_exclude__";
const ANALYSIS_MIN_HEIGHT_PX = 500;
const UNLABELED_DETAIL_FILTER_VALUE = "__unlabeled_detail__";
const UNLABELED_DETAIL_FILTER_LABEL = "Unlabeled";
const UNIDENTIFIED_IDENTITY_FILTER_VALUE = "__unidentified__";
const UNIDENTIFIED_IDENTITY_FILTER_LABEL = "Unidentified";
const UNIDENTIFIED_IDENTITY_GROUP_FILTER_VALUE = "__unidentified_group__";
const UNIDENTIFIED_IDENTITY_GROUP_FILTER_LABEL = "Unidentified";
const THEME_STORAGE_KEY = "quantum-research-dashboard-theme";
const RUNTIME_MODE_STORAGE_KEY = "quantum-research-dashboard-runtime-mode-v1";
const ARCHIVED_SNAPSHOTS_ENABLED_STORAGE_KEY = "quantum-research-archived-snapshots-enabled-v1";
const FILTERS_STORAGE_KEY = "quantum-research-dashboard-filters-v1";
const HISTORICAL_GE1_CACHE_STORAGE_KEY = "quantum-research-historical-ge1-v1";
const SNAPSHOT_PREF_LATEST = "latest";
const SNAPSHOT_PREF_SPECIFIC = "specific";
const ALLOWED_BALANCE_FILTERS = new Set(["all", "ge1", "ge10", "ge100", "ge1000"]);
const ALLOWED_SPEND_FILTERS = new Set(["all", "never_spent", "inactive", "active"]);
const ALLOWED_SCRIPT_FILTERS = new Set(["All", ...SCRIPT_TYPES_ORDER]);
const ALLOWED_SUPPLY_DISPLAY_MODES = new Set(["total", "exposed", "filtered"]);
const SHARE_NONE_TOKEN = "__none__";
const LOCAL_RUNTIME_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const IS_LOCAL_RUNTIME = LOCAL_RUNTIME_HOSTS.has(window.location.hostname);
let runtimeLiteMode = true;

const ICONS = {
  runtimeEco: '<svg class="icon-fill" viewBox="0 0 48 48" focusable="false" aria-hidden="true"><path d="M31.197 33.609c-3.86 3.313-10.505 4.373-16.005.214 1.282-2.014 6.075-8.804 14.26-12.078l-.556-1.393c-7.977 3.191-12.782 9.372-14.573 12.047-1.513-3.531-1.792-6.971-.775-10.021.947-2.846 2.998-5.146 5.774-6.477 3.986-1.91 6.896-2.212 9.977-2.531 2.933-.304 5.949-.616 9.79-2.346-.387 6.263-2.22 17.714-7.892 22.585zm8.749-26.372c-4.455 2.475-7.613 2.803-10.957 3.149-3.199.331-6.508.675-10.963 2.81-3.516 1.684-6.118 4.609-7.325 8.234-1.316 3.954-.899 8.355 1.16 12.788-2.209 2.801-4.268 6.68-4.861 7.83h3.402c.816-1.487 2.102-3.694 3.441-5.486 2.951 2.087 6.151 2.986 9.209 2.986 3.858 0 7.489-1.421 10.099-3.664 7.137-6.128 9.023-20.56 9.023-27.336V6l-2.228 1.237z"></path></svg>',
  runtimeFull: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M14 8V5"></path><path d="M11 5H17"></path><path d="M6 12H3"></path><path d="M3 9V15"></path><path d="M21 11V19"></path><path d="M9 12H9.01"></path><path d="M12 12H12.01"></path><path d="M15 12H15.01"></path><path d="M6 8V16H8L10 19H18V10L16 8H6Z"></path></svg>',
  copyLink: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
  copyCopied: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>',
  resetDefaults: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>',
  resetUndo: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>',
};

function setButtonIcon(iconId, markup) {
  const iconEl = document.getElementById(iconId);
  if (!iconEl || !markup) return;
  iconEl.outerHTML = markup.replace('<svg ', `<svg id="${iconId}" `);
}

function isMobileUiViewport() {
  return window.matchMedia("(max-width: 820px)").matches;
}

function resolveInitialRuntimeLiteMode() {
  if (!IS_LOCAL_RUNTIME) return true;
  try {
    const storedMode = window.localStorage.getItem(RUNTIME_MODE_STORAGE_KEY);
    if (storedMode === "lite") return true;
    if (storedMode === "full") return false;
  } catch (err) {
    console.warn("Could not read stored runtime mode preference", err);
  }
  return true;
}

function isLiteMode() {
  return IS_LOCAL_RUNTIME ? runtimeLiteMode : true;
}

function persistRuntimeMode() {
  if (!IS_LOCAL_RUNTIME) return;
  try {
    window.localStorage.setItem(RUNTIME_MODE_STORAGE_KEY, isLiteMode() ? "lite" : "full");
  } catch (err) {
    console.warn("Could not persist runtime mode preference", err);
  }
}

function persistArchivedSnapshotsEnabled() {
  if (!IS_LOCAL_RUNTIME) return;
  try {
    window.localStorage.setItem(ARCHIVED_SNAPSHOTS_ENABLED_STORAGE_KEY, state.archivedSnapshotsEnabled ? "true" : "false");
  } catch (err) {
    console.warn("Could not persist archived snapshots enabled preference", err);
  }
}

function loadArchivedSnapshotsEnabled() {
  if (!IS_LOCAL_RUNTIME) return;
  try {
    const stored = window.localStorage.getItem(ARCHIVED_SNAPSHOTS_ENABLED_STORAGE_KEY);
    if (stored === "true") {
      state.archivedSnapshotsEnabled = true;
    }
  } catch (err) {
    console.warn("Could not load archived snapshots enabled preference", err);
  }
}

function updateRuntimeModeButton() {
  const modeButton = document.getElementById("runtimeModeToggle");
  if (!modeButton) return;

  const lite = isLiteMode();
  const modeLabel = lite ? "ECO" : "FULL";
  setButtonIcon("runtimeModeIcon", lite ? ICONS.runtimeEco : ICONS.runtimeFull);
  const modeLabelEl = modeButton.querySelector(".btn-label");
  if (modeLabelEl) {
    modeLabelEl.textContent = modeLabel;
  } else {
    modeButton.textContent = modeLabel;
  }
  modeButton.setAttribute("aria-label", lite ? "Runtime mode: ECO" : "Runtime mode: FULL");
  modeButton.setAttribute("aria-pressed", lite ? "true" : "false");
  modeButton.classList.toggle("is-eco", lite);
  modeButton.classList.toggle("is-full", !lite);

  const tooltipLocal = "Toggle between ECO mode and FULL mode";
  const tooltipOnline = "ECO mode is locked on deployed sites for faster loading. FULL mode is only available when running this webapp locally.";
  const tooltip = IS_LOCAL_RUNTIME ? tooltipLocal : tooltipOnline;

  setCustomTooltip(modeButton, tooltip);
  modeButton.disabled = false;
  modeButton.classList.toggle("is-online-locked", !IS_LOCAL_RUNTIME);
}

function latestSnapshotHeight() {
  if (Array.isArray(state.availableSnapshots) && state.availableSnapshots.length) {
    return String(state.availableSnapshots[0] || "").trim();
  }
  const snapshotFilter = document.getElementById("snapshotFilter");
  return String(snapshotFilter?.options?.[0]?.value || "").trim();
}

function isLatestSnapshotSelected() {
  const latest = latestSnapshotHeight();
  const snapshotFilter = document.getElementById("snapshotFilter");
  const current = String(state.snapshotHeight || snapshotFilter?.value || "").trim();
  return !!latest && !!current && latest === current;
}

function updateTopExposureFilterControlAvailability() {
  const isEco = isLiteMode();
  const allowEcoLatestSearch = isEco && isLatestSnapshotSelected();
  const disableTagFilters = isEco;
  const disableAddressSearch = isEco && !allowEcoLatestSearch;
  const container = document.getElementById("topExposuresFilters");
  const topExposuresFiltersToggle = document.getElementById("topExposuresFiltersToggle");
  const topExposureAddressSearch = document.getElementById("topExposureAddressSearch");
  const detailDropdownTrigger = document.getElementById("detailDropdownTrigger");
  const identityGroupDropdownTrigger = document.getElementById("identityGroupDropdownTrigger");
  const identityDropdownTrigger = document.getElementById("identityDropdownTrigger");
  const disabledTooltip = "ECO mode disables top-exposure filtering for faster loading. Run locally in FULL mode to enable top-exposure filters.";
  const ecoHistoricalSearchTooltip = "Address/pubkey search is only available on the latest snapshot in ECO mode.";

  if (container) {
    container.classList.toggle("is-disabled", disableTagFilters);
    container.classList.toggle("eco-search-enabled", allowEcoLatestSearch);
  }

  if (topExposuresFiltersToggle) {
    // Keep the collapse control available in ECO mode even when filters are disabled.
    topExposuresFiltersToggle.disabled = false;
    if (!disableTagFilters) {
      setCustomTooltip(topExposuresFiltersToggle, "Collapse top exposure filters");
    }
  }

  if (topExposureAddressSearch) {
    topExposureAddressSearch.disabled = disableAddressSearch;
    if (disableAddressSearch) {
      setCustomTooltip(topExposureAddressSearch, ecoHistoricalSearchTooltip);
    } else {
      setCustomTooltip(topExposureAddressSearch, "");
    }
  }

  [detailDropdownTrigger, identityGroupDropdownTrigger, identityDropdownTrigger].forEach((el) => {
    if (!el) return;
    el.disabled = disableTagFilters;
    setCustomTooltip(el, disableTagFilters ? disabledTooltip : "");
  });

  document.querySelectorAll("#detailDropdownMenu input, #identityGroupDropdownMenu input, #identityDropdownMenu input").forEach((el) => {
    el.disabled = disableTagFilters;
    setCustomTooltip(el, disableTagFilters ? disabledTooltip : "");
  });
}

function applyRuntimeModeUi() {
  const lite = isLiteMode();
  document.documentElement.classList.toggle("lite-mode", lite);
  document.documentElement.classList.toggle("full-mode", !lite);
  loadArchivedSnapshotsEnabled();
  updateRuntimeModeButton();
  updateArchivedSnapshotsToggleUi();
  updateTopExposureFilterControlAvailability();
}

function updateArchivedSnapshotsToggleUi() {
  const archivedToggleButton = document.getElementById("archivedSnapshotsToggle");
  if (!archivedToggleButton) return;

  const shouldShow = IS_LOCAL_RUNTIME && state.archivedSnapshotsAvailable;

  archivedToggleButton.classList.toggle("is-hidden", !shouldShow);
  archivedToggleButton.classList.toggle("is-on", shouldShow && state.archivedSnapshotsEnabled);
  archivedToggleButton.setAttribute("aria-pressed", shouldShow && state.archivedSnapshotsEnabled ? "true" : "false");
  archivedToggleButton.setAttribute(
    "aria-label",
    shouldShow && state.archivedSnapshotsEnabled
      ? "Archived snapshots shown"
      : "Archived snapshots hidden"
  );
  setCustomTooltip(
    archivedToggleButton,
    shouldShow
      ? "Include archived snapshot heights in filters and historical charts"
      : "Archived snapshots are only available when running locally with webapp_data/archived present"
  );
}

function snapshotBasePath(snapshot) {
  const height = String(snapshot || "").trim();
  return state.snapshotLocationByHeight[height] === "archived"
    ? `webapp_data/archived/${height}`
    : `webapp_data/${height}`;
}

function snapshotHeightLabel(snapshot) {
  const height = String(snapshot || "").trim();
  if (!height) return "";
  const dateLabel = state.snapshotLabelDatetimeByHeight[height];
  return dateLabel ? `${height} · ${dateLabel} (UTC)` : height;
}

function extractDateFromLabel(dateLabel) {
  if (!dateLabel) return "n/a";
  const match = String(dateLabel).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "n/a";
}

function deltaClass(value) {
  const text = String(value || "").trim();
  if (text.startsWith("+")) return "is-positive";
  if (text.startsWith("-")) return "is-negative";
  return "";
}

function stripDecimals(val) {
  return String(val || "").replace(/\.\d+/, "");
}

function formatCeilBtcFromDisplay(value) {
  const raw = String(value || "");
  const match = raw.match(/[-+]?\d[\d,]*(?:\.\d+)?/);
  if (!match) return stripDecimals(raw);
  const parsed = Number.parseFloat(match[0].replaceAll(",", ""));
  if (!Number.isFinite(parsed)) return stripDecimals(raw);
  return `${formatInt(Math.floor(parsed))} BTC`;
}

function formatCeilBtcDeltaFromDisplay(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/[-+]?\d[\d,]*(?:\.\d+)?/);
  if (!match) return stripDecimals(raw);
  const parsed = Number.parseFloat(match[0].replaceAll(",", ""));
  if (!Number.isFinite(parsed)) return stripDecimals(raw);
  const rounded = Math.floor(parsed);
  const sign = raw.startsWith("+") ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${formatInt(Math.abs(rounded))} BTC`;
}

function parseBtcTriple(line) {
  const matches = Array.from((line || "").matchAll(/([+-]?\d[\d,]*\.\d{2}) BTC/g)).map((match) => `${match[1]} BTC`);
  return {
    prior: matches[0] || "n/a",
    next: matches[1] || "n/a",
    change: matches[2] || "n/a",
  };
}

function parseCountTransition(line) {
  const match = (line || "").match(/:\s*([\d,]+)\s*→\s*([\d,]+)\s*\(([+-]?[\d,]+)\)/);
  if (!match) {
    return { prior: "n/a", next: "n/a", change: "n/a" };
  }
  return { prior: match[1], next: match[2], change: match[3] };
}

function parseMovers(lines, headingText) {
  const headingIndex = lines.findIndex((line) => line.trim() === headingText);
  if (headingIndex === -1) return [];

  const movers = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) break;
    if (line.startsWith("Largest ") || line.startsWith("─") || line.startsWith("=")) break;

    // Try parsing with current supply + delta: "current_supply  delta  label"
    const matchWithSupply = line.match(/^([-+]?[\d,]+\.[\d]+) BTC\s+([-+]\d[\d,]*\.\d{2}) BTC\s+(.+)$/);
    if (matchWithSupply) {
      movers.push({
        current: `${matchWithSupply[1]} BTC`,
        delta: `${matchWithSupply[2]} BTC`,
        label: matchWithSupply[3].trim(),
      });
      continue;
    }

    // Fallback to old format: "delta  label"
    const matchLegacy = line.match(/^([+-]\d[\d,]*\.\d{2}) BTC\s+(.+)$/);
    if (matchLegacy) {
      movers.push({
        delta: `${matchLegacy[1]} BTC`,
        label: matchLegacy[2].trim(),
      });
    }
  }

  return movers;
}

function parseSnapshotDiffSummary(text) {
  const lines = String(text || "").split(/\r?\n/);
  const findLine = (fragment) => lines.find((line) => line.includes(fragment)) || "";

  const priorBlockMatch = findLine("Prior : block").match(/Prior\s*:\s*block\s*([\d,]+)/);
  const newBlockMatch = findLine("New   : block").match(/New\s*:\s*block\s*([\d,]+)/);
  const priorDateMatch = findLine("Prior Date (UTC):").match(/Prior Date \(UTC\):\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|n\/a)/);
  const newDateMatch = findLine("New Date (UTC):").match(/New Date \(UTC\):\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|n\/a)/);
  const totalSupplyLine = findLine("Total supply");
  const totalLine = findLine("Exposed supply") || findLine("Total exposed supply");
  const exposedShareLine = findLine("Exposed share of total supply");
  const activeLine = findLine("Active (key-reuse risk)");
  const inactiveLine = findLine("Inactive (not recently spent)");
  const neverSpentLine = findLine("never_spent");
  const rowCountLine = findLine("Address groups tracked");
  const utxoLine = findLine("Exposed UTXOs");
  const pubkeyLine = findLine("Exposed Pubkeys");

  const totalSupplyPctMatch = totalSupplyLine.match(/\(([+-]?\d+\.\d+%)\)/);
  const pctMatch = totalLine.match(/\(([+-]?\d+\.\d+%)\)/);
  const exposedShareMatches = Array.from((exposedShareLine || "").matchAll(/([\d]+(?:\.\d+)?)%/g)).map((match) => `${match[1]}%`);

  // Parse script types section
  const scriptTypesIdx = lines.findIndex((l) => l.includes("Exposed Supply by Script Type"));
  const scriptTypes = {};
  if (scriptTypesIdx >= 0) {
    for (let i = scriptTypesIdx + 2; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith("Exposed Supply by Spend")) break;
      if (line.startsWith("─") || line.startsWith("=")) continue;
      const match = line.match(/^([A-Z0-9\/\-]+?)\s+([-+]?[\d,]+\.[\d]+)\s+BTC\s+([-+]?[\d,]+\.[\d]+)\s+BTC\s+([-+]?[\d,]+\.[\d]+)\s+BTC/);
      if (match) {
        const name = match[1].trim();
        if (name && name !== "Script Type" && name !== "Prior" && name.toLowerCase() !== "other") {
          scriptTypes[name] = { prior: `${match[2]} BTC`, new: `${match[3]} BTC`, change: `${match[4]} BTC` };
        }
      }
    }
  }

  // Parse spend activity section
  const spendActivityIdx = lines.findIndex((l) => l.includes("Exposed Supply by Spend Activity"));
  const spendActivity = {};
  if (spendActivityIdx >= 0) {
    for (let i = spendActivityIdx + 2; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith("Exposed Supply by Identity") || line.startsWith("4. Exposed")) break;
      if (line.startsWith("─") || line.startsWith("=")) continue;
      const match = line.match(/^([a-z_]+)\s+([-+]?[\d,]+\.[\d]+)\s+BTC\s+([-+]?[\d,]+\.[\d]+)\s+BTC\s+([-+]?[\d,]+\.[\d]+)\s+BTC/);
      if (match) {
        const name = match[1].trim();
        if (name && name !== "Activity") {
          spendActivity[name] = { prior: `${match[2]} BTC`, new: `${match[3]} BTC`, change: `${match[4]} BTC` };
        }
      }
    }
  }

  return {
    priorBlock: priorBlockMatch ? priorBlockMatch[1] : "n/a",
    newBlock: newBlockMatch ? newBlockMatch[1] : "n/a",
    priorDate: priorDateMatch ? priorDateMatch[1] : "n/a",
    newDate: newDateMatch ? newDateMatch[1] : "n/a",
    totalSupply: {
      ...parseBtcTriple(totalSupplyLine),
      pct: totalSupplyPctMatch ? totalSupplyPctMatch[1] : "n/a",
    },
    total: {
      ...parseBtcTriple(totalLine),
      pct: pctMatch ? pctMatch[1] : "n/a",
      sharePrior: exposedShareMatches[0] || "n/a",
      shareNew: exposedShareMatches[1] || "n/a",
    },
    active: parseBtcTriple(activeLine),
    inactive: parseBtcTriple(inactiveLine),
    neverSpent: parseBtcTriple(neverSpentLine),
    addressGroups: parseCountTransition(rowCountLine),
    utxos: parseCountTransition(utxoLine),
    pubkeys: parseCountTransition(pubkeyLine),
    scriptTypes,
    spendActivity,
    groupGainers: parseMovers(lines, "Largest increases (identity group):"),
    groupLosers: parseMovers(lines, "Largest decreases (identity group):"),
    identityGainers: parseMovers(lines, "Largest increases (individual identity):"),
    identityLosers: parseMovers(lines, "Largest decreases (individual identity):"),
  };
}

function renderMoverList(items) {
  if (!items.length) {
    return '<p class="snapshot-report-empty">No movers for this snapshot.</p>';
  }

  return `
    <ul class="snapshot-report-list">
      ${items
        .slice(0, 6)
        .map(
          (item) => `
            <li>
              <span class="snapshot-report-label">${escapeHtml(item.label)}</span>
              <span style="text-align: right; flex: 1; display: flex; gap: 12px; justify-content: flex-end; align-items: baseline;">
                ${item.current ? `<div style="font-size: 13px; font-weight: 600; color: var(--ink);">${escapeHtml(formatCeilBtcFromDisplay(item.current))}</div>` : ""}
                <div class="snapshot-report-delta snapshot-report-delta-col ${deltaClass(item.delta)}">${escapeHtml(formatCeilBtcDeltaFromDisplay(item.delta))}</div>
              </span>
            </li>
          `
        )
        .join("")}
    </ul>
  `;
}

function resolveSnapshotReportKpiCounts(snapshot, summary) {
  const snapshotKey = String(snapshot || "").trim();
  const loadedSnapshot = String(state.snapshotHeight || "").trim();
  const hasLiveRows = snapshotKey && loadedSnapshot === snapshotKey && Array.isArray(state.aggregatesRows) && state.aggregatesRows.length;

  if (hasLiveRows) {
    const exposedPubkeys = getAggregateFromRows(state.aggregatesRows, "all", "All", "all", "exposed_pubkey_count");
    const exposedUtxos = getAggregateFromRows(state.aggregatesRows, "all", "All", "all", "exposed_utxo_count");
    return {
      exposedPubkeys: formatInt(exposedPubkeys),
      exposedUtxos: formatInt(exposedUtxos),
    };
  }

  const fallbackUtxos = summary?.utxos?.next ? formatInt(toInt(summary.utxos.next.replaceAll(",", ""))) : "n/a";
  return {
    exposedPubkeys: "n/a",
    exposedUtxos: fallbackUtxos,
  };
}

function parseBtcDisplayToSats(value) {
  const raw = String(value || "");
  const match = raw.match(/[-+]?\d[\d,]*(?:\.\d+)?/);
  if (!match) return 0;
  const parsed = Number.parseFloat(match[0].replaceAll(",", ""));
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * SATS_PER_BTC);
}

function renderSnapshotSupplyBreakdownBar(summary) {
  const MAX_BITCOIN_SUPPLY_SATS = 21_000_000 * SATS_PER_BTC;

  const formatFloorBtcFromSats = (sats) => formatInt(Math.floor(Math.max(0, sats) / SATS_PER_BTC));

  const totalSupplySats = Math.max(0, parseBtcDisplayToSats(summary?.totalSupply?.next));
  const exposedSupplySats = Math.max(0, parseBtcDisplayToSats(summary?.total?.next));
  const exposedActiveSats = Math.max(0, parseBtcDisplayToSats(summary?.active?.next));
  const exposedInactiveSats = Math.max(0, parseBtcDisplayToSats(summary?.inactive?.next));
  const exposedNeverSpentSats = Math.max(0, parseBtcDisplayToSats(summary?.neverSpent?.next));

  if (totalSupplySats <= 0) return "";

  const cappedExposedSupplySats = Math.min(exposedSupplySats, totalSupplySats);
  const nonExposedSupplySats = Math.max(totalSupplySats - cappedExposedSupplySats, 0);
  const unminedSupplySats = Math.max(MAX_BITCOIN_SUPPLY_SATS - totalSupplySats, 0);

  const exposedNeverPct = (exposedNeverSpentSats / MAX_BITCOIN_SUPPLY_SATS) * 100;
  const exposedInactivePct = (exposedInactiveSats / MAX_BITCOIN_SUPPLY_SATS) * 100;
  const exposedActivePct = (exposedActiveSats / MAX_BITCOIN_SUPPLY_SATS) * 100;
  const nonExposedPct = (nonExposedSupplySats / MAX_BITCOIN_SUPPLY_SATS) * 100;
  const unminedPct = (unminedSupplySats / MAX_BITCOIN_SUPPLY_SATS) * 100;

  let segmentsHtml = "";

  if (exposedNeverSpentSats > 0) {
    segmentsHtml += `<div class="kpi-breakdown-segment seg-never" data-tooltip="Never Spent: ${formatFloorBtcFromSats(exposedNeverSpentSats)} BTC · ${formatPercent(exposedNeverSpentSats, totalSupplySats)}" style="width: ${exposedNeverPct}%;"></div>`;
  }
  if (exposedInactiveSats > 0) {
    segmentsHtml += `<div class="kpi-breakdown-segment seg-inactive" data-tooltip="Inactive: ${formatFloorBtcFromSats(exposedInactiveSats)} BTC · ${formatPercent(exposedInactiveSats, totalSupplySats)}" style="width: ${exposedInactivePct}%;"></div>`;
  }
  if (exposedActiveSats > 0) {
    segmentsHtml += `<div class="kpi-breakdown-segment seg-active" data-tooltip="Active: ${formatFloorBtcFromSats(exposedActiveSats)} BTC · ${formatPercent(exposedActiveSats, totalSupplySats)}" style="width: ${exposedActivePct}%;"></div>`;
  }
  if (nonExposedSupplySats > 0) {
    segmentsHtml += `<div class="kpi-breakdown-segment seg-nonexposed" data-tooltip="Non-Exposed: ${formatFloorBtcFromSats(nonExposedSupplySats)} BTC · ${formatPercent(nonExposedSupplySats, totalSupplySats)}" style="width: ${nonExposedPct}%;"></div>`;
  }
  if (unminedSupplySats > 0) {
    segmentsHtml += `<div class="kpi-breakdown-segment seg-unmined" data-tooltip="Unmined: ${formatFloorBtcFromSats(unminedSupplySats)} BTC" style="width: ${unminedPct}%;"></div>`;
  }

  return `
    <div class="kpi-supply-breakdown snapshot-report-supply-breakdown">
      <div class="kpi-breakdown-bar">
        ${segmentsHtml}
      </div>
    </div>
  `;
}

function renderSnapshotReportHtml(summary, snapshot, kpiCounts) {
  const totalSupplyDeltaClass = deltaClass(summary.totalSupply.change);
  const totalSupplyCeil = formatCeilBtcFromDisplay(summary.totalSupply.next);
  const totalDeltaClass = deltaClass(summary.total.change);
  const totalCeil = formatCeilBtcFromDisplay(summary.total.next);
  const totalValue = totalCeil;
  const supplyBreakdownBar = renderSnapshotSupplyBreakdownBar(summary);
  return `
    <div class="snapshot-report-grid">
      <article class="snapshot-report-card">
        <h4>Total Supply</h4>
        <div class="snapshot-report-value">${escapeHtml(totalSupplyCeil)}</div>
        <div class="snapshot-report-delta ${totalSupplyDeltaClass}">${escapeHtml(formatCeilBtcDeltaFromDisplay(summary.totalSupply.change))}</div>
      </article>
      <article class="snapshot-report-card">
        <h4>Exposed Supply</h4>
        <div class="snapshot-report-value">${escapeHtml(totalValue)}</div>
        <div class="snapshot-report-delta ${totalDeltaClass}">${escapeHtml(formatCeilBtcDeltaFromDisplay(summary.total.change))}</div>
      </article>
      <article class="snapshot-report-card">
        <h4>Exposed Pubkeys</h4>
        <div class="snapshot-report-value">${escapeHtml(kpiCounts.exposedPubkeys)}</div>
        <div class="snapshot-report-delta ${deltaClass(summary.pubkeys.change)}">${escapeHtml(stripDecimals(summary.pubkeys.change))}</div>
      </article>
      <article class="snapshot-report-card">
        <h4>Exposed UTXOs</h4>
        <div class="snapshot-report-value">${escapeHtml(kpiCounts.exposedUtxos)}</div>
        <div class="snapshot-report-delta ${deltaClass(summary.utxos.change)}">${escapeHtml(stripDecimals(summary.utxos.change))}</div>
      </article>
    </div>

    ${supplyBreakdownBar}

    <p class="snapshot-report-state" style="margin-top: 8px;"></p>

    <section class="snapshot-report-section">
      <h5>Exposed Supply by Spend Activity</h5>
      <div class="snapshot-report-list">
        ${Object.entries(summary.spendActivity || {})
          .sort(([a], [b]) => {
            const order = ["active", "inactive", "never_spent"];
            const indexA = order.indexOf(a);
            const indexB = order.indexOf(b);
            return (indexA === -1 ? order.length : indexA) - (indexB === -1 ? order.length : indexB);
          })
          .map(
            ([name, vals]) => {
              const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
              const colorClass = name === 'active' ? 'is-active' : name === 'inactive' ? 'is-inactive' : name === 'never_spent' ? 'is-never-spent' : '';
              return `
          <li>
            <span class="snapshot-report-label">${escapeHtml(capitalize(name))}</span>
            <span style="text-align: right; flex: 1; display: flex; gap: 12px; justify-content: flex-end; align-items: baseline;">
              <div style="font-size: 13px; font-weight: 600;" class="${colorClass}">${escapeHtml(formatCeilBtcFromDisplay(vals.new))}</div>
              <div class="snapshot-report-delta snapshot-report-delta-col ${deltaClass(vals.change)}">${escapeHtml(formatCeilBtcDeltaFromDisplay(vals.change))}</div>
            </span>
          </li>
        `;
            }
          )
          .join("")}
      </div>
    </section>

    <section class="snapshot-report-section">
      <h5>Exposed Supply by Script Type</h5>
      <div class="snapshot-report-list">
        ${Object.entries(summary.scriptTypes || {})
          .filter(([name]) => name.toLowerCase() !== "other")
          .sort(([a], [b]) => {
            const order = ["P2PK", "P2PKH", "P2SH", "P2WPKH", "P2WSH", "P2TR"];
            const indexA = order.indexOf(a);
            const indexB = order.indexOf(b);
            return (indexA === -1 ? order.length : indexA) - (indexB === -1 ? order.length : indexB);
          })
          .map(
            ([name, vals]) => `
          <li>
            <span class="snapshot-report-label">${escapeHtml(name)}</span>
            <span style="text-align: right; flex: 1; display: flex; gap: 12px; justify-content: flex-end; align-items: baseline;">
              <div style="font-size: 13px; font-weight: 600; color: var(--ink);">${escapeHtml(formatCeilBtcFromDisplay(vals.new))}</div>
              <div class="snapshot-report-delta snapshot-report-delta-col ${deltaClass(vals.change)}">${escapeHtml(formatCeilBtcDeltaFromDisplay(vals.change))}</div>
            </span>
          </li>
        `
          )
          .join("")}
      </div>
    </section>

    <section class="snapshot-report-section">
      <h5>Identity Group Top Movers</h5>
      <div>
        ${renderMoverList(summary.groupGainers.slice(0, 3))}
      </div>
      <div style="margin-top: 16px;">
        ${renderMoverList(summary.groupLosers.slice(0, 3))}
      </div>
    </section>

    <section class="snapshot-report-section">
      <h5>Individual Identity Top Movers</h5>
      <div>
        ${renderMoverList(summary.identityGainers.slice(0, 3))}
      </div>
      <div style="margin-top: 16px;">
        ${renderMoverList(summary.identityLosers.slice(0, 3))}
      </div>
    </section>
  `;
}

function setSnapshotReportLoadingState(message) {
  const subtitle = document.getElementById("snapshotReportSubtitle");
  const body = document.getElementById("snapshotReportBody");
  if (subtitle) {
    subtitle.textContent = message;
  }
  if (body) {
    body.innerHTML = '<p class="snapshot-report-empty">Loading report...</p>';
  }
}

function renderSnapshotReportSubtitle(priorBlock, newBlock, priorDate, newDate) {
  return `
    <span class="snapshot-report-subtitle-line"><span class="snapshot-report-subtitle-label">Block Range:</span>${escapeHtml(String(priorBlock || "n/a"))} → ${escapeHtml(String(newBlock || "n/a"))}</span>
    <span class="snapshot-report-subtitle-line"><span class="snapshot-report-subtitle-label">Date Range:</span>${escapeHtml(String(priorDate || "n/a"))} → ${escapeHtml(String(newDate || "n/a"))}</span>
  `;
}

function notifyParentSnapshotReportModalState(isOpen) {
  if (window.self === window.top) return;
  try {
    window.parent?.postMessage(
      { type: "quantum-snapshot-report-modal", open: !!isOpen },
      window.location.origin
    );
  } catch (_err) {
    // Best effort only for standalone shell state.
  }
}

async function loadSnapshotReportIntoModal() {
  const body = document.getElementById("snapshotReportBody");
  const subtitle = document.getElementById("snapshotReportSubtitle");
  if (!body || !subtitle) return;

  const snapshotFilter = document.getElementById("snapshotFilter");
  const snapshot = String(state.snapshotHeight || snapshotFilter?.value || "").trim();
  if (!snapshot) {
    subtitle.textContent = "No snapshot selected";
    body.innerHTML = '<p class="snapshot-report-empty">Choose a snapshot first, then open this report.</p>';
    return;
  }

  subtitle.textContent = `Loading summary for ${snapshotHeightLabel(snapshot) || snapshot}...`;

  if (state.snapshotReportCache.has(snapshot)) {
    const cached = state.snapshotReportCache.get(snapshot);
    const kpiCounts = resolveSnapshotReportKpiCounts(snapshot, cached.summary);
    const priorDateFromState = extractDateFromLabel(state.snapshotLabelDatetimeByHeight[String(cached.summary.priorBlock).replace(/,/g, '')]);
    const newDateFromState = extractDateFromLabel(state.snapshotLabelDatetimeByHeight[String(cached.summary.newBlock).replace(/,/g, '')]);
    const priorDate = priorDateFromState !== "n/a" ? priorDateFromState : (cached.summary.priorDate || "n/a");
    const newDate = newDateFromState !== "n/a" ? newDateFromState : (cached.summary.newDate || "n/a");
    if (priorDate === "n/a" || newDate === "n/a") {
      state.snapshotReportCache.delete(snapshot);
    } else {
    subtitle.innerHTML = renderSnapshotReportSubtitle(cached.summary.priorBlock, cached.summary.newBlock, priorDate, newDate);
    body.innerHTML = renderSnapshotReportHtml(cached.summary, snapshot, kpiCounts);
    return;
    }
  }

  try {
    const resp = await fetch(`${snapshotBasePath(snapshot)}/snapshot_diff_summary.txt`, { cache: "no-store" });
    if (!resp.ok) {
      throw new Error(`Report unavailable for snapshot ${snapshot}: HTTP ${resp.status}`);
    }

    const text = await resp.text();
    const summary = parseSnapshotDiffSummary(text);
    state.snapshotReportCache.set(snapshot, { summary });
    const kpiCounts = resolveSnapshotReportKpiCounts(snapshot, summary);
    const priorDateFromState = extractDateFromLabel(state.snapshotLabelDatetimeByHeight[String(summary.priorBlock).replace(/,/g, '')]);
    const newDateFromState = extractDateFromLabel(state.snapshotLabelDatetimeByHeight[String(summary.newBlock).replace(/,/g, '')]);
    const priorDate = priorDateFromState !== "n/a" ? priorDateFromState : (summary.priorDate || "n/a");
    const newDate = newDateFromState !== "n/a" ? newDateFromState : (summary.newDate || "n/a");
    subtitle.innerHTML = renderSnapshotReportSubtitle(summary.priorBlock, summary.newBlock, priorDate, newDate);
    body.innerHTML = renderSnapshotReportHtml(summary, snapshot, kpiCounts);
  } catch (err) {
    console.error("Failed to load snapshot report:", err);
    subtitle.textContent = `Snapshot ${snapshotHeightLabel(snapshot) || snapshot}`;
    body.innerHTML = `
      <p class="snapshot-report-empty">
        Snapshot diff report not found for this height yet.
      </p>
      <p class="snapshot-report-state">
        Run the daily snapshot pipeline with summarize_snapshot_diff.py enabled to generate snapshot_diff_summary.txt.
      </p>
    `;
  }
}

function openSnapshotReportModal() {
  const modal = document.getElementById("snapshotReportModal");
  if (!modal) return;
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  notifyParentSnapshotReportModalState(true);
  setSnapshotReportLoadingState("Loading latest summary...");
  loadSnapshotReportIntoModal();
}

function closeSnapshotReportModal() {
  const modal = document.getElementById("snapshotReportModal");
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  notifyParentSnapshotReportModalState(false);
}

function isSnapshotReportModalOpen() {
  const modal = document.getElementById("snapshotReportModal");
  return !!modal && !modal.hidden;
}

function normalizeSupplyDisplayMode(mode) {
  return ALLOWED_SUPPLY_DISPLAY_MODES.has(mode) ? mode : "total";
}

function getSupplyDisplayFlags() {
  const mode = normalizeSupplyDisplayMode(state.supplyDisplayMode);
  return {
    mode,
    showNonExposed: mode === "total",
    showFilteredOnly: mode === "filtered",
  };
}

function resolveInitialTheme() {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "light" || storedTheme === "dark") {
      return storedTheme;
    }
  } catch (err) {
    console.warn("Could not read stored theme preference", err);
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;

  const toggle = document.getElementById("themeToggle");
  if (toggle) {
    const isDark = nextTheme === "dark";
    toggle.setAttribute("aria-pressed", isDark ? "true" : "false");
    setCustomTooltip(toggle, isDark ? "Switch to light mode" : "Switch to dark mode");

    const modeSymbol = document.getElementById("themeToggleMode");
    if (modeSymbol) {
      modeSymbol.textContent = isDark ? "☾" : "☼";
    }
  }
}

function persistTheme(theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (err) {
    console.warn("Could not persist theme preference", err);
  }
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  persistTheme(nextTheme);
}

// Lazy-loaded in-memory mirror of the localStorage ge1 sums cache.
// Structure: { [snapshot]: { [filterKey]: { never_spent, inactive, active } } }
let _ge1PersistentCache = null;

function loadGe1PersistentCache() {
  if (_ge1PersistentCache !== null) return _ge1PersistentCache;
  try {
    const raw = window.localStorage.getItem(HISTORICAL_GE1_CACHE_STORAGE_KEY);
    _ge1PersistentCache = raw ? JSON.parse(raw) : {};
  } catch (err) {
    _ge1PersistentCache = {};
  }
  return _ge1PersistentCache;
}

function saveGe1PersistentSum(snapshot, filterKey, sums) {
  const cache = loadGe1PersistentCache();
  if (!cache[snapshot]) cache[snapshot] = {};
  cache[snapshot][filterKey] = sums;
  try {
    window.localStorage.setItem(HISTORICAL_GE1_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch (err) {
    // localStorage may be full or unavailable — non-critical, in-memory cache still works
  }
}

function readPersistedFilters() {
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (err) {
    console.warn("Could not read stored filter preferences", err);
    return null;
  }
}

function normalizePersistedSelections(values, allowedSet) {
  if (!Array.isArray(values)) return null;
  return values.filter((value) => allowedSet.has(value));
}

function applyCheckedValues(checkboxes, selectedValues, allValue) {
  if (!Array.isArray(selectedValues)) return;

  const selectedSet = new Set(selectedValues);
  const hasAll = selectedSet.has(allValue);
  checkboxes.forEach((el) => {
    el.checked = hasAll ? true : selectedSet.has(el.value);
  });
}

function setPendingIdentityTagExclusionsFromSelection(values) {
  if (!Array.isArray(values) || !values.includes(SHARE_EXCLUDE_TOKEN)) {
    state.pendingIdentityTagExclusions = null;
    return;
  }

  const exclusions = Array.from(new Set(values.filter((value) => value && value !== SHARE_EXCLUDE_TOKEN)));
  state.pendingIdentityTagExclusions = exclusions.length ? exclusions : null;
}

function applyPendingIdentityTagExclusions(identityOptions) {
  const pending = Array.isArray(state.pendingIdentityTagExclusions) ? state.pendingIdentityTagExclusions : [];
  const options = Array.isArray(identityOptions) ? identityOptions : [];
  if (!pending.length || !options.length) {
    return;
  }

  const optionSet = new Set(options);
  const availableExclusions = pending.filter((value) => optionSet.has(value));
  const unresolvedExclusions = pending.filter((value) => !optionSet.has(value));

  if (availableExclusions.length) {
    const excludedSet = new Set(availableExclusions);
    // When identity tags are still exclusion-encoded (not yet resolved by normalizeTagSelections),
    // or when "All" is set, use the full options list as the base — the intent of the pending
    // exclusion is always "everything available minus the excluded items".
    const isStillExcludeEncoded = state.selectedIdentityTags.includes(SHARE_EXCLUDE_TOKEN);
    const selected = (state.selectedIdentityTags.includes("All") || isStillExcludeEncoded)
      ? options.slice()
      : state.selectedIdentityTags.filter((value) => value && value !== "All" && value !== SHARE_EXCLUDE_TOKEN);
    const nextSelected = selected.filter((value) => !excludedSet.has(value));

    if (!nextSelected.length) {
      state.selectedIdentityTags = [];
    } else if (nextSelected.length === options.length) {
      state.selectedIdentityTags = ["All"];
    } else {
      state.selectedIdentityTags = nextSelected;
    }
  }

  state.pendingIdentityTagExclusions = unresolvedExclusions.length ? unresolvedExclusions : null;
}

function applyPersistedFilterState(prefs) {
  if (!prefs || typeof prefs !== "object") return;

  const balanceFilter = document.getElementById("balanceFilter");
  if (balanceFilter && ALLOWED_BALANCE_FILTERS.has(prefs.balance)) {
    balanceFilter.value = prefs.balance;
  }

  const scriptTypes = normalizePersistedSelections(prefs.scriptTypes, ALLOWED_SCRIPT_FILTERS);
  if (scriptTypes) {
    applyCheckedValues(getScriptCheckboxes(), scriptTypes, "All");
  }

  const spendActivities = normalizePersistedSelections(prefs.spendActivities, ALLOWED_SPEND_FILTERS);
  if (spendActivities) {
    applyCheckedValues(getSpendCheckboxes(), spendActivities, "all");
  }

  if (Array.isArray(prefs.detailTags)) {
    state.selectedDetailTags = prefs.detailTags;
  }
  if (Array.isArray(prefs.identityGroups)) {
    state.selectedIdentityGroups = prefs.identityGroups;
  }
  if (Array.isArray(prefs.identityTags)) {
    state.selectedIdentityTags = prefs.identityTags;
    setPendingIdentityTagExclusionsFromSelection(prefs.identityTags);
  }
  if (typeof prefs.topExposureAddressQuery === "string") {
    state.topExposureAddressQuery = prefs.topExposureAddressQuery;
    const topExposureAddressSearch = document.getElementById("topExposureAddressSearch");
    if (topExposureAddressSearch) {
      topExposureAddressSearch.value = state.topExposureAddressQuery;
    }
  }

  if (prefs.scriptPanelMode === "historical" || prefs.scriptPanelMode === "bars") {
    state.scriptPanelMode = prefs.scriptPanelMode;
  }

  if (typeof prefs.supplyDisplayMode === "string") {
    state.supplyDisplayMode = normalizeSupplyDisplayMode(prefs.supplyDisplayMode);
  } else if (typeof prefs.showFilteredOnly === "boolean" || typeof prefs.showHistoricalNonExposed === "boolean") {
    // Backward compatibility for previously persisted checkbox settings.
    if (prefs.showFilteredOnly === true) {
      state.supplyDisplayMode = "filtered";
    } else if (prefs.showHistoricalNonExposed === false) {
      state.supplyDisplayMode = "exposed";
    } else {
      state.supplyDisplayMode = "total";
    }
  }

  if (typeof prefs.topExposuresFiltersCollapsed === "boolean") {
    state.topExposuresFiltersCollapsed = prefs.topExposuresFiltersCollapsed;
  }

  if (typeof prefs.scriptPanelDetailsCollapsed === "boolean") {
    state.scriptPanelDetailsCollapsed = prefs.scriptPanelDetailsCollapsed;
  }

  const snapshotPreference =
    prefs.snapshotPreference === SNAPSHOT_PREF_LATEST || prefs.snapshotPreference === SNAPSHOT_PREF_SPECIFIC
      ? prefs.snapshotPreference
      : null;
  const snapshot = String(prefs.snapshotHeight || "").trim();
  state.pendingPersistedSnapshotPreference = snapshotPreference;
  state.pendingPersistedSnapshotHeight = /^\d+$/.test(snapshot) ? snapshot : null;
}

function persistFilters(filters) {
  try {
    const snapshotFilter = document.getElementById("snapshotFilter");
    const snapshotHeight = String(state.snapshotHeight || snapshotFilter?.value || "").trim();
    const latestSnapshot = state.availableSnapshots.length
      ? String(state.availableSnapshots[0])
      : String(snapshotFilter?.options?.[0]?.value || "").trim();
    const snapshotPreference =
      snapshotHeight && latestSnapshot && snapshotHeight === latestSnapshot
        ? SNAPSHOT_PREF_LATEST
        : SNAPSHOT_PREF_SPECIFIC;

    const payload = {
      balance: filters.balance,
      spendActivities: filters.spendActivities,
      scriptTypes: filters.scriptTypes,
      detailTags: filters.detailTags,
      identityGroups: filters.identityGroups,
      identityTags: filters.identityTags,
      topExposureAddressQuery: filters.topExposureAddressQuery,
      scriptPanelMode: state.scriptPanelMode,
      supplyDisplayMode: normalizeSupplyDisplayMode(state.supplyDisplayMode),
      topExposuresFiltersCollapsed: state.topExposuresFiltersCollapsed,
      scriptPanelDetailsCollapsed: state.scriptPanelDetailsCollapsed,
      snapshotPreference,
      snapshotHeight,
    };

    window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn("Could not persist filter preferences", err);
  }
}

function normalizeSelectionForShare(values, allValue) {
  if (!Array.isArray(values)) return [];
  if (values.includes(allValue)) return [allValue];
  return values;
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
  } catch (err) {
    console.warn("Could not encode share state", err);
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
  } catch (err) {
    console.warn("Could not decode share state", err);
    return null;
  }
}

function normalizeTagSelectionForShare(values, allOptions) {
  if (!Array.isArray(values)) return [];
  if (values.includes("All")) return ["All"];
  if (values.length === 0) return [];

  const deduped = Array.from(new Set(values));
  const options = Array.isArray(allOptions) ? allOptions : [];
  // When options are not available yet, keep the explicit selection rather than
  // collapsing to an empty selection in the share payload.
  if (!options.length) {
    return deduped;
  }

  const optionSet = new Set(options);
  const normalized = deduped.filter((value) => optionSet.has(value));
  if (!normalized.length) return [];
  if (normalized.length === options.length) {
    return ["All"];
  }

  const normalizedSet = new Set(normalized);
  const excluded = options.filter((value) => !normalizedSet.has(value));
  // Prefer exclusion encoding when it's smaller than inclusion encoding.
  if (excluded.length > 0 && excluded.length < normalized.length) {
    return [SHARE_EXCLUDE_TOKEN, ...excluded];
  }

  return normalized;
}

function normalizeExplicitTagSelectionForShare(values, allOptions) {
  if (!Array.isArray(values)) return [];
  if (values.includes("All")) return ["All"];
  if (values.length === 0) return [];

  const deduped = Array.from(new Set(values));
  const options = Array.isArray(allOptions) ? allOptions : [];
  if (!options.length) {
    return deduped;
  }

  const optionSet = new Set(options);
  const normalized = deduped.filter((value) => optionSet.has(value));
  if (!normalized.length) return [];
  if (normalized.length === options.length) {
    return ["All"];
  }

  // Prefer exclusion encoding when fewer items are excluded than included.
  // The decode path (setPendingIdentityTagExclusionsFromSelection) already
  // handles SHARE_EXCLUDE_TOKEN for identity tags specifically.
  const normalizedSet = new Set(normalized);
  const excluded = options.filter((value) => !normalizedSet.has(value));
  if (excluded.length > 0 && excluded.length < normalized.length) {
    return [SHARE_EXCLUDE_TOKEN, ...excluded];
  }

  return normalized;
}

function parseArrayParam(params, key, allowedSet = null, allValue = null, noneToken = SHARE_NONE_TOKEN) {
  const rawValues = params.getAll(key);
  if (!rawValues.length) return null;
  if (rawValues.includes(noneToken)) return [];

  let values = rawValues;
  if (allowedSet) {
    values = values.filter((value) => allowedSet.has(value));
  }
  if (!values.length) return [];
  if (allValue && values.includes(allValue)) return [allValue];
  return Array.from(new Set(values));
}

function getShareRouteBaseUrl() {
  const path = String(window.location.pathname || "");
  const dashboardMatch = path.match(/^(.*)\/webapps\/quantum_exposure\/dashboard\.html$/i);
  const basePath = dashboardMatch
    ? (dashboardMatch[1] || "")
    : path.replace(/\/[^/]*$/, "");

  if (IS_LOCAL_RUNTIME) {
    return `${window.location.origin}${basePath}/quantum_exposure.html`;
  }
  return `${window.location.origin}${basePath}/quantum_exposure`;
}

function buildShareableDashboardUrl() {
  const filters = readFilters();
  const allTagOptions = buildTagOptionsFromGe1Rows(["All"]);
  const optionOrderingFilters = {
    balance: filters.balance,
    scriptTypes: filters.scriptTypes,
    spendActivities: filters.spendActivities,
    detailTags: filters.detailTags,
    identityGroups: filters.identityGroups,
    identityTags: ["All"],
    topExposureAddressQuery: String(filters.topExposureAddressQuery || "").trim(),
  };
  const scopedTagOptions = buildTagOptionsFromGe1Rows(filters.identityGroups, optionOrderingFilters);
  const panelMode = state.scriptPanelMode === "historical" ? "historical" : "bars";
  const snapshotFilter = document.getElementById("snapshotFilter");
  const snapshotHeight = String(state.snapshotHeight || snapshotFilter?.value || "").trim();
  const latestSnapshot = state.availableSnapshots.length
    ? String(state.availableSnapshots[0])
    : String(snapshotFilter?.options?.[0]?.value || "").trim();
  const snapshotPreference =
    snapshotHeight && latestSnapshot && snapshotHeight === latestSnapshot
      ? SNAPSHOT_PREF_LATEST
      : SNAPSHOT_PREF_SPECIFIC;
  const defaults = {
    b: "all",
    s: ["All"],
    p: ["all"],
    d: ["All"],
    g: ["All"],
    i: ["All"],
    v: "bars",
    m: "total",
    c: 0,
    e: 0,
    t: "l",
  };

  const normalized = {
    b: filters.balance,
    s: normalizeSelectionForShare(filters.scriptTypes, "All"),
    p: normalizeSelectionForShare(filters.spendActivities, "all"),
    d: normalizeTagSelectionForShare(filters.detailTags, allTagOptions.details),
    g: normalizeTagSelectionForShare(filters.identityGroups, allTagOptions.identityGroups),
    i: normalizeExplicitTagSelectionForShare(filters.identityTags, scopedTagOptions.identities),
    v: panelMode,
    m: normalizeSupplyDisplayMode(state.supplyDisplayMode),
    c: state.topExposuresFiltersCollapsed ? 1 : 0,
    e: state.scriptPanelDetailsCollapsed ? 1 : 0,
    t: snapshotPreference === SNAPSHOT_PREF_LATEST ? "l" : "s",
  };

  const payload = {};
  const addIfDifferent = (key, value, defaultValue) => {
    const sameValue = Array.isArray(defaultValue)
      ? Array.isArray(value) && value.length === defaultValue.length && value.every((entry, idx) => entry === defaultValue[idx])
      : value === defaultValue;
    if (!sameValue) {
      payload[key] = value;
    }
  };

  addIfDifferent("b", normalized.b, defaults.b);
  addIfDifferent("s", normalized.s, defaults.s);
  addIfDifferent("p", normalized.p, defaults.p);
  addIfDifferent("d", normalized.d, defaults.d);
  addIfDifferent("g", normalized.g, defaults.g);
  addIfDifferent("i", normalized.i, defaults.i);
  addIfDifferent("v", normalized.v, defaults.v);
  addIfDifferent("m", normalized.m, defaults.m);
  addIfDifferent("c", normalized.c, defaults.c);
  addIfDifferent("e", normalized.e, defaults.e);
  addIfDifferent("t", normalized.t, defaults.t);

  if (filters.topExposureAddressQuery) {
    payload.q = filters.topExposureAddressQuery;
  }
  if (snapshotPreference === SNAPSHOT_PREF_SPECIFIC && snapshotHeight) {
    payload.h = snapshotHeight;
  }

  const shareUrl = new URL(getShareRouteBaseUrl());
  const shareParams = new URLSearchParams();

  const finalizeShareUrl = () => {
    shareParams.forEach((value, key) => {
      shareUrl.searchParams.set(key, value);
    });
    return shareUrl.toString();
  };

  if (Object.keys(payload).length === 0) {
    return finalizeShareUrl();
  }

  const payloadKeys = Object.keys(payload);
  if (payloadKeys.length === 1 && payload.v === "historical") {
    shareParams.set("view", "historical");
    return finalizeShareUrl();
  }

  const encodedState = encodeShareState(payload);
  if (encodedState) {
    shareParams.set("state", encodedState);
  } else {
    shareParams.set("view", panelMode);
  }
  return finalizeShareUrl();
}

function readFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.toString()) return null;

  if (params.has("state")) {
    const decoded = decodeShareState(params.get("state"));
    if (!decoded) return null;

    const prefs = {};

    if (ALLOWED_BALANCE_FILTERS.has(decoded.b)) {
      prefs.balance = decoded.b;
    }
    if (Array.isArray(decoded.s)) {
      prefs.scriptTypes = decoded.s;
    }
    if (Array.isArray(decoded.p)) {
      prefs.spendActivities = decoded.p;
    }
    if (Array.isArray(decoded.d)) {
      prefs.detailTags = decoded.d;
    }
    if (Array.isArray(decoded.g)) {
      prefs.identityGroups = decoded.g;
    }
    if (Array.isArray(decoded.i)) {
      prefs.identityTags = decoded.i;
    }
    if (typeof decoded.q === "string") {
      prefs.topExposureAddressQuery = decoded.q;
    }
    if (decoded.v === "bars" || decoded.v === "historical") {
      prefs.scriptPanelMode = decoded.v;
    }
    if (typeof decoded.m === "string" && ALLOWED_SUPPLY_DISPLAY_MODES.has(decoded.m)) {
      prefs.supplyDisplayMode = decoded.m;
    }
    if (decoded.c === 0 || decoded.c === 1) {
      prefs.topExposuresFiltersCollapsed = decoded.c === 1;
    }
    if (decoded.e === 0 || decoded.e === 1) {
      prefs.scriptPanelDetailsCollapsed = decoded.e === 1;
    }

    if (decoded.t === "l") {
      prefs.snapshotPreference = SNAPSHOT_PREF_LATEST;
    }

    const snapshot = String(decoded.h || "").trim();
    if (decoded.t === "s" && /^\d+$/.test(snapshot)) {
      prefs.snapshotPreference = SNAPSHOT_PREF_SPECIFIC;
      prefs.snapshotHeight = snapshot;
    } else if (!decoded.t && /^\d+$/.test(snapshot)) {
      // Backward compatibility for older compact links that only stored a height.
      prefs.snapshotPreference = SNAPSHOT_PREF_SPECIFIC;
      prefs.snapshotHeight = snapshot;
    }

    return prefs;
  }

  const hasKnownKey = [
    "balance",
    "scriptTypes",
    "spendActivities",
    "detailTags",
    "identityGroups",
    "identityTags",
    "addr",
    "panel",
    "view",
    "show",
    "topCollapsed",
    "detailsCollapsed",
    "snapshot",
  ].some((key) => params.has(key));

  if (!hasKnownKey) return null;

  const prefs = {};

  const balance = params.get("balance");
  if (ALLOWED_BALANCE_FILTERS.has(balance)) {
    prefs.balance = balance;
  }

  const scriptTypes = parseArrayParam(params, "scriptTypes", ALLOWED_SCRIPT_FILTERS, "All");
  if (scriptTypes !== null) {
    prefs.scriptTypes = scriptTypes;
  }

  const spendActivities = parseArrayParam(params, "spendActivities", ALLOWED_SPEND_FILTERS, "all");
  if (spendActivities !== null) {
    prefs.spendActivities = spendActivities;
  }

  const detailTags = parseArrayParam(params, "detailTags");
  if (detailTags !== null) {
    prefs.detailTags = detailTags;
  }

  const identityGroups = parseArrayParam(params, "identityGroups");
  if (identityGroups !== null) {
    prefs.identityGroups = identityGroups;
  }

  const identityTags = parseArrayParam(params, "identityTags");
  if (identityTags !== null) {
    prefs.identityTags = identityTags;
  }

  if (params.has("addr")) {
    prefs.topExposureAddressQuery = params.get("addr") || "";
  }

  const panel = params.get("view") || params.get("panel");
  if (panel === "bars" || panel === "historical") {
    prefs.scriptPanelMode = panel;
  }

  const show = params.get("show");
  if (show && ALLOWED_SUPPLY_DISPLAY_MODES.has(show)) {
    prefs.supplyDisplayMode = show;
  }

  if (params.has("topCollapsed")) {
    prefs.topExposuresFiltersCollapsed = params.get("topCollapsed") === "1";
  }

  if (params.has("detailsCollapsed")) {
    prefs.scriptPanelDetailsCollapsed = params.get("detailsCollapsed") === "1";
  }

  const snapshot = String(params.get("snapshot") || "").trim();
  if (/^\d+$/.test(snapshot)) {
    prefs.snapshotPreference = SNAPSHOT_PREF_SPECIFIC;
    prefs.snapshotHeight = snapshot;
  }

  return prefs;
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
  const originalLabel = (labelEl ? labelEl.textContent : buttonEl.textContent) || "Copy Link";
  if (buttonEl.__copyFeedbackTimer) {
    window.clearTimeout(buttonEl.__copyFeedbackTimer);
  }
  buttonEl.classList.add("copy-link-btn--copied");
  if (labelEl) {
    labelEl.textContent = "Copied!";
  } else {
    buttonEl.textContent = "Copied!";
  }
  setButtonIcon("copyDashboardIcon", ICONS.copyCopied);
  buttonEl.__copyFeedbackTimer = window.setTimeout(() => {
    if (labelEl) {
      labelEl.textContent = originalLabel;
    } else {
      buttonEl.textContent = originalLabel;
    }
    setButtonIcon("copyDashboardIcon", ICONS.copyLink);
    buttonEl.classList.remove("copy-link-btn--copied");
    buttonEl.__copyFeedbackTimer = null;
  }, 1400);
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      values.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  values.push(current);
  return values;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row;
  });
}

function toInt(value) {
  if (value === null || value === undefined || value === "") return 0;
  return Number.parseInt(value, 10) || 0;
}

function toFloat(value) {
  if (value === null || value === undefined || value === "") return 0;
  return Number.parseFloat(value) || 0;
}

function getRowDisplayGroupIds(row) {
  const raw = String(row.display_group_ids || row.display_group_id || row.group_id || "");
  const ids = raw
    .split("|")
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return Array.from(new Set(ids));
}

function getRowPrimaryGroupId(row) {
  const ids = getRowDisplayGroupIds(row);
  return ids.length ? ids[0] : "";
}

function parseScriptSupplyMap(rawValue) {
  let parsed = {};
  if (!rawValue) return parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch (err) {
    return {};
  }

  const normalized = {};
  Object.entries(parsed).forEach(([scriptTypeRaw, satsRaw]) => {
    const scriptType = SCRIPT_TYPES_ORDER.includes(scriptTypeRaw) ? scriptTypeRaw : "Other";
    normalized[scriptType] = (normalized[scriptType] || 0) + toInt(satsRaw);
  });
  return normalized;
}

function getRowSupplyByScriptType(row) {
  if (row.__supplyByScriptTypeCache) {
    return row.__supplyByScriptTypeCache;
  }

  const fromMap = parseScriptSupplyMap(row.exposed_supply_sats_by_script_type);
  const hasValues = Object.values(fromMap).some((value) => value > 0);
  if (hasValues) {
    row.__supplyByScriptTypeCache = fromMap;
    return fromMap;
  }

  const fallbackTotal = toInt(row.exposed_supply_sats);
  const fallbackScriptTypes = String(row.script_types || row.script_type || "")
    .split("|")
    .map((value) => value.trim())
    .filter((value) => SCRIPT_TYPES_ORDER.includes(value));
  const uniqueFallbackTypes = Array.from(new Set(fallbackScriptTypes));
  const targets = uniqueFallbackTypes.length ? uniqueFallbackTypes : ["Other"];
  const distributed = {};
  if (fallbackTotal > 0) {
    const chunk = fallbackTotal / targets.length;
    targets.forEach((scriptType) => {
      distributed[scriptType] = (distributed[scriptType] || 0) + chunk;
    });
  }

  row.__supplyByScriptTypeCache = distributed;
  return distributed;
}

function getRowScriptTypes(row) {
  const explicit = String(row.script_types || row.script_type || "")
    .split("|")
    .map((value) => value.trim())
    .filter((value) => SCRIPT_TYPES_ORDER.includes(value));
  const uniqueExplicit = Array.from(new Set(explicit));
  if (uniqueExplicit.length) return uniqueExplicit;

  const supplyByScript = getRowSupplyByScriptType(row);
  const derived = SCRIPT_TYPES_ORDER.filter((scriptType) => toInt(supplyByScript[scriptType]) > 0);
  return derived;
}

function getRowExposedSupplySats(row) {
  const supplyByScript = getRowSupplyByScriptType(row);
  const total = Object.values(supplyByScript).reduce((sum, value) => sum + toInt(value), 0);
  if (total > 0) return total;
  return toInt(row.exposed_supply_sats);
}

function formatInt(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatCeilBtc(sats) {
  const btc = Math.floor(sats / SATS_PER_BTC);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(btc);
}

function formatDays(days) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(days);
}

function formatMigrationTime(blocks) {
  const roundedBlocks = Math.max(1, Math.ceil(blocks));
  const minutes = roundedBlocks * (1440 / BLOCKS_PER_DAY);

  if (minutes < 60) {
    return `${formatInt(Math.ceil(minutes))} minutes`;
  }

  const days = roundedBlocks / BLOCKS_PER_DAY;
  if (days < 1) {
    const hours = days * 24;
    return `${formatDays(hours)} hours`;
  }
  return `${formatDays(days)} days`;
}

function formatSigFigsBtc(sats) {
  const TENTH_BTC_SATS = SATS_PER_BTC / 10; // 10,000,000
  const btc = sats / SATS_PER_BTC;
  
  // Integer BTC amounts: check at sats level, 0 decimal places
  if (sats % SATS_PER_BTC === 0) {
    return btc.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  
  // 0.1 BTC increments: check at sats level, 1 decimal place
  if (sats % TENTH_BTC_SATS === 0) {
    return btc.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  
  // All others: 2 decimal places
  return btc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTooltipDate(unixTime) {
  if (!unixTime) return "Unknown";
  const date = new Date(unixTime * 1000);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute} (UTC)`;
}

function formatRelativeAge(unixTime) {
  if (!unixTime) return null;
  const days = (Date.now() / 1000 - unixTime) / 86400;
  if (days >= 365) {
    const years = days / 365.25;
    return `${years.toFixed(1)} Years Ago`;
  }
  return `${Math.round(days)} Days Ago`;
}

function formatSnapshotSelectDate(unixTime) {
  if (!unixTime) return "";
  const date = new Date(unixTime * 1000);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function formatTooltipDateFromHeight(blockheight) {
  const normalizedHeight = Number.parseInt(blockheight, 10);
  if (Number.isFinite(normalizedHeight) && normalizedHeight >= 0) {
    const fromLookup = state.blockDatetimeByHeight[String(normalizedHeight)];
    if (fromLookup) return fromLookup;
  }
  return "Unknown";
}

function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

let customTooltipBound = false;
let customTooltipAnchor = null;

function ensureCustomTooltipElement() {
  let tooltip = document.getElementById("quantumInlineTooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "quantumInlineTooltip";
    tooltip.className = "quantum-inline-tooltip";
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function hideCustomTooltip() {
  const tooltip = document.getElementById("quantumInlineTooltip");
  if (!tooltip) return;
  tooltip.classList.remove("is-visible");
}

function resolveTooltipBounds(anchor) {
  const reportDialog = anchor instanceof Element
    ? anchor.closest(".snapshot-report-dialog")
    : null;

  if (reportDialog instanceof Element) {
    const rect = reportDialog.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }

  return {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function placeCustomTooltip(tooltip, x, y, anchor = null) {
  const bounds = resolveTooltipBounds(anchor || customTooltipAnchor);
  const offset = 14;
  const pad = 8;

  let left = x + offset;
  let top = y + offset;

  const maxLeft = bounds.right - tooltip.offsetWidth - pad;
  const maxTop = bounds.bottom - tooltip.offsetHeight - pad;

  if (left > maxLeft) left = Math.max(bounds.left + pad, x - tooltip.offsetWidth - offset);
  if (top > maxTop) top = Math.max(bounds.top + pad, y - tooltip.offsetHeight - offset);

  left = Math.max(bounds.left + pad, Math.min(left, maxLeft));
  top = Math.max(bounds.top + pad, Math.min(top, maxTop));

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
  const bounds = resolveTooltipBounds(anchor);
  const boundsConstrainedMaxWidth = Math.max(180, Math.floor(bounds.width - 16));
  tooltip.style.maxWidth = `${Math.min(420, boundsConstrainedMaxWidth)}px`;
  let activeValueClass = "";
  tooltip.innerHTML = text
    .split("\n")
    .map((line) => {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (!match) {
        activeValueClass = "";
        return `<div class="tooltip-row"><span>${escapeHtml(line)}</span></div>`;
      }

      const labelText = String(match[1] || "").trim();
      const isStructuredLabel = /^[A-Za-z][A-Za-z0-9_()\/ +\-]{0,48}$/.test(labelText);
      if (!isStructuredLabel) {
        activeValueClass = "";
        return `<div class="tooltip-row"><span>${escapeHtml(line)}</span></div>`;
      }

      const rawLabel = labelText.toLowerCase();
      if (rawLabel === "never spent") {
        activeValueClass = "tooltip-value-never";
      } else if (rawLabel === "inactive") {
        activeValueClass = "tooltip-value-inactive";
      } else if (rawLabel === "active") {
        activeValueClass = "tooltip-value-active";
      } else if (rawLabel !== "filtered") {
        activeValueClass = "";
      }

      const valueClassAttr = activeValueClass ? ` class="${activeValueClass}"` : "";
      return `<div class="tooltip-row"><span class="tooltip-label">${escapeHtml(`${labelText}:`)}</span><span${valueClassAttr}>${escapeHtml(match[2])}</span></div>`;
    })
    .join("");
  tooltip.classList.add("is-visible");
  placeCustomTooltip(tooltip, x, y, anchor);
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
    if (anchor instanceof Element && anchor.closest("#scriptBars .bar-stack-track")) {
      return false;
    }
    if (
      anchor instanceof HTMLElement &&
      anchor.classList.contains("tag") &&
      (anchor.classList.contains("tag-spend-never") ||
        anchor.classList.contains("tag-spend-inactive") ||
        anchor.classList.contains("tag-spend-active"))
    ) {
      return false;
    }
    return !(anchor instanceof HTMLElement && anchor.disabled);
  };

  document.addEventListener("mouseover", (event) => {
    const anchor = event.target instanceof Element ? event.target.closest("[data-tooltip]") : null;
    if (shouldSuppressTooltipForAnchor(anchor)) {
      if (customTooltipAnchor === anchor) {
        customTooltipAnchor = null;
      }
      hideCustomTooltip();
      return;
    }
    if (!anchor) return;
    customTooltipAnchor = anchor;
    showCustomTooltip(anchor, event.clientX, event.clientY);
  });

  document.addEventListener("mousemove", (event) => {
    if (!customTooltipAnchor) return;
    const tooltip = document.getElementById("quantumInlineTooltip");
    if (!tooltip || !tooltip.classList.contains("is-visible")) return;
    placeCustomTooltip(tooltip, event.clientX, event.clientY, customTooltipAnchor);
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
      if (customTooltipAnchor === anchor) {
        customTooltipAnchor = null;
      }
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

function formatPercent(numerator, denominator) {
  if (!denominator) return "0.00%";
  const pct = (numerator / denominator) * 100;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(pct)}%`;
}

function renderEmptyKpis() {
  document.getElementById("kpiSupply").textContent = "-";
  document.getElementById("kpiSupplyBreakdown").innerHTML = "";
  document.getElementById("kpiExposedSupply").textContent = "-";
  document.getElementById("kpiExposedSupplyShare").textContent = "-";
  document.getElementById("kpiExposedPubkeys").textContent = "-";
  document.getElementById("kpiExposedPubkeysShare").textContent = "-";
  document.getElementById("kpiExposedUtxos").textContent = "-";
  document.getElementById("kpiExposedUtxosShare").textContent = "-";
  document.getElementById("kpiMigrationTime").textContent = "-";
  document.getElementById("kpiMigrationBlocks").textContent = "-";
}

function formatSpendLabel(value) {
  if (value === "never_spent") return "Never Spent";
  if (value === "inactive") return "Inactive";
  if (value === "active") return "Active";
  return value;
}

function balanceMinSats(balanceKey) {
  if (balanceKey === "ge1000") return 100_000_000_000;
  if (balanceKey === "ge100") return 10_000_000_000;
  if (balanceKey === "ge10") return 1_000_000_000;
  if (balanceKey === "ge1") return 100_000_000;
  return 0;
}

function getScriptCheckboxes() {
  return Array.from(document.querySelectorAll(".script-check"));
}

function getSpendCheckboxes() {
  return Array.from(document.querySelectorAll(".spend-check"));
}

function getDetailCheckboxes() {
  return Array.from(document.querySelectorAll(".detail-check"));
}

function getIdentityCheckboxes() {
  return Array.from(document.querySelectorAll(".identity-check"));
}

function getIdentityGroupCheckboxes() {
  return Array.from(document.querySelectorAll(".identity-group-check"));
}

function getCheckedScriptValues() {
  return getScriptCheckboxes()
    .filter((el) => el.checked)
    .map((el) => el.value);
}

function getCheckedSpendValues() {
  return getSpendCheckboxes()
    .filter((el) => el.checked)
    .map((el) => el.value);
}

function updateScriptTriggerLabel() {
  const trigger = document.getElementById("scriptDropdownTrigger");
  const checked = getCheckedScriptValues();
  if (checked.length === 0) {
    trigger.textContent = "None";
    return;
  }
  if (checked.includes("All")) {
    trigger.textContent = "All";
    return;
  }
  trigger.textContent = checked.join(", ");
}

function updateSpendTriggerLabel() {
  const trigger = document.getElementById("spendDropdownTrigger");
  const checked = getCheckedSpendValues();
  if (checked.length === 0) {
    trigger.textContent = "None";
    return;
  }
  if (checked.includes("all")) {
    trigger.textContent = "All";
    return;
  }
  trigger.textContent = checked.map((v) => formatSpendLabel(v)).join(", ");
}

function updateTagTriggerLabel(triggerId, checkedValues) {
  const trigger = document.getElementById(triggerId);
  const displayValues = checkedValues.map((value) => {
    if (triggerId === "detailDropdownTrigger" && value === UNLABELED_DETAIL_FILTER_VALUE) {
      return "Unlabeled";
    }
    if (triggerId === "identityGroupDropdownTrigger" && value === UNIDENTIFIED_IDENTITY_GROUP_FILTER_VALUE) {
      return UNIDENTIFIED_IDENTITY_GROUP_FILTER_LABEL;
    }
    if (triggerId === "identityDropdownTrigger" && value === UNIDENTIFIED_IDENTITY_FILTER_VALUE) {
      return "Unidentified";
    }
    return value;
  });

  let summary = "None";
  if (checkedValues.includes("All")) {
    summary = "All";
  } else if (displayValues.length) {
    if (triggerId === "identityGroupDropdownTrigger") {
      summary = `${displayValues.length} selected`;
    } else {
      summary = displayValues.length <= 2 ? displayValues.join(", ") : `${displayValues.length} selected`;
    }
  }

  if (trigger instanceof HTMLInputElement) {
    trigger.placeholder = summary;
    return;
  }

  trigger.textContent = summary;
}

function renderIdentityTagMenu(options, selectedValues) {
  const query = state.identityTagFilterQuery.trim().toLowerCase();
  const filteredOptions = options.filter((value) => {
    const label = value === UNIDENTIFIED_IDENTITY_FILTER_VALUE ? UNIDENTIFIED_IDENTITY_FILTER_LABEL : value;
    return !query || label.toLowerCase().includes(query);
  });

  renderTagMenu("identityDropdownMenu", "identity-check", filteredOptions, selectedValues);
}

function clearIdentityTagFilterInput() {
  const identityTrigger = document.getElementById("identityDropdownTrigger");
  if (!(identityTrigger instanceof HTMLInputElement)) {
    return;
  }

  if (!state.identityTagFilterQuery && !identityTrigger.value) {
    updateTagTriggerLabel("identityDropdownTrigger", state.selectedIdentityTags);
    return;
  }

  state.identityTagFilterQuery = "";
  identityTrigger.value = "";
  renderIdentityTagMenu(buildTagOptionsFromGe1Rows(state.selectedIdentityGroups).identities, state.selectedIdentityTags);
  attachIdentityCheckboxListeners();
  updateTagTriggerLabel("identityDropdownTrigger", state.selectedIdentityTags);
}

function attachIdentityCheckboxListeners() {
  getIdentityCheckboxes().forEach((el) => {
    el.addEventListener("change", () => handleTagCheckboxChange(el, getIdentityCheckboxes, "identityDropdownTrigger"));
  });
}

function normalizeTagSelections(checkedValues, allValues, allowEmpty = false, preserveWhenOptionsUnavailable = false) {
  const selected = Array.isArray(checkedValues) ? checkedValues : [];
  const options = Array.isArray(allValues) ? allValues : [];

  const isExcludeEncoded = selected.includes(SHARE_EXCLUDE_TOKEN);
  if (isExcludeEncoded) {
    if (preserveWhenOptionsUnavailable && options.length === 0) {
      return Array.from(new Set(selected));
    }

    if (options.length === 0) {
      return allowEmpty ? [] : ["All"];
    }

    const excludedSet = new Set(selected.filter((value) => value !== SHARE_EXCLUDE_TOKEN));
    const included = options.filter((value) => !excludedSet.has(value));
    if (!included.length) {
      return allowEmpty ? [] : ["All"];
    }
    if (included.length === options.length) {
      return ["All"];
    }
    return included;
  }

  if (preserveWhenOptionsUnavailable && options.length === 0) {
    if (!selected.length) return allowEmpty ? [] : ["All"];
    if (selected.includes("All")) return ["All"];
    return Array.from(new Set(selected));
  }

  if (!selected.length) {
    return allowEmpty ? [] : ["All"];
  }
  if (selected.includes("All")) {
    return ["All"];
  }
  const normalized = selected.filter((value) => options.includes(value));
  if (options.length > 0 && normalized.length === options.length) {
    return ["All"];
  }
  return normalized.length ? normalized : (allowEmpty ? [] : ["All"]);
}

function identityBelongsToSelectedGroups(identityValue, selectedIdentityGroups) {
  if (!Array.isArray(selectedIdentityGroups) || selectedIdentityGroups.includes("All")) {
    return true;
  }

  const includeUnidentified = selectedIdentityGroups.includes(UNIDENTIFIED_IDENTITY_GROUP_FILTER_VALUE);
  const identityTag = formatIdentityTag(identityValue || "");
  if (!identityTag) return includeUnidentified;

  const groups = state.identityToGroupNames[identityTag] || [];
  if (!groups.length) return includeUnidentified;

  return groups.some(
    (groupName) =>
      groupName !== UNIDENTIFIED_IDENTITY_GROUP_FILTER_VALUE && selectedIdentityGroups.includes(groupName)
  );
}

function buildTagOptionsFromGe1Rows(selectedIdentityGroups = state.selectedIdentityGroups, orderingFilters = null) {
  const detailSet = new Set();
  const identityGroupSet = new Set();
  const identityGroupSupplySats = new Map();
  const identitySupplySats = new Map();
  const identitySet = new Set();
  const orderingAddressQuery = String(orderingFilters?.topExposureAddressQuery || "").trim().toLowerCase();
  const rowMatchesOrderingAddressQuery = (row) => {
    if (!orderingAddressQuery) return true;
    const displayIds = String(row.display_group_ids || row.display_group_id || "").toLowerCase();
    return displayIds.includes(orderingAddressQuery);
  };
  const hasIdentityGroupMap = Object.keys(state.identityToGroupNames).length > 0;
  let hasUnlabeledDetail = false;
  let hasUnlabeledIdentity = false;
  let hasUnidentifiedGroup = false;
  state.ge1Rows.forEach((row) => {
    const detail = formatDetailTag(row.details || "");
    const identity = formatIdentityTag(row.identity || "");
    if (detail) {
      detailSet.add(detail);
    } else {
      hasUnlabeledDetail = true;
    }
    if (!identity) {
      hasUnlabeledIdentity = true;
      hasUnidentifiedGroup = true;
      if (
        orderingFilters &&
        (selectedIdentityGroups.includes("All") || selectedIdentityGroups.includes(UNIDENTIFIED_IDENTITY_GROUP_FILTER_VALUE)) &&
        rowPassesTopExposureFilters(row, orderingFilters) &&
        rowMatchesOrderingAddressQuery(row)
      ) {
        identitySupplySats.set(
          UNIDENTIFIED_IDENTITY_FILTER_VALUE,
          (identitySupplySats.get(UNIDENTIFIED_IDENTITY_FILTER_VALUE) || 0) + getFilteredExposedSupplySatsForRow(row, orderingFilters.scriptTypes)
        );
      }
      return;
    }

    const groups = state.identityToGroupNames[identity] || [];
    if (hasIdentityGroupMap && groups.length === 0) {
      hasUnidentifiedGroup = true;
    }
    const exposedSupplySats = getRowExposedSupplySats(row);
    groups.forEach((groupName) => {
      identityGroupSet.add(groupName);
      identityGroupSupplySats.set(groupName, (identityGroupSupplySats.get(groupName) || 0) + exposedSupplySats);
    });

    if (Array.isArray(selectedIdentityGroups) && selectedIdentityGroups.includes("All") && !hasIdentityGroupMap) {
      identitySet.add(identity);
    }

    if (identityBelongsToSelectedGroups(identity, selectedIdentityGroups)) {
      identitySet.add(identity);

      if (orderingFilters && rowPassesTopExposureFilters(row, orderingFilters) && rowMatchesOrderingAddressQuery(row)) {
        identitySupplySats.set(
          identity,
          (identitySupplySats.get(identity) || 0) + getFilteredExposedSupplySatsForRow(row, orderingFilters.scriptTypes)
        );
      }
    }
  });

  // Always include known identities from the selected group set, even when they have
  // zero supply in the current snapshot.
  if (Array.isArray(selectedIdentityGroups) && !selectedIdentityGroups.includes("All")) {
    selectedIdentityGroups.forEach((groupName) => {
      const identities = state.identityGroupsByName[groupName] || [];
      identities.forEach((identity) => {
        if (identity) {
          identitySet.add(identity);
        }
      });
    });
  } else if (hasIdentityGroupMap) {
    Object.keys(state.identityToGroupNames).forEach((identity) => {
      if (identity) {
        identitySet.add(identity);
      }
    });
  }

  const sorter = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

  const detailOptions = Array.from(detailSet).sort(sorter);
  if (hasUnlabeledDetail) {
    detailOptions.unshift(UNLABELED_DETAIL_FILTER_VALUE);
  }

  const identityGroupOptions = Array.from(identityGroupSet).sort((a, b) => {
    const supplyDiff = (identityGroupSupplySats.get(b) || 0) - (identityGroupSupplySats.get(a) || 0);
    if (supplyDiff !== 0) return supplyDiff;
    return sorter(a, b);
  });
  if (hasUnidentifiedGroup) {
    identityGroupOptions.unshift(UNIDENTIFIED_IDENTITY_GROUP_FILTER_VALUE);
  }

  const identityOptions = Array.from(identitySet).sort((a, b) => {
    const supplyDiff = (identitySupplySats.get(b) || 0) - (identitySupplySats.get(a) || 0);
    if (supplyDiff !== 0) return supplyDiff;
    return sorter(a, b);
  });
  if (
    hasUnlabeledIdentity &&
    (selectedIdentityGroups.includes("All") || selectedIdentityGroups.includes(UNIDENTIFIED_IDENTITY_GROUP_FILTER_VALUE))
  ) {
    identityOptions.unshift(UNIDENTIFIED_IDENTITY_FILTER_VALUE);
  }

  return {
    details: detailOptions,
    identityGroups: identityGroupOptions,
    identities: identityOptions,
  };
}

function renderTagMenu(menuId, checkboxClass, options, selectedValues) {
  const menu = document.getElementById(menuId);
  const useAll = selectedValues.includes("All");
  const showAllAsCheckedSelections =
    useAll &&
    (checkboxClass === "detail-check" || checkboxClass === "identity-group-check" || checkboxClass === "identity-check");
  const selectedSet = new Set(selectedValues);
  const optionHtml = options
    .map((value) => {
      const label =
        checkboxClass === "detail-check" && value === UNLABELED_DETAIL_FILTER_VALUE
          ? UNLABELED_DETAIL_FILTER_LABEL
          : checkboxClass === "identity-group-check" && value === UNIDENTIFIED_IDENTITY_GROUP_FILTER_VALUE
          ? UNIDENTIFIED_IDENTITY_GROUP_FILTER_LABEL
          : checkboxClass === "identity-check" && value === UNIDENTIFIED_IDENTITY_FILTER_VALUE
          ? UNIDENTIFIED_IDENTITY_FILTER_LABEL
          : value;
      return `<label class="script-option"><input type="checkbox" class="${checkboxClass}" value="${escapeHtmlAttr(value)}" ${
        showAllAsCheckedSelections || (!useAll && selectedSet.has(value)) ? "checked" : ""
      }> ${escapeHtml(label)}</label>`;
    })
    .join("");

  menu.innerHTML =
    `<label class="script-option"><input type="checkbox" class="${checkboxClass}" value="All" ${
      useAll ? "checked" : ""
    }> All</label>` + optionHtml;
}

function tagStateKeyForTrigger(triggerId) {
  if (triggerId === "detailDropdownTrigger") return "selectedDetailTags";
  if (triggerId === "identityGroupDropdownTrigger") return "selectedIdentityGroups";
  if (triggerId === "identityDropdownTrigger") return "selectedIdentityTags";
  return null;
}

function getAllTagValuesForTrigger(triggerId) {
  if (triggerId === "detailDropdownTrigger") {
    return buildTagOptionsFromGe1Rows(state.selectedIdentityGroups).details;
  }
  if (triggerId === "identityGroupDropdownTrigger") {
    return buildTagOptionsFromGe1Rows(["All"]).identityGroups;
  }
  if (triggerId === "identityDropdownTrigger") {
    return buildTagOptionsFromGe1Rows(state.selectedIdentityGroups).identities;
  }
  return [];
}

function handleTagCheckboxChange(changedEl, checkboxGetter, triggerId) {
  const checkboxes = checkboxGetter();
  const stateKey = tagStateKeyForTrigger(triggerId);
  const allowEmptyAllToggle =
    triggerId === "detailDropdownTrigger" ||
    triggerId === "identityGroupDropdownTrigger" ||
    triggerId === "identityDropdownTrigger";
  const previousValues = stateKey && Array.isArray(state[stateKey]) ? state[stateKey] : ["All"];
  const nonAllValues = getAllTagValuesForTrigger(triggerId);
  const nextSet = previousValues.includes("All") && changedEl.value !== "All"
    ? new Set(nonAllValues)
    : new Set(previousValues.filter((value) => value !== "All"));

  if (changedEl.value === "All") {
    nextSet.clear();
  } else if (changedEl.checked) {
    nextSet.add(changedEl.value);
  } else {
    nextSet.delete(changedEl.value);
  }

  let checkedValues;
  if (changedEl.value === "All") {
    checkedValues = changedEl.checked ? ["All"] : (allowEmptyAllToggle ? [] : ["All"]);
  } else if (nextSet.size === nonAllValues.length && nonAllValues.length) {
    checkedValues = ["All"];
  } else if (nextSet.size) {
    checkedValues = Array.from(nextSet);
  } else {
    checkedValues = allowEmptyAllToggle ? [] : ["All"];
  }

  if (stateKey) {
    state[stateKey] = checkedValues;
  }

  checkboxes.forEach((el) => {
    if (el.value === "All") {
      el.checked = checkedValues.includes("All");
      return;
    }
    el.checked = (allowEmptyAllToggle && checkedValues.includes("All")) || (!checkedValues.includes("All") && checkedValues.includes(el.value));
  });

  if (triggerId === "identityGroupDropdownTrigger") {
    state.pendingIdentityTagExclusions = null;
    state.identityTagFilterQuery = "";
    if (changedEl.checked) {
      if (changedEl.value === "All") {
        state.selectedIdentityTags = ["All"];
      } else {
        const groupIdentities = buildTagOptionsFromGe1Rows([changedEl.value]).identities;
        if (groupIdentities.length && !state.selectedIdentityTags.includes("All")) {
          const selectedSet = new Set(
            state.selectedIdentityTags.filter(
              (value) => value && value !== "All" && value !== SHARE_EXCLUDE_TOKEN
            )
          );
          groupIdentities.forEach((identity) => selectedSet.add(identity));
          state.selectedIdentityTags = selectedSet.size ? Array.from(selectedSet) : [];
        }
      }
    }
    const identityTrigger = document.getElementById("identityDropdownTrigger");
    if (identityTrigger instanceof HTMLInputElement) {
      identityTrigger.value = "";
    }
    renderTopExposureTagFilters();
  }

  if (triggerId === "identityDropdownTrigger") {
    state.pendingIdentityTagExclusions = null;
  }

  resetTopExposurePagination();
  triggerEcoFullDataLoadFromFirstFilter();
  updateTagTriggerLabel(triggerId, checkedValues);
  clearPreResetSnapshot();
  update();
}

function renderTopExposureTagFilters() {
  if (isLiteMode()) {
    state.selectedDetailTags = ["All"];
    state.selectedIdentityGroups = ["All"];
    state.selectedIdentityTags = ["All"];
    state.pendingIdentityTagExclusions = null;
    state.identityTagFilterQuery = "";
    updateTagTriggerLabel("detailDropdownTrigger", state.selectedDetailTags);
    updateTagTriggerLabel("identityGroupDropdownTrigger", state.selectedIdentityGroups);
    updateTagTriggerLabel("identityDropdownTrigger", state.selectedIdentityTags);
    updateTopExposureFilterControlAvailability();
    return;
  }

  const allOptions = buildTagOptionsFromGe1Rows(["All"]);
  state.selectedIdentityGroups = normalizeTagSelections(
    state.selectedIdentityGroups,
    allOptions.identityGroups,
    true,
    true
  );

  const optionOrderingFilters = {
    balance: document.getElementById("balanceFilter")?.value || "all",
    scriptTypes: getCheckedScriptValues(),
    spendActivities: getCheckedSpendValues(),
    detailTags: state.selectedDetailTags,
    identityGroups: state.selectedIdentityGroups,
    identityTags: ["All"],
    topExposureAddressQuery: String(state.topExposureAddressQuery || "").trim(),
  };

  const options = buildTagOptionsFromGe1Rows(state.selectedIdentityGroups, optionOrderingFilters);
  state.selectedDetailTags = normalizeTagSelections(state.selectedDetailTags, options.details, true, true);
  const deferIdentityExcludeResolution =
    state.selectedIdentityTags.includes(SHARE_EXCLUDE_TOKEN) &&
    !state.ge1Rows.length;
  if (deferIdentityExcludeResolution) {
    // Before GE1 rows load, identity options are sourced from group metadata and
    // do not include the synthetic __unidentified__ identity. Keep exclusion
    // tokens unresolved until GE1-backed options are available.
    state.selectedIdentityTags = Array.from(new Set(state.selectedIdentityTags));
  } else {
    state.selectedIdentityTags = normalizeTagSelections(state.selectedIdentityTags, options.identities, true, true);
    applyPendingIdentityTagExclusions(options.identities);
  }

  renderTagMenu("detailDropdownMenu", "detail-check", options.details, state.selectedDetailTags);
  renderTagMenu("identityGroupDropdownMenu", "identity-group-check", options.identityGroups, state.selectedIdentityGroups);
  renderIdentityTagMenu(options.identities, state.selectedIdentityTags);

  getDetailCheckboxes().forEach((el) => {
    el.addEventListener("change", () => handleTagCheckboxChange(el, getDetailCheckboxes, "detailDropdownTrigger"));
  });
  getIdentityGroupCheckboxes().forEach((el) => {
    el.addEventListener("change", () =>
      handleTagCheckboxChange(el, getIdentityGroupCheckboxes, "identityGroupDropdownTrigger")
    );
  });
  attachIdentityCheckboxListeners();

  updateTagTriggerLabel("detailDropdownTrigger", state.selectedDetailTags);
  updateTagTriggerLabel("identityGroupDropdownTrigger", state.selectedIdentityGroups);
  updateTagTriggerLabel("identityDropdownTrigger", state.selectedIdentityTags);
  updateTopExposureFilterControlAvailability();
}

function getAggregate(balanceFilter, scriptType, spendType, fieldName) {
  const row = state.aggregatesRows.find(
    (r) =>
      r.balance_filter === balanceFilter &&
      r.script_type_filter === scriptType &&
      r.spend_activity_filter === spendType
  );
  return row ? toInt(row[fieldName]) : 0;
}

function getAggregateFromRows(rows, balanceFilter, scriptType, spendType, fieldName) {
  const row = rows.find(
    (r) =>
      r.balance_filter === balanceFilter &&
      r.script_type_filter === scriptType &&
      r.spend_activity_filter === spendType
  );
  return row ? toInt(row[fieldName]) : 0;
}

function getAggregateFloat(balanceFilter, scriptType, spendType, fieldName) {
  const row = state.aggregatesRows.find(
    (r) =>
      r.balance_filter === balanceFilter &&
      r.script_type_filter === scriptType &&
      r.spend_activity_filter === spendType
  );
  return row ? toFloat(row[fieldName]) : 0;
}

function buildScriptBarsData(filters) {
  const barsBalanceKey = state.balanceAutoForcedFromAllByTopFilters ? "all" : filters.balance;

  if (isTagFilterActive(filters)) {
    const baselineFilters = {
      ...filters,
      detailTags: ["All"],
      identityGroups: ["All"],
      identityTags: ["All"],
    };
    const baselineRows = buildScriptBarsData(baselineFilters);
    return buildScriptBarsDataFromGe1(filters, barsBalanceKey, baselineRows);
  }

  const highlightAllScripts = filters.scriptTypes.includes("All");
  const highlightAllSpends = filters.spendActivities.includes("all");
  const showFullReference = barsBalanceKey !== "all";

  return SCRIPT_TYPES_ORDER.map((script) => {
    // Total supply bar: use the balance-filtered rollup row (all spend activities)
    const totalSupplySats = getAggregate(barsBalanceKey, script, "all", "supply_sats");

    // Exposed supply is always shown in full; filtering only changes emphasis.
    const exposedNever = getAggregate(barsBalanceKey, script, "never_spent", "exposed_supply_sats");
    const exposedInactive = getAggregate(barsBalanceKey, script, "inactive", "exposed_supply_sats");
    const exposedActive = getAggregate(barsBalanceKey, script, "active", "exposed_supply_sats");

    // Keep all-balance composition for faded reference when a balance filter is active.
    const fullTotalSupplySats = getAggregate("all", script, "all", "supply_sats");
    const fullExposedNever = getAggregate("all", script, "never_spent", "exposed_supply_sats");
    const fullExposedInactive = getAggregate("all", script, "inactive", "exposed_supply_sats");
    const fullExposedActive = getAggregate("all", script, "active", "exposed_supply_sats");
    const fullExposedTotal = fullExposedNever + fullExposedInactive + fullExposedActive;
    const fullNonExposedSupplySats = Math.max(fullTotalSupplySats - fullExposedTotal, 0);

    return {
      scriptType: script,
      totalSupplySats,
      exposedNever,
      exposedInactive,
      exposedActive,
      exposedTotal: exposedNever + exposedInactive + exposedActive,
      nonExposedSupplySats: Math.max(totalSupplySats - (exposedNever + exposedInactive + exposedActive), 0),
      fullTotalSupplySats,
      fullExposedNever,
      fullExposedInactive,
      fullExposedActive,
      fullExposedTotal,
      fullNonExposedSupplySats,
      showFullReference,
      scriptHighlighted: highlightAllScripts || filters.scriptTypes.includes(script),
      spendHighlighted: {
        never_spent: highlightAllSpends || filters.spendActivities.includes("never_spent"),
        inactive: highlightAllSpends || filters.spendActivities.includes("inactive"),
        active: highlightAllSpends || filters.spendActivities.includes("active"),
      },
    };
  });
}

function buildScriptBarsDataFromGe1(
  filters,
  barsBalanceKey = state.balanceAutoForcedFromAllByTopFilters ? "all" : filters.balance,
  baselineRows = []
) {
  const highlightAllScripts = filters.scriptTypes.includes("All");
  const highlightAllSpends = filters.spendActivities.includes("all");
  const tagFiltered = isTagFilterActive(filters);
  const rowsByScript = new Map();
  const baselineByScript = new Map(
    (Array.isArray(baselineRows) ? baselineRows : []).map((row) => [row.scriptType, row])
  );

  SCRIPT_TYPES_ORDER.forEach((scriptType) => {
    const baselineRow = baselineByScript.get(scriptType);
    const baselineShowFullReference = baselineRow ? baselineRow.showFullReference : barsBalanceKey !== "all";
    const fullTotalSupplySats = baselineRow
      ? (baselineShowFullReference ? baselineRow.fullTotalSupplySats : baselineRow.totalSupplySats)
      : getAggregate(barsBalanceKey, scriptType, "all", "supply_sats");
    const fullExposedNever = baselineRow
      ? (baselineShowFullReference ? baselineRow.fullExposedNever : baselineRow.exposedNever)
      : getAggregate(barsBalanceKey, scriptType, "never_spent", "exposed_supply_sats");
    const fullExposedInactive = baselineRow
      ? (baselineShowFullReference ? baselineRow.fullExposedInactive : baselineRow.exposedInactive)
      : getAggregate(barsBalanceKey, scriptType, "inactive", "exposed_supply_sats");
    const fullExposedActive = baselineRow
      ? (baselineShowFullReference ? baselineRow.fullExposedActive : baselineRow.exposedActive)
      : getAggregate(barsBalanceKey, scriptType, "active", "exposed_supply_sats");
    const fullExposedTotal = fullExposedNever + fullExposedInactive + fullExposedActive;

    rowsByScript.set(scriptType, {
      scriptType,
      totalSupplySats: 0,
      exposedNever: 0,
      exposedInactive: 0,
      exposedActive: 0,
      exposedTotal: 0,
      nonExposedSupplySats: 0,
      fullTotalSupplySats,
      fullExposedNever,
      fullExposedInactive,
      fullExposedActive,
      fullExposedTotal,
      fullNonExposedSupplySats: Math.max(fullTotalSupplySats - fullExposedTotal, 0),
      showFullReference: tagFiltered,
      scriptHighlighted: highlightAllScripts || filters.scriptTypes.includes(scriptType),
      spendHighlighted: {
        never_spent: highlightAllSpends || filters.spendActivities.includes("never_spent"),
        inactive: highlightAllSpends || filters.spendActivities.includes("inactive"),
        active: highlightAllSpends || filters.spendActivities.includes("active"),
      },
    });
  });

  state.ge1Rows.forEach((row) => {
    if (!rowPassesBalanceFilter(row, barsBalanceKey)) return;

    const exposedSupply = getRowExposedSupplySats(row);
    if (!exposedSupply) return;

    const matchesTagFilter = rowPassesTopExposureFilters(row, filters);

    const scriptTypes = getRowScriptTypes(row);
    const uniqueScriptTypes = Array.from(new Set(scriptTypes));
    const targets = uniqueScriptTypes.length ? uniqueScriptTypes : ["Other"];
    const spend = row.spend_activity;

    const supplyByScriptType = getRowSupplyByScriptType(row);

    targets.forEach((scriptType) => {
      const bucket = rowsByScript.get(scriptType);
      if (!bucket) return;

      // When a script type filter is active, only accumulate into the selected script type buckets.
      // Multi-script rows that pass the filter (because they have one matching type) should not
      // bleed their other script type shares into non-selected bars.
      if (matchesTagFilter && (!highlightAllScripts && !filters.scriptTypes.includes(scriptType))) return;

      if (matchesTagFilter) {
        // Use actual per-script-type supply from breakdown, or fallback to dividing evenly if not available
        const supplyShare = supplyByScriptType[scriptType] !== undefined 
          ? toInt(supplyByScriptType[scriptType])
          : exposedSupply / targets.length;
        
        bucket.totalSupplySats += supplyShare;
        if (spend === "never_spent") {
          bucket.exposedNever += supplyShare;
        } else if (spend === "inactive") {
          bucket.exposedInactive += supplyShare;
        } else if (spend === "active") {
          bucket.exposedActive += supplyShare;
        }
      }
    });
  });

  return Array.from(rowsByScript.values())
    .map((row) => ({
      ...row,
      exposedTotal: row.exposedNever + row.exposedInactive + row.exposedActive,
    }));
}

function renderScriptBars(rows) {
  const container = document.getElementById("scriptBars");
  if (!rows.length) {
    container.className = "bar-empty";
    container.textContent = "No script-type data for current filter selection.";
    return;
  }

  const { showNonExposed, showFilteredOnly } = getSupplyDisplayFlags();
  const filteredExposedForRow = (row) => {
    if (!row.scriptHighlighted) return 0;
    const never = row.spendHighlighted.never_spent ? row.exposedNever : 0;
    const inactive = row.spendHighlighted.inactive ? row.exposedInactive : 0;
    const active = row.spendHighlighted.active ? row.exposedActive : 0;
    return never + inactive + active;
  };
  const spendFadeClass = (row, spendKey) => {
    if (!row.scriptHighlighted) return "";
    return row.spendHighlighted[spendKey] ? "" : "is-faded";
  };
  const showFullReference = rows.some((r) => r.showFullReference);
  
  const maxScaleTotal = Math.max(
    ...rows.map((r) => {
      if (showFilteredOnly) {
        // In filtered-only mode, scale by the post-filter exposed total only.
        return filteredExposedForRow(r);
      }
      if (r.showFullReference) {
        return showNonExposed ? r.fullTotalSupplySats : r.fullExposedTotal;
      }
      return showNonExposed ? r.totalSupplySats : r.exposedTotal;
    }),
    1
  );

  const html = rows.map((r) => {
    const rowClass = "bar-row";
    const trackClass = r.scriptHighlighted ? "bar-stack-track" : "bar-stack-track is-muted";
    const actualTotalSupplySats = r.showFullReference ? r.fullTotalSupplySats : r.totalSupplySats;
    const filteredNeverSats = r.scriptHighlighted && r.spendHighlighted.never_spent ? r.exposedNever : 0;
    const filteredInactiveSats = r.scriptHighlighted && r.spendHighlighted.inactive ? r.exposedInactive : 0;
    const filteredActiveSats = r.scriptHighlighted && r.spendHighlighted.active ? r.exposedActive : 0;
    const filteredExposedTotalSats = filteredNeverSats + filteredInactiveSats + filteredActiveSats;
    const displayNeverSats = showFilteredOnly ? filteredNeverSats : r.exposedNever;
    const displayInactiveSats = showFilteredOnly ? filteredInactiveSats : r.exposedInactive;
    const displayActiveSats = showFilteredOnly ? filteredActiveSats : r.exposedActive;
    const displayedNonExposedSupplySats = showNonExposed && !showFilteredOnly
      ? (r.showFullReference ? r.fullNonExposedSupplySats : r.nonExposedSupplySats)
      : 0;
    const displayedTotalSupplySats = showFilteredOnly
      ? filteredExposedTotalSats
      : (r.showFullReference
        ? (showNonExposed ? (displayedNonExposedSupplySats + r.fullExposedTotal) : r.fullExposedTotal)
        : (showNonExposed ? r.totalSupplySats : r.exposedTotal));
    const totalPct = (displayedTotalSupplySats / maxScaleTotal) * 100;
    const fullTotalPct = !showFilteredOnly && ((showNonExposed ? r.fullTotalSupplySats : r.fullExposedTotal) / maxScaleTotal) * 100;
    const neverPct = displayedTotalSupplySats ? (displayNeverSats / displayedTotalSupplySats) * 100 : 0;
    const inactivePct = displayedTotalSupplySats ? (displayInactiveSats / displayedTotalSupplySats) * 100 : 0;
    const activePct = displayedTotalSupplySats ? (displayActiveSats / displayedTotalSupplySats) * 100 : 0;
    const nonExposedPct = displayedTotalSupplySats ? (displayedNonExposedSupplySats / displayedTotalSupplySats) * 100 : 0;
    const fullDenominator = !showFilteredOnly && (showNonExposed ? r.fullTotalSupplySats : r.fullExposedTotal);
    const filteredNeverOfFullPct = fullDenominator ? (filteredNeverSats / fullDenominator) * 100 : 0;
    const filteredInactiveOfFullPct = fullDenominator ? (filteredInactiveSats / fullDenominator) * 100 : 0;
    const filteredActiveOfFullPct = fullDenominator ? (filteredActiveSats / fullDenominator) * 100 : 0;
    const fullNeverPct = !showFilteredOnly && fullDenominator ? (r.fullExposedNever / fullDenominator) * 100 : 0;
    const fullInactivePct = !showFilteredOnly && fullDenominator ? (r.fullExposedInactive / fullDenominator) * 100 : 0;
    const fullActivePct = !showFilteredOnly && fullDenominator ? (r.fullExposedActive / fullDenominator) * 100 : 0;
    const fullNonExposedPct = !showFilteredOnly && showNonExposed && r.fullTotalSupplySats
      ? (r.fullNonExposedSupplySats / r.fullTotalSupplySats) * 100
      : 0;
    const fullInactiveStartPct = !showFilteredOnly && (fullNeverPct);
    const fullActiveStartPct = !showFilteredOnly && (fullNeverPct + fullInactivePct);
    const fullNonExposedStartPct = !showFilteredOnly && (fullNeverPct + fullInactivePct + fullActivePct);
    const totalBtc = Math.round(actualTotalSupplySats / SATS_PER_BTC);
    const baseExposedBtc = Math.round(r.exposedTotal / SATS_PER_BTC);
    const baseExposedShare = formatPercent(r.exposedTotal, actualTotalSupplySats);
    const filteredExposedBtc = Math.round(filteredExposedTotalSats / SATS_PER_BTC);
    const filteredExposedShare = formatPercent(filteredExposedTotalSats, actualTotalSupplySats);
    const fullExposedBtc = r.showFullReference ? Math.round(r.fullExposedTotal / SATS_PER_BTC) : baseExposedBtc;
    const fullExposedShare = r.showFullReference ? formatPercent(r.fullExposedTotal, r.fullTotalSupplySats) : baseExposedShare;
    const fullExposedForRow = r.showFullReference ? r.fullExposedTotal : r.exposedTotal;
    const fullNeverForTooltip = r.showFullReference ? r.fullExposedNever : r.exposedNever;
    const fullInactiveForTooltip = r.showFullReference ? r.fullExposedInactive : r.exposedInactive;
    const fullActiveForTooltip = r.showFullReference ? r.fullExposedActive : r.exposedActive;
    const showFilteredTooltip = !showFilteredOnly && filteredExposedTotalSats !== fullExposedForRow;
    const buildExposedTooltip = (label, fullSats, filteredSats) => {
      if (showFilteredOnly) {
        return `${label} (Filtered): ${formatInt(Math.round(filteredSats / SATS_PER_BTC))} BTC · ${formatPercent(filteredSats, actualTotalSupplySats)}`;
      }
      const fullLine = `${label}: ${formatInt(Math.round(fullSats / SATS_PER_BTC))} BTC · ${formatPercent(fullSats, actualTotalSupplySats)}`;
      if (!showFilteredTooltip) {
        return fullLine;
      }
      const filteredLine = `Filtered: ${formatInt(Math.round(filteredSats / SATS_PER_BTC))} BTC · ${formatPercent(filteredSats, actualTotalSupplySats)}`;
      return `${fullLine}\n${filteredLine}`;
    };
    const neverTooltip = buildExposedTooltip("Never Spent", fullNeverForTooltip, filteredNeverSats);
    const inactiveTooltip = buildExposedTooltip("Inactive", fullInactiveForTooltip, filteredInactiveSats);
    const activeTooltip = buildExposedTooltip("Active", fullActiveForTooltip, filteredActiveSats);
    const nonExposedBtc = Math.round(displayedNonExposedSupplySats / SATS_PER_BTC);
    const nonExposedTooltip = `Non-exposed: ${formatInt(nonExposedBtc)} BTC · ${formatPercent(displayedNonExposedSupplySats, actualTotalSupplySats)}`;
    const showFilteredMetric =
      r.scriptHighlighted &&
      filteredExposedTotalSats > 0 &&
      filteredExposedTotalSats !== fullExposedForRow;

    return `
      <div class="${rowClass}">
        <div class="bar-head">
          <span class="bar-name">${r.scriptType}</span>
          <span class="bar-metric"><span class="bar-metric-label">Total</span> <span class="bar-metric-value">${formatInt(totalBtc)} BTC</span></span>
        </div>
        <div class="${trackClass}">
          ${showFilteredOnly ? `
          <div class="bar-stack-fill" style="width:${totalPct}%">
            <div class="seg-never ${spendFadeClass(r, "never_spent")}" data-tooltip="${escapeHtmlAttr(neverTooltip)}" style="width:${neverPct}%;"></div>
            <div class="seg-inactive ${spendFadeClass(r, "inactive")}" data-tooltip="${escapeHtmlAttr(inactiveTooltip)}" style="width:${inactivePct}%;"></div>
            <div class="seg-active ${spendFadeClass(r, "active")}" data-tooltip="${escapeHtmlAttr(activeTooltip)}" style="width:${activePct}%;"></div>
          </div>` : (r.showFullReference ? `
          <div class="bar-stack-fill bar-stack-fill-base" style="width:${fullTotalPct}%">
            ${showNonExposed ? `<div class="seg-nonexposed" data-tooltip="${escapeHtmlAttr(nonExposedTooltip)}" style="left:${fullNonExposedStartPct}%; width:${fullNonExposedPct}%;"></div>` : ""}
          </div>
          <div class="bar-stack-fill bar-stack-fill-reference" style="width:${fullTotalPct}%">
            <div class="seg-never" data-tooltip="${escapeHtmlAttr(neverTooltip)}" style="left:0; width:${fullNeverPct}%;"></div>
            <div class="seg-inactive" data-tooltip="${escapeHtmlAttr(inactiveTooltip)}" style="left:${fullInactiveStartPct}%; width:${fullInactivePct}%;"></div>
            <div class="seg-active" data-tooltip="${escapeHtmlAttr(activeTooltip)}" style="left:${fullActiveStartPct}%; width:${fullActivePct}%;"></div>
          </div>
          <div class="bar-stack-fill bar-stack-fill-overlay" style="width:${fullTotalPct}%">
            <div class="seg-never ${spendFadeClass(r, "never_spent")}" data-tooltip="${escapeHtmlAttr(neverTooltip)}" style="left:0; width:${filteredNeverOfFullPct}%;"></div>
            <div class="seg-inactive ${spendFadeClass(r, "inactive")}" data-tooltip="${escapeHtmlAttr(inactiveTooltip)}" style="left:${fullInactiveStartPct}%; width:${filteredInactiveOfFullPct}%;"></div>
            <div class="seg-active ${spendFadeClass(r, "active")}" data-tooltip="${escapeHtmlAttr(activeTooltip)}" style="left:${fullActiveStartPct}%; width:${filteredActiveOfFullPct}%;"></div>
          </div>` : `
          <div class="bar-stack-fill" style="width:${totalPct}%">
            <div class="seg-never ${spendFadeClass(r, "never_spent")}" data-tooltip="${escapeHtmlAttr(neverTooltip)}" style="width:${neverPct}%;"></div>
            <div class="seg-inactive ${spendFadeClass(r, "inactive")}" data-tooltip="${escapeHtmlAttr(inactiveTooltip)}" style="width:${inactivePct}%;"></div>
            <div class="seg-active ${spendFadeClass(r, "active")}" data-tooltip="${escapeHtmlAttr(activeTooltip)}" style="width:${activePct}%;"></div>
            ${showNonExposed ? `<div class="seg-nonexposed" data-tooltip="${escapeHtmlAttr(nonExposedTooltip)}" style="width:${nonExposedPct}%;"></div>` : ""}
          </div>`)}
        </div>
        <div class="bar-summary">
          <span class="bar-metric">
            <span class="bar-metric-label">Exposed</span> <span class="bar-metric-value">${formatInt(fullExposedBtc)} BTC &middot; ${fullExposedShare}</span>
          </span>
          ${showFilteredMetric ? `<span class="bar-metric bar-metric-filtered">
            <span class="bar-metric-label">Filtered</span> <span class="bar-metric-value">${formatInt(filteredExposedBtc)} BTC &middot; ${filteredExposedShare}</span>
          </span>` : ""}
        </div>
      </div>
    `;
  }).join("");

  container.className = "";
  container.innerHTML = html;
}

function compactHeightLabel(height) {
  const n = Number.parseInt(height, 10);
  if (!Number.isFinite(n)) return String(height || "");
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

function niceStep(rawStep) {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const pow10 = 10 ** Math.floor(Math.log10(rawStep));
  const frac = rawStep / pow10;
  if (frac <= 1) return 1 * pow10;
  if (frac <= 2) return 2 * pow10;
  if (frac <= 5) return 5 * pow10;
  return 10 * pow10;
}

function historicalYAxisUnitBtc(yMaxBtc) {
  if (yMaxBtc >= 1_000_000) return 1_000_000;
  if (yMaxBtc >= 100_000) return 100_000;
  if (yMaxBtc >= 10_000) return 10_000;
  if (yMaxBtc >= 1_000) return 1_000;
  return 100;
}

function formatHistoricalYAxisLabelFromSats(satsValue, unitBtc) {
  const btcValue = satsValue / SATS_PER_BTC;
  const snapInt = Math.round(btcValue);
  const snappedBtc = Math.abs(btcValue - snapInt) < 1e-9 ? snapInt : btcValue;

  if (unitBtc >= 1_000_000) {
    const inMillions = snappedBtc / 1_000_000;
    const decimals = Math.abs(inMillions - Math.round(inMillions)) < 1e-9 ? 0 : 1;
    return `${inMillions.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}M BTC`;
  }

  if (unitBtc >= 1_000) {
    const inThousands = snappedBtc / 1_000;
    const decimals = Math.abs(inThousands - Math.round(inThousands)) < 1e-9 ? 0 : 1;
    return `${inThousands.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}k BTC`;
  }

  return `${formatInt(Math.round(snappedBtc))} BTC`;
}

function areaPath(points, xAt, yLowerAt, yUpperAt) {
  if (!points.length) return "";

  let path = `M ${xAt(points[0])} ${yUpperAt(points[0])}`;
  for (let i = 1; i < points.length; i += 1) {
    path += ` L ${xAt(points[i])} ${yUpperAt(points[i])}`;
  }
  for (let i = points.length - 1; i >= 0; i -= 1) {
    path += ` L ${xAt(points[i])} ${yLowerAt(points[i])}`;
  }
  path += " Z";
  return path;
}

function resetHistoricalSeriesState() {
  state.historicalSeriesGe1AbortController?.abort();
  state.historicalSeries = [];
  state.historicalSeriesLoading = false;
  state.historicalSeriesGe1Loading = false;
  state.historicalSeriesGe1AbortController = null;
  state.historicalSeriesGe1ActiveFilterKey = null;
  state.historicalSeriesGe1LoadProgress = null;
  state.historicalSeriesGe1LastCompletedFilterKey = null;
  state.historicalSeriesGe1FallbackFilterKey = null;
  state.historicalProgressiveYMaxSats = null;
}

async function ensureHistoricalSeriesLoaded() {
  if (state.historicalSeries.length || state.historicalSeriesLoading) {
    return;
  }

  state.historicalSeriesLoading = true;
  try {
    if (isLiteMode()) {
      const ecoResp = await fetch("webapp_data/historical_eco.csv");
      if (!ecoResp.ok) {
        throw new Error("Could not load webapp_data/historical_eco.csv");
      }

      const groupedBySnapshot = new Map();
      parseCsv(await ecoResp.text()).forEach((row) => {
        const snapshot = String(row.snapshot || "").trim();
        if (!snapshot) return;

        const aggregatesRow = { ...row };
        delete aggregatesRow.snapshot;

        if (!groupedBySnapshot.has(snapshot)) {
          groupedBySnapshot.set(snapshot, []);
        }
        groupedBySnapshot.get(snapshot).push(aggregatesRow);
      });

      if (state.archivedSnapshotsEnabled) {
        let archivedMergedCount = 0;
        const activeSnapshotSet = new Set(groupedBySnapshot.keys());
        try {
          const archivedResp = await fetch("webapp_data/historical_archived.csv");
          if (archivedResp.ok) {
            parseCsv(await archivedResp.text()).forEach((row) => {
              const snapshot = String(row.snapshot || "").trim();
              if (!snapshot || activeSnapshotSet.has(snapshot)) return;

              const aggregatesRow = { ...row };
              delete aggregatesRow.snapshot;

              if (!groupedBySnapshot.has(snapshot)) {
                groupedBySnapshot.set(snapshot, []);
              }
              groupedBySnapshot.get(snapshot).push(aggregatesRow);
              archivedMergedCount += 1;
            });
          }
        } catch (_err) {
          // Best effort only; historical chart still renders active snapshots.
        }

        // Fallback: if archived mode is enabled but the historical_archived.csv
        // merge yielded nothing, load archived snapshot aggregates directly.
        if (archivedMergedCount === 0) {
          const archivedSnapshots = Object.entries(state.snapshotLocationByHeight || {})
            .filter(([, location]) => location === "archived")
            .map(([height]) => String(height).trim())
            .filter((height) => /^\d+$/.test(height));

          await Promise.all(
            archivedSnapshots.map(async (snapshot) => {
              if (!snapshot || groupedBySnapshot.has(snapshot)) return;
              try {
                const resp = await fetch(`webapp_data/archived/${snapshot}/dashboard_pubkeys_aggregates.csv`);
                if (!resp.ok) return;
                groupedBySnapshot.set(snapshot, parseCsv(await resp.text()));
              } catch (_err) {
                // Keep best-effort behavior; missing archived points won't block rendering.
              }
            })
          );
        }
      }

      state.historicalSeries = Array.from(groupedBySnapshot.entries())
        .sort((left, right) => Number.parseInt(left[0], 10) - Number.parseInt(right[0], 10))
        .map(([snapshot, aggregatesRows]) => ({
          snapshot,
          aggregatesRows,
          ge1FilteredSumsByKey: {},
        }));
      return;
    }

    const snapshotsAsc = [...state.availableSnapshots].sort(
      (left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10)
    );

    const series = [];
    for (const snapshot of snapshotsAsc) {
      const resp = await fetch(`${snapshotBasePath(snapshot)}/dashboard_pubkeys_aggregates.csv`);
      if (!resp.ok) {
        throw new Error(`Could not load historical aggregates for snapshot ${snapshot}`);
      }
      series.push({
        snapshot,
        aggregatesRows: parseCsv(await resp.text()),
        ge1FilteredSumsByKey: {},
      });
      // Yield between files to keep the renderer responsive on first load.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    state.historicalSeries = series;

    // Restore any previously persisted ge1 filter sums so the first
    // filtered render is instant without re-fetching all ge_1btc CSVs.
    const persistedGe1 = loadGe1PersistentCache();
    for (const point of state.historicalSeries) {
      const stored = persistedGe1[point.snapshot];
      if (stored && typeof stored === "object") {
        Object.assign(point.ge1FilteredSumsByKey, stored);
      }
    }
  } finally {
    state.historicalSeriesLoading = false;
  }
}

function historicalGe1FilterKey(filters) {
  const sortedScripts = [...filters.scriptTypes].sort();
  const sortedDetailTags = [...filters.detailTags].sort();
  const sortedIdentityGroups = [...filters.identityGroups].sort();
  const sortedIdentityTags = [...filters.identityTags].sort();
  return JSON.stringify({
    balance: filters.balance,
    scriptTypes: sortedScripts,
    detailTags: sortedDetailTags,
    identityGroups: sortedIdentityGroups,
    identityTags: sortedIdentityTags,
  });
}

async function ensureHistoricalSeriesGe1Loaded(filters, signal) {
  if (!state.historicalSeries.length) return;

  const filterKey = historicalGe1FilterKey(filters);
  // Sort descending so the most recent snapshot loads and renders first.
  const missingSeries = state.historicalSeries
    .filter((point) => !point.ge1FilteredSumsByKey?.[filterKey])
    .sort((a, b) => Number(b.snapshot) - Number(a.snapshot));

  if (!missingSeries.length) return;

  state.historicalSeriesGe1Loading = true;
  state.historicalSeriesGe1LoadProgress = { loaded: 0, total: missingSeries.length };
  try {
    for (const point of missingSeries) {
      if (signal?.aborted) break;

      let resp;
      try {
        resp = await fetch(`${snapshotBasePath(point.snapshot)}/dashboard_pubkeys_ge_1btc.csv`, signal ? { signal } : {});
      } catch (err) {
        if (err.name === "AbortError") break;
        throw err;
      }

      if (!resp.ok) {
        throw new Error(`Could not load historical ge1 rows for snapshot ${point.snapshot}`);
      }

      let text;
      try {
        text = await resp.text();
      } catch (err) {
        if (err.name === "AbortError") break;
        throw err;
      }

      const sums = buildFilteredExposedFromGe1Csv(text, filters);
      if (!point.ge1FilteredSumsByKey) point.ge1FilteredSumsByKey = {};
      point.ge1FilteredSumsByKey[filterKey] = sums;
      saveGe1PersistentSum(point.snapshot, filterKey, sums);

      state.historicalSeriesGe1LoadProgress.loaded++;
      // Re-render after each snapshot so bars update progressively.
      update();
      // Yield to the main thread before the next fetch.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    state.historicalSeriesGe1Loading = false;
    state.historicalSeriesGe1LoadProgress = null;
    if (state.historicalSeriesGe1ActiveFilterKey === filterKey) {
      state.historicalSeriesGe1ActiveFilterKey = null;
    }
  }
}

function buildFilteredExposedFromGe1Csv(csvText, filters) {
  const sums = {
    never_spent: 0,
    inactive: 0,
    active: 0,
  };

  if (!csvText) {
    return sums;
  }

  let cursor = 0;
  const readLine = () => {
    if (cursor >= csvText.length) return null;
    let end = csvText.indexOf("\n", cursor);
    if (end === -1) end = csvText.length;
    let line = csvText.slice(cursor, end);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    cursor = end + 1;
    return line;
  };

  const headerLine = readLine();
  if (!headerLine) {
    return sums;
  }

  const header = parseCsvLine(headerLine);
  const indexByName = new Map(header.map((name, idx) => [name, idx]));
  const scriptPassAll = filters.scriptTypes.includes("All");
  const minSats = balanceMinSats(filters.balance);

  const idxDetails = indexByName.get("details");
  const idxIdentity = indexByName.get("identity");
  const idxSpend = indexByName.get("spend_activity");
  const idxSupplyByScript = indexByName.get("exposed_supply_sats_by_script_type");

  while (true) {
    const line = readLine();
    if (line === null) break;
    if (!line) continue;
    const values = parseCsvLine(line);

    const details = idxDetails === undefined ? "" : (values[idxDetails] || "");
    const identity = idxIdentity === undefined ? "" : (values[idxIdentity] || "");
    if (!detailTagPassesFilters(filters.detailTags, details)) continue;
    if (!identityBelongsToSelectedGroups(identity, filters.identityGroups)) continue;
    if (!identityTagPassesFilters(filters.identityTags, identity)) continue;

    const supplyByScriptRaw = idxSupplyByScript === undefined ? "" : (values[idxSupplyByScript] || "");
    const supplyByScriptType = parseScriptSupplyMap(supplyByScriptRaw);
    const scriptTypes = SCRIPT_TYPES_ORDER.filter((type) => toInt(supplyByScriptType[type]) > 0);
    const targets = scriptTypes.length ? scriptTypes : ["Other"];
    const exposedSupply = targets.reduce((sum, scriptType) => sum + toInt(supplyByScriptType[scriptType]), 0);
    if (exposedSupply < minSats) continue;
    if (!exposedSupply) continue;

    const spend = idxSpend === undefined ? "" : (values[idxSpend] || "");
    if (!SPEND_TYPES_ORDER.includes(spend)) continue;

    targets.forEach((scriptType) => {
      if (!scriptPassAll && !filters.scriptTypes.includes(scriptType)) {
        return;
      }

      const value = supplyByScriptType[scriptType] !== undefined
        ? toInt(supplyByScriptType[scriptType])
        : exposedSupply / targets.length;

      sums[spend] += value;
    });
  }

  return sums;
}

function buildHistoricalStackedData(filters) {
  const selectedScripts = filters.scriptTypes.includes("All")
    ? SCRIPT_TYPES_ORDER
    : filters.scriptTypes.filter((value) => value !== "All");
  const tagFiltersActive = isTagFilterActive(filters);

  const spendFilterSet = new Set(filters.spendActivities);
  const showAllSpends = spendFilterSet.has("all");
  const ge1FilterKey = tagFiltersActive ? historicalGe1FilterKey(filters) : null;
  const fallbackFilterKey = tagFiltersActive ? state.historicalSeriesGe1FallbackFilterKey : null;

  const points = state.historicalSeries.map((point) => {
    const rows = point.aggregatesRows;

    // Base/faded layers always show the full "all-balance" picture regardless of filter.
    const totalSupplySats = getAggregateFromRows(rows, "all", "All", "all", "supply_sats");
    const fullNever = getAggregateFromRows(rows, "all", "All", "never_spent", "exposed_supply_sats");
    const fullInactive = getAggregateFromRows(rows, "all", "All", "inactive", "exposed_supply_sats");
    const fullActive = getAggregateFromRows(rows, "all", "All", "active", "exposed_supply_sats");
    const fullExposed = fullNever + fullInactive + fullActive;

    const selectedFromGe1 = tagFiltersActive && ge1FilterKey
      ? point.ge1FilteredSumsByKey?.[ge1FilterKey] || null
      : null;
    const fallbackFromPreviousFilter = tagFiltersActive && fallbackFilterKey
      ? point.ge1FilteredSumsByKey?.[fallbackFilterKey] || null
      : null;
    const shouldUseFallbackFilter = tagFiltersActive && ge1FilterKey && !selectedFromGe1 && !!fallbackFromPreviousFilter;

    const selectedNever = selectedFromGe1
      ? selectedFromGe1.never_spent
      : shouldUseFallbackFilter
      ? fallbackFromPreviousFilter.never_spent
      : selectedScripts.reduce(
          (sum, scriptType) =>
            sum + getAggregateFromRows(rows, filters.balance, scriptType, "never_spent", "exposed_supply_sats"),
          0
        );
    const selectedInactive = selectedFromGe1
      ? selectedFromGe1.inactive
      : shouldUseFallbackFilter
      ? fallbackFromPreviousFilter.inactive
      : selectedScripts.reduce(
          (sum, scriptType) =>
            sum + getAggregateFromRows(rows, filters.balance, scriptType, "inactive", "exposed_supply_sats"),
          0
        );
    const selectedActive = selectedFromGe1
      ? selectedFromGe1.active
      : shouldUseFallbackFilter
      ? fallbackFromPreviousFilter.active
      : selectedScripts.reduce(
          (sum, scriptType) =>
            sum + getAggregateFromRows(rows, filters.balance, scriptType, "active", "exposed_supply_sats"),
          0
        );

    const filteredNever = showAllSpends || spendFilterSet.has("never_spent") ? selectedNever : 0;
    const filteredInactive = showAllSpends || spendFilterSet.has("inactive") ? selectedInactive : 0;
    const filteredActive = showAllSpends || spendFilterSet.has("active") ? selectedActive : 0;

    return {
      snapshot: point.snapshot,
      totalSupplySats,
      fullNever,
      fullInactive,
      fullActive,
      fullNonExposed: Math.max(totalSupplySats - fullExposed, 0),
      filteredNever: Math.min(filteredNever, fullNever),
      filteredInactive: Math.min(filteredInactive, fullInactive),
      filteredActive: Math.min(filteredActive, fullActive),
      spendHighlighted: {
        never_spent: showAllSpends || spendFilterSet.has("never_spent"),
        inactive: showAllSpends || spendFilterSet.has("inactive"),
        active: showAllSpends || spendFilterSet.has("active"),
      },
    };
  });

  // Prepend a starting point at height 0 with all supplies at 0
  const zeroPoint = {
    snapshot: "0",
    totalSupplySats: 0,
    fullNever: 0,
    fullInactive: 0,
    fullActive: 0,
    fullNonExposed: 0,
    filteredNever: 0,
    filteredInactive: 0,
    filteredActive: 0,
    spendHighlighted: {
      never_spent: showAllSpends || spendFilterSet.has("never_spent"),
      inactive: showAllSpends || spendFilterSet.has("inactive"),
      active: showAllSpends || spendFilterSet.has("active"),
    },
  };

  return [zeroPoint, ...points];
}

function showHistoricalLoadingOverlay(container, message) {
  if (!container || !container.classList.contains("historical-chart") || !container.querySelector(".historical-svg")) {
    return false;
  }

  container.classList.add("is-loading");

  let overlay = container.querySelector("#historicalChartLoadingOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "historicalChartLoadingOverlay";
    overlay.className = "historical-chart-loading-overlay";
    container.appendChild(overlay);
  }

  let card = overlay.querySelector(".historical-chart-loading-card");
  let messageEl = overlay.querySelector(".historical-chart-loading-message");
  if (!card || !messageEl) {
    overlay.innerHTML = `
      <div class="historical-chart-loading-card" role="status" aria-live="polite">
        <span class="historical-chart-loading-spinner" aria-hidden="true"></span>
        <span class="historical-chart-loading-message"></span>
      </div>
    `;
    card = overlay.querySelector(".historical-chart-loading-card");
    messageEl = overlay.querySelector(".historical-chart-loading-message");
  }

  if (messageEl) {
    messageEl.textContent = String(message || "").trim() || "Loading historical chart...";
  }

  const tooltip = container.querySelector("#historicalHoverTooltip");
  if (tooltip) {
    tooltip.style.display = "none";
  }

  return true;
}

function clearHistoricalLoadingOverlay(container) {
  if (!container) return;

  container.classList.remove("is-loading");
  const overlay = container.querySelector("#historicalChartLoadingOverlay");
  if (overlay) {
    overlay.remove();
  }
}

function replaceHistoricalChartContent(container, markup) {
  if (!container) return;

  const overlay = container.querySelector("#historicalChartLoadingOverlay");
  const range = document.createRange();
  range.selectNodeContents(container);
  const fragment = range.createContextualFragment(markup);

  Array.from(container.childNodes).forEach((node) => {
    if (node !== overlay) {
      node.remove();
    }
  });

  if (overlay) {
    container.insertBefore(fragment, overlay);
    return;
  }

  container.replaceChildren(fragment);
}

function renderHistoricalLoadingShell(container, message = "Loading historical chart...") {
  if (!container) return;

  container.className = "historical-chart";
  replaceHistoricalChartContent(container, `
    <svg class="historical-svg" role="img" aria-label="Historical stacked supply chart loading"></svg>
  `);
  showHistoricalLoadingOverlay(container, message);
}

function renderHistoricalStackedChart(filters) {
  const container = document.getElementById("scriptBars");
  const tagFiltersActive = isTagFilterActive(filters);
  let isRenderingProgressively = false;
  let loadingOverlayMessage = "Loading historical chart...";
  const hasRenderedHistoricalChart =
    !!container && container.classList.contains("historical-chart") && !!container.querySelector(".historical-svg");

  if (!state.historicalSeries.length) {
    if (!state.historicalSeriesLoading) {
      ensureHistoricalSeriesLoaded()
        .then(() => update())
        .catch((err) => {
          console.error(err);
          update();
        });
    }
    renderHistoricalLoadingShell(container, "Loading historical chart...");
    return;
  }

  if (tagFiltersActive) {
    const ge1FilterKey = historicalGe1FilterKey(filters);
    const missingForFilter = state.historicalSeries.some((point) => !point.ge1FilteredSumsByKey?.[ge1FilterKey]);
    if (missingForFilter) {
      // Start a new load only when the filter key has changed; otherwise the
      // existing load is already progressing for this same filter.
      if (state.historicalSeriesGe1ActiveFilterKey !== ge1FilterKey) {
        const priorCompletedKey = state.historicalSeriesGe1LastCompletedFilterKey;
        state.historicalSeriesGe1FallbackFilterKey =
          priorCompletedKey && priorCompletedKey !== ge1FilterKey ? priorCompletedKey : null;
        state.historicalProgressiveYMaxSats = null;

        // Abort any in-flight load for a different filter.
        state.historicalSeriesGe1AbortController?.abort();
        const controller = new AbortController();
        state.historicalSeriesGe1AbortController = controller;
        state.historicalSeriesGe1ActiveFilterKey = ge1FilterKey;
        ensureHistoricalSeriesGe1Loaded(filters, controller.signal)
          .then(() => update())
          .catch((err) => {
            if (err.name !== "AbortError") console.error(err);
            update();
          });
      }

      // Build a progress message for the overlay while loading.
      const prog = state.historicalSeriesGe1LoadProgress;
      loadingOverlayMessage = prog
        ? `Loading filter data... (${prog.loaded}/${prog.total})`
        : "Loading filter data...";
      showHistoricalLoadingOverlay(container, loadingOverlayMessage);

      // Fall through and render with whatever ge1 data has already arrived.
      // Points without ge1 data yet will show their unfiltered bar values;
      // they snap to filtered values as each snapshot finishes loading.
      isRenderingProgressively = true;
    } else {
      state.historicalSeriesGe1LastCompletedFilterKey = ge1FilterKey;
      state.historicalSeriesGe1FallbackFilterKey = null;
    }
  } else {
    state.historicalSeriesGe1LastCompletedFilterKey = null;
    state.historicalSeriesGe1FallbackFilterKey = null;
  }

  // Only show generic loading state if we're not already rendering progressively.
  if (!isRenderingProgressively && (state.historicalSeriesLoading || state.historicalSeriesGe1Loading)) {
    renderHistoricalLoadingShell(container, "Loading historical chart...");
    return;
  }

  if (!state.historicalSeries.length) {
    clearHistoricalLoadingOverlay(container);
    container.className = "bar-empty";
    container.textContent = "No historical snapshots available.";
    return;
  }

  const allPoints = buildHistoricalStackedData(filters);
  // Keep the zero point (height 0) even if it has no supply, but filter out other points with no supply.
  const points = allPoints.filter((point) => point.totalSupplySats > 0 || point.snapshot === "0");
  if (!points.length) {
    clearHistoricalLoadingOverlay(container);
    container.className = "bar-empty";
    container.textContent = "No historical data for current filter selection.";
    return;
  }

  const maxTotal = Math.max(...points.map((point) => point.totalSupplySats), 1);
  const minHeight = Math.min(...points.map((point) => Number.parseInt(point.snapshot, 10) || 0));
  const maxHeight = Math.max(...points.map((point) => Number.parseInt(point.snapshot, 10) || 0));

  const containerWidth = Math.floor(container.clientWidth || container.getBoundingClientRect().width || 0);
  const width = Math.max(containerWidth, 280);
  const height = Math.max(container.clientHeight || 300, 140);
  const compactWidth = width < 520;
  const margin = {
    top: 12,
    right: compactWidth ? 18 : 26,
    bottom: Math.min(30, Math.max(18, Math.floor(height * 0.15))),
    left: compactWidth ? 56 : 68,
  };
  const plotWidth = Math.max(width - margin.left - margin.right, 80);
  const plotHeight = Math.max(height - margin.top - margin.bottom, 56);

  const xDomainSpan = Math.max(maxHeight - minHeight, 1);
  const xAtHeight = (blockheight) => margin.left + ((blockheight - minHeight) / xDomainSpan) * plotWidth;

  const { showNonExposed, showFilteredOnly } = getSupplyDisplayFlags();

  // Compute per-point stacked tops first (only depends on xAtHeight, not yAt).
  const pointsWithIndex = points.map((point, index) => {
    const snapshotHeight = Number.parseInt(point.snapshot, 10) || 0;
    const neverTop = point.fullNever;
    const inactiveTop = neverTop + point.fullInactive;
    const activeTop = inactiveTop + point.fullActive;
    const totalTop = activeTop + point.fullNonExposed;

    // Filtered stacking: only show filtered amounts
    const neverFilteredTop = point.filteredNever;
    const inactiveFilteredTop = point.filteredNever + point.filteredInactive;
    const activeFilteredTop = point.filteredNever + point.filteredInactive + point.filteredActive;
    const inactiveFilteredAnchoredTop = neverTop + point.filteredInactive;
    const activeFilteredAnchoredTop = inactiveTop + point.filteredActive;

    return {
      ...point,
      index,
      snapshotHeight,
      x: xAtHeight(snapshotHeight),
      neverTop,
      inactiveTop,
      activeTop,
      totalTop,
      neverFilteredTop,
      inactiveFilteredTop,
      activeFilteredTop,
      inactiveFilteredAnchoredTop,
      activeFilteredAnchoredTop,
    };
  });

  // Keep the current marker arrow top just under the chart top across modes and window resizes.
  const markerHeadHeightPx = 16;
  const markerGapToPointPx = 6;
  const markerTopPaddingPx = 1;
  const markerClearancePx = markerHeadHeightPx + markerGapToPointPx + markerTopPaddingPx;

  let maxStackSats;
  if (showFilteredOnly) {
    // When showing filtered only, max is the sum of all filtered amounts at highest point
    maxStackSats = Math.max(
      ...pointsWithIndex.map((p) => p.activeFilteredTop),
      1
    );
  } else {
    // Original behavior: show non-exposed if enabled, otherwise just exposed
    maxStackSats = Math.max(
      ...pointsWithIndex.map((p) => (showNonExposed ? p.totalTop : p.activeTop)),
      1
    );
  }

  const clearanceRatio = Math.min(markerClearancePx / Math.max(plotHeight, 1), 0.92);
  const computedYMaxSats = Math.max(maxStackSats / Math.max(1 - clearanceRatio, 0.08), 1);
  const shouldLockYMaxDuringProgressiveLoad = isRenderingProgressively && state.historicalSeriesGe1Loading;
  let yMaxSats;
  if (shouldLockYMaxDuringProgressiveLoad) {
    if (!state.historicalProgressiveYMaxSats) {
      state.historicalProgressiveYMaxSats = computedYMaxSats;
    } else if (computedYMaxSats > state.historicalProgressiveYMaxSats) {
      // Allow upward y-scale adjustments during progressive rendering to avoid clipping.
      state.historicalProgressiveYMaxSats = computedYMaxSats;
    }
    yMaxSats = state.historicalProgressiveYMaxSats;
  } else {
    state.historicalProgressiveYMaxSats = null;
    yMaxSats = computedYMaxSats;
  }

  const yAt = (value) => margin.top + (1 - value / yMaxSats) * plotHeight;

  const yMaxBtc = yMaxSats / SATS_PER_BTC;
  const tickUnitBtc = historicalYAxisUnitBtc(yMaxBtc);
  const targetIntervals = Math.min(8, Math.max(3, Math.round(plotHeight / 78)));
  const yMaxUnits = yMaxBtc / tickUnitBtc;
  const rawStepUnits = yMaxUnits / Math.max(targetIntervals, 1);
  const stepPow10 = 10 ** Math.floor(Math.log10(Math.max(rawStepUnits, 1e-9)));
  const normalizedStep = rawStepUnits / stepPow10;
  const unitStepBasis = [0.5, 1, 1.5, 2, 2.5, 3, 5, 10];
  const selectedBasis = unitStepBasis.find((basis) => normalizedStep <= basis) || 10;
  const stepUnits = selectedBasis * stepPow10;
  const stepBtc = stepUnits * tickUnitBtc;

  const yTickValues = [];
  const topTickBtc = Math.floor(yMaxBtc / stepBtc) * stepBtc;
  for (let tickBtc = topTickBtc; tickBtc >= -1e-9; tickBtc -= stepBtc) {
    yTickValues.push(Math.max(0, tickBtc) * SATS_PER_BTC);
  }
  if (!yTickValues.length || yTickValues[yTickValues.length - 1] !== 0) {
    yTickValues.push(0);
  }

  const gridLines = yTickValues
    .map((value) => {
      const y = yAt(value);
      const label = formatHistoricalYAxisLabelFromSats(value, tickUnitBtc);
      return `
        <line class="historical-grid-line" x1="${margin.left}" y1="${y}" x2="${margin.left + plotWidth}" y2="${y}"></line>
        <text class="historical-y-label" x="${margin.left - 8}" y="${y}" text-anchor="end">${label}</text>
      `;
    })
    .join("");

  const xStep = niceStep((maxHeight - minHeight) / 6 || 1);
  const xTicks = [];
  const xTickStart = Math.ceil(minHeight / xStep) * xStep;
  for (let x = xTickStart; x <= maxHeight; x += xStep) {
    xTicks.push(x);
  }
  if (!xTicks.length || xTicks[0] !== minHeight) {
    xTicks.unshift(minHeight);
  }
  if (xTicks[xTicks.length - 1] !== maxHeight) {
    xTicks.push(maxHeight);
  }

  const xTickLabelY = Math.min(margin.top + plotHeight + 14, height - 4);
  const xTickLabels = xTicks
    .map((tickHeight, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === xTicks.length - 1;
      const anchor = isFirst ? "start" : isLast ? "end" : "middle";
      const x = xAtHeight(tickHeight);
      const paddedX = isFirst ? Math.max(x, margin.left + 2) : isLast ? Math.min(x, margin.left + plotWidth - 2) : x;
      return `
      <text class="historical-tick-label" x="${paddedX}" y="${xTickLabelY}" text-anchor="${anchor}">${compactHeightLabel(tickHeight)}</text>
    `;
    })
    .join("");

  const nonExposedBasePath = areaPath(
    pointsWithIndex,
    (point) => point.x,
    (point) => yAt(point.activeTop),
    (point) => yAt(point.totalTop)
  );
  const neverBasePath = areaPath(
    pointsWithIndex,
    (point) => point.x,
    () => yAt(0),
    (point) => yAt(point.neverTop)
  );
  const inactiveBasePath = areaPath(
    pointsWithIndex,
    (point) => point.x,
    (point) => yAt(point.neverTop),
    (point) => yAt(point.inactiveTop)
  );
  const activeBasePath = areaPath(
    pointsWithIndex,
    (point) => point.x,
    (point) => yAt(point.inactiveTop),
    (point) => yAt(point.activeTop)
  );

  // Filtered-only paths: stacked filtered amounts
  const neverFilteredBasePath = areaPath(
    pointsWithIndex,
    (point) => point.x,
    () => yAt(0),
    (point) => yAt(point.neverFilteredTop)
  );
  const inactiveFilteredBasePath = areaPath(
    pointsWithIndex,
    (point) => point.x,
    (point) => yAt(point.neverFilteredTop),
    (point) => yAt(point.inactiveFilteredTop)
  );
  const activeFilteredBasePath = areaPath(
    pointsWithIndex,
    (point) => point.x,
    (point) => yAt(point.inactiveFilteredTop),
    (point) => yAt(point.activeFilteredTop)
  );

  // Choose paths based on display mode
  const displayNeverPath = showFilteredOnly ? neverFilteredBasePath : neverBasePath;
  const displayInactivePath = showFilteredOnly ? inactiveFilteredBasePath : inactiveBasePath;
  const displayActivePath = showFilteredOnly ? activeFilteredBasePath : activeBasePath;
  const displayNonExposedPath = (showNonExposed && !showFilteredOnly) ? nonExposedBasePath : null;

  const neverOverlayPath = areaPath(
    pointsWithIndex,
    (point) => point.x,
    () => yAt(0),
    (point) => yAt(point.neverFilteredTop)
  );
  const inactiveOverlayPath = areaPath(
    pointsWithIndex,
    (point) => point.x,
    (point) => yAt(showFilteredOnly ? point.neverFilteredTop : point.neverTop),
    (point) => yAt(showFilteredOnly ? point.inactiveFilteredTop : point.inactiveFilteredAnchoredTop)
  );
  const activeOverlayPath = areaPath(
    pointsWithIndex,
    (point) => point.x,
    (point) => yAt(showFilteredOnly ? point.inactiveFilteredTop : point.inactiveTop),
    (point) => yAt(showFilteredOnly ? point.activeFilteredTop : point.activeFilteredAnchoredTop)
  );

  const selectedSnapshotHeight = Number.parseInt(state.snapshotHeight, 10);
  const selectedPoint = Number.isFinite(selectedSnapshotHeight)
    ? pointsWithIndex.find((point) => point.snapshotHeight === selectedSnapshotHeight)
    : null;

  const currentMarker = selectedPoint
    ? (() => {
        const markerX = selectedPoint.x;
        const markerTargetY = showFilteredOnly 
          ? selectedPoint.activeFilteredTop
          : (showNonExposed ? selectedPoint.totalTop : selectedPoint.activeTop);
        const markerTipY = Math.max(
          margin.top + markerTopPaddingPx + markerHeadHeightPx,
          yAt(markerTargetY) - markerGapToPointPx
        );
        const markerTopY = Math.max(margin.top + markerTopPaddingPx, markerTipY - markerHeadHeightPx);
        const headHalfWidth = 4;
        return `
          <g class="historical-current-marker">
            <line x1="${markerX}" y1="${markerTopY}" x2="${markerX}" y2="${markerTipY - 5}" stroke-width="1.6"></line>
            <path d="M ${markerX - headHalfWidth} ${markerTipY - 5} L ${markerX + headHalfWidth} ${markerTipY - 5} L ${markerX} ${markerTipY} Z"></path>
          </g>
        `;
      })()
    : "";


  container.className = "historical-chart";
  const axisLines = `
      <line class="historical-axis" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}"></line>
      <line class="historical-axis" x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}"></line>
    `;
  replaceHistoricalChartContent(container, `
    <svg class="historical-svg" width="${width}" height="${height}" role="img" aria-label="Historical stacked supply chart">
      ${gridLines}
      ${axisLines}

      <path class="historical-area-base seg-never" d="${displayNeverPath}"></path>
      <path class="historical-area-base seg-inactive" d="${displayInactivePath}"></path>
      <path class="historical-area-base seg-active" d="${displayActivePath}"></path>
      ${displayNonExposedPath ? `<path class="historical-area-base seg-nonexposed" d="${displayNonExposedPath}"></path>` : ""}

      <path class="historical-area-overlay seg-never ${pointsWithIndex.some((point) => point.spendHighlighted.never_spent) ? "" : "is-faded"}" d="${neverOverlayPath}"></path>
      <path class="historical-area-overlay seg-inactive ${pointsWithIndex.some((point) => point.spendHighlighted.inactive) ? "" : "is-faded"}" d="${inactiveOverlayPath}"></path>
      <path class="historical-area-overlay seg-active ${pointsWithIndex.some((point) => point.spendHighlighted.active) ? "" : "is-faded"}" d="${activeOverlayPath}"></path>

      ${currentMarker}

      <line id="historicalHoverLine" class="historical-hover-line" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" visibility="hidden"></line>
      <circle id="historicalHoverDot" class="historical-hover-dot" cx="${margin.left}" cy="${margin.top + plotHeight}" r="4" visibility="hidden"></circle>
      <rect id="historicalHoverTarget" x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}" fill="transparent"></rect>

      ${xTickLabels}
    </svg>
    <div id="historicalHoverTooltip" class="historical-hover-tooltip" style="display:none;"></div>
  `);
  if (isRenderingProgressively && state.historicalSeriesGe1Loading) {
    showHistoricalLoadingOverlay(container, loadingOverlayMessage);
  } else {
    clearHistoricalLoadingOverlay(container);
  }

  const svg = container.querySelector(".historical-svg");
  const hoverTarget = container.querySelector("#historicalHoverTarget");
  const hoverLine = container.querySelector("#historicalHoverLine");
  const hoverDot = container.querySelector("#historicalHoverDot");
  const tooltip = container.querySelector("#historicalHoverTooltip");
  const mobileUi = isMobileUiViewport();
  let selectingSnapshotFromChart = false;
  let pendingMobileSelectionSnapshot = null;
  let pendingMobileSelectionTimerId = null;

  const clearPendingMobileSelection = () => {
    if (pendingMobileSelectionTimerId !== null) {
      window.clearTimeout(pendingMobileSelectionTimerId);
      pendingMobileSelectionTimerId = null;
    }
    pendingMobileSelectionSnapshot = null;
  };

  const armPendingMobileSelection = (snapshot) => {
    clearPendingMobileSelection();
    pendingMobileSelectionSnapshot = snapshot;
    pendingMobileSelectionTimerId = window.setTimeout(() => {
      pendingMobileSelectionSnapshot = null;
      pendingMobileSelectionTimerId = null;
    }, 2500);
  };

  const nearestPointForEvent = (event) => {
    const rect = svg.getBoundingClientRect();
    const xInSvg = ((event.clientX - rect.left) / rect.width) * width;

    let nearest = pointsWithIndex[0];
    let bestDist = Math.abs(xInSvg - nearest.x);
    for (let i = 1; i < pointsWithIndex.length; i += 1) {
      const dist = Math.abs(xInSvg - pointsWithIndex[i].x);
      if (dist < bestDist) {
        nearest = pointsWithIndex[i];
        bestDist = dist;
      }
    }

    return nearest;
  };

  const showHoverForEvent = (event) => {
    const nearest = nearestPointForEvent(event);

    hoverLine.setAttribute("x1", String(nearest.x));
    hoverLine.setAttribute("x2", String(nearest.x));
    hoverLine.setAttribute("visibility", "visible");

    hoverDot.setAttribute("cx", String(nearest.x));
    hoverDot.setAttribute("cy", String(yAt(showFilteredOnly ? nearest.activeFilteredTop : (showNonExposed ? nearest.totalTop : nearest.activeTop))));
    hoverDot.setAttribute("visibility", "visible");

    const neverBtc = Math.round(nearest.filteredNever / SATS_PER_BTC);
    const inactiveBtc = Math.round(nearest.filteredInactive / SATS_PER_BTC);
    const activeBtc = Math.round(nearest.filteredActive / SATS_PER_BTC);
    const nonExposedBtc = Math.round(nearest.fullNonExposed / SATS_PER_BTC);
    const totalSupplyBtc = Math.round(nearest.totalSupplySats / SATS_PER_BTC);
    const neverPct = formatPercent(nearest.filteredNever, nearest.totalSupplySats);
    const inactivePct = formatPercent(nearest.filteredInactive, nearest.totalSupplySats);
    const activePct = formatPercent(nearest.filteredActive, nearest.totalSupplySats);

    const nonExposedRow = showNonExposed && nonExposedBtc > 0
      ? `<div class="historical-tooltip-row historical-tooltip-nonexposed"><span class="historical-tooltip-label">Non-exposed:</span> <span class="historical-tooltip-value historical-tooltip-value-nonexposed">${formatInt(nonExposedBtc)} BTC</span></div>`
      : "";
    const activeRow = activeBtc > 0
      ? `<div class="historical-tooltip-row historical-tooltip-active"><span class="historical-tooltip-label">Active:</span> <span class="historical-tooltip-value historical-tooltip-value-active">${formatInt(activeBtc)} BTC &middot; ${activePct}</span></div>`
      : "";
    const inactiveRow = inactiveBtc > 0
      ? `<div class="historical-tooltip-row historical-tooltip-inactive"><span class="historical-tooltip-label">Inactive:</span> <span class="historical-tooltip-value historical-tooltip-value-inactive">${formatInt(inactiveBtc)} BTC &middot; ${inactivePct}</span></div>`
      : "";
    const neverRow = neverBtc > 0
      ? `<div class="historical-tooltip-row historical-tooltip-never"><span class="historical-tooltip-label">Never Spent:</span> <span class="historical-tooltip-value historical-tooltip-value-never">${formatInt(neverBtc)} BTC &middot; ${neverPct}</span></div>`
      : "";

    tooltip.style.display = "block";
    tooltip.innerHTML = `
      <div><strong>Block Height: ${formatInt(nearest.snapshotHeight)}</strong></div>
      <div class="historical-tooltip-row historical-tooltip-total">Total Supply: ${formatInt(totalSupplyBtc)} BTC</div>
      ${nonExposedRow}${activeRow}${inactiveRow}${neverRow}
    `;

    const containerRect = container.getBoundingClientRect();
    let left = event.clientX - containerRect.left + 12;
    let top = event.clientY - containerRect.top - 12;
    const maxLeft = container.clientWidth - tooltip.offsetWidth - 8;
    const maxTop = container.clientHeight - tooltip.offsetHeight - 8;
    left = Math.max(8, Math.min(left, maxLeft));
    top = Math.max(8, Math.min(top, maxTop));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    return nearest;
  };

  const selectSnapshotFromPoint = async (nearest) => {
    const nextSnapshot = String(nearest?.snapshotHeight || "").trim();
    const currentSnapshot = String(state.snapshotHeight || "").trim();
    if (!nextSnapshot || nextSnapshot === currentSnapshot || selectingSnapshotFromChart) {
      return;
    }

    const snapshotFilter = document.getElementById("snapshotFilter");
    if (snapshotFilter) {
      const hasOption = Array.from(snapshotFilter.options).some((option) => option.value === nextSnapshot);
      if (hasOption) {
        snapshotFilter.value = nextSnapshot;
      }
    }

    selectingSnapshotFromChart = true;
    try {
      await loadSnapshotData(nextSnapshot);
    } catch (err) {
      console.error(err);
    } finally {
      selectingSnapshotFromChart = false;
    }
  };

  hoverTarget.addEventListener("mousemove", showHoverForEvent);
  hoverTarget.addEventListener("mouseenter", showHoverForEvent);
  hoverTarget.addEventListener("click", async (event) => {
    const nearest = showHoverForEvent(event);
    if (!nearest) return;

    const nextSnapshot = String(nearest.snapshotHeight || "").trim();
    if (mobileUi) {
      if (!nextSnapshot || nextSnapshot !== pendingMobileSelectionSnapshot) {
        armPendingMobileSelection(nextSnapshot);
        return;
      }
      clearPendingMobileSelection();
    }

    await selectSnapshotFromPoint(nearest);
  });

  hoverTarget.addEventListener("dblclick", async (event) => {
    if (!mobileUi) return;
    const nearest = showHoverForEvent(event);
    clearPendingMobileSelection();
    await selectSnapshotFromPoint(nearest);
  });
  hoverTarget.addEventListener("mouseleave", () => {
    clearPendingMobileSelection();
    hoverLine.setAttribute("visibility", "hidden");
    hoverDot.setAttribute("visibility", "hidden");
    tooltip.style.display = "none";
  });
}

function updateScriptPanelModeUi() {
  const title = document.getElementById("scriptPanelTitle");
  const toggle = document.getElementById("scriptPanelModeToggle");
  const supplyModeSelect = document.getElementById("scriptPanelSupplyMode");
  const legendLine1 = document.getElementById("scriptPanelLegendLine1");
  const legendLine2 = document.getElementById("scriptPanelLegendLine2");
  const nonExposedLegend = document.querySelector(".non-exposed-legend");
  if (!title || !toggle) return;
  const { mode, showNonExposed, showFilteredOnly } = getSupplyDisplayFlags();

  state.supplyDisplayMode = mode;
  if (supplyModeSelect) {
    supplyModeSelect.value = mode;
  }

  if (state.scriptPanelMode === "historical") {
    title.textContent = "Historical Stacked Supply";
    toggle.dataset.mode = "historical";
    toggle.setAttribute("aria-pressed", "true");
    setCustomTooltip(toggle, "Switch to script type supply bars");
    if (legendLine1) legendLine1.textContent = "X-axis = block height";
    if (legendLine2) {
      if (showFilteredOnly) {
        legendLine2.textContent = "Y-axis = BTC, stack = filtered spend activity amounts";
      } else {
        legendLine2.textContent = showNonExposed
          ? "Y-axis = BTC, top of stack = total supply"
          : "Y-axis = BTC, top of stack = exposed supply";
      }
    }
  } else {
    title.textContent = "Script Type Supply Bars";
    toggle.dataset.mode = "bars";
    toggle.setAttribute("aria-pressed", "false");
    setCustomTooltip(toggle, "Switch to historical stacked chart");
    if (legendLine1) legendLine1.textContent = "";
    if (legendLine2) {
      if (showFilteredOnly) {
        legendLine2.textContent = "Bar width = relative filtered supply size";
      } else {
        legendLine2.textContent = showNonExposed
          ? "Bar width = relative total supply size"
          : "Bar width = relative exposed supply size";
      }
    }
  }

  if (nonExposedLegend) {
    nonExposedLegend.style.display = showNonExposed ? "" : "none";
  }
}

function updateTopExposuresFiltersUi() {
  const panel = document.querySelector(".top-exposures-panel");
  const toggle = document.getElementById("topExposuresFiltersToggle");
  if (!panel || !toggle) return;

  const isCollapsed = state.topExposuresFiltersCollapsed;
  panel.classList.toggle("is-collapsed", isCollapsed);
  toggle.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
  setCustomTooltip(toggle, isCollapsed ? "Show top exposure filters" : "Collapse top exposure filters");
}

function updateScriptPanelDetailsUi() {
  const panel = document.getElementById("scriptPanel");
  const toggle = document.getElementById("scriptPanelDetailsToggle");
  if (!panel || !toggle) return;

  const isCollapsed = !!state.scriptPanelDetailsCollapsed;
  panel.classList.toggle("is-details-collapsed", isCollapsed);
  toggle.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
  setCustomTooltip(toggle, isCollapsed ? "Show chart legend and controls" : "Collapse chart legend and controls");
}

function captureFilterSnapshot() {
  const balanceFilter = document.getElementById("balanceFilter");
  const snapshotFilter = document.getElementById("snapshotFilter");
  const supplyModeSelect = document.getElementById("scriptPanelSupplyMode");
  const topExposureAddressSearch = document.getElementById("topExposureAddressSearch");
  const detailCheckedValues = getDetailCheckboxes().filter((el) => el.checked).map((el) => el.value);
  const identityGroupCheckedValues = getIdentityGroupCheckboxes().filter((el) => el.checked).map((el) => el.value);
  const identityCheckedValues = getIdentityCheckboxes().filter((el) => el.checked).map((el) => el.value);
  return {
    balanceFilterValue: balanceFilter ? balanceFilter.value : "all",
    snapshotFilterValue: snapshotFilter ? snapshotFilter.value : String(state.snapshotHeight || ""),
    supplyModeValue: supplyModeSelect ? supplyModeSelect.value : state.supplyDisplayMode,
    topExposureAddressSearchValue: topExposureAddressSearch ? topExposureAddressSearch.value : state.topExposureAddressQuery,
    scriptCheckedValues: getCheckedScriptValues(),
    spendCheckedValues: getCheckedSpendValues(),
    selectedDetailTags: state.selectedDetailTags.slice(),
    selectedIdentityGroups: state.selectedIdentityGroups.slice(),
    selectedIdentityTags: state.selectedIdentityTags.slice(),
    detailCheckedValues,
    identityGroupCheckedValues,
    identityCheckedValues,
    topExposureAddressQuery: state.topExposureAddressQuery,
    identityTagFilterQuery: state.identityTagFilterQuery,
    supplyDisplayMode: state.supplyDisplayMode,
    topExposuresFiltersCollapsed: state.topExposuresFiltersCollapsed,
    scriptPanelDetailsCollapsed: state.scriptPanelDetailsCollapsed,
    balanceAutoForcedFromAllByTopFilters: state.balanceAutoForcedFromAllByTopFilters,
    topExposuresVisibleCount: state.topExposuresVisibleCount,
    snapshotHeight: state.snapshotHeight,
    scriptPanelMode: state.scriptPanelMode,
  };
}

async function applyFilterSnapshot(snapshot) {
  const balanceFilter = document.getElementById("balanceFilter");
  const snapshotFilter = document.getElementById("snapshotFilter");
  const supplyModeSelect = document.getElementById("scriptPanelSupplyMode");
  const topExposureAddressSearch = document.getElementById("topExposureAddressSearch");

  if (balanceFilter) balanceFilter.value = snapshot.balanceFilterValue;
  if (supplyModeSelect) supplyModeSelect.value = snapshot.supplyModeValue;
  if (topExposureAddressSearch) topExposureAddressSearch.value = snapshot.topExposureAddressSearchValue;

  getScriptCheckboxes().forEach((el) => { el.checked = snapshot.scriptCheckedValues.includes(el.value); });
  getSpendCheckboxes().forEach((el) => { el.checked = snapshot.spendCheckedValues.includes(el.value); });

  state.selectedDetailTags = Array.isArray(snapshot.detailCheckedValues) && snapshot.detailCheckedValues.length
    ? snapshot.detailCheckedValues.slice()
    : snapshot.selectedDetailTags.slice();
  state.selectedIdentityGroups = Array.isArray(snapshot.identityGroupCheckedValues) && snapshot.identityGroupCheckedValues.length
    ? snapshot.identityGroupCheckedValues.slice()
    : snapshot.selectedIdentityGroups.slice();
  state.selectedIdentityTags = Array.isArray(snapshot.identityCheckedValues) && snapshot.identityCheckedValues.length
    ? snapshot.identityCheckedValues.slice()
    : snapshot.selectedIdentityTags.slice();
  state.topExposureAddressQuery = snapshot.topExposureAddressQuery;
  state.identityTagFilterQuery = snapshot.identityTagFilterQuery;
  state.supplyDisplayMode = snapshot.supplyDisplayMode;
  state.topExposuresFiltersCollapsed = snapshot.topExposuresFiltersCollapsed;
  state.scriptPanelDetailsCollapsed = snapshot.scriptPanelDetailsCollapsed;
  state.balanceAutoForcedFromAllByTopFilters = snapshot.balanceAutoForcedFromAllByTopFilters;
  state.topExposuresVisibleCount = snapshot.topExposuresVisibleCount;
  if (snapshot.scriptPanelMode === "historical" || snapshot.scriptPanelMode === "bars") {
    state.scriptPanelMode = snapshot.scriptPanelMode;
  }

  updateScriptTriggerLabel();
  updateSpendTriggerLabel();
  renderTopExposureTagFilters();
  updateScriptPanelModeUi();
  updateTopExposuresFiltersUi();
  updateScriptPanelDetailsUi();
  clearIdentityTagFilterInput();

  const targetSnapshot = String(snapshot.snapshotFilterValue || snapshot.snapshotHeight || "").trim();
  const currentSnapshot = String(state.snapshotHeight || snapshotFilter?.value || "").trim();

  if (targetSnapshot && targetSnapshot !== currentSnapshot) {
    await loadSnapshotData(targetSnapshot);
    return;
  }

  resetTopExposurePagination();
  update();
}

function isDefaultFilterState() {
  const balanceFilter = document.getElementById("balanceFilter");
  const snapshotFilter = document.getElementById("snapshotFilter");
  const supplyModeSelect = document.getElementById("scriptPanelSupplyMode");
  const topExposureAddressSearch = document.getElementById("topExposureAddressSearch");

  if (balanceFilter && balanceFilter.value !== "all") return false;
  if (supplyModeSelect && supplyModeSelect.value !== "total") return false;
  if (topExposureAddressSearch && topExposureAddressSearch.value.trim() !== "") return false;

  const scriptChecked = getCheckedScriptValues();
  if (!scriptChecked.includes("All")) return false;

  const spendChecked = getCheckedSpendValues();
  if (!spendChecked.includes("all")) return false;

  const arraysEqualAll = (arr) => arr.length === 1 && arr[0] === "All";
  if (!arraysEqualAll(state.selectedDetailTags)) return false;
  if (!arraysEqualAll(state.selectedIdentityGroups)) return false;
  if (!arraysEqualAll(state.selectedIdentityTags)) return false;

  const defaultSnapshot = state.availableSnapshots.length ? String(state.availableSnapshots[0]) : null;
  const currentSnapshot = String(snapshotFilter?.value || state.snapshotHeight || "").trim();
  if (defaultSnapshot && currentSnapshot && currentSnapshot !== defaultSnapshot) return false;
  if (state.scriptPanelMode !== "bars") return false;
  if (state.topExposuresFiltersCollapsed) return false;
  if (state.scriptPanelDetailsCollapsed) return false;

  return true;
}

function updateResetButtonUi() {
  const btn = document.getElementById("resetDashboard");
  if (!btn) return;
  const labelEl = btn.querySelector(".btn-label");
  if (state.preResetStateSnapshot) {
    setButtonIcon("resetDashboardIcon", ICONS.resetUndo);
    if (labelEl) {
      labelEl.textContent = "Undo Restore";
    } else {
      btn.textContent = "Undo Restore";
    }
    btn.classList.add("reset-dashboard-btn--undo");
    btn.setAttribute("aria-label", "Undo the last restore defaults action");
    setCustomTooltip(btn, "Undo the last restore defaults action");
    btn.disabled = false;
  } else {
    setButtonIcon("resetDashboardIcon", ICONS.resetDefaults);
    if (labelEl) {
      labelEl.textContent = "Restore Defaults";
    } else {
      btn.textContent = "Restore Defaults";
    }
    btn.classList.remove("reset-dashboard-btn--undo");
    btn.setAttribute("aria-label", "Restore dashboard defaults");
    setCustomTooltip(btn, "Reset dashboard to defaults");
    btn.disabled = isDefaultFilterState();
  }
}

function clearPreResetSnapshot() {
  if (!state.preResetStateSnapshot) return;
  state.preResetStateSnapshot = null;
  updateResetButtonUi();
}

async function resetDashboardToDefaults() {
  state.preResetStateSnapshot = captureFilterSnapshot();

  const balanceFilter = document.getElementById("balanceFilter");
  const snapshotFilter = document.getElementById("snapshotFilter");
  const supplyModeSelect = document.getElementById("scriptPanelSupplyMode");
  const topExposureAddressSearch = document.getElementById("topExposureAddressSearch");

  if (balanceFilter) {
    balanceFilter.value = "all";
  }
  setAllScriptChecks(true);
  setAllSpendChecks(true);

  state.selectedDetailTags = ["All"];
  state.selectedIdentityGroups = ["All"];
  state.selectedIdentityTags = ["All"];
  state.topExposureAddressQuery = "";
  state.identityTagFilterQuery = "";
  state.supplyDisplayMode = "total";
  state.scriptPanelMode = "bars";
  state.topExposuresFiltersCollapsed = false;
  state.scriptPanelDetailsCollapsed = false;
  state.balanceAutoForcedFromAllByTopFilters = false;
  state.topExposuresVisibleCount = TOP_EXPOSURES_PAGE_SIZE;
  state.topExposuresLoading = false;
  state.pendingPersistedSnapshotPreference = null;
  state.pendingPersistedSnapshotHeight = null;

  if (supplyModeSelect) {
    supplyModeSelect.value = "total";
  }
  if (topExposureAddressSearch) {
    topExposureAddressSearch.value = "";
  }

  updateScriptTriggerLabel();
  updateSpendTriggerLabel();
  renderTopExposureTagFilters();
  updateScriptPanelModeUi();
  updateTopExposuresFiltersUi();
  updateScriptPanelDetailsUi();

  try {
    window.localStorage.removeItem(FILTERS_STORAGE_KEY);
  } catch (err) {
    console.warn("Could not clear stored filter preferences", err);
  }

  const defaultSnapshot = String(snapshotFilter?.options?.[0]?.value || state.availableSnapshots[0] || "").trim();
  const currentSnapshot = String(state.snapshotHeight || snapshotFilter?.value || "").trim();

  if (defaultSnapshot && defaultSnapshot !== currentSnapshot) {
    updateResetButtonUi();
    await loadSnapshotData(defaultSnapshot);
    return;
  }

  resetTopExposurePagination();
  updateResetButtonUi();
  update();
}

function resetAllFilters() {
  // Clear tag-based filters to show the initial lite-mode subset unfiltered.
  state.selectedDetailTags = ["All"];
  state.selectedIdentityGroups = ["All"];
  state.selectedIdentityTags = ["All"];
  state.topExposureAddressQuery = "";
  state.pendingIdentityTagExclusions = null;
  
  // Reset UI elements
  const topExposureAddressSearch = document.getElementById("topExposureAddressSearch");
  if (topExposureAddressSearch) {
    topExposureAddressSearch.value = "";
  }
  
  // Re-render filters and data
  renderTopExposureTagFilters();
  resetTopExposurePagination();
  update();
}

function normalizedFilterValuesForCache(values) {
  return Array.isArray(values) ? [...values].sort().join("|") : "";
}

function topExposuresCacheKey(filters) {
  const snapshotKey = String(state.snapshotHeight || "").trim();
  return [
    snapshotKey,
    filters.balance,
    normalizedFilterValuesForCache(filters.scriptTypes),
    normalizedFilterValuesForCache(filters.spendActivities),
    normalizedFilterValuesForCache(filters.detailTags),
    normalizedFilterValuesForCache(filters.identityGroups),
    normalizedFilterValuesForCache(filters.identityTags),
    String(filters.topExposureAddressQuery || "").trim().toLowerCase(),
    state.identityGroupsLoaded ? "groups:loaded" : "groups:not_loaded",
  ].join("||");
}

function buildTopExposuresData(filters) {
  if (!state.ge1Rows.length) {
    return [];
  }

  const cacheKey = topExposuresCacheKey(filters);
  const cachedRows = state.topExposuresDataCache.get(cacheKey);
  if (cachedRows) {
    return cachedRows;
  }

  const minSats = balanceMinSats(filters.balance);
  const scriptPassAll = filters.scriptTypes.includes("All");
  const spendPassAll = filters.spendActivities.includes("all");
  const addressQuery = String(filters.topExposureAddressQuery || "").trim().toLowerCase();

  const rows = state.ge1Rows
    .filter((row) => getRowExposedSupplySats(row) >= minSats)
    .filter((row) => {
      if (scriptPassAll) return true;
      const types = getRowScriptTypes(row);
      return types.some((t) => filters.scriptTypes.includes(t));
    })
    .filter((row) => spendPassAll || filters.spendActivities.includes(row.spend_activity))
    .filter((row) => {
      return detailTagPassesFilters(filters.detailTags, row.details || "");
    })
    .filter((row) => {
      return identityBelongsToSelectedGroups(row.identity || "", filters.identityGroups);
    })
    .filter((row) => {
      return identityTagPassesFilters(filters.identityTags, row.identity || "");
    })
    .filter((row) => {
      if (!addressQuery) return true;
      const displayIds = String(row.display_group_ids || row.display_group_id || "").toLowerCase();
      return displayIds.includes(addressQuery);
    })
    .map((row) => {
      const scriptTypes = getRowScriptTypes(row);
      const filteredExposedSupplySats = getFilteredExposedSupplySatsForRow(row, filters.scriptTypes);
      const primaryGroupId = getRowPrimaryGroupId(row);
      const displayGroupIds = filterAndOrderDisplayGroupIds(
        getRowDisplayGroupIds(row),
        scriptTypes,
        primaryGroupId
      );

      return {
        groupId: primaryGroupId,
        displayGroupIds,
        exposedSupplySats: getRowExposedSupplySats(row),
        filteredExposedSupplySats,
        exposedUtxoCount: toInt(row.exposed_utxo_count),
        firstExposedBlockheight: toInt(row.first_exposed_blockheight),
        lastSpendBlockheight: toInt(row.last_spend_blockheight),
        firstExposedUnixTime: toInt(row.first_exposed_unix_time) || 0,
        lastSpendUnixTime: toInt(row.last_spend_unix_time) || 0,
        scriptTypes,
        spendActivity: row.spend_activity,
        detail: row.details || "",
        identity: row.identity || "",
      };
    })
    .sort((left, right) => {
      const leftValue = scriptPassAll ? left.exposedSupplySats : left.filteredExposedSupplySats;
      const rightValue = scriptPassAll ? right.exposedSupplySats : right.filteredExposedSupplySats;
      return rightValue - leftValue;
    });

  if (state.topExposuresDataCache.size >= 120) {
    state.topExposuresDataCache.clear();
  }
  state.topExposuresDataCache.set(cacheKey, rows);
  return rows;
}

function isTagFilterActive(filters) {
  return (
    !filters.detailTags.includes("All") ||
    !filters.identityGroups.includes("All") ||
    !filters.identityTags.includes("All")
  );
}

function rowPassesTopExposureFilters(row, filters, includeTagFilters = true) {
  const minSats = balanceMinSats(filters.balance);
  if (getRowExposedSupplySats(row) < minSats) return false;

  if (!filters.scriptTypes.includes("All")) {
    const types = getRowScriptTypes(row);
    if (!types.some((t) => filters.scriptTypes.includes(t))) return false;
  }

  if (!filters.spendActivities.includes("all") && !filters.spendActivities.includes(row.spend_activity)) {
    return false;
  }

  if (!includeTagFilters) return true;

  if (!detailTagPassesFilters(filters.detailTags, row.details || "")) {
    return false;
  }

  if (!identityBelongsToSelectedGroups(row.identity || "", filters.identityGroups)) {
    return false;
  }

  if (!identityTagPassesFilters(filters.identityTags, row.identity || "")) {
    return false;
  }

  return true;
}

function rowPassesBalanceFilter(row, balanceKey) {
  const minSats = balanceMinSats(balanceKey);
  return getRowExposedSupplySats(row) >= minSats;
}

function getFilteredExposedSupplySatsForRow(row, selectedScriptTypes) {
  const totalExposedSupply = getRowExposedSupplySats(row);
  if (!totalExposedSupply) return 0;

  const rowScriptTypes = getRowScriptTypes(row);
  const uniqueRowScriptTypes = Array.from(new Set(rowScriptTypes));
  const targets = uniqueRowScriptTypes.length ? uniqueRowScriptTypes : ["Other"];

  if (selectedScriptTypes.includes("All")) {
    return totalExposedSupply;
  }

  const selectedSet = new Set(selectedScriptTypes);
  const supplyByScriptType = getRowSupplyByScriptType(row);

  let filteredSupply = 0;
  targets.forEach((scriptType) => {
    if (!selectedSet.has(scriptType)) return;
    const value = supplyByScriptType[scriptType] !== undefined
      ? toInt(supplyByScriptType[scriptType])
      : totalExposedSupply / targets.length;
    filteredSupply += value;
  });

  return filteredSupply;
}

function migrationWeightForScriptType(scriptType) {
  switch (scriptType) {
    case "P2PK":
      return 111;
    case "P2PKH":
      return 192;
    case "P2SH":
      return 176;
    case "P2WPKH":
      return 112;
    case "P2WSH":
      return 149;
    case "P2TR":
      return 103;
    default:
      return 176;
  }
}

function estimateMigrationBlocksFromRow(row) {
  const utxoCount = toInt(row.exposed_utxo_count);
  if (!utxoCount) return 0;

  const scriptTypes = getRowScriptTypes(row);
  const weights = scriptTypes.length ? scriptTypes.map((st) => migrationWeightForScriptType(st)) : [176];
  const avgWeight = weights.reduce((sum, w) => sum + w, 0) / weights.length;
  return (utxoCount * avgWeight * 4) / 4_000_000;
}

function getDetailTagThresholdPubkeyCount(detailValue) {
  const detailTag = formatDetailTag(detailValue || "");
  const multisigMatch = detailTag.match(/^Multisig\s+(\d+)\s+of\s+(\d+)$/i);
  if (!multisigMatch) return 1;

  const thresholdPubkeys = Number(multisigMatch[2]);
  if (!Number.isFinite(thresholdPubkeys) || thresholdPubkeys <= 0) return 1;
  return Math.max(1, Math.floor(thresholdPubkeys));
}

function aggregateKpisFromGe1(filters, includeTagFilters) {
  const acc = {
    supply_sats: 0,
    exposed_pubkey_count: 0,
    exposed_utxo_count: 0,
    exposed_supply_sats: 0,
    estimated_migration_blocks: 0,
  };
  const exposedPubkeyGroupIds = new Set();
  const detailFilterActive =
    Array.isArray(filters.detailTags) && filters.detailTags.length > 0 && !filters.detailTags.includes("All");
  const useThresholdPubkeyCounting = !isLiteMode() && includeTagFilters && detailFilterActive;

  state.ge1Rows.forEach((row) => {
    if (!rowPassesTopExposureFilters(row, filters, includeTagFilters)) return;

    const exposedSupply = getFilteredExposedSupplySatsForRow(row, filters.scriptTypes);
    if (!exposedSupply) return;
    const totalExposedUtxos = toInt(row.exposed_utxo_count);
    acc.supply_sats += exposedSupply;
    acc.exposed_supply_sats += exposedSupply;
    acc.exposed_utxo_count += totalExposedUtxos;
    if (useThresholdPubkeyCounting) {
      // For exposure-pattern filtering, approximate exposed pubkeys by threshold size per row.
      acc.exposed_pubkey_count += getDetailTagThresholdPubkeyCount(row.details);
    } else {
      const rowPrimaryId = getRowPrimaryGroupId(row);
      if (rowPrimaryId) {
        exposedPubkeyGroupIds.add(rowPrimaryId);
      }
    }
    acc.estimated_migration_blocks += estimateMigrationBlocksFromRow(row);
  });

  if (!useThresholdPubkeyCounting) {
    acc.exposed_pubkey_count = exposedPubkeyGroupIds.size;
  }

  return acc;
}

function mempoolAddressUrl(groupId) {
  if (!groupId) return null;
  if (groupId.startsWith("out:") || groupId.startsWith("stxo:")) return null;
  if (/^[0-9a-f]{40}$/i.test(groupId)) return null;
  if (groupId.startsWith("sha256:")) {
    const reversed = groupId.slice(7).match(/../g).reverse().join("");
    return `https://mempool.space/scripthash/${reversed}`;
  }
  return `https://mempool.space/address/${encodeURIComponent(groupId)}`;
}

function formatGroupId(id) {
  if (!id) return id;

  const value = id.startsWith("sha256:") ? id.slice(7) : id;
  return value;
}

function isHexPubkeyId(id) {
  return /^[0-9a-f]{66}$/i.test(id) || /^[0-9a-f]{130}$/i.test(id);
}

function isP2pkhAddress(id) {
  return /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(id);
}

function isP2shAddress(id) {
  return /^3[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(id);
}

function isBech32P2wAddress(id) {
  return /^bc1q[ac-hj-np-z02-9]{11,90}$/i.test(id);
}

function isBech32TaprootAddress(id) {
  return /^bc1p[ac-hj-np-z02-9]{11,90}$/i.test(id);
}

function filterAndOrderDisplayGroupIds(displayGroupIds, scriptTypes, fallbackGroupId) {
  const scriptSet = new Set((scriptTypes || []).map((s) => (s || "").trim()).filter(Boolean));
  const uniqueIds = Array.from(new Set((displayGroupIds || []).map((id) => (id || "").trim()).filter(Boolean)));

  let filtered = uniqueIds.filter((id) => {
    if (isHexPubkeyId(id)) return scriptSet.has("P2PK");
    if (isP2pkhAddress(id)) return scriptSet.has("P2PKH");
    if (isP2shAddress(id)) return scriptSet.has("P2SH");
    if (isBech32TaprootAddress(id)) return scriptSet.has("P2TR");
    if (isBech32P2wAddress(id)) return scriptSet.has("P2WPKH") || scriptSet.has("P2WSH");
    return true;
  });

  if (!filtered.length) filtered = uniqueIds;
  if (!filtered.length && fallbackGroupId) filtered = [fallbackGroupId];

  const rankId = (id) => {
    if (scriptSet.has("P2PK") && isHexPubkeyId(id)) return 0;
    if (scriptSet.has("P2PKH") && isP2pkhAddress(id)) return 1;
    if (scriptSet.has("P2WPKH") && isBech32P2wAddress(id)) return 2;
    if (scriptSet.has("P2WSH") && isBech32P2wAddress(id)) return 3;
    if (scriptSet.has("P2TR") && isBech32TaprootAddress(id)) return 4;
    if (scriptSet.has("P2SH") && isP2shAddress(id)) return 5;
    return 10;
  };

  return filtered.sort((a, b) => {
    const rankDiff = rankId(a) - rankId(b);
    if (rankDiff !== 0) return rankDiff;
    return a.localeCompare(b);
  });
}

function buildMiddleEllipsis(text, keptChars) {
  if (keptChars >= text.length) return text;
  if (keptChars <= 0) return "...";

  const head = Math.ceil(keptChars / 2);
  const tail = Math.floor(keptChars / 2);
  return `${text.slice(0, head)}...${text.slice(text.length - tail)}`;
}

function applyConditionalMiddleEllipsis(container) {
  if (!container) return;

  const links = container.querySelectorAll(".group-link[data-full-label]");
  links.forEach((linkEl) => {
    const fullLabel = linkEl.getAttribute("data-full-label") || "";
    linkEl.textContent = fullLabel;

    // Only truncate when the full label would overflow the single-line container.
    if (!fullLabel || linkEl.clientWidth <= 0 || linkEl.scrollWidth <= linkEl.clientWidth) {
      return;
    }

    let low = 0;
    let high = Math.max(fullLabel.length - 1, 0);
    let bestFit = "...";

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = buildMiddleEllipsis(fullLabel, mid);
      linkEl.textContent = candidate;

      if (linkEl.scrollWidth <= linkEl.clientWidth) {
        bestFit = candidate;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    linkEl.textContent = bestFit;
  });
}

function normalizeTagValue(value) {
  const text = (value || "").trim();
  if (!text) return "";
  if (text.toLowerCase() === "none") return "";
  return text;
}

function formatDetailTag(detail) {
  const value = normalizeTagValue(detail);
  if (!value) return "";

  const multisigMatch = value.match(/^(\d+-of-\d+)\s+multisig$/i);
  if (multisigMatch) {
    const [m, n] = multisigMatch[1].split("-of-");
    return `Multisig ${m} of ${n}`;
  }
  return value;
}

function formatIdentityTag(identity) {
  const value = normalizeTagValue(identity);
  if (!value) return "";
  if (/^\d+$/.test(value)) return "";
  if (value.toLowerCase() === "unidentified") return "";
  return value
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\bManagement\b/gi, "Mgmt")
    .trim();
}

function detailTagPassesFilters(selectedDetailTags, detailValue) {
  if (selectedDetailTags.includes("All")) return true;

  const detailTag = formatDetailTag(detailValue || "");
  if (!detailTag) {
    return selectedDetailTags.includes(UNLABELED_DETAIL_FILTER_VALUE);
  }

  return selectedDetailTags.includes(detailTag);
}

function identityTagPassesFilters(selectedIdentityTags, identityValue) {
  if (selectedIdentityTags.includes("All")) return true;

  const identityTag = formatIdentityTag(identityValue || "");
  if (!identityTag) {
    return selectedIdentityTags.includes(UNIDENTIFIED_IDENTITY_FILTER_VALUE);
  }

  return selectedIdentityTags.includes(identityTag);
}

let _lastTopExposuresRows = null;
let _lastTopExposuresVisibleCount = 0;

function renderTopExposures(rows) {
  const container = document.getElementById("topExposuresList");
  if (isLiteMode()) {
    const latestSnapshot = latestSnapshotHeight();
    const currentSnapshot = String(state.snapshotHeight || "").trim();
    const isLatestSnapshot = !!latestSnapshot && latestSnapshot === currentSnapshot;
    if (!isLatestSnapshot) {
      state.topExposuresTotalCount = 0;
      state.topExposuresLoading = false;
      container.innerHTML =
        '<div class="bar-empty" style="padding: 12px;">Historical top exposures are disabled in ECO mode. Select the latest snapshot, or run locally in FULL mode for historical top exposures.</div>';
      return;
    }
  }

  const previousScrollTop = container.scrollTop;
  state.topExposuresTotalCount = rows.length;

  if (!rows.length) {
    _lastTopExposuresRows = null;
    _lastTopExposuresVisibleCount = 0;
    if (state.topExposuresLoading) {
      container.innerHTML = '<div class="bar-empty" style="padding: 12px;">Loading top exposure rows...</div>';
      return;
    }

    const filters = readFilters();
    const hasAddressQuery = Boolean(String(filters.topExposureAddressQuery || "").trim());

    if (isLiteMode() && state.ge1IsUsingEcoSubset && hasAddressQuery) {
      if (!state.ge1FullDataLoadTriggered && !state.topExposuresLoading) {
        triggerEcoFullDataLoadFromSearchFocus();
      }

      if (state.topExposuresLoading || state.ge1FullDataLoadTriggered) {
        container.innerHTML = `
          <div class="bar-empty" style="padding: 12px; display: flex; align-items: center; gap: 8px;">
            <span class="top-list-loading" aria-label="Loading full search results" role="status"></span>
            No matches in the ECO subset yet. Loading full top exposures and continuing search...
          </div>`;
        return;
      }
    }
    
    // In ECO mode using the top100 subset, provide helpful guidance if filters don't match.
    if (isLiteMode() && state.ge1IsUsingEcoSubset) {
      if (isTagFilterActive(filters)) {
        container.innerHTML = `<div class="bar-empty" style="padding: 12px;">
          No addresses match the current filters in the top 100 addresses. 
          <a href="javascript:void(0)" onclick="resetAllFilters(); return false;">Clear filters</a> to view top addresses.
        </div>`;
        state.topExposuresLoading = false;
        return;
      }
    }
    
    container.innerHTML = '<div class="bar-empty" style="padding: 12px;">No exposure rows for the current filter selection.</div>';
    state.topExposuresLoading = false;
    return;
  }

  const visibleCount = Math.min(state.topExposuresVisibleCount, rows.length);

  if (rows === _lastTopExposuresRows && visibleCount === _lastTopExposuresVisibleCount && !state.topExposuresLoading) {
    return;
  }
  _lastTopExposuresRows = rows;
  _lastTopExposuresVisibleCount = visibleCount;

  const visibleRows = rows.slice(0, visibleCount);

  const html = visibleRows.map((row) => {
    const spendTagClass = row.spendActivity === "never_spent"
      ? "tag-spend-never"
      : row.spendActivity === "inactive"
        ? "tag-spend-inactive"
        : "tag-spend-active";

    const addressLines = row.displayGroupIds.map((id) => {
      const addressUrl = mempoolAddressUrl(id);
      const displayLabel = formatGroupId(id);
      return addressUrl
        ? `<a class="group-link" data-full-label="${escapeHtmlAttr(displayLabel)}" href="${addressUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayLabel)}</a>`
        : `<span class="group-link" data-full-label="${escapeHtmlAttr(displayLabel)}">${escapeHtml(displayLabel)}</span>`;
    }).join("");

    const scriptTypeTags = row.scriptTypes
      .map((st) => `<span class="tag">${st}</span>`)
      .join("");
    const detailTag = formatDetailTag(row.detail);
    const identityTag = formatIdentityTag(row.identity || "");
    const utxoLabel = row.exposedUtxoCount === 1 ? "1 UTXO" : `${formatInt(row.exposedUtxoCount)} UTXOs`;
    const showFilteredBalance =
      row.filteredExposedSupplySats > 0 && row.filteredExposedSupplySats !== row.exposedSupplySats;

    const tooltipLines = [];
    if (row.firstExposedBlockheight >= 0) {
      const firstExposedDate = row.firstExposedUnixTime
        ? formatTooltipDate(row.firstExposedUnixTime)
        : formatTooltipDateFromHeight(row.firstExposedBlockheight);
      const firstExposedAge = formatRelativeAge(row.firstExposedUnixTime);
      tooltipLines.push(
        `First exposure:${firstExposedAge ? ` ${firstExposedAge}` : ""}\n${formatInt(row.firstExposedBlockheight)} · ${firstExposedDate}`
      );
    }
    if (row.lastSpendBlockheight > 0) {
      const lastSpendDate = row.lastSpendUnixTime
        ? formatTooltipDate(row.lastSpendUnixTime)
        : formatTooltipDateFromHeight(row.lastSpendBlockheight);
      const lastSpendAge = formatRelativeAge(row.lastSpendUnixTime);
      tooltipLines.push(
        `Last spend:${lastSpendAge ? ` ${lastSpendAge}` : ""}\n${formatInt(row.lastSpendBlockheight)} · ${lastSpendDate}`
      );
    }
    const spendTooltip = tooltipLines.join("\n");
    const spendTooltipAttr = spendTooltip ? ` data-tooltip="${escapeHtmlAttr(spendTooltip)}"` : "";

    return `
      <div class="top-item">
        <div class="top-head">
          <div class="top-addresses">${addressLines}</div>
          <span class="top-value">
            <span class="top-value-exposed ${showFilteredBalance ? "top-value-exposed-dimmed" : ""}">Exposed balance: ${formatSigFigsBtc(row.exposedSupplySats)} BTC${showFilteredBalance ? ";" : ""}</span>
            ${showFilteredBalance
              ? ` <span class="top-value-filtered">Filtered balance: ${formatSigFigsBtc(row.filteredExposedSupplySats)} BTC</span>`
              : ""}
          </span>
        </div>
        <div class="tag-row">
          ${scriptTypeTags}
          ${detailTag ? `<span class="tag">${detailTag}</span>` : ""}
          ${identityTag ? `<span class="tag">${identityTag}</span>` : ""}
          <span class="tag ${spendTagClass}"${spendTooltipAttr}>${formatSpendLabel(row.spendActivity)}</span>
          <span class="tag tag-utxo">${utxoLabel}</span>
        </div>
      </div>
    `;
  }).join("");

  // Also show a footer in ECO mode while showing the lightweight subset, indicating
  // that full data can be loaded by scrolling to the bottom of the list.
  const ecoExpandPending = isLiteMode() && state.ge1IsUsingEcoSubset && !state.ge1FullDataLoadTriggered;
  const footerHtml = visibleCount < rows.length || ecoExpandPending
    ? `<div id="topExposuresFooter" class="top-list-footer is-hidden">${
        state.topExposuresLoading
          ? '<span class="top-list-loading" aria-label="Loading full results" role="status"></span>'
          : '<span class="top-list-pull" aria-hidden="true"></span>'
      }</div>`
    : "";

  container.innerHTML = html + footerHtml;
  applyConditionalMiddleEllipsis(container);
  container.scrollTop = previousScrollTop;

  if (visibleCount < rows.length) {
    syncTopExposuresShowMoreVisibility();
  }
}

function resetTopExposurePagination() {
  state.topExposuresVisibleCount = TOP_EXPOSURES_PAGE_SIZE;
  state.topExposuresTotalCount = 0;
  state.topExposuresLoading = false;
  state.ge1FullDataLoadTriggered = false;
}

function syncTopExposuresShowMoreVisibility() {
  const container = document.getElementById("topExposuresList");
  const footer = document.getElementById("topExposuresFooter");
  if (!container || !footer) {
    return;
  }

  const remainingScroll = container.scrollHeight - container.scrollTop - container.clientHeight;
  const atBottom = remainingScroll <= TOP_EXPOSURES_BOTTOM_THRESHOLD_PX;
  const ecoExpandPending = isLiteMode() && state.ge1IsUsingEcoSubset && !state.ge1FullDataLoadTriggered;
  footer.classList.toggle("is-hidden", !atBottom && !state.topExposuresLoading && !ecoExpandPending);
}

function tryLoadMoreTopExposures() {
  if (state.topExposuresLoading) {
    return;
  }

  const container = document.getElementById("topExposuresList");
  if (!container) {
    return;
  }

  const remainingScroll = container.scrollHeight - container.scrollTop - container.clientHeight;
  const atBottom = remainingScroll <= TOP_EXPOSURES_BOTTOM_THRESHOLD_PX;

  // ECO mode: first reveal rows 51-100 from the lightweight subset, then start
  // the full ge1 CSV + large lookup CSV load in the background.
  if (isLiteMode() && state.ge1IsUsingEcoSubset && !state.ge1FullDataLoadTriggered) {
    if (atBottom) {
      const ecoPrefetchTarget = Math.min(ECO_TOP_EXPOSURES_PREFETCH_COUNT, state.topExposuresTotalCount);
      if (state.topExposuresVisibleCount < ecoPrefetchTarget) {
        state.topExposuresLoading = true;
        update();

        window.setTimeout(() => {
          state.topExposuresVisibleCount = ecoPrefetchTarget;
          state.topExposuresLoading = false;
          state.ge1FullDataLoadTriggered = true;
          update();
          triggerFullDataLoad();
        }, TOP_EXPOSURES_LOAD_DELAY_MS);
      } else {
        state.ge1FullDataLoadTriggered = true;
        triggerFullDataLoad();
      }
    }
    return;
  }

  if (state.topExposuresVisibleCount >= state.topExposuresTotalCount) {
    return;
  }

  if (!atBottom) {
    return;
  }

  state.topExposuresLoading = true;
  update();

  window.setTimeout(() => {
    state.topExposuresVisibleCount += TOP_EXPOSURES_PAGE_SIZE;
    state.topExposuresLoading = false;
    update();
  }, TOP_EXPOSURES_LOAD_DELAY_MS);
}

function triggerEcoFullDataLoadFromSearchFocus() {
  triggerEcoFullDataLoadIfEligible();
}

function triggerEcoFullDataLoadFromFirstFilter() {
  triggerEcoFullDataLoadIfEligible();
}

function triggerEcoFullDataLoadIfEligible() {
  const canPrefetchFromFocus =
    isLiteMode() &&
    isLatestSnapshotSelected() &&
    state.ge1IsUsingEcoSubset &&
    !state.ge1FullDataLoadTriggered &&
    !state.topExposuresLoading;

  if (!canPrefetchFromFocus) {
    return;
  }

  state.ge1FullDataLoadTriggered = true;
  syncTopExposuresShowMoreVisibility();
  triggerFullDataLoad();
}

async function triggerFullDataLoad() {
  const snapshotHeight = String(state.snapshotHeight || "").trim();
  if (!snapshotHeight) return;

  state.topExposuresLoading = true;
  update();

  try {
    const basePath = `webapp_data/${snapshotHeight}`;
    // Load full ge1 CSV and the large lookup CSV concurrently.
    const [ge1Text, lookupText] = await Promise.all([
      fetch(`${basePath}/dashboard_pubkeys_ge_1btc.csv`)
        .then((r) => (r.ok ? r.text() : null))
        .catch(() => null),
      fetch("webapp_data/blockheight_datetime_lookup.csv")
        .then((r) => (r.ok ? r.text() : null))
        .catch(() => null),
    ]);

    // Populate blockDatetimeByHeight from the large lookup CSV.
    if (lookupText) {
      parseCsv(lookupText).forEach((row) => {
        const height = String(row.blockheight || "").trim();
        const unixTime = toInt(row.unix_time);
        if (height && unixTime) {
          state.blockDatetimeByHeight[height] = formatTooltipDate(unixTime);
        }
      });
    }

    // Swap in full ge1 rows only if we're still on the same snapshot.
    if (ge1Text && state.snapshotHeight === snapshotHeight) {
      const ge1RowsFull = parseCsv(ge1Text);
      state.ge1Rows = ge1RowsFull;
      state.ge1IsUsingEcoSubset = false;
      state.topExposuresDataCache.clear();
      state.snapshotDataCache.set(snapshotHeight, {
        snapshotHeight: state.snapshotHeight,
        aggregatesRows: state.aggregatesRows,
        ge1Rows: ge1RowsFull,
      });
    }
  } catch (err) {
    console.warn(`Full data load failed: ${err.message}`);
  }

  state.topExposuresLoading = false;
  state.topExposuresVisibleCount = Math.max(state.topExposuresVisibleCount, ECO_TOP_EXPOSURES_PREFETCH_COUNT);
  update();
}

function setAllScriptChecks(checked) {
  getScriptCheckboxes().forEach((el) => {
    el.checked = checked;
  });
}

function setAllSpendChecks(checked) {
  getSpendCheckboxes().forEach((el) => {
    el.checked = checked;
  });
}

function handleScriptCheckboxChange(changedEl) {
  const allEl = getScriptCheckboxes().find((el) => el.value === "All");
  const nonAllEls = getScriptCheckboxes().filter((el) => el.value !== "All");

  if (changedEl.value === "All") {
    if (changedEl.checked) {
      setAllScriptChecks(true);
    } else {
      setAllScriptChecks(false);
    }
  } else {
    if (!changedEl.checked) {
      allEl.checked = false;
    } else if (nonAllEls.every((el) => el.checked)) {
      allEl.checked = true;
    }
  }

  updateScriptTriggerLabel();
  resetTopExposurePagination();
  triggerEcoFullDataLoadFromFirstFilter();
  clearPreResetSnapshot();
  update();
}

function handleSpendCheckboxChange(changedEl) {
  const allEl = getSpendCheckboxes().find((el) => el.value === "all");
  const nonAllEls = getSpendCheckboxes().filter((el) => el.value !== "all");

  if (changedEl.value === "all") {
    if (changedEl.checked) {
      setAllSpendChecks(true);
    } else {
      setAllSpendChecks(false);
    }
  } else {
    if (!changedEl.checked) {
      allEl.checked = false;
    } else if (nonAllEls.every((el) => el.checked)) {
      allEl.checked = true;
    }
  }

  updateSpendTriggerLabel();
  resetTopExposurePagination();
  triggerEcoFullDataLoadFromFirstFilter();
  clearPreResetSnapshot();
  update();
}

function aggregateAllKpis(filters) {
  const balanceKey = filters.balance;
  const scriptKeys = filters.scriptTypes.includes("All") ? ["All"] : filters.scriptTypes;
  const spendKeys = filters.spendActivities.includes("all") ? ["all"] : filters.spendActivities;

  const acc = {
    supply_sats: 0,
    exposed_pubkey_count: 0,
    exposed_utxo_count: 0,
    exposed_supply_sats: 0,
    estimated_migration_blocks: 0,
  };

  scriptKeys.forEach((script) => {
    // Supply uses the spend='all' rollup (value is independent of spend activity).
    acc.supply_sats += getAggregate(balanceKey, script, "all", "supply_sats");

    // Migration blocks should follow the selected spend activity filter.
    spendKeys.forEach((spend) => {
      acc.estimated_migration_blocks += getAggregateFloat(
        balanceKey,
        script,
        spend,
        "estimated_migration_blocks"
      );
    });

    // exposed metrics respect the spend activity filter
    spendKeys.forEach((spend) => {
      acc.exposed_pubkey_count += getAggregate(balanceKey, script, spend, "exposed_pubkey_count");
      acc.exposed_utxo_count += getAggregate(balanceKey, script, spend, "exposed_utxo_count");
      acc.exposed_supply_sats += getAggregate(balanceKey, script, spend, "exposed_supply_sats");
    });
  });

  return acc;
}

function kpiFiltersAffectExposedBreakdown(filters) {
  if (!filters) return false;
  const addressQuery = String(filters.topExposureAddressQuery || "").trim();
  return (
    filters.balance !== "all" ||
    !filters.scriptTypes.includes("All") ||
    !filters.spendActivities.includes("all") ||
    isTagFilterActive(filters) ||
    !!addressQuery
  );
}

function rowMatchesTopExposureAddressQuery(row, addressQuery) {
  const normalizedQuery = String(addressQuery || "").trim().toLowerCase();
  if (!normalizedQuery) return true;
  const displayIds = String(row.display_group_ids || row.display_group_id || "").toLowerCase();
  return displayIds.includes(normalizedQuery);
}

function aggregateFilteredExposedSupplyBySpend(filters) {
  const sums = {
    never_spent: 0,
    inactive: 0,
    active: 0,
  };
  if (!filters) return sums;
  const addressQuery = String(filters.topExposureAddressQuery || "").trim();
  const useGe1Filtering = isTagFilterActive(filters) || !!addressQuery;

  if (useGe1Filtering) {
    state.ge1Rows.forEach((row) => {
      if (!rowPassesTopExposureFilters(row, filters, true)) return;
      if (!rowMatchesTopExposureAddressQuery(row, addressQuery)) return;

      const spend = row.spend_activity;
      if (!SPEND_TYPES_ORDER.includes(spend)) return;

      const filteredExposed = getFilteredExposedSupplySatsForRow(row, filters.scriptTypes);
      if (!filteredExposed) return;

      sums[spend] += filteredExposed;
    });
    return sums;
  }

  const scriptKeys = filters.scriptTypes.includes("All") ? ["All"] : filters.scriptTypes;
  const spendKeys = filters.spendActivities.includes("all")
    ? SPEND_TYPES_ORDER
    : SPEND_TYPES_ORDER.filter((spend) => filters.spendActivities.includes(spend));

  scriptKeys.forEach((script) => {
    spendKeys.forEach((spend) => {
      sums[spend] += getAggregate(filters.balance, script, spend, "exposed_supply_sats");
    });
  });

  return sums;
}

function renderKpis(kpi, total, filters) {
  const hasExposedPubkeys = kpi.exposed_pubkey_count > 0;
  const roundedMigrationBlocks = hasExposedPubkeys
    ? Math.max(1, Math.ceil(kpi.estimated_migration_blocks))
    : 0;

  document.getElementById("kpiSupply").textContent = formatCeilBtc(total.supply_sats) + " BTC";
  renderSupplyBreakdownBar(total, filters);

  const exposedSupplySubsetBtc = Math.floor(kpi.exposed_supply_sats / SATS_PER_BTC);
  const exposedSupplyOfTotal = formatPercent(kpi.exposed_supply_sats, total.supply_sats);
  document.getElementById("kpiExposedSupply").textContent =
    `${formatInt(exposedSupplySubsetBtc)} BTC · ${exposedSupplyOfTotal}`;
  document.getElementById("kpiExposedSupplyShare").textContent =
    `${formatPercent(kpi.exposed_supply_sats, total.exposed_supply_sats)} of all exposed supply`;

  document.getElementById("kpiExposedPubkeys").textContent =
    `${formatInt(kpi.exposed_pubkey_count)}`;
  document.getElementById("kpiExposedPubkeysShare").textContent =
    `${formatPercent(kpi.exposed_pubkey_count, total.exposed_pubkey_count)} of all exposed pubkeys`;

  document.getElementById("kpiExposedUtxos").textContent =
    `${formatInt(kpi.exposed_utxo_count)}`;
  document.getElementById("kpiExposedUtxosShare").textContent =
    `${formatPercent(kpi.exposed_utxo_count, total.exposed_utxo_count)} of all exposed UTXOs`;

  document.getElementById("kpiMigrationTime").textContent = hasExposedPubkeys
    ? `~${formatMigrationTime(roundedMigrationBlocks)}`
    : "0 min";

  document.getElementById("kpiMigrationBlocks").textContent =
    `${formatInt(roundedMigrationBlocks)} blocks`;
}

function renderSupplyBreakdownBar(total, filters) {
  const container = document.getElementById("kpiSupplyBreakdown");
  if (!container || !total) {
    return;
  }

  const MAX_BITCOIN_SUPPLY_SATS = 21_000_000 * SATS_PER_BTC;
  const totalSupply = total.supply_sats || 0;
  
  // Get exposed supply breakdown by spend activity
  const exposedNever = getAggregate("all", "All", "never_spent", "exposed_supply_sats");
  const exposedInactive = getAggregate("all", "All", "inactive", "exposed_supply_sats");
  const exposedActive = getAggregate("all", "All", "active", "exposed_supply_sats");
  const exposedTotal = exposedNever + exposedInactive + exposedActive;

  const filteredExposedBySpend = aggregateFilteredExposedSupplyBySpend(filters);
  const filteredNever = Math.min(exposedNever, filteredExposedBySpend.never_spent || 0);
  const filteredInactive = Math.min(exposedInactive, filteredExposedBySpend.inactive || 0);
  const filteredActive = Math.min(exposedActive, filteredExposedBySpend.active || 0);
  const hasFilteredOverlay =
    kpiFiltersAffectExposedBreakdown(filters) &&
    (filteredNever !== exposedNever || filteredInactive !== exposedInactive || filteredActive !== exposedActive);
  
  const nonExposedSupply = Math.max(totalSupply - exposedTotal, 0);
  const unminedSupply = Math.max(MAX_BITCOIN_SUPPLY_SATS - totalSupply, 0);

  if (totalSupply === 0) {
    container.innerHTML = "";
    return;
  }

  const exposedNeverBtc = Math.round(exposedNever / SATS_PER_BTC);
  const exposedInactiveBtc = Math.round(exposedInactive / SATS_PER_BTC);
  const exposedActiveBtc = Math.round(exposedActive / SATS_PER_BTC);
  const nonExposedBtc = Math.round(nonExposedSupply / SATS_PER_BTC);
  const unminedBtc = Math.round(unminedSupply / SATS_PER_BTC);

  const exposedNeverPct = (exposedNever / MAX_BITCOIN_SUPPLY_SATS) * 100;
  const exposedInactivePct = (exposedInactive / MAX_BITCOIN_SUPPLY_SATS) * 100;
  const exposedActivePct = (exposedActive / MAX_BITCOIN_SUPPLY_SATS) * 100;
  const nonExposedPct = (nonExposedSupply / MAX_BITCOIN_SUPPLY_SATS) * 100;
  const unminedPct = (unminedSupply / MAX_BITCOIN_SUPPLY_SATS) * 100;

  const filteredNeverPct = (filteredNever / MAX_BITCOIN_SUPPLY_SATS) * 100;
  const filteredInactivePct = (filteredInactive / MAX_BITCOIN_SUPPLY_SATS) * 100;
  const filteredActivePct = (filteredActive / MAX_BITCOIN_SUPPLY_SATS) * 100;

  const neverHighlighted = !!filters && (filters.spendActivities.includes("all") || filters.spendActivities.includes("never_spent"));
  const inactiveHighlighted = !!filters && (filters.spendActivities.includes("all") || filters.spendActivities.includes("inactive"));
  const activeHighlighted = !!filters && (filters.spendActivities.includes("all") || filters.spendActivities.includes("active"));

  const buildExposedTooltip = (label, fullSats, filteredSats) => {
    const fullLine = `${label}: ${formatInt(Math.round(fullSats / SATS_PER_BTC))} BTC · ${formatPercent(fullSats, totalSupply)}`;
    if (!hasFilteredOverlay) return fullLine;
    const filteredLine = `Filtered: ${formatInt(Math.round(filteredSats / SATS_PER_BTC))} BTC · ${formatPercent(filteredSats, totalSupply)}`;
    return `${fullLine}\n${filteredLine}`;
  };

  const neverTooltip = buildExposedTooltip("Never Spent", exposedNever, filteredNever);
  const inactiveTooltip = buildExposedTooltip("Inactive", exposedInactive, filteredInactive);
  const activeTooltip = buildExposedTooltip("Active", exposedActive, filteredActive);

  let segmentsHtml = "";
  
  if (exposedNever > 0) {
    segmentsHtml += `<div class="kpi-breakdown-segment seg-never${hasFilteredOverlay ? " is-reference" : ""}" data-tooltip="${escapeHtmlAttr(neverTooltip)}" style="width: ${exposedNeverPct}%;"></div>`;
  }
  
  if (exposedInactive > 0) {
    segmentsHtml += `<div class="kpi-breakdown-segment seg-inactive${hasFilteredOverlay ? " is-reference" : ""}" data-tooltip="${escapeHtmlAttr(inactiveTooltip)}" style="width: ${exposedInactivePct}%;"></div>`;
  }
  
  if (exposedActive > 0) {
    segmentsHtml += `<div class="kpi-breakdown-segment seg-active${hasFilteredOverlay ? " is-reference" : ""}" data-tooltip="${escapeHtmlAttr(activeTooltip)}" style="width: ${exposedActivePct}%;"></div>`;
  }
  
  if (nonExposedSupply > 0) {
    segmentsHtml += `<div class="kpi-breakdown-segment seg-nonexposed" data-tooltip="Non-Exposed: ${formatInt(nonExposedBtc)} BTC · ${formatPercent(nonExposedSupply, totalSupply)}" style="width: ${nonExposedPct}%;"></div>`;
  }
  
  if (unminedSupply > 0) {
    segmentsHtml += `<div class="kpi-breakdown-segment seg-unmined" data-tooltip="Unmined: ${formatInt(unminedBtc)} BTC" style="width: ${unminedPct}%;"></div>`;
  }

  let overlaySegmentsHtml = "";
  if (hasFilteredOverlay) {
    if (filteredNever > 0) {
      overlaySegmentsHtml += `<div class="kpi-breakdown-overlay-segment seg-never${neverHighlighted ? "" : " is-faded"}" data-tooltip="${escapeHtmlAttr(neverTooltip)}" style="left: 0%; width: ${filteredNeverPct}%;"></div>`;
    }
    if (filteredInactive > 0) {
      overlaySegmentsHtml += `<div class="kpi-breakdown-overlay-segment seg-inactive${inactiveHighlighted ? "" : " is-faded"}" data-tooltip="${escapeHtmlAttr(inactiveTooltip)}" style="left: ${exposedNeverPct}%; width: ${filteredInactivePct}%;"></div>`;
    }
    if (filteredActive > 0) {
      overlaySegmentsHtml += `<div class="kpi-breakdown-overlay-segment seg-active${activeHighlighted ? "" : " is-faded"}" data-tooltip="${escapeHtmlAttr(activeTooltip)}" style="left: ${exposedNeverPct + exposedInactivePct}%; width: ${filteredActivePct}%;"></div>`;
    }
  }

  container.innerHTML = `
    <div class="kpi-breakdown-bar">
      ${segmentsHtml}
      ${hasFilteredOverlay ? `<div class="kpi-breakdown-overlay">${overlaySegmentsHtml}</div>` : ""}
    </div>
  `;

  // Attach tooltip listeners to the segments
  const segments = container.querySelectorAll(".kpi-breakdown-segment, .kpi-breakdown-overlay-segment");
  segments.forEach((seg) => {
    seg.addEventListener("mouseenter", (e) => {
      const rect = seg.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top;
      customTooltipAnchor = seg;
      showCustomTooltip(seg, x, y);
    }, { passive: true });

    seg.addEventListener("mouseleave", () => {
      if (customTooltipAnchor === seg) {
        hideCustomTooltip();
        customTooltipAnchor = null;
      }
    }, { passive: true });

    seg.addEventListener("touchstart", (e) => {
      const touch = e.touches[0];
      const rect = seg.getBoundingClientRect();
      const x = touch.clientX;
      const y = touch.clientY;
      customTooltipAnchor = seg;
      showCustomTooltip(seg, x, y);

      clearMobileTooltipHideTimer();
      mobileTooltipHideTimerId = window.setTimeout(() => {
        if (customTooltipAnchor === seg) {
          customTooltipAnchor = null;
        }
        hideCustomTooltip();
        mobileTooltipHideTimerId = null;
      }, 1800);
    }, { passive: true });

    seg.addEventListener("scroll", () => {
      if (customTooltipAnchor === seg) {
        clearMobileTooltipHideTimer();
        hideCustomTooltip();
      }
    }, { passive: true });
  });
}

function readFilters() {
  const selectedScriptTypes = getCheckedScriptValues();
  const selectedSpendActivities = getCheckedSpendValues();
  let selectedDetailTags = Array.isArray(state.selectedDetailTags) ? state.selectedDetailTags : ["All"];
  let selectedIdentityGroups = Array.isArray(state.selectedIdentityGroups) ? state.selectedIdentityGroups : ["All"];
  let selectedIdentityTags = Array.isArray(state.selectedIdentityTags) ? state.selectedIdentityTags : ["All"];
  const topExposureAddressSearch = document.getElementById("topExposureAddressSearch");

  if (isLiteMode()) {
    selectedDetailTags = ["All"];
    selectedIdentityGroups = ["All"];
    selectedIdentityTags = ["All"];
  }

  // If selections are exclusion-encoded from share-state, resolve them as soon
  // as the option universe is known so filtering logic never sees raw tokens.
  const hasExcludeEncoding =
    selectedDetailTags.includes(SHARE_EXCLUDE_TOKEN) ||
    selectedIdentityGroups.includes(SHARE_EXCLUDE_TOKEN) ||
    selectedIdentityTags.includes(SHARE_EXCLUDE_TOKEN);
  if (hasExcludeEncoding && state.ge1Rows.length) {
    const allOptions = buildTagOptionsFromGe1Rows(["All"]);
    selectedIdentityGroups = normalizeTagSelections(selectedIdentityGroups, allOptions.identityGroups, true, true);
    const scopedOptions = buildTagOptionsFromGe1Rows(selectedIdentityGroups);
    selectedDetailTags = normalizeTagSelections(selectedDetailTags, scopedOptions.details, true, true);
    selectedIdentityTags = normalizeTagSelections(selectedIdentityTags, scopedOptions.identities, true, true);
  }

  const topExposureAddressQuery = (isLiteMode() && !isLatestSnapshotSelected())
    ? ""
    : topExposureAddressSearch
    ? topExposureAddressSearch.value.trim()
    : String(state.topExposureAddressQuery || "").trim();
  let balanceValue = document.getElementById("balanceFilter").value;

  const detailFiltered = selectedDetailTags.length > 0 && !selectedDetailTags.includes("All");
  const identityGroupFiltered = selectedIdentityGroups.length > 0 && !selectedIdentityGroups.includes("All");
  const identityFiltered = selectedIdentityTags.length > 0 && !selectedIdentityTags.includes("All");
  const topExposureFiltersActive = detailFiltered || identityGroupFiltered || identityFiltered;
  const balanceFilterEl = document.getElementById("balanceFilter");

  if (topExposureFiltersActive) {
    if (balanceValue === "all") {
      // Auto-force from All only when top-exposure filters become constrained.
      balanceValue = "ge1";
      if (balanceFilterEl) {
        balanceFilterEl.value = "ge1";
      }
      state.balanceAutoForcedFromAllByTopFilters = true;
    }
  } else if (state.balanceAutoForcedFromAllByTopFilters && balanceValue !== "all") {
    // Restore All only if this session's current non-All value came from the auto-force.
    balanceValue = "all";
    if (balanceFilterEl) {
      balanceFilterEl.value = "all";
    }
    state.balanceAutoForcedFromAllByTopFilters = false;
  }

  state.selectedDetailTags = selectedDetailTags;
  state.selectedIdentityGroups = selectedIdentityGroups;
  state.selectedIdentityTags = selectedIdentityTags;
  state.topExposureAddressQuery = topExposureAddressQuery;

  return {
    balance: balanceValue,
    spendActivities: selectedSpendActivities,
    scriptTypes: selectedScriptTypes,
    detailTags: state.selectedDetailTags,
    identityGroups: state.selectedIdentityGroups,
    identityTags: state.selectedIdentityTags,
    topExposureAddressQuery: state.topExposureAddressQuery,
  };
}



function updateKpisAndCharts() {
  const filters = readFilters();
  
  if (state.scriptPanelMode === "historical") {
    renderHistoricalStackedChart(filters);
  } else {
    renderScriptBars(buildScriptBarsData(filters));
  }

  if (!filters.scriptTypes.length || !filters.spendActivities.length) {
    renderEmptyKpis();
    return;
  }

  const useGe1Kpis = isTagFilterActive(filters);
  const subset = useGe1Kpis ? aggregateKpisFromGe1(filters, true) : aggregateAllKpis(filters);
  const total = aggregateAllKpis({
    balance: "all",
    spendActivities: ["all"],
    scriptTypes: ["All"],
  });
  renderKpis(subset, total, filters);
}

function updateTopExposures() {
  const filters = readFilters();
  renderTopExposures(buildTopExposuresData(filters));
}

function update() {
  updateAnalysisSplitHeight();
  updateResetButtonUi();
  const filters = readFilters();
  persistFilters(filters);
  updateKpisAndCharts();
  updateTopExposures();
}

function updateAnalysisSplitHeight() {
  const split = document.getElementById("analysisSplit");
  if (!split) {
    return;
  }

  const splitTop = split.getBoundingClientRect().top;
  const bodyStyles = window.getComputedStyle(document.body);
  const bodyPaddingBottom = Number.parseFloat(bodyStyles.paddingBottom) || 0;
  const availableHeight = Math.floor(window.innerHeight - splitTop - bodyPaddingBottom);
  const clampedHeight = Math.max(availableHeight, ANALYSIS_MIN_HEIGHT_PX);

  document.documentElement.style.setProperty("--analysis-min-height", `${ANALYSIS_MIN_HEIGHT_PX}px`);
  document.documentElement.style.setProperty("--analysis-max-height", `${clampedHeight}px`);
}

async function loadIdentityGroups() {
  state.identityGroupsByName = {};
  state.identityToGroupNames = {};

  try {
    const resp = await fetch("webapp_data/identity_groups.json");
    if (!resp.ok) return false;

    const payload = await resp.json();
    if (!payload || typeof payload !== "object" || !payload.groups || typeof payload.groups !== "object") {
      return false;
    }

    Object.entries(payload.groups).forEach(([groupName, identities]) => {
      if (!Array.isArray(identities) || !groupName) return;

      const normalizedIdentities = identities
        .map((identity) => formatIdentityTag(identity || ""))
        .filter(Boolean);

      state.identityGroupsByName[groupName] = normalizedIdentities;

      normalizedIdentities.forEach((identity) => {
        if (!state.identityToGroupNames[identity]) {
          state.identityToGroupNames[identity] = [];
        }
        if (!state.identityToGroupNames[identity].includes(groupName)) {
          state.identityToGroupNames[identity].push(groupName);
        }
      });
    });
    return true;
  } catch (err) {
    console.warn("Could not load identity groups", err);
    return false;
  }
}

async function ensureIdentityGroupsLoaded() {
  if (state.identityGroupsLoaded) {
    return true;
  }
  if (state.identityGroupsLoadingPromise) {
    return state.identityGroupsLoadingPromise;
  }

  state.identityGroupsLoadingPromise = (async () => {
    const loaded = await loadIdentityGroups();
    state.identityGroupsLoaded = loaded;
    if (loaded) {
      state.topExposuresDataCache.clear();
    }
    state.identityGroupsLoadingPromise = null;
    return loaded;
  })();

  return state.identityGroupsLoadingPromise;
}

async function loadData(preferredSnapshotOverride = "") {
  state.availableSnapshots = await loadAvailableSnapshots();
  if (!state.availableSnapshots.length) {
    throw new Error("No snapshots found in webapp_data/");
  }

  const selectedIdentityGroups = Array.isArray(state.selectedIdentityGroups) ? state.selectedIdentityGroups : ["All"];
  const selectedIdentityTags = Array.isArray(state.selectedIdentityTags) ? state.selectedIdentityTags : ["All"];
  const needsGlobalIdentityUniverseForExclusions = selectedIdentityTags.includes(SHARE_EXCLUDE_TOKEN);
  const needsIdentityGroupMapForUnidentifiedGroup = selectedIdentityGroups.includes(UNIDENTIFIED_IDENTITY_GROUP_FILTER_VALUE);

  if (
    !isLiteMode() &&
    (
      !selectedIdentityGroups.includes("All") ||
      needsGlobalIdentityUniverseForExclusions ||
      needsIdentityGroupMapForUnidentifiedGroup
    )
  ) {
    await ensureIdentityGroupsLoaded();
  }

  populateSnapshotFilter(state.availableSnapshots);
  const preferredMode = state.pendingPersistedSnapshotPreference;
  const preferredSnapshot = state.pendingPersistedSnapshotHeight;
  const preferredOverride = String(preferredSnapshotOverride || "").trim();
  const initialSnapshot =
    preferredOverride && state.availableSnapshots.includes(preferredOverride)
      ? preferredOverride
      : preferredMode === SNAPSHOT_PREF_LATEST
      ? state.availableSnapshots[0]
      : preferredSnapshot && state.availableSnapshots.includes(preferredSnapshot)
      ? preferredSnapshot
      : state.availableSnapshots[0];
  await loadSnapshotData(initialSnapshot);

  // In FULL mode: load the large blockheight lookup CSV in background so tooltip dates
  // are available for every row. In ECO mode: snapshot labels come from snapshots_index.csv
  // (populated in loadAvailableSnapshots above). The large lookup CSV and full ge1 CSV are
  // loaded on-demand only when the user scrolls past the initial 50 rows.
  if (!isLiteMode()) {
    refreshSnapshotLookupUi()
      .catch(() => {
        // Best effort only; dropdown falls back to block-height labels.
      });
  }
}

async function refreshSnapshotLookupUi() {
  await loadSnapshotLabelLookup(state.availableSnapshots);

  const snapshotFilter = document.getElementById("snapshotFilter");
  if (!snapshotFilter || !state.availableSnapshots.length) return;

  const currentValue = String(state.snapshotHeight || snapshotFilter.value || "").trim();
  populateSnapshotFilter(state.availableSnapshots);

  const nextValue = state.availableSnapshots.includes(currentValue)
    ? currentValue
    : state.availableSnapshots[0];
  snapshotFilter.value = nextValue;

  // Refresh top-exposure tooltips now that blockheight -> datetime map is populated.
  // Force a fresh render by clearing the render-dedup sentinel — the rows object reference
  // is the same cached instance, so without this the identity check in renderTopExposures
  // would skip the re-render and leave stale "Unknown" datetime tags.
  if (Array.isArray(state.ge1Rows) && state.ge1Rows.length) {
    _lastTopExposuresRows = null;
    updateTopExposures();
  }
}

async function loadSnapshotLabelLookup(snapshots) {
  state.blockDatetimeByHeight = {};
  state.snapshotLabelDatetimeByHeight = {};

  let loadedFromGlobalLookup = false;
  try {
    const lookupResp = await fetch("webapp_data/blockheight_datetime_lookup.csv");
    if (lookupResp.ok) {
      const lookupRows = parseCsv(await lookupResp.text());
      const snapshotSet = new Set((Array.isArray(snapshots) ? snapshots : []).map((value) => String(value).trim()));
      lookupRows.forEach((row) => {
        const height = String(row.blockheight || "").trim();
        const unixTime = toInt(row.unix_time);
        if (!height || !unixTime) return;

        const tooltipDate = formatTooltipDate(unixTime);
        state.blockDatetimeByHeight[height] = tooltipDate;

        if (snapshotSet.has(height)) {
          state.snapshotLabelDatetimeByHeight[height] = formatSnapshotSelectDate(unixTime);
        }
      });
      loadedFromGlobalLookup = true;
    }
  } catch (_err) {
    // Fallback below will continue to per-snapshot metadata.
  }

  // Fallback path for snapshot labels if the global lookup is missing/incomplete.
  const missingSnapshotLabels = (Array.isArray(snapshots) ? snapshots : [])
    .map((snapshot) => String(snapshot).trim())
    .filter((snapshot) => snapshot && !state.snapshotLabelDatetimeByHeight[snapshot]);

  if (loadedFromGlobalLookup && missingSnapshotLabels.length === 0) {
    return;
  }

  await Promise.all(
    missingSnapshotLabels.map(async (snapshot) => {
      try {
        const resp = await fetch(`${snapshotBasePath(snapshot)}/dashboard_snapshot_meta.csv`);
        if (!resp.ok) {
          return;
        }

        const rows = parseCsv(await resp.text());
        if (!rows.length) {
          return;
        }

        const snapshotTime = toInt(rows[0].snapshot_time);
        if (!snapshotTime) {
          return;
        }

        state.blockDatetimeByHeight[String(snapshot)] = formatTooltipDate(snapshotTime);
        state.snapshotLabelDatetimeByHeight[String(snapshot)] = formatSnapshotSelectDate(snapshotTime);
      } catch (_err) {
        // Best effort only; labels fall back to block height when unavailable.
      }
    })
  );
}

async function loadAvailableSnapshots() {
  state.snapshotLocationByHeight = {};

  const indexResp = await fetch("webapp_data/snapshots_index.csv");
  let activeRows = [];
  if (indexResp.ok) {
    activeRows = parseCsv(await indexResp.text());
    const values = activeRows
      .map((row) => (row.snapshot_blockheight || "").trim())
      .filter((value) => /^\d+$/.test(value));

    values.forEach((height) => {
      state.snapshotLocationByHeight[height] = "active";
    });

    let archivedRows = [];
    if (IS_LOCAL_RUNTIME) {
      try {
        const archivedResp = await fetch("webapp_data/archived_index.csv");
        if (archivedResp.ok) {
          archivedRows = parseCsv(await archivedResp.text());
        }
      } catch (_err) {
        archivedRows = [];
      }
    }

    const archivedValues = archivedRows
      .map((row) => (row.snapshot_blockheight || "").trim())
      .filter((value) => /^\d+$/.test(value));

    state.archivedSnapshotsAvailable = archivedValues.length > 0;
    if (!state.archivedSnapshotsAvailable) {
      state.archivedSnapshotsEnabled = false;
    }
    updateArchivedSnapshotsToggleUi();

    const mergedValues = [...values];
    if (state.archivedSnapshotsEnabled) {
      archivedValues.forEach((height) => {
        if (!state.snapshotLocationByHeight[height]) {
          state.snapshotLocationByHeight[height] = "archived";
        }
        if (!mergedValues.includes(height)) {
          mergedValues.push(height);
        }
      });
    }

    if (values.length) {
      mergedValues.sort((left, right) => Number.parseInt(right, 10) - Number.parseInt(left, 10));
      // Pre-populate snapshot label datetimes from the embedded snapshot_time column.
      // This makes dropdown labels available immediately, with no need to load the large
      // blockheight_datetime_lookup.csv or individual per-snapshot meta CSVs for this purpose.
      activeRows.forEach((row) => {
        const height = (row.snapshot_blockheight || "").trim();
        const unixTime = toInt(row.snapshot_time);
        if (height && unixTime) {
          state.snapshotLabelDatetimeByHeight[height] = formatSnapshotSelectDate(unixTime);
          state.blockDatetimeByHeight[height] = formatTooltipDate(unixTime);
        }
      });
      if (state.archivedSnapshotsEnabled) {
        archivedRows.forEach((row) => {
          const height = (row.snapshot_blockheight || "").trim();
          const unixTime = toInt(row.snapshot_time);
          if (height && unixTime) {
            state.snapshotLabelDatetimeByHeight[height] = formatSnapshotSelectDate(unixTime);
            state.blockDatetimeByHeight[height] = formatTooltipDate(unixTime);
          }
        });
      }
      return mergedValues;
    }
  }

  state.archivedSnapshotsAvailable = false;
  state.archivedSnapshotsEnabled = false;
  updateArchivedSnapshotsToggleUi();

  const latestResp = await fetch("webapp_data/latest_snapshot.txt");
  if (!latestResp.ok) {
    throw new Error("Could not load webapp_data/latest_snapshot.txt");
  }

  const latest = (await latestResp.text()).trim();
  if (!/^\d+$/.test(latest)) {
    throw new Error("latest_snapshot.txt is not a valid block height");
  }
  return [latest];
}

function populateSnapshotFilter(snapshots) {
  const select = document.getElementById("snapshotFilter");
  const formatSnapshotLabel = (snapshot) => {
    const datetimeUtc = state.snapshotLabelDatetimeByHeight[String(snapshot)] || "";
    if (!datetimeUtc) return String(snapshot);
    return `${snapshot} · ${datetimeUtc} (UTC)`;
  };

  select.innerHTML = snapshots
    .map((snapshot) => `<option value="${snapshot}">${escapeHtml(formatSnapshotLabel(snapshot))}</option>`)
    .join("");
  select.value = snapshots[0];
}

async function loadSnapshotData(snapshot) {
  const requestedSnapshot = String(snapshot || "").trim();
  const basePath = snapshotBasePath(requestedSnapshot);
  const cached = state.snapshotDataCache.get(requestedSnapshot);

  if (cached) {
    state.aggregatesRows = cached.aggregatesRows;
    state.ge1Rows = cached.ge1Rows;
    state.snapshotHeight = cached.snapshotHeight;
    state.topExposuresLoading = false;

    const snapshotFilter = document.getElementById("snapshotFilter");
    const loadedSnapshot = String(state.snapshotHeight || requestedSnapshot).trim();
    if (snapshotFilter) {
      const hasLoadedOption = Array.from(snapshotFilter.options).some((option) => option.value === loadedSnapshot);
      snapshotFilter.value = hasLoadedOption ? loadedSnapshot : requestedSnapshot;
    }

    state.pendingPersistedSnapshotPreference = null;
    state.pendingPersistedSnapshotHeight = null;
    resetTopExposurePagination();
    renderTopExposureTagFilters();
    update();
    return;
  }

  const [metaResp, aggregatesResp] = await Promise.all([
    fetch(`${basePath}/dashboard_snapshot_meta.csv`),
    fetch(`${basePath}/dashboard_pubkeys_aggregates.csv`),
  ]);

  if (!metaResp.ok || !aggregatesResp.ok) {
    throw new Error(`Could not load one or more CSV files from ${basePath}/`);
  }

  const metaRows = parseCsv(await metaResp.text());
  const aggregatesRows = parseCsv(await aggregatesResp.text());
  const resolvedSnapshotHeight = metaRows.length ? metaRows[0].snapshot_blockheight : requestedSnapshot;

  // Phase 1: render chart/KPI context as soon as light files are ready.
  state.aggregatesRows = aggregatesRows;
  state.snapshotHeight = resolvedSnapshotHeight;
  state.ge1Rows = [];
  state.topExposuresLoading = true;
  state.topExposuresDataCache.clear();

  const snapshotFilter = document.getElementById("snapshotFilter");
  const loadedSnapshot = String(state.snapshotHeight || requestedSnapshot).trim();
  if (snapshotFilter) {
    const hasLoadedOption = Array.from(snapshotFilter.options).some((option) => option.value === loadedSnapshot);
    snapshotFilter.value = hasLoadedOption ? loadedSnapshot : requestedSnapshot;
  }

  state.pendingPersistedSnapshotPreference = null;
  state.pendingPersistedSnapshotHeight = null;
  resetTopExposurePagination();
  renderTopExposureTagFilters();
  // Progressive rendering: show KPIs/charts immediately using fast aggregates
  updateKpisAndCharts();
  // In full mode, also render top exposures; in ECO mode, wait for ge1 data
  if (!isLiteMode()) {
    updateTopExposures();
  }

  if (isLiteMode()) {
    const isLatestSnapshot = requestedSnapshot === latestSnapshotHeight();
    if (!isLatestSnapshot) {
      state.ge1Rows = [];
      state.topExposuresLoading = false;
      state.ge1IsUsingEcoSubset = false;
      renderTopExposureTagFilters();
      state.snapshotDataCache.set(requestedSnapshot, {
        snapshotHeight: state.snapshotHeight,
        aggregatesRows,
        ge1Rows: [],
      });
      updateTopExposures();
      return;
    }

    // Phase 2a: Load lightweight top100 version first, but initially render only 50 rows.
    const ecoRespLite = await fetch(`${basePath}/dashboard_pubkeys_ge_1btc_top100.csv`);
    if (!ecoRespLite.ok) {
      state.topExposuresLoading = false;
      throw new Error(`Could not load top_100 CSV from ${basePath}/`);
    }

    const ge1RowsEcoSubset = parseCsv(await ecoRespLite.text());
    state.ge1Rows = ge1RowsEcoSubset;
    state.ge1IsUsingEcoSubset = true;
    state.topExposuresVisibleCount = Math.min(ECO_TOP_EXPOSURES_INITIAL_COUNT, ge1RowsEcoSubset.length);
    state.topExposuresLoading = false;
    renderTopExposureTagFilters();
    updateTopExposures();

    // Full ge1 data and the large lookup CSV are loaded on-demand either when the user
    // focuses address search or when they scroll past the initial 50 rows.
    state.snapshotDataCache.set(requestedSnapshot, {
      snapshotHeight: state.snapshotHeight,
      aggregatesRows,
      ge1Rows: ge1RowsEcoSubset,
    });
    return;
  }

  const ge1Resp = await fetch(`${basePath}/dashboard_pubkeys_ge_1btc.csv`);
  if (!ge1Resp.ok) {
    state.topExposuresLoading = false;
    throw new Error(`Could not load one or more CSV files from ${basePath}/`);
  }

  const ge1Rows = parseCsv(await ge1Resp.text());
  state.ge1Rows = ge1Rows;
  state.topExposuresLoading = false;

  // Rebuild filters now that full identity/detail options are available.
  renderTopExposureTagFilters();

  state.snapshotDataCache.set(requestedSnapshot, {
    snapshotHeight: state.snapshotHeight,
    aggregatesRows,
    ge1Rows,
  });

  // In full mode, recompute KPIs/charts and top exposures after ge1 data loads.
  updateKpisAndCharts();
  updateTopExposures();
}

function attachEvents() {
  bindCustomTooltips();
  const copyDashboardLinkButton = document.getElementById("copyDashboardLink");
  const resetDashboardButton = document.getElementById("resetDashboard");
  const archivedSnapshotsToggleButton = document.getElementById("archivedSnapshotsToggle");
  const runtimeModeToggleButton = document.getElementById("runtimeModeToggle");
  const themeToggle = document.getElementById("themeToggle");
  const snapshotReportButton = document.getElementById("snapshotReportButton");
  const snapshotReportClose = document.getElementById("snapshotReportClose");
  const snapshotReportModal = document.getElementById("snapshotReportModal");
  const scriptPanelModeToggle = document.getElementById("scriptPanelModeToggle");
  const scriptPanelDetailsToggle = document.getElementById("scriptPanelDetailsToggle");
  const supplyModeSelect = document.getElementById("scriptPanelSupplyMode");
  const topExposuresFiltersToggle = document.getElementById("topExposuresFiltersToggle");
  const topExposureAddressSearch = document.getElementById("topExposureAddressSearch");
  ["balanceFilter"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => {
      // Manual balance changes should always override auto-revert behavior.
      state.balanceAutoForcedFromAllByTopFilters = false;
      resetTopExposurePagination();
      triggerEcoFullDataLoadFromFirstFilter();
      clearPreResetSnapshot();
      update();
    });
  });

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      toggleTheme();
    });
  }

  if (snapshotReportButton) {
    snapshotReportButton.addEventListener("click", () => {
      openSnapshotReportModal();
    });
  }

  if (snapshotReportClose) {
    snapshotReportClose.addEventListener("click", () => {
      closeSnapshotReportModal();
    });
  }

  if (snapshotReportModal) {
    snapshotReportModal.querySelectorAll("[data-report-close]").forEach((el) => {
      el.addEventListener("click", () => {
        closeSnapshotReportModal();
      });
    });
  }

  if (runtimeModeToggleButton) {
    runtimeModeToggleButton.addEventListener("click", async () => {
      if (!IS_LOCAL_RUNTIME) {
        window.open("https://github.com/w-s-bitcoin/webapps-quantum-exposure", "_blank", "noopener,noreferrer");
        return;
      }

      runtimeLiteMode = !isLiteMode();
      persistRuntimeMode();
      applyRuntimeModeUi();

      // Clear mode-dependent caches so full mode can fetch GE1 rows and
      // lite mode can avoid carrying heavy data structures.
      state.snapshotDataCache.clear();
      state.topExposuresDataCache.clear();
      state.historicalSeries = [];
      state.ge1Rows = [];
      state.topExposuresLoading = false;
      resetTopExposurePagination();

      const snapshotFilter = document.getElementById("snapshotFilter");
      const targetSnapshot = String(state.snapshotHeight || snapshotFilter?.value || state.availableSnapshots[0] || "").trim();
      if (!targetSnapshot) {
        update();
        return;
      }

      try {
        await loadSnapshotData(targetSnapshot);
        if (!isLiteMode()) {
          await refreshSnapshotLookupUi();
        }
      } catch (err) {
        console.error(err);
        renderEmptyKpis();
      }
    });
  }

  if (archivedSnapshotsToggleButton) {
    archivedSnapshotsToggleButton.addEventListener("click", async () => {
      if (!IS_LOCAL_RUNTIME || !state.archivedSnapshotsAvailable) return;

      const snapshotFilter = document.getElementById("snapshotFilter");
      const previousSnapshot = String(state.snapshotHeight || snapshotFilter?.value || "").trim();
      const previousSnapshotWasArchived = state.snapshotLocationByHeight[previousSnapshot] === "archived";

      state.archivedSnapshotsEnabled = !state.archivedSnapshotsEnabled;
      updateArchivedSnapshotsToggleUi();
      persistArchivedSnapshotsEnabled();

      resetHistoricalSeriesState();

      try {
        state.availableSnapshots = await loadAvailableSnapshots();
        if (!state.availableSnapshots.length) {
          throw new Error("No snapshots found in webapp_data/");
        }

        populateSnapshotFilter(state.availableSnapshots);
        const targetSnapshot = state.availableSnapshots.includes(previousSnapshot)
          ? previousSnapshot
          : state.availableSnapshots[0];
        if (snapshotFilter) {
          snapshotFilter.value = targetSnapshot;
        }

        if (previousSnapshotWasArchived || targetSnapshot !== String(state.snapshotHeight || "").trim()) {
          state.snapshotDataCache.clear();
          state.topExposuresDataCache.clear();
          state.ge1Rows = [];
          state.topExposuresLoading = false;
          resetTopExposurePagination();
          await loadSnapshotData(targetSnapshot);
          if (!isLiteMode()) {
            await refreshSnapshotLookupUi();
          }
          return;
        }

        updateResetButtonUi();
        if (state.scriptPanelMode === "historical") {
          renderHistoricalStackedChart(readFilters());
        }
      } catch (err) {
        console.error(err);
        renderEmptyKpis();
      }
    });
  }

  if (resetDashboardButton) {
    resetDashboardButton.addEventListener("click", async () => {
      try {
        if (state.preResetStateSnapshot) {
          const snapshot = state.preResetStateSnapshot;
          state.preResetStateSnapshot = null;
          updateResetButtonUi();
          await applyFilterSnapshot(snapshot);
        } else {
          await resetDashboardToDefaults();
        }
      } catch (err) {
        console.error(err);
      }
    });
    updateResetButtonUi();
  }

  if (copyDashboardLinkButton) {
    copyDashboardLinkButton.addEventListener("click", async () => {
      try {
        await copyDashboardLinkToClipboard(copyDashboardLinkButton);
      } catch (err) {
        console.error(err);
      }
    });
  }

  if (scriptPanelModeToggle) {
    scriptPanelModeToggle.addEventListener("click", async () => {
      state.scriptPanelMode = state.scriptPanelMode === "historical" ? "bars" : "historical";
      updateScriptPanelModeUi();
      clearPreResetSnapshot();

      if (state.scriptPanelMode === "historical" && !state.historicalSeries.length) {
        try {
          update();
          await ensureHistoricalSeriesLoaded();
        } catch (err) {
          console.error(err);
          state.scriptPanelMode = "bars";
          updateScriptPanelModeUi();
        }
      }

      update();
    });
  }

  if (supplyModeSelect) {
    supplyModeSelect.value = normalizeSupplyDisplayMode(state.supplyDisplayMode);
    supplyModeSelect.addEventListener("change", () => {
      state.supplyDisplayMode = normalizeSupplyDisplayMode(supplyModeSelect.value);
      updateScriptPanelModeUi();
      clearPreResetSnapshot();
      update();
    });
  }

  if (topExposuresFiltersToggle) {
    topExposuresFiltersToggle.addEventListener("click", () => {
      state.topExposuresFiltersCollapsed = !state.topExposuresFiltersCollapsed;
      updateTopExposuresFiltersUi();
      syncTopExposuresShowMoreVisibility();
      applyConditionalMiddleEllipsis(document.getElementById("topExposuresList"));
      clearPreResetSnapshot();
      persistFilters(readFilters());
    });
  }

  if (scriptPanelDetailsToggle) {
    scriptPanelDetailsToggle.addEventListener("click", () => {
      state.scriptPanelDetailsCollapsed = !state.scriptPanelDetailsCollapsed;
      updateScriptPanelDetailsUi();
      clearPreResetSnapshot();
      persistFilters(readFilters());

      if (state.scriptPanelMode === "historical") {
        // Re-render on the next frame so chart dimensions follow the panel's new height.
        window.requestAnimationFrame(() => {
          update();
        });
      }
    });
  }

  if (topExposureAddressSearch) {
    topExposureAddressSearch.value = state.topExposureAddressQuery;
    topExposureAddressSearch.addEventListener("focus", () => {
      triggerEcoFullDataLoadFromSearchFocus();
    });
    topExposureAddressSearch.addEventListener("input", () => {
      state.topExposureAddressQuery = topExposureAddressSearch.value.trim();
      resetTopExposurePagination();
      triggerEcoFullDataLoadFromFirstFilter();
      clearPreResetSnapshot();
      update();
    });
  }

  document.getElementById("snapshotFilter").addEventListener("change", async (event) => {
    try {
      clearPreResetSnapshot();
      await loadSnapshotData(event.target.value);
      if (isSnapshotReportModalOpen()) {
        setSnapshotReportLoadingState(`Loading summary for ${snapshotHeightLabel(event.target.value) || event.target.value}...`);
        await loadSnapshotReportIntoModal();
      }
    } catch (err) {
      console.error(err);
      renderEmptyKpis();
    }
  });

  const scriptDropdown = document.getElementById("scriptDropdown");
  const scriptTrigger = document.getElementById("scriptDropdownTrigger");
  const scriptMenu = document.getElementById("scriptDropdownMenu");
  const spendDropdown = document.getElementById("spendDropdown");
  const spendTrigger = document.getElementById("spendDropdownTrigger");
  const spendMenu = document.getElementById("spendDropdownMenu");
  const detailDropdown = document.getElementById("detailDropdown");
  const detailTrigger = document.getElementById("detailDropdownTrigger");
  const detailMenu = document.getElementById("detailDropdownMenu");
  const identityGroupDropdown = document.getElementById("identityGroupDropdown");
  const identityGroupTrigger = document.getElementById("identityGroupDropdownTrigger");
  const identityGroupMenu = document.getElementById("identityGroupDropdownMenu");
  const identityDropdown = document.getElementById("identityDropdown");
  const identityTrigger = document.getElementById("identityDropdownTrigger");
  const identityMenu = document.getElementById("identityDropdownMenu");
  let identityPointerDownInside = false;

  scriptTrigger.addEventListener("click", () => {
    scriptMenu.classList.toggle("open");
  });

  spendTrigger.addEventListener("click", () => {
    spendMenu.classList.toggle("open");
  });

  detailTrigger.addEventListener("click", () => {
    detailMenu.classList.toggle("open");
  });

  identityGroupTrigger.addEventListener("click", async () => {
    const willOpen = !identityGroupMenu.classList.contains("open");
    identityGroupMenu.classList.toggle("open");
    if (willOpen && !state.identityGroupsLoaded) {
      await ensureIdentityGroupsLoaded();
      renderTopExposureTagFilters();
    }
  });

  identityTrigger.addEventListener("focus", async () => {
    if (!state.identityGroupsLoaded) {
      await ensureIdentityGroupsLoaded();
      renderTopExposureTagFilters();
    }
    identityMenu.classList.add("open");
  });

  identityTrigger.addEventListener("click", async () => {
    if (!state.identityGroupsLoaded) {
      await ensureIdentityGroupsLoaded();
      renderTopExposureTagFilters();
    }
    identityMenu.classList.add("open");
  });

  identityTrigger.addEventListener("input", async () => {
    if (!state.identityGroupsLoaded) {
      await ensureIdentityGroupsLoaded();
    }
    state.identityTagFilterQuery = identityTrigger.value;
    renderIdentityTagMenu(buildTagOptionsFromGe1Rows(state.selectedIdentityGroups).identities, state.selectedIdentityTags);
    attachIdentityCheckboxListeners();
    identityMenu.classList.add("open");
  });

  identityTrigger.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      clearIdentityTagFilterInput();
      identityMenu.classList.remove("open");
      identityTrigger.blur();
    }
  });

  identityDropdown.addEventListener("pointerdown", () => {
    identityPointerDownInside = true;
  });

  identityTrigger.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (identityPointerDownInside) {
        identityPointerDownInside = false;
        return;
      }
      if (!identityDropdown.contains(document.activeElement)) {
        clearIdentityTagFilterInput();
      }
    }, 0);
  });

  document.addEventListener("click", (event) => {
    identityPointerDownInside = false;
    if (!scriptDropdown.contains(event.target)) {
      scriptMenu.classList.remove("open");
    }
    if (!spendDropdown.contains(event.target)) {
      spendMenu.classList.remove("open");
    }
    if (!detailDropdown.contains(event.target)) {
      detailMenu.classList.remove("open");
    }
    if (!identityGroupDropdown.contains(event.target)) {
      identityGroupMenu.classList.remove("open");
    }
    if (!identityDropdown.contains(event.target)) {
      clearIdentityTagFilterInput();
      identityMenu.classList.remove("open");
    }
  });

  getScriptCheckboxes().forEach((el) => {
    el.addEventListener("change", () => handleScriptCheckboxChange(el));
  });

  getSpendCheckboxes().forEach((el) => {
    el.addEventListener("change", () => handleSpendCheckboxChange(el));
  });

  document.getElementById("topExposuresList").addEventListener("scroll", () => {
    syncTopExposuresShowMoreVisibility();
    tryLoadMoreTopExposures();
  });

  let resizeRafId = null;
  window.addEventListener("resize", () => {
    if (resizeRafId !== null) return;

    resizeRafId = window.requestAnimationFrame(() => {
      resizeRafId = null;
      updateAnalysisSplitHeight();
      syncTopExposuresShowMoreVisibility();
      applyConditionalMiddleEllipsis(document.getElementById("topExposuresList"));
      update();
    });
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    applyTheme(resolveInitialTheme());
  });

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    const payload = event.data;
    if (!payload || payload.type !== "quantum-dashboard-theme") return;
    const theme = payload.theme === "dark" ? "dark" : "light";
    applyTheme(theme);
    persistTheme(theme);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!isSnapshotReportModalOpen()) return;
    closeSnapshotReportModal();
  });

  updateScriptTriggerLabel();
  updateSpendTriggerLabel();
  updateScriptPanelModeUi();
  updateTopExposuresFiltersUi();
  updateScriptPanelDetailsUi();
}

(async function init() {
  try {
    runtimeLiteMode = resolveInitialRuntimeLiteMode();
    applyPersistedFilterState(readPersistedFilters());
    const urlPrefs = readFiltersFromUrl();
    if (urlPrefs) {
      applyPersistedFilterState(urlPrefs);
    }
    applyTheme(resolveInitialTheme());
    applyRuntimeModeUi();
    attachEvents();
    await loadData();
  } catch (err) {
    renderEmptyKpis();
    console.error(err);
  }
})();
