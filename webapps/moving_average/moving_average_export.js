(function () {
  "use strict";
  const M = window.WSBMovingAverageModel, C = window.WSBDashboardCharting;
  const DAY = 86400000, FONT = '"Moving Average DejaVu"';
  const base = new URL("assets/", document.currentScript.src);
  const units = { day: "Day", week: "Week", month: "Month" };
  const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  let assets;

  function ready() {
    if (!assets) assets = (async () => {
      const faces = [new FontFace("Moving Average DejaVu", `url(${new URL("DejaVuSans.ttf", base)})`),
        new FontFace("Moving Average DejaVu", `url(${new URL("DejaVuSans-Bold.ttf", base)})`, { weight: "700" })];
      // The notebook's raster heading uses Arial Black. Use the installed face
      // where available; the bundled bold face is the offline fallback.
      const heading = new FontFace("Moving Average Heading", 'local("Arial Black")', { weight: "900" });
      const logo = new Image(); logo.src = new URL("bitcoin-wordmark.jpg", base).href;
      await Promise.all([...faces.map(async (face) => { await face.load(); document.fonts.add(face); }), logo.decode(),
        heading.load().then((face) => document.fonts.add(face)).catch(() => {})]);
      return { logo };
    })().catch((error) => { assets = null; throw error; });
    return assets;
  }
  let logo;
  async function prepare() { ({ logo } = await ready()); }
  function font(ctx, size, bold = false) { ctx.font = `${bold ? "700" : "400"} ${size}px ${FONT}, sans-serif`; }
  function fullLabel(line) { return `${line.period} ${units[line.unit]} ${line.type === "ema" ? "Exponential " : ""}Moving Average`; }
  function shortLabel(line) {
    return line.type === "ema" ? `${line.period}${line.unit[0].toUpperCase()} EMA:` : `${line.period} ${line.unit[0].toUpperCase()}MA:`;
  }
  function usd(value, digits = 2) {
    return Number.isFinite(value) ? "$" + value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "N/A";
  }
  const statistic = (value) => window.WSBMovingAverageCharts.kpiMoney(value);
  function logLabel(value) {
    if (value < 1) return `${Number((value * 100).toPrecision(8))}¢`;
    const divisor = value >= 1e9 ? 1e9 : value >= 1e6 ? 1e6 : value >= 1e3 ? 1e3 : 1;
    return `$${Number((value / divisor).toPrecision(8))}${divisor === 1e9 ? "b" : divisor === 1e6 ? "m" : divisor === 1e3 ? "k" : ""}`;
  }
  function linearTicks(min, max, count) {
    const rough = (max - min) / count, power = 10 ** Math.floor(Math.log10(rough));
    const step = ([1, 2, 2.5, 5, 10].find((v) => v * power >= rough) || 10) * power;
    const first = Math.ceil(min / step), last = Math.floor(max / step);
    return C.createLinearTicks(first * step, last * step, Math.max(1, last - first + 1));
  }
  function dateTicks(start, end, width) {
    // Calendar-aligned locators, independent of the changing label widths. Never
    // clamp the first/last label: that made labels stick then jump at the edges.
    const { times: ticks } = C.createCalendarTicks(start, end, {
      maxTicks: Math.max(2, Math.floor(width / 90)), minUnit: "month", density: "span", fallback: true,
    });
    const yearsOnly = ticks.every((time) => { const at = new Date(time); return at.getUTCMonth() === 0 && at.getUTCDate() === 1; });
    return ticks.map((time) => {
      const at = new Date(time), year = String(at.getUTCFullYear());
      return { time, label: yearsOnly ? year : `${String(at.getUTCMonth() + 1).padStart(2, "0")}-${year}` };
    });
  }
  function plot(ctx, rect, options, panelIndex, active, colors) {
    const { model, lines, series, endIndex, startIndex = 0, scales = ["log", "linear", "linear"] } = options;
    const rows = model.rows, activeTime = rows[endIndex].time, lineIndex = active[panelIndex - 1];
    const line = lines[lineIndex], scale = scales[panelIndex ? lineIndex + 1 : 0], logarithmic = scale === "log";
    const { startTime, endTime } = panelIndex ? M.windowBounds(activeTime, line.period, line.unit)
      : { startTime: rows[startIndex].time, endTime: activeTime };
    const span = Math.max(DAY, endTime - startTime), leftTime = Math.min(startTime, endTime - DAY) - span * 0.01;
    const first = Math.max(0, window.WSBMovingAverageCharts.indexAt(rows, startTime) - 1);
    let min = Infinity, max = -Infinity;
    const include = (v) => { if (Number.isFinite(v) && v > 0) { min = Math.min(min, v); max = Math.max(max, v); } };
    for (let i = first; i <= endIndex; i++) {
      if (rows[i].time < leftTime) continue;
      include(rows[i].price); active.forEach((j) => include(series[j]?.[i]));
    }
    if (!Number.isFinite(min)) min = max = rows[endIndex].price;
    const transform = logarithmic ? Math.log10 : (v) => v;
    let low = transform(min), high = transform(max);
    const range = high - low || (logarithmic ? 0.12 : Math.max(max * 0.08, 0.00001));
    if (high === low) { low -= range / 2; high += range / 2; }
    // Notebook: 2% padding in transformed space, fixed 1% left time margin.
    low -= range * 0.02; high += range * 0.02;
    const x = (time) => rect.x + (time - leftTime) / (endTime - leftTime) * rect.width;
    const y = (value) => rect.y + rect.height * (1 - (transform(value) - low) / (high - low));
    const tickCount = Math.max(3, Math.floor(rect.height / 33));
    let ticks;
    if (logarithmic && high - low >= 1) {
      ticks = [];
      const step = Math.max(1, Math.ceil((high - low) / tickCount));
      for (let exponent = Math.ceil(low); exponent <= high; exponent += step) ticks.push(10 ** exponent);
    } else ticks = linearTicks(logarithmic ? 10 ** low : low, logarithmic ? 10 ** high : high, tickCount);
    const digits = max < 0.01 ? 4 : max < 0.1 ? 3 : max < 10 ? 2 : 0;
    ctx.save(); font(ctx, 64 / 3); ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillStyle = colors.fg; ctx.strokeStyle = colors.grid; ctx.lineWidth = 0.8;
    let lastTickY = Infinity;
    for (const value of ticks) {
      if (logarithmic && value <= 0) continue;
      const at = y(value); if (at < rect.y - 0.01 || at > rect.y + rect.height + 0.01) continue;
      // Sub-decade log ranges use round currency ticks, whose upper values
      // crowd together after the log transform. Keep their labels separated.
      if (lastTickY - at < 28) continue;
      lastTickY = at;
      ctx.beginPath(); ctx.moveTo(rect.x, at); ctx.lineTo(rect.x + rect.width, at); ctx.stroke();
      ctx.fillText(logarithmic ? logLabel(value) : usd(value, digits), rect.x + rect.width + 11, at);
    }
    for (const tick of dateTicks(leftTime, endTime, rect.width)) {
      const at = x(tick.time);
      ctx.beginPath(); ctx.moveTo(at, rect.y); ctx.lineTo(at, rect.y + rect.height); ctx.stroke();
      ctx.save(); ctx.translate(at + 4, rect.y + rect.height + 11); ctx.rotate(Math.PI / 6);
      ctx.textBaseline = "top"; ctx.fillText(tick.label, 0, 0); ctx.restore();
    }
    ctx.save(); ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.width, rect.height); ctx.clip();
    function draw(values, color, unit, width) {
      let from = first, started = false, count = 0, last;
      if (unit) while (from > 0 && !M.isSampleDate(rows[from].time, unit)) from--;
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = "round";
      for (let i = from; i <= endIndex; i++) {
        if (unit && i !== endIndex && !M.isSampleDate(rows[i].time, unit)) continue;
        const value = values(i); if (!Number.isFinite(value) || value <= 0) { started = false; continue; }
        const px = x(rows[i].time), py = y(value);
        if (started) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        started = true; last = [px, py]; count++;
      }
      ctx.stroke();
      if (count === 1) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(...last, width / 2, 0, Math.PI * 2); ctx.fill(); }
    }
    // Matplotlib uses points at 96 dpi; preserve its dense/sparse stroke balance.
    const spacing = rect.width / Math.max(1, span / DAY), mix = Math.max(0, Math.min(1, spacing - 1));
    draw((i) => rows[i].price, colors.fg, null, (panelIndex ? 1.5 + mix * 0.5 : 1 + mix) * 4 / 3);
    active.forEach((j) => draw((i) => series[j]?.[i], colors.lines[j], lines[j].unit, (panelIndex ? (span / DAY < 400 ? 3 : 2.5) : 2) * 4 / 3));
    ctx.restore();
    const title = `${panelIndex ? `${line.period} ${units[line.unit]}${line.type === "ema" ? " EMA" : ""} Window` : startIndex ? "Selected History" : "Full History"} (${logarithmic ? "Log" : "Linear"})`;
    font(ctx, 24, true); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = colors.fg;
    ctx.fillText(title, rect.x + rect.width / 2, rect.y - 22, rect.width);
    ctx.restore();
  }
  function layout(width, height, count) {
    if (width > height) {
      return { width: 1920, height: 1080, kpi: { x: 48, y: 41 }, title: { x: 345, y: 67, width: 1238 }, logo: { x: 1670, y: 32, width: 200 },
        plots: count === 1 ? [{ x: 48, y: 147, width: 798, height: 742 }, { x: 976, y: 147, width: 798, height: 742 }]
          : [{ x: 48, y: 147, width: 798, height: 742 }, { x: 976, y: 147, width: 798, height: 301 }, { x: 976, y: 572, width: 798, height: 302 }] };
    }
    const portrait = height > width, h = portrait ? 1920 : 1080;
    return { width: 1080, height: h, kpi: { x: 48, y: 117 }, title: { x: 48, y: 52, width: 984 }, logo: { x: 832, y: 109, width: 200 },
      plots: portrait
        ? (count === 1 ? [{ x: 48, y: 260, width: 864, height: 760 }, { x: 48, y: 1150, width: 864, height: 610 }]
          : [{ x: 48, y: 260, width: 864, height: 650 }, { x: 48, y: 1045, width: 864, height: 300 }, { x: 48, y: 1480, width: 864, height: 270 }])
        : (count === 1 ? [{ x: 48, y: 260, width: 864, height: 330 }, { x: 48, y: 700, width: 864, height: 210 }]
          : [{ x: 48, y: 260, width: 864, height: 330 }, { x: 48, y: 700, width: 362, height: 210 }, { x: 550, y: 700, width: 362, height: 210 }]) };
  }
  function render(ctx, width, height, options) {
    const { model, lines, series, endIndex, theme = "dark" } = options, row = model.rows[endIndex];
    const active = lines.flatMap((line, index) => line.type === "none" ? [] : [index]);
    const l = layout(width, height, active.length), light = theme === "light";
    const colors = { bg: light ? "#fff" : "#000", fg: light ? "#111" : "#fff", grid: light ? "#bfbfbf" : "#404040", lines: ["#00ffff", "#ff9900"] };
    ctx.save(); ctx.scale(width / l.width, height / l.height); ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, l.width, l.height);
    ctx.fillStyle = colors.fg; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const labels = active.map((i) => fullLabel(lines[i])), join = " & ";
    const headingFont = (size) => { ctx.font = `900 ${size}px "Moving Average Heading", ${FONT}, sans-serif`; };
    headingFont(42);
    const title = labels.join(join) || "Bitcoin Price", titleSize = Math.min(42, 42 * l.title.width / ctx.measureText(title).width);
    headingFont(titleSize);
    let titleX = l.title.x + (l.title.width - ctx.measureText(title).width) / 2;
    labels.forEach((text, index) => {
      ctx.fillStyle = colors.fg; ctx.fillText(text, titleX, l.title.y);
      const length = ctx.measureText(text).width;
      ctx.fillStyle = colors.lines[active[index]]; ctx.fillRect(titleX, l.title.y + 7, length, 3); titleX += length;
      if (index < labels.length - 1) { ctx.fillStyle = colors.fg; ctx.fillText(join, titleX, l.title.y); titleX += ctx.measureText(join).width; }
    });
    if (!labels.length) { ctx.fillStyle = colors.fg; ctx.fillText(title, titleX, l.title.y); }
    font(ctx, 64 / 3); ctx.fillStyle = colors.fg;
    ctx.fillText(`Date: ${dateFormat.format(row.time)}`, l.kpi.x, l.kpi.y);
    ctx.fillText(`Price: ${statistic(row.price)}`, l.kpi.x, l.kpi.y + 24);
    active.forEach((i, position) => {
      const label = shortLabel(lines[i]), y = l.kpi.y + 48 + position * 24;
      ctx.fillStyle = colors.lines[i]; ctx.fillText(label, l.kpi.x, y);
      // Only static labels determine the anchor. DejaVu's tabular digits and
      // fixed baselines keep changing values from moving surrounding content.
      const valueX = l.kpi.x + ctx.measureText(label + " ").width;
      ctx.fillStyle = colors.fg; ctx.fillText(statistic(series[i]?.[endIndex]), valueX, y);
    });
    if (logo) {
      ctx.save(); if (light) ctx.filter = "invert(1) hue-rotate(180deg)";
      ctx.drawImage(logo, l.logo.x, l.logo.y, l.logo.width, l.logo.width * logo.height / logo.width); ctx.restore();
    }
    // Fixed right-hand gutters fit the axis text without shifting plots as
    // prices change or the selected scale switches between linear and log.
    l.plots.slice(0, 1 + active.length).forEach((rect, i) => plot(ctx, rect, options, i, active, colors));
    window.WSBDashboardExport.drawFooterUrl(ctx, "https://wickedsmartbitcoin.com/moving_average", { width: l.width, height: l.height, footerHeight: l.width > l.height ? 100 : 70 }, {
      theme, orientation: l.width > l.height ? "landscape" : l.width === l.height ? "square" : "portrait",
    });
    ctx.restore();
  }
  window.WSBMovingAverageExport = { ready: prepare, render };
}());
