(function () {
  "use strict";
  const C = window.WSBDashboardCharting;
  const LOW = 10 ** -4.275, HIGH = 10 ** 7.275, UNVALUED = 0.000105;
  const TICKS = [0.00011, ...C.createLogTicks(0.001, 1e7)];
  const LABELS = ["Not Valued", "0.1¢", "1¢", "10¢", "$1", "$10", "$100", "$1k", "$10k", "$100k", "$1M", "$10M"];
  // Colors sampled from the supplied reference's colorbar, bottom to top.
  // The image's updated 10%–100,000,000% range supersedes the older notebook.
  const COLORS = ["#000000", "#180404", "#370b0b", "#5b1111", "#721616", "#951d1d", "#ac2121", "#bb422d", "#c25b36", "#cc7d42", "#dcac5e", "#e9ce77", "#e9dc9f", "#e4ddb8", "#dcdcdd", "#c9ced8", "#aebad1", "#97a8cb", "#7e96c5", "#6180be", "#5373b6", "#4c64a0", "#475a93", "#404c7f", "#393f6d", "#33325b", "#2d254a", "#271838", "#211329"];
  const rgb = COLORS.map((color) => [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16)));
  const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
  const count = (row) => row.epochBlockCount ?? row.count;
  const growthPosition = (value) => clamp((Math.log10(Math.max(10, value)) - 1) / 7);
  function gradientColor(position) {
    const value = clamp(position) * (rgb.length - 1), index = Math.min(rgb.length - 2, Math.floor(value)), mix = value - index;
    return `rgb(${rgb[index].map((channel, i) => Math.round(channel + (rgb[index + 1][i] - channel) * mix)).join(",")})`;
  }
  function growthColor(value) { return Number.isFinite(value) ? gradientColor(growthPosition(value)) : "#999999"; }
  function growthTextColor(value, theme = "dark") {
    if (!Number.isFinite(value)) return palette(theme).fg;
    // The legend deliberately approaches black for losses/small gains. Keep the
    // numerical KPI readable on black, as in the supplied reference.
    if (theme !== "light" && value < 400) return "#b72222";
    if (theme === "light" && value >= 2500 && value < 200000) return "#815716";
    return growthColor(value);
  }
  function growthLabel(value) {
    if (!Number.isFinite(value)) return "—";
    const digits = Math.abs(value) >= 1000 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
    return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + "%";
  }
  function kpiMoney(value) {
    if (!Number.isFinite(value) || value <= 0) return "—";
    if (value >= 1) return "$" + value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const cents = value * 100, digits = cents < 0.01 ? Math.min(8, 1 - Math.floor(Math.log10(cents))) : 2;
    return cents.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + "¢";
  }
  function palette(theme) {
    const light = theme === "light";
    return { bg: light ? "#ffffff" : "#000000", fg: light ? "#202a30" : "#ffffff", muted: light ? "#665f58" : "#95a6ae",
      grid: light ? "#d7d2c9" : "#383838", minorGrid: light ? "#e6e2dc" : "#292929", outline: light ? "#ffffff" : "#000000" };
  }
  function setup(canvas) {
    const rect = canvas.getBoundingClientRect(), width = Math.max(1, rect.width), height = Math.max(1, rect.height);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d"); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { ctx, width, height };
  }
  function getFrame(options) { return options.frame || window.WSBEOEGrowthModel.frame(options.model, options.endIndex ?? options.model.rows.length - 1); }
  function geometry(plot) {
    return { plot, valueToX: (value) => C.valueToX(value, -5000, 215000, plot),
      valueToY: (value) => C.valueToY(value > 0 ? value : UNVALUED, LOW, HIGH, plot, "log"),
      blockAtX: (value) => clamp(-5000 + (value - plot.left) / plot.width * 220000, 1, 210000) };
  }
  function nearest(rows, block) {
    if (window.WSBEOEGrowthModel.nearestRow) return window.WSBEOEGrowthModel.nearestRow(rows, block);
    let low = 0, high = rows.length - 1;
    while (low < high) { const middle = (low + high) >> 1; if (count(rows[middle]) < block) low = middle + 1; else high = middle; }
    if (low && block - count(rows[low - 1]) <= count(rows[low]) - block) low--;
    return rows[low];
  }
  function inspect(frame, block) {
    return frame.epochs.flatMap((epoch) => {
      if (!epoch.rows.length || block < count(epoch.rows[0]) || block > count(epoch.rows.at(-1))) return [];
      return [nearest(epoch.rows, block)];
    });
  }
  function drawSeries(ctx, frame, g, options = {}) {
    const { plot, valueToX: x, valueToY: y } = g, colors = options.colors || palette("dark"), width = options.lineWidth || 2;
    ctx.save(); ctx.beginPath(); ctx.rect(plot.left, plot.top, plot.width, plot.height); ctx.clip();
    // Draw later epochs first: older epoch bands retain the notebook's layering.
    for (const epoch of [...frame.epochs].reverse()) {
      const rows = epoch.rows;
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1], b = rows[i];
        if (!(a.price > 0 && b.price > 0 && a.previousPrice > 0 && b.previousPrice > 0)) continue;
        ctx.fillStyle = growthColor(b.growth);
        ctx.beginPath(); ctx.moveTo(x(count(a)), y(a.price)); ctx.lineTo(x(count(b)), y(b.price));
        ctx.lineTo(x(count(b)), y(b.previousPrice)); ctx.lineTo(x(count(a)), y(a.previousPrice)); ctx.closePath(); ctx.fill();
        // Adjacent daily polygons share an edge. Cover subpixel antialiasing
        // seams without changing their data vertices or the overlaid price line.
        ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.6; ctx.stroke();
      }
    }
    for (const epoch of [...frame.epochs].reverse()) {
      const rows = epoch.rows;
      // Unvalued observations form their own baseline; do not invent a price
      // transition from that sentinel to the first recorded market price.
      for (const valued of [false, true]) {
        ctx.beginPath(); let connected = false, points = 0, last;
        for (const row of rows) {
          if ((row.price > 0) !== valued) { connected = false; continue; }
          last = [x(count(row)), y(row.price)];
          if (connected) ctx.lineTo(...last); else ctx.moveTo(...last);
          connected = true; points++;
        }
        ctx.lineJoin = "round"; ctx.lineCap = "round";
        ctx.strokeStyle = colors.outline; ctx.lineWidth = width + 3; ctx.globalAlpha = 0.6; ctx.stroke();
        ctx.globalAlpha = 1; ctx.strokeStyle = colors.fg; ctx.lineWidth = width; ctx.stroke();
        if (points === 1) { ctx.fillStyle = colors.fg; ctx.beginPath(); ctx.arc(...last, width, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    if (options.markers !== false) {
      for (const epoch of frame.epochs) {
        const row = epoch.marker || nearest(epoch.rows, count(frame.row));
        if (!row) continue;
        ctx.beginPath(); ctx.arc(x(count(row)), y(row.price), width * 1.2, 0, Math.PI * 2);
        ctx.fillStyle = colors.fg; ctx.fill(); ctx.strokeStyle = colors.outline; ctx.lineWidth = width * 0.6; ctx.stroke();
      }
    }
    ctx.restore();
  }
  function drawLegend(ctx, rect, growth, options = {}) {
    const { horizontal = false, colors = palette("dark"), font = (size) => { ctx.font = `${size}px IBM Plex Mono, monospace`; }, fontSize = 11, allLabels = true } = options;
    const { x, y, width, height } = rect;
    ctx.save();
    const gradient = ctx.createLinearGradient(x, y + height, horizontal ? x + width : x, horizontal ? y + height : y);
    COLORS.forEach((color, index) => gradient.addColorStop(index / (COLORS.length - 1), color));
    ctx.fillStyle = gradient; ctx.fillRect(x, y, width, height); ctx.strokeStyle = "#777"; ctx.lineWidth = 1; ctx.strokeRect(x, y, width, height);
    font(fontSize); ctx.fillStyle = colors.fg; ctx.textBaseline = horizontal ? "top" : "middle";
    for (let exponent = 1; exponent <= 8; exponent++) {
      if (!allLabels && ![1, 4, 8].includes(exponent)) continue;
      const position = (exponent - 1) / 7;
      const label = `${exponent === 1 ? "≤" : exponent === 8 ? "≥" : ""}${(10 ** exponent).toLocaleString("en-US")}%`;
      if (horizontal) {
        ctx.textAlign = exponent === 1 ? "left" : exponent === 8 ? "right" : "center";
        ctx.fillText(label, x + position * width, y + height + 6);
      } else {
        const py = y + (1 - position) * height;
        ctx.beginPath(); ctx.moveTo(x + width, py); ctx.lineTo(x + width + 7, py); ctx.stroke();
        ctx.textAlign = "left"; ctx.fillText(label, x + width + 13, py);
      }
    }
    if (Number.isFinite(growth)) {
      const position = growthPosition(growth), size = options.pointerSize || 8;
      const px = horizontal ? x + position * width : x, py = horizontal ? y : y + (1 - position) * height;
      ctx.strokeStyle = colors.fg; ctx.lineWidth = 1.5; ctx.fillStyle = growthColor(growth);
      ctx.beginPath();
      if (horizontal) { ctx.moveTo(px, py); ctx.lineTo(px - size, py - size * 1.3); ctx.lineTo(px + size, py - size * 1.3); }
      else { ctx.moveTo(px, py); ctx.lineTo(px - size * 1.7, py - size); ctx.lineTo(px - size * 1.7, py + size); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(horizontal ? px : x + width, horizontal ? y + height : py); ctx.stroke();
    }
    ctx.restore();
  }
  function drawAxes(ctx, frame, g, options = {}) {
    const { plot, valueToX: x, valueToY: y } = g;
    const colors = options.colors || palette("dark"), fontSize = options.fontSize || 12;
    const font = options.font || ((size) => { ctx.font = `${size}px IBM Plex Mono, monospace`; });
    ctx.save(); font(fontSize); ctx.textBaseline = "middle";
    C.drawGridLines(ctx, TICKS, LOW, HIGH, plot, { color: colors.grid, scale: "log", lineWidth: options.gridWidth || 1 });
    ctx.fillStyle = colors.fg; ctx.textAlign = "right";
    let lastLabelY = Infinity;
    TICKS.forEach((tick, i) => {
      const py = y(tick); if (lastLabelY - py < fontSize * 1.35) return;
      ctx.fillText(LABELS[i], plot.left - (options.tickPad || 8), py); lastLabelY = py;
    });
    const major = options.xTicks || (plot.width < 460 ? [1, 70000, 140000, 210000] : [1, 30000, 60000, 90000, 120000, 150000, 180000, 210000]);
    for (let block = 0; block <= 210000; block += 10000) {
      ctx.strokeStyle = block % 30000 ? colors.minorGrid : colors.grid; ctx.lineWidth = options.gridWidth || 1;
      ctx.beginPath(); ctx.moveTo(x(block), plot.top); ctx.lineTo(x(block), plot.bottom); ctx.stroke();
    }
    ctx.textAlign = "center"; ctx.fillStyle = colors.fg;
    for (const block of major) {
      const label = options.shortCounts && block >= 1000 ? `${block / 1000}k` : String(block);
      ctx.fillText(label, x(block), plot.bottom + (options.xLabelOffset || 19));
    }
    font(options.epochFontSize || Math.max(10, fontSize * 0.66));
    const labelEnds = (side) => {
      const entries = frame.epochs.filter((epoch) => epoch.rows.length && (side === "left" || epoch.epoch !== frame.row.epoch))
        .map((epoch) => ({ epoch: epoch.epoch, row: side === "left" ? epoch.rows[0] : epoch.rows.at(-1) }))
        .sort((a, b) => y(a.row.price) - y(b.row.price));
      let previous = -Infinity;
      for (const entry of entries) {
        const py = Math.max(y(entry.row.price), previous + (options.epochFontSize || 10) + 2);
        if (py > plot.bottom) continue;
        ctx.textAlign = side === "left" ? "right" : "left";
        ctx.fillText(`E${entry.epoch}`, side === "left" ? x(1) - 9 : x(210000) + 9, py); previous = py;
      }
    };
    if (!options.omitLeftEpochLabels) labelEnds("left");
    labelEnds("right");
    ctx.restore();
  }
  function panel(ctx, rect, options) {
    const frame = getFrame(options), colors = palette(options.theme), compact = options.compact === true;
    const horizontal = rect.width < 700;
    ctx.save(); ctx.translate(rect.x || 0, rect.y || 0); ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, rect.width, rect.height);
    const plot = C.getPlotRect(rect.width, rect.height, compact ? {} : { left: rect.width < 400 ? 77 : 85, right: horizontal ? 22 : 145, top: 16, bottom: horizontal ? 110 : 58 });
    const g = geometry(plot);
    if (!compact) drawAxes(ctx, frame, g, { colors, fontSize: rect.width < 400 ? 10 : 12, shortCounts: horizontal, omitLeftEpochLabels: plot.width < 600 });
    drawSeries(ctx, frame, g, { colors, lineWidth: compact ? 1.25 : 1.7, markers: !compact });
    if (!compact) {
      ctx.fillStyle = colors.muted; ctx.font = "12px Space Grotesk, sans-serif"; ctx.textAlign = "center";
      ctx.fillText("Epoch Block Count", plot.left + plot.width / 2, plot.bottom + 43);
      if (horizontal) drawLegend(ctx, { x: plot.left, y: plot.bottom + 66, width: plot.width, height: 10 }, frame.row.growth, { horizontal: true, colors, fontSize: 9, allLabels: false, pointerSize: 5 });
      else drawLegend(ctx, { x: plot.right + 35, y: plot.top + 10, width: 12, height: plot.height - 20 }, frame.row.growth, { colors, fontSize: 10 });
      if (Number.isFinite(options.hoverBlockCount)) {
        ctx.strokeStyle = colors.muted; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath();
        ctx.moveTo(g.valueToX(options.hoverBlockCount), plot.top); ctx.lineTo(g.valueToX(options.hoverBlockCount), plot.bottom); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    ctx.restore(); return { ...g, frame };
  }
  window.WSBEOEGrowthCharts = { setup, palette, panel, inspect, getFrame, geometry, drawSeries, drawAxes, drawLegend, kpiMoney, growthColor, growthTextColor, growthLabel, growthPosition };
}());
