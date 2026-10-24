import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const window = {};
runInNewContext(readFileSync(new URL("../webapps/shared/dashboard_export.js", import.meta.url), "utf8"),
  { window, TextEncoder, Uint8Array, DataView, Blob });

function elements(bytes, start = 0, end = bytes.length) {
  const found = [];
  for (let at = start; at < end;) {
    const leadingLength = (byte) => {
      for (let length = 1; length <= 8; length++) if (byte & (1 << (8 - length))) return length;
      throw new Error("Invalid EBML variable integer");
    };
    const idLength = leadingLength(bytes[at]);
    const id = bytes.subarray(at, at + idLength).toString("hex"); at += idLength;
    const sizeLength = leadingLength(bytes[at]);
    let size = BigInt(bytes[at] & ((1 << (8 - sizeLength)) - 1));
    for (let n = 1; n < sizeLength; n++) size = size * 256n + BigInt(bytes[at + n]);
    at += sizeLength;
    const unknown = size === (1n << BigInt(7 * sizeLength)) - 1n;
    const next = unknown ? end : at + Number(size);
    assert.ok(next <= end, "EBML element exceeds its container");
    found.push({ id, start: at, end: next }); at = next;
  }
  return found;
}

test("WebM duration describes all frames in the advertised TimecodeScale units", async () => {
  for (const [count, fps] of [[1, 30], [3, 30], [30, 30], [30, 60]]) {
    const frames = Array.from({ length: count }, (_, index) => ({ timestamp: Math.round(index * 1e6 / fps), type: "key", data: Uint8Array.of(0) }));
    const blob = window.WSBDashboardExport.buildWebMBlob(frames, 1280, 720, fps, "V_VP9");
    const bytes = Buffer.from(await blob.arrayBuffer());
    const segment = elements(bytes).find((item) => item.id === "18538067");
    const info = elements(bytes, segment.start, segment.end).find((item) => item.id === "1549a966");
    const fields = elements(bytes, info.start, info.end);
    const scale = fields.find((item) => item.id === "2ad7b1");
    const duration = fields.find((item) => item.id === "4489");
    const nanosecondsPerTick = bytes.readUIntBE(scale.start, scale.end - scale.start);
    const ticks = bytes.readDoubleBE(duration.start);
    assert.equal(nanosecondsPerTick, 1000000);
    assert.ok(Math.abs(ticks * nanosecondsPerTick / 1e9 - count / fps) < 1e-10,
      `${count} frames at ${fps}fps must include the final frame's duration`);
    if (count === 3) assert.equal(ticks, 100, "three 30fps frames last 100ms");
  }
});
