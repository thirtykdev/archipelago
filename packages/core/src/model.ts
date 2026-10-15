// The model: entities, assertions with provenance, supersede chains, snapshots and diff. Pure, in memory;
// persistence is the caller's job (see apps/edge). Nothing is ever overwritten: a later assertion supersedes.
import { createHash } from 'node:crypto';
import type { Assertion, EntityKind, Iso8601, Provenance } from './index.ts';

export interface Entity { id: string; kind: EntityKind; name: string; path?: string; handle?: string; parent?: string }
export interface Snapshot { id: string; at: Iso8601; label: string; entityIds: string[]; assertionIds: string[]; artifacts: string[] }
export interface Change { subject: string; name: string; key: string; from: unknown; to: unknown }
export interface Diff { from: string; to: string; added: Entity[]; removed: Entity[]; changed: Change[]; renamed: Array<{ entity: Entity; from: string; to: string }> }
export type ModelEvent =
  | { type: 'entity'; entity: Entity }
  | { type: 'assertion'; assertion: Assertion; supersedes?: string }
  | { type: 'retire'; entityId: string; at: Iso8601 }
  | { type: 'snapshot'; snapshot: Snapshot };

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export class Model {
  readonly entities = new Map<string, Entity>();
  readonly assertions = new Map<string, Assertion>();
  /** assertion id -> the id that superseded it */
  readonly supersededBy = new Map<string, string>();
  /** subject -> key -> current assertion id */
  private current = new Map<string, Map<string, string>>();
  readonly snapshots: Snapshot[] = [];
  readonly retired = new Set<string>();
  private listeners: Array<(e: ModelEvent) => void> = [];

  onEvent(fn: (e: ModelEvent) => void) { this.listeners.push(fn); }
  private emit(e: ModelEvent) { for (const l of this.listeners) l(e); }

  /** Replay a persisted event without re-emitting it. */
  apply(e: ModelEvent) {
    switch (e.type) {
      case 'entity': this.entities.set(e.entity.id, e.entity); this.retired.delete(e.entity.id); break;
      case 'assertion': this.place(e.assertion, e.supersedes); break;
      case 'retire': this.retired.add(e.entityId); break;
      case 'snapshot': this.snapshots.push(e.snapshot); break;
    }
  }

  addEntity(entity: Entity): Entity { const prev = this.entities.get(entity.id); if (prev && prev.name === entity.name && prev.path === entity.path && prev.parent === entity.parent && prev.kind === entity.kind && !this.retired.has(entity.id)) return prev; this.apply({ type: 'entity', entity }); this.emit({ type: 'entity', entity }); return entity; }
  retire(entityId: string) { if (!this.retired.has(entityId)) { const ev: ModelEvent = { type: 'retire', entityId, at: new Date().toISOString() }; this.apply(ev); this.emit(ev); } }

  private place(a: Assertion, supersedes?: string) {
    this.assertions.set(a.id, a);
    if (supersedes) this.supersededBy.set(supersedes, a.id);
    let m = this.current.get(a.subject); if (!m) { m = new Map(); this.current.set(a.subject, m); }
    m.set(a.key, a.id);
  }

  /** Assert a fact. If the same subject+key already holds the same value from the same kind of source, nothing changes. */
  assert(subject: string, key: string, value: unknown, provenance: Provenance): Assertion {
    const cur = this.currentAssertion(subject, key);
    const id = hash(JSON.stringify([subject, key, value, provenance])).slice(0, 24);
    if (cur && cur.id === id) return cur;
    // a confirmed fact is not displaced by a later import or inference; only another person can supersede it
    if (cur && cur.provenance.kind === 'confirmed' && provenance.kind !== 'confirmed' && provenance.kind !== 'rejected') return cur;
    const a: Assertion = { id, subject, key, value, provenance };
    const ev: ModelEvent = { type: 'assertion', assertion: a, ...(cur ? { supersedes: cur.id } : {}) };
    this.apply(ev); this.emit(ev);
    return a;
  }
  currentAssertion(subject: string, key: string): Assertion | undefined { const id = this.current.get(subject)?.get(key); return id ? this.assertions.get(id) : undefined; }
  value<T = unknown>(subject: string, key: string): T | undefined { return this.currentAssertion(subject, key)?.value as T | undefined; }
  facts(subject: string): Assertion[] { const m = this.current.get(subject); return m ? [...m.values()].map((id) => this.assertions.get(id)!) : []; }
  /** The chain behind a fact: the current assertion, then what it superseded, oldest last. */
  history(subject: string, key: string): Assertion[] { const out: Assertion[] = []; let a = this.currentAssertion(subject, key); const back = new Map<string, string>(); for (const [old, nu] of this.supersededBy) back.set(nu, old); while (a) { out.push(a); const prev = back.get(a.id); a = prev ? this.assertions.get(prev) : undefined; } return out; }
  live(kind?: EntityKind): Entity[] { return [...this.entities.values()].filter((e) => !this.retired.has(e.id) && (!kind || e.kind === kind)); }

  snapshot(label: string, artifacts: string[] = []): Snapshot {
    const entityIds = this.live().map((e) => e.id).sort();
    const assertionIds = entityIds.flatMap((id) => this.facts(id).map((a) => a.id)).sort();
    const id = hash(JSON.stringify([entityIds, assertionIds])).slice(0, 16);
    const existing = this.snapshots.find((s) => s.id === id);
    if (existing) return existing;
    const s: Snapshot = { id, at: new Date().toISOString(), label, entityIds, assertionIds, artifacts };
    this.apply({ type: 'snapshot', snapshot: s }); this.emit({ type: 'snapshot', snapshot: s });
    return s;
  }

  /** Compare two snapshots. Identity: entity id first (handle-based where the source has handles); then path. */
  diff(fromId: string, toId: string): Diff {
    const A = this.snapshots.find((s) => s.id === fromId), B = this.snapshots.find((s) => s.id === toId);
    if (!A || !B) throw new Error('unknown snapshot');
    const aIds = new Set(A.entityIds), bIds = new Set(B.entityIds);
    const aAss = new Map(A.assertionIds.map((id) => { const a = this.assertions.get(id)!; return [`${a.subject}\u0000${a.key}`, a] as const; }));
    const bAss = new Map(B.assertionIds.map((id) => { const a = this.assertions.get(id)!; return [`${a.subject}\u0000${a.key}`, a] as const; }));
    const removedIds = [...aIds].filter((id) => !bIds.has(id)), addedIds = [...bIds].filter((id) => !aIds.has(id));
    // path fallback: an entity that vanished and one that appeared with the same path are the same thing, re-identified
    const renamed: Diff['renamed'] = [];
    const byPathB = new Map(addedIds.map((id) => [this.entities.get(id)?.path ?? id, id]));
    const matchedA = new Set<string>(), matchedB = new Set<string>();
    for (const id of removedIds) { const p = this.entities.get(id)?.path; const nb = p ? byPathB.get(p) : undefined; if (nb) { matchedA.add(id); matchedB.add(nb); renamed.push({ entity: this.entities.get(nb)!, from: id, to: nb }); } }
    const changed: Change[] = [];
    for (const [k, b] of bAss) { const a = aAss.get(k); if (a && JSON.stringify(a.value) !== JSON.stringify(b.value)) changed.push({ subject: b.subject, name: this.entities.get(b.subject)?.name ?? b.subject, key: b.key, from: a.value, to: b.value }); }
    for (const [k, a] of aAss) if (!bAss.has(k) && bIds.has(a.subject)) changed.push({ subject: a.subject, name: this.entities.get(a.subject)?.name ?? a.subject, key: a.key, from: a.value, to: undefined });
    for (const [k, b] of bAss) if (!aAss.has(k) && aIds.has(b.subject)) changed.push({ subject: b.subject, name: this.entities.get(b.subject)?.name ?? b.subject, key: b.key, from: undefined, to: b.value });
    return { from: fromId, to: toId, added: addedIds.filter((id) => !matchedB.has(id)).map((id) => this.entities.get(id)!), removed: removedIds.filter((id) => !matchedA.has(id)).map((id) => this.entities.get(id)!), changed: changed.sort((x, y) => x.subject.localeCompare(y.subject) || x.key.localeCompare(y.key)), renamed };
  }
}
