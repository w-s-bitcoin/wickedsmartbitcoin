(function () {
  "use strict";
  const M = window.WSBTargetHashesModel;
  let rasterCache = null;
  function render(ctx, width, height, rows, index, opts = {}) {
    if (!rows.length) return;
    const row = rows[index], s = M.summary(row), preview = !!opts.preview, exporting = !!opts.export;
    const light = opts.theme === "light", fg = light ? "#171717" : "#fff", bg = light ? "#fff" : "#000";
    const orange = light ? "#bf7000" : "#ff9900", green = light ? "#38742b" : "#4f913f", blue = "#1338be";
    const u = width / 2048, footer = exporting ? Math.min(height * .12, 130 * u) : 0;
    const previewInset = Math.max(4, 10 * u) + 2;
    const left = preview ? previewInset : 42 * u, right = preview ? width - previewInset : width - 43 * u;
    const top = preview ? 0 : 294 * u, bottom = height - footer - (preview ? 0 : exporting ? 6 * u : 16);
    const plot = { x: left, y: top, width: right - left, height: bottom - top };
    const lower = Math.min(0, index - 2016 * 16), span = Math.max(1, index - lower);
    // Grid cards use the observed data bounds; the dashboard and exports keep
    // the reference's 34-digit scale and aligned hexadecimal header columns.
    const maxLog = preview ? Math.max(...rows.epochs.slice(0, rows.epochAt[index] + 1).map((e) => e.log)) : 64;
    const minLog = preview ? rows.logs[row.lowHeight] : 30;
    const logSpan = Math.max(.001, maxLog - minLog);
    const xAt = (log) => left + (maxLog - log) / logSpan * plot.width;
    const yAt = (h) => bottom - (h - lower) / span * plot.height;
    ctx.save(); ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
    function text(value, x, y, size, color = fg, align = "left", mono = false) {
      if (opts.branded) window.WSBDashboardExportBranding.setFont(ctx, size, mono ? "mono" : "body");
      else ctx.font = `400 ${size}px ${mono ? (opts.branded ? '"WSB Export IBM Plex Mono", monospace' : '"IBM Plex Mono", monospace') : '"Space Grotesk", sans-serif'}`;
      ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.fillText(value, x, y);
    }
    function marker(x, y, kind, size, color) {
      ctx.save(); ctx.fillStyle = color; ctx.beginPath();
      const count = kind === "star" ? 10 : 4;
      for (let j = 0; j < count; j++) {
        const angle = -Math.PI / 2 + j * Math.PI * 2 / count, r = kind === "star" && j % 2 ? size * .4 : size;
        const px = x + Math.cos(angle) * r, py = y + Math.sin(angle) * r;
        if (j) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x, y, (exporting ? size * .11 : Math.max(.5, size * .11)), 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    if (!preview) {
      ctx.strokeStyle = light ? "#d2d2d2" : "#353535"; ctx.lineWidth = 1.1 * u;
      ctx.beginPath(); for (let i = 0; i <= 34; i++) { const x = left + i / 34 * plot.width; ctx.moveTo(x, top); ctx.lineTo(x, bottom); } ctx.stroke();
    }
    ctx.save(); ctx.beginPath(); ctx.rect(preview ? 0 : left, top, preview ? width : plot.width, plot.height); ctx.clip();
    // Rasterize every observed block, with alpha compositing at its true pixel.
    // No sampling/aggregation discards rare low hashes or changes the density.
    const pixelWidth = Math.max(1, Math.ceil(plot.width)), pixelHeight = Math.max(1, Math.ceil(plot.height));
    const key = `${index}:${pixelWidth}:${pixelHeight}:${light}:${preview}:${exporting}`;
    if (!rasterCache || rasterCache.rows !== rows || rasterCache.key !== key) {
      const canvas = document.createElement("canvas"); canvas.width = pixelWidth; canvas.height = pixelHeight;
      const pixels = canvas.getContext("2d").createImageData(pixelWidth, pixelHeight), rgba = pixels.data;
      const rgb = light ? [191, 112, 0] : [255, 153, 0];
      const baseAlpha = .025 * Math.max((840000 - index) / 42000, 1), mean = Math.max(.00001, rows.means[index]);
      const radius = exporting ? u * .65 : .5;
      for (let i = 0; i <= index; i++) {
        const x = (maxLog - rows.logs[i]) / logSpan * pixelWidth, y = pixelHeight - (i - lower) / span * pixelHeight;
        const alpha = Math.min(1, baseAlpha + .975 * (rows.epochs[rows.epochAt[i]].log - rows.logs[i]) / mean);
        for (let yy = Math.max(0, Math.floor(y - radius)); yy <= Math.min(pixelHeight - 1, Math.floor(y + radius)); yy++) {
          for (let xx = Math.max(0, Math.floor(x - radius)); xx <= Math.min(pixelWidth - 1, Math.floor(x + radius)); xx++) {
            const coverage = Math.max(0, Math.min(xx + 1, x + radius) - Math.max(xx, x - radius)) * Math.max(0, Math.min(yy + 1, y + radius) - Math.max(yy, y - radius));
            const off = (yy * pixelWidth + xx) * 4;
            rgba[off] = rgb[0]; rgba[off + 1] = rgb[1]; rgba[off + 2] = rgb[2]; rgba[off + 3] += (255 - rgba[off + 3]) * alpha * coverage;
          }
        }
      }
      canvas.getContext("2d").putImageData(pixels, 0, 0); rasterCache = { rows, key, canvas };
    }
    ctx.drawImage(rasterCache.canvas, left, top, plot.width, plot.height);
    // The target is constant between recorded changes. Preserve both vertices
    // at each boundary instead of repeatedly drawing a million collinear points.
    ctx.beginPath(); ctx.moveTo(xAt(rows.epochs[0].log), yAt(0));
    for (let e = 1; e < rows.epochs.length && rows.epochs[e].height <= index; e++) {
      const epoch = rows.epochs[e]; ctx.lineTo(xAt(rows.epochs[e - 1].log), yAt(epoch.height - 1)); ctx.lineTo(xAt(epoch.log), yAt(epoch.height));
    }
    ctx.lineTo(xAt(rows.epochs[rows.epochAt[index]].log), yAt(index));
    ctx.strokeStyle = fg; ctx.lineWidth = exporting ? 3 * u : Math.max(1.2, 3 * u); ctx.lineJoin = "round"; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(xAt(rows.logs[0]), yAt(0)); let previousLow = 0;
    for (const i of rows.records) if (i && i <= index) {
      ctx.lineTo(xAt(rows.logs[previousLow]), yAt(i - 1)); ctx.lineTo(xAt(rows.logs[i]), yAt(i)); previousLow = i;
    }
    ctx.lineTo(xAt(rows.logs[previousLow]), yAt(index)); ctx.strokeStyle = green; ctx.lineWidth = exporting ? 1.5 * u : Math.max(.8, 1.5 * u); ctx.setLineDash([4 * u, 3 * u]); ctx.stroke(); ctx.setLineDash([]);
    for (let i = 210000; i <= index; i += 210000) marker(xAt(rows.logs[i]), yAt(i), "diamond", exporting ? 8 * u : Math.max(3, 8 * u), blue);
    marker(xAt(rows.logs[row.lowHeight]), yAt(row.lowHeight), "star", exporting ? 10 * u : Math.max(4, 10 * u), green);
    ctx.restore();
    if (!preview) {
      const lowHash = rows.getHash(row.lowHeight), digitSize = 45 * u, labelSize = 25 * u;
      for (const [hash, y, color] of [[lowHash, 78, green], [row.hash, 171, orange], [row.target, 264, fg]]) {
        for (let i = 0; i < 33; i++) text(hash[i], left + (i + .5) / 34 * plot.width, y * u, digitSize, color, "center", true);
        text("...", right + 5 * u, y * u, digitSize * .85, color, "right", true);
      }
      function bracket(hash, log, y, color) {
        const x = xAt(log), cy = y * u;
        ctx.strokeStyle = color; ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.moveTo(left, cy + 12 * u); ctx.lineTo(left, cy); ctx.lineTo(x, cy); ctx.lineTo(x, cy + 12 * u); ctx.stroke();
        const value = `${hash.match(/^0*/)[0].length} leading zeros`;
        text(value, (left + x) / 2, cy, labelSize, color, "center");
        const metrics = ctx.measureText(value); ctx.fillStyle = bg; ctx.fillRect((left + x - metrics.width) / 2 - 8 * u, cy - 17 * u, metrics.width + 16 * u, 34 * u);
        text(value, (left + x) / 2, cy, labelSize, color, "center");
      }
      bracket(lowHash, rows.logs[row.lowHeight], 33, green); bracket(row.target, rows.epochs[rows.epochAt[index]].log, 219, fg);
      for (const [label, y, color] of [[`★ Lowest Hash (Block Height: ${row.lowHeight})`, 33, green], [`Block Hash (Block Height: ${index})`, 126, orange], [`Target Hash (Difficulty Epoch: ${s.epoch})`, 219, fg]]) {
        text(label, right + 5 * u, y * u, labelSize, color, "right");
      }
      text(`Difficulty: ${s.difficulty}`, left, top + 17 * u, labelSize);
      text(`Target Hashrate: ${s.hashrate}`, left, top + 57 * u, labelSize);
      marker(left + 12 * u, top + 94 * u, "star", 10 * u, green); text("Lowest Block Hash", left + 30 * u, top + 96 * u, labelSize);
      marker(left + 12 * u, top + 134 * u, "diamond", 8 * u, blue); text("Halving Blocks", left + 30 * u, top + 136 * u, labelSize);
    }
    if (exporting) window.WSBDashboardExportBranding.drawFooter(ctx, "target_and_block_hashes", { width, height, footerHeight: footer }, { theme: opts.theme });
    let inspection = null;
    const T = window.WSBDashboardChartTooltip;
    if (!exporting && !preview && Number.isInteger(opts.selectedHeight)) {
      const h = opts.selectedHeight;
      if (h >= 0 && h <= index) {
        const sample = rows[h], x = xAt(rows.logs[h]), y = yAt(h);
        T.drawGuide(ctx, plot, x, y, light, { line: false, clip: false });
        ctx.save(); ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.strokeStyle = fg; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        inspection = { key: "block", plot, anchorX: x, pointer: { x, y }, title: `Block ${h.toLocaleString("en-US")}`, entries: [
          { label: "Time (UTC)", value: sample.timestamp },
          { label: "Hash", value: sample.hash, color: h === row.lowHeight ? green : h > 0 && h % 210000 === 0 ? blue : orange },
          { label: "Difficulty", value: M.summary(sample).difficulty },
          { label: "Lowest hash at block", value: sample.lowHeight.toLocaleString("en-US"), color: green },
        ] };
      }
    }
    ctx.restore(); return inspection;
  }
  function revealSelection(canvas, rows, height) {
    const scroller = canvas.parentElement, width = canvas.clientWidth, u = width / 2048;
    if (scroller.scrollWidth > scroller.clientWidth) {
      const x = 42 * u + (64 - rows.logs[height]) / 34 * (width - 85 * u);
      scroller.scrollLeft = Math.max(0, x - scroller.clientWidth / 2);
    }
  }
  window.WSBTargetHashesChart = { ...M, render, revealSelection };
}());
