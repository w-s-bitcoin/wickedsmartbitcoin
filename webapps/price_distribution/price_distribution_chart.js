(function () {
  "use strict";
  const History = window.WSBDailyPriceHistory;
  const GENESIS = Date.UTC(2009, 0, 3), DAY = 86400000;
  const DATE = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  const integer = (value) => value.toLocaleString("en-US");
  const HALVINGS = ["2012-11-28", "2016-07-09", "2020-05-11", "2024-04-20"];
  function priceLabel(price) {
    if (price <= 0) return "Not Valued";
    if (price < 1) return `${Number((price * 100).toPrecision(4))}¢`;
    return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  function summary(row) {
    const days = Math.floor((row.time - GENESIS) / DAY) + 1;
    return { date: DATE.format(row.time), height: integer(row.height), price: priceLabel(row.price), days, age: `${integer(days)} ${days === 1 ? "Day" : "Days"}` };
  }
  function boundLabel(exponent) {
    const value = 10 ** exponent;
    if (exponent < 0) return `${Number((value * 100).toPrecision(4))}¢`;
    if (exponent < 3) return `$${value}`;
    if (exponent < 6) return `$${value / 1e3}k`;
    if (exponent < 9) return `$${value / 1e6}M`;
    return `$${value / 1e9}B`;
  }
  const inBin = (price, bin) => bin.upper === 0 ? price === 0 : price >= bin.lower && price < bin.upper;
  function distribution(rows, endIndex, startIndex = 0) {
    const first = Math.max(0, Math.min(endIndex, startIndex));
    // The reference's thirteen rows remain fixed throughout ordinary history.
    // Extend only if an observed price falls outside them; never inspect future rows.
    let min = -4, max = 7;
    for (let i = first; i <= endIndex; i++) if (rows[i].price > 0) {
      const exponent = Math.floor(Math.log10(rows[i].price));
      min = Math.min(min, exponent); max = Math.max(max, exponent);
    }
    const bins = [{ label: "Not Valued", count: 0, lower: 0, upper: 0 }];
    for (let exponent = min; exponent <= max; exponent++) bins.push({
      label: `${boundLabel(exponent)} - ${boundLabel(exponent + 1)}`, count: 0,
      lower: 10 ** exponent, upper: 10 ** (exponent + 1),
    });
    for (let i = first; i <= endIndex; i++) {
      const price = rows[i].price;
      // Compare actual thresholds, avoiding logarithm rounding at decade edges.
      const bin = bins.find((b) => inBin(price, b));
      if (bin) bin.count++;
    }
    return { bins, min, max, total: endIndex - first + 1 };
  }
  function font(ctx, size, bold, branded) {
    if (branded) window.WSBDashboardExportBranding.setFont(ctx, size, bold ? "heading" : "body");
    else ctx.font = `${bold ? 600 : 400} ${size}px "Space Grotesk", sans-serif`;
  }
  function render(ctx, width, height, rows, endIndex, opts = {}) {
    if (!rows.length || !rows[endIndex]) return;
    const first = Math.max(0, Math.min(endIndex, Number(opts.startIndex) || 0));
    const row = rows[endIndex], model = distribution(rows, endIndex, first), s = summary(row);
    const preview = !!opts.preview, exporting = !!opts.export, light = opts.theme === "light";
    const fg = light ? "#171717" : "#fff", muted = light ? "#68615b" : "#999", orange = light ? "#cc7300" : "#ff9900";
    const landscape = preview || width / height > 1.35, portrait = width / height < .9;
    const u = exporting ? width / (landscape ? 1920 : 1080) : 1;
    const pad = exporting ? 24 * u : preview ? 4 : 16;
    const footer = exporting ? (landscape ? 122 : 82) * u : 0;
    const bottom = height - footer - (exporting ? 12 * u : pad);
    const header = exporting ? (landscape ? 115 : 160) * u : 0;
    let history, histogram, titleY, titleSize, labelSize;
    if (landscape) {
      const top = preview ? pad : exporting ? header : pad + Math.min(23, width / 58) + 36;
      const seam = preview ? width * .64 : width * .604;
      const right = preview ? width - pad : width * .888;
      history = { x: pad, y: top, width: seam - pad, height: bottom - top };
      histogram = { x: seam, y: top, width: right - seam, height: bottom - top };
      titleSize = exporting ? 40 * u : Math.min(23, width / 58);
      titleY = exporting ? 48 * u : pad + titleSize / 2;
      labelSize = exporting ? 24 * u : Math.min(17, width / 82);
    } else {
      const top = header + pad;
      const histTop = top + (bottom - top) * .40 + (exporting ? 72 * u : 65);
      history = { x: pad, y: top, width: width - pad * 2, height: histTop - top - (exporting ? 100 * u : 84) };
      histogram = { x: pad, y: histTop, width: (width - pad * 2) * .74, height: bottom - histTop };
      titleY = histTop - (exporting ? 58 * u : 43);
      titleSize = exporting ? 32 * u : Math.min(22, width / 20);
      labelSize = exporting ? 23 * u : 14;
    }
    ctx.save(); ctx.fillStyle = light ? "#fff" : "#000"; ctx.fillRect(0, 0, width, height);
    const text = (value, x, y, size, color = fg, align = "left", bold = false) => {
      font(ctx, size, bold, opts.branded); ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.fillText(value, x, y);
    };
    if (!exporting && !preview && landscape) {
      font(ctx, titleSize, false, false); ctx.textBaseline = "middle";
      titleY = pad + ctx.measureText("Bitcoin Price Distribution").actualBoundingBoxAscent;
    }
    if (!preview) {
      font(ctx, labelSize, false, opts.branded);
      ctx.textAlign = "left";
      const labelWidth = Math.max(...model.bins.map((bin) => {
        const metrics = ctx.measureText(bin.label);
        return metrics.actualBoundingBoxRight;
      }));
      // Match the left content inset with the labels' visible right edge in
      // both the dashboard and every image/video export orientation.
      const fittedWidth = width - (exporting ? pad : 12) - histogram.x - labelWidth - 16 * u;
      histogram.width = fittedWidth;
    }
    const yAt = (box, band) => box.y + box.height - (band + .5) / model.bins.length * box.height;
    const priceBand = (price) => price > 0 ? Math.log10(price) - model.min + .5 : 0;
    // Stacked exports do not need to reserve the histogram's empty upper bands
    // above the history. Keep a small inset above the highest observed price.
    let historyCeiling = 1;
    if (exporting && !landscape) {
      for (let i = first; i <= endIndex; i++) historyCeiling = Math.max(historyCeiling, priceBand(rows[i].price));
    }
    const priceY = (price) => exporting && !landscape
      ? history.y + history.height - (priceBand(price) + .5) / (historyCeiling + .75) * history.height
      : yAt(history, priceBand(price));
    const span = Math.max(DAY, rows[endIndex].time - rows[first].time);
    const xAt = (time) => history.x + (time - rows[first].time) / span * history.width;
    const rowHeight = histogram.height / model.bins.length;
    const pointer = !exporting && !preview ? opts.hover : null, T = window.WSBDashboardChartTooltip;
    let hoverIndex = -1, hoverBinIndex = -1;
    if (pointer && T.contains(history, pointer) && pointer.x <= xAt(row.time)) {
      const time = rows[first].time + (pointer.x - history.x) / history.width * span;
      hoverIndex = T.nearest(rows, time, "time", first, endIndex);
    } else if (pointer && T.contains(histogram, pointer)) {
      hoverBinIndex = Math.min(model.bins.length - 1, Math.floor((bottom - pointer.y) / rowHeight));
    }
    // Keep zero-valued history disconnected from actual quotations.
    ctx.save(); ctx.beginPath(); ctx.rect(history.x - 3 * u, history.y, history.width + 3 * u, history.height); ctx.clip();
    if (!preview) {
      ctx.save(); ctx.globalAlpha = hoverBinIndex >= 0 ? .2 : 1;
      HALVINGS.forEach((iso, n) => {
        const time = Date.parse(iso + "T00:00:00Z");
        if (time < rows[first].time || time > row.time) return;
        const at = History.latestIndexAtDate(rows, iso), x = xAt(time), y = priceY(rows[at].price), base = history.y + history.height;
        ctx.beginPath(); ctx.setLineDash([4 * u, 3 * u]); ctx.strokeStyle = fg; ctx.lineWidth = u;
        ctx.moveTo(x, base); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
        const size = exporting ? (landscape ? 25 : 18) * u : Math.max(12, Math.min(18, width / 48));
        font(ctx, size, false, opts.branded);
        const label = `${["1st", "2nd", "3rd", "4th"][n]} Halving`;
        // Do not draw a label through the observed price on short/early views.
        if (ctx.measureText(label).width + 12 * u < base - y) {
          ctx.save(); ctx.translate(x - 12 * u, base - 5 * u); ctx.rotate(-Math.PI / 2);
          text(label, 0, 0, size); ctx.restore();
        }
      });
      ctx.restore();
    }
    const pricePath = new Path2D();
    for (let i = first; i <= endIndex; i++) {
      const r = rows[i], x = xAt(r.time), y = priceY(r.price);
      if (i === first || (rows[i - 1].price > 0) !== (r.price > 0)) pricePath.moveTo(x, y); else pricePath.lineTo(x, y);
    }
    ctx.strokeStyle = orange; ctx.lineWidth = exporting ? 4 * u : preview ? 2.2 : 2.8; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.globalAlpha = hoverBinIndex >= 0 ? .2 : 1;
    ctx.stroke(pricePath);
    if (hoverBinIndex >= 0) {
      const bin = model.bins[hoverBinIndex];
      // Clip the same log-price path at the exact band boundaries, so crossing
      // segments remain continuous without assigning neighboring days to the bin.
      const bandTop = bin.upper === 0 ? yAt(history, .5) : priceY(bin.upper);
      const bandBottom = bin.upper === 0 ? history.y + history.height : priceY(bin.lower);
      ctx.save(); ctx.beginPath(); ctx.rect(history.x - 3, bandTop, history.width + 3, bandBottom - bandTop); ctx.clip();
      ctx.globalAlpha = 1; ctx.stroke(pricePath); ctx.restore();
    }
    if (first === endIndex) {
      ctx.globalAlpha = hoverBinIndex < 0 || inBin(row.price, model.bins[hoverBinIndex]) ? 1 : .2;
      ctx.beginPath(); ctx.arc(history.x, priceY(row.price), 2.5 * u, 0, Math.PI * 2); ctx.fillStyle = orange; ctx.fill();
    }
    ctx.restore();
    const maxCount = Math.max(1, ...model.bins.map((b) => b.count));
    font(ctx, labelSize, false, opts.branded); ctx.textAlign = "left";
    const valueGap = 16 * u, maxValue = ctx.measureText(integer(maxCount));
    const countSpace = preview ? 0 : maxValue.actualBoundingBoxLeft + maxValue.actualBoundingBoxRight + 2 * valueGap;
    const barWidth = Math.max(1, histogram.width - countSpace);
    model.bins.forEach((bin, i) => {
      const y = yAt(histogram, i), bar = bin.count / maxCount * barWidth;
      ctx.save(); ctx.globalAlpha = hoverBinIndex >= 0 && i !== hoverBinIndex ? .2 : 1;
      if (bin.count) {
        ctx.fillStyle = orange; ctx.fillRect(histogram.x, y - rowHeight * .175, bar, rowHeight * .35);
        if (hoverIndex >= 0 && inBin(rows[hoverIndex].price, bin)) {
          // Each day occupies one equal-width slot, ordered chronologically
          // within its price range. Mark the center of the selected day's slot.
          let ordinal = 0;
          for (let j = first; j <= hoverIndex; j++) if (inBin(rows[j].price, bin)) ordinal++;
          const markerX = histogram.x + (ordinal - .5) / maxCount * barWidth;
          ctx.save(); ctx.beginPath(); ctx.rect(histogram.x, y - rowHeight * .175, bar, rowHeight * .35); ctx.clip();
          ctx.beginPath(); ctx.moveTo(markerX, y - rowHeight * .175); ctx.lineTo(markerX, y + rowHeight * .175);
          ctx.strokeStyle = "#543200"; ctx.lineWidth = 3.5; ctx.stroke();
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        }
        if (!preview) {
          const value = integer(bin.count), metrics = ctx.measureText(value);
          text(value, histogram.x + bar + valueGap + metrics.actualBoundingBoxLeft, y, labelSize);
        }
      }
      if (!preview) text(bin.label, histogram.x + histogram.width + 16 * u, y, labelSize);
      ctx.restore();
    });
    if (!preview) {
      ctx.strokeStyle = light ? "#514d47" : "#444"; ctx.lineWidth = u;
      ctx.beginPath();
      for (let i = 0; i <= model.bins.length; i++) {
        const y = histogram.y + i * rowHeight;
        ctx.moveTo(histogram.x, y); ctx.lineTo(histogram.x + histogram.width, y);
      }
      ctx.moveTo(histogram.x, histogram.y); ctx.lineTo(histogram.x, bottom);
      ctx.moveTo(histogram.x + histogram.width, histogram.y); ctx.lineTo(histogram.x + histogram.width, bottom); ctx.stroke();
      const titleX = histogram.x + histogram.width / 2;
      const heading = (value, y, size, bold = false) => {
        font(ctx, size, bold, opts.branded);
        const fittedSize = size * Math.min(1, histogram.width / ctx.measureText(value).width);
        text(value, titleX, y, fittedSize, fg, "center", bold);
      };
      heading("Bitcoin Price Distribution", titleY, titleSize, exporting);
      heading("(Daily closes in each price range)", titleY + (exporting ? (landscape ? 38 : 34) * u : 24), exporting ? (landscape ? 28 : 22) * u : Math.min(16, width / 26));
    }
    if (exporting) {
      const B = window.WSBDashboardExportBranding;
      B.drawWordmark(ctx, { x: pad, y: 25 * u, width: (landscape ? 205 : 190) * u }, { theme: opts.theme });
      const dateY = (landscape ? 104 : 106) * u, blockY = (landscape ? 145 : 145) * u;
      const metadata = (label, value, y) => {
        const size = (landscape ? 28 : 24) * u;
        text(label, pad, y, size, muted);
        const x = pad + ctx.measureText(label + " ").width;
        text(value, x, y, size);
      };
      metadata("Date:", s.date, dateY); metadata("Block Height:", s.height, blockY);
      const px = (landscape ? 575 : 510) * u, ax = (landscape ? 935 : 860) * u;
      text("Price (BTCUSD)", px, 42 * u, (landscape ? 28 : 24) * u, muted, "center");
      text(s.price, px, 85 * u, (landscape ? 46 : 36) * u, fg, "center");
      text("Network Age", ax, 42 * u, (landscape ? 28 : 24) * u, muted, "center");
      text(s.age, ax, 85 * u, (landscape ? 46 : 36) * u, fg, "center");
      B.drawFooter(ctx, "price_distribution", { width, height, footerHeight: footer }, { theme: opts.theme, orientation: landscape ? "landscape" : portrait ? "portrait" : "square" });
    }
    let inspection = null;
    if (hoverIndex >= 0) {
      const sample = rows[hoverIndex], x = xAt(sample.time);
      T.drawGuide(ctx, history, x, priceY(sample.price), light, { line: false });
      inspection = { key: "history", plot: history, anchorX: x, title: DATE.format(sample.time) + " (UTC)", entries: [
        { label: "Block", value: integer(sample.height) },
        { label: "Price", value: priceLabel(sample.price), color: light ? "#975400" : orange },
      ] };
    } else if (hoverBinIndex >= 0) {
      const bin = model.bins[hoverBinIndex];
      inspection = { key: "distribution", plot: histogram, anchorX: pointer.x, title: bin.label, entries: [
        { label: "Days", value: integer(bin.count), color: light ? "#975400" : orange },
        { label: "Share", value: `${(100 * bin.count / model.total).toFixed(2)}%` },
      ] };
    }
    ctx.restore();
    return inspection;
  }
  window.WSBPriceDistributionChart = { ...History, summary, distribution, priceLabel, render };
}());
