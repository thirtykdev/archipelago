/** Limits applied to every archive and document. Hostile files are refused, not survived. */
export interface Caps {
  maxEntries: number;        // archive entries
  maxEntryBytes: number;     // inflated size of one entry
  maxTotalBytes: number;     // inflated size of all entries read
  maxRatio: number;          // inflated / compressed, per entry
  maxXmlDepth: number;       // nesting
  maxXmlElements: number;    // element count
}
export const DEFAULT_CAPS: Caps = {
  maxEntries: 20_000,
  maxEntryBytes: 128 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxRatio: 400,
  maxXmlDepth: 256,
  maxXmlElements: 3_000_000,
};
export class CapExceeded extends Error { constructor(msg: string) { super(msg); this.name = 'CapExceeded'; } }
export class Refused extends Error { constructor(msg: string) { super(msg); this.name = 'Refused'; } }
