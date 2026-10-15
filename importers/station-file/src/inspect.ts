// `inspect`: open a station file safely and report what it contains. Reads nothing but the bytes it is given.
import { sha256 } from '@archipelago/core';
import type { Redaction } from '@archipelago/core';
import { Caps, DEFAULT_CAPS, Refused } from './caps.ts';
import { sniff } from './sniff.ts';
import { listZip, readZipEntry, gunzipBounded } from './archive.ts';
import { parseXml } from './xml.ts';
import { toGraph, walk } from './graph.ts';
import { redactGraph } from './redact.ts';
import { mapStation, type StationModel } from './niagara.ts';

export interface InspectReport {
  artifact: { sha256: string; size: number; format: 'bog-zip' | 'bog-gzip' | 'bog-xml' | 'dist' };
  entry?: string;
  station: StationModel;
  redactions: Redaction[];
  /** path -> persisted handle, for identity across imports */
  handles: Record<string, string>;
  coverage: Record<string, { have: number; of: number }>;
  elapsedMs: number;
}

/** Pull the object-graph XML out of whatever container it came in. */
export function openStationFile(bytes: Uint8Array, caps: Caps = DEFAULT_CAPS): { xml: string; format: InspectReport['artifact']['format']; entry?: string } {
  const dec = (b: Uint8Array) => new TextDecoder('utf-8', { fatal: false }).decode(b);
  switch (sniff(bytes)) {
    case 'xml': return { xml: dec(bytes), format: 'bog-xml' };
    case 'gzip': return { xml: dec(gunzipBounded(bytes, caps)), format: 'bog-gzip' };
    case 'zip': {
      const entries = listZip(bytes, caps);
      const total = { bytes: 0 };
      // a backup: a tree holding stations/<name>/config.bog (itself a zip or xml)
      const cfg = entries.filter((e) => /(^|\/)stations\/[^/]+\/config\.bog$/.test(e.name) && !/PreEditBackup/i.test(e.name)).sort((a, b) => a.name.length - b.name.length)[0];
      if (cfg) { const inner = readZipEntry(bytes, cfg, caps, total); const o = openStationFile(inner, caps); return { xml: o.xml, format: 'dist', entry: cfg.name }; }
      const xml = entries.find((e) => /^file\.xml$/i.test(e.name)) ?? entries.find((e) => /\.xml$/i.test(e.name));
      if (!xml) throw new Refused(`zip holds no object graph (entries: ${entries.slice(0, 5).map((e) => e.name).join(', ')}${entries.length > 5 ? ', …' : ''})`);
      return { xml: dec(readZipEntry(bytes, xml, caps, total)), format: 'bog-zip', entry: xml.name };
    }
    default: throw new Refused('unrecognised file: not a zip, gzip or XML document');
  }
}

export function inspect(bytes: Uint8Array, caps: Caps = DEFAULT_CAPS): InspectReport {
  const t0 = performance.now();
  const opened = openStationFile(bytes, caps);
  const doc = parseXml(opened.xml, caps);
  const graph = toGraph(doc.root);
  const redactions = redactGraph(graph.root);
  const artifact = { sha256: sha256(bytes), size: bytes.length, format: opened.format };
  const station = mapStation(graph, artifact.sha256);
  const handles: Record<string, string> = {}; for (const n of walk(graph.root)) if (n.handle) handles[n.path] = n.handle;
  station.warnings.push(...doc.warnings.slice(0, 20));
  if (doc.warnings.length > 20) station.warnings.push(`… ${doc.warnings.length - 20} more XML warnings`);
  const pts = station.points.length;
  const coverage = {
    'points attached to a device': { have: station.points.filter((p) => p.device).length, of: pts },
    'points with a native address': { have: station.points.filter((p) => p.binding).length, of: pts },
    'devices with an instance number': { have: station.devices.filter((d) => d.instance !== undefined).length, of: station.devices.length },
    'components of a known type': { have: Object.values(station.knownTypes).reduce((a, b) => a + b, 0), of: Object.values(station.knownTypes).reduce((a, b) => a + b, 0) + Object.values(station.unknownTypes).reduce((a, b) => a + b, 0) },
  };
  return { artifact, ...(opened.entry ? { entry: opened.entry } : {}), station, redactions, handles, coverage, elapsedMs: Math.round(performance.now() - t0) };
}

export function renderText(r: InspectReport): string {
  const s = r.station;
  const pct = (c: { have: number; of: number }) => c.of ? `${c.have}/${c.of} (${Math.round((100 * c.have) / c.of)}%)` : '0/0';
  const byKind: Record<string, number> = {}; for (const p of s.points) byKind[p.kind + (p.writable ? ' writable' : '')] = (byKind[p.kind + (p.writable ? ' writable' : '')] ?? 0) + 1;
  const lines = [
    `Archipelago inspect`,
    `  artifact    ${r.artifact.format}${r.entry ? ` · ${r.entry}` : ''} · ${r.artifact.size} bytes · sha256 ${r.artifact.sha256.slice(0, 16)}…`,
    `  station     ${s.stationName || '(unnamed)'} · graph version ${s.version || '?'} · ${s.components} components · ${r.elapsedMs} ms`,
    ``,
    `  networks    ${s.networks.length}${s.networks.length ? ': ' + s.networks.map((n) => `${n.name} (${n.type}, ${n.devices} devices)`).join(', ') : ''}`,
    `  devices     ${s.devices.length}`,
    ...s.devices.slice(0, 40).map((d) => `              ${d.name.padEnd(24)} ${d.type.padEnd(28)} ${d.instance !== undefined ? `instance ${d.instance}` : 'no instance'}${d.address ? ` · ${d.address}` : ''} · ${d.points} points`),
    ...(s.devices.length > 40 ? [`              … ${s.devices.length - 40} more`] : []),
    `  points      ${s.points.length}${Object.keys(byKind).length ? ': ' + Object.entries(byKind).map(([k, v]) => `${v} ${k}`).join(', ') : ''}`,
    `  histories   ${s.extensions.filter((e) => e.kind === 'history').length}`,
    `  alarms      ${s.extensions.filter((e) => e.kind === 'alarm').length}`,
    `  links       ${s.links}`,
    ``,
    `  coverage`,
    ...Object.entries(r.coverage).map(([k, v]) => `              ${k.padEnd(34)} ${pct(v)}`),
    ``,
    `  redacted    ${r.redactions.length}${r.redactions.length ? ': ' + r.redactions.slice(0, 5).map((x) => `${x.kind} at ${x.locator}`).join('; ') + (r.redactions.length > 5 ? '; …' : '') : ''} (values never read)`,
    `  unknown types ${Object.keys(s.unknownTypes).length}${Object.keys(s.unknownTypes).length ? ': ' + Object.entries(s.unknownTypes).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t, c]) => `${t} ×${c}`).join(', ') : ''}`,
    ...(s.warnings.length ? [``, `  warnings`, ...s.warnings.slice(0, 10).map((w) => `              ${w}`)] : []),
  ];
  return lines.join('\n');
}
