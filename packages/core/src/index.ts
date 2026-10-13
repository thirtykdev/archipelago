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

export type EntityKind = 'site' | 'building' | 'floor' | 'space' | 'zone' | 'equipment' | 'point' | 'device' | 'network' | 'program' | 'extension';

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
