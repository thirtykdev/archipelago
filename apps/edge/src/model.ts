// The in-memory model behind the preview runtime. Everything here is derived from imported files and labeled.
import { correlate, refKey, sha256, type NativeRef, type Reading } from '@archipelago/core';
import { inspect, type InspectReport } from '@archipelago/importer-station-file';
import { parseControllerFile, type ControllerFile } from '@archipelago/importer-controller-file';
import { listZip, sniff, Refused } from '@archipelago/importer-station-file';

export interface Artifact { name: string; sha256: string; size: number; format: string; importedAt: string; kind: 'station' | 'controller' }
export interface ControllerEntry { artifact: Artifact; file: ControllerFile; matchedDevice?: string; correlation: { matched: number; onlyController: Array<{ name: string; ref: NativeRef; kind: string; writable: boolean; exposed: boolean }>; onlyStation: Array<{ name: string; path: string }>; matchedPairs: Array<{ controller: string; station: string; path: string }> } }
export interface Question { id: string; subject: string; text: string; evidence: string[]; kind: 'unmatched-controller' | 'missing-points' | 'no-instance' | 'unknown-types' | 'warning' }

export class EdgeModel {
  artifacts: Artifact[] = [];
  station: InspectReport | undefined;
  controllers: ControllerEntry[] = [];
  readings = new Map<string, Reading>();

  classify(bytes: Uint8Array): 'station' | 'controller' {
    const c = sniff(bytes);
    if (c === 'gzip') return 'station';
    if (c === 'xml') { const head = new TextDecoder().decode(bytes.subarray(0, 4096)); return /<bajaObjectGraph/.test(head) ? 'station' : 'controller'; }
    if (c !== 'zip') throw new Refused('unrecognised file: not a zip, gzip or XML document');
    const names = listZip(bytes).map((e) => e.name.toLowerCase());
    if (names.some((n) => n === 'file.xml' || /(^|\/)stations\/[^/]+\/config\.bog$/.test(n))) return 'station';
    if (names.some((n) => n === 'config/ip/logicaltree.json' || n.endsWith('.caf.xml'))) return 'controller';
    if (names.some((n) => n.endsWith('.xml'))) return 'controller';
    throw new Refused('zip is neither a station file nor a controller file');
  }

  import(name: string, bytes: Uint8Array): Artifact {
    const kind = this.classify(bytes);
    const base = { name, sha256: sha256(bytes), size: bytes.length, importedAt: new Date().toISOString(), kind };
    if (kind === 'station') { const r = inspect(bytes); this.station = r; const a = { ...base, format: r.artifact.format }; this.artifacts = this.artifacts.filter((x) => x.kind !== 'station'); this.artifacts.push(a); this.recorrelate(); return a; }
    const f = parseControllerFile(bytes);
    const a = { ...base, format: f.format };
    this.controllers = this.controllers.filter((c) => c.artifact.sha256 !== a.sha256);
    this.controllers.push({ artifact: a, file: f, correlation: { matched: 0, onlyController: [], onlyStation: [], matchedPairs: [] } });
    this.artifacts = this.artifacts.filter((x) => x.sha256 !== a.sha256); this.artifacts.push(a);
    this.recorrelate();
    return a;
  }

  reset() { this.artifacts = []; this.station = undefined; this.controllers = []; this.readings.clear(); }

  recorrelate() {
    for (const c of this.controllers) {
      const inst = c.file.deviceInstance;
      const dev = inst === undefined ? undefined : this.station?.station.devices.find((d) => d.instance === inst);
      if (dev) c.matchedDevice = dev.path; else delete c.matchedDevice;
      const sp = (this.station?.station.points ?? []).filter((p) => p.binding && dev && p.device === dev.path).map((p) => ({ id: p.path, name: p.name, ref: { device: p.binding!.device!, objectType: p.binding!.objectType!, instance: p.binding!.instance! } }));
      const cp = c.file.points.map((p) => ({ id: p.locator, name: p.name, ref: { device: p.ref.device ?? -1, objectType: p.ref.objectType!, instance: p.ref.instance! }, kind: p.kind, writable: p.writable, exposed: p.exposed }));
      const r = correlate(sp, cp);
      c.correlation = {
        matched: r.matched.length,
        matchedPairs: r.matched.map((m) => ({ controller: m.b.name, station: m.a.name, path: m.a.id })),
        onlyController: r.onlyB.map((p) => ({ name: p.name, ref: p.ref, kind: p.kind, writable: p.writable, exposed: p.exposed })),
        onlyStation: r.onlyA.map((p) => ({ name: p.name, path: p.id })),
      };
    }
  }

  /** every native address the model knows about: station bindings plus controller-only points */
  refs(): Array<{ ref: NativeRef; name: string; kind: string; units?: string; via: 'station' | 'controller'; subject: string }> {
    const out: Array<{ ref: NativeRef; name: string; kind: string; units?: string; via: 'station' | 'controller'; subject: string }> = [];
    for (const p of this.station?.station.points ?? []) if (p.binding) { const { connector: _c, ...ref } = p.binding; out.push({ ref, name: p.name, kind: p.kind, ...(p.units ? { units: p.units } : {}), via: 'station', subject: p.path }); }
    for (const c of this.controllers) for (const p of c.correlation.onlyController) out.push({ ref: p.ref, name: p.name, kind: p.kind, via: 'controller', subject: `${c.artifact.name}#${p.name}` });
    return out;
  }

  questions(): Question[] {
    const q: Question[] = [];
    const s = this.station?.station;
    for (const c of this.controllers) {
      const n = c.artifact.name;
      if (c.file.deviceInstance === undefined) q.push({ id: `noinst:${c.artifact.sha256}`, subject: n, kind: 'no-instance', text: `${n} declares no device instance, so it cannot be matched to a station device. Which device is it?`, evidence: [`format ${c.file.format}`, `${c.file.points.length} points`] });
      else if (s && !c.matchedDevice) q.push({ id: `unmatched:${c.artifact.sha256}`, subject: n, kind: 'unmatched-controller', text: `${n} is device ${c.file.deviceInstance}, but no station device has that instance. Renumbered, not yet added, or a different trunk?`, evidence: [`station devices: ${s.devices.map((d) => `${d.name}=${d.instance ?? '?'}`).join(', ') || 'none'}`] });
      else if (c.correlation.onlyController.length) q.push({ id: `missing:${c.artifact.sha256}`, subject: n, kind: 'missing-points', text: `${c.correlation.onlyController.length} objects ${n} exposes are not in the station. Read them directly from the controller, or leave them?`, evidence: c.correlation.onlyController.map((p) => `${p.name} · ${p.ref.objectType}:${p.ref.instance}${p.exposed ? '' : ' · not exposed by the controller'}`) });
    }
    if (s && Object.keys(s.unknownTypes).length) q.push({ id: 'unknown-types', subject: s.stationName, kind: 'unknown-types', text: `${Object.keys(s.unknownTypes).length} component types in the station are not understood. They were counted, not guessed.`, evidence: Object.entries(s.unknownTypes).slice(0, 12).map(([t, c]) => `${t} ×${c}`) });
    for (const c of this.controllers) if (Object.keys(c.file.unknownObjectTypes).length) q.push({ id: `unk:${c.artifact.sha256}`, subject: c.artifact.name, kind: 'unknown-types', text: `${c.artifact.name} has object types the importer does not map.`, evidence: Object.entries(c.file.unknownObjectTypes).map(([t, n]) => `${t} ×${n}`) });
    return q;
  }

  snapshot() {
    const s = this.station;
    return {
      atoll: { name: 'Atoll preview', mode: 'local', storage: 'in-memory (preview)', connectors: [] as string[] },
      artifacts: this.artifacts,
      station: s ? { ...s.station, artifact: s.artifact, coverage: s.coverage, redactions: s.redactions, elapsedMs: s.elapsedMs } : null,
      controllers: this.controllers.map((c) => ({ artifact: c.artifact, deviceName: c.file.deviceName, deviceInstance: c.file.deviceInstance ?? null, format: c.file.format, confidence: c.file.confidence, points: c.file.points, warnings: c.file.warnings, unknownObjectTypes: c.file.unknownObjectTypes, matchedDevice: c.matchedDevice ?? null, correlation: c.correlation })),
      questions: this.questions(),
      readings: Object.fromEntries([...this.readings.entries()]),
    };
  }
}
export { refKey };
