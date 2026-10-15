import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Model } from '@archipelago/core';
import { Store } from './store.ts';
describe('store', () => {
  it('replays the log and keeps artifacts encrypted at rest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atoll-'));
    const s = new Store(dir); const m = new Model(); s.attach(m);
    m.addEntity({ id: 'e', kind: 'point', name: 'ZN_T' }); m.assert('e', 'units', '°F', { kind: 'imported', artifact: 'a', locator: '/x' });
    s.putArtifact('abc', 'site.dist', new TextEncoder().encode('SECRET-PLAINTEXT-MARKER'));
    expect(readFileSync(join(dir, 'artifacts', 'abc.bin')).toString('latin1')).not.toContain('SECRET-PLAINTEXT');
    expect(new TextDecoder().decode(s.getArtifact('abc')!)).toBe('SECRET-PLAINTEXT-MARKER');
    const s2 = new Store(dir); const m2 = new Model(); expect(s2.attach(m2)).toBe(2);
    expect(m2.value('e', 'units')).toBe('°F');
    expect(s2.listArtifacts()[0]).toMatchObject({ sha256: 'abc', name: 'site.dist', size: 23 });
  });
});
