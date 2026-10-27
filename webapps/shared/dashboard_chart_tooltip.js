(function () {
  "use strict";
  function contains(plot, point) {
    return !!point && point.x >= plot.x && point.x <= plot.x + plot.width && point.y >= plot.y && point.y <= plot.y + plot.height;
  }
  function nearest(rows, value, key, first, last) {
    let low = first, high = last;
    while (low < high) { const mid = (low + high) >> 1; if (rows[mid][key] < value) low = mid + 1; else high = mid; }
    return low > first && value - rows[low - 1][key] <= rows[low][key] - value ? low - 1 : low;
  }
  function drawGuide(ctx, plot, x, y, light, { line = true } = {}) {
    ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.width, plot.height); ctx.clip();
    ctx.strokeStyle = light ? "rgba(75,85,99,.55)" : "rgba(180,180,180,.7)";
    if (line) {
      ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.height); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = light ? "#111827" : "#fff"; ctx.fill(); ctx.restore();
  }
  function create(canvas) {
    const element = document.createElement("div");
    element.id = "chartTooltip"; element.className = "dashboard-chart-tooltip"; element.role = "tooltip"; element.hidden = true;
    document.body.appendChild(element);
    let activeKey = null, flipBoundary = null;
    function hide() { element.hidden = true; canvas.removeAttribute("aria-describedby"); activeKey = null; flipBoundary = null; }
    function show(info, pointer) {
      if (!info || !pointer) { hide(); return; }
      if (activeKey !== info.key) { activeKey = info.key; flipBoundary = null; }
      const title = document.createElement("div"); title.className = "dashboard-chart-tooltip-title"; title.textContent = info.title;
      const entries = info.entries.map(({ label, value, color }) => {
        const line = document.createElement("div"), name = document.createElement("span"), data = document.createElement("strong");
        name.textContent = label ? label + "  " : ""; data.textContent = value;
        if (color) data.style.color = color;
        line.append(name, data); return line;
      });
      element.replaceChildren(title, ...entries);
      const rect = canvas.getBoundingClientRect(), p = info.plot, pad = 8, gap = 10;
      const left = Math.max(pad, rect.left + p.x + pad), right = Math.min(innerWidth - pad, rect.left + p.x + p.width - pad);
      const top = Math.max(pad, rect.top + p.y), bottom = Math.min(innerHeight - pad, rect.top + p.y + p.height);
      if (right <= left || bottom <= top) { hide(); return; }
      element.style.maxWidth = `${right - left}px`; element.style.maxHeight = `${bottom - top}px`;
      element.style.left = `${left}px`; element.style.top = `${top}px`; element.hidden = false;
      const box = element.getBoundingClientRect(), guide = rect.left + info.anchorX;
      const overflows = guide + gap + box.width > right;
      if (overflows) flipBoundary = Number.isFinite(flipBoundary) ? Math.min(flipBoundary, guide) : guide;
      const flip = Number.isFinite(flipBoundary) ? guide >= flipBoundary : overflows;
      element.style.left = `${Math.max(left, Math.min(right - box.width, flip ? guide - gap - box.width : guide + gap))}px`;
      element.style.top = `${Math.max(top, Math.min(bottom - box.height, rect.top + pointer.y - box.height / 2))}px`;
      canvas.setAttribute("aria-describedby", element.id);
    }
    return { show, hide };
  }
  window.WSBDashboardChartTooltip = { create, contains, nearest, drawGuide };
}());
