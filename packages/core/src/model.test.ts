import { describe, it, expect } from 'vitest';
import { Model } from './model.ts';
const imp = (locator: string) => ({ kind: 'imported' as const, artifact: 'a1', locator });
describe('model', () => {
  it('supersedes instead of overwriting, keeps the chain, and lets a person win over a later import', () => {
    const m = new Model();
    m.addEntity({ id: 'e1', kind: 'point', name: 'ZN_T', path: '/d/ZN_T' });
    const a = m.assert('e1', 'units', '°F', imp('/d/ZN_T/facets'));
    const b = m.assert('e1', 'units', '°C', imp('/d/ZN_T/facets'));
    expect(m.value('e1', 'units')).toBe('°C');
    expect(m.history('e1', 'units').map((x) => x.id)).toEqual([b.id, a.id]);
    // a value that flips back gets the same content id; history must not loop on it
    const c = m.assert('e1', 'units', '°F', imp('/d/ZN_T/facets'));
    expect(c.id).toBe(a.id);
    expect(m.history('e1', 'units').map((x) => x.id)).toEqual([a.id, b.id, a.id]);
    m.assert('e1', 'units', 'degF', { kind: 'confirmed', by: 'tech', at: 'now', supersedes: b.id });
    m.assert('e1', 'units', '°C', imp('/d/ZN_T/facets'));           // a re-import cannot displace a confirmation
    expect(m.value('e1', 'units')).toBe('degF');
    expect(m.assertions.size).toBe(3);
  });
  it('snapshots are content-addressed and diff by identity with a path fallback', () => {
    const m = new Model();
    m.addEntity({ id: 'h:1', kind: 'device', name: 'VAV_01', path: '/Drivers/N/VAV_01', handle: '1' });
    m.addEntity({ id: 'h:2', kind: 'point', name: 'ZN_T', path: '/Drivers/N/VAV_01/points/ZN_T', handle: '2', parent: 'h:1' });
    m.assert('h:2', 'units', '°F', imp('/x'));
    const s1 = m.snapshot('first');
    expect(m.snapshot('again').id).toBe(s1.id);
    m.assert('h:2', 'units', '°C', imp('/x'));                       // changed value
    m.addEntity({ id: 'h:3', kind: 'point', name: 'DA_T', path: '/Drivers/N/VAV_01/points/DA_T', handle: '3', parent: 'h:1' }); // added
    m.retire('h:1'); m.addEntity({ id: 'h:9', kind: 'device', name: 'VAV_01', path: '/Drivers/N/VAV_01', handle: '9' });      // same path, new handle: re-identified
    const s2 = m.snapshot('second');
    const d = m.diff(s1.id, s2.id);
    expect(d.changed).toEqual([{ subject: 'h:2', name: 'ZN_T', key: 'units', from: '°F', to: '°C' }]);
    expect(d.added.map((e) => e.id)).toEqual(['h:3']);
    expect(d.removed).toEqual([]);
    expect(d.renamed.map((r) => [r.from, r.to])).toEqual([['h:1', 'h:9']]);
  });
  it('replays events into an identical model', () => {
    const m = new Model(); const log: any[] = []; m.onEvent((e) => log.push(e));
    m.addEntity({ id: 'e', kind: 'point', name: 'p' }); m.assert('e', 'k', 1, imp('/')); m.assert('e', 'k', 2, imp('/')); m.snapshot('s');
    const m2 = new Model(); for (const e of log) m2.apply(e);
    expect(m2.value('e', 'k')).toBe(2); expect(m2.snapshots[0]!.id).toBe(m.snapshots[0]!.id); expect(m2.history('e', 'k').length).toBe(2);
  });
});
