// BACnet/IP wire encoding, written from the public standard (ASHRAE 135): BVLC, NPDU, APDU, application tags.
// Read services only. There is deliberately no WriteProperty encoder in this file (ADR 0005).

export const OBJECT_TYPES: Record<number, string> = { 0: 'analogInput', 1: 'analogOutput', 2: 'analogValue', 3: 'binaryInput', 4: 'binaryOutput', 5: 'binaryValue', 6: 'calendar', 7: 'command', 8: 'device', 9: 'eventEnrollment', 10: 'file', 11: 'group', 12: 'loop', 13: 'multiStateInput', 14: 'multiStateOutput', 15: 'notificationClass', 16: 'program', 17: 'schedule', 18: 'averaging', 19: 'multiStateValue', 20: 'trendLog', 21: 'lifeSafetyPoint', 22: 'lifeSafetyZone', 23: 'accumulator', 24: 'pulseConverter', 25: 'eventLog', 28: 'loadControl', 29: 'structuredView', 30: 'accessDoor', 39: 'characterStringValue', 40: 'dateValue', 44: 'integerValue', 45: 'largeAnalogValue', 48: 'positiveIntegerValue' };
export const OBJECT_TYPE_IDS: Record<string, number> = Object.fromEntries(Object.entries(OBJECT_TYPES).map(([k, v]) => [v, Number(k)]));
export const PROP = { objectName: 77, objectType: 79, objectList: 76, presentValue: 85, statusFlags: 111, units: 117, description: 28, vendorName: 121, modelName: 70, numberOfStates: 74, stateText: 110, outOfService: 81 } as const;
export const UNITS: Record<number, string> = { 2: 'mA', 3: 'A', 4: 'Ω', 5: 'V', 8: 'VA', 9: 'kVA', 15: 'pf', 16: 'J', 17: 'kJ', 18: 'Wh', 19: 'kWh', 20: 'BTU', 21: 'therm', 22: 'ton-h', 27: 'Hz', 29: '%RH', 30: 'mm', 31: 'm', 32: 'in', 33: 'ft', 36: 'lm', 37: 'lx', 38: 'fc', 39: 'kg', 40: 'lb', 41: 'ton', 47: 'W', 48: 'kW', 49: 'MW', 50: 'BTU/h', 51: 'hp', 52: 'ton', 53: 'Pa', 54: 'kPa', 55: 'bar', 56: 'psi', 57: 'cmH₂O', 58: 'inH₂O', 59: 'mmHg', 61: 'inHg', 62: '°C', 63: 'K', 64: '°F', 67: 'yr', 68: 'mo', 69: 'wk', 70: 'd', 71: 'h', 72: 'min', 73: 's', 74: 'm/s', 75: 'km/h', 76: 'ft/s', 77: 'fpm', 78: 'mph', 79: 'ft³', 80: 'm³', 82: 'L', 83: 'gal', 84: 'cfm', 85: 'm³/s', 87: 'L/s', 88: 'L/min', 89: 'gpm', 90: '°', 91: '°C/h', 92: '°C/min', 93: '°F/h', 94: '°F/min', 95: '', 96: 'ppm', 97: 'ppb', 98: '%', 99: '%/s', 100: '/min', 101: '/s', 104: 'rpm', 118: 'cm', 120: 'Δ°F', 121: 'ΔK', 124: 'mV', 132: 'mW', 133: 'hPa', 134: 'mbar', 135: 'm³/h', 136: 'L/h', 142: 'cfh', 159: 'kBTU/h' };

// ---- application tag encoding ----
export type Value = null | boolean | number | string | { objectType: string; instance: number } | { bits: string } | Value[];

function tagHeader(tag: number, cls: 0 | 1, len: number): number[] { const b = (tag << 4) | (cls << 3); return len < 5 ? [b | len] : [b | 5, len]; }
const u = (n: number, bytes: number) => { const out: number[] = []; for (let i = bytes - 1; i >= 0; i--) out.push((n >>> (8 * i)) & 0xff); return out; };
const uLen = (n: number) => (n < 0x100 ? 1 : n < 0x10000 ? 2 : n < 0x1000000 ? 3 : 4);

export const enc = {
  objectId(objectType: number, instance: number, ctx?: number): number[] { const v = ((objectType & 0x3ff) << 22) | (instance & 0x3fffff); return [...(ctx === undefined ? tagHeader(12, 0, 4) : tagHeader(ctx, 1, 4)), ...u(v >>> 0, 4)]; },
  unsigned(n: number, ctx?: number): number[] { const l = uLen(n); return [...(ctx === undefined ? tagHeader(2, 0, l) : tagHeader(ctx, 1, l)), ...u(n, l)]; },
  enumerated(n: number, ctx?: number): number[] { const l = uLen(n); return [...(ctx === undefined ? tagHeader(9, 0, l) : tagHeader(ctx, 1, l)), ...u(n, l)]; },
  open(ctx: number): number[] { return [(ctx << 4) | 0x0e]; },
  close(ctx: number): number[] { return [(ctx << 4) | 0x0f]; },
};

export interface Decoded { value: Value; next: number; tag: number; ctx: boolean }
export function decodeTag(b: Uint8Array, i: number): { tag: number; cls: 0 | 1; len: number; next: number; open?: boolean; close?: boolean } {
  const h = b[i]!; let tag = h >> 4; const cls = ((h >> 3) & 1) as 0 | 1; let len = h & 7; let n = i + 1;
  if (tag === 15) { tag = b[n]!; n++; }
  if (cls === 1 && len === 6) return { tag, cls, len: 0, next: n, open: true };
  if (cls === 1 && len === 7) return { tag, cls, len: 0, next: n, close: true };
  if (len === 5) { len = b[n]!; n++; if (len === 254) { len = (b[n]! << 8) | b[n + 1]!; n += 2; } else if (len === 255) { len = ((b[n]! << 24) | (b[n + 1]! << 16) | (b[n + 2]! << 8) | b[n + 3]!) >>> 0; n += 4; } }
  return { tag, cls, len, next: n };
}
export function decodeValue(b: Uint8Array, i: number): Decoded {
  const t = decodeTag(b, i); const d = b.subarray(t.next, t.next + t.len); const next = t.next + t.len;
  if (t.cls === 1) { // context-tagged primitive: return raw unsigned interpretation; callers know the context
    let v = 0; for (const x of d) v = (v * 256) + x; return { value: v, next, tag: t.tag, ctx: true };
  }
  switch (t.tag) {
    case 0: return { value: null, next, tag: 0, ctx: false };
    case 1: return { value: t.len === 1, next: t.next, tag: 1, ctx: false };
    case 2: case 9: { let v = 0; for (const x of d) v = v * 256 + x; return { value: v, next, tag: t.tag, ctx: false }; }
    case 3: { let v = 0; for (const x of d) v = v * 256 + x; if (d.length && (d[0]! & 0x80)) v -= 2 ** (8 * d.length); return { value: v, next, tag: 3, ctx: false }; }
    case 4: return { value: new DataView(d.buffer, d.byteOffset, 4).getFloat32(0), next, tag: 4, ctx: false };
    case 5: return { value: new DataView(d.buffer, d.byteOffset, 8).getFloat64(0), next, tag: 5, ctx: false };
    case 7: { const encd = d[0]; const body = d.subarray(1); const s = encd === 0 ? new TextDecoder('utf-8', { fatal: false }).decode(body) : encd === 4 ? new TextDecoder('utf-16be').decode(body) : new TextDecoder('latin1').decode(body); return { value: s, next, tag: 7, ctx: false }; }
    case 8: { const unused = d[0] ?? 0; let bits = ''; for (let k = 1; k < d.length; k++) bits += d[k]!.toString(2).padStart(8, '0'); return { value: { bits: bits.slice(0, bits.length - unused) }, next, tag: 8, ctx: false }; }
    case 12: { const v = ((d[0]! << 24) | (d[1]! << 16) | (d[2]! << 8) | d[3]!) >>> 0; const ot = v >>> 22; return { value: { objectType: OBJECT_TYPES[ot] ?? `type${ot}`, instance: v & 0x3fffff }, next, tag: 12, ctx: false }; }
    default: return { value: null, next, tag: t.tag, ctx: false };
  }
}

// ---- PDUs ----
const BVLC_UNICAST = 0x0a, BVLC_BROADCAST = 0x0b;
function frame(fn: number, npdu: number[], apdu: number[]): Uint8Array { const len = 4 + npdu.length + apdu.length; return Uint8Array.from([0x81, fn, len >> 8, len & 0xff, ...npdu, ...apdu]); }
const NPDU_LOCAL_REPLY = [0x01, 0x04];                   // expecting reply
const NPDU_GLOBAL_BCAST = [0x01, 0x20, 0xff, 0xff, 0x00, 0xff]; // DNET 0xffff, hop count 255

export function whoIs(low?: number, high?: number): Uint8Array {
  const apdu = [0x10, 0x08, ...(low !== undefined && high !== undefined ? [...enc.unsigned(low, 0), ...enc.unsigned(high, 1)] : [])];
  return frame(BVLC_BROADCAST, NPDU_GLOBAL_BCAST, apdu);
}
export function readProperty(invokeId: number, objectType: number, instance: number, property: number, index?: number): Uint8Array {
  const apdu = [0x00, 0x05, invokeId & 0xff, 0x0c, ...enc.objectId(objectType, instance, 0), ...enc.unsigned(property, 1), ...(index !== undefined ? enc.unsigned(index, 2) : [])];
  return frame(BVLC_UNICAST, NPDU_LOCAL_REPLY, apdu);
}

export interface Pdu { kind: 'iam' | 'ack' | 'error' | 'reject' | 'abort' | 'other'; invokeId?: number; device?: { instance: number; maxApdu: number; vendorId: number }; values?: Value[]; error?: string }
/** Strip BVLC + NPDU and interpret the APDU we care about. */
export function parse(b: Uint8Array): Pdu {
  if (b[0] !== 0x81 || b.length < 6) return { kind: 'other' };
  let i = 4; if (b[1] === 0x04) i += 6; // forwarded-NPDU carries an origin address
  if (b[i] !== 0x01) return { kind: 'other' };
  const control = b[i + 1]!; i += 2;
  if (control & 0x20) { const dlen = b[i + 2]!; i += 3 + dlen; }
  if (control & 0x08) { const slen = b[i + 2]!; i += 3 + slen; }
  if (control & 0x20) i += 1; // hop count
  if (control & 0x80) return { kind: 'other' }; // network layer message
  const type = b[i]! >> 4;
  if (type === 1 && b[i + 1] === 0x00) { // I-Am
    let p = i + 2; const oid = decodeValue(b, p); p = oid.next; const max = decodeValue(b, p); p = max.next; const seg = decodeValue(b, p); p = seg.next; const vend = decodeValue(b, p); void seg;
    const o = oid.value as { objectType: string; instance: number }; return { kind: 'iam', device: { instance: o.instance, maxApdu: max.value as number, vendorId: vend.value as number } };
  }
  if (type === 3) { // Complex-ACK
    const invokeId = b[i + 1]!; let p = i + 3; const values: Value[] = [];
    // skip ctx 0 (object id), ctx 1 (property), optional ctx 2 (index), then read until closing tag 3
    for (;;) { const t = decodeTag(b, p); if (t.open && t.tag === 3) { p = t.next; break; } p = t.next + t.len; if (p >= b.length) return { kind: 'ack', invokeId, values }; }
    for (;;) { const t = decodeTag(b, p); if (t.close && t.tag === 3) break; if (p >= b.length) break; const v = decodeValue(b, p); values.push(v.value); p = v.next; }
    return { kind: 'ack', invokeId, values };
  }
  if (type === 5) { const invokeId = b[i + 1]!; let p = i + 3; const cls = decodeValue(b, p); const code = decodeValue(b, cls.next); return { kind: 'error', invokeId, error: `error class ${cls.value} code ${code.value}` }; }
  if (type === 6) return { kind: 'reject', invokeId: b[i + 1]!, error: `reject reason ${b[i + 2]}` };
  if (type === 7) return { kind: 'abort', invokeId: b[i + 1]!, error: `abort reason ${b[i + 2]}` };
  return { kind: 'other' };
}
