import { describe, it, expect } from 'vitest';
import { stationXml, bog, bogGzip, dist, hostile, enc } from '../../../fixtures/synthetic/station.ts';
import { sniff } from './sniff.ts';
import { listZip, readZipEntry } from './archive.ts';
import { parseXml } from './xml.ts';
import { toGraph } from './graph.ts';
import { CapExceeded, Refused, DEFAULT_CAPS } from './caps.ts';
import { inspect, openStationFile } from './inspect.ts';

const small = { ...DEFAULT_CAPS, maxEntryBytes: 4 * 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024, maxEntries: 2000, maxRatio: 100, maxXmlDepth: 64 };

describe('sniff', () => {
  it('detects by bytes, never by name', () => {
    expect(sniff(bog('<a/>'))).toBe('zip');
    expect(sniff(bogGzip('<a/>'))).toBe('gzip');
    expect(sniff(enc('﻿  <?xml version="1.0"?><a/>'))).toBe('xml');
    expect(sniff(hostile.garbage())).toBe('unknown');
  });
});

describe('archive caps', () => {
  it('refuses a decompression bomb before inflating', () => { expect(() => { const b = hostile.bomb(40); const e = listZip(b, small)[0]!; readZipEntry(b, e, small); }).toThrow(CapExceeded); });
  it('catches an entry that lies about its size', () => { expect(() => { const b = hostile.liar(); const e = listZip(b, small)[0]!; readZipEntry(b, e, small); }).toThrow(/declared|cap|past/); });
  it('refuses path traversal names', () => { expect(() => listZip(hostile.traversal(), small)).toThrow(Refused); });
  it('refuses too many entries', () => { expect(() => listZip(hostile.tooManyEntries(2500), small)).toThrow(CapExceeded); });
  it('refuses a truncated archive cleanly', () => { expect(() => openStationFile(hostile.truncated(), small)).toThrow(Refused); });
  it('refuses garbage', () => { expect(() => openStationFile(hostile.garbage(), small)).toThrow(Refused); });
});

describe('xml reader', () => {
  it('refuses DOCTYPE', () => { expect(() => parseXml(hostile.doctype(), small)).toThrow(/DOCTYPE/); });
  it('keeps unknown entities literally, decodes predefined and numeric ones, reports the unknown', () => {
    const d = parseXml(hostile.entity(), small);
    const v = d.root.children[0]!.children[0]!.attrs.v;
    expect(v).toBe('a &unknown; b \u0001 c & d');
    expect(d.warnings.some((w) => /unresolved entity/.test(w))).toBe(true);
  });
  it('caps nesting depth', () => { expect(() => parseXml(hostile.deep(400), small)).toThrow(CapExceeded); });
  it('handles comments, CDATA and self-closing tags', () => {
    const d = parseXml(`<r><!-- c --><a x="1"/><b><![CDATA[<raw>]]></b></r>`, small);
    expect(d.root.children.length).toBe(2);
    expect(d.root.children[1]!.text).toBe('<raw>');
  });
});

describe('object graph', () => {
  it('resolves type prefixes through m= bindings, document-global in document order', () => {
    const g = toGraph(parseXml(stationXml({ devices: 1, pointsPerDevice: 1 }), small).root);
    expect(g.root.type).toBe('baja:Station');
    const pt = [...(function* w(n: any): Generator<any> { yield n; for (const c of n.children) yield* w(c); })(g.root)].find((n) => n.name === 'ZN_T');
    expect(pt.type).toBe('control:NumericPoint');
  });
  it('refuses a document that is not a station graph', () => { expect(() => toGraph(parseXml(hostile.notAGraph(), small).root)).toThrow(Refused); });
});

describe('inspect', () => {
  it('reads a .bog, a gzip bog, bare xml and a .dist to the same station', () => {
    const xml = stationXml({ devices: 3, pointsPerDevice: 6, withLink: true, withUnknownModule: true });
    for (const bytes of [bog(xml), bogGzip(xml), enc(xml), dist(xml)]) {
      const r = inspect(bytes, small);
      expect(r.station.stationName).toBe('Synthetic_Jace');
      // an unknown vendor's network and device are still structure: counted, and their types reported as unknown
      expect(r.station.networks.map((n) => n.name)).toEqual(['BacnetNetwork', 'Mystery']);
      expect(r.station.devices.length).toBe(4);
      expect(r.station.devices.filter((d) => d.driver === 'bacnet').length).toBe(3);
      expect(r.station.devices[0]!.instance).toBe(2001);
      expect(r.station.points.length).toBe(18);
      expect(r.station.points.filter((p) => p.writable).length).toBe(6);
      expect(r.station.points.find((p) => p.name === 'ZN_T')!.units).toBe('°F');
      expect(r.station.points.find((p) => p.name === 'ZN_T')!.binding).toEqual({ connector: 'bacnet-ip', device: 2001, objectType: 'analogInput', instance: 1, property: 'presentValue' });
      expect(r.station.extensions.filter((e) => e.kind === 'history').length).toBe(6);
      expect(r.station.extensions.filter((e) => e.kind === 'alarm').length).toBe(6);
      expect(r.station.extensions.find((e) => e.kind === 'alarm')!.algorithm).toMatch(/Algorithm$/);
      expect(r.station.links).toBe(3);
      expect(Object.keys(r.station.unknownTypes)).toContain('someVendorModule:MysteryNetwork');
      expect(r.coverage['points with a native address']).toEqual({ have: 18, of: 18 });
    }
  });
  it('picks the station config out of a backup, not the pre-edit copy', () => {
    const r = inspect(dist(stationXml({ devices: 2 })), small);
    expect(r.artifact.format).toBe('dist');
    expect(r.entry).toBe('stations/Synthetic_Jace/config.bog');
    expect(r.station.devices.length).toBe(2);
  });
  it('redacts passwords and never carries the value anywhere in the report', () => {
    const r = inspect(bog(stationXml({ withPassword: true })), small);
    expect(r.redactions.length).toBe(1);
    expect(r.redactions[0]!.kind).toBe('baja:Password');
    expect(JSON.stringify(r)).not.toContain('MATCH_ME_NEVER_PRINTED');
  });
  it('is fast enough on a larger synthetic station', () => {
    const xml = stationXml({ devices: 300, pointsPerDevice: 6 });
    const r = inspect(bog(xml), { ...small, maxEntryBytes: 64 * 1024 * 1024, maxTotalBytes: 128 * 1024 * 1024 });
    expect(r.station.points.length).toBe(1800);
    expect(r.elapsedMs).toBeLessThan(3000);
  });
});
