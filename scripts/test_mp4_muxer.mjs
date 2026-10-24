import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../webapps/shared/dashboard_mp4.js", import.meta.url), "utf8");
function load(BlobClass = Blob) {
  const window = {};
  runInNewContext(source, { window, Blob: BlobClass, TextEncoder, Uint8Array, ArrayBuffer, DataView });
  return window.WSBDashboardMP4;
}
const MP4 = load();
const description = Uint8Array.of(1, 66, 224, 31, 255, 225, 0, 4, 103, 66, 224, 31, 1, 0, 2, 104, 206);
const config = () => ({ codec: "avc1.42e01f", description: description.slice() });
function sample(key = false, value = 0) { return Uint8Array.of(0, 0, 0, 3, key ? 0x65 : 0x41, 0x88, value); }
function frames(count = 3, fps = 30) {
  return Array.from({ length: count }, (_, index) => ({ timestamp: Math.round(index * 1e6 / fps),
    duration: Math.round((index + 1) * 1e6 / fps) - Math.round(index * 1e6 / fps),
    type: index % fps === 0 ? "key" : "delta", data: sample(index % fps === 0, index % 256) }));
}
function input(overrides = {}) { return { frames: frames(), width: 1280, height: 720, fps: 30, decoderConfig: config(), title: "Patoshi Pattern", ...overrides }; }
function boxes(bytes, start = 0, end = bytes.length) {
  const result = [];
  for (let at = start; at < end;) {
    assert.ok(at + 8 <= end, "complete box header");
    const size32 = bytes.readUInt32BE(at), header = size32 === 1 ? 16 : 8;
    const size = size32 === 1 ? Number(bytes.readBigUInt64BE(at + 8)) : size32;
    assert.ok(size >= header && at + size <= end, "box stays within parent");
    result.push({ type: bytes.toString("ascii", at + 4, at + 8), start: at, data: at + header, end: at + size, size, header });
    at += size;
  }
  return result;
}
function find(bytes, path) {
  let start = 0, end = bytes.length, box;
  for (const type of path.split("/")) {
    box = boxes(bytes, start, end).find((entry) => entry.type === type);
    assert.ok(box, `missing ${path}`); start = box.data; end = box.end;
  }
  return box;
}
const STBL = "moov/trak/mdia/minf/stbl/";
async function encoded(options = {}) { return Buffer.from(await MP4.buildBlob(input(options)).arrayBuffer()); }

test("faststart AVC MP4 preserves every sample byte, size, offset and sync frame", async () => {
  const planned = frames(65), blob = MP4.buildBlob(input({ frames: planned }));
  assert.equal(blob.type, "video/mp4");
  const bytes = Buffer.from(await blob.arrayBuffer()), top = boxes(bytes);
  assert.deepEqual(top.map((box) => box.type), ["ftyp", "moov", "mdat"]);
  assert.equal(top[2].header, 16, "mdat always supports a 64-bit size");
  const co64 = find(bytes, STBL + "co64");
  assert.equal(bytes.readUInt32BE(co64.data + 4), 1);
  assert.equal(bytes.readBigUInt64BE(co64.data + 8), BigInt(top[2].data));
  assert.deepEqual(bytes.subarray(top[2].data), Buffer.concat(planned.map((frame) => frame.data)));
  const stsz = find(bytes, STBL + "stsz");
  assert.equal(bytes.readUInt32BE(stsz.data + 4), 0);
  assert.equal(bytes.readUInt32BE(stsz.data + 8), planned.length);
  assert.deepEqual(Array.from({ length: planned.length }, (_, i) => bytes.readUInt32BE(stsz.data + 12 + i * 4)), planned.map((frame) => frame.data.byteLength));
  const stsc = find(bytes, STBL + "stsc");
  assert.deepEqual(Array.from({ length: 4 }, (_, i) => bytes.readUInt32BE(stsc.data + 4 + i * 4)), [1, 1, 65, 1]);
  const stss = find(bytes, STBL + "stss");
  assert.equal(bytes.readUInt32BE(stss.data + 4), 3);
  assert.deepEqual([0, 1, 2].map((i) => bytes.readUInt32BE(stss.data + 8 + i * 4)), [1, 31, 61]);
});

test("sample timing retains every rational frame boundary through a 10-minute export", async () => {
  for (const [count, fps] of [[1, 30], [3, 30], [18_001, 30], [61, 60], [24, 24], [300, 29.97]]) {
    const planned = frames(count, fps); planned[0].type = "key"; planned[0].data = sample(true);
    const bytes = await encoded({ frames: planned, fps });
    const stts = find(bytes, STBL + "stts"), countRuns = bytes.readUInt32BE(stts.data + 4);
    const decoded = [];
    for (let index = 0; index < countRuns; index++) {
      const at = stts.data + 8 + index * 8, runCount = bytes.readUInt32BE(at), delta = bytes.readUInt32BE(at + 4);
      for (let n = 0; n < runCount; n++) decoded.push(delta);
    }
    assert.deepEqual(decoded, planned.map((frame) => frame.duration));
    let at = 0;
    planned.forEach((frame, index) => { assert.equal(at, frame.timestamp); at += decoded[index]; });
    assert.equal(at, Math.round(count * 1e6 / fps));
    for (const path of ["moov/mvhd", "moov/trak/mdia/mdhd"]) {
      const header = find(bytes, path);
      assert.equal(bytes[header.data], 1);
      assert.equal(bytes.readUInt32BE(header.data + 20), 1e6);
      assert.equal(bytes.readBigUInt64BE(header.data + 24), BigInt(at));
    }
    const tkhd = find(bytes, "moov/trak/tkhd");
    assert.equal(bytes[tkhd.data], 1);
    assert.equal(bytes.readBigUInt64BE(tkhd.data + 28), BigInt(at));
  }
});

test("sample dimensions, decoder description, and color metadata remain exact in each orientation", async () => {
  for (const [width, height] of [[1280, 720], [3840, 2160], [2160, 3840], [2160, 2160]]) {
    const decoderConfig = { ...config(), colorSpace: { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false } };
    const bytes = await encoded({ width, height, decoderConfig });
    const stsd = find(bytes, STBL + "stsd"), entry = boxes(bytes, stsd.data + 8, stsd.end)[0];
    assert.equal(entry.type, "avc1");
    assert.equal(bytes.readUInt16BE(entry.data + 24), width);
    assert.equal(bytes.readUInt16BE(entry.data + 26), height);
    const children = boxes(bytes, entry.data + 78, entry.end);
    const avcC = children.find((box) => box.type === "avcC");
    assert.deepEqual(bytes.subarray(avcC.data, avcC.end), Buffer.from(description));
    const color = children.find((box) => box.type === "colr");
    assert.equal(bytes.toString("ascii", color.data, color.data + 4), "nclx");
    assert.deepEqual([4, 6, 8].map((offset) => bytes.readUInt16BE(color.data + offset)), [1, 1, 1]);
    assert.equal(bytes[color.data + 10], 0);
    const tkhd = find(bytes, "moov/trak/tkhd");
    assert.equal(bytes.readUInt32BE(tkhd.end - 8), width * 65536);
    assert.equal(bytes.readUInt32BE(tkhd.end - 4), height * 65536);
  }
});

test("64-bit media size and duration arithmetic works without allocating a multi-gigabyte file", () => {
  class PartsBlob { constructor(parts, options) { this.parts = parts; this.type = options.type; } }
  const mux = load(PartsBlob), data = new Uint8Array(8 * 1024 * 1024);
  new DataView(data.buffer).setUint32(0, data.length - 4); data[4] = 0x65;
  const planned = frames(600).map((frame) => ({ ...frame, type: "key", data }));
  const blob = mux.buildBlob(input({ frames: planned }));
  assert.equal(blob.parts.length, 603);
  assert.ok(blob.parts.slice(3).every((part) => part === data), "muxer does not concatenate/copy the sample payloads");
  const mdat = Buffer.from(blob.parts[2]);
  assert.equal(mdat.readUInt32BE(0), 1);
  assert.equal(mdat.readBigUInt64BE(8), 600n * BigInt(data.length) + 16n);
  assert.ok(mdat.readBigUInt64BE(8) > 0xffffffffn);
  const metadata = Buffer.concat(blob.parts.slice(0, 2));
  const co64 = find(metadata, STBL + "co64");
  assert.equal(metadata.readBigUInt64BE(co64.data + 8), BigInt(metadata.length + 16));
  const long = mux.buildBlob(input({ frames: [
    { timestamp: 0, duration: 4_000_000_000, type: "key", data: sample(true) },
    { timestamp: 4_000_000_000, duration: 4_000_000_000, type: "delta", data: sample() },
  ] }));
  const longMetadata = Buffer.concat(long.parts.slice(0, 2)), mvhd = find(longMetadata, "moov/mvhd");
  assert.equal(longMetadata.readBigUInt64BE(mvhd.data + 24), 8_000_000_000n);
});

test("input buffers and frame records are retained unchanged, including sliced decoder descriptions", async () => {
  const storage = new Uint8Array(description.length + 4); storage.set(description, 2);
  const decoderConfig = { ...config(), description: new DataView(storage.buffer, 2, description.length) };
  const planned = frames(), snapshot = planned.map((frame) => ({ ...frame, data: [...frame.data] }));
  await encoded({ frames: planned, decoderConfig });
  assert.deepEqual(planned.map((frame) => ({ ...frame, data: [...frame.data] })), snapshot);
  assert.deepEqual(storage.subarray(2, -2), description);
  assert.doesNotThrow(() => MP4.buildBlob(input({ decoderConfig: { ...config(), description: description.buffer } })));
  const withoutDurations = frames().map(({ duration, ...frame }) => frame);
  const bytes = await encoded({ frames: withoutDurations }), mvhd = find(bytes, "moov/mvhd");
  assert.equal(bytes.readBigUInt64BE(mvhd.data + 24), 100000n);
});

test("canonicalized encoder constraint flags and levels use the actual baseline avcC/SPS", async () => {
  // Captured Chrome output: requested codec is 42E01f; actual avcC/SPS is42C01f.
  const actual = Uint8Array.from([1,66,192,31,255,225,0,18,103,66,192,31,140,104,5,0,91,166,224,33,160,32,240,136,70,160,1,0,4,104,206,60,128]);
  for (const level of [31, 40]) {
    const bytes = actual.slice(); bytes[3] = level; bytes[11] = level;
    const output = await encoded({ decoderConfig: { codec: "avc1.42E01f", description: bytes } });
    const stsd = find(output, STBL + "stsd"), entry = boxes(output, stsd.data + 8, stsd.end)[0];
    const avcC = boxes(output, entry.data + 78, entry.end).find((box) => box.type === "avcC");
    assert.deepEqual(output.subarray(avcC.data, avcC.end), Buffer.from(bytes));
  }
  const unsupported = actual.slice(); unsupported[1] = unsupported[9] = 100;
  assert.throws(() => MP4.buildBlob(input({ decoderConfig: { ...config(), description: unsupported } })), /baseline/);
  const inconsistent = actual.slice(); inconsistent[10] = 224;
  assert.throws(() => MP4.buildBlob(input({ decoderConfig: { ...config(), description: inconsistent } })), /sequence parameters/);
});

test("invalid or reordered samples fail instead of producing a deceptively playable file", () => {
  const cases = [
    { frames: [] }, { width: 0 }, { height: 65536 }, { fps: 0 }, { fps: NaN },
    { decoderConfig: undefined }, { decoderConfig: { codec: "avc1.42e01f" } },
    { decoderConfig: { ...config(), codec: "avc3.42e01f" } },
    { decoderConfig: { ...config(), codec: "avc1.64001f" } },
    { decoderConfig: { ...config(), description: Uint8Array.of(1, 66) } },
    { decoderConfig: { ...config(), description: Uint8Array.of(1, 66, 224, 31, 255, 224, 0) } },
    { frames: [{ ...frames()[0], timestamp: 1 }] },
    { frames: [{ ...frames()[0], type: "delta", data: sample() }] },
    { frames: [{ ...frames()[0], duration: 0 }] },
    { frames: [{ ...frames()[0], data: Uint8Array.of(0, 0, 0, 1, 0x65) }, { ...frames()[1], timestamp: 0 }] },
    { frames: [frames()[0], { ...frames()[1], timestamp: -1 }] },
    { frames: [frames()[0], { ...frames()[1], timestamp: NaN }] },
    { frames: [frames()[0], frames()[2], frames()[1]] },
    { frames: [{ ...frames()[0], data: new Uint8Array() }] },
    { frames: [{ ...frames()[0], data: Uint8Array.of(0, 0, 0, 5, 0x65) }] },
    { frames: [{ ...frames()[0], data: sample(false) }] },
    { frames: [{ ...frames()[0], data: Uint8Array.of(0, 0, 0, 1, 0x67) }] },
    { frames: [{ ...frames()[0], data: Uint8Array.of(0, 0, 0, 0, 0x65) }] },
  ];
  for (const invalid of cases) assert.throws(() => MP4.buildBlob(input(invalid)), /MP4/);
});
