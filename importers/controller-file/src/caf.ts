// A controller application file: a zip holding one XML document (observed name pattern <name>.caf.xml) of
// <object> elements, each with <property id="N"> children whose <data> holds a typed value.
// Property ids used here are recorded from observation and are validated on synthetic fixtures only:
//   2390 name · 75 object identifier (id attribute = object type number, text = instance) · 3807 exposed to the
//   supervisor · 117 units (vendor unit enumeration, not the standard one) · 110 state texts.
// Anything else is ignored and the object types we cannot classify are reported, not guessed.
import { listZip, readZipEntry, parseXml, sniff, DEFAULT_CAPS, Refused, type Caps } from '@archipelago/importer-station-file';
import type { XmlElement } from '../../station-file/src/xml.ts';
import { BACNET_OBJECT_TYPES, kindOf, isOutput, type ControllerFile, type ControllerPoint } from './model.ts';

const local = (n: string) => n.includes(':') ? n.slice(n.indexOf(':') + 1) : n;
const kids = (e: XmlElement, name: string) => e.children.filter((c) => local(c.name) === name);
const prop = (obj: XmlElement, id: string) => kids(obj, 'property').find((p) => p.attrs.id === id);
const firstData = (p: XmlElement | undefined): XmlElement | undefined => { if (!p) return undefined; const d = kids(p, 'data')[0]; return d?.children[0]; };
const dec = (b: Uint8Array) => new TextDecoder('utf-8', { fatal: false }).decode(b);

export function readCafText(bytes: Uint8Array, caps: Caps = DEFAULT_CAPS): { xml: string; entry?: string } {
  switch (sniff(bytes)) {
    case 'xml': return { xml: dec(bytes) };
    case 'zip': {
      const entries = listZip(bytes, caps);
      const e = entries.find((x) => /\.caf\.xml$/i.test(x.name)) ?? entries.find((x) => /\.xml$/i.test(x.name));
      if (!e) throw new Refused('controller file zip holds no XML document');
      return { xml: dec(readZipEntry(bytes, e, caps)), entry: e.name };
    }
    default: throw new Refused('not a controller application file: expected a zip or an XML document');
  }
}

export function parseCaf(bytes: Uint8Array, caps: Caps = DEFAULT_CAPS): ControllerFile {
  const { xml, entry } = readCafText(bytes, caps);
  const doc = parseXml(xml, caps);
  const out: ControllerFile = { format: 'caf', deviceName: '', points: [], unknownObjectTypes: {}, warnings: [...doc.warnings], confidence: 'synthetic-only' };
  const objects: XmlElement[] = [];
  (function walk(e: XmlElement) { if (local(e.name) === 'object') objects.push(e); for (const c of e.children) walk(c); })(doc.root);
  if (!objects.length) out.warnings.push('no <object> elements found');
  let n = 0;
  for (const obj of objects) {
    n++;
    const locator = `${entry ?? 'caf.xml'}#object[${n}]`;
    const name = firstData(prop(obj, '2390'))?.text.trim() ?? obj.attrs.name ?? '';
    const oid = firstData(prop(obj, '75'));
    if (!oid) continue; // not a BACnet-addressable object
    const typeNum = Number(oid.attrs.id); const inst = Number(oid.text.trim());
    const objectType = BACNET_OBJECT_TYPES[typeNum];
    if (!objectType || !Number.isFinite(inst)) { out.unknownObjectTypes[`type ${oid.attrs.id ?? '?'}`] = (out.unknownObjectTypes[`type ${oid.attrs.id ?? '?'}`] ?? 0) + 1; continue; }
    if (objectType === 'device') { out.deviceInstance = inst; if (!out.deviceName) out.deviceName = name; continue; }
    const kind = kindOf(objectType);
    if (!kind) { out.unknownObjectTypes[objectType] = (out.unknownObjectTypes[objectType] ?? 0) + 1; continue; }
    const exposedText = firstData(prop(obj, '3807'))?.text.trim().toLowerCase();
    const exposed = exposedText === undefined ? true : exposedText === 'true' || exposedText === '1';
    const unitsNode = firstData(prop(obj, '117'));
    const states = kids(firstData(prop(obj, '110')) ?? { name: '', attrs: {}, children: [], text: '', line: 0 }, 'string').map((s) => s.text.trim());
    const p: ControllerPoint = { name, kind, writable: isOutput(objectType), ref: { connector: 'bacnet-ip', objectType, instance: inst }, exposed, locator };
    if (out.deviceInstance !== undefined) p.ref.device = out.deviceInstance;
    if (unitsNode) p.units = `unit set ${unitsNode.attrs.set ?? '?'} code ${unitsNode.text.trim()}`;
    if (states.length) p.states = states;
    out.points.push(p);
  }
  // device instance is often declared after points: back-fill
  if (out.deviceInstance !== undefined) for (const p of out.points) p.ref.device = out.deviceInstance;
  else out.warnings.push('no device object found; points carry no device instance and cannot be correlated with a station device');
  return out;
}
