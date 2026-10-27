(function () {
  "use strict";
  const MAX_SUPPLY = 20999999.9769;
  const HALVING = 210000;
  const COLORS = ["#0d326b", "#0f559e", "#2e7fba", "#559fcc", "#88bdd8", "#aecde1", "#c8dcea", "#dce7ee"];
  const DATE = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  const MONEY = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const SUPPLY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
  const integer = new Intl.NumberFormat("en-US");
  const { parse, prepareCandidate, latestIndexAtDate, withLiveQuote } = window.WSBDailyPriceHistory;
  function summary(row) {
    const displayTime = row.quoteAt || Date.parse(row.timestamp.replace(" ", "T") + "Z") || row.time;
    return { date: DATE.format(row.time), datetime: `${DATE.format(displayTime)} ${new Date(displayTime).toISOString().slice(11, 16)}`, height: integer.format(row.height), epoch: Math.floor(row.height / HALVING) + 1,
      subsidy: 50 / 2 ** Math.floor(row.height / HALVING), supply: SUPPLY.format(row.supply), percent: row.supply / MAX_SUPPLY * 100,
      price: row.price > 0 ? `$${MONEY.format(row.price)}` : "Not valued" };
  }
  function palette(theme) {
    const light = theme === "light";
    return { light, background: light ? "#fff" : "#000", text: light ? "#171b22" : "#fff", muted: light ? "#665f59" : "#555", axis: light ? "#766f69" : "#666", outline: light ? "#242424" : "#fff" };
  }
  function font(ctx, size, bold, branded) {
    if (branded) window.WSBDashboardExportBranding.setFont(ctx, size, bold ? "heading" : "body");
    else ctx.font = `${bold ? 600 : 400} ${size}px "Space Grotesk", sans-serif`;
  }
  function donut(ctx, box, row, colors, opts) {
    const { x, y, size } = box, cx = x + size / 2, cy = y + size / 2, r = size * 0.47, inner = r * 0.35;
    let angle = -Math.PI / 2;
    const mined = Math.max(0, Math.min(MAX_SUPPLY, row.supply));
    // Each era is a fixed half of the subsidy still unissued at its start.
    let remaining = mined;
    const fractions = [];
    for (let era = 0; era < 33 && remaining > 0; era++) {
      const allotment = 10500000 / 2 ** era;
      const issued = Math.min(remaining, allotment);
      if (issued > 0) fractions.push({ value: issued, color: COLORS[Math.min(era, COLORS.length - 1)] });
      remaining -= issued;
    }
    if (mined < MAX_SUPPLY) fractions.push({ value: MAX_SUPPLY - mined, color: colors.background });
    for (const part of fractions) {
      const end = angle + part.value / MAX_SUPPLY * Math.PI * 2;
      ctx.beginPath(); ctx.arc(cx, cy, r, angle, end); ctx.arc(cx, cy, inner, end, angle, true); ctx.closePath();
      ctx.fillStyle = part.color; ctx.fill(); angle = end;
    }
    // Keep the ring and scheduled halving divisions independent of the moving fill.
    const startAngle = -Math.PI / 2, minedAngle = startAngle + mined / MAX_SUPPLY * Math.PI * 2;
    ctx.lineWidth = Math.max(1, size * 0.0025);
    for (const radius of [r, inner]) {
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.strokeStyle = colors.muted; ctx.stroke();
      if (mined > 0) {
        ctx.beginPath(); ctx.arc(cx, cy, radius, startAngle, minedAngle); ctx.strokeStyle = colors.outline; ctx.stroke();
      }
    }
    // The reference shows the origin seam and the first ten halving boundaries.
    for (let halving = 0; halving <= 10; halving++) {
      const boundarySupply = halving ? 21000000 * (1 - 2 ** -halving) : 0;
      const boundaryAngle = startAngle + boundarySupply / MAX_SUPPLY * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(boundaryAngle) * inner, cy + Math.sin(boundaryAngle) * inner);
      ctx.lineTo(cx + Math.cos(boundaryAngle) * r, cy + Math.sin(boundaryAngle) * r);
      ctx.strokeStyle = boundarySupply <= mined ? colors.outline : colors.muted; ctx.stroke();
    }
    ctx.fillStyle = colors.text; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    font(ctx, size * 0.095, false, opts.branded); ctx.fillText(`${(mined / MAX_SUPPLY * 100).toFixed(1)}%`, cx, cy - size * 0.012);
    ctx.fillStyle = colors.muted; font(ctx, size * 0.043, false, opts.branded); ctx.fillText(`${(mined / 1e6).toFixed(1)}M BTC`, cx, cy + size * 0.062);
    if (!opts.export && !opts.preview && opts.hover) {
      const p = opts.hover, distance = Math.hypot(p.x - cx, p.y - cy);
      if (distance <= r) {
        const plot = { x, y, width: size, height: size }, entries = [];
        let title = "Mined supply";
        if (distance < inner) {
          entries.push({ label: "Mined", value: `${SUPPLY.format(mined)} BTC` }, { label: "Share", value: `${(mined / MAX_SUPPLY * 100).toFixed(2)}%` });
        } else {
          const fraction = ((Math.atan2(p.y - cy, p.x - cx) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
          if (fraction >= mined / MAX_SUPPLY) {
            title = "Not yet mined"; entries.push({ label: "Remaining", value: `${SUPPLY.format(MAX_SUPPLY - mined)} BTC` });
          } else {
            let era = 0, previous = 0;
            while (era < 32 && fraction >= Math.min(MAX_SUPPLY, 21000000 * (1 - 2 ** -(era + 1))) / MAX_SUPPLY) { previous += 10500000 / 2 ** era; era++; }
            const issued = Math.min(10500000 / 2 ** era, Math.max(0, mined - previous));
            title = `Epoch ${era + 1}`;
            entries.push({ label: "Issued", value: `${SUPPLY.format(issued)} BTC` }, { label: "Subsidy", value: `${50 / 2 ** era} BTC` }, { label: "Share of total", value: `${(issued / MAX_SUPPLY * 100).toFixed(2)}%` });
          }
        }
        entries.push({ label: "As of", value: DATE.format(row.time) + " (UTC)" });
        opts.onInspect?.({ key: "supply", plot, anchorX: p.x, title, entries });
      }
    }
  }
  function donutHeading(ctx, box, lines, fontSize, lineHeight, colors, opts) {
    const bottom = box.y + box.size * 0.03 - Math.max(8, box.size * 0.025);
    ctx.fillStyle = colors.muted; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    font(ctx, fontSize, false, opts.branded);
    lines.forEach((line, i) => ctx.fillText(line, box.x + box.size / 2, bottom - (lines.length - 1 - i) * lineHeight));
  }
  function priceChart(ctx, box, rows, endIndex, colors, opts) {
    const uiScale = opts.uiScale || 1;
    const { x, y, width, height } = box, bottom = y + height - (opts.preview ? 0 : 35 * uiScale), top = y + 8 * uiScale;
    const end = rows[endIndex];
    const first = Math.max(0, Math.min(endIndex, Number(opts.startIndex) || 0));
    if (first < 0 || first > endIndex) return;
    const firstHeight = rows[first].height, span = Math.max(1, end.height - firstHeight);
    let maxPrice = 1;
    for (let i = first; i <= endIndex; i++) if (rows[i].price > maxPrice) maxPrice = rows[i].price;
    const minLog = Math.log10(0.0005), maxLog = Math.log10(maxPrice) + 0.17;
    const px = (heightValue) => x + (heightValue - firstHeight) / span * width;
    const py = (price) => price <= 0 ? bottom : bottom - (Math.log10(Math.max(0.0005, price)) - minLog) / (maxLog - minLog) * (bottom - top);
    ctx.save(); ctx.beginPath(); ctx.rect(x, top, width, bottom - top + 1); ctx.clip();
    let segment = [];
    function drawSegment() {
      if (!segment.length) return;
      const color = COLORS[Math.min(Math.floor(segment[0].height / HALVING), COLORS.length - 1)];
      ctx.beginPath(); ctx.moveTo(px(segment[0].height), bottom);
      for (const item of segment) ctx.lineTo(px(item.height), py(item.price));
      ctx.lineTo(px(segment.at(-1).height), bottom); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
      segment = [];
    }
    for (let i = first; i <= endIndex; i++) {
      const row = rows[i];
      if (row.price <= 0) { drawSegment(); continue; }
      if (segment.length && Math.floor(segment[0].height / HALVING) !== Math.floor(row.height / HALVING)) {
        const crossing = { height: Math.floor(row.height / HALVING) * HALVING, price: row.price };
        segment.push(crossing); drawSegment(); segment.push(crossing);
      }
      segment.push(row);
    }
    drawSegment();
    ctx.beginPath(); let moved = false;
    for (let i = first; i <= endIndex; i++) {
      const row = rows[i];
      // A missing valuation and a positive price are separate line segments.
      if (!moved || (rows[i - 1].price > 0) !== (row.price > 0)) {
        ctx.moveTo(px(row.height), py(row.price)); moved = true;
      } else ctx.lineTo(px(row.height), py(row.price));
    }
    if (colors.light) { ctx.strokeStyle = "#15283b"; ctx.lineWidth = (opts.preview ? 3 : 3.6) * uiScale; ctx.lineJoin = "round"; ctx.stroke(); }
    ctx.strokeStyle = "#fff"; ctx.lineWidth = (opts.preview ? 1.6 : 2.1) * uiScale; ctx.lineJoin = "round"; ctx.stroke(); ctx.restore();
    if (opts.preview) return;
    ctx.lineWidth = uiScale; ctx.strokeStyle = colors.axis; ctx.beginPath(); ctx.moveTo(x, bottom + 0.5 * uiScale); ctx.lineTo(x + width, bottom + 0.5 * uiScale); ctx.stroke();
    ctx.fillStyle = colors.axis; ctx.textAlign = "center"; ctx.textBaseline = "top"; font(ctx, opts.uiScale ? 16 * uiScale : Math.max(11, Math.min(16, width / 65)), false, opts.branded);
    const logicalWidth = width / uiScale;
    const yearStep = logicalWidth < 550 ? 4 : logicalWidth < 900 ? 2 : 1;
    for (let year = 2009; year <= new Date(end.time).getUTCFullYear(); year++) {
      if (year % yearStep) continue;
      const target = Date.UTC(year, 0, 1);
      let low = first, high = endIndex;
      while (low < high) { const mid = (low + high) >> 1; if (rows[mid].time < target) low = mid + 1; else high = mid; }
      const at = px(rows[low].height); if (at < x + 8 * uiScale || at > x + width - 8 * uiScale) continue;
      ctx.beginPath(); ctx.moveTo(at, bottom); ctx.lineTo(at, bottom + 6 * uiScale); ctx.stroke(); ctx.fillText(String(year), at, bottom + 9 * uiScale);
    }
    const labels = ["1st", "2nd", "3rd", "4th", "5th", "6th"];
    for (let n = 1; n <= labels.length; n++) {
      const heightValue = n * HALVING; if (heightValue > end.height) break;
      const at = px(heightValue); if (at < x || at > x + width) continue;
      let low = first, high = endIndex;
      while (low < high) { const mid = (low + high) >> 1; if (rows[mid].height < heightValue) low = mid + 1; else high = mid; }
      ctx.beginPath(); ctx.moveTo(at, bottom); ctx.lineTo(at, py(rows[low].price));
      ctx.strokeStyle = colors.outline; ctx.lineWidth = uiScale; ctx.stroke();
      ctx.save(); ctx.translate(at - 8 * uiScale, bottom - 12 * uiScale); ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = colors.light && n >= 4 ? "#17212e" : "#fff";
      font(ctx, opts.square ? 16 * uiScale : opts.uiScale ? 28 * uiScale : Math.max(14, Math.min(28, width / 36)), false, opts.branded);
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(`${labels[n - 1]} Halving`, 0, 0); ctx.restore();
    }
    if (!opts.export && opts.hover) {
      const T = window.WSBDashboardChartTooltip, plot = { x, y: top, width, height: bottom - top };
      if (T.contains(plot, opts.hover) && opts.hover.x <= px(end.height)) {
        const heightValue = firstHeight + (opts.hover.x - x) / width * span;
        const at = T.nearest(rows, heightValue, "height", first, endIndex), sample = rows[at], info = summary(sample);
        const price = sample.price > 0 && sample.price < 1 ? `${Number((sample.price * 100).toPrecision(4))}¢` : info.price;
        T.drawGuide(ctx, plot, px(sample.height), py(sample.price), colors.light);
        opts.onInspect?.({ key: "history", plot, anchorX: px(sample.height), title: info.date + " (UTC)", entries: [
          { label: "Bitcoin", value: price }, { label: "Block", value: info.height },
          { label: "Mined", value: `${info.supply} BTC` }, { label: "Epoch", value: String(info.epoch) },
          { label: "Observation", value: sample.quoteAt ? "Current quote · provisional" : "Published daily price" },
        ] });
      }
    }
  }
  function compactExportHeader(ctx, width, row, colors, options) {
    const u = width / 1080, s = summary(row), muted = colors.light ? colors.muted : "#929292";
    const text = (value, x, y, size, tint = colors.text, align = "left", maxWidth) => {
      ctx.fillStyle = tint; ctx.textAlign = align; ctx.textBaseline = "middle"; font(ctx, size * u, false, options.branded);
      ctx.fillText(value, x * u, y * u, maxWidth ? maxWidth * u : width);
    };
    text(s.datetime + " (UTC)", 32, 38, 24);
    text("Block Height:", 32, 80, 23, muted);
    font(ctx, 23 * u, false, options.branded);
    const heightX = 32 + ctx.measureText("Block Height:  ").width / u;
    text(s.height, heightX, 80, 23);
    text("Epoch", 510, 38, 23, muted, "center");
    text(String(s.epoch), 510, 82, 38, colors.text, "center");
    text("Block Subsidy", 850, 38, 23, muted, "center");
    text(`${s.subsidy} BTC`, 850, 82, 38, COLORS[Math.min(s.epoch - 1, COLORS.length - 1)], "center", 340);
    text("Mined Supply", 285, 143, 23, muted, "center");
    text(`${s.supply} BTC`, 285, 187, 38, colors.text, "center", 506);
    text("Price (BTCUSD)", 805, 143, 23, muted, "center");
    text(s.price, 805, 187, 40, colors.text, "center", 486);
  }
  function renderSquareExport(ctx, width, height, rows, endIndex, colors, options) {
    const u = width / 1080, pad = 32 * u;
    compactExportHeader(ctx, width, rows[endIndex], colors, options);
    const donutBox = { x: 340 * u, y: 270 * u, size: 400 * u };
    donutHeading(ctx, donutBox, ["Percentage of 21M BTC Mined"], 23 * u, 0, { ...colors, muted: colors.light ? colors.muted : "#929292" }, options);
    donut(ctx, donutBox, rows[endIndex], colors, options);
    const footer = 78 * u, chartY = 688 * u;
    priceChart(ctx, { x: pad, y: chartY, width: width - pad * 2, height: height - footer - chartY - 10 * u }, rows, endIndex, colors, { ...options, square: true, uiScale: u });
    window.WSBDashboardExportBranding.drawFooter(ctx, "mined_supply_price", { width, height, footerHeight: footer }, { theme: options.theme, orientation: "square" });
  }
  function render(ctx, width, height, rows, endIndex, options = {}) {
    let inspection = null;
    options = { ...options, onInspect: (value) => { inspection = value; } };
    const theme = options.theme || "dark", colors = palette(theme), preview = !!options.preview, branded = !!options.branded;
    const landscape = width / height > 1.35, compact = width / height < 0.9;
    ctx.save(); ctx.fillStyle = colors.background; ctx.fillRect(0, 0, width, height);
    if (options.export && !landscape && !compact) { renderSquareExport(ctx, width, height, rows, endIndex, colors, options); ctx.restore(); return; }
    const scale = Math.min(width / 1920, height / (landscape ? 1080 : 1920));
    const pad = Math.max(12, 35 * scale), header = preview ? 0 : (options.export ? (landscape ? 145 * scale : 240 * width / 1080) : 12 * scale);
    const footer = options.export ? (landscape ? 122 : 117) * scale : 0;
    const chartBottom = height - footer - (preview ? pad : 12 * scale);
    const available = chartBottom - header;
    const row = rows[endIndex];
    if (options.export) {
      const s = summary(row);
      const cells = [pad, width * 0.27, width * 0.42, width * 0.65, width * 0.89];
      ctx.textBaseline = "middle";
      const k = Math.max(14, 27 * scale), big = Math.max(22, 47 * scale);
      const label = (text, x, align) => { ctx.textAlign = align; ctx.fillStyle = colors.muted; font(ctx, k, false, branded); ctx.fillText(text, x, 48 * scale); };
      const value = (text, x, align, tint) => { ctx.textAlign = align; ctx.fillStyle = tint || colors.text; font(ctx, big, false, branded); ctx.fillText(text, x, 94 * scale); };
      if (landscape) {
        label(s.datetime + " (UTC)", cells[0], "left");
        ctx.textAlign = "left"; ctx.textBaseline = "middle"; font(ctx, k, false, branded);
        ctx.fillStyle = colors.muted; ctx.fillText("Block Height:", cells[0], 94 * scale);
        const heightX = cells[0] + ctx.measureText("Block Height:  ").width;
        ctx.fillStyle = colors.text; ctx.fillText(s.height, heightX, 94 * scale);
        label("Epoch", cells[1], "center"); value(String(s.epoch), cells[1], "center");
        label("Block Subsidy", cells[2], "center"); value(`${s.subsidy} BTC`, cells[2], "center", COLORS[Math.min(s.epoch - 1, COLORS.length - 1)]);
        label("Mined Supply", cells[3], "center"); value(`${s.supply} BTC`, cells[3], "center");
        label("Price (BTCUSD)", cells[4], "center"); value(s.price, cells[4], "center");
      } else {
        compactExportHeader(ctx, width, row, colors, options);
      }
    }
    if (landscape) {
      const donutSize = Math.min(width * 0.38, available * (preview ? 0.9 : 0.8));
      const donutX = pad, donutY = header + (available - donutSize) / 2 + (preview ? 0 : 18 * scale);
      const donutBox = { x: donutX, y: donutY, size: donutSize };
      if (!preview) donutHeading(ctx, donutBox, ["Percentage of", "21M BTC Mined"], 34 * scale, 38 * scale, colors, options);
      donut(ctx, donutBox, row, colors, options);
      priceChart(ctx, { x: Math.max(width * 0.37, donutX + donutSize + pad * 0.3), y: header + 10 * scale,
        width: width - Math.max(width * 0.37, donutX + donutSize + pad * 0.3) - pad, height: available - 16 * scale }, rows, endIndex, colors, { ...options, uiScale: options.export ? scale : undefined });
    } else {
      const donutSize = Math.min(width - pad * 2, compact ? available * 0.44 : available * 0.53);
      const headingSize = Math.max(12, 29 * scale);
      const donutY = preview ? header : Math.max(header + 38 * scale, header + headingSize + Math.max(8, donutSize * 0.025) - donutSize * 0.03 + 2);
      const donutBox = { x: (width - donutSize) / 2, y: donutY, size: donutSize };
      if (!preview) donutHeading(ctx, donutBox, ["Percentage of 21M BTC Mined"], headingSize, 0, colors, options);
      donut(ctx, donutBox, row, colors, options);
      const chartY = donutY + donutSize + 20 * scale;
      priceChart(ctx, { x: pad, y: chartY, width: width - pad * 2, height: Math.max(100, chartBottom - chartY) }, rows, endIndex, colors, { ...options, square: !compact, uiScale: options.export ? width / 1080 : undefined });
    }
    if (options.export) window.WSBDashboardExportBranding.drawFooter(ctx, "mined_supply_price", { width, height, footerHeight: footer }, { theme, orientation: landscape ? "landscape" : compact ? "portrait" : "square" });
    ctx.restore();
    return inspection;
  }
  window.WSBMinedSupplyPriceChart = { parse, prepareCandidate, latestIndexAtDate, summary, withLiveQuote, render, MAX_SUPPLY };
}());
