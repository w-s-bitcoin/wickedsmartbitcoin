(function () {
  "use strict";
  const M = window.WSBEOEGrowthModel, G = window.WSBEOEGrowthCharts;
  let installed = null, frame = null, refresher = null;
  let liveTimer = 0;
  const liveFeed = window.WSBEOEGrowthLive.create({ getPublishedAt: () => installed, onChange: () => {
    if (!liveTimer) liveTimer = setTimeout(() => { liveTimer = 0; refresher?.requestPresent("live-price"); }, 1000);
  } });

  function render() {
    if (!installed || !frame) return false;
    const canvas = document.getElementById("eoeGrowthPreview");
    const current = liveFeed.current(installed);
    const view = (current && M.liveFrame(installed.model, current)) || frame;
    const { ctx, width, height } = G.setup(canvas);
    G.panel(ctx, { x: 0, y: 0, width, height }, {
      frame: view, theme: document.documentElement.dataset.theme, compact: true,
    });
    canvas.dataset.endDate = view.row.date;
    canvas.dataset.blockHeight = String(view.row.height);
    canvas.dataset.referenceHeight = view.current ? String(view.current.reference.height) : "";
    canvas.dataset.chainSource = view.current?.tip.source === "mempool"
      ? (view.current.chainLive ? "live" : "retained") : "published";
    canvas.dataset.priceSource = view.current ? (view.current.live ? "live" : "retained") : "published";
    return true;
  }

  window.WSBPreviewShared?.initThemeSync({ onThemeChanged: () => refresher?.requestPresent("theme") });
  refresher = window.WSBPreviewShared.createDataRefresher({
    filename: "eoe_growth.png", urls: [M.MARKER_URL],
    getInstalledSignature: () => installed?.signature || "",
    prepare: M.prepareCandidate,
    validate: (candidate) => M.validateCandidate(candidate, installed),
    commit: (candidate) => {
      const nextFrame = M.frame(candidate.model, candidate.model.rows.length - 1);
      installed = candidate;
      frame = nextFrame;
      liveFeed.refresh();
      return { present: true };
    },
    present: render,
    onError: (error) => console.warn("Epoch-Over-Epoch Growth preview retained its last complete generation.", error),
  });
  window.addEventListener("resize", () => refresher.requestPresent("resize"));
  refresher.start();
  liveFeed.start();
  window.addEventListener("pagehide", () => { liveFeed.stop(); clearTimeout(liveTimer); liveTimer = 0; });
  window.addEventListener("pageshow", () => liveFeed.start());
}());
