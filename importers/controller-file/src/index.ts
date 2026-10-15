import { sniff, listZip, DEFAULT_CAPS, Refused, type Caps } from '@archipelago/importer-station-file';
import { parseCaf } from './caf.ts';
import { parseGfx } from './gfx.ts';
export type { ControllerFile, ControllerPoint } from './model.ts';
export { parseCaf, parseGfx };

/** Detect which controller-file format the bytes are, by content, and parse. */
export function parseControllerFile(bytes: Uint8Array, caps: Caps = DEFAULT_CAPS) {
  const c = sniff(bytes);
  if (c === 'xml') return parseCaf(bytes, caps);
  if (c !== 'zip') throw new Refused('not a controller file: expected a zip or an XML document');
  const names = listZip(bytes, caps).map((e) => e.name.toLowerCase());
  if (names.some((n) => n === 'config/ip/logicaltree.json')) return parseGfx(bytes, caps);
  if (names.some((n) => n.endsWith('.caf.xml') || n.endsWith('.xml'))) return parseCaf(bytes, caps);
  throw new Refused('zip is neither a controller application file nor a graphical controller file');
}
