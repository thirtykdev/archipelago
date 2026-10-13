import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stationXml, dist } from '../../../fixtures/synthetic/station.ts';
describe('archipelago inspect', () => {
  it('prints a report for a synthetic backup and exits 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'archi-'));
    const f = join(dir, 'backup.dist'); writeFileSync(f, dist(stationXml({ devices: 2, pointsPerDevice: 3 })));
    const r = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'apps/cli/src/main.ts', 'inspect', f], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('devices     2');
    expect(r.stdout).toContain('redacted    1');
    expect(r.stdout).not.toContain('MATCH_ME');
  });
  it('refuses a hostile file with exit 3 and no stack trace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'archi-'));
    const f = join(dir, 'bad.bog'); writeFileSync(f, new Uint8Array([1, 2, 3]));
    const r = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'apps/cli/src/main.ts', 'inspect', f], { encoding: 'utf8' });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/^Refused:/);
  });
});
