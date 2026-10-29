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
  const faces = [], images = [], registered = [], footers = [], canvases = [];
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
    set src(value) {
      this.url = value;
      if (value.endsWith("wicked-apple.png")) Object.assign(this, { width: 100, height: 100, naturalWidth: 100, naturalHeight: 100 });
    }
    get src() { return this.url; }
    decode() { return this.pending.promise; }
  }
  const document = {
    currentScript: { src: "https://example.test/project/webapps/shared/dashboard_export_branding.js?v=3" },
    fonts: { add(face) { registered.push(face); } },
    createElement(tag) {
      assert.equal(tag, "canvas");
      const canvas = { width: 0, height: 0, pixels: null, getContext() {
        const ctx = {
          ...context(),
          getImageData: () => {
            const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
            for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
              const offset = (y * canvas.width + x) * 4;
              // Enclosed facial detail stays dark, while the two known gaps
              // between the mascot's limbs are part of its background.
              const inside = x > 0 && x < canvas.width - 1 && y > 0 && y < canvas.height - 1;
              const face = x === 50 && y === 40;
              const legGap = x >= 47 && x <= 54 && y >= 74 && y <= 84;
              const armGap = x >= 60 && x <= 78 && y >= 61 && y <= 82;
              data.set(inside && !face && !legGap && !armGap ? [190, 40, 25, 255] : [0, 0, 0, 255], offset);
            }
            return { data, width: canvas.width, height: canvas.height };
          },
          putImageData: pixels => { canvas.pixels = pixels; },
        };
        canvas.context = ctx;
        return ctx;
      } };
      canvases.push(canvas);
      return canvas;
    },
  };
  const window = { WSBDashboardExport: { drawFooterUrl(...args) { footers.push(args); } } };
  runInNewContext(readFileSync(new URL("../webapps/shared/dashboard_export_branding.js", import.meta.url), "utf8"),
    { window, document, FontFace, Image, URL });
  // Asset resolution must not depend on the calling page or a later script.
  document.currentScript = null;
  return { B: window.WSBDashboardExportBranding, faces, images, registered, footers, canvases };
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
    font: "initial font", filter: "initial filter", imageSmoothingEnabled: false, calls: [],
    save() { stack.push({ font: this.font, filter: this.filter, imageSmoothingEnabled: this.imageSmoothingEnabled }); this.calls.push(["save"]); },
    restore() { Object.assign(this, stack.pop()); this.calls.push(["restore"]); },
    drawImage(...args) { this.calls.push(["drawImage", ...args, this.filter]); },
    fillRect(...args) { this.calls.push(["fillRect", ...args]); },
    fillText(...args) { this.calls.push(["fillText", ...args, this.font, this.textAlign]); },
    measureText(value) {
      const size = Number(this.font.match(/([\d.]+)px/)?.[1] || 12);
      return { width: value.length * size * 0.61, actualBoundingBoxRight: value.length * size * 0.61, actualBoundingBoxAscent: size * 0.4 };
    },
    translate() {}, rotate() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    rect(...args) { this.calls.push(["rect", ...args]); },
    arc(...args) { this.calls.push(["arc", ...args]); },
    clip() { this.calls.push(["clip"]); },
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
  assert.equal(f.faces.length, 4);
  assert.equal(f.images.length, 3);
  f.faces.forEach((face) => face.pending.resolve());
  await settle();
  assert.equal(f.registered.length, 0, "do not install a partial presentation before the image decodes");
  draws().forEach((draw) => assert.throws(draw));
  f.images[0].pending.resolve();
  await settle();
  assert.equal(f.registered.length, 0, "the creator icon and Lightning QR are required too");
  f.images.slice(1).forEach((image) => image.pending.resolve());
  await pending;
  assert.equal(f.registered.length, 4);
  assert.equal(new Set(f.registered).size, 4);
  assert.strictEqual(f.B.ready(), pending, "successful preparation stays cached");
  draws().forEach((draw) => assert.doesNotThrow(draw));
});

test("date text uses prepared monospace cells without changing the caller's font or anchor", async () => {
  const f = fixture(), ctx = context();
  await prepare(f);
  ctx.textAlign = 'right';
  for (const date of ['Dec 31, 2025', 'Jan 01, 2026', 'Jan 09, 2026', 'Jan 10, 2026', 'Sep 09, 2026']) {
    f.B.drawDateText(ctx, date, 400, 50, 24);
    const call = ctx.calls.at(-2);
    assert.deepEqual(call.slice(0, 4), ['fillText', date, 400, 50]);
    assert.match(call[4], /24px "WSB Export DejaVu Mono"/);
    assert.equal(call[5], 'right');
    assert.equal(ctx.font, 'initial font');
  }
});

test("the shared script resolves local font and logo URLs with explicit required weights", async () => {
  const f = fixture();
  await prepare(f);
  assert.deepEqual(f.faces.map((face) => [face.family, String(face.descriptors.weight || "400")]), [
    ["WSB Export DejaVu", "400"], ["WSB Export DejaVu", "700"], ["WSB Export DejaVu Mono", "400"], ["WSB Export IBM Plex Mono", "500"],
  ]);
  for (const [index, filename] of ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSansMono.ttf", "IBMPlexMono-Medium.ttf"].entries()) {
    assert.ok(f.faces[index].source.includes(`https://example.test/project/webapps/shared/export_assets/${filename}`), f.faces[index].source);
    assert.ok(!f.faces[index].source.includes("local("), "export faces must not vary with installed fonts");
  }
  assert.equal(f.images[0].src, "https://example.test/project/webapps/shared/export_assets/bitcoin-wordmark.jpg");
  assert.equal(f.images[1].src, "https://example.test/project/webapps/shared/export_assets/wicked-apple.png");
  assert.equal(f.images[2].src, "https://example.test/project/assets/qr_lightning.png");
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
    assert.equal(f.faces.length, 8);
    assert.equal(f.images.length, 6);
    resolveAll(f, 4, 3);
    await retry;
    assert.deepEqual(f.registered, f.faces.slice(4));
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
    const draws = ctx.calls.filter(call => call[0] === "drawImage");
    assert.equal(draws.length, 1);
    for (const [, image, x, y, width, height] of draws) {
      assert.strictEqual(image, theme === "light" ? f.canvases[0] : f.images[0]);
      assert.deepEqual([x, y, width], [832, 109, 200]);
      assert.equal(height, 200 * 394 / 1873);
    }
    if (theme === "light") {
      const prepared = f.canvases[0].context.calls;
      const images = prepared.filter(call => call[0] === "drawImage");
      assert.equal(images[0].at(-1), "invert(1)", "only the monochrome backdrop and lettering are inverted");
      assert.equal(images[1].at(-1), "none", "the coin retains the source orange and white Bitcoin symbol");
      assert.ok(prepared.some(call => call[0] === "arc"));
      assert.ok(prepared.some(call => call[0] === "clip"));
    }
    assert.equal(draws[0].at(-1), "none", "prepared artwork needs no per-frame color filter");
    assert.equal(ctx.filter, "initial filter");
    assert.equal(ctx.font, "initial font");
  }
});

test("creator and current Lightning QR fill the reserved strip with a landscape-only canonical URL", async () => {
  const f = fixture();
  await prepare(f);
  for (const [width, height, footerHeight] of [[1920, 1080, 122], [1080, 1920, 117], [1080, 1080, 117], [720, 1280, 78], [720, 720, 78], [3840, 2160, 244]]) {
    for (const theme of ["dark", "light"]) {
      const ctx = context(), metrics = { width, height, footerHeight }, settings = { theme };
      const slug = "a_very_long_dashboard_route_for_testing_measured_footer_fit";
      const result = f.B.drawFooter(ctx, slug, metrics, settings);
      const images = ctx.calls.filter((call) => call[0] === "drawImage");
      assert.equal(images.length, 2);
      assert.strictEqual(images[0][1], theme === "light" ? f.canvases[1] : f.images[1]);
      assert.strictEqual(images[1][1], f.images[2]);
      const margin = width / height < 1.35 ? 24 * width / 1080 : 32 * Math.min(width / 1920, footerHeight / 122);
      if (width === 720) assert.ok(result.lightning.size >= 70, "720-quality stacked exports keep a readable QR footprint");
      for (const [, , x, y, imageWidth, imageHeight] of images) {
        assert.ok(x >= 0 && x + imageWidth <= width);
        assert.ok(y >= height - footerHeight && y + imageHeight <= height);
      }
      const text = ctx.calls.filter((call) => call[0] === "fillText");
      assert.ok(text.some((call) => call[1] === "@w_s_bitcoin"));
      assert.ok(text.some((call) => call[1] === "@primal.net"));
      const address = text.find(call => call[1] === "@primal.net");
      assert.equal(address.at(-1), "left");
      assert.ok(address[2] > result.lightning.x + result.lightning.size, "address stays to the right of the QR");
      const addressWidth = address[1].length * Number(address[4].match(/([\d.]+)px/)[1]) * .61;
      assert.ok(Math.abs(width - address[2] - addressWidth - margin) < 1e-7, "address sits at the outer right margin");
      const urls = text.filter(call => String(call[1]).startsWith("https://wickedsmartbitcoin.com/"));
      const strip = ctx.calls.find(call => call[0] === "fillRect");
      assert.deepEqual(strip.slice(1), [0, height - footerHeight, width, footerHeight], "footer uses the complete compact reservation without shrinking it again");
      if (width <= height) {
        assert.deepEqual(urls, [], "portrait and square exports omit the website URL");
        assert.equal(result.url, null);
      } else {
        assert.equal(urls.length, 1);
        const url = urls[0];
        assert.equal(url[1], `https://wickedsmartbitcoin.com/${slug}`);
        assert.match(url[4], /"WSB Export IBM Plex Mono"/);
        const measured = url[1].length * result.url.fontSize * 0.61;
        assert.ok(url[2] - measured / 2 >= result.url.left - 1e-7);
        assert.ok(url[2] + measured / 2 <= result.url.right + 1e-7);
      }
      assert.deepEqual(settings, { theme });
      assert.equal(ctx.font, "initial font"); assert.equal(ctx.filter, "initial filter");
      assert.equal(ctx.imageSmoothingEnabled, false);
    }
  }
  assert.equal(f.footers.length, 0, "the shared strip must not recurse through the generic footer hook");
});

test("light creator removes outer and enclosed limb backgrounds while preserving dark facial detail", async () => {
  const f = fixture();
  await prepare(f);
  const canvas = f.canvases[1];
  assert.ok(canvas?.pixels, "light-mode creator must be prepared once with the other branding assets");
  const pixel = (x, y) => Array.from(canvas.pixels.data.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4));
  const corner = pixel(0, 0);
  assert.ok(corner[3] === 0 || corner.slice(0, 3).every(channel => channel === 255), "backdrop composites to white");
  assert.deepEqual(pixel(50, 40), [0, 0, 0, 255], "enclosed black facial detail remains opaque black");
  assert.deepEqual(pixel(50, 80), [255, 255, 255, 255], "the enclosed gap between the legs is white");
  assert.deepEqual(pixel(65, 73), [255, 255, 255, 255], "the enclosed gap between the right arm and leg is white");
  assert.deepEqual(pixel(2, 2), [190, 40, 25, 255], "the original apple color is unchanged");
  await f.B.ready();
  assert.equal(f.canvases.length, 2, "the processed wordmark and creator are reused by every frame");
});

test("footer requires a dashboard slug rather than a missing value or arbitrary URL", async () => {
  const f = fixture(), ctx = context();
  await prepare(f);
  for (const slug of [undefined, null, 123, "", "/moving_average", "moving_average?view=all", "https://example.test"]) {
    assert.throws(() => f.B.drawFooter(ctx, slug, { width: 1920, height: 1080, footerHeight: 100 }));
  }
  assert.equal(f.footers.length, 0);
});
