(function () {
  "use strict";
  const base = new URL("export_assets/", document.currentScript.src);
  const BODY = '"WSB Export DejaVu", sans-serif';
  const FOOTER = '"WSB Export IBM Plex Mono", monospace';
  let pending, assets;

  // Lazy, shared preparation: no requests until an exporter needs these assets.
  // Register fonts only after the whole set succeeds; a failed attempt can retry.
  function ready() {
    if (!pending) pending = (async () => {
      const faces = [
        ["WSB Export DejaVu", "DejaVuSans.ttf", "400"],
        ["WSB Export DejaVu", "DejaVuSans-Bold.ttf", "700"],
        ["WSB Export IBM Plex Mono", "IBMPlexMono-Medium.ttf", "500"],
      ].map(([family, file, weight]) => new FontFace(family, `url("${new URL(file, base)}")`, { weight }));
      const wordmark = new Image(), creator = new Image(), lightning = new Image();
      wordmark.src = new URL("bitcoin-wordmark.jpg", base).href;
      creator.src = new URL("wicked-apple.png", base).href;
      lightning.src = new URL("../../../assets/qr_lightning.png", base).href;
      await Promise.all([...faces.map((face) => face.load()), wordmark.decode(), creator.decode(), lightning.decode()]);
      faces.forEach((face) => document.fonts.add(face));
      assets = { wordmark, creator, lightning };
    })().catch((error) => {
      pending = null;
      throw new Error(`Could not load export fonts, Bitcoin wordmark, creator icon, or Lightning QR: ${error.message}`);
    });
    return pending;
  }

  function requireReady() {
    if (!assets) throw new Error("Export branding is not ready; await WSBDashboardExportBranding.ready() before drawing.");
  }

  function setFont(ctx, size, role = "body") {
    requireReady();
    if (!["body", "heading"].includes(role)) throw new Error(`Unknown export font role: ${role}`);
    ctx.font = `${role === "heading" ? "700" : "400"} ${size}px ${BODY}`;
  }

  // The dashboard owns the destination rectangle. Preserve the original mark's
  // lettering/aspect ratio and isolate the light-theme filter from chart drawing.
  function drawWordmark(ctx, { x, y, width }, { theme = "dark" } = {}) {
    requireReady();
    const { wordmark } = assets;
    ctx.save();
    try {
      ctx.filter = theme === "light" ? "invert(1) hue-rotate(180deg)" : "none";
      ctx.drawImage(wordmark, x, y, width, width * wordmark.naturalHeight / wordmark.naturalWidth);
    } finally { ctx.restore(); }
  }

  function drawFooter(ctx, slug, metrics, settings = {}) {
    requireReady();
    if (typeof slug !== "string" || !/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(slug)) throw new Error("A canonical dashboard slug is required for the export footer.");
    return drawFooterStrip(ctx, `https://wickedsmartbitcoin.com/${slug}`, metrics, settings);
  }

  function drawFooterStrip(ctx, url, metrics, settings = {}) {
    requireReady();
    const { width, height } = metrics, footerHeight = Math.min(height, Math.max(1, metrics.footerHeight));
    const light = settings.theme === "light", foreground = light ? "#282828" : "#dddddd", muted = light ? "#635e56" : "#aaa59a";
    const stacked = width / height < 1.35, top = height - footerHeight;
    // Portrait/square get a separate URL row. Landscape keeps the reference's
    // single strip, measuring the actual gap between creator and donation.
    const unit = Math.min(width / 1920, footerHeight / 122);
    const margin = stacked ? Math.min(24, width * 0.025) : 32 * unit;
    const urlRowHeight = stacked ? footerHeight * 0.22 : 0;
    const contentTop = top + urlRowHeight;
    const contentHeight = footerHeight - urlRowHeight;
    const icon = Math.min(contentHeight * (stacked ? 0.90 : 0.82), stacked ? width * 0.11 : 100 * unit);
    const contentY = contentTop + (contentHeight - icon) / 2;
    const sectionScale = icon / 100;
    const creatorX = margin + 30 * sectionScale;
    const creatorTextX = creatorX + icon + 12 * sectionScale;
    const creatorRight = creatorTextX + 180 * sectionScale;
    const donationTextWidth = 180 * sectionScale;
    const qrX = width - margin - donationTextWidth - icon - 12 * sectionScale;
    const donationLeft = qrX - 56 * sectionScale;
    const donationTextX = qrX + icon + 12 * sectionScale;
    const urlLeft = stacked ? margin : creatorRight + 24 * unit;
    const urlRight = stacked ? width - margin : donationLeft - 24 * unit;
    const urlY = stacked ? top + urlRowHeight / 2 : contentTop + contentHeight * 0.58;
    ctx.save();
    try {
      ctx.filter = "none"; ctx.fillStyle = light ? "#ffffff" : "#000000"; ctx.fillRect(0, top, width, footerHeight);
      ctx.drawImage(assets.creator, creatorX, contentY, icon, icon);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(assets.lightning, qrX, contentY, icon, icon);
      ctx.imageSmoothingEnabled = true;
      ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = foreground;
      setFont(ctx, 31 * sectionScale, "heading"); ctx.fillText("Wicked", creatorTextX, contentY + icon * 0.42);
      setFont(ctx, 24 * sectionScale); ctx.fillStyle = muted; ctx.fillText("@w_s_bitcoin", creatorTextX, contentY + icon * 0.78);
      setFont(ctx, 23 * sectionScale); ctx.fillText("wicked", donationTextX, contentY + icon * 0.40);
      ctx.fillText("@primal.net", donationTextX, contentY + icon * 0.69);
      function vertical(text, x, y, size) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; setFont(ctx, size); ctx.fillStyle = foreground; ctx.fillText(text, 0, 0); ctx.restore();
      }
      vertical("CREATOR", margin + 8 * sectionScale, contentY + icon / 2, 16 * sectionScale);
      vertical("LIGHTNING", qrX - 37 * sectionScale, contentY + icon / 2, 15 * sectionScale);
      vertical("DONATIONS", qrX - 20 * sectionScale, contentY + icon / 2, 15 * sectionScale);
      ctx.strokeStyle = muted; ctx.lineWidth = Math.max(0.5, sectionScale);
      ctx.beginPath(); ctx.moveTo(creatorX - 10 * sectionScale, contentY + 4 * sectionScale); ctx.lineTo(creatorX - 10 * sectionScale, contentY + icon - 4 * sectionScale); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(qrX - 7 * sectionScale, contentY + 4 * sectionScale); ctx.lineTo(qrX - 7 * sectionScale, contentY + icon - 4 * sectionScale); ctx.stroke();
      const maximumFont = stacked ? urlRowHeight * 0.69 : 36 * unit;
      ctx.font = `500 ${maximumFont}px ${FOOTER}`;
      const available = Math.max(1, urlRight - urlLeft);
      const fontSize = Math.min(maximumFont, maximumFont * available / Math.max(1, ctx.measureText(url).width));
      ctx.font = `500 ${fontSize}px ${FOOTER}`; ctx.fillStyle = light ? "#77716b" : "#999999"; ctx.textAlign = "center";
      ctx.fillText(url, (urlLeft + urlRight) / 2, urlY);
      return { url: { left: urlLeft, right: urlRight, y: urlY, fontSize }, creator: { x: creatorX, y: contentY, size: icon },
        lightning: { x: qrX, y: contentY, size: icon }, stacked };
    } finally { ctx.restore(); }
  }

  window.WSBDashboardExportBranding = { ready, setFont, drawWordmark, drawFooter, drawFooterStrip };
}());
