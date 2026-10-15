// The in-memory model behind the preview runtime. Everything here is derived from imported files and labeled.
import { correlate, refKey, sha256, Model, type NativeRef, type Reading, type Provenance, type DiscoveredNode } from '@archipelago/core';
import { inspect, applyStation, type InspectReport } from '@archipelago/importer-station-file';
import { parseControllerFile, type ControllerFile } from '@archipelago/importer-controller-file';
import { listZip, readZipEntry, sniff, Refused } from '@archipelago/importer-station-file';
import { Intake, type ReportSummary } from './intake.ts';

export interface Artifact { name: string; sha256: string; size: number; format: string; importedAt: string; kind: 'station' | 'controller' | 'document' }
export interface Document { sha256: string; name: string; mime: string; size: number; importedAt: string; kind: string; attachedTo: string | null; attachedToName?: string; by?: string }
export interface ControllerEntry { artifact: Artifact; file: ControllerFile; matchedDevice?: string; correlation: { matched: number; onlyController: Array<{ name: string; ref: NativeRef; kind: string; writable: boolean; exposed: boolean }>; onlyStation: Array<{ name: string; path: string }>; matchedPairs: Array<{ controller: string; station: string; path: string }> } }
export interface Question { id: string; subject: string; text: string; evidence: string[]; kind: 'unmatched-controller' | 'missing-points' | 'no-instance' | 'unknown-types' | 'warning'; options: string[]; /** entity path the question is about, for scoped permissions */ target?: string; answered?: { answer: string; by: string; at: string } }

export class EdgeModel {
  readonly model = new Model();
  readonly intake = new Intake(this.model);
  artifacts: Artifact[] = [];
  station: InspectReport | undefined;
  controllers: ControllerEntry[] = [];
  readings = new Map<string, Reading>();
  /** artifact bytes when running without a store (preview, in memory) */
  documentBytes = new Map<string, Uint8Array>();

  /** Drawings, submittals, sheets: recognised by content, kept as artifacts, attachable to entities. */
  static documentType(bytes: Uint8Array, name: string): { mime: string; format: string } | undefined {
    const head = (n: number) => new TextDecoder('latin1').decode(bytes.subarray(0, n));
    if (head(5) === '%PDF-') return { mime: 'application/pdf', format: 'pdf' };
    if (bytes[0] === 0x89 && head(4).slice(1) === 'PNG') return { mime: 'image/png', format: 'png' };
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return { mime: 'image/jpeg', format: 'jpeg' };
    if (head(4) === 'AC10') return { mime: 'application/acad', format: 'dwg' };
    if (/^\s*0\s*\r?\n\s*SECTION/.test(head(64))) return { mime: 'application/dxf', format: 'dxf' };
    if (/<svg[\s>]/.test(head(2048))) return { mime: 'image/svg+xml', format: 'svg' };
    if (/\.(pdf|png|jpe?g|dwg|dxf|svg)$/i.test(name)) return undefined; // claimed by extension but the bytes disagree: refuse below
    return undefined;
  }

  get documents(): Document[] {
    return this.model.live('document').map((e) => {
      const attachedTo = this.model.value<string | null>(e.id, 'attachedTo') ?? null;
      const cur = this.model.currentAssertion(e.id, 'attachedTo');
      const d: Document = { sha256: e.id.slice('document|'.length), name: e.name, mime: this.model.value<string>(e.id, 'mime') ?? 'application/octet-stream', size: this.model.value<number>(e.id, 'size') ?? 0, importedAt: this.model.value<string>(e.id, 'importedAt') ?? '', kind: this.model.value<string>(e.id, 'documentKind') ?? 'drawing', attachedTo };
      const name = attachedTo ? this.model.entities.get(attachedTo)?.name : undefined; if (name) d.attachedToName = name;
      if (cur?.provenance.kind === 'confirmed') d.by = cur.provenance.by;
      return d;
    });
  }
  attachDocument(sha256: string, entity: string | null, kind: string, by: string): Document | undefined {
    const id = `document|${sha256}`; if (!this.model.entities.has(id)) return undefined;
    if (entity && !this.model.entities.has(entity)) return undefined;
    const prov: Provenance = { kind: 'confirmed', by, at: new Date().toISOString() };
    this.model.assert(id, 'attachedTo', entity, prov); this.model.assert(id, 'documentKind', kind, prov);
    this.model.snapshot(`attach ${this.model.entities.get(id)!.name}`, this.artifacts.map((x) => x.sha256));
    return this.documents.find((d) => d.sha256 === sha256);
  }

  classify(bytes: Uint8Array, name = ''): 'station' | 'controller' | 'document' {
    if (EdgeModel.documentType(bytes, name)) return 'document';
    const c = sniff(bytes);
    if (c === 'gzip') return 'station';
    if (c === 'xml') { const head = new TextDecoder().decode(bytes.subarray(0, 4096)); return /<bajaObjectGraph/.test(head) ? 'station' : 'controller'; }
    if (c !== 'zip') throw new Refused('unrecognised file: not a station file, a controller file, a PDF, an image, a DXF or a DWG');
    const names = listZip(bytes).map((e) => e.name.toLowerCase());
    if (names.some((n) => n === 'file.xml' || /(^|\/)stations\/[^/]+\/config\.bog$/.test(n))) return 'station';
    if (names.some((n) => n === 'config/ip/logicaltree.json' || n.endsWith('.caf.xml'))) return 'controller';
    if (names.some((n) => n.endsWith('.xml'))) return 'controller';
    throw new Refused('zip is neither a station file nor a controller file');
  }

  import(name: string, bytes: Uint8Array, by = 'local'): Artifact {
    const before = this.model.snapshots[this.model.snapshots.length - 1];
    const a = this.importInner(name, bytes);
    const after = this.model.snapshots[this.model.snapshots.length - 1];
    let summary: ReportSummary | undefined;
    if (a.kind === 'station' && before && after && before.id !== after.id) summary = this.intake.report(before.id, after.id);
    const receipt = this.intake.record({ at: a.importedAt, by, name: a.name, sha256: a.sha256, size: a.size, artifactKind: a.kind, ...(summary ? { summary } : {}) });
    void receipt;
    return a;
  }
  private importInner(name: string, bytes: Uint8Array): Artifact {
    const kind = this.classify(bytes, name);
    const base = { name, sha256: sha256(bytes), size: bytes.length, importedAt: new Date().toISOString(), kind };
    if (kind === 'document') {
      const t = EdgeModel.documentType(bytes, name)!; const a = { ...base, format: t.format };
      const id = `document|${a.sha256}`; const imp = (locator: string): Provenance => ({ kind: 'imported', artifact: a.sha256, locator });
      this.model.addEntity({ id, kind: 'document', name, path: `/documents/${name}` });
      this.model.assert(id, 'mime', t.mime, imp(name)); this.model.assert(id, 'size', bytes.length, imp(name)); this.model.assert(id, 'importedAt', a.importedAt, imp(name));
      if (!this.model.currentAssertion(id, 'attachedTo')) this.model.assert(id, 'attachedTo', null, imp(name));
      this.artifacts = this.artifacts.filter((x) => x.sha256 !== a.sha256); this.artifacts.push(a);
      this.model.snapshot(`import ${name}`, this.artifacts.map((x) => x.sha256));
      return a;
    }
    if (kind === 'station') { const r = inspect(bytes); this.station = r; const a = { ...base, format: r.artifact.format }; this.artifacts = this.artifacts.filter((x) => x.kind !== 'station'); this.artifacts.push(a); applyStation(this.model, r, new Map(Object.entries(r.handles))); this.recorrelate(); this.model.snapshot(`import ${name}`, this.artifacts.map((x) => x.sha256)); return a; }
    const f = parseControllerFile(bytes);
    const a = { ...base, format: f.format };
    this.controllers = this.controllers.filter((c) => c.artifact.sha256 !== a.sha256);
    this.controllers.push({ artifact: a, file: f, correlation: { matched: 0, onlyController: [], onlyStation: [], matchedPairs: [] } });
    this.artifacts = this.artifacts.filter((x) => x.sha256 !== a.sha256); this.artifacts.push(a);
    this.recorrelate();
    const cid = `controller|${a.sha256}`; const imp = (locator: string): Provenance => ({ kind: 'imported', artifact: a.sha256, locator });
    this.model.addEntity({ id: cid, kind: 'program', name: a.name, path: a.name });
    this.model.assert(cid, 'format', f.format, imp(a.name)); this.model.assert(cid, 'deviceInstance', f.deviceInstance ?? null, imp(a.name)); this.model.assert(cid, 'points', f.points.length, imp(a.name));
    this.model.snapshot(`import ${name}`, this.artifacts.map((x) => x.sha256));
    return a;
  }

  /** Files that ride along inside a backup archive and are records in their own right: controller files, drawings. */
  nestedArtifacts(bytes: Uint8Array, max = 200): Array<{ name: string; bytes: Uint8Array }> {
    if (sniff(bytes) !== 'zip') return [];
    const out: Array<{ name: string; bytes: Uint8Array }> = []; const total = { bytes: 0 };
    for (const e of listZip(bytes)) {
      if (out.length >= max) break;
      if (!/\.(gfx|caf|pdf|png|jpe?g|dxf|dwg|svg)$/i.test(e.name) || /PreEditBackup/i.test(e.name)) continue;
      try { const b = readZipEntry(bytes, e, undefined, total); if (EdgeModel.documentType(b, e.name) || sniff(b) === 'zip' || sniff(b) === 'xml') out.push({ name: e.name, bytes: b }); } catch { /* skip an entry that does not read */ }
    }
    return out;
  }

  reset() { this.artifacts = []; this.station = undefined; this.controllers = []; this.readings.clear(); this.documentBytes.clear(); for (const e of this.model.live()) this.model.retire(e.id); }

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

  /** devices and objects seen live on the network, kept as observed entities (ADR 0006: read everything) */
  discovered: Array<{ instance: number; name: string; address: string; objects: Array<{ name: string; kind: string; units?: string; writable?: boolean; ref: NativeRef; inStation: boolean }> }> = [];
  observe(n: DiscoveredNode) {
    const prov: Provenance = { kind: 'observed', source: 'bacnet-ip', ref: refKey(n.ref), at: new Date().toISOString() };
    const inst = Number(n.ref.device);
    if (n.kind === 'device') {
      const id = `observed|device:${inst}`; this.model.addEntity({ id, kind: 'device', name: n.name, path: `/observed/${inst}` });
      this.model.assert(id, 'instance', inst, prov); this.model.assert(id, 'address', String(n.ref.address ?? ''), prov);
      if (!this.discovered.some((d) => d.instance === inst)) this.discovered.push({ instance: inst, name: n.name, address: String(n.ref.address ?? ''), objects: [] }); else { const d = this.discovered.find((x) => x.instance === inst)!; d.name = n.name; d.address = String(n.ref.address ?? ''); }
      return;
    }
    const d = this.discovered.find((x) => x.instance === inst); if (!d) return;
    const id = `observed|device:${inst}|${n.ref.objectType}:${n.ref.instance}`;
    this.model.addEntity({ id, kind: 'point', name: n.name, path: `/observed/${inst}/${n.name}`, parent: `observed|device:${inst}` });
    this.model.assert(id, 'kind', n.kind, prov); this.model.assert(id, 'binding', { connector: 'bacnet-ip', ...n.ref }, prov); if (n.units) this.model.assert(id, 'units', n.units, prov); if (n.writable !== undefined) this.model.assert(id, 'writable', n.writable, prov);
    const inStation = !!this.station?.station.points.find((p) => p.binding && p.binding.device === inst && p.binding.objectType === n.ref.objectType && p.binding.instance === n.ref.instance);
    const existing = d.objects.findIndex((o) => refKey(o.ref) === refKey(n.ref));
    const rec = { name: n.name, kind: n.kind, ...(n.units ? { units: n.units } : {}), ...(n.writable !== undefined ? { writable: n.writable } : {}), ref: n.ref, inStation };
    if (existing >= 0) d.objects[existing] = rec; else d.objects.push(rec);
  }

  /** every native address the model knows about: station bindings plus controller-only points */
  refs(): Array<{ ref: NativeRef; name: string; kind: string; units?: string; via: 'station' | 'controller'; subject: string }> {
    const out: Array<{ ref: NativeRef; name: string; kind: string; units?: string; via: 'station' | 'controller'; subject: string }> = [];
    for (const p of this.station?.station.points ?? []) if (p.binding) { const { connector: _c, ...ref } = p.binding; out.push({ ref, name: p.name, kind: p.kind, ...(p.units ? { units: p.units } : {}), via: 'station', subject: p.path }); }
    for (const c of this.controllers) for (const p of c.correlation.onlyController) out.push({ ref: p.ref, name: p.name, kind: p.kind, via: 'controller', subject: `${c.artifact.name}#${p.name}` });
    // station and controller refs carry no address; a discovered device of the same instance supplies it
    for (const r of out) if (r.ref.address === undefined) { const d = this.discovered.find((x) => x.instance === Number(r.ref.device)); if (d) r.ref = { ...r.ref, address: d.address }; }
    const seen = new Set(out.map((r) => refKey({ device: r.ref.device!, objectType: r.ref.objectType!, instance: r.ref.instance! })));
    for (const d of this.discovered) for (const o of d.objects) { const k = refKey({ device: o.ref.device!, objectType: o.ref.objectType!, instance: o.ref.instance! }); if (!seen.has(k)) { seen.add(k); out.push({ ref: o.ref, name: o.name, kind: o.kind, ...(o.units ? { units: o.units } : {}), via: 'station', subject: `observed|device:${d.instance}|${o.ref.objectType}:${o.ref.instance}` }); } }
    return out;
  }

  answer(questionId: string, answer: string, by: string): Question | undefined {
    const q = this.questions(true).find((x) => x.id === questionId); if (!q) return undefined;
    const subject = `question|${questionId}`;
    this.model.addEntity({ id: subject, kind: 'program', name: q.text.slice(0, 80), path: subject });
    this.model.assert(subject, 'answer', answer, { kind: 'confirmed', by, at: new Date().toISOString() });
    this.model.snapshot(`answer · ${q.kind} · ${q.subject}`, this.artifacts.map((x) => x.sha256));
    return this.questions(true).find((x) => x.id === questionId);
  }
  private answered(id: string) { const a = this.model.currentAssertion(`question|${id}`, 'answer'); return a && a.provenance.kind === 'confirmed' ? { answer: String(a.value), by: a.provenance.by, at: a.provenance.at } : undefined; }
  questions(includeAnswered = false): Question[] {
    const q: Question[] = [];
    const s = this.station?.station;
    for (const c of this.controllers) {
      const n = c.artifact.name;
      if (c.file.deviceInstance === undefined) q.push({ id: `noinst:${c.artifact.sha256}`, subject: n, kind: 'no-instance', text: `${n} declares no device instance, so it cannot be matched to a station device. Which device is it?`, evidence: [`format ${c.file.format}`, `${c.file.points.length} points`], options: (s?.devices ?? []).map((d) => d.name) });
      else if (s && !c.matchedDevice) q.push({ id: `unmatched:${c.artifact.sha256}`, subject: n, kind: 'unmatched-controller', target: '/', text: `${n} is device ${c.file.deviceInstance}, but no station device has that instance. Renumbered, not yet added, or a different trunk?`, evidence: [`station devices: ${s.devices.map((d) => `${d.name}=${d.instance ?? '?'}`).join(', ') || 'none'}`], options: ['Not on this station yet', 'Renumbered: it is one of the listed devices', 'Different trunk or supervisor'] });
      else if (c.correlation.onlyController.length) q.push({ id: `missing:${c.artifact.sha256}`, subject: n, kind: 'missing-points', target: c.matchedDevice ?? '/', text: `${c.correlation.onlyController.length} objects ${n} exposes are not in the station. Read them directly from the controller, or leave them?`, evidence: c.correlation.onlyController.map((p) => `${p.name} · ${p.ref.objectType}:${p.ref.instance}${p.exposed ? '' : ' · not exposed by the controller'}`), options: ['Read them directly from the controller', 'Leave them out'] });
    }
    if (s && Object.keys(s.unknownTypes).length) q.push({ id: 'unknown-types', subject: s.stationName, kind: 'unknown-types', text: `${Object.keys(s.unknownTypes).length} component types in the station are not understood. They were counted, not guessed.`, evidence: Object.entries(s.unknownTypes).slice(0, 12).map(([t, c]) => `${t} ×${c}`), options: ['Noted: they are vendor modules I expect', 'Flag for the importer'] });
    for (const c of this.controllers) if (Object.keys(c.file.unknownObjectTypes).length) q.push({ id: `unk:${c.artifact.sha256}`, subject: c.artifact.name, kind: 'unknown-types', text: `${c.artifact.name} has object types the importer does not map.`, evidence: Object.entries(c.file.unknownObjectTypes).map(([t, n]) => `${t} ×${n}`), options: ['Noted', 'Flag for the importer'] });
    for (const x of q) { const a = this.answered(x.id); if (a) x.answered = a; }
    return includeAnswered ? q : q.filter((x) => !x.answered);
  }

  snapshot() {
    const s = this.station;
    return {
      atoll: { name: 'Atoll preview', mode: 'local', storage: 'in-memory (preview)', connectors: [] as string[] },
      artifacts: this.artifacts,
      documents: this.documents,
      discovered: this.discovered,
      station: s ? { ...s.station, artifact: s.artifact, coverage: s.coverage, redactions: s.redactions, handles: s.handles, elapsedMs: s.elapsedMs } : null,
      controllers: this.controllers.map((c) => ({ artifact: c.artifact, deviceName: c.file.deviceName, deviceInstance: c.file.deviceInstance ?? null, format: c.file.format, confidence: c.file.confidence, points: c.file.points, warnings: c.file.warnings, unknownObjectTypes: c.file.unknownObjectTypes, matchedDevice: c.matchedDevice ?? null, correlation: c.correlation })),
      questions: this.questions(true),
      expectations: this.intake.expectations(),
      receipts: this.intake.receipts().slice().reverse(),
      overdue: this.intake.overdue(),
      snapshots: this.model.snapshots.map((x) => ({ id: x.id, at: x.at, label: x.label, entities: x.entityIds.length, assertions: x.assertionIds.length })),
      diff: this.model.snapshots.length >= 2 ? this.model.diff(this.model.snapshots[this.model.snapshots.length - 2]!.id, this.model.snapshots[this.model.snapshots.length - 1]!.id) : null,
      model: { entities: this.model.live().length, assertions: this.model.assertions.size, superseded: this.model.supersededBy.size },
      readings: Object.fromEntries([...this.readings.entries()]),
    };
  }
}
export { refKey };
