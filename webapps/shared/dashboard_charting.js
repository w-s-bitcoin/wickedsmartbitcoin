(function () {
  const ns = window.WSBDashboardCharting = window.WSBDashboardCharting || {};

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getPlotRect(width, height, padding = {}) {
    const left = Number(padding.left) || 0;
    const right = Number(padding.right) || 0;
    const top = Number(padding.top) || 0;
    const bottom = Number(padding.bottom) || 0;
    return {
      x: left,
      y: top,
      width: Math.max(0, width - left - right),
      height: Math.max(0, height - top - bottom),
      left,
      right: Math.max(left, width - right),
      top,
      bottom: Math.max(top, height - bottom),
    };
  }

  function valueToY(value, min, max, plot, scale = "linear") {
    if (!plot) return 0;
    const safeMax = max > min ? max : min + 1;
    if (scale === "log") {
      const safeMin = Math.max(Number.EPSILON, min);
      const safeValue = Math.max(safeMin, value);
      const minLog = Math.log10(safeMin);
      const maxLog = Math.log10(Math.max(safeMin * 10, safeMax));
      const ratio = (Math.log10(safeValue) - minLog) / Math.max(Number.EPSILON, maxLog - minLog);
      return plot.bottom - clamp(ratio, 0, 1) * plot.height;
    }
    const ratio = (value - min) / Math.max(Number.EPSILON, safeMax - min);
    return plot.bottom - clamp(ratio, 0, 1) * plot.height;
  }

  function valueToX(value, min, max, plot) {
    if (!plot) return 0;
    const ratio = (value - min) / Math.max(Number.EPSILON, max - min);
    return plot.left + clamp(ratio, 0, 1) * plot.width;
  }

  function createLinearTicks(min, max, count = 5, options = {}) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
    const steps = Math.max(1, count - 1);
    const ticks = [];
    for (let i = 0; i <= steps; i += 1) ticks.push(min + ((max - min) * i / steps));
    if (options.excludeTop) ticks.pop();
    if (options.wholeNumbers) return ticks.map(Math.round).filter((value, index, list) => index === 0 || value !== list[index - 1]);
    return ticks;
  }

  function createLogTicks(min, max, options = {}) {
    const safeMin = Math.max(Number.EPSILON, min);
    if (!Number.isFinite(safeMin) || !Number.isFinite(max) || max <= safeMin) return [];
    const minPow = Math.floor(Math.log10(safeMin));
    const maxPow = Math.ceil(Math.log10(max));
    const ticks = [];
    for (let pow = minPow; pow <= maxPow; pow += 1) {
      const base = 10 ** pow;
      const multipliers = options.minor ? [1, 2, 5] : [1];
      multipliers.forEach((multiplier) => {
        const value = base * multiplier;
        if (value >= safeMin && value <= max) ticks.push(value);
      });
    }
    const unique = Array.from(new Set(ticks)).sort((a, b) => a - b);
    if (options.excludeTop) return unique.filter((value) => value < max);
    return unique;
  }

  function drawGridLines(ctx, ticks, min, max, plot, options = {}) {
    if (!ctx || !plot || !Array.isArray(ticks)) return;
    ctx.save();
    ctx.strokeStyle = options.color || "rgba(149, 166, 174, 0.16)";
    ctx.lineWidth = Number(options.lineWidth) || 1;
    ticks.forEach((tick) => {
      const y = valueToY(tick, min, max, plot, options.scale);
      if (y < plot.top - 0.5 || y > plot.bottom + 0.5) return;
      ctx.beginPath();
      ctx.moveTo(plot.left, y);
      ctx.lineTo(plot.right, y);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawRightAxisLabels(ctx, ticks, min, max, plot, formatter, options = {}) {
    if (!ctx || !plot || !Array.isArray(ticks)) return;
    ctx.save();
    ctx.fillStyle = options.color || "#95a6ae";
    ctx.font = options.font || "600 13px IBM Plex Mono, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const x = plot.right + (Number(options.offset) || 8);
    ticks.forEach((tick) => {
      const y = valueToY(tick, min, max, plot, options.scale);
      if (y < plot.top - 0.5 || y > plot.bottom + 0.5) return;
      ctx.fillText(typeof formatter === "function" ? formatter(tick) : String(tick), x, y);
    });
    ctx.restore();
  }

  function formatCompactNumber(value, options = {}) {
    if (!Number.isFinite(value)) return "--";
    const maximumFractionDigits = Number.isInteger(options.maximumFractionDigits) ? options.maximumFractionDigits : 2;
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits,
    });
  }

  function formatCurrency(value, options = {}) {
    if (!Number.isFinite(value)) return "--";
    const abs = Math.abs(value);
    const maximumFractionDigits = abs >= 100000 ? 0 : abs >= 1 ? 2 : 4;
    return `$${value.toLocaleString("en-US", {
      minimumFractionDigits: options.fixed ? maximumFractionDigits : 0,
      maximumFractionDigits,
    })}`;
  }

  function formatDateTick(date, options = {}) {
    const parsed = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toLocaleDateString("en-US", {
      month: options.month || "short",
      day: options.day,
      year: options.year,
      timeZone: options.timeZone || "UTC",
    });
  }

  ns.clamp = clamp;
  ns.getPlotRect = getPlotRect;
  ns.valueToX = valueToX;
  ns.valueToY = valueToY;
  ns.createLinearTicks = createLinearTicks;
  ns.createLogTicks = createLogTicks;
  ns.drawGridLines = drawGridLines;
  ns.drawRightAxisLabels = drawRightAxisLabels;
  ns.formatCompactNumber = formatCompactNumber;
  ns.formatCurrency = formatCurrency;
  ns.formatDateTick = formatDateTick;
}());
