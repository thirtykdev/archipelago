// A bounded ZIP and gzip reader. Everything stays in memory; nothing is written to disk; caps are enforced before inflating.
import { inflateRawSync, gunzipSync } from 'node:zlib';
import { Caps, CapExceeded, Refused, DEFAULT_CAPS } from './caps.ts';

export interface ZipEntry { name: string; compressedSize: number; declaredSize: number; method: number; offset: number }

const EOCD = 0x06054b50, CDIR = 0x02014b50, LOCAL = 0x04034b50;

function u16(b: Uint8Array, o: number) { return (b[o]! | (b[o + 1]! << 8)) >>> 0; }
function u32(b: Uint8Array, o: number) { return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0; }

/** List entries from the central directory. Refuses ZIP64, encrypted entries, and traversal names. */
export function listZip(b: Uint8Array, caps: Caps = DEFAULT_CAPS): ZipEntry[] {
  const tail = Math.max(0, b.length - 65_557);
  let eocd = -1;
  for (let i = b.length - 22; i >= tail; i--) if (u32(b, i) === EOCD) { eocd = i; break; }
  if (eocd < 0) throw new Refused('not a zip: no end-of-central-directory record');
  const count = u16(b, eocd + 10);
  const cdSize = u32(b, eocd + 12);
  const cdOffset = u32(b, eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Refused('zip64 archives are not supported');
  if (count > caps.maxEntries) throw new CapExceeded(`archive declares ${count} entries; cap is ${caps.maxEntries}`);
  if (cdOffset + cdSize > b.length) throw new Refused('central directory lies outside the file');
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || u32(b, p) !== CDIR) throw new Refused('corrupt central directory');
    const flags = u16(b, p + 8), method = u16(b, p + 10);
    const compressedSize = u32(b, p + 20), declaredSize = u32(b, p + 24);
    const nameLen = u16(b, p + 28), extraLen = u16(b, p + 30), commentLen = u16(b, p + 32);
    const offset = u32(b, p + 42);
    const name = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(p + 46, p + 46 + nameLen));
    if (flags & 0x1) throw new Refused(`entry "${name}" is encrypted`);
    if (method !== 0 && method !== 8) throw new Refused(`entry "${name}" uses unsupported compression method ${method}`);
    if (compressedSize === 0xffffffff || declaredSize === 0xffffffff) throw new Refused('zip64 entry sizes are not supported');
    const norm = name.replace(/\\/g, '/');
    if (norm.startsWith('/') || norm.split('/').includes('..') || /^[a-zA-Z]:/.test(norm)) throw new Refused(`entry name "${name}" escapes the archive`);
    entries.push({ name: norm, compressedSize, declaredSize, method, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Read one entry's bytes, under caps. `total` accumulates across calls so the whole-archive cap holds. */
export function readZipEntry(b: Uint8Array, e: ZipEntry, caps: Caps = DEFAULT_CAPS, total = { bytes: 0 }): Uint8Array {
  if (e.declaredSize > caps.maxEntryBytes) throw new CapExceeded(`entry "${e.name}" declares ${e.declaredSize} bytes; cap is ${caps.maxEntryBytes}`);
  if (total.bytes + e.declaredSize > caps.maxTotalBytes) throw new CapExceeded(`archive total would exceed ${caps.maxTotalBytes} bytes`);
  if (e.compressedSize > 0 && e.declaredSize / Math.max(1, e.compressedSize) > caps.maxRatio) throw new CapExceeded(`entry "${e.name}" compression ratio exceeds ${caps.maxRatio}`);
  if (e.offset + 30 > b.length || u32(b, e.offset) !== LOCAL) throw new Refused(`entry "${e.name}": corrupt local header`);
  const nameLen = u16(b, e.offset + 26), extraLen = u16(b, e.offset + 28);
  const start = e.offset + 30 + nameLen + extraLen;
  const end = start + e.compressedSize;
  if (end > b.length) throw new Refused(`entry "${e.name}" is truncated`);
  const data = b.subarray(start, end);
  let out: Uint8Array;
  if (e.method === 0) out = data;
  else {
    try { out = inflateRawSync(data, { maxOutputLength: Math.min(caps.maxEntryBytes, e.declaredSize + 1) }); }
    catch (err) { throw err instanceof RangeError ? new CapExceeded(`entry "${e.name}" inflated past its declared size`) : new Refused(`entry "${e.name}": inflate failed`); }
  }
  if (out.length !== e.declaredSize) throw new Refused(`entry "${e.name}": size ${out.length} does not match declared ${e.declaredSize}`);
  total.bytes += out.length;
  return out;
}

export function gunzipBounded(b: Uint8Array, caps: Caps = DEFAULT_CAPS): Uint8Array {
  try { return gunzipSync(b, { maxOutputLength: caps.maxEntryBytes }); }
  catch (err) { throw err instanceof RangeError ? new CapExceeded(`gzip output exceeds ${caps.maxEntryBytes} bytes`) : new Refused('gzip: inflate failed'); }
}
