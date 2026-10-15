// Intake with accountability: what a site should have on file, who owes it, how often; a receipt for every
// delivery with what changed since the previous one; an overdue list. All of it is facts in the model.
import { Model, type Provenance, type Diff } from '@archipelago/core';

export type ExpectKind = 'station-backup' | 'controller-file' | 'drawing' | 'submittal' | 'sequence' | 'commissioning-report' | 'other';
export interface Expectation { id: string; label: string; kind: ExpectKind; owedBy: string; cadenceDays: number | null; match?: string; createdBy: string; createdAt: string; retired?: boolean }
export interface Receipt { id: string; at: string; by: string; name: string; sha256: string; size: number; artifactKind: string; expectation?: string; previous?: string; summary?: ReportSummary; onTime?: boolean }
export interface ReportLine { kind: 'setpoint' | 'alarm-disabled' | 'alarm-enabled' | 'alarm-limit' | 'history-disabled' | 'history-enabled' | 'renamed' | 'removed' | 'added' | 'rebound' | 'other'; text: string; entity: string }
export interface ReportSummary { from: string; to: string; counts: Record<string, number>; lines: ReportLine[] }
export interface Overdue { expectation: Expectation; lastDelivery?: Receipt; dueAt?: string; daysLate: number; status: 'never' | 'late' | 'ok' | 'no-cadence' }

const artifactKindFor: Record<ExpectKind, string> = { 'station-backup': 'station', 'controller-file': 'controller', drawing: 'document', submittal: 'document', sequence: 'document', 'commissioning-report': 'document', other: '*' };

export class Intake {
  constructor(private model: Model) {}
  private conf = (by: string): Provenance => ({ kind: 'confirmed', by, at: new Date().toISOString() });

  expectations(): Expectation[] { return this.model.live('program').filter((e) => e.id.startsWith('expect|')).map((e) => this.model.value<Expectation>(e.id, 'expectation')!).filter(Boolean); }
  setExpectation(x: Omit<Expectation, 'createdBy' | 'createdAt'> & Partial<Expectation>, by: string): Expectation {
    const id = x.id || `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`; const sid = `expect|${id}`;
    const prev = this.model.value<Expectation>(sid, 'expectation');
    const full: Expectation = { id, label: x.label, kind: x.kind, owedBy: x.owedBy, cadenceDays: x.cadenceDays ?? null, ...(x.match ? { match: x.match } : {}), createdBy: prev?.createdBy ?? by, createdAt: prev?.createdAt ?? new Date().toISOString() };
    this.model.addEntity({ id: sid, kind: 'program', name: full.label, path: sid });
    this.model.assert(sid, 'expectation', full, this.conf(by));
    return full;
  }
  removeExpectation(id: string) { this.model.retire(`expect|${id}`); }

  receipts(): Receipt[] { return this.model.live('program').filter((e) => e.id.startsWith('receipt|')).map((e) => this.model.value<Receipt>(e.id, 'receipt')!).filter(Boolean).sort((a, b) => a.at.localeCompare(b.at)); }

  /** Which expectation a delivery satisfies: by artifact kind, then by an optional name match (substring or /regex/). */
  matchExpectation(name: string, artifactKind: string): Expectation | undefined {
    const cands = this.expectations().filter((x) => artifactKindFor[x.kind] === '*' || artifactKindFor[x.kind] === artifactKind);
    const named = cands.filter((x) => x.match && (x.match.startsWith('/') && x.match.endsWith('/') ? new RegExp(x.match.slice(1, -1), 'i').test(name) : name.toLowerCase().includes(x.match.toLowerCase())));
    if (named.length) return named[0];
    return cands.find((x) => !x.match);
  }

  record(r: Omit<Receipt, 'id' | 'expectation' | 'previous' | 'onTime'> & { summary?: ReportSummary }): Receipt {
    const exp = this.matchExpectation(r.name, r.artifactKind);
    const prevs = this.receipts().filter((p) => exp ? p.expectation === exp.id : p.name === r.name);
    const prev = prevs[prevs.length - 1];
    const id = `${r.sha256.slice(0, 12)}-${Date.parse(r.at).toString(36)}`;
    const rec: Receipt = { id, ...r, ...(exp ? { expectation: exp.id } : {}), ...(prev ? { previous: prev.id } : {}) };
    if (exp && exp.cadenceDays) { const due = prev ? Date.parse(prev.at) + exp.cadenceDays * 86400e3 : Date.parse(exp.createdAt) + exp.cadenceDays * 86400e3; rec.onTime = Date.parse(r.at) <= due; }
    const sid = `receipt|${id}`;
    this.model.addEntity({ id: sid, kind: 'program', name: `${r.name} · ${r.at}`, path: sid });
    this.model.assert(sid, 'receipt', rec, { kind: 'imported', artifact: r.sha256, locator: r.name });
    return rec;
  }

  overdue(now = Date.now()): Overdue[] {
    const rs = this.receipts();
    return this.expectations().map((x) => {
      const mine = rs.filter((r) => r.expectation === x.id); const last = mine[mine.length - 1];
      if (!x.cadenceDays) return { expectation: x, ...(last ? { lastDelivery: last } : {}), daysLate: last ? 0 : Math.floor((now - Date.parse(x.createdAt)) / 86400e3), status: last ? 'ok' : 'never' } as Overdue;
      const dueAt = new Date((last ? Date.parse(last.at) : Date.parse(x.createdAt)) + x.cadenceDays * 86400e3).toISOString();
      const late = Math.floor((now - Date.parse(dueAt)) / 86400e3);
      return { expectation: x, ...(last ? { lastDelivery: last } : {}), dueAt, daysLate: Math.max(0, late), status: !last ? 'never' : late > 0 ? 'late' : 'ok' } as Overdue;
    }).sort((a, b) => b.daysLate - a.daysLate);
  }

  /** A diff, said in controls language. */
  report(from: string, to: string): ReportSummary {
    const d: Diff = this.model.diff(from, to);
    const lines: ReportLine[] = [];
    const name = (id: string) => this.model.entities.get(id)?.name ?? id;
    const pathOf = (id: string) => this.model.entities.get(id)?.path ?? id;
    const parentName = (id: string) => { const p = this.model.entities.get(id)?.parent; return p ? name(p) : ''; };
    for (const c of d.changed) {
      const e = this.model.entities.get(c.subject); const ctx = e?.kind === 'extension' ? `${parentName(c.subject)} · ${name(c.subject)}` : e?.kind === 'point' ? `${parentName(c.subject)} · ${name(c.subject)}` : name(c.subject);
      if (c.key === 'name') lines.push({ kind: 'renamed', entity: c.subject, text: `${e?.kind ?? 'component'} renamed: ${c.from ?? '—'} → ${c.to ?? '—'}` });
      else if (c.key === 'path') { if ((e?.kind === 'device' || e?.kind === 'network') && this.model.value(c.subject, 'name') === (this.model.history(c.subject, 'name')[1]?.value ?? this.model.value(c.subject, 'name'))) lines.push({ kind: 'other', entity: c.subject, text: `${ctx}: moved ${c.from ?? '—'} → ${c.to ?? '—'}` }); }
      else if (c.key === 'fallback') lines.push({ kind: 'setpoint', entity: c.subject, text: `${ctx}: setpoint ${c.from ?? '—'} → ${c.to ?? '—'}` });
      else if (c.key === 'inhibited') lines.push({ kind: c.to === true ? 'alarm-disabled' : 'alarm-enabled', entity: c.subject, text: `${ctx}: alarm ${c.to === true ? 'inhibited' : 're-enabled'}` });
      else if (c.key === 'enabled') lines.push({ kind: c.to === false ? 'history-disabled' : 'history-enabled', entity: c.subject, text: `${ctx}: history ${c.to === false ? 'disabled' : 'enabled'}` });
      else if (c.key === 'highLimit' || c.key === 'lowLimit') lines.push({ kind: 'alarm-limit', entity: c.subject, text: `${ctx}: ${c.key === 'highLimit' ? 'high' : 'low'} limit ${c.from ?? '—'} → ${c.to ?? '—'}` });
      else if (c.key === 'binding') lines.push({ kind: 'rebound', entity: c.subject, text: `${ctx}: address changed` });
      else if (c.key === 'alarmClass') lines.push({ kind: 'other', entity: c.subject, text: `${ctx}: alarm class ${c.from ?? '—'} → ${c.to ?? '—'}` });
      else if (['units', 'kind', 'writable', 'instance', 'address', 'type'].includes(c.key)) lines.push({ kind: 'other', entity: c.subject, text: `${ctx}: ${c.key} ${JSON.stringify(c.from) ?? '—'} → ${JSON.stringify(c.to) ?? '—'}` });
    }
    for (const r of d.renamed) lines.push({ kind: 'renamed', entity: r.to, text: `${name(r.from)} is now ${r.entity.name} (${r.entity.kind})` });
    for (const e of d.removed) if (e.kind === 'device' || e.kind === 'point' || e.kind === 'network') lines.push({ kind: 'removed', entity: e.id, text: `${e.kind} removed: ${e.name} (${pathOf(e.id)})` });
    for (const e of d.added) if (e.kind === 'device' || e.kind === 'point' || e.kind === 'network') lines.push({ kind: 'added', entity: e.id, text: `${e.kind} added: ${e.name} (${pathOf(e.id)})` });
    const counts: Record<string, number> = {}; for (const l of lines) counts[l.kind] = (counts[l.kind] ?? 0) + 1;
    return { from, to, counts, lines };
  }
}
export function renderReport(r: ReportSummary, label: { from: string; to: string }): string {
  const order: ReportLine['kind'][] = ['setpoint', 'alarm-disabled', 'alarm-enabled', 'alarm-limit', 'history-disabled', 'history-enabled', 'removed', 'added', 'renamed', 'rebound', 'other'];
  const title: Record<ReportLine['kind'], string> = { setpoint: 'Setpoints changed', 'alarm-disabled': 'Alarms inhibited', 'alarm-enabled': 'Alarms re-enabled', 'alarm-limit': 'Alarm limits changed', 'history-disabled': 'Histories disabled', 'history-enabled': 'Histories enabled', removed: 'Removed', added: 'Added', renamed: 'Renamed', rebound: 'Addresses changed', other: 'Other configuration' };
  const out = [`Change report`, `  from  ${label.from}`, `  to    ${label.to}`, `  ${r.lines.length} change${r.lines.length === 1 ? '' : 's'}`, ''];
  for (const k of order) { const ls = r.lines.filter((l) => l.kind === k); if (!ls.length) continue; out.push(`${title[k]} (${ls.length})`); for (const l of ls) out.push(`  ${l.text}`); out.push(''); }
  if (!r.lines.length) out.push('No difference.');
  return out.join('\n');
}
