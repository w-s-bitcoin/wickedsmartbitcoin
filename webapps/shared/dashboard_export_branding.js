(function () {
  "use strict";
  const base = new URL("export_assets/", document.currentScript.src);
  const BODY = '"WSB Export DejaVu", sans-serif';
  const FOOTER = '"WSB Export IBM Plex Mono", monospace';
  const MONO = '"WSB Export DejaVu Mono", monospace';
  let pending, assets;

  // Lazy, shared preparation: no requests until an exporter needs these assets.
  // Register fonts only after the whole set succeeds; a failed attempt can retry.
  function ready() {
    if (!pending) pending = (async () => {
      const faces = [
        ["WSB Export DejaVu", "DejaVuSans.ttf", "400"],
        ["WSB Export DejaVu", "DejaVuSans-Bold.ttf", "700"],
        ["WSB Export DejaVu Mono", "DejaVuSansMono.ttf", "400"],
        ["WSB Export IBM Plex Mono", "IBMPlexMono-Medium.ttf", "500"],
      ].map(([family, file, weight]) => new FontFace(family, `url("${new URL(file, base)}")`, { weight }));
      const wordmark = new Image(), creator = new Image(), lightning = new Image();
      wordmark.src = new URL("bitcoin-wordmark.jpg", base).href;
      creator.src = new URL("wicked-apple.png", base).href;
      lightning.src = new URL("../../../assets/qr_lightning.png", base).href;
      await Promise.all([...faces.map((face) => face.load()), wordmark.decode(), creator.decode(), lightning.decode()]);
      const wordmarkLight = lightWordmark(wordmark), creatorLight = lightCreator(creator);
      faces.forEach((face) => document.fonts.add(face));
      assets = { wordmark, wordmarkLight, creator, creatorLight, lightning };
    })().catch((error) => {
      pending = null;
      throw new Error(`Could not load export fonts, Bitcoin wordmark, creator icon, or Lightning QR: ${error.message}`);
    });
    return pending;
  }

  function assetCanvas(image) {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas rendering is unavailable for export branding.");
    return { canvas, ctx };
  }

  function lightWordmark(image) {
    const { canvas, ctx } = assetCanvas(image);
    // Invert only the lettering/background. Restore the original coin so its
    // orange and white Bitcoin glyph never pass through a color filter.
    ctx.filter = "invert(1)";
    ctx.drawImage(image, 0, 0);
    ctx.filter = "none";
    ctx.save(); ctx.beginPath();
    const radius = canvas.height / 2;
    ctx.arc(radius, radius, radius, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(image, 0, 0); ctx.restore();
    return canvas;
  }

  function lightCreator(image) {
    const { canvas, ctx } = assetCanvas(image);
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = pixels.data, width = canvas.width, height = canvas.height;
    const background = new Uint8Array(width * height), queue = new Uint32Array(width * height);
    let read = 0, write = 0;
    function visit(index) {
      if (background[index]) return;
      const offset = index * 4;
      if (Math.max(data[offset], data[offset + 1], data[offset + 2]) > 40 && data[offset + 3] > 0) return;
      background[index] = 1; queue[write++] = index;
    }
    for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1); }
    // The bundled apple also encloses background between its legs and between
    // its right arm and leg. Seed those two gaps without touching facial detail.
    for (const [x, y] of [[0.50, 0.80], [0.65, 0.73]]) visit(Math.floor(y * height) * width + Math.floor(x * width));
    while (read < write) {
      const index = queue[read++], x = index % width, y = Math.floor(index / width);
      if (x > 0) visit(index - 1); if (x + 1 < width) visit(index + 1);
      if (y > 0) visit(index - width); if (y + 1 < height) visit(index + width);
    }
    // Only the seeded background is rematted; eyes and other enclosed dark
    // details stay intact. A one-pixel edge blend removes the black matte
    // from antialiasing without recoloring the face, leaf, or hands.
    for (let index = 0; index < background.length; index++) {
      const offset = index * 4;
      if (background[index]) {
        data[offset] = data[offset + 1] = data[offset + 2] = data[offset + 3] = 255;
        continue;
      }
      const x = index % width, y = Math.floor(index / width);
      const touchesBackground = (x > 0 && background[index - 1]) || (x + 1 < width && background[index + 1])
        || (y > 0 && background[index - width]) || (y + 1 < height && background[index + width]);
      if (!touchesBackground) continue;
      const alpha = Math.min(1, Math.max(data[offset], data[offset + 1], data[offset + 2]) / 96);
      for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.min(255, data[offset + channel] + 255 * (1 - alpha));
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas;
  }

  function requireReady() {
    if (!assets) throw new Error("Export branding is not ready; await WSBDashboardExportBranding.ready() before drawing.");
  }

  function setFont(ctx, size, role = "body") {
    requireReady();
    if (!["body", "heading", "mono"].includes(role)) throw new Error(`Unknown export font role: ${role}`);
    ctx.font = `${role === "heading" ? "700" : "400"} ${size}px ${role === "mono" ? MONO : BODY}`;
  }

  // The dashboard owns the destination rectangle. Preserve the original mark's
  // lettering/aspect ratio and isolate the light-theme filter from chart drawing.
  function drawWordmark(ctx, { x, y, width }, { theme = "dark" } = {}) {
    requireReady();
    const wordmark = theme === "light" ? assets.wordmarkLight : assets.wordmark;
    ctx.save();
    try {
      ctx.filter = "none";
      ctx.drawImage(wordmark, x, y, width, width * wordmark.height / wordmark.width);
    } finally { ctx.restore(); }
  }

  function drawFooter(ctx, slug, metrics, settings = {}) {
    requireReady();
    if (typeof slug !== "string" || !/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(slug)) throw new Error("A canonical dashboard slug is required for the export footer.");
    return drawFooterStrip(ctx, `https://wickedsmartbitcoin.com/${slug}`, metrics, settings);
  }

  function drawFooterStrip(ctx, url, metrics, settings = {}) {
    requireReady();
    const { width, height } = metrics, compact = width <= height;
    // Callers reserve only the creator/donation row in portrait and square,
    // letting their charts reclaim the space previously occupied by the URL.
    const footerHeight = Math.min(height, Math.max(1, metrics.footerHeight));
    const light = settings.theme === "light", foreground = light ? "#282828" : "#dddddd", muted = light ? "#635e56" : "#aaa59a";
    const stacked = width / height < 1.35, top = height - footerHeight;
    // Landscape keeps the reference's single strip, measuring the actual gap
    // between creator and donation. Narrow exports omit the website URL.
    const unit = Math.min(width / 1920, footerHeight / 122);
    const margin = stacked ? Math.min(24, width * 0.025) : 32 * unit;
    const urlRowHeight = stacked && !compact ? footerHeight * 0.22 : 0;
    const contentTop = top + urlRowHeight;
    const contentHeight = footerHeight - urlRowHeight;
    const icon = Math.min(contentHeight * (stacked ? 0.90 : 0.82), stacked ? width * 0.11 : 100 * unit);
    const contentY = contentTop + (contentHeight - icon) / 2;
    const sectionScale = icon / 100;
    const creatorX = margin + 30 * sectionScale;
    const creatorTextX = creatorX + icon + 12 * sectionScale;
    const creatorRight = creatorTextX + 180 * sectionScale;
    // Match the visible address edge to CREATOR's outer margin rather than
    // reserving unused space after the address. Keep the address after the QR.
    ctx.save();
    setFont(ctx, 23 * sectionScale); ctx.textAlign = "left";
    const donationTextWidth = Math.max(...["wicked", "@primal.net"].map(text => ctx.measureText(text).actualBoundingBoxRight));
    ctx.restore();
    const qrX = width - margin - donationTextWidth - icon - 12 * sectionScale;
    const donationLeft = qrX - 56 * sectionScale;
    const donationTextX = qrX + icon + 12 * sectionScale;
    const urlLeft = stacked ? margin : creatorRight + 24 * unit;
    const urlRight = stacked ? width - margin : donationLeft - 24 * unit;
    const urlY = stacked ? top + urlRowHeight / 2 : contentTop + contentHeight * 0.58;
    ctx.save();
    try {
      ctx.filter = "none"; ctx.fillStyle = light ? "#ffffff" : "#000000"; ctx.fillRect(0, top, width, footerHeight);
      ctx.drawImage(light ? assets.creatorLight : assets.creator, creatorX, contentY, icon, icon);
      ctx.imageSmoothingEnabled = false;
      if (light) {
        // The canonical QR has a rounded black outer matte. Keep every QR
        // module and its quiet zone; replace only the decorative outside edge.
        ctx.fillStyle = "#ffffff"; ctx.fillRect(qrX, contentY, icon, icon);
        ctx.save(); ctx.beginPath();
        const inset = icon * 0.055;
        ctx.rect(qrX + inset, contentY + inset, icon - inset * 2, icon - inset * 2); ctx.clip();
        ctx.drawImage(assets.lightning, qrX, contentY, icon, icon); ctx.restore();
      } else ctx.drawImage(assets.lightning, qrX, contentY, icon, icon);
      ctx.imageSmoothingEnabled = true;
      ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = foreground;
      setFont(ctx, 31 * sectionScale, "heading"); ctx.fillText("Wicked", creatorTextX, contentY + icon * 0.42);
      setFont(ctx, 24 * sectionScale); ctx.fillStyle = muted; ctx.fillText("@w_s_bitcoin", creatorTextX, contentY + icon * 0.78);
      setFont(ctx, 23 * sectionScale); ctx.fillText("wicked", donationTextX, contentY + icon * 0.40);
      ctx.fillText("@primal.net", donationTextX, contentY + icon * 0.69);
      function vertical(text, x, y, size) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; setFont(ctx, size); ctx.fillStyle = foreground; ctx.fillText(text, 0, 0); ctx.restore();
      }
      setFont(ctx, 16 * sectionScale);
      const creatorLabelX = margin + ctx.measureText("CREATOR").actualBoundingBoxAscent;
      vertical("CREATOR", creatorLabelX, contentY + icon / 2, 16 * sectionScale);
      vertical("LIGHTNING", qrX - 37 * sectionScale, contentY + icon / 2, 15 * sectionScale);
      vertical("DONATIONS", qrX - 20 * sectionScale, contentY + icon / 2, 15 * sectionScale);
      ctx.strokeStyle = muted; ctx.lineWidth = Math.max(0.5, sectionScale);
      ctx.beginPath(); ctx.moveTo(creatorX - 10 * sectionScale, contentY + 4 * sectionScale); ctx.lineTo(creatorX - 10 * sectionScale, contentY + icon - 4 * sectionScale); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(qrX - 7 * sectionScale, contentY + 4 * sectionScale); ctx.lineTo(qrX - 7 * sectionScale, contentY + icon - 4 * sectionScale); ctx.stroke();
      let urlLayout = null;
      if (!compact) {
        const maximumFont = stacked ? urlRowHeight * 0.69 : 36 * unit;
        ctx.font = `500 ${maximumFont}px ${FOOTER}`;
        const available = Math.max(1, urlRight - urlLeft);
        const fontSize = Math.min(maximumFont, maximumFont * available / Math.max(1, ctx.measureText(url).width));
        ctx.font = `500 ${fontSize}px ${FOOTER}`; ctx.fillStyle = light ? "#77716b" : "#999999"; ctx.textAlign = "center";
        ctx.fillText(url, (urlLeft + urlRight) / 2, urlY);
        urlLayout = { left: urlLeft, right: urlRight, y: urlY, fontSize };
      }
      return { url: urlLayout, creator: { x: creatorX, y: contentY, size: icon },
        lightning: { x: qrX, y: contentY, size: icon }, stacked };
    } finally { ctx.restore(); }
  }

  window.WSBDashboardExportBranding = { ready, setFont, drawWordmark, drawFooter, drawFooterStrip };
}());
