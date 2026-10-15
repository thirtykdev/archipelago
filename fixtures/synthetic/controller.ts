// Synthetic controller application files. Shapes follow the observations recorded in the importer; nothing
// here comes from a real controller or a real site.
import { zip, enc } from './station.ts';

export interface CtlOpts { name?: string; instance?: number; points?: Array<{ name: string; type: number; inst: number; exposed?: boolean; units?: number; states?: string[] }> }
export const DEFAULT_POINTS = [
  { name: 'ZN-T', type: 0, inst: 1, units: 64 },           // analogInput
  { name: 'DPR-O', type: 1, inst: 2, units: 98 },          // analogOutput
  { name: 'SF-S', type: 3, inst: 3, states: ['Off', 'On'] }, // binaryInput
  { name: 'MODE', type: 19, inst: 4, states: ['Occ', 'Unocc', 'Standby'] }, // multiStateValue
  { name: 'SF-C', type: 4, inst: 5, states: ['Off', 'On'] }, // binaryOutput
  { name: 'DA-T', type: 0, inst: 6, units: 64 },
  { name: 'HTG-O', type: 1, inst: 7, units: 98 },            // exposed by the controller, often not pulled in
  { name: 'CLG-MAXFLOW', type: 2, inst: 8, exposed: false }, // analogValue, not exposed
];

/** A controller application file document: vendor-flavoured XML with numbered properties. */
export function cafXml(o: CtlOpts = {}): string {
  const name = o.name ?? 'VAV_01', inst = o.instance ?? 2001, pts = o.points ?? DEFAULT_POINTS;
  const obj = (body: string, classid: string) => `  <m:object classid="${classid}">\n${body}\n  </m:object>`;
  const prop = (id: number, data: string) => `    <m:property id="${id}"><m:data>${data}</m:data></m:property>`;
  const parts = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<m:application xmlns:m="urn:synthetic:controller-application">`,
    obj([prop(2390, `<m:string>${name}</m:string>`), prop(75, `<m:BACoid id="8">${inst}</m:BACoid>`)].join('\n'), 'DEVICE'),
  ];
  for (const p of pts) {
    const body = [prop(2390, `<m:string>${p.name}</m:string>`), prop(75, `<m:BACoid id="${p.type}">${p.inst}</m:BACoid>`), prop(3807, `<m:boolean>${p.exposed === false ? 'false' : 'true'}</m:boolean>`)];
    if (p.units !== undefined) body.push(prop(117, `<m:enum set="507">${p.units}</m:enum>`));
    if (p.states) body.push(prop(110, `<m:list>${p.states.map((s) => `<m:string>${s}</m:string>`).join('')}</m:list>`));
    parts.push(obj(body.join('\n'), 'POINT'));
  }
  parts.push(`</m:application>`);
  return parts.join('\n') + '\n';
}
export function caf(o: CtlOpts = {}): Uint8Array { return zip([{ name: `${o.name ?? 'VAV_01'}.caf.xml`, data: enc(cafXml(o)) }]); }

/** A graphical controller file: a zip with a JSON object tree, an internal-points XML and a UTF-16 project info. */
export function gfx(o: CtlOpts = {}): Uint8Array {
  const name = o.name ?? 'VAV_01', inst = o.instance ?? 2001, pts = o.points ?? DEFAULT_POINTS;
  const tree = { Root: { Objects: [{ objType: 8, objInstance: inst, name }, ...pts.map((p) => ({ objType: p.type, objInstance: p.inst, name: p.name.replace(/-/g, '_') }))] } };
  const ip = `<?xml version="1.0"?>\n<points>\n${pts.map((p) => `  <point name="${p.name.replace(/-/g, '_')}" writable="${p.type === 1 || p.type === 4 ? 'true' : 'false'}">${(p.states ?? []).map((s) => `<state>${s}</state>`).join('')}</point>`).join('\n')}\n</points>\n`;
  const piText = `<?xml version="1.0" encoding="UTF-16"?>\n<Project><Name>${name}</Name></Project>\n`;
  const pi = new Uint8Array(2 + piText.length * 2); pi[0] = 0xff; pi[1] = 0xfe; for (let i = 0; i < piText.length; i++) { const c = piText.charCodeAt(i); pi[2 + i * 2] = c & 0xff; pi[3 + i * 2] = c >> 8; }
  return zip([
    { name: 'Config/IP/LogicalTree.json', data: enc(JSON.stringify(tree)) },
    { name: 'Info/InternalPoints.xml', data: enc(ip) },
    { name: 'Info/ProjectInfo.xml', data: pi },
    { name: 'Resources/.keep', data: enc('') },
  ]);
}
