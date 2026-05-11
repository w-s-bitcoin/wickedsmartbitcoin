(function () {
  function parseCsv(text) {
    const lines = String(text || "").trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",");
    return lines.slice(1).map((line) => {
      const cols = line.split(",");
      const out = {};
      headers.forEach((h, i) => out[h.trim()] = (cols[i] || "").trim());
      return out;
    });
  }

  async function loadRows() {
    const res = await fetch("../../assets/daily_price.csv", { cache: "no-store" });
    if (!res.ok) return [];
    const rows = parseCsv(await res.text())
      .map((r) => ({
        date: new Date(r.date),
        price: Number(r.price),
      }))
      .filter((r) => !Number.isNaN(r.date.getTime()) && Number.isFinite(r.price) && r.price > 0)
      .sort((a, b) => a.date - b.date);
    return rows;
  }

  function drawLine(canvas, values, color) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(120, Math.round(rect.width));
    const h = Math.max(90, Math.round(rect.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx || !values.length) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const min = Math.min(...values);
    const max = Math.max(...values);
    const minL = Math.log10(min);
    const maxL = Math.log10(max);
    const pad = 8;
    const cw = w - pad * 2;
    const ch = h - pad * 2;

    const xFor = (i) => pad + (i / Math.max(1, values.length - 1)) * cw;
    const yFor = (v) => pad + ((maxL - Math.log10(v)) / Math.max(1e-9, (maxL - minL))) * ch;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = xFor(i);
      const y = yFor(v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  async function render() {
    const rows = await loadRows();
    if (!rows.length) return;
    const left = rows.map((r) => 100000000 / r.price);
    const right = rows.map((r) => r.price);
    drawLine(document.getElementById("l"), left, "#ffae00");
    drawLine(document.getElementById("r"), right, "#34d399");
  }

  window.WSBPreviewShared?.initThemeSync({ onThemeChanged: render });
  render();
  window.addEventListener("resize", render);
}());
