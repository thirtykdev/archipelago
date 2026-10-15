import { describe, it, expect } from 'vitest';
import { Model } from '@archipelago/core';
import { stationXml, bog } from '../../../fixtures/synthetic/station.ts';
import { inspect } from './inspect.ts';
import { applyStation } from './assertions.ts';
describe('station assertions', () => {
  it('re-importing a changed station yields a diff by handle, and a retired device', () => {
    const m = new Model();
    const r1 = inspect(bog(stationXml({ devices: 2, pointsPerDevice: 3 })));
    applyStation(m, r1, new Map(Object.entries(r1.handles)));
    const s1 = m.snapshot('first', [r1.artifact.sha256]);
    expect(m.live('device').length).toBe(2); expect(m.live('point').length).toBe(6);
    const r2 = inspect(bog(stationXml({ devices: 1, pointsPerDevice: 4 })));
    applyStation(m, r2, new Map(Object.entries(r2.handles)));
    const s2 = m.snapshot('second', [r2.artifact.sha256]);
    const d = m.diff(s1.id, s2.id);
    expect(m.live('device').length).toBe(1);
    expect(d.removed.some((e) => e.kind === 'device' && e.name === 'VAV_02')).toBe(true);
    expect(d.added.some((e) => e.kind === 'point' && e.name === 'MODE')).toBe(true);
    const zn = m.live('point').find((e) => e.name === 'ZN_T')!;
    expect(m.value(zn.id, 'binding')).toMatchObject({ connector: 'bacnet-ip', objectType: 'analogInput' });
    expect(m.currentAssertion(zn.id, 'units')!.provenance.kind).toBe('imported');
  });
});
