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
      const wordmark = new Image();
      wordmark.src = new URL("bitcoin-wordmark.jpg", base).href;
      await Promise.all([...faces.map((face) => face.load()), wordmark.decode()]);
      faces.forEach((face) => document.fonts.add(face));
      assets = { wordmark };
    })().catch((error) => {
      pending = null;
      throw new Error(`Could not load export fonts or Bitcoin wordmark: ${error.message}`);
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
    window.WSBDashboardExport.drawFooterUrl(ctx, `https://wickedsmartbitcoin.com/${slug}`, metrics, {
      ...settings, fontFamily: FOOTER,
    });
  }

  window.WSBDashboardExportBranding = { ready, setFont, drawWordmark, drawFooter };
}());
