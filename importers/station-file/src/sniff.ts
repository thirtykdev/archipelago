/** Detect a container by its bytes. Extensions are never trusted. */
export type Container = 'zip' | 'gzip' | 'xml' | 'unknown';
export function sniff(b: Uint8Array): Container {
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)) return 'zip';
  if (b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b) return 'gzip';
  // XML: optional UTF-8 BOM, whitespace, then '<'
  let i = 0;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
  if (i < b.length && b[i] === 0x3c) return 'xml';
  return 'unknown';
}
