#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../webapps/shared/bitcoin_chain_tip.js', import.meta.url), 'utf8');
const initialNow = Date.UTC(2026, 9, 24, 12);
const block = (height, id = height.toString(16), timestamp = initialNow / 1000 - 600) => ({
  height, id: id.padStart(64, '0'), timestamp,
});

function events() {
  const listeners = new Map();
  return {
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    dispatch(name) { for (const listener of listeners.get(name) || []) listener({ type: name }); },
    count() { return [...listeners.values()].reduce((n, entries) => n + entries.size, 0); },
  };
}

function harness({ hidden = false, offline = false, socketAvailable = true } = {}) {
  let now = initialNow;
  let timerId = 0;
  const timers = new Map();
  const sockets = [];
  const requests = [];
  const tips = [];
  const statuses = [];
  const window = events();
  const document = { ...events(), visibilityState: hidden ? 'hidden' : 'visible' };
  const navigator = { onLine: !offline };
  const setTimeout = (fn, delay) => {
    const id = ++timerId;
    timers.set(id, { fn, at: now + delay });
    return id;
  };
  const clearTimeout = (id) => timers.delete(id);
  Object.assign(window, { setTimeout, clearTimeout });
  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(payload) {
      if (this.failSend) throw new Error('send failed');
      this.sent.push(JSON.parse(payload));
    }
    close() { this.readyState = 3; this.closed = true; }
    open() { this.readyState = 1; this.onopen?.({}); }
    message(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
    disconnect() { this.readyState = 3; this.onclose?.({}); }
  }
  const sandbox = {
    window, document, navigator, AbortController, clearTimeout,
    Date: class extends Date { static now() { return now; } },
    fetch: (url, options) => new Promise((resolve, reject) => {
      // Deliberately ignore abort here: late server responses must be guarded
      // even when cancellation and an already queued response cross.
      requests.push({ url, ...options, resolve, reject });
    }),
  };
  if (socketAvailable) sandbox.WebSocket = FakeSocket;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const feed = window.WSBBitcoinChainTip.create({ onTip: (tip) => tips.push(tip), onStatus: (s) => statuses.push(s) });
  const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
  async function tick(duration) {
    const until = now + duration;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
      await flush();
    }
    now = until;
    await flush();
  }
  async function resolve(index, data, ok = true) {
    requests[index].resolve({ ok, json: async () => data });
    await flush();
  }
  return { feed, window, document, navigator, timers, sockets, requests, tips, statuses, tick, resolve, flush };
}

test('subscribes once, confirms transport, and selects the highest block in either array order', async () => {
  const h = harness();
  h.feed.start();
  h.feed.start();
  assert.equal(h.sockets.length, 1);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, 'https://mempool.space/api/blocks');
  assert.equal(h.requests[0].cache, 'no-store');
  const socket = h.sockets[0];
  assert.equal(socket.url, 'wss://mempool.space/api/v1/ws');
  socket.open();
  assert.deepEqual(socket.sent, [{ action: 'want', data: ['blocks'] }, { action: 'ping' }]);
  assert.equal(h.feed.isLive(), false, 'an open connection is not a confirmed feed');
  socket.message({ blocks: [block(100), block(101), block(102)] });
  assert.equal(h.feed.last().height, 102);
  assert.equal(h.feed.last().minedAt, block(102).timestamp * 1000);
  assert.equal(h.feed.isLive(), true);
  assert.equal(h.statuses.at(-1), 'live');
  assert.equal(h.requests[0].signal.aborted, true);
  socket.message({ blocks: [block(104), block(103), block(102)] });
  assert.equal(h.feed.last().height, 104);
  socket.message({ block: block(105) });
  assert.equal(h.feed.last().height, 105);
  assert.equal(h.feed.last().reorg, false);
  h.feed.stop();
});

test('rejects malformed fields and partial block lists without changing the complete tip', () => {
  const h = harness();
  h.feed.start();
  const socket = h.sockets[0];
  socket.open();
  socket.message({ blocks: [block(100)] });
  const retained = h.feed.last();
  const bad = [
    { ...block(101), height: '101' }, { ...block(101), height: -1 },
    { ...block(101), height: 101.5 }, { ...block(101), timestamp: null },
    { ...block(101), timestamp: '1792842600' }, { ...block(101), timestamp: 0 },
    { ...block(101), timestamp: 0x100000000 }, { ...block(101), id: 'bad' },
  ];
  for (const invalid of bad) {
    socket.message({ block: invalid });
    socket.message({ blocks: [block(102), invalid] });
    socket.message({ blocks: [block(102)], block: invalid, pong: true });
    assert.equal(h.feed.last(), retained);
  }
  socket.message({ blocks: [] });
  socket.message({ blocks: [block(101), block(101, 'ff')] });
  socket.onmessage({ data: 'broken JSON' });
  assert.equal(h.feed.last(), retained);
  assert.equal(h.tips.length, 1);
  h.feed.stop();
});

test('permits same-height replacements and authoritative rollback, but ignores stray older block events', () => {
  const h = harness();
  h.feed.start();
  const socket = h.sockets[0];
  socket.open();
  socket.message({ blocks: [block(105)] });
  socket.message({ block: block(105, 'ab') });
  assert.equal(h.feed.last().id, block(105, 'ab').id);
  socket.message({ block: block(103) });
  assert.equal(h.feed.last().height, 105);
  socket.message({ blocks: [block(102), block(103, 'cd')] });
  assert.equal(h.feed.last().height, 103);
  assert.equal(h.feed.last().reorg, true);
  socket.message({ block: block(104, 'ef') });
  assert.equal(h.feed.last().height, 104);
  assert.equal(h.feed.last().reorg, false);
  socket.message({ block: block(104, 'ef') });
  assert.equal(h.tips.length, 4, 'duplicate tip does not republish');
  h.feed.stop();
});

test('a late REST response cannot undo a newer socket event, including after socket loss', async () => {
  const h = harness();
  h.feed.start();
  const socket = h.sockets[0];
  socket.open();
  socket.message({ blocks: [block(105)] });
  socket.disconnect();
  await h.resolve(0, [block(102)]);
  assert.equal(h.feed.last().height, 105);
  assert.equal(h.feed.isLive(), false);
  const refresh = h.feed.refresh();
  await h.resolve(1, [block(104), block(103)]);
  await refresh;
  assert.equal(h.feed.last().height, 104, 'a fresh authoritative REST response can report a reorg');
  assert.equal(h.feed.last().reorg, true);
  h.feed.stop();
});

test('heartbeat keeps the feed live without new blocks and refresh uses the socket', async () => {
  const h = harness();
  h.feed.start();
  const socket = h.sockets[0];
  socket.open();
  socket.message({ blocks: [block(100)] });
  for (let i = 0; i < 30; i += 1) {
    await h.tick(25000);
    assert.deepEqual(socket.sent.at(-1), { action: 'ping' });
    socket.message({ pong: true });
    assert.equal(h.feed.isLive(), true);
  }
  assert.equal(h.feed.last().height, 100, 'more than ten minutes without a block is normal');
  assert.equal(h.requests.length, 1, 'healthy sockets suppress REST polling');
  await h.feed.refresh();
  assert.deepEqual(socket.sent.slice(-2), [{ 'refresh-blocks': true }, { action: 'ping' }]);
  assert.equal(h.requests.length, 1);
  h.feed.stop();
});

test('silent sockets close and recover while the last valid tip stays visible', async () => {
  const h = harness();
  h.feed.start();
  const socket = h.sockets[0];
  socket.open();
  socket.message({ block: block(100) });
  await h.tick(45000);
  assert.equal(socket.closed, true);
  assert.equal(h.feed.isLive(), false);
  assert.equal(h.statuses.at(-1), 'offline');
  assert.equal(h.feed.last().height, 100);
  await h.tick(2000);
  assert.equal(h.sockets.length, 2);
  h.sockets[1].open();
  h.sockets[1].message({ pong: true });
  assert.equal(h.feed.isLive(), true);
  assert.equal(h.feed.last().height, 100);
  h.feed.stop();
});

test('connection timeout and repeated disconnects back off to one minute, then reset on confirmation', async () => {
  const h = harness();
  h.feed.start();
  await h.tick(12000);
  assert.equal(h.sockets[0].closed, true);
  for (const delay of [2000, 4000, 8000, 16000, 32000, 60000, 60000]) {
    const count = h.sockets.length;
    await h.tick(delay - 1);
    assert.equal(h.sockets.length, count);
    await h.tick(1);
    assert.equal(h.sockets.length, count + 1);
    h.sockets.at(-1).disconnect();
  }
  await h.tick(60000);
  h.sockets.at(-1).open();
  h.sockets.at(-1).message({ pong: true });
  h.sockets.at(-1).disconnect();
  const count = h.sockets.length;
  await h.tick(2000);
  assert.equal(h.sockets.length, count + 1, 'a confirmed connection resets reconnect delay');
  h.feed.stop();
});

test('REST works without WebSocket, validates atomically, and repeats only each minute', async () => {
  const h = harness({ socketAvailable: false });
  h.feed.start();
  await h.resolve(0, [block(100), block(99)]);
  assert.equal(h.feed.last().height, 100);
  assert.equal(h.statuses.at(-1), 'offline');
  await h.tick(59999);
  assert.equal(h.requests.length, 1);
  await h.tick(1);
  assert.equal(h.requests.length, 2);
  await h.resolve(1, [block(101), { ...block(100), timestamp: null }]);
  assert.equal(h.feed.last().height, 100);
  await h.tick(60000);
  await h.resolve(2, [block(102), block(101)]);
  assert.equal(h.feed.last().height, 102);
  assert.equal(h.feed.isLive(), false);
  h.feed.stop();
});

test('timed-out REST cannot block a new request or install a late response', async () => {
  const h = harness({ socketAvailable: false });
  h.feed.start();
  await h.tick(12000);
  assert.equal(h.requests[0].signal.aborted, true);
  await h.tick(48000);
  assert.equal(h.requests.length, 2);
  await h.resolve(1, [block(102)]);
  await h.resolve(0, [block(100)]);
  assert.equal(h.feed.last().height, 102);
  h.feed.stop();
});

test('failed sends and delayed events from a closing socket cannot claim live status', async () => {
  const h = harness();
  h.feed.start();
  const socket = h.sockets[0];
  socket.failSend = true;
  const lateMessage = socket.onmessage;
  socket.open();
  assert.equal(socket.closed, true);
  assert.equal(h.statuses.at(-1), 'offline');
  lateMessage({ data: JSON.stringify({ blocks: [block(105)] }) });
  assert.equal(h.feed.last(), null);
  await h.tick(2000);
  const next = h.sockets[1];
  next.open();
  next.readyState = 2;
  next.message({ pong: true });
  assert.equal(h.feed.isLive(), false);
  assert.equal(h.statuses.at(-1), 'connecting');
  h.feed.stop();
});

test('hidden, offline and pagehide suspend all work; wake and stop preserve lifecycle isolation', async () => {
  const h = harness({ hidden: true });
  h.feed.start();
  assert.equal(h.sockets.length, 0);
  assert.equal(h.requests.length, 0);
  assert.equal(h.statuses.at(-1), 'paused');
  h.document.visibilityState = 'visible';
  h.document.dispatch('visibilitychange');
  h.sockets[0].open();
  h.sockets[0].message({ blocks: [block(100)] });
  h.document.visibilityState = 'hidden';
  h.document.dispatch('visibilitychange');
  assert.equal(h.timers.size, 0);
  assert.equal(h.sockets[0].closed, true);
  assert.equal(h.feed.last().height, 100);
  h.document.visibilityState = 'visible';
  h.document.dispatch('visibilitychange');
  assert.equal(h.sockets.length, 2);
  h.navigator.onLine = false;
  h.window.dispatch('offline');
  assert.equal(h.requests[1].signal.aborted, true);
  await h.resolve(1, [block(99)]);
  assert.equal(h.feed.last().height, 100);
  assert.equal(h.timers.size, 0);
  h.navigator.onLine = true;
  h.window.dispatch('online');
  assert.equal(h.sockets.length, 3);
  h.window.dispatch('pagehide');
  assert.equal(h.sockets[2].closed, true);
  assert.equal(h.timers.size, 0);
  h.window.dispatch('focus');
  assert.equal(h.sockets.length, 3, 'focus alone does not undo pagehide');
  h.window.dispatch('pageshow');
  assert.equal(h.sockets.length, 4);
  h.feed.stop();
  assert.equal(h.timers.size, 0);
  assert.equal(h.window.count() + h.document.count(), 0);
  assert.equal(h.requests[3].signal.aborted, true);
  await h.resolve(3, [block(103)]);
  assert.equal(h.feed.last().height, 100);
  h.window.dispatch('pageshow');
  assert.equal(h.sockets.length, 4);
  h.feed.start();
  assert.equal(h.sockets.length, 5);
  assert.equal(h.feed.last().height, 100);
  h.feed.stop();
});
