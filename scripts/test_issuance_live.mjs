#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import L from '../webapps/issuance_rate/issuance_live.js';

const source = readFileSync(new URL('../webapps/issuance_rate/issuance_live.js', import.meta.url), 'utf8');
const NOW = Date.UTC(2026, 9, 24, 12), H = 1000;
const hash = (height, branch = 0) => (BigInt(branch) * 1000000000n + BigInt(height)).toString(16).padStart(64, '0');
function headers(tipHeight = H, interval = 600, length = 600) {
  return Array.from({length: Math.min(length, tipHeight + 1)}, (_, n) => ({
    height: tipHeight - n, id: hash(tipHeight - n), previousblockhash: tipHeight - n ? hash(tipHeight - n - 1) : null,
    timestamp: NOW / 1000 - n * interval,
  }));
}
const snapshot = (blocks = headers(), extra = {}) => ({...L.calculateWindow(blocks, blocks[0]), observedAt: NOW, reorg: false, ...extra});
const pub = (height = H - 1, rows) => ({generated_utc: new Date(NOW - 60000).toISOString(),
  source: {latest_block_height: height, latest_block_time_utc: new Date(NOW - 600000).toISOString()},
  rows: rows || [{date: '2026-10-23', height: height - 144, epoch: 1}, {date: '2026-10-24', height, epoch: 1}]});

test('scheduled supply includes genesis and handles halving boundaries', () => {
  assert.equal(L.supplyAtHeight(-1), 0);
  assert.equal(L.supplyAtHeight(0), 50);
  assert.equal(L.supplyAtHeight(209999), 10500000);
  assert.equal(L.supplyAtHeight(210000), 10500025);
  assert.throws(() => L.supplyAtHeight(1.5));
});
test('rolling window follows actual block count, not a fixed 144', () => {
  for (const interval of [300, 600, 900]) {
    const result = snapshot(headers(H, interval));
    assert.equal(result.row.timezone_blocks, Math.ceil(86400 / interval));
    assert.equal(result.row.daily_issuance, 50 * Math.ceil(86400 / interval));
    assert.equal(result.row.issuance_rate, result.row.daily_issuance * 365 / result.row.supply);
  }
});
test('nonmonotonic miner times choose highest canonical ancestor at or before cutoff', () => {
  const blocks = headers();
  blocks[10].timestamp = blocks[0].timestamp - 86400;
  const result = snapshot(blocks);
  assert.equal(result.boundary.height, H - 10);
  assert.equal(result.row.daily_issuance, 500);
});
test('mixed-subsidy issuance uses cumulative supply difference', () => {
  const result = snapshot(headers(210005));
  assert.equal(result.row.daily_issuance, 138 * 50 + 6 * 25);
  assert.equal(result.row.subsidy, 25);
});
test('gaps, mismatched tip metadata, malformed headers and height jumps cannot form a window', () => {
  const blocks = headers();
  assert.equal(L.calculateWindow(blocks.slice(0, 100), blocks[0]), null);
  assert.equal(L.calculateWindow(blocks.filter(x => x.height !== H - 50), blocks[0]), null);
  assert.equal(L.calculateWindow(blocks, {...blocks[0], timestamp: blocks[0].timestamp + 1}), null);
  assert.throws(() => L.calculateWindow([{...blocks[0], id:'bad'}], blocks[0]));
  const bad = structuredClone(blocks); bad[1].height--;
  assert.throws(() => L.calculateWindow(bad, bad[0]), /Noncontiguous/);
});
test('same-day projection is immutable; stale publication does not replace current block', () => {
  const publication = pub(), before = JSON.stringify(publication);
  const rows = L.projectRows(publication, snapshot(), NOW);
  assert.equal(rows.length, publication.rows.length);
  assert.equal(rows[0], publication.rows[0]);
  assert.equal(rows.at(-1).height, H);
  assert.equal(rows.at(-1).provisional, true);
  assert.equal(JSON.stringify(publication), before);
});
test('matching publication wins and initial stale lower feed cannot override publication', () => {
  const publication = pub(H);
  publication.source.latest_block_time_utc = new Date(NOW).toISOString();
  assert.equal(L.projectRows(publication, snapshot(), NOW), publication.rows);
  assert.equal(L.projectRows(pub(H + 1), snapshot(), NOW).at(-1).height, H + 1);
});
test('wall-clock midnight appends exactly one current day, independent of miner date', () => {
  const publication = pub();
  const rows = L.projectRows(publication, snapshot(), Date.UTC(2026, 9, 25, 0, 1));
  assert.equal(rows.length, 3); assert.equal(rows.at(-1).date, '2026-10-25');
  assert.equal(rows[1], publication.rows[1]);
  const missed = L.projectRows(publication, snapshot(), Date.UTC(2026, 9, 28));
  assert.equal(missed.length, 3); assert.equal(missed.at(-1).date, '2026-10-28');
});
test('known same-height timestamp-preserving reorg outranks older publication', () => {
  const publication = pub(H); publication.source.latest_block_time_utc = new Date(NOW).toISOString();
  const reorg = snapshot(headers(), {reorg:true, reorgFrom:H, reorgAt:NOW});
  assert.equal(L.projectRows(publication, reorg, NOW).at(-1).provisional, true);
  publication.generated_utc = new Date(NOW + 1000).toISOString();
  assert.equal(L.projectRows(publication, reorg, NOW), publication.rows);
});
test('lower replacement lineage survives stale higher publication and clips orphaned projection only', () => {
  const publication = pub(H + 5, [{date:'2026-10-22',height:H - 100,epoch:1},
    {date:'2026-10-23',height:H + 1,epoch:1},{date:'2026-10-24',height:H + 5,epoch:1}]);
  publication.generated_utc = new Date(NOW + 10000).toISOString();
  const rows = L.projectRows(publication, snapshot(headers(), {reorg:true,reorgFrom:H + 6,reorgAt:NOW}), NOW);
  assert.deepEqual(rows.map(x => x.height), [H - 100,H]);
  assert.equal(publication.rows.length, 3);
});
test('halving-day target matches known adjacent published UTC boundary weighting', () => {
  const rows = [{date:'2026-10-23',height:209995,epoch:1},{date:'2026-10-24',height:210004,epoch:2}];
  const projected = L.projectRows(pub(210004, rows), snapshot(headers(210005)), NOW).at(-1);
  assert.equal(projected.target_issuance, 144 * (4/10*50 + 6/10*25));
  assert.equal(projected.target_rate, projected.target_issuance * 365 / projected.supply);
});

function events() {
  const listeners = new Map();
  return {addEventListener(name, fn) {if (!listeners.has(name)) listeners.set(name,new Set()); listeners.get(name).add(fn);},
    removeEventListener(name,fn) {listeners.get(name)?.delete(fn);}, dispatch(name) {for(const fn of listeners.get(name)||[]) fn();}};
}
function harness(options = {}) {
  let now = NOW, onTip, onStatus, timerId = 0, changes = 0;
  const timers = new Map(), requests = [], blocks = new Map(headers().map(b => [b.height,b]));
  const state = {intercept:null, canonical:null, live:true, refreshes:0, starts:0, stops:0};
  const root = {...events(), document:{...events(), visibilityState:'visible'}, navigator:{onLine:true},
    setTimeout(fn,delay) {const id=++timerId; timers.set(id,{fn,at:now+delay}); return id;},
    clearTimeout(id) {timers.delete(id);},
    WSBBitcoinChainTip:{create(callbacks) {onTip=callbacks.onTip; onStatus=callbacks.onStatus;
      return {start(){state.starts++;},stop(){state.stops++;},refresh(){state.refreshes++;},isLive(){return state.live;}};}},
    fetch:async(url,init) => {
      requests.push({url,init});
      const intercepted=state.intercept?.(url,init); if(intercepted!==undefined) return intercepted;
      const height=Number(url.split('/').at(-1));
      if(url.includes('/block-height/')) return {ok:true,text:async()=>state.canonical || blocks.get(height)?.id || ''};
      return {ok:true,json:async()=>Array.from({length:15},(_,n)=>blocks.get(height-n)).filter(Boolean)};
    }};
  vm.runInNewContext(source,{window:root,AbortController,Date:class extends Date{static now(){return now;}},console});
  const feed=root.WSBIssuanceLive.create({onChange(){changes++;},pageDelayMs:0,...options});
  const flush=async()=>{for(let n=0;n<200;n++) await Promise.resolve();};
  async function tick(ms){const until=now+ms; for(;;){const next=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!next)break; now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();} now=until;await flush();}
  return {root,state,feed,blocks,requests,timers,flush,tick,changes:()=>changes,
    emit(block){onTip(block);},status(){onStatus();},start(){feed.start();onTip(blocks.get(H));},
    async next(height=H+1,extra={}) {const b={height,id:hash(height),previousblockhash:blocks.get(height-1)?.id,timestamp:NOW/1000+(height-H)*600,...extra};blocks.set(height,b);onTip(b);await flush();return b;}};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('bootstrap validates canonical window; linked block installs immediately without REST', async () => {
  const h=harness();h.start();await h.flush();
  assert.equal(h.feed.current().tip.height,H);assert.equal(h.feed.current().row.timezone_blocks,144);
  assert.ok(h.requests.at(-1).url.includes('/block-height/'));
  const count=h.requests.length;await h.next();
  assert.equal(h.feed.current().tip.height,H+1);assert.equal(h.requests.length,count);
});
test('missed blocks catch up with bounded REST and retain complete state on malformed pages', async () => {
  const h=harness();h.start();await h.flush();
  const retained=h.feed.current();const bad={height:H+2,id:hash(H+2),previousblockhash:hash(H+1),timestamp:NOW/1000+1200};
  h.blocks.set(H+2,bad);h.emit(bad);await h.flush();
  assert.equal(h.feed.current().tip.id,retained.tip.id);assert.equal(h.feed.current().live,false);
  h.blocks.set(H+1,{height:H+1,id:hash(H+1),previousblockhash:hash(H),timestamp:NOW/1000+600});
  await h.tick(5000);assert.equal(h.feed.current().tip.height,H+2);
});
test('rejected canonical REST window is never reused by the fast path on retry', async () => {
  const h=harness();h.state.canonical=hash(H,9);h.start();await h.flush();assert.equal(h.feed.current(),null);
  const requests=h.requests.length;await h.tick(5000);assert.equal(h.feed.current(),null);
  assert.ok(h.requests.length>requests+1,'retry must re-fetch discarded ancestry');
  h.state.canonical=null;await h.tick(10000);assert.equal(h.feed.current().tip.height,H);
});
test('same-height/lower reorg and subsequent linked recovery retain lineage', async () => {
  const h=harness();h.start();await h.flush();
  await h.next(H,{id:hash(H,1)});assert.equal(h.feed.current().tip.id,hash(H,1));assert.equal(h.feed.current().reorg,true);
  h.emit({...h.blocks.get(H-2),reorg:true});await h.flush();
  assert.equal(h.feed.current().tip.height,H-2);assert.equal(h.feed.current().reorgFrom,H);
  await h.next(H-1,{id:hash(H-1,2)});assert.equal(h.feed.current().reorg,true);
});
test('stale in-flight REST result cannot replace a newer authoritative tip', async () => {
  const h=harness(), wait=deferred();h.state.intercept=url=>url.includes('/blocks/')?wait.promise:undefined;
  h.start();await h.flush();h.state.intercept=null;
  await h.next();wait.resolve({ok:true,json:async()=>headers(H-1).slice(0,15)});await h.flush();
  assert.equal(h.feed.current().tip.height,H+1);
});
test('429 backoff survives hidden/offline pause and resumes without hammering', async () => {
  const h=harness();h.state.intercept=()=>({ok:false,status:429,headers:{get:()=> '120'}});h.start();await h.flush();
  assert.equal(h.requests.length,1);h.root.navigator.onLine=false;h.root.dispatch('offline');
  await h.tick(60000);assert.equal(h.requests.length,1);
  h.root.navigator.onLine=true;h.root.dispatch('online');await h.flush();assert.equal(h.requests.length,1);
  h.state.intercept=null;await h.tick(60000);assert.equal(h.feed.current().tip.height,H);
});
test('hidden abort discards ignored late response; visible resume installs once complete', async () => {
  const h=harness(), wait=deferred();h.state.intercept=()=>wait.promise;h.start();await h.flush();
  const request=h.requests[0];h.root.document.visibilityState='hidden';h.root.document.dispatch('visibilitychange');
  assert.equal(request.init.signal.aborted,true);h.state.intercept=null;
  wait.resolve({ok:true,json:async()=>headers(H-1).slice(0,15)});await h.flush();assert.equal(h.feed.current(),null);
  h.root.document.visibilityState='visible';h.root.document.dispatch('visibilitychange');await h.flush();
  assert.equal(h.feed.current().tip.height,H);
});
test('stalled response body is timed out and ignored even if transport ignores abort', async () => {
  const h=harness({requestTimeoutMs:100}), wait=deferred();
  h.state.intercept=()=>({ok:true,json:()=>wait.promise});h.start();await h.flush();
  await h.tick(100);assert.equal(h.requests[0].init.signal.aborted,true);
  wait.resolve(headers(H-1).slice(0,15));await h.flush();assert.equal(h.feed.current(),null);
  assert.equal(h.requests.length,1);
});
test('bounded page budget retains last-good window and wake does not fabricate newer observation', async () => {
  const h=harness({maxPages:1});h.start();await h.flush();assert.equal(h.feed.current(),null);
  const good=harness();good.start();await good.flush();const observed=good.feed.current().observedAt;
  await good.tick(10000);good.feed.refresh();await good.flush();assert.equal(good.feed.current().observedAt,observed);
  good.feed.stop();const changes=good.changes();await good.next();assert.equal(good.changes(),changes);
});

test('backward miner time extends the window with missing older ancestry, counting HTTP pages only', async () => {
  const h=harness();h.start();await h.flush();
  const before=h.requests.length;
  await h.next(H+1,{timestamp:NOW/1000-7200});
  assert.equal(h.feed.current().tip.height,H+1);
  assert.equal(h.feed.current().row.timezone_blocks,157);
  assert.ok(h.requests.length>before);
});
test('an incomplete bootstrap that goes offline cannot publish its late canonical response', async () => {
  const h=harness(), wait=deferred();
  h.state.intercept=url=>url.includes('/block-height/')?wait.promise:undefined;
  h.start();await h.flush();assert.equal(h.feed.current(),null);
  h.root.navigator.onLine=false;h.root.dispatch('offline');
  wait.resolve({ok:true,text:async()=>hash(H)});await h.flush();assert.equal(h.feed.current(),null);
  h.state.intercept=null;h.root.navigator.onLine=true;h.root.dispatch('online');await h.flush();
  assert.equal(h.feed.current().tip.height,H);
});
