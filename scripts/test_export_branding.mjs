import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fixture() {
  const faces = [], images = [], registered = [], footers = [];
  class FontFace {
    constructor(family, source, descriptors = {}) {
      Object.assign(this, { family, source, descriptors, status: "unloaded", pending: deferred() });
      faces.push(this);
    }
    load() {
      this.status = "loading";
      return this.pending.promise.then(() => { this.status = "loaded"; return this; });
    }
  }
  class Image {
    constructor() {
      Object.assign(this, { width: 1873, height: 394, naturalWidth: 1873, naturalHeight: 394, pending: deferred() });
      images.push(this);
    }
    decode() { return this.pending.promise; }
  }
  const document = {
    currentScript: { src: "https://example.test/project/webapps/shared/dashboard_export_branding.js?v=3" },
    fonts: { add(face) { registered.push(face); } },
  };
  const window = { WSBDashboardExport: { drawFooterUrl(...args) { footers.push(args); } } };
  runInNewContext(readFileSync(new URL("../webapps/shared/dashboard_export_branding.js", import.meta.url), "utf8"),
    { window, document, FontFace, Image, URL });
  // Asset resolution must not depend on the calling page or a later script.
  document.currentScript = null;
  return { B: window.WSBDashboardExportBranding, faces, images, registered, footers };
}

async function settle() { await Promise.resolve(); await Promise.resolve(); }
function resolveAll(f, firstFace = 0, firstImage = 0) {
  f.faces.slice(firstFace).forEach((face) => face.pending.resolve());
  f.images.slice(firstImage).forEach((image) => image.pending.resolve());
}
async function prepare(f) {
  const pending = f.B.ready();
  await settle();
  resolveAll(f);
  await pending;
}
function context() {
  const stack = [];
  return {
    font: "initial font", filter: "initial filter", calls: [],
    save() { stack.push({ font: this.font, filter: this.filter }); this.calls.push(["save"]); },
    restore() { Object.assign(this, stack.pop()); this.calls.push(["restore"]); },
    drawImage(...args) { this.calls.push(["drawImage", ...args, this.filter]); },
  };
}

test("branding is lazy and rejects rendering until every required asset is ready", async () => {
  const f = fixture(), ctx = context();
  assert.equal(f.faces.length, 0);
  assert.equal(f.images.length, 0);
  const draws = () => [
    () => f.B.setFont(ctx, 20),
    () => f.B.drawWordmark(ctx, { x: 4, y: 5, width: 200 }),
    () => f.B.drawFooter(ctx, "moving_average", { width: 1920, height: 1080, footerHeight: 100 }),
  ];
  draws().forEach((draw) => assert.throws(draw));
  const pending = f.B.ready();
  assert.strictEqual(f.B.ready(), pending, "concurrent callers share the same preparation");
  await settle();
  assert.equal(f.faces.length, 3);
  assert.equal(f.images.length, 1);
  f.faces.forEach((face) => face.pending.resolve());
  await settle();
  assert.equal(f.registered.length, 0, "do not install a partial presentation before the image decodes");
  draws().forEach((draw) => assert.throws(draw));
  f.images[0].pending.resolve();
  await pending;
  assert.equal(f.registered.length, 3);
  assert.equal(new Set(f.registered).size, 3);
  assert.strictEqual(f.B.ready(), pending, "successful preparation stays cached");
  draws().forEach((draw) => assert.doesNotThrow(draw));
});

test("the shared script resolves local font and logo URLs with explicit required weights", async () => {
  const f = fixture();
  await prepare(f);
  assert.deepEqual(f.faces.map((face) => [face.family, String(face.descriptors.weight || "400")]), [
    ["WSB Export DejaVu", "400"], ["WSB Export DejaVu", "700"], ["WSB Export IBM Plex Mono", "500"],
  ]);
  for (const [index, filename] of ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "IBMPlexMono-Medium.ttf"].entries()) {
    assert.ok(f.faces[index].source.includes(`https://example.test/project/webapps/shared/export_assets/${filename}`), f.faces[index].source);
    assert.ok(!f.faces[index].source.includes("local("), "export faces must not vary with installed fonts");
  }
  assert.equal(f.images[0].src, "https://example.test/project/webapps/shared/export_assets/bitcoin-wordmark.jpg");
});

for (const failedAsset of ["font", "image"]) {
  test(`a failed ${failedAsset} installs nothing and a new preparation can recover`, async () => {
    const f = fixture(), pending = f.B.ready();
    await settle();
    const rejection = assert.rejects(pending);
    if (failedAsset === "font") f.faces[1].pending.reject(new Error("fixture font failure"));
    else f.images[0].pending.reject(new Error("fixture image failure"));
    await rejection;
    resolveAll(f);
    await settle();
    assert.equal(f.registered.length, 0, "late successful loads from a failed preparation must not register");
    assert.throws(() => f.B.setFont(context(), 20));
    const retry = f.B.ready();
    assert.notStrictEqual(retry, pending);
    await settle();
    assert.equal(f.faces.length, 6);
    assert.equal(f.images.length, 2);
    resolveAll(f, 3, 1);
    await retry;
    assert.deepEqual(f.registered, f.faces.slice(3));
    assert.doesNotThrow(() => f.B.setFont(context(), 20));
  });
}

test("body and heading typography use the prepared regular and bold faces", async () => {
  const f = fixture(), ctx = context();
  await prepare(f);
  f.B.setFont(ctx, 21.5);
  assert.match(ctx.font, /^400 21\.5px "WSB Export DejaVu"/);
  f.B.setFont(ctx, 42, "heading");
  assert.match(ctx.font, /^700 42px "WSB Export DejaVu"/);
  assert.equal(ctx.filter, "initial filter");
});

test("wordmark drawing preserves aspect, caller coordinates, and canvas state in both themes", async () => {
  const f = fixture();
  await prepare(f);
  for (const theme of ["dark", "light"]) {
    const ctx = context();
    f.B.drawWordmark(ctx, { x: 832, y: 109, width: 200 }, { theme });
    assert.deepEqual(ctx.calls.map((call) => call[0]), ["save", "drawImage", "restore"]);
    const [, image, x, y, width, height, filter] = ctx.calls[1];
    assert.strictEqual(image, f.images[0]);
    assert.deepEqual([x, y, width], [832, 109, 200]);
    assert.equal(height, 200 * 394 / 1873);
    if (theme === "light") assert.equal(filter, "invert(1) hue-rotate(180deg)");
    else assert.ok(!filter.includes("invert("));
    assert.equal(ctx.filter, "initial filter");
    assert.equal(ctx.font, "initial font");
  }
});

test("footer drawing shares canonical dashboard branding without taking over layout", async () => {
  const f = fixture(), ctx = context();
  await prepare(f);
  const metrics = { width: 1080, height: 1920, footerHeight: 70 };
  const settings = { theme: "light", orientation: "portrait", referenceQuality: 1080 };
  for (const slug of ["moving_average", "days_since_ath"]) {
    f.B.drawFooter(ctx, slug, metrics, settings);
    const [actualCtx, url, actualMetrics, actualSettings] = f.footers.at(-1);
    assert.strictEqual(actualCtx, ctx);
    assert.equal(url, `https://wickedsmartbitcoin.com/${slug}`);
    assert.strictEqual(actualMetrics, metrics);
    assert.equal(actualSettings.theme, settings.theme);
    assert.equal(actualSettings.orientation, settings.orientation);
    assert.equal(actualSettings.referenceQuality, settings.referenceQuality);
    assert.equal(actualSettings.fontFamily, '"WSB Export IBM Plex Mono", monospace');
  }
  assert.deepEqual(settings, { theme: "light", orientation: "portrait", referenceQuality: 1080 });
});

test("footer requires a dashboard slug rather than a missing value or arbitrary URL", async () => {
  const f = fixture(), ctx = context();
  await prepare(f);
  for (const slug of [undefined, null, 123, "", "/moving_average", "moving_average?view=all", "https://example.test"]) {
    assert.throws(() => f.B.drawFooter(ctx, slug, { width: 1920, height: 1080, footerHeight: 100 }));
  }
  assert.equal(f.footers.length, 0);
});
