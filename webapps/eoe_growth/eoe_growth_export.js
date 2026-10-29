(function () {
  "use strict";
  const B = window.WSBDashboardExportBranding, R = window.WSBEOEGrowthCharts;
  function layout(width, height) {
    if (width > height) return { width: 1920, height: 1080, title: { x: 970, y: 57, width: 1310 }, logo: { x: 38, y: 32, width: 200 }, date: { x: 40, y: 108 },
      kpis: [{ x: 454, y: 114 }, { x: 736, y: 114 }, { x: 1073, y: 114 }, { x: 1404, y: 114 }, { x: 1740, y: 114 }],
      plot: { left: 189, top: 186, right: 1626, bottom: 878, width: 1437, height: 692 },
      legend: { x: 1658, y: 230, width: 24, height: 600 }, xTitleY: 935, yTitleX: 55, footerHeight: 122, tickSize: 26, kpiSize: 40, labelSize: 24 };
    const portrait = height > width;
    return { width: 1080, height: portrait ? 1920 : 1080, title: { x: 540, y: 48, width: 996 }, logo: { x: 40, y: 88, width: 200 }, date: { x: 332, y: 101 },
      kpis: [{ x: 150, y: 188 }, { x: 480, y: 188 }, { x: 300, y: 280 }, { x: 760, y: 280 }, { x: 860, y: 188 }],
      plot: { left: 145, top: 360, right: 1022, bottom: portrait ? 1640 : 812, width: 877, height: portrait ? 1280 : 452 },
      legend: { x: 145, y: portrait ? 1742 : 903, width: 877, height: 18 }, horizontalLegend: true,
      xTitleY: portrait ? 1702 : 868, yTitleX: 38, footerHeight: 117, tickSize: 23, kpiSize: 36, labelSize: 22 };
  }
  function render(ctx, width, height, options) {
    const frame = R.getFrame(options), row = frame.row, theme = options.theme || "dark", colors = R.palette(theme), l = layout(width, height);
    const font = (size, bold = false) => B.setFont(ctx, size, bold ? "heading" : "body");
    ctx.save(); ctx.scale(width / l.width, height / l.height); ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, l.width, l.height);
    ctx.fillStyle = colors.fg; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const title = "Epoch-Over-Epoch (EOE) Growth"; font(42, true); font(Math.min(42, 42 * l.title.width / ctx.measureText(title).width), true);
    ctx.fillText(title, l.title.x, l.title.y); B.drawWordmark(ctx, l.logo, { theme });
    font(24); ctx.textAlign = "left";
    for (const [label, value, y] of [["Date:", window.WSBDashboardExport.formatDailyDate(row.time), l.date.y], ["Block Height:", String(row.height), l.date.y + 35]]) {
      ctx.fillStyle = "#999999"; ctx.fillText(label, l.date.x, y);
      ctx.fillStyle = colors.fg;
      const x = l.date.x + ctx.measureText(label + " ").width;
      if (label === "Date:") B.drawDateText(ctx, value, x, y, 24);
      else ctx.fillText(value, x, y);
    }
    const values = [["Epoch", String(row.epoch)], ["Epoch Block Count", String(row.epochBlockCount ?? row.count)],
      [`Epoch ${Math.max(0, row.epoch - 1)} Price`, R.kpiMoney(row.previousPrice)], [`Epoch ${row.epoch} Price`, R.kpiMoney(row.price)], ["EOE Growth", R.growthLabel(row.growth)]];
    values.forEach(([label, value], index) => {
      const anchor = l.kpis[index]; ctx.textAlign = "center"; font(l.labelSize); ctx.fillStyle = "#999999"; ctx.fillText(label, anchor.x, anchor.y);
      font(l.kpiSize); ctx.fillStyle = index === 4 ? R.growthTextColor(row.growth, theme) : colors.fg;
      const available = l.width > l.height ? (index === 0 ? 180 : 300) : index > 1 && index < 4 ? 420 : 300;
      if (ctx.measureText(value).width > available) font(l.kpiSize * available / ctx.measureText(value).width);
      ctx.fillText(value, anchor.x, anchor.y + 41);
    });
    const g = R.geometry(l.plot);
    R.drawAxes(ctx, frame, g, { colors, font, fontSize: l.tickSize, epochFontSize: 14, gridWidth: 1.15, tickPad: l.horizontalLegend ? 17 : 9, xLabelOffset: 18 });
    R.drawSeries(ctx, frame, g, { colors, lineWidth: 2.6 });
    R.drawLegend(ctx, l.legend, row.growth, { colors, font, fontSize: l.horizontalLegend ? 18 : 21, allLabels: !l.horizontalLegend, horizontal: !!l.horizontalLegend, pointerSize: 9 });
    font(34); ctx.fillStyle = colors.fg; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("Epoch Block Count", l.plot.left + l.plot.width / 2, l.xTitleY);
    ctx.save(); ctx.translate(l.yTitleX, l.plot.top + l.plot.height / 2); ctx.rotate(-Math.PI / 2); ctx.fillText("Price (BTCUSD)", 0, 0); ctx.restore();
    B.drawFooter(ctx, "eoe_growth", { width: l.width, height: l.height, footerHeight: l.footerHeight }, { theme, orientation: l.width > l.height ? "landscape" : l.width === l.height ? "square" : "portrait" });
    ctx.restore();
  }
  window.WSBEOEGrowthExport = { ready: B.ready, render, layout };
}());
