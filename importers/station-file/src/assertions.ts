// Turn an inspect report into entities and assertions. Identity: the station's persisted handle when it has one
// (so a rename or a move is the same thing), else the path. Every assertion is imported, with a locator.
import type { Model, Provenance } from '@archipelago/core';
import type { InspectReport } from './inspect.ts';

export function stationEntityId(stationName: string, path: string, handle?: string): string { return handle ? `${stationName}|h:${handle}` : `${stationName}|p:${path}`; }

export function applyStation(model: Model, r: InspectReport, handles: Map<string, string | undefined>): { entities: number; assertions: number } {
  const s = r.station; const art = r.artifact.sha256; let ents = 0, asserts = 0;
  const imp = (locator: string): Provenance => ({ kind: 'imported', artifact: art, locator });
  const id = (path: string) => stationEntityId(s.stationName, path, handles.get(path));
  const put = (subject: string, key: string, value: unknown, locator: string) => { if (value === undefined) return; model.assert(subject, key, value, imp(locator)); asserts++; };
  const seen = new Set<string>();
  const ent = (e: Parameters<Model['addEntity']>[0]) => { model.addEntity(e); seen.add(e.id); ents++; if (e.path && e.path !== '/') { put(e.id, 'name', e.name, e.path); put(e.id, 'path', e.path, e.path); } };
  const stationId = `${s.stationName}|station`;
  ent({ id: stationId, kind: 'site', name: s.stationName || 'station', path: '/' });
  put(stationId, 'graphVersion', s.version, '/');
  for (const n of s.networks) { const eid = id(n.path); ent({ id: eid, kind: 'network', name: n.name, path: n.path, parent: stationId, ...(handles.get(n.path) ? { handle: handles.get(n.path)! } : {}) }); put(eid, 'type', n.type, n.path); put(eid, 'driver', n.driver, n.path); }
  for (const d of s.devices) {
    const eid = id(d.path); const net = s.networks.find((n) => d.path.startsWith(n.path + '/'));
    ent({ id: eid, kind: 'device', name: d.name, path: d.path, ...(net ? { parent: id(net.path) } : {}), ...(handles.get(d.path) ? { handle: handles.get(d.path)! } : {}) });
    put(eid, 'type', d.type, d.path); put(eid, 'driver', d.driver, d.path); put(eid, 'instance', d.instance, d.path + '/config'); put(eid, 'address', d.address, d.path + '/address');
  }
  for (const p of s.points) {
    const eid = id(p.path);
    ent({ id: eid, kind: 'point', name: p.name, path: p.path, ...(p.device ? { parent: id(p.device) } : {}), ...(handles.get(p.path) ? { handle: handles.get(p.path)! } : {}) });
    put(eid, 'kind', p.kind, p.path); put(eid, 'writable', p.writable, p.path); put(eid, 'units', p.units, p.path + '/facets');
    if (p.binding) { const { connector, ...ref } = p.binding; put(eid, 'binding', { connector, ...ref }, p.path + '/proxyExt'); }
    put(eid, 'histories', p.histories, p.path); put(eid, 'alarms', p.alarms, p.path); put(eid, 'fallback', p.fallback, p.path + '/fallback');
  }
  for (const x of s.extensions) { const eid = id(x.path); ent({ id: eid, kind: 'extension', name: x.path.split('/').pop() ?? x.type, path: x.path, parent: id(x.point) }); put(eid, 'type', x.type, x.path); put(eid, 'extKind', x.kind, x.path); put(eid, 'algorithm', x.algorithm, x.path + '/offnormalAlgorithm'); put(eid, 'enabled', x.enabled, x.path + '/enabled'); put(eid, 'inhibited', x.inhibited, x.path + '/alarmInhibit'); put(eid, 'highLimit', x.highLimit, x.path + '/offnormalAlgorithm/highLimit'); put(eid, 'lowLimit', x.lowLimit, x.path + '/offnormalAlgorithm/lowLimit'); put(eid, 'alarmClass', x.alarmClass, x.path + '/alarmClass'); }
  // anything from this station that this import did not see is retired (kept in history, not in the live set)
  for (const e of model.live()) if (e.id.startsWith(s.stationName + '|') && !seen.has(e.id)) model.retire(e.id);
  return { entities: ents, assertions: asserts };
}
