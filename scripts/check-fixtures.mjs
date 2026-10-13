// Station, controller and spreadsheet files are allowed only as generated output under fixtures/synthetic/out (gitignored).
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const BAD = /\.(bog|dist|caf|gfx|xlsx|xls|csv|pdf|dbexport|px|zip)$/i;
const errors = [];
function walk(d) { for (const n of readdirSync(d)) { const p = join(d, n); if (n === 'node_modules' || n === '.git' || p.startsWith(join('fixtures', 'synthetic', 'out'))) continue; if (statSync(p).isDirectory()) walk(p); else if (BAD.test(n)) errors.push(p); } }
walk('.');
if (errors.length) { console.error('check-fixtures: FAILED, files that look like real engineering artifacts:\n' + errors.map((e) => '  - ' + e).join('\n')); process.exit(1); }
console.log('check-fixtures: ok');
