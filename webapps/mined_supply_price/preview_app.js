(function () {
  "use strict";
  const P = window.WSBPreviewShared, Chart = window.WSBMinedSupplyPriceChart;
  const canvas = document.getElementById("previewCanvas");
  let installed = null, refresher;
  const spotFeed = window.WSBBitcoinSpotPrice?.create({ onQuote: () => refresher?.requestPresent("live-price") });
  function render() {
    if (!installed) return false;
    const rect = canvas.getBoundingClientRect(), width = Math.max(1, Math.round(rect.width)), height = Math.max(1, Math.round(rect.height));
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const visibleRows = Chart.withLiveQuote(installed.rows, spotFeed?.newerThan(installed.publishedAt));
    Chart.render(ctx, width, height, visibleRows, visibleRows.length - 1,
      { theme: document.documentElement.dataset.theme === "light" ? "light" : "dark", preview: true, previewInsets: P.chartInsets(width, height) });
    canvas.dataset.endDate = installed.rows.at(-1).iso;
    return true;
  }
  P.initThemeSync({ onThemeChanged: () => refresher?.requestPresent("theme") });
  refresher = P.createDataRefresher({ filename: "mined_supply_price.png", urls: ["../../assets/daily_price_metadata.json"],
    getInstalledSignature: () => installed?.signature || "", prepare: (context) => Chart.prepareCandidate(context.fetchFresh),
    commit: (candidate) => { installed = candidate; return { present: true }; }, present: render,
    onError: (error) => console.warn("Mined Supply and Price preview retained its last complete history.", error),
  });
  window.addEventListener("resize", () => refresher.requestPresent("resize"));
  window.addEventListener("pagehide", () => spotFeed?.stop());
  window.addEventListener("pageshow", () => spotFeed?.start());
  spotFeed?.start();
  refresher.start();
}());
