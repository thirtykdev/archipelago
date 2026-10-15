// A minimal zip writer (stored entries, CRC-32) for the whole-record export. No compression: the artifacts are
// already compressed and the facts are small; what matters is that any tool can open it.
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(b: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]!) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
export function zipStored(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const parts: Uint8Array[] = []; const cd: Uint8Array[] = []; let offset = 0;
  const now = new Date(); const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff; const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  for (const e of entries) {
    const name = new TextEncoder().encode(e.name); const crc = crc32(e.data);
    const local = Uint8Array.from([...le32(0x04034b50), ...le16(20), ...le16(0x0800), ...le16(0), ...le16(dosTime), ...le16(dosDate), ...le32(crc), ...le32(e.data.length), ...le32(e.data.length), ...le16(name.length), ...le16(0), ...name]);
    parts.push(local, e.data);
    cd.push(Uint8Array.from([...le32(0x02014b50), ...le16(20), ...le16(20), ...le16(0x0800), ...le16(0), ...le16(dosTime), ...le16(dosDate), ...le32(crc), ...le32(e.data.length), ...le32(e.data.length), ...le16(name.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(offset), ...name]));
    offset += local.length + e.data.length;
  }
  const cdLen = cd.reduce((s, x) => s + x.length, 0);
  const eocd = Uint8Array.from([...le32(0x06054b50), ...le16(0), ...le16(0), ...le16(entries.length), ...le16(entries.length), ...le32(cdLen), ...le32(offset), ...le16(0)]);
  const out = new Uint8Array(offset + cdLen + eocd.length); let o = 0; for (const p of [...parts, ...cd, eocd]) { out.set(p, o); o += p.length; }
  return out;
}
