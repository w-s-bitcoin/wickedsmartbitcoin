import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const window = { location: new URL('http://127.0.0.1:8080/project/webapps/uoa/dashboard.html?old=1') };
vm.runInNewContext(fs.readFileSync(new URL('../webapps/shared/dashboard_share.js', import.meta.url), 'utf8'), {
  window, URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, btoa, atob,
});
const share = window.WSBDashboardShare;
const state = { primaryUoa: 'BTC', secondaryUoa: 'USD', visible: false, cursor: 0, names: ['₿', '円'], nested: { scale: 'log' } };
const encoded = share.encodeShareState(state);
assert.match(encoded, /^[A-Za-z0-9_-]+$/);
assert.equal(JSON.stringify(share.decodeShareState(encoded)), JSON.stringify(state));
for (const invalid of ['', 'invalid!', btoa('null'), btoa('[]'), btoa('42')]) {
  assert.equal(share.decodeShareState(invalid), null);
}
assert.equal(share.encodeShareState([]), '');
assert.equal(JSON.stringify(share.readShareState({ search: `?bip110_state=${encoded}`, aliases: ['bip110_state'] })), JSON.stringify(state));
assert.equal(JSON.stringify(share.readShareState({ search: '?state=e30' })), '{}');

let url = new URL(share.buildShareUrl({ slug: 'uoa', state, params: { pair: 'BTCUSD' } }));
assert.equal(url.pathname, '/project/uoa.html');
assert.equal(url.searchParams.get('pair'), 'BTCUSD');
assert.equal(url.searchParams.has('old'), false);
assert.equal(JSON.stringify(share.decodeShareState(url.searchParams.get('state'))), JSON.stringify(state));
assert.equal(new URL(share.buildShareUrl({ slug: 'uoa', state: {} })).searchParams.get('state'), 'e30');
window.location = new URL('https://wickedsmartbitcoin.com/webapps/node_count/dashboard.html');
assert.equal(new URL(share.buildShareUrl({ slug: 'node_count' })).pathname, '/node_count');
window.location = new URL('https://example.org/project/webapps/node_count/dashboard.html');
assert.equal(new URL(share.buildShareUrl({ slug: 'node_count' })).pathname, '/project/node_count');

window.location = new URL('http://localhost:8080/view.html?state=query&image=uoa#uoa?state=hash&pair=BTCUSD&legacy=1&scriptTypes=P2PK&scriptTypes=P2TR');
const params = share.getShellParams();
assert.equal(params.get('state'), 'query');
assert.equal(params.get('pair'), 'BTCUSD');
assert.deepEqual(Array.from(params.getAll('scriptTypes')), ['P2PK', 'P2TR']);
url = new URL(share.buildDashboardSrc('/webapps/uoa/dashboard.html?legacy=explicit', { nonce: 42 }), window.location);
assert.equal(url.searchParams.get('state'), 'query');
assert.equal(url.searchParams.get('pair'), 'BTCUSD');
assert.equal(url.searchParams.get('legacy'), 'explicit');
assert.deepEqual(Array.from(url.searchParams.getAll('scriptTypes')), ['P2PK', 'P2TR']);
assert.equal(url.searchParams.get('_'), '42');
assert.equal(url.searchParams.has('image'), false);
assert.equal(share.buildDashboardSrc('https://external.example/dashboard.html'), 'https://external.example/dashboard.html');
console.log('Dashboard share encoding, explicit defaults, aliases, routes, and iframe forwarding passed.');
