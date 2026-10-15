import { describe, it, expect } from 'vitest';
import { caf, cafXml, gfx, DEFAULT_POINTS } from '../../../fixtures/synthetic/controller.ts';
import { stationXml, bog, enc, hostile } from '../../../fixtures/synthetic/station.ts';
import { parseControllerFile, parseCaf, parseGfx } from './index.ts';
import { inspect, Refused } from '@archipelago/importer-station-file';
import { correlate } from '@archipelago/core';

describe('controller application file', () => {
  it('reads device, points, exposure, units and states from a zip or bare xml', () => {
    for (const bytes of [caf(), enc(cafXml())]) {
      const c = parseCaf(bytes);
      expect(c.format).toBe('caf'); expect(c.deviceName).toBe('VAV_01'); expect(c.deviceInstance).toBe(2001);
      expect(c.points.length).toBe(DEFAULT_POINTS.length);
      const zn = c.points.find((p) => p.name === 'ZN-T')!;
      expect(zn.ref).toEqual({ connector: 'bacnet-ip', objectType: 'analogInput', instance: 1, device: 2001 });
      expect(zn.kind).toBe('numeric'); expect(zn.writable).toBe(false); expect(zn.units).toMatch(/code 64/);
      expect(c.points.find((p) => p.name === 'MODE')!.states).toEqual(['Occ', 'Unocc', 'Standby']);
      expect(c.points.find((p) => p.name === 'CLG-MAXFLOW')!.exposed).toBe(false);
      expect(c.points.find((p) => p.name === 'DPR-O')!.writable).toBe(true);
      expect(c.confidence).toBe('synthetic-only');
    }
  });
  it('refuses hostile input like the station reader does', () => {
    expect(() => parseCaf(enc(hostile.doctype()))).toThrow(/DOCTYPE/);
    expect(() => parseControllerFile(hostile.garbage())).toThrow(Refused);
  });
});

describe('graphical controller file', () => {
  it('reads the object tree, writability, states and the UTF-16 project name', () => {
    const g = parseGfx(gfx());
    expect(g.format).toBe('gfx'); expect(g.deviceName).toBe('VAV_01'); expect(g.deviceInstance).toBe(2001);
    expect(g.points.length).toBe(DEFAULT_POINTS.length);
    expect(g.points.find((p) => p.name === 'SF_C')!.writable).toBe(true);
    expect(g.points.find((p) => p.name === 'SF_S')!.states).toEqual(['Off', 'On']);
    expect(g.points.find((p) => p.name === 'ZN_T')!.ref.device).toBe(2001);
  });
  it('is detected by content, not extension', () => { expect(parseControllerFile(gfx()).format).toBe('gfx'); expect(parseControllerFile(caf()).format).toBe('caf'); });
});

describe('correlation with a station', () => {
  it('finds what the controller exposes that the station never pulled in', () => {
    const station = inspect(bog(stationXml({ devices: 1, pointsPerDevice: 6 })));   // VAV_01 = device 2001 with 6 points
    const ctl = parseCaf(caf());                                                     // same device, 8 objects, 1 not exposed
    const sp = station.station.points.filter((p) => p.binding).map((p) => ({ id: p.path, name: p.name, ref: { device: p.binding!.device!, objectType: p.binding!.objectType!, instance: p.binding!.instance! } }));
    const cp = ctl.points.map((p) => ({ id: p.locator, name: p.name, ref: { device: p.ref.device!, objectType: p.ref.objectType!, instance: p.ref.instance! } }));
    const c = correlate(sp, cp);
    expect(c.matched.length).toBe(6);
    expect(c.onlyB.map((p) => p.name).sort()).toEqual(['CLG-MAXFLOW', 'HTG-O']);   // in the controller, not in the station
    expect(c.onlyA.length).toBe(0);
    // the missing ones keep a native address, so a local runtime can read them from the controller directly
    expect(c.onlyB[0]!.ref.device).toBe(2001);
  });
});
