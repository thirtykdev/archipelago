// Mapping from a generic station object graph to Archipelago entities. The only file in this importer that
// knows what the types mean. Everything it cannot classify is reported as unknown, never guessed.
import type { BindingHint, PointKind, Provenance, Redaction } from '@archipelago/core';
import type { Graph, GraphNode } from './graph.ts';
import { child, walk } from './graph.ts';

export interface Device { name: string; path: string; type: string; driver: string; instance?: number; address?: string; points: number }
export interface Network { name: string; path: string; type: string; driver: string; devices: number }
export interface Point { name: string; path: string; kind: PointKind; writable: boolean; units?: string; device?: string; binding?: BindingHint['ref'] & { connector: string }; histories: string[]; alarms: string[]; /** a writable point's fallback value: the setpoint the station holds when nothing else commands it */ fallback?: string }
export interface Extension { path: string; type: string; kind: 'history' | 'alarm'; algorithm?: string; point: string; enabled?: boolean; inhibited?: boolean; highLimit?: string; lowLimit?: string; alarmClass?: string }
export interface StationModel {
  stationName: string;
  version: string;
  networks: Network[];
  devices: Device[];
  points: Point[];
  extensions: Extension[];
  links: number;
  components: number;
  knownTypes: Record<string, number>;
  unknownTypes: Record<string, number>;
  warnings: string[];
}

const POINT_TYPES: Record<string, [PointKind, boolean]> = {
  'control:NumericPoint': ['numeric', false], 'control:NumericWritable': ['numeric', true],
  'control:BooleanPoint': ['boolean', false], 'control:BooleanWritable': ['boolean', true],
  'control:EnumPoint': ['enum', false], 'control:EnumWritable': ['enum', true],
  'control:StringPoint': ['string', false], 'control:StringWritable': ['string', true],
};
// Modules whose types we recognise as part of a station's ordinary structure. Anything else is reported.
const KNOWN_MODULES = new Set(['baja', 'control', 'alarm', 'history', 'driver', 'bacnet', 'niagaraDriver', 'niagaraVirtual', 'kitControl', 'schedule', 'web', 'net', 'platform', 'file', 'converters', 'program', 'tagdictionary', 'hierarchy', 'report', 'box', 'backup', 'fox', 'search', 'template', 'webEditors', 'kitPx', 'gx', 'bql', 'crypto', 'ldap', 'analytics', 'cloudLink', 'modbusAsync', 'modbusTcp', 'modbusCore', 'lonworks', 'obix', 'nrio', 'ndio', 'serial', 'email', 'smtp', 'bajaui', 'workbench', 'rdb', 'rdbSqlServer', 'rdbMySql', 'sms', 'weather', 'videoDriver', 'axvelocity', 'kitLon', 'devkit', 'migration', 'nre', 'test', 'tagdictionaryHaystack', 'haystack', 'docDeveloper', 'bacnetAws', 'bacnetws', 'obixDriver', 'jsonToolkit', 'jsonSmart', 'httpClient', 'niagaraCloudSuite']);

function facetsUnits(v: string | undefined): string | undefined {
  if (!v) return undefined;
  for (const part of v.split(';')) { const [k, val] = part.split('='); if (k === 'units' && val) return val.replace(/^u:/, '').split(';')[0]; }
  return undefined;
}
function objectId(v: string | undefined): { objectType: string; instance: number } | undefined {
  if (!v) return undefined; const c = v.indexOf(':'); if (c < 0) return undefined;
  const inst = Number(v.slice(c + 1)); if (!Number.isFinite(inst)) return undefined;
  return { objectType: v.slice(0, c), instance: inst };
}
function findValue(n: GraphNode, name: string, skip?: string): string | undefined {
  for (const c of n.children) {
    if (c.name === skip) continue;
    if (c.name === name && c.value !== undefined) return c.value;
    const v = findValue(c, name, skip); if (v !== undefined) return v;
  }
  return undefined;
}

export function mapStation(g: Graph, artifact: string): StationModel {
  const m: StationModel = { stationName: findValue(g.root, 'stationName') ?? '', version: g.version, networks: [], devices: [], points: [], extensions: [], links: 0, components: g.nodes, knownTypes: {}, unknownTypes: {}, warnings: [...g.warnings] };
  const deviceOf = new Map<GraphNode, Device>();

  // pass 1: types, networks, devices
  for (const n of walk(g.root)) {
    const t = n.type ?? n.rawType;
    if (!t) continue;
    const mod = t.slice(0, t.indexOf(':'));
    if (n.rawType || !KNOWN_MODULES.has(mod)) m.unknownTypes[t] = (m.unknownTypes[t] ?? 0) + 1; else m.knownTypes[t] = (m.knownTypes[t] ?? 0) + 1;
    if (t === 'baja:Link') m.links++;
    if (/Network$/.test(t) && n.path.startsWith('/Drivers/') && n.path.split('/').length === 3) m.networks.push({ name: n.name, path: n.path, type: t, driver: mod, devices: 0 });
  }
  const isDevice = (n: GraphNode, t: string) => /Device$/.test(t) && !/^(baja|driver):/.test(t) && !/Local/.test(t) && child(n, 'points') !== undefined;
  for (const n of walk(g.root)) {
    const t = n.type ?? n.rawType; if (!t || !isDevice(n, t)) continue;
    const d: Device = { name: n.name, path: n.path, type: t, driver: t.slice(0, t.indexOf(':')), points: 0 };
    const oid = objectId(findValue(n, 'objectId', 'points')); if (oid && oid.objectType === 'device') d.instance = oid.instance;
    const addr = child(n, 'address'); if (addr) { const mac = findValue(addr, 'macAddress'); const net = findValue(addr, 'networkNumber'); if (mac || net) d.address = `${net ?? '?'}:${mac ?? '?'}`; }
    m.devices.push(d); deviceOf.set(n, d);
    const net = m.networks.find((x) => n.path.startsWith(x.path + '/')); if (net) net.devices++;
  }
  // pass 2: points, extensions, bindings
  const imported = (locator: string): Provenance => ({ kind: 'imported', artifact, locator });
  const walkPoints = (n: GraphNode, dev: Device | undefined) => {
    const d = deviceOf.get(n) ?? dev;
    const t = n.type;
    const pt = t ? POINT_TYPES[t] : undefined;
    if (pt) {
      const p: Point = { name: n.name, path: n.path, kind: pt[0], writable: pt[1], histories: [], alarms: [] };
      const u = facetsUnits(child(n, 'facets')?.value); if (u) p.units = u;
      const fb = child(n, 'fallback')?.value; if (pt[1] && fb !== undefined) p.fallback = fb;
      if (d) { p.device = d.path; d.points++; }
      const proxy = child(n, 'proxyExt');
      if (proxy?.type?.startsWith('bacnet:') && d?.instance !== undefined) {
        const oid = objectId(child(proxy, 'objectId')?.value);
        if (oid) { const prop = child(proxy, 'propertyId')?.value; p.binding = { connector: 'bacnet-ip', device: d.instance, objectType: oid.objectType, instance: oid.instance, ...(prop ? { property: prop } : {}) }; }
      }
      for (const c of n.children) {
        const ct = c.type; if (!ct) continue;
        const flag = (name: string) => { const v = child(c, name)?.value; return v === undefined ? undefined : v === 'true'; };
        if (/HistoryExt$/.test(ct)) { const en = flag('enabled'); m.extensions.push({ path: c.path, type: ct, kind: 'history', point: n.path, ...(en !== undefined ? { enabled: en } : {}) }); p.histories.push(c.name); }
        else if (ct.startsWith('alarm:') && /Ext$/.test(ct)) { const algN = child(c, 'offnormalAlgorithm'); const alg = algN?.type; const hi = algN ? child(algN, 'highLimit')?.value : undefined; const lo = algN ? child(algN, 'lowLimit')?.value : undefined; const inh = flag('alarmInhibit'); const cls = child(c, 'alarmClass')?.value; m.extensions.push({ path: c.path, type: ct, kind: 'alarm', point: n.path, ...(alg ? { algorithm: alg } : {}), ...(hi !== undefined ? { highLimit: hi } : {}), ...(lo !== undefined ? { lowLimit: lo } : {}), ...(inh !== undefined ? { inhibited: inh } : {}), ...(cls ? { alarmClass: cls } : {}) }); p.alarms.push(c.name); }
      }
      m.points.push(p);
      void imported; // provenance is attached when assertions are emitted; inspect reports structure only
      return;
    }
    for (const c of n.children) walkPoints(c, d);
  };
  walkPoints(g.root, undefined);
  return m;
}
