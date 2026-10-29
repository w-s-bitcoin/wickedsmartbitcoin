(function () {
  "use strict";
  const B = window.WSBDashboardExportBranding, C = window.WSBDashboardCharting;
  const DAY = 86400000, YEAR = 365.25;
  const HALVINGS = [
    { label: "1st Halving", date: "2012-11-28" },
    { label: "2nd Halving", date: "2016-07-09" },
    { label: "3rd Halving", date: "2020-05-11" },
    { label: "4th Halving", date: "2024-04-20" },
  ];

  function layout(width, height) {
    // Coordinates are in the notebook/reference's 1920 × 1080 drawing space.
    // Video quality and PNG resolution scale the same composition uniformly.
    if (width > height) return {
      width: 1920, height: 1080, orientation: "landscape",
      title: { x: 890, y: 57, width: 1180 }, logo: { x: 30, y: 32, width: 200 },
      date: { x: 1888, y: 43, width: 408, size: 27 }, blockY: 78,
      plot: { left: 39, top: 115, right: 1722, bottom: 859, width: 1683, height: 744 },
      axisRight: 1888, tickSize: 32, priceSize: 36, xTickY: 884, xTitleY: 936,
      halvingSize: 21.3, calloutSize: 22, footerHeight: 122,
    };
    const portrait = height > width, bottom = portrait ? 1682 : 855;
    return {
      width: 1080, height: portrait ? 1920 : 1080, orientation: portrait ? "portrait" : "square",
      title: { x: 540, y: 45, width: 1000, subtitleY: 91 }, logo: { x: 34, y: 135, width: 200 },
      date: { x: 1046, y: 147, width: 740, size: 27 }, blockY: 184,
      plot: { left: 34, top: 235, right: 900, bottom, width: 866, height: bottom - 235 },
      axisRight: 1046, tickSize: 26, priceSize: 30, xTickY: bottom + 31,
      xTitleY: portrait ? 1779 : 936, halvingSize: 18, calloutSize: 22, footerHeight: 117,
    };
  }

  function money(value) {
    const magnitude = Math.abs(value);
    const digits = magnitude > 0 && magnitude < 1 ? Math.min(8, Math.max(2, 2 - Math.floor(Math.log10(magnitude))))
      : magnitude > 0 && magnitude < 100 ? 2 : 0;
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: digits })}`;
  }

  function niceStep(value) {
    const power = 10 ** Math.floor(Math.log10(Math.max(Number.MIN_VALUE, value)));
    return ([1, 2, 2.5, 5, 10].find((factor) => factor * power >= value) || 10) * power;
  }

  function linearTicks(min, max, count) {
    const step = niceStep((max - min) / count), ticks = [];
    for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-8; value += step) {
      ticks.push(Math.abs(value) < step * 1e-8 ? 0 : Number(value.toPrecision(12)));
      if (ticks.length > 50) break;
    }
    return ticks;
  }

  function timestampText(value, timeZone) {
    // The published CSV stores UTC timestamps without an explicit zone. Do not
    // let the viewer's local timezone reinterpret the recorded snapshot time.
    const raw = typeof value === "string" ? value.trim() : value;
    const utc = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw)
      ? `${raw.replace(" ", "T")}Z` : raw;
    const date = new Date(utc);
    if (!Number.isFinite(date.getTime())) return "Date unavailable";
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC", year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short",
    }).formatToParts(date);
    const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${p.month} ${p.day}, ${p.year} ${p.hour}:${p.minute} (${p.timeZoneName})`;
  }

  function durationTicks(maxDays, plotWidth) {
    const count = plotWidth > 1200 ? 8 : 5;
    let unit = "Day", length = 1, step;
    if (maxDays >= YEAR) {
      unit = "Year"; length = YEAR;
      step = 2 ** Math.max(0, Math.ceil(Math.log2(maxDays / YEAR / count)));
    } else if (maxDays >= 60) {
      unit = "Month"; length = YEAR / 12;
      step = [1, 2, 3, 6, 12].find((value) => maxDays / length / value <= count) || 12;
    } else step = Math.max(1, Math.ceil(niceStep(maxDays / count)));
    const ticks = [{ days: 1, label: "1 Day" }];
    for (let n = step; n * length <= maxDays + 1e-8; n += step) {
      if (n * length <= 1) continue;
      ticks.push({ days: n * length, label: `${n} ${unit}${n === 1 ? "" : "s"}` });
    }
    return ticks;
  }

  function render(ctx, width, height, options) {
    const rows = (options.rows || []).filter((row) => Number.isFinite(Number(row.daysAgo)) && Number(row.daysAgo) >= 1)
      .slice().sort((a, b) => Number(a.daysAgo) - Number(b.daysAgo));
    if (!rows.length) throw new Error("No DCA data is available for this export.");
    const l = layout(width, height), plot = l.plot, light = options.theme === "light";
    const colors = { bg: light ? "#ffffff" : "#000000", fg: light ? "#111111" : "#ffffff", muted: "#777777",
      grid: light ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.25)",
      verticalGrid: light ? "rgba(0,0,0,0.17)" : "rgba(255,255,255,0.17)",
      basis: "#ff9900", above: "#469B54", below: "#BD2D31" };
    const cadence = ({ daily_dca: "Daily", weekly_dca: "Weekly", monthly_dca: "Monthly" })[options.cadence] || "Daily";
    const font = (size, bold = false) => B.setFont(ctx, size, bold ? "heading" : "body");
    const currentPrice = Number(rows[0].currentPrice), maxDays = Number(rows.at(-1).daysAgo);
    const values = rows.flatMap((row) => [Number(row.historicalPrice), Number(row.dcaBasis)])
      .concat(currentPrice).filter((value) => Number.isFinite(value) && value > 0);
    if (!values.length || !Number.isFinite(currentPrice) || currentPrice <= 0) throw new Error("The selected DCA frame has no valid prices.");
    let maximum = 0, minimum = Infinity;
    for (const value of values) { maximum = Math.max(maximum, value); minimum = Math.min(minimum, value); }
    const logarithmic = options.scale === "log";
    const yMin = logarithmic ? minimum / 1.15 : maximum * -0.02;
    const yMax = maximum * (logarithmic ? 1.15 : 1.065);
    const xFor = (days) => maxDays > 1 ? C.valueToX(maxDays - days, 0, maxDays - 1, plot) : plot.right;
    const yFor = logarithmic
      ? (value) => plot.bottom - (Math.log(value) - Math.log(yMin)) / (Math.log(yMax) - Math.log(yMin)) * plot.height
      : (value) => C.valueToY(value, yMin, yMax, plot);
    let yTicks = logarithmic ? C.createLogTicks(yMin, yMax, { minor: yMax / yMin < 1000 }) : linearTicks(0, yMax, 7);
    if (logarithmic && yTicks.length < 2) yTicks = linearTicks(yMin, yMax, 5);
    const currentY = yFor(currentPrice), duration = durationTicks(maxDays, plot.width);
    const dateText = options.dateOnly
      ? window.WSBDashboardExport.formatDailyDate(options.date ?? rows[0].dateIso)
      : timestampText(options.timestamp ?? rows[0].timestampUtc ?? `${rows[0].dateIso}T00:00:00Z`, options.timeZone);
    const blockHeight = Number(options.height ?? rows[0].blockHeight);
    const obstacles = [];

    ctx.save();
    try {
      ctx.scale(width / l.width, height / l.height);
      ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, l.width, l.height);
      ctx.textBaseline = "middle";
      B.drawWordmark(ctx, l.logo, { theme: options.theme });

      const titleParts = [{ text: `${cadence} DCA `, color: colors.fg }, { text: "Cost Basis", color: colors.basis }];
      if (!l.title.subtitleY) titleParts.push({ text: " (Weighted Average Cost)", color: colors.fg });
      const headlineSize = 32 * 96 / 72;
      font(headlineSize, true);
      const fullWidth = titleParts.reduce((sum, part) => sum + ctx.measureText(part.text).width, 0);
      font(Math.min(headlineSize, headlineSize * l.title.width / fullWidth), true);
      let titleX = l.title.x - titleParts.reduce((sum, part) => sum + ctx.measureText(part.text).width, 0) / 2;
      ctx.textAlign = "left";
      for (const part of titleParts) {
        ctx.fillStyle = part.color; ctx.fillText(part.text, titleX, l.title.y); titleX += ctx.measureText(part.text).width;
      }
      if (l.title.subtitleY) {
        font(36, true); ctx.textAlign = "center"; ctx.fillStyle = colors.fg;
        ctx.fillText("(Weighted Average Cost)", l.title.x, l.title.subtitleY);
      }

      B.setFont(ctx, l.date.size, "mono");
      // Reserve the longest timestamp form for both formats so PNG and video
      // share one date font size, independent of month, timezone or DST.
      const dateSize = Math.min(l.date.size, l.date.size * l.date.width / ctx.measureText("Sep 30, 2000 00:00 (GMT+00:00)").width);
      ctx.textAlign = "right"; ctx.fillStyle = colors.fg;
      B.drawDateText(ctx, dateText, l.date.x, l.date.y, dateSize);
      font(27); const heightText = Number.isFinite(blockHeight) && blockHeight > 0 ? String(Math.round(blockHeight)) : "—";
      ctx.fillText(heightText, l.date.x, l.blockY);
      const heightWidth = ctx.measureText(heightText).width;
      font(25); ctx.fillStyle = colors.muted; ctx.fillText("Block Height:", l.date.x - heightWidth - 16, l.blockY);

      ctx.lineWidth = 1.25; ctx.strokeStyle = colors.grid;
      for (const tick of yTicks) {
        const y = yFor(tick);
        ctx.beginPath(); ctx.moveTo(plot.left, y); ctx.lineTo(plot.right, y); ctx.stroke();
      }
      font(l.tickSize); ctx.textAlign = "center"; ctx.fillStyle = colors.fg;
      const placedDuration = [];
      for (const tick of duration) {
        const x = xFor(tick.days), labelWidth = ctx.measureText(tick.label).width;
        const labelX = Math.max(20 + labelWidth / 2, Math.min(l.width - 20 - labelWidth / 2, x));
        const left = labelX - labelWidth / 2, right = labelX + labelWidth / 2;
        if (placedDuration.some((placed) => left < placed.right + 20 && right > placed.left - 20)) continue;
        placedDuration.push({ left, right });
        ctx.strokeStyle = colors.verticalGrid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, plot.top); ctx.lineTo(x, plot.bottom); ctx.stroke();
        ctx.fillText(tick.label, labelX, l.xTickY);
      }

      const referenceMs = Date.parse(`${rows[0].dateIso}T00:00:00Z`) + (Number(rows[0].daysAgo) - 1) * DAY;
      const halvings = options.showHalvings === false ? [] : (options.halvings || HALVINGS)
        .map((event) => ({ ...event, days: Math.round((referenceMs - Date.parse(`${event.date}T00:00:00Z`)) / DAY) }))
        .filter((event) => Number.isFinite(event.days) && event.days >= 1 && event.days <= maxDays);
      font(l.halvingSize);
      for (const event of halvings) {
        const x = xFor(event.days);
        ctx.strokeStyle = colors.muted; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, plot.top); ctx.lineTo(x, logarithmic ? plot.bottom : yFor(0)); ctx.stroke();
        const date = new Date(`${event.date}T00:00:00Z`);
        const labels = [[event.label, -14], [`${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`, 18]];
        const labelHeight = Math.max(...labels.map(([text]) => ctx.measureText(text).width));
        const box = { left: x - 27, right: x + 30, top: plot.top, bottom: plot.top + labelHeight + 10 };
        if (box.left < plot.left || box.right > plot.right || obstacles.some((o) => overlap(box, o, 4))) continue;
        obstacles.push(box);
        for (const [text, offset] of labels) {
          ctx.save(); ctx.translate(x + offset, plot.top + 5); ctx.rotate(-Math.PI / 2);
          ctx.textAlign = "right"; ctx.fillStyle = colors.muted; ctx.fillText(text, 0, 0); ctx.restore();
        }
      }

      ctx.save();
      ctx.beginPath(); ctx.rect(plot.left - 4, plot.top, plot.width + 8, plot.height); ctx.clip();
      ctx.strokeStyle = colors.fg; ctx.lineWidth = 2; ctx.setLineDash([7, 4]);
      ctx.beginPath(); ctx.moveTo(plot.left, currentY); ctx.lineTo(plot.right, currentY); ctx.stroke(); ctx.setLineDash([]);
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      // The historical segment color describes this duration's current DCA
      // profitability, exactly as the notebook and interactive chart do.
      ctx.lineWidth = Math.max(1.65, 5.5 / Math.log10(rows.length + 300)) * 96 / 72;
      for (let index = 1; index < rows.length; index += 1) {
        const previous = rows[index - 1], row = rows[index];
        if (!(Number(previous.historicalPrice) > 0 && Number(row.historicalPrice) > 0)) continue;
        ctx.strokeStyle = Number(previous.isPriceAbove) > 0.5 ? colors.above : colors.below;
        ctx.beginPath(); ctx.moveTo(xFor(previous.daysAgo), yFor(previous.historicalPrice));
        ctx.lineTo(xFor(row.daysAgo), yFor(row.historicalPrice)); ctx.stroke();
      }
      function basisPath() {
        ctx.beginPath(); let started = false;
        for (const row of rows) {
          if (!(Number(row.dcaBasis) > 0)) { started = false; continue; }
          const x = xFor(row.daysAgo), y = yFor(row.dcaBasis);
          if (started) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          started = true;
        }
        ctx.stroke();
      }
      for (const lineWidth of [13.33, 10.67, 8]) {
        ctx.strokeStyle = colors.bg; ctx.globalAlpha = 0.5; ctx.lineWidth = lineWidth; basisPath();
      }
      ctx.globalAlpha = 1; ctx.strokeStyle = colors.basis; ctx.lineWidth = 5.33; basisPath();
      if (rows.length === 1 && Number(rows[0].dcaBasis) > 0) {
        ctx.fillStyle = colors.basis; ctx.beginPath(); ctx.arc(xFor(rows[0].daysAgo), yFor(rows[0].dcaBasis), 3.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();

      font(l.calloutSize);
      for (const event of halvings) {
        const row = rows.reduce((nearest, candidate) => Math.abs(candidate.daysAgo - event.days) < Math.abs(nearest.daysAgo - event.days) ? candidate : nearest);
        if (!(Number(row.dcaBasis) > 0)) continue;
        const x = xFor(event.days), y = yFor(row.dcaBasis), label = money(Number(row.dcaBasis));
        const textWidth = ctx.measureText(label).width, halfHeight = l.calloutSize * 0.6;
        const candidates = [[-27, -32, "right"], [-27, 38, "right"], [27, -32, "left"], [27, 38, "left"]];
        let placement;
        for (const [dx, dy, align] of candidates) {
          const labelX = Math.max(plot.left + 7 + (align === "right" ? textWidth : 0),
            Math.min(plot.right - 7 - (align === "left" ? textWidth : 0), x + dx));
          const labelY = y + dy;
          const box = { left: labelX - (align === "right" ? textWidth : 0), right: labelX + (align === "left" ? textWidth : 0),
            top: labelY - halfHeight, bottom: labelY + halfHeight };
          if (box.top < plot.top + 6 || box.bottom > plot.bottom - 6 || obstacles.some((o) => overlap(box, o, 7))) continue;
          placement = { labelX, labelY, align, box }; break;
        }
        if (!placement) continue;
        const { labelX, labelY, align, box } = placement; obstacles.push(box);
        ctx.strokeStyle = colors.muted; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x - Math.sign(x - labelX) * 4, y + Math.sign(labelY - y) * 5);
        ctx.lineTo(labelX, labelY - Math.sign(labelY - y) * 5); ctx.stroke();
        ctx.textAlign = align; ctx.lineJoin = "round"; ctx.strokeStyle = colors.bg; ctx.lineWidth = 4;
        ctx.strokeText(label, labelX, labelY); ctx.fillStyle = colors.basis; ctx.fillText(label, labelX, labelY);
      }

      // Keep the current price legible when it is close to a normal scale tick.
      font(l.tickSize); ctx.textAlign = "right";
      const placedY = [];
      for (const tick of yTicks) {
        const y = yFor(tick);
        if (Math.abs(y - currentY) < l.priceSize * 0.88 || placedY.some((other) => Math.abs(other - y) < l.tickSize * 1.25)) continue;
        placedY.push(y); ctx.fillStyle = colors.muted; fitMoney(money(tick), l.tickSize, y);
      }
      font(l.priceSize); ctx.fillStyle = colors.fg; fitMoney(money(currentPrice), l.priceSize, currentY);
      font(34); ctx.textAlign = "center"; ctx.fillStyle = colors.fg;
      ctx.fillText(`${cadence} DCA Duration`, (plot.left + plot.right) / 2, l.xTitleY);
      B.drawFooter(ctx, "dca_cost_basis", { width: l.width, height: l.height, footerHeight: l.footerHeight },
        { theme: options.theme, orientation: l.orientation });

      function fitMoney(text, size, y) {
        font(size);
        const available = l.axisRight - plot.right - 8;
        const measured = ctx.measureText(text).width;
        if (measured > available) font(size * available / measured);
        ctx.fillText(text, l.axisRight, y);
      }
    } finally { ctx.restore(); }
    return { layout: l, currentPrice, timestamp: dateText, yTicks, durationTicks: duration };
  }

  function overlap(a, b, gap) {
    return a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;
  }

  window.WSBDCACostBasisExport = { ready: B.ready, render, layout };
}());
