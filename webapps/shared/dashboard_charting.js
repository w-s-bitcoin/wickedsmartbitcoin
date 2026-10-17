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

  // The selected mode belongs to dashboard state. This controller owns only
  // transient screen geometry, so shared links and exports never save a blend.
  function createScaleTransitionController({ render, duration = 700 } = {}) {
    const transitions = new Map();
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let frame = 0, paintCycle = 0, disposed = false;
    const endpoint = (mode) => mode === "log" ? 1 : 0;
    const now = () => window.performance.now();
    function finish(key) {
      if (key === undefined) transitions.clear(); else transitions.delete(key);
      if (!transitions.size && frame) { window.cancelAnimationFrame(frame); frame = 0; }
    }
    function paint() {
      frame = 0;
      if (disposed) return;
      if (document.hidden) { finish(); return; }
      paintCycle++;
      for (const entry of transitions.values()) entry.ready = true;
      render?.();
      // A panel may have been hidden or removed while it was transitioning.
      const time = now();
      for (const [key, entry] of transitions) {
        if (entry.cycle !== paintCycle && time >= entry.started + entry.duration) transitions.delete(key);
      }
      schedule();
    }
    function schedule() {
      if (!disposed && transitions.size && !frame) frame = window.requestAnimationFrame(paint);
    }
    function getMix(key, targetMode) {
      const target = endpoint(targetMode), entry = transitions.get(key);
      if (!entry) return target;
      if (entry.to !== target || motion?.matches || document.hidden) { finish(key); return target; }
      // The click's synchronous render shows exactly the previous shape. Start
      // advancing on RAF, after any control/layout work in the event handler.
      const progress = entry.ready ? clamp((now() - entry.started) / entry.duration, 0, 1) : 0;
      const mix = entry.from + (entry.to - entry.from) * (1 - Math.cos(Math.PI * progress)) / 2;
      entry.lastMix = mix;
      entry.cycle = paintCycle;
      if (progress === 1) finish(key);
      return mix;
    }
    function start(key, fromMode, toMode) {
      if (disposed) return;
      const target = endpoint(toMode);
      // Reversals begin at the last painted shape, including a click between
      // animation frames. They must not jump ahead to an unpainted position.
      const from = transitions.get(key)?.lastMix ?? endpoint(fromMode);
      finish(key);
      if (motion?.matches || document.hidden || from === target) return;
      transitions.set(key, { from, to: target, lastMix: from, cycle: -1, ready: false, started: now(),
        duration: Math.max(120, Math.max(1, duration) * Math.abs(target - from)) });
      schedule();
    }
    function settle() { finish(); if (!disposed && !document.hidden) render?.(); }
    function visibilityChanged() { if (document.hidden) finish(); else if (!disposed) render?.(); }
    motion?.addEventListener?.("change", settle);
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pagehide", finishAll);
    window.addEventListener("pageshow", settle);
    function finishAll() { finish(); }
    return { start, getMix, finish,
      isAnimating: (key) => key === undefined ? transitions.size > 0 : transitions.has(key),
      destroy() {
        disposed = true; finish();
        motion?.removeEventListener?.("change", settle);
        document.removeEventListener("visibilitychange", visibilityChanged);
        window.removeEventListener("pagehide", finishAll);
        window.removeEventListener("pageshow", settle);
      },
    };
  }

  // Move the original tick values with the blended chart coordinates. Keep
  // common ticks visible, and crossfade distinct sets before labels collide.
  function morphScaleTicks(linearTicks, logTicks, mix, valueToY, { spacing = 22 } = {}) {
    mix = clamp(mix, 0, 1);
    const byValue = new Map();
    function add(value, source) {
      if (!Number.isFinite(value)) return;
      const key = Number(value.toPrecision(12));
      if (!byValue.has(key)) byValue.set(key, { value: key, linear: false, log: false });
      byValue.get(key)[source] = true;
    }
    linearTicks.forEach((value) => add(value, "linear"));
    logTicks.forEach((value) => add(value, "log"));
    const ticks = Array.from(byValue.values()).sort((a, b) => a.value - b.value).map((tick) => ({
      ...tick, y: valueToY(tick.value), shared: tick.linear && tick.log,
      alpha: (tick.linear ? 1 - mix : 0) + (tick.log ? mix : 0), visibility: 1,
    })).filter((tick) => Number.isFinite(tick.y));
    const gap = Math.max(1, spacing), clearStart = gap * 16 / 22;
    for (let i = 0; i < ticks.length; i++) {
      for (let j = i + 1; j < ticks.length; j++) {
        const a = ticks[i], b = ticks[j], distance = Math.abs(a.y - b.y);
        if (distance >= gap) continue;
        const t = clamp((distance - clearStart) / (gap - clearStart), 0, 1);
        const clearance = t * t * (3 - 2 * t);
        if (a.shared || b.shared) {
          const unique = a.shared ? b : a;
          if (!unique.shared) unique.visibility = Math.min(unique.visibility, clearance);
        } else if (a.linear !== b.linear) {
          for (const tick of [a, b]) {
            const phase = tick.linear ? Math.max(0, 1 - 2 * mix) : Math.max(0, 2 * mix - 1);
            tick.visibility = Math.min(tick.visibility, clearance + (1 - clearance) * phase);
          }
        } else a.visibility = Math.min(a.visibility, clearance);
      }
    }
    return ticks.map((tick) => ({ ...tick, alpha: tick.value === 0 && !tick.shared
      ? (tick.linear ? (1 - mix) * Math.max(0, 1 - 2 * mix) : mix * Math.max(0, 2 * mix - 1))
      : tick.alpha * tick.visibility })).filter((tick) => tick.alpha > 0);
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
  ns.createScaleTransitionController = createScaleTransitionController;
  ns.morphScaleTicks = morphScaleTicks;
}());
