// Persistence for Atoll: an append-only event log for the model, artifacts encrypted at rest, a key file the
// process creates. One folder is the whole state; delete the folder and nothing remains.
import { mkdirSync, existsSync, readFileSync, appendFileSync, writeFileSync, rmSync, readdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { Model, type ModelEvent } from '@archipelago/core';

export class Store {
  readonly dir: string;
  private key: Buffer;
  constructor(dir: string) {
    this.dir = dir; mkdirSync(join(dir, 'artifacts'), { recursive: true });
    const kf = join(dir, 'key');
    if (!existsSync(kf)) { writeFileSync(kf, randomBytes(32)); try { chmodSync(kf, 0o600); } catch {} }
    this.key = readFileSync(kf);
    if (this.key.length !== 32) throw new Error('key file is not 32 bytes');
  }
  /** Load the event log into a fresh model and keep appending new events to it. */
  attach(model: Model): number {
    const log = join(this.dir, 'model.jsonl'); let n = 0;
    if (existsSync(log)) for (const line of readFileSync(log, 'utf8').split('\n')) { if (!line.trim()) continue; model.apply(JSON.parse(line) as ModelEvent); n++; }
    model.onEvent((e) => appendFileSync(log, JSON.stringify(e) + '\n'));
    return n;
  }
  putArtifact(sha256: string, name: string, bytes: Uint8Array) {
    const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(bytes), c.final()]); const tag = c.getAuthTag();
    writeFileSync(join(this.dir, 'artifacts', sha256 + '.bin'), Buffer.concat([iv, tag, enc]));
    writeFileSync(join(this.dir, 'artifacts', sha256 + '.json'), JSON.stringify({ name, size: bytes.length, storedAt: new Date().toISOString() }));
  }
  getArtifact(sha256: string): Uint8Array | undefined {
    const f = join(this.dir, 'artifacts', sha256 + '.bin'); if (!existsSync(f)) return undefined;
    const b = readFileSync(f); const d = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]);
  }
  listArtifacts(): Array<{ sha256: string; name: string; size: number; storedAt: string }> {
    return readdirSync(join(this.dir, 'artifacts')).filter((f) => f.endsWith('.json')).map((f) => ({ sha256: f.slice(0, -5), ...JSON.parse(readFileSync(join(this.dir, 'artifacts', f), 'utf8')) })).sort((a, b) => a.storedAt.localeCompare(b.storedAt));
  }
  removeArtifact(sha256: string) { for (const ext of ['.bin', '.json']) rmSync(join(this.dir, 'artifacts', sha256 + ext), { force: true }); }
  /** Delete everything, including the key. */
  wipe() { rmSync(this.dir, { recursive: true, force: true }); mkdirSync(join(this.dir, 'artifacts'), { recursive: true }); writeFileSync(join(this.dir, 'key'), this.key); }
}
