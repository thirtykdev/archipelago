// Synthetic station generator. Produces object-graph XML, .bog containers and .dist backups, plus hostile files.
// Nothing here comes from a real site. Shapes are recorded from observation of synthetic stations built for testing.
import { deflateRawSync, gzipSync } from 'node:zlib';

export interface StationOpts { name?: string; devices?: number; pointsPerDevice?: number; withPassword?: boolean; withUnknownModule?: boolean; withLink?: boolean; seed?: number }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function stationXml(o: StationOpts = {}): string {
  const name = o.name ?? 'Synthetic_Jace', nd = o.devices ?? 3, np = o.pointsPerDevice ?? 4;
  let h = 0x100; const H = () => (h++).toString(16);
  const L: string[] = [];
  L.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  L.push(`<bajaObjectGraph version="4.0" reversibleEncodingKeySource="none" FIPSEnabled="false" reversibleEncodingValidator="[null.1]=" >`);
  L.push(`<p h="${H()}" m="b=baja" t="b:Station">`);
  L.push(` <p n="stationName" v="${esc(name)}"/>`);
  L.push(` <p n="Services" h="${H()}" t="b:ServiceContainer">`);
  L.push(`  <p n="AlarmService" h="${H()}" m="a=alarm" t="a:AlarmService"><p n="defaultAlarmClass" h="${H()}" t="a:AlarmClass"/></p>`);
  L.push(`  <p n="UserService" h="${H()}" t="b:UserService"><p n="admin" h="${H()}" t="b:User"><p n="authenticator" h="${H()}" t="b:PasswordAuthenticator">${o.withPassword !== false ? `<p n="password" t="b:Password" v="MATCH_ME_NEVER_PRINTED"/>` : ''}</p></p></p>`);
  L.push(` </p>`);
  L.push(` <p n="Drivers" h="${H()}" m="d=driver" t="d:DriverContainer">`);
  L.push(`  <p n="BacnetNetwork" h="${H()}" m="bac=bacnet" t="bac:BacnetNetwork">`);
  L.push(`   <p n="localDevice" h="${H()}" t="bac:LocalBacnetDevice"><p n="objectId" t="bac:BacnetObjectIdentifier" v="device:1000"/></p>`);
  for (let d = 1; d <= nd; d++) {
    const dn = `VAV_${String(d).padStart(2, '0')}`;
    L.push(`   <p n="${dn}" h="${H()}" t="bac:BacnetDevice">`);
    L.push(`    <p n="address" t="bac:BacnetAddress"><p n="networkNumber" v="1000"/><p n="macAddress" t="bac:BacnetOctetString" v="${String(d).padStart(2, '0')}"/></p>`);
    L.push(`    <p n="config" h="${H()}" t="bac:BacnetConfigDeviceExt"><p n="deviceObject" h="${H()}" t="bac:BacnetDeviceObject"><p n="objectId" t="bac:BacnetObjectIdentifier" v="device:${2000 + d}"/></p></p>`);
    L.push(`    <p n="points" h="${H()}" t="bac:BacnetPointDeviceExt">`);
    const defs: [string, string, string, string, string][] = [
      ['ZN_T', 'c:NumericPoint', 'units=u:°F', 'bac:BacnetNumericProxyExt', 'analogInput:1'],
      ['DPR_O', 'c:NumericWritable', 'units=u:%', 'bac:BacnetNumericProxyExt', 'analogOutput:2'],
      ['SF_S', 'c:BooleanPoint', 'trueText=s:on|falseText=s:off', 'bac:BacnetBooleanProxyExt', 'binaryInput:3'],
      ['MODE', 'c:EnumPoint', 'range=E:occ=1,unocc=2', 'bac:BacnetEnumProxyExt', 'multiStateValue:4'],
      ['SF_C', 'c:BooleanWritable', 'trueText=s:on|falseText=s:off', 'bac:BacnetBooleanProxyExt', 'binaryOutput:5'],
      ['DA_T', 'c:NumericPoint', 'units=u:°F', 'bac:BacnetNumericProxyExt', 'analogInput:6'],
    ];
    for (let p = 0; p < np; p++) {
      const [pn, pt, facets, proxy, oid] = defs[p % defs.length]!;
      L.push(`     <p n="${pn}" h="${H()}" m="c=control" t="${pt}">`);
      L.push(`      <p n="facets" t="b:Facets" v="${esc(facets)}"/>`);
      L.push(`      <p n="proxyExt" h="${H()}" t="${proxy}"><p n="objectId" t="bac:BacnetObjectIdentifier" v="${oid}"/><p n="propertyId" t="bac:BacnetPropertyIdentifier" v="presentValue"/></p>`);
      if (pn === 'ZN_T' || pn === 'DA_T') L.push(`      <p n="NumericInterval" h="${H()}" m="h=history" t="h:NumericIntervalHistoryExt"><p n="historyName" t="b:Format" v="%parent.parent.parent.name%_%parent.name%"/></p>`);
      if (pn === 'SF_S') L.push(`      <p n="CommandFailure" h="${H()}" m="a=alarm" t="a:AlarmSourceExt"><p n="offnormalAlgorithm" h="${H()}" t="a:BooleanCommandFailureAlgorithm"/></p>`);
      if (pn === 'ZN_T') L.push(`      <p n="OutOfRange" h="${H()}" m="a=alarm" t="a:AlarmSourceExt"><p n="offnormalAlgorithm" h="${H()}" t="a:OutOfRangeAlgorithm"><p n="highLimit" v="85.0"/><p n="lowLimit" v="60.0"/></p></p>`);
      L.push(`     </p>`);
    }
    if (o.withLink && np >= 5) L.push(`     <p n="Link" h="${H()}" t="b:Link"><p n="sourceOrd" v="h:${(h - 3).toString(16)}"/><p n="sourceSlotName" v="out"/><p n="targetSlotName" v="in10"/></p>`);
    L.push(`    </p>`);
    L.push(`   </p>`);
  }
  L.push(`  </p>`);
  if (o.withUnknownModule) L.push(`  <p n="Mystery" h="${H()}" m="zz=someVendorModule" t="zz:MysteryNetwork"><p n="thing" h="${H()}" t="zz:MysteryDevice"><p n="points" h="${H()}" t="zz:MysteryPoints"/></p></p>`);
  L.push(` </p>`);
  L.push(`</p>`);
  L.push(`</bajaObjectGraph>`);
  return L.join('\n') + '\n';
}

// ---- a minimal zip writer (stored or deflated), enough to build fixtures and hostile archives ----
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(b: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]!) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export interface ZipIn { name: string; data: Uint8Array; store?: boolean; lieUncompressedSize?: number }
export function zip(entries: ZipIn[]): Uint8Array {
  const parts: Uint8Array[] = []; const cd: Uint8Array[] = []; let offset = 0;
  const le16 = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
  const le32 = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
  const cat = (...a: Uint8Array[]) => { const out = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
  for (const e of entries) {
    const name = new TextEncoder().encode(e.name);
    const method = e.store ? 0 : 8;
    const data = e.store ? e.data : deflateRawSync(e.data);
    const crc = crc32(e.data); const usize = e.lieUncompressedSize ?? e.data.length;
    const local = cat(le32(0x04034b50), le16(20), le16(0), le16(method), le16(0), le16(0), le32(crc), le32(data.length), le32(usize), le16(name.length), le16(0), name, data);
    cd.push(cat(le32(0x02014b50), le16(20), le16(20), le16(0), le16(method), le16(0), le16(0), le32(crc), le32(data.length), le32(usize), le16(name.length), le16(0), le16(0), le16(0), le16(0), le32(0), le32(offset), name));
    parts.push(local); offset += local.length;
  }
  const cdBytes = cat(...cd);
  const eocd = cat(le32(0x06054b50), le16(0), le16(0), le16(entries.length), le16(entries.length), le32(cdBytes.length), le32(offset), le16(0));
  return cat(...parts, cdBytes, eocd);
}

export const enc = (s: string) => new TextEncoder().encode(s);
export function bog(xml: string): Uint8Array { return zip([{ name: 'file.xml', data: enc(xml) }]); }
export function bogGzip(xml: string): Uint8Array { return gzipSync(enc(xml)); }
export function dist(xml: string, stationName = 'Synthetic_Jace'): Uint8Array {
  return zip([
    { name: 'etc/system.properties', data: enc('# synthetic\n') },
    { name: `stations/${stationName}/PreEditBackups/old_config.bog`, data: bog(stationXml({ name: stationName, devices: 1 })) },
    { name: `stations/${stationName}/config.bog`, data: bog(xml) },
    { name: `stations/${stationName}/alarm/.keep`, data: enc('') },
  ]);
}

// ---- hostile corpus ----
export const hostile = {
  /** an entry that inflates far past what it declares and past the cap */
  bomb(mb = 40): Uint8Array { return zip([{ name: 'file.xml', data: new Uint8Array(mb * 1024 * 1024) }]); },
  /** an entry whose header lies about its size, to sneak under the pre-inflate checks */
  liar(): Uint8Array { return zip([{ name: 'file.xml', data: new Uint8Array(8 * 1024 * 1024), lieUncompressedSize: 1000 }]); },
  traversal(): Uint8Array { return zip([{ name: '../../etc/file.xml', data: enc(stationXml()) }]); },
  tooManyEntries(n = 2500): Uint8Array { return zip(Array.from({ length: n }, (_, i) => ({ name: `junk/${i}.txt`, data: enc('x'), store: true }))); },
  truncated(): Uint8Array { return bog(stationXml()).subarray(0, 300); },
  doctype(): string { return `<?xml version="1.0"?>\n<!DOCTYPE bajaObjectGraph [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n<bajaObjectGraph version="4.0"><p t="b:Station" m="b=baja"><p n="stationName" v="&xxe;"/></p></bajaObjectGraph>\n`; },
  entity(): string { return `<?xml version="1.0"?>\n<bajaObjectGraph version="4.0"><p t="b:Station" m="b=baja"><p n="stationName" v="a &unknown; b &#x1; c &amp; d"/></p></bajaObjectGraph>\n`; },
  deep(n = 400): string { return `<bajaObjectGraph version="4.0">${'<p n="x">'.repeat(n)}${'</p>'.repeat(n)}</bajaObjectGraph>`; },
  notAGraph(): string { return `<?xml version="1.0"?><html><body>hi</body></html>`; },
  garbage(): Uint8Array { return new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]); },
};
