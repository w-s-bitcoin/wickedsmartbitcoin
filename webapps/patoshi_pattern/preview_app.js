(() => {
  const canvas = document.getElementById("patoshiPreview");
  const ctx = canvas.getContext("2d", { alpha: false });
  const DATA_URL = "webapp_data/patoshi_preview_blocks.csv";
  const START = Date.UTC(2009, 0, 9);
  const END = Date.UTC(2009, 5, 1);

  function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    const header = lines.shift().split(",");
    return lines.map((line) => {
      const parts = line.split(",");
      const obj = {};
      header.forEach((key, i) => { obj[key] = parts[i]; });
      return {
        ms: Number(obj.timestamp) * 1000,
        extranonce: Number(obj.extranonce),
        patoshi: obj.patoshi === "1",
        isSpent: obj.is_spent === "1",
      };
    }).filter((row) => row.ms >= START && row.ms <= END);
  }

  function resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(320, window.innerWidth);
    const h = Math.max(180, window.innerHeight);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  function draw(rows) {
    const { w, h } = resize();
    const light = document.documentElement.dataset.theme === "light";
    ctx.fillStyle = light ? "#fff" : "#000";
    ctx.fillRect(0, 0, w, h);
    const maxY = Math.max(500, ...rows.filter((row) => row.patoshi).map((row) => row.extranonce));
    const x = (ms) => 16 + ((ms - START) / (END - START)) * (w - 32);
    const y = (v) => h - 12 - (v / maxY) * (h - 24);

    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#ff9900";
    ctx.beginPath();
    let started = false;
    let previous = null;
    rows.filter((row) => row.patoshi).forEach((row) => {
      if (previous && row.extranonce > previous.extranonce) {
        if (!started) {
          ctx.moveTo(x(previous.ms), y(previous.extranonce));
          started = true;
        }
        ctx.lineTo(x(row.ms), y(row.extranonce));
      } else if (started) {
        ctx.stroke();
        ctx.beginPath();
        started = false;
      }
      previous = row;
    });
    ctx.stroke();

    rows.forEach((row) => {
      ctx.fillStyle = row.patoshi ? "#ff9900" : "#0065ff";
      ctx.globalAlpha = row.patoshi ? 0.95 : 0.5;
      ctx.beginPath();
      ctx.arc(x(row.ms), y(row.extranonce), row.patoshi ? 2.2 : 1.8, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  fetch(DATA_URL, { cache: "force-cache" }).then((r) => r.text()).then((text) => {
    const rows = parseCsv(text);
    window.WSBPreviewShared?.initThemeSync?.({ onThemeChanged: () => draw(rows) });
    draw(rows);
    window.WSBPreviewShared?.markReady?.({ filename: "patoshi_pattern.png" });
    window.addEventListener("resize", () => draw(rows));
  });
})();
