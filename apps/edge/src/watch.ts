// Watched folders: Atoll scans a folder on this machine on a cadence and ingests any record it recognises that it has
// not seen before (by content hash). A station folder, a backups folder, a programs folder. Read-only on the folder.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '@archipelago/core';

export interface Source { label: string; path: string; intervalMin: number }
export interface ScanResult { source: Source; seen: number; imported: string[]; skipped: number; errors: string[] }
const CANDIDATE = /\.(dist|bog|caf|gfx|pdf|png|jpe?g|dxf|dwg|svg)$/i;

export function scanFolder(src: Source, known: Set<string>, ingest: (name: string, bytes: Uint8Array) => void, opts: { maxFiles?: number; maxBytes?: number } = {}): ScanResult {
  const r: ScanResult = { source: src, seen: 0, imported: [], skipped: 0, errors: [] };
  const maxFiles = opts.maxFiles ?? 2000, maxBytes = opts.maxBytes ?? 512 * 1024 * 1024;
  const files: string[] = [];
  (function walk(d: string, depth: number) {
    if (depth > 8 || files.length >= maxFiles) return;
    let names: string[] = []; try { names = readdirSync(d); } catch (e) { r.errors.push(`${d}: ${(e as Error).message}`); return; }
    for (const n of names) { const p = join(d, n); let st; try { st = statSync(p); } catch { continue; } if (st.isDirectory()) { if (!/^(node_modules|\.git|\.gradle|build|cache|tmp|temp)$/i.test(n)) walk(p, depth + 1); } else if (CANDIDATE.test(n) && st.size <= maxBytes) files.push(p); else if (CANDIDATE.test(n)) r.skipped++; }
  })(src.path, 0);
  for (const f of files) {
    r.seen++;
    let bytes: Uint8Array; try { bytes = readFileSync(f); } catch (e) { r.errors.push(`${f}: ${(e as Error).message}`); continue; }
    const h = sha256(bytes); if (known.has(h)) { r.skipped++; continue; }
    try { ingest(f.slice(src.path.length).replace(/^[\\/]/, ''), bytes); known.add(h); r.imported.push(f); } catch (e) { r.errors.push(`${f}: ${(e as Error).message}`); }
  }
  return r;
}
