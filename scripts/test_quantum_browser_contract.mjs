#!/usr/bin/env node
// Isolated real-source functions with in-memory fixtures; no browser/server/data writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = fs.readFileSync(new URL('../webapps/quantum_exposure/dashboard_app.js', import.meta.url), 'utf8');
function functionSource(name) {
  const expression = new RegExp(`(?:async )?function ${name}\\(`);
  const match = expression.exec(source);
  assert.ok(match, name);
  const next = /\n(?:async )?function /g;
  next.lastIndex = match.index + match[0].length;
  const end = next.exec(source);
  return source.slice(match.index, end?.index ?? source.length);
}
const context = vm.createContext({
  window: { crypto: webcrypto }, Date, TextEncoder, Uint8Array,
  state: { publicationManifest: null, inactiveThresholdYears: 1, snapshotDataCache: new Map() },
  SCRIPT_TYPES_ORDER: ['P2PK', 'P2PKH', 'P2SH', 'P2WPKH', 'P2WSH', 'P2TR', 'Other'],
  SPEND_TYPES_ORDER: ['never_spent', 'inactive', 'active'],
  detailTagPassesFilters: () => true, identityBelongsToSelectedGroups: () => true, identityTagPassesFilters: () => true,
});
for (const name of ['parseCsvLine', 'parseCsv', 'quantumHistoricalRefreshPoint', 'parseQuantumHistoricalSeries',
  'fetchQuantumVerified', 'toInt', 'toFloat', 'parseScriptSupplyMap', 'getRowSupplyByScriptType', 'getRowExposedSupplySats',
  'getRowBalanceSats', 'getRowSelectedUtxoCount', 'rowPassesBalanceFilter', 'estimateCanonicalMigrationWeight',
  'getRowSpendActivityForFilters', 'classifySpendActivity', 'retainedQuantumSnapshotData', 'fetchQuantumRefreshSnapshot',
  'quantumScriptCorrectionVersion', 'quantumScriptCorrectionsAreComplete', 'fetchQuantumScriptCorrections',
  'aggregateAllKpis', 'getAggregate', 'getAggregateFloat',
  'aggregateKpisFromGe1', 'rowPassesTopExposureFilters', 'getRowScriptTypes', 'getFilteredExposedSupplySatsForRow',
  'estimateMigrationBlocksFromRow',
  'quantumSnapshotProvenance', 'quantumMethodologyLabel', 'quantumExposureCountPresentation', 'quantumSpendDateIsUnknown', 'buildFilteredExposedFromGe1Csv']) {
  vm.runInContext(functionSource(name), context, { filename: name });
}
const header = 'snapshot,balance_filter,script_type_filter,spend_activity_filter,exposed_supply_sats\n';
const active = header + '950000,all,All,all,60\n950000,all,All,active,20\n';
const archived = header + '949000,all,All,all,50\n949000,all,All,active,10\n950000,all,All,all,999\n';
const merged = context.parseQuantumHistoricalSeries(active, archived);
assert.deepEqual(Array.from(merged, point => [point.snapshot, point.aggregatesRows.length]), [['949000', 2], ['950000', 2]]);
assert.equal(merged[1].aggregatesRows[0].exposed_supply_sats, '60');

const bytes = new TextEncoder().encode('value\n123\n');
const hash = createHash('sha256').update(bytes).digest('hex');
const manifest = { format: 2, artifacts: { 'historical_eco.csv': {
  path: `generations/objects/${hash.slice(0, 2)}/${hash}.csv`, bytes: bytes.length, sha256: hash,
} } };
const requested = [];
const fetcher = async url => { requested.push(url); return new Response(bytes); };
await context.fetchQuantumVerified('webapp_data/historical_eco.csv', fetcher, manifest);
assert.equal(requested.length, 1, 'Verifying the chart must not fetch full detail eagerly');
assert.ok(requested[0].includes(hash));
await assert.rejects(context.fetchQuantumVerified('webapp_data/historical_eco.csv', async () => new Response('value\n124\n'), manifest), /hash mismatch/);
await assert.rejects(context.fetchQuantumVerified('webapp_data/historical_eco.csv', async () => new Response('short'), manifest), /length mismatch/);
await assert.rejects(context.fetchQuantumVerified('webapp_data/1000/dashboard_pubkeys_ge_1btc.csv', fetcher, manifest), /no valid artifact/);
const traversal = structuredClone(manifest);
traversal.artifacts['historical_eco.csv'].path = 'generations/../outside.csv';
await assert.rejects(context.fetchQuantumVerified('webapp_data/historical_eco.csv', fetcher, traversal), /no valid artifact/);

const oldManifest = { format: 2, artifacts: {} };
for (const name of ['dashboard_snapshot_meta.csv', 'dashboard_pubkeys_aggregates.csv', 'dashboard_pubkeys_ge_1btc_top100.csv', 'dashboard_pubkeys_ge_1btc.csv']) {
  oldManifest.artifacts[`1000/${name}`] = { sha256: hash };
}
const newer = structuredClone(oldManifest);
delete newer.artifacts['1000/dashboard_pubkeys_ge_1btc.csv'];
context.state.snapshotDataCache.set('1000', { complete: true, ge1IsUsingEcoSubset: false,
  publicationManifest: oldManifest, ge1Rows: [{ fixture: 'full' }], top100Rows: [{ fixture: 'top' }] });
const retained = await context.fetchQuantumRefreshSnapshot({ publicationManifest: newer,
  fetchFresh: () => { throw new Error('Must reuse verified retained full rows'); } }, '1000', true, 'webapp_data/1000');
assert.equal(retained.ge1Rows[0].fixture, 'full');
assert.equal(retained.publicationManifest, oldManifest);
newer.artifacts['1000/dashboard_pubkeys_aggregates.csv'].sha256 = 'b'.repeat(64);
assert.equal(context.retainedQuantumSnapshotData('1000', newer, 'webapp_data/1000', true), null,
  'Changed compact data cannot reuse old full rows');
assert.ok(context.retainedQuantumSnapshotData('1000', { format: 2, artifacts: {} }, 'webapp_data/1000', true),
  'A selected snapshot aged out of retention keeps its verified session data');

const row = { current_supply_sats: '120000000', exposed_supply_sats_by_script_type: '{"P2PK":20000000,"P2PKH":40000000}',
  exposed_utxo_count: '5', exposed_utxo_count_by_script_type: '{"P2PK":2,"P2PKH":3}' };
assert.equal(context.rowPassesBalanceFilter(row, 100000000), true, 'Eligibility uses current whole-group balance');
assert.equal(context.rowPassesBalanceFilter(row, 130000000), false);
assert.equal(context.getRowSelectedUtxoCount(row, ['P2PK']), 2);
assert.equal(context.getRowSelectedUtxoCount(row, ['All']), 5);
assert.equal(context.estimateCanonicalMigrationWeight(row), 2884);
assert.equal(context.estimateCanonicalMigrationWeight(row, ['P2PK']), 1096);
const cases = [1, 252, 253, 1000, 10000, 100000].map(count =>
  Object.fromEntries(context.SCRIPT_TYPES_ORDER.map((family, index) => [family, count + index])));
const pythonWeights = JSON.parse(execFileSync('python3', ['-c',
  'import json,sys;sys.path.insert(0,sys.argv[1]);from quantum_v2_analysis import migration_weight;print(json.dumps([migration_weight({k:{"exposed_utxo_count":v} for k,v in case.items()}) for case in json.loads(sys.argv[2])]))',
  fileURLToPath(new URL('../webapps/quantum_exposure/pipeline', import.meta.url)), JSON.stringify(cases)], { encoding: 'utf8' }));
assert.deepEqual(cases.map(counts => context.estimateCanonicalMigrationWeight({ exposed_utxo_count_by_script_type: JSON.stringify(counts) })), pythonWeights,
  'Browser and exporter scenarios must agree across mixed witness/legacy transaction boundaries');
const leapSnapshot = Date.parse('2024-02-29T00:00:00Z') / 1000;
const leapCutoff = Date.parse('2023-02-28T00:00:00Z') / 1000;
assert.equal(context.getRowSpendActivityForFilters({ ...row, last_spend_unix_time: leapCutoff },
  { snapshotUnixTime: leapSnapshot, inactiveThresholdYears: 1 }), 'inactive');
assert.equal(context.getRowSpendActivityForFilters({ ...row, last_spend_unix_time: leapCutoff + 1 },
  { snapshotUnixTime: leapSnapshot, inactiveThresholdYears: 1 }), 'active');
context.state.snapshotHeight = '500';
assert.equal(context.quantumSpendDateIsUnknown({ last_spend_blockheight: '1', last_spend_unix_time: '1231469665' }), true);
assert.equal(context.getRowSpendActivityForFilters({ last_spend_blockheight: '1', spend_activity: 'inactive' }, {}), 'inactive');
assert.match(context.quantumMethodologyLabel(), /unreconciled/);
assert.equal(context.quantumExposureCountPresentation().label,'Exposed Pubkeys');
context.state.publicationManifest = { metadata: { methodology_by_snapshot: { '500': { export_version: 'quantum-csv-v2', methodology_version: 'test-v2' } } } };
assert.equal(context.quantumExposureCountPresentation().label,'Exposed Groups');
assert.match(context.quantumExposureCountPresentation().tooltip,/reporting group/);
assert.equal(context.quantumSpendDateIsUnknown({ ...row, last_spend_blockheight: '1', last_spend_unix_time: '1231469665' }), false,
  'Versioned exact v2 records can explicitly represent a legitimate spend at height1');
const streamCsv = 'current_supply_sats,exposed_supply_sats_by_script_type,last_spend_blockheight,last_spend_unix_time,spend_activity\n'
  + '120000000,"{""P2PK"":60000000}",9,1700000000,active\n';
assert.equal(context.buildFilteredExposedFromGe1Csv(streamCsv, { scriptTypes: ['All'], balanceThresholdSats: 100000000,
  snapshotUnixTime: 1700000000, inactiveThresholdYears: 1 }).active, 60000000,
  'Streaming historical filters also use whole-group current balance for eligibility');

// Compare every family subset against direct canonical-group reduction, rather
// than reproducing the exporter's inclusion-exclusion algorithm in this test.
const subsetFixture = JSON.parse(execFileSync('python3', ['-c', String.raw`
import csv,json,sys,tempfile
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import quantum_v2_analysis as a
rows=[]
for name,families,balance,active in (
    ('a',('P2PKH','P2WPKH'),60000000,True),
    ('b',a.SCRIPT_TYPES,100000000,False),
    ('c',('P2SH',),5000000,False),
    ('z',('P2PK','P2PKH'),0,False)):
    for index,family in enumerate(families):
        count=(253+index if name=='a' else 1+index)
        exposed=0 if name=='b' and family=='P2TR' else count
        item=dict(group_id=name,script_type=family,current_supply_sats=balance,current_utxo_count=count,
                  exposed_supply_sats=balance if exposed else 0,exposed_utxo_count=exposed)
        if active:item.update(last_spend_blockheight=900,last_spend_time=1699999999)
        rows.append(item)
groups=list(a.canonical_groups(rows,1700000000))
cases=[]
for tier,minimum in (('all',0),('ge1',100000000)):
    for spends in (['all'],['active','never_spent']):
        for mask in range(1,128):
            families=[family for i,family in enumerate(a.SCRIPT_TYPES) if mask&(1<<i)]
            result=dict(supply_sats=0,exposed_pubkey_count=0,exposed_utxo_count=0,exposed_supply_sats=0,estimated_migration_blocks=0)
            weight=0
            for group in groups:
                if group['current_supply_sats']<minimum:continue
                slices={family:value for family,value in group['slices'].items() if family in families}
                result['supply_sats']+=sum(value['current_supply_sats'] for value in slices.values())
                if 'all' not in spends and group['spend_activity'] not in spends:continue
                count=sum(value['exposed_utxo_count'] for value in slices.values())
                result['exposed_pubkey_count']+=int(count>0)
                result['exposed_utxo_count']+=count
                result['exposed_supply_sats']+=sum(value['exposed_supply_sats'] for value in slices.values())
                weight+=a.migration_weight(slices)
            result['estimated_migration_blocks']=weight/4000000
            cases.append([dict(balance=tier,scriptTypes=families,spendActivities=spends),result])
with tempfile.TemporaryDirectory() as directory:
    metadata=a.export_snapshot(rows,snapshot_height=1000,snapshot_time=1700000000,output_dir=Path(directory))
    path=Path(directory)/'1000'
    print(json.dumps(dict(metadata=metadata,aggregates=(path/'dashboard_pubkeys_aggregates.csv').read_text(),
                         corrections=(path/'dashboard_script_corrections.csv').read_text(),cases=cases)))
`, fileURLToPath(new URL('../webapps/quantum_exposure/pipeline', import.meta.url))], { encoding: 'utf8' }));
context.state.aggregatesRows = context.parseCsv(subsetFixture.aggregates);
context.state.scriptCorrectionsRows = context.parseCsv(subsetFixture.corrections);
assert.equal(context.quantumScriptCorrectionsAreComplete(context.state.scriptCorrectionsRows, context.state.aggregatesRows), true);
for (const [filters, expected] of subsetFixture.cases) {
  assert.deepEqual(JSON.parse(JSON.stringify(context.aggregateAllKpis(filters))), expected, JSON.stringify(filters));
}
const expectedAll = subsetFixture.cases.find(([filters]) => filters.balance === 'all' && filters.scriptTypes.length === 7)[1];
assert.deepEqual(JSON.parse(JSON.stringify(context.aggregateAllKpis({balance:'all',scriptTypes:['All'],spendActivities:['all']}))), expectedAll);
const corruptCorrections = structuredClone(context.state.scriptCorrectionsRows);
corruptCorrections[0].exposed_pubkey_count_correction = String(Number(corruptCorrections[0].exposed_pubkey_count_correction) + 1);
assert.equal(context.quantumScriptCorrectionsAreComplete(corruptCorrections, context.state.aggregatesRows), false);
await assert.rejects(context.fetchQuantumScriptCorrections(async()=>new Response('missing',{status:404}),
  'webapp_data/1000', null, [subsetFixture.metadata], '1000'), /unavailable/);
assert.deepEqual(Array.from(await context.fetchQuantumScriptCorrections(()=>{throw Error('Legacy must not fetch correction files');},
  'webapp_data/500', null, [], '500')), []);
context.state.ge1Rows = [{group_id:'zero-selected-family',current_supply_sats:'120000000',
  exposed_supply_sats_by_script_type:'{"P2PKH":120000000,"P2WPKH":0}',
  exposed_utxo_count_by_script_type:'{"P2PKH":2,"P2WPKH":1}',
  exposed_utxo_count:'3',script_types:'P2PKH|P2WPKH',spend_activity:'never_spent'}];
const zeroFamily=context.aggregateKpisFromGe1({balance:'ge1',balanceThresholdSats:100000000,
  scriptTypes:['P2WPKH'],spendActivities:['all'],snapshotUnixTime:1700000000,inactiveThresholdYears:1},false);
assert.equal(zeroFamily.exposed_supply_sats,0);
assert.equal(zeroFamily.exposed_pubkey_count,1);
assert.equal(zeroFamily.exposed_utxo_count,1);
assert.equal(zeroFamily.estimated_migration_blocks,context.estimateCanonicalMigrationWeight(context.state.ge1Rows[0],['P2WPKH'])/4000000);
console.log('Quantum browser contracts passed: archive completeness, exact hashes, lazy loading, canonical filters/counts/scenario/calendar.');
