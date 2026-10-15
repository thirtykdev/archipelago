// The assertion and provenance model. Pure types and small helpers; no I/O, no vendor names.
import { createHash } from 'node:crypto';

export type Iso8601 = string;

/** Where a fact came from. Exactly one per assertion. */
export type Provenance =
  | { kind: 'observed'; source: string; ref: string; at: Iso8601 }
  | { kind: 'imported'; artifact: string; locator: string }
  | { kind: 'inferred'; rule: string; inputs: string[]; confidence: number }
  | { kind: 'confirmed'; by: string; at: Iso8601; supersedes?: string }
  | { kind: 'rejected'; by: string; at: Iso8601; supersedes: string };

export type EntityKind = 'site' | 'building' | 'floor' | 'space' | 'zone' | 'equipment' | 'point' | 'device' | 'network' | 'program' | 'extension' | 'document';

export type PointKind = 'numeric' | 'boolean' | 'enum' | 'string';

/** A fact about an entity. The subject is an entity id; the statement is a key and a value. */
export interface Assertion {
  id: string;
  subject: string;
  key: string;
  value: unknown;
  provenance: Provenance;
}

/** A native address a connector could read a point at. Emitted by importers; never resolved by the core. */
export interface BindingHint {
  subject: string;
  connector: string;
  ref: Record<string, string | number>;
  provenance: Provenance;
}

/** A secret found in an artifact and replaced. The value is never carried. */
export interface Redaction { locator: string; kind: string }

export interface ArtifactRef { sha256: string; size: number; format: string }

export interface Question { id: string; subject: string; text: string; evidence: string[]; provenance: Provenance }

export interface CoverageReport { [measure: string]: { have: number; of: number } }

/** Content-addressed id for an assertion, so a re-import of the same fact yields the same id. */
export function assertionId(subject: string, key: string, value: unknown, locator: string): string {
  return createHash('sha256').update(JSON.stringify([subject, key, value, locator])).digest('hex').slice(0, 24);
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// ---- connectors: live source in, observations out, read-only by type (ADR 0005) ----

/** A native address inside one connector's world. Opaque to the core; the connector that emitted it can read it. */
export type NativeRef = Record<string, string | number>;

export interface Reading { ref: NativeRef; value: number | boolean | string | null; status: 'ok' | 'fault' | 'stale' | 'down'; at: Iso8601; source: string }

export interface ConnectorDescriptor {
  id: string;
  label: string;
  capabilities: { discover: boolean; read: boolean; subscribe: boolean; history: boolean; alarms: boolean; write: false };
}

export interface DiscoveredNode { ref: NativeRef; name: string; kind: PointKind | 'device'; units?: string; writable?: boolean }

export interface Session {
  discover(): AsyncIterable<DiscoveredNode>;
  read(refs: NativeRef[]): Promise<Reading[]>;
  subscribe(refs: NativeRef[], onReading: (r: Reading) => void): () => void;
  health(): { connected: boolean; lastSeen?: Iso8601; backlog: number };
  close(): Promise<void>;
}

export interface Connector {
  describe(): ConnectorDescriptor;
  open(config: unknown): Promise<Session>;
}

export const refKey = (ref: NativeRef): string => Object.keys(ref).sort().map((k) => `${k}=${ref[k]}`).join('|');

// ---- correlation: two descriptions of the same equipment, matched on native identity (ADR 0007) ----

export interface Describable { id: string; name: string; ref: NativeRef }
export interface Correlation<A extends Describable, B extends Describable> {
  matched: Array<{ a: A; b: B }>;
  onlyA: A[];
  onlyB: B[];
}
/** Match two lists on the same native identity. Pure; the key function says which fields identify an item. */
export function correlate<A extends Describable, B extends Describable>(as: A[], bs: B[], key: (ref: NativeRef) => string = refKey): Correlation<A, B> {
  const bi = new Map<string, B>(); for (const b of bs) bi.set(key(b.ref), b);
  const matched: Array<{ a: A; b: B }> = []; const onlyA: A[] = [];
  for (const a of as) { const b = bi.get(key(a.ref)); if (b) { matched.push({ a, b }); bi.delete(key(a.ref)); } else onlyA.push(a); }
  return { matched, onlyA, onlyB: [...bi.values()] };
}

export { Model, type Entity, type Snapshot, type Change, type Diff, type ModelEvent } from './model.ts';
export { can, require as requireCapability, capabilitiesAt, Forbidden, ROLE_CAPABILITIES, ALL_CAPABILITIES, ANONYMOUS, type Capability, type Role, type Grant, type Principal } from './authz.ts';
