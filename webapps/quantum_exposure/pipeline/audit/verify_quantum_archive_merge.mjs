#!/usr/bin/env node
// Read-only reproduction: evaluate the real dashboard parsing functions against
// a tiny in-memory fixture. No dashboard, network, database, or producer runs.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const args = process.argv.slice(2);
const appIndex = args.indexOf('--app');
const app = appIndex >= 0 ? args[appIndex + 1] : args[0];
if (!app) {
  console.error('Usage: node verify_quantum_archive_merge.mjs --app /path/to/dashboard_app.js');
  process.exit(2);
}
const source = fs.readFileSync(app, 'utf8');
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 1);
  if (start < 0 || end < 0) throw new Error(`Cannot isolate source function ${name}`);
  return source.slice(start, end);
}
const context = vm.createContext({});
for (const name of ['parseCsvLine', 'parseCsv', 'quantumHistoricalRefreshPoint', 'parseQuantumHistoricalSeries']) {
  vm.runInContext(functionSource(name), context, { filename: `${app}:${name}` });
}
const header = 'snapshot,balance_filter,script_type_filter,spend_activity_filter,exposed_supply_sats\n';
const active = header + '950000,all,All,all,60\n950000,all,All,active,20\n';
const archive = header + '949000,all,All,all,50\n949000,all,All,active,10\n';
const retained = Object.fromEntries(
  context.parseQuantumHistoricalSeries(active, archive).map(point => [point.snapshot, point.aggregatesRows.length])
);
console.log(JSON.stringify({
  app: path.resolve(app),
  fixture: { active_rows: 2, archive_rows: 2 },
  actual: { active_rows_retained: retained['950000'], archive_rows_retained: retained['949000'] },
  archive_row_loss_reproduced: retained['949000'] !== 2,
  correct_behavior_observed: retained['950000'] === 2 && retained['949000'] === 2,
  note: 'An exit code of zero means the read-only reproduction executed; inspect counts for correctness.'
}, null, 2));
