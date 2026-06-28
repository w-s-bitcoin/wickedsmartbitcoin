#!/usr/bin/env bash
set -euo pipefail

slug="${1:-}"
title="${2:-}"

if [[ -z "$slug" || -z "$title" ]]; then
  echo "Usage: $0 <slug> \"Dashboard Title\"" >&2
  exit 2
fi

if [[ ! "$slug" =~ ^[a-z0-9_]+$ ]]; then
  echo "Slug must use lowercase letters, numbers, and underscores only." >&2
  exit 2
fi

dashboard_dir="webapps/$slug"
if [[ -e "$dashboard_dir" || -e "$slug.html" ]]; then
  echo "Refusing to overwrite existing dashboard files for: $slug" >&2
  exit 1
fi

mkdir -p "$dashboard_dir"

cat > "$dashboard_dir/dashboard_manifest.js" <<JS
window.WSBDashboardManifest = {
  slug: "$slug",
  title: "$title",
  description: "Dashboard description.",
  url: "https://wickedsmartbitcoin.com/$slug",
};
JS

cat > "$dashboard_dir/dashboard.html" <<HTML
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style id="wsb-early-black">html,body{background:#000;color:#f1f5f7;}:root[data-theme="light"],:root[data-theme="light"] body{background:#f4f5f7;color:#111827;}</style>
  <title>$title</title>
  <script src="../shared/dashboard_embed_modal.js"></script>
  <script src="dashboard_manifest.js"></script>
  <script src="../shared/dashboard_components.js"></script>
  <script src="../shared/dashboard_charting.js"></script>
  <script src="../shared/dashboard_export.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../shared/dashboard_shared.css" />
  <link rel="stylesheet" href="../shared/dashboard_controls.css" />
  <link rel="stylesheet" href="dashboard.css" />
</head>
<body>
  <div class="wrap">
    <header class="topbar" aria-label="$title controls">
      <div class="title-row">
        <h1 class="title">$title</h1>
        <div class="info-wrap">
          <button type="button" class="info-btn" aria-label="About this dashboard" aria-describedby="${slug}InfoPopover">?</button>
          <div class="info-popover" id="${slug}InfoPopover" role="tooltip">
            Loading dashboard description.
          </div>
        </div>
      </div>
      <div class="title-actions">
        <button type="button" class="copy-link-btn" id="copyDashboardLink" aria-label="Copy shareable dashboard link" data-tooltip="Copy shareable dashboard link">
          <span class="btn-icon" aria-hidden="true"></span>
          <span class="btn-label">Copy Link</span>
        </button>
        <button type="button" class="reset-dashboard-btn" id="resetDashboard" disabled aria-label="Restore dashboard defaults" data-tooltip="Reset dashboard to defaults">
          <span class="btn-icon" aria-hidden="true"></span>
          <span class="btn-label">Restore Defaults</span>
        </button>
      </div>
      <div class="chips" id="statusChips">
        <div class="chip-menu-wrap single-select" id="updatedChipWrap">
          <div class="chip chip-kpi-display" id="chipUpdated"><span class="chip-label">Updated</span> <span id="updatedKpi" class="chip-value">-</span></div>
          <div id="updatedTimeZoneDropdown" class="dca-dropdown dca-dropdown-overlay">
            <button id="updatedTimeZoneDropdownTrigger" type="button" class="dca-dropdown-trigger" aria-label="Updated timestamp time zone"></button>
            <div id="updatedTimeZoneDropdownMenu" class="dca-dropdown-menu" aria-label="Updated timestamp time zone options"></div>
          </div>
          <select id="updatedTimeZoneSelect" class="chip-menu-select chip-kpi-select-overlay dca-native-select" aria-label="Updated timestamp time zone"></select>
        </div>
      </div>
    </header>

    <main class="panel dashboard-chart-frame">
      <canvas id="dashboardCanvas"></canvas>
      <div class="dashboard-ring-loader" id="chartLoader" role="status" aria-live="polite" aria-label="Loading chart">
        <span class="chart-loader-ring" aria-hidden="true"></span>
      </div>
    </main>
  </div>
  <script src="../../js/11_dashboard_timezone_preferences.js"></script>
  <script src="dashboard_app.js"></script>
</body>
</html>
HTML

cat > "$dashboard_dir/dashboard.css" <<CSS
:root {
  --bg: #000000;
  --fg: #f1f5f7;
  --muted: #95a6ae;
  --panel: #000000;
  --accent: #ff9f1c;
  --wrap-grid-template-rows: auto minmax(var(--panel-min-height), 1fr);
}

body {
  background: var(--bg);
  color: var(--fg);
  font-family: "Space Grotesk", "Helvetica Neue", sans-serif;
}

.topbar,
.panel {
  border: 1px solid var(--panel-border);
  border-radius: 14px;
  background: var(--panel);
}

.topbar {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
}

.panel {
  min-height: var(--panel-min-height);
  overflow: hidden;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
}
CSS

cat > "$dashboard_dir/dashboard_app.js" <<JS
(function () {
  const manifest = window.WSBDashboardComponents?.getDashboardManifest?.({
    slug: "$slug",
    title: "$title",
    description: "Dashboard description.",
    url: "https://wickedsmartbitcoin.com/$slug",
  }) || {};
  const canvas = document.getElementById("dashboardCanvas");
  const ctx = canvas?.getContext?.("2d");
  const chartLoader = document.getElementById("chartLoader");
  const copyButton = document.getElementById("copyDashboardLink");
  const resetButton = document.getElementById("resetDashboard");
  const dashboardTime = window.WSBDashboardTime || null;
  const updatedTimeZoneChip = window.WSBDashboardComponents?.createUpdatedTimeZoneChipController?.({
    getTimeZone: () => dashboardTime?.getPreferredTimeZone?.() || "UTC",
    setTimeZone: (value) => dashboardTime?.setPreferredTimeZone?.(value) || value || "UTC",
    onChange: () => syncUpdatedKpi(),
  });
  const ICONS = {
    copyLink: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
    copyCopied: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>',
    resetDefaults: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>',
  };

  function setButtonIcon(button, icon) {
    const iconEl = button?.querySelector?.(".btn-icon");
    if (iconEl) iconEl.innerHTML = icon || "";
  }

  function resize() {
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function draw() {
    if (!canvas || !ctx) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--muted") || "#95a6ae";
    ctx.font = "500 14px IBM Plex Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("$title", width / 2, height / 2);
    window.WSBDashboardComponents?.setChartLoaderVisible?.(chartLoader, false);
  }

  function syncUpdatedKpi() {
    updatedTimeZoneChip?.setText("-");
  }

  setButtonIcon(copyButton, ICONS.copyLink);
  setButtonIcon(resetButton, ICONS.resetDefaults);
  syncUpdatedKpi();
  window.WSBDashboardComponents?.initDashboardRuntime?.({
    manifest,
    copyButton,
    resetButton,
    getShareUrl: () => manifest.url || window.location.href,
    copyDefaultIcon: ICONS.copyLink,
    copyCopiedIcon: ICONS.copyCopied,
    resetDefaultIcon: ICONS.resetDefaults,
    setCopyIcon: (icon) => setButtonIcon(copyButton, icon),
    setResetIcon: (icon) => setButtonIcon(resetButton, icon),
    onReset: () => resize(),
  });

  window.addEventListener("resize", resize);
  resize();
}());
JS

cat > "$dashboard_dir/preview.html" <<HTML
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>$title Preview</title>
  <script src="../shared/preview_shared.js"></script>
</head>
<body>
  <canvas id="previewCanvas"></canvas>
  <script src="preview_app.js"></script>
</body>
</html>
HTML

cat > "$dashboard_dir/preview_app.js" <<JS
(function () {
  window.WSBPreviewShared?.markReady?.({ filename: "$slug" });
}());
JS

cat > "$dashboard_dir/standalone_bootstrap.js" <<JS
(function () {
  window.WSBStandaloneDashboards = window.WSBStandaloneDashboards || {};
  window.WSBStandaloneDashboards["$slug"] = {
    title: "$title",
    href: "$slug.html",
    dashboard: "webapps/$slug/dashboard.html",
    preview: "webapps/$slug/preview.html",
  };
}());
JS

cat > "$slug.html" <<HTML
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>$title</title>
  <meta http-equiv="refresh" content="0; url=webapps/$slug/dashboard.html" />
</head>
<body>
  <a href="webapps/$slug/dashboard.html">$title</a>
</body>
</html>
HTML

echo "Created dashboard scaffold: $dashboard_dir"
echo "Next: wire data/rendering, register the dashboard on the home grid, then run scripts/check_dashboard_contract.sh $dashboard_dir"
