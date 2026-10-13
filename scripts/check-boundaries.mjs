// packages/* may not import from importers/*, connectors/* or apps/*, and may not name a vendor.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const errors = [];
const VENDOR = /\b(niagara|tridium|jace|workbench|metasys|johnson|distech|honeywell|siemens|schneider|bacnet|modbus)\b/i;
function walk(d, fn) { for (const n of readdirSync(d)) { const p = join(d, n); if (n === 'node_modules') continue; if (statSync(p).isDirectory()) walk(p, fn); else if (/\.(ts|mts|js|mjs)$/.test(p)) fn(p); } }
try {
  walk('packages', (p) => {
    const s = readFileSync(p, 'utf8');
    for (const m of s.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (/(^|\/)(importers|connectors|apps)\//.test(spec) || /^@archipelago\/(importer|connector|app)-/.test(spec)) errors.push(`${p}: imports ${spec}`);
    }
    if (VENDOR.test(s.replace(/\/\/.*$/gm, ''))) errors.push(`${p}: names a vendor or protocol in packages/*`);
  });
} catch (e) { if (e.code !== 'ENOENT') throw e; }
if (errors.length) { console.error('check-boundaries: FAILED\n' + errors.map((e) => '  - ' + e).join('\n')); process.exit(1); }
console.log('check-boundaries: ok');
