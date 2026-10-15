// A Distech-style graphical controller file: a zip. Observed, validated on synthetic fixtures only:
//   Config/IP/LogicalTree.json   objects with objType (number), objInstance, name
//   Info/InternalPoints.xml      per point: writable flag and state texts
//   Info/ProjectInfo.xml         the controller name (UTF-16 in observed files)
// Paths are matched case-insensitively; anything missing is a warning, not a failure.
import { listZip, readZipEntry, parseXml, sniff, DEFAULT_CAPS, Refused, type Caps } from '@archipelago/importer-station-file';
import { BACNET_OBJECT_TYPES, kindOf, isOutput, type ControllerFile, type ControllerPoint } from './model.ts';

function decode(b: Uint8Array): string {
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  const s = new TextDecoder('utf-8', { fatal: false }).decode(b); return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}
function findObjects(json: unknown, out: Array<{ objType: number; objInstance: number; name: string }>, depth = 0) {
  if (depth > 32 || !json || typeof json !== 'object') return;
  if (Array.isArray(json)) { for (const x of json) findObjects(x, out, depth + 1); return; }
  const o = json as Record<string, unknown>;
  if (typeof o.objType === 'number' && typeof o.objInstance === 'number' && typeof o.name === 'string') out.push({ objType: o.objType, objInstance: o.objInstance, name: o.name });
  for (const v of Object.values(o)) findObjects(v, out, depth + 1);
}

export function parseGfx(bytes: Uint8Array, caps: Caps = DEFAULT_CAPS): ControllerFile {
  if (sniff(bytes) !== 'zip') throw new Refused('not a graphical controller file: expected a zip');
  const entries = listZip(bytes, caps);
  const total = { bytes: 0 };
  const get = (path: string) => { const e = entries.find((x) => x.name.toLowerCase() === path.toLowerCase()); return e ? decode(readZipEntry(bytes, e, caps, total)) : undefined; };
  const out: ControllerFile = { format: 'gfx', deviceName: '', points: [], unknownObjectTypes: {}, warnings: [], confidence: 'synthetic-only' };
  const tree = get('Config/IP/LogicalTree.json');
  if (!tree) throw new Refused('controller file has no Config/IP/LogicalTree.json');
  let json: unknown; try { json = JSON.parse(tree); } catch { throw new Refused('LogicalTree.json is not valid JSON'); }
  const objs: Array<{ objType: number; objInstance: number; name: string }> = []; findObjects(json, objs);
  const writable = new Map<string, boolean>(); const states = new Map<string, string[]>();
  const ip = get('Info/InternalPoints.xml');
  if (ip) {
    try {
      const doc = parseXml(ip, caps); out.warnings.push(...doc.warnings);
      (function walk(e: any) { if (e.attrs?.name && (e.attrs.writable !== undefined || e.children.some((c: any) => c.name === 'state'))) { if (e.attrs.writable !== undefined) writable.set(e.attrs.name, /^(true|1)$/i.test(e.attrs.writable)); const st = e.children.filter((c: any) => c.name === 'state').map((c: any) => c.text.trim()); if (st.length) states.set(e.attrs.name, st); } for (const c of e.children) walk(c); })(doc.root);
    } catch (e) { out.warnings.push(`InternalPoints.xml not read: ${(e as Error).message}`); }
  } else out.warnings.push('no Info/InternalPoints.xml; writability and state texts unknown');
  const pi = get('Info/ProjectInfo.xml');
  if (pi) { try { const doc = parseXml(pi, caps); let nm: string | undefined; (function walk(e: any) { if (!nm && e.name === 'Name' && e.text.trim()) nm = e.text.trim(); for (const c of e.children) walk(c); })(doc.root); if (nm) out.deviceName = nm; } catch { out.warnings.push('ProjectInfo.xml not read'); } }
  for (const o of objs) {
    const objectType = BACNET_OBJECT_TYPES[o.objType];
    if (!objectType) { out.unknownObjectTypes[`type ${o.objType}`] = (out.unknownObjectTypes[`type ${o.objType}`] ?? 0) + 1; continue; }
    if (objectType === 'device') { out.deviceInstance = o.objInstance; if (!out.deviceName) out.deviceName = o.name; continue; }
    const kind = kindOf(objectType);
    if (!kind) { out.unknownObjectTypes[objectType] = (out.unknownObjectTypes[objectType] ?? 0) + 1; continue; }
    const p: ControllerPoint = { name: o.name, kind, writable: writable.get(o.name) ?? isOutput(objectType), ref: { connector: 'bacnet-ip', objectType, instance: o.objInstance }, exposed: true, locator: `Config/IP/LogicalTree.json#${o.name}` };
    const st = states.get(o.name); if (st) p.states = st;
    out.points.push(p);
  }
  if (out.deviceInstance !== undefined) for (const p of out.points) p.ref.device = out.deviceInstance;
  else out.warnings.push('no device object in LogicalTree.json; points carry no device instance');
  return out;
}
