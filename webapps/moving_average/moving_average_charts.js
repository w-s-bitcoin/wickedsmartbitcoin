(function () {
  "use strict";
  const C = window.WSBDashboardCharting;
  const M = window.WSBMovingAverageModel;
  const DAY = 86400000;
  const money = (value) => C.formatCurrency(value);
  const kpiFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const kpiMoney = (value) => kpiFormatter.format(value);
  function palette(theme) {
    const light = theme === "light";
    return { bg: light ? "#ffffff" : "#000000", fg: light ? "#202a30" : "#f1f5f7",
      muted: light ? "#6f685f" : "#95a6ae", grid: light ? "#e2ded7" : "#242d32",
      hover: light ? "rgba(75, 85, 99, 0.55)" : "rgba(120, 120, 120, 0.7)",
      lines: [light ? "#008b99" : "#00e4e8", light ? "#b96900" : "#ff9900"] };
  }
  function setup(canvas) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d"); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { ctx, width, height };
  }
  function indexAt(rows, time) {
    let lo = 0, hi = rows.length - 1;
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (rows[mid].time < time) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function niceLinearTicks(min, max, count) {
    // Match the DCA dashboards: anchor ticks to round multiples instead of
    // dividing the padded data bounds into arbitrary intervals.
    const rawStep = (max - min) / Math.max(1, count - 1);
    const exponent = Math.floor(Math.log10(rawStep));
    const steps = [-1, 0, 1].flatMap((offset) => [1, 2, 2.5, 5, 10].map((base) => base * 10 ** (exponent + offset)));
    let index = steps.findIndex((step) => step >= rawStep);
    for (; index >= 0; index--) {
      const step = steps[index], epsilon = step * 1e-9;
      const first = Math.ceil((min - epsilon) / step), last = Math.floor((max + epsilon) / step);
      if (last - first < 2 && index > 0) continue;
      return C.createLinearTicks(first * step, last * step, last - first + 1).map((value) => Number(value.toPrecision(15)));
    }
    return [];
  }
  function scaleGeometry(dataMin, dataMax, plot, logarithmic) {
    const inset = Math.min(16, plot.height / 4);
    let min = logarithmic ? Math.log10(dataMin) : dataMin;
    let max = logarithmic ? Math.log10(dataMax) : dataMax;
    if (min === max) {
      const span = logarithmic ? 0.12 : dataMax * 0.08;
      min -= span / 2; max += span / 2;
    }
    const padding = (max - min) * inset / Math.max(1, plot.height - inset * 2);
    min -= padding; max += padding;
    return { min, max, priceMin: logarithmic ? 10 ** min : min, priceMax: logarithmic ? 10 ** max : max,
      y: (value) => logarithmic && value <= 0 ? plot.bottom : C.valueToY(logarithmic ? Math.log10(value) : value, min, max, plot) };
  }
  function scaleTicks(axis, logarithmic, count) {
    let ticks = logarithmic && axis.priceMax / axis.priceMin >= 10
      ? C.createLogTicks(axis.priceMin, axis.priceMax, { minor: axis.priceMax / axis.priceMin < 100 })
      : niceLinearTicks(axis.priceMin, axis.priceMax, count);
    let lastY = Infinity;
    return ticks.filter((value) => {
      if (value < 0 || (logarithmic && value === 0)) return false;
      const y = axis.y(value);
      if (Math.abs(y - lastY) < 22) return false;
      lastY = y; return true;
    });
  }
  function morphTicks(linearTicks, logTicks, mix, y) {
    const byValue = new Map();
    function add(value, source) {
      const key = Number(value.toPrecision(12));
      if (!byValue.has(key)) byValue.set(key, { value: key, linear: false, log: false });
      byValue.get(key)[source] = true;
    }
    linearTicks.forEach((value) => add(value, "linear"));
    logTicks.forEach((value) => add(value, "log"));
    const ticks = Array.from(byValue.values()).sort((a, b) => a.value - b.value).map((tick) => ({
      ...tick, y: y(tick.value), shared: tick.linear && tick.log,
      alpha: (tick.linear ? 1 - mix : 0) + (tick.log ? mix : 0), visibility: 1,
    }));
    // The two nice-tick sets travel with the data rather than changing their
    // numeric labels. Fade crowded labels before they meet; shared ticks stay
    // fully visible. No transient arbitrary numbers or overprinted labels.
    for (let i = 0; i < ticks.length; i++) {
      for (let j = i + 1; j < ticks.length; j++) {
        const a = ticks[i], b = ticks[j], distance = Math.abs(a.y - b.y);
        if (distance >= 22) continue;
        const t = Math.max(0, Math.min(1, (distance - 16) / 6));
        const clearance = t * t * (3 - 2 * t);
        if (a.shared || b.shared) {
          const unique = a.shared ? b : a;
          if (!unique.shared) unique.visibility = Math.min(unique.visibility, clearance);
        } else if (a.linear !== b.linear) {
          for (const tick of [a, b]) {
            const phase = tick.linear ? Math.max(0, 1 - 2 * mix) : Math.max(0, 2 * mix - 1);
            tick.visibility = Math.min(tick.visibility, clearance + (1 - clearance) * phase);
          }
        } else {
          a.visibility = Math.min(a.visibility, clearance);
        }
      }
    }
    // Zero has no logarithmic position. Give it one continuous fade instead of
    // letting passing positive log ticks hide it and then reveal it again.
    // Nearby log-only ticks still yield through the collision rules above.
    return ticks.map((tick) => ({ ...tick, alpha: tick.value === 0
      ? (1 - mix) * Math.max(0, 1 - 2 * mix)
      : tick.alpha * tick.visibility })).filter((tick) => tick.alpha > 0);
  }
  function drawMorphAxis(ctx, ticks, plot, colors, fontSize) {
    ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = colors.grid;
    ctx.fillStyle = colors.muted; ctx.font = `${fontSize}px IBM Plex Mono, monospace`;
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    for (const tick of ticks) {
      if (tick.y < plot.top - 0.5 || tick.y > plot.bottom + 0.5) continue;
      ctx.globalAlpha = tick.alpha;
      ctx.beginPath(); ctx.moveTo(plot.left, tick.y); ctx.lineTo(plot.right, tick.y); ctx.stroke();
      ctx.fillText(axisMoney(tick.value), plot.right + 8, tick.y);
    }
    ctx.restore();
  }
  function calendarTicks(start, end, unit, step, limit) {
    const ticks = [], date = new Date(start);
    let cursor;
    if (unit === "month") {
      const month = Math.floor((date.getUTCFullYear() * 12 + date.getUTCMonth()) / step) * step;
      cursor = Date.UTC(Math.floor(month / 12), month % 12, 1);
    } else if (unit === "year") {
      cursor = Date.UTC(Math.floor(date.getUTCFullYear() / step) * step, 0, 1);
    } else {
      const anchor = unit === "week" ? Date.UTC(1970, 0, 4) : 0;
      const interval = step * DAY * (unit === "week" ? 7 : 1);
      cursor = anchor + Math.ceil((start - anchor) / interval) * interval;
    }
    while (cursor <= end) {
      if (cursor >= start) {
        ticks.push(cursor);
        if (ticks.length > limit) break;
      }
      const at = new Date(cursor);
      cursor = unit === "month" ? Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + step, 1)
        : unit === "year" ? Date.UTC(at.getUTCFullYear() + step, 0, 1)
          : cursor + step * DAY * (unit === "week" ? 7 : 1);
    }
    return ticks;
  }
  function dateAxisTicks(start, end, plot, ctx) {
    const intervals = [
      ["day", 1], ["day", 2], ["week", 1], ["week", 2],
      ["month", 1], ["month", 2], ["month", 3], ["month", 6],
      ...[1, 2, 5, 10, 20, 50, 100].map((step) => ["year", step]),
    ];
    const limit = Math.max(2, Math.floor(plot.width / 65) + 1);
    for (const [unit, step] of intervals) {
      const times = calendarTicks(start, end, unit, step, limit);
      if (!times.length || times.length > limit) continue;
      let previousYear, previousRight = -Infinity;
      const ticks = times.map((time) => {
        const date = new Date(time), year = date.getUTCFullYear();
        const yearLabel = unit === "year" || (unit === "month" && date.getUTCMonth() === 0);
        const label = yearLabel ? String(year) : C.formatDateTick(time, {
          day: unit === "day" || unit === "week" ? "numeric" : undefined,
          year: year !== previousYear ? "numeric" : undefined,
        });
        previousYear = year;
        const half = ctx.measureText(label).width / 2;
        const x = C.valueToX(time, start, end, plot);
        const labelX = Math.max(plot.left + half, Math.min(plot.right - half, x));
        const fits = labelX - half >= previousRight + 10 && half * 2 <= plot.width;
        previousRight = labelX + half;
        return { time, label, x, labelX, fits };
      });
      if (ticks.every((tick) => tick.fits)) return ticks;
    }
    return [];
  }
  function panel(ctx, rect, options) {
    const { model, series, lines, endIndex, startTime, scale = "linear", theme = "dark", title = "", hoverIndex = -1, compact = false } = options;
    const rows = model.rows, colors = palette(theme);
    const activeIndices = lines.flatMap((line, index) => line.type === "none" ? [] : [index]);
    const endTime = rows[endIndex].time, minTime = Math.min(startTime, endTime - DAY);
    const startIndex = Math.max(0, indexAt(rows, minTime) - 1);
    ctx.save(); ctx.translate(rect.x || 0, rect.y || 0);
    ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, rect.width, rect.height);
    const fontSize = Math.max(10, Math.min(13, rect.width / 40));
    const plot = C.getPlotRect(rect.width, rect.height, compact
      ? { left: 8, right: 8, top: 0, bottom: 0 }
      : { left: 12, right: rect.width < 370 ? 65 : 84, top: title ? 35 : 16, bottom: 32 });
    let min = Infinity, max = -Infinity;
    function include(v) { if (Number.isFinite(v) && v > 0) { min = Math.min(min, v); max = Math.max(max, v); } }
    for (let i = startIndex; i <= endIndex; i++) {
      if (rows[i].time < minTime) continue;
      include(rows[i].price); activeIndices.forEach((index) => include(series[index]?.[i]));
    }
    if (!Number.isFinite(min)) { min = rows[endIndex].price; max = min; }
    const dataMin = min, dataMax = max;
    // Blend the independently padded screen coordinates, as in the reference
    // animation. Data extrema retain exactly the same inset in every frame.
    const mix = Number.isFinite(options.scaleMix) ? Math.max(0, Math.min(1, options.scaleMix)) : scale === "log" ? 1 : 0;
    const linearAxis = scaleGeometry(dataMin, dataMax, plot, false);
    const logAxis = scaleGeometry(dataMin, dataMax, plot, true);
    const x = (t) => C.valueToX(t, minTime, endTime, plot);
    const y = (v) => mix === 0 ? linearAxis.y(v) : mix === 1 ? logAxis.y(v) : linearAxis.y(v) * (1 - mix) + logAxis.y(v) * mix;
    function yToValue(at) {
      const fraction = Math.max(0, Math.min(1, (plot.bottom - at) / Math.max(1, plot.height)));
      if (mix === 0) return linearAxis.min + (linearAxis.max - linearAxis.min) * fraction;
      if (mix === 1) return 10 ** (logAxis.min + (logAxis.max - logAxis.min) * fraction);
      // The blended transform is monotone. Search in log space so cent-scale
      // values retain precision even when the history also reaches six figures.
      let low = Math.log10(Math.min(dataMin, logAxis.priceMin, linearAxis.priceMin > 0 ? linearAxis.priceMin : dataMin));
      let high = Math.log10(Math.max(dataMax, linearAxis.priceMax, logAxis.priceMax));
      for (let i = 0; i < 56; i++) {
        const middle = (low + high) / 2;
        if (y(10 ** middle) > at) low = middle; else high = middle;
      }
      return 10 ** ((low + high) / 2);
    }
    if (!compact) {
      const tickCount = Math.max(3, Math.min(6, Math.floor(plot.height / 55)));
      if (mix === 0 || mix === 1) {
        const logarithmic = mix === 1, axis = logarithmic ? logAxis : linearAxis;
        const ticks = scaleTicks(axis, logarithmic, tickCount);
        const axisTicks = logarithmic ? ticks.map(Math.log10) : ticks;
        C.drawGridLines(ctx, axisTicks, axis.min, axis.max, plot, { color: colors.grid });
        C.drawRightAxisLabels(ctx, axisTicks, axis.min, axis.max, plot, (v) => axisMoney(logarithmic ? 10 ** v : v), { color: colors.muted, font: `${fontSize}px IBM Plex Mono, monospace` });
      } else {
        drawMorphAxis(ctx, morphTicks(scaleTicks(linearAxis, false, tickCount), scaleTicks(logAxis, true, tickCount), mix, y), plot, colors, fontSize);
      }
      ctx.font = `${fontSize}px IBM Plex Mono, monospace`; ctx.fillStyle = colors.muted;
      const dateTicks = dateAxisTicks(minTime, endTime, plot, ctx);
      ctx.textAlign = "center";
      for (const tick of dateTicks) {
        ctx.strokeStyle = colors.grid; ctx.beginPath(); ctx.moveTo(tick.x, plot.top); ctx.lineTo(tick.x, plot.bottom); ctx.stroke();
        ctx.fillText(tick.label, tick.labelX, plot.bottom + 22);
      }
    }
    ctx.save(); ctx.beginPath(); ctx.rect(plot.left, plot.top, plot.width, plot.height); ctx.clip();
    function draw(getValue, color, unit, width) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = "round"; ctx.beginPath(); let started = false, points = 0, last = null;
      // Include one prior sampled point so the line meets the left viewport edge.
      let from = startIndex;
      if (unit) while (from > 0 && !M.isSampleDate(rows[from].time, unit)) from--;
      for (let i = from; i <= endIndex; i++) {
        if (unit && i !== endIndex && !M.isSampleDate(rows[i].time, unit)) continue;
        const value = getValue(i);
        if (!Number.isFinite(value) || value <= 0) { started = false; continue; }
        const px = plot.left + (rows[i].time - minTime) / (endTime - minTime) * plot.width;
        const py = y(value);
        if (!started) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        started = true; points++; last = { x: px, y: py };
      }
      ctx.stroke();
      if (points === 1 && last) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(last.x, last.y, 3, 0, Math.PI * 2); ctx.fill(); }
    }
    draw((i) => rows[i].price, colors.fg, null, 1.3);
    activeIndices.forEach((i) => draw((j) => series[i]?.[j], colors.lines[i], lines[i].unit, 2.2));
    if (!compact && hoverIndex >= 0 && hoverIndex <= endIndex && rows[hoverIndex].time >= minTime) {
      ctx.strokeStyle = colors.hover; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x(rows[hoverIndex].time), plot.top); ctx.lineTo(x(rows[hoverIndex].time), plot.bottom); ctx.stroke();
    }
    ctx.restore();
    if (!compact && title) { ctx.fillStyle = colors.fg; ctx.font = "600 14px Space Grotesk, sans-serif"; ctx.textAlign = "left"; ctx.fillText(title, 12, 20, rect.width - 24); }
    ctx.restore();
    return { plot, startTime: minTime, endTime, endIndex, scaleMix: mix, valueToY: y, yToValue,
      yPadding: { top: y(dataMax) - plot.top, bottom: plot.bottom - y(dataMin) } };
  }
  function axisMoney(v) {
    v = Number(v.toPrecision(12));
    if (v === 0) return "$0";
    if (v >= 0 && v < 1) return `${C.formatCompactNumber(Number((v * 100).toPrecision(12)), { maximumFractionDigits: 8 })}¢`;
    const unit = v >= 1e6 ? 1e6 : v >= 1e3 ? 1e3 : 1;
    const suffix = unit === 1e6 ? "m" : unit === 1e3 ? "k" : "";
    // Keep fractional steps distinct and remove floating-point noise from the
    // logarithmic transform without changing KPI or tooltip formatting.
    return `$${C.formatCompactNumber(Number((v / unit).toPrecision(12)), { maximumFractionDigits: 8 })}${suffix}`;
  }
  function windowTitle(line) {
    const type = line.type === "ema" ? "EMA" : "SMA";
    return `${line.period} ${{ day: "Day", week: "Week", month: "Month" }[line.unit]} ${type} Window`;
  }
  function hoverValue(model, values, line, index, endIndex, scale = "linear", geometry) {
    if (line.type === "none") return { value: null, interpolated: false };
    if (line.unit === "day" || index === endIndex || M.isSampleDate(model.rows[index].time, line.unit)) return { value: values[index], interpolated: false };
    let before = index, after = index;
    while (before > 0 && !M.isSampleDate(model.rows[before].time, line.unit)) before--;
    while (after < endIndex && !M.isSampleDate(model.rows[after].time, line.unit)) after++;
    if (!Number.isFinite(values[before]) || !Number.isFinite(values[after])) return { value: null, interpolated: false };
    const fraction = (model.rows[index].time - model.rows[before].time) / (model.rows[after].time - model.rows[before].time);
    if (geometry && geometry.scaleMix > 0 && geometry.scaleMix < 1) {
      const beforeY = geometry.valueToY(values[before]), afterY = geometry.valueToY(values[after]);
      return { value: geometry.yToValue(beforeY + (afterY - beforeY) * fraction), interpolated: true };
    }
    const logarithmic = geometry ? geometry.scaleMix === 1 : scale === "log";
    const value = logarithmic
      ? Math.exp(Math.log(values[before]) + (Math.log(values[after]) - Math.log(values[before])) * fraction)
      : values[before] + (values[after] - values[before]) * fraction;
    return { value, interpolated: true };
  }
  function composite(ctx, width, height, options) {
    const { model, lines, series, endIndex, startIndex = 0, scales = ["log", "linear", "linear"], theme = "dark", compact = false } = options;
    const colors = palette(theme), end = model.rows[endIndex], gap = 14;
    const activeIndices = lines.flatMap((line, index) => line.type === "none" ? [] : [index]);
    ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, width, height);
    const header = compact ? 8 : 84, footer = compact ? 8 : 36;
    if (!compact) {
      ctx.fillStyle = colors.fg; ctx.textAlign = "left"; ctx.font = "700 23px Space Grotesk, sans-serif";
      ctx.fillText("Moving Average", 16, 28);
      ctx.font = "13px IBM Plex Mono, monospace"; ctx.fillText(`${end.date}  ·  BTC ${kpiMoney(end.price)}`, 16, 52);
      activeIndices.forEach((i, position) => { ctx.fillStyle = colors.lines[i]; ctx.fillText(`${M.label(lines[i], true)}  ${Number.isFinite(series[i]?.[endIndex]) ? kpiMoney(series[i][endIndex]) : "Insufficient history"}`, 16 + position * Math.max(230, width / 2), 73); });
    }
    const area = height - header - footer;
    const portrait = width < height;
    let layouts = portrait
      ? [{ x: 0, y: header, width, height: area * 0.46 }, { x: 0, y: header + area * 0.46 + gap, width, height: area * 0.27 - gap }, { x: 0, y: header + area * 0.73 + gap, width, height: area * 0.27 - gap }]
      : [{ x: 0, y: header, width: (width - gap) / 2, height: area }, { x: (width + gap) / 2, y: header, width: (width - gap) / 2, height: (area - gap) / 2 }, { x: (width + gap) / 2, y: header + (area + gap) / 2, width: (width - gap) / 2, height: (area - gap) / 2 }];
    if (activeIndices.length === 1) {
      layouts = portrait
        ? [{ x: 0, y: header, width, height: area * 0.55 }, { x: 0, y: header + area * 0.55 + gap, width, height: area * 0.45 - gap }]
        : [{ x: 0, y: header, width: (width - gap) / 2, height: area }, { x: (width + gap) / 2, y: header, width: (width - gap) / 2, height: area }];
    } else if (!activeIndices.length) {
      layouts = [{ x: 0, y: header, width, height: area }];
    }
    layouts.forEach((rect, position) => {
      const lineIndex = activeIndices[position - 1], line = lines[lineIndex];
      panel(ctx, rect, { model, lines, series, endIndex, theme, compact, scale: scales[position ? lineIndex + 1 : 0],
        startTime: position ? M.windowStart(end.time, line.period, line.unit) : model.rows[startIndex].time,
        title: position ? windowTitle(line) : `Price & moving average${activeIndices.length === 1 ? "" : "s"}` });
    });
    if (!compact) window.WSBDashboardExport.drawFooterUrl(ctx, "wickedsmartbitcoin.com/moving_average", { width, height, footerHeight: footer, outerMargin: 12 }, {
      theme, orientation: portrait ? "portrait" : width === height ? "square" : "landscape",
    });
  }
  window.WSBMovingAverageCharts = { palette, setup, panel, composite, money, kpiMoney, indexAt, windowTitle, hoverValue };
}());
