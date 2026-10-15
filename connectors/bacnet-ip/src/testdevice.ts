// A small BACnet/IP device for tests and lab demos: answers Who-Is with I-Am, and ReadProperty for its objects.
// It never answers a write, because it does not understand one. Values drift so a poll shows change.
import dgram from 'node:dgram';
import { decodeTag, decodeValue, enc, OBJECT_TYPE_IDS, PROP, type Value } from './protocol.ts';

export interface SimObject { objectType: string; instance: number; name: string; units?: number; value: Value; drift?: number }
export interface SimDeviceOpts { instance: number; name?: string; model?: string; objects: SimObject[]; port?: number; bind?: string }

const u = (n: number, bytes: number) => { const out: number[] = []; for (let i = bytes - 1; i >= 0; i--) out.push((n >>> (8 * i)) & 0xff); return out; };
function encValue(v: Value, objectType: string): number[] {
  if (v === null) return [0x00];
  if (typeof v === 'boolean') return [0x10 | (v ? 1 : 0)];
  if (typeof v === 'number') { if (/^binary/.test(objectType)) return enc.enumerated(v ? 1 : 0); if (/^multiState/.test(objectType)) return enc.unsigned(v); const b = Buffer.alloc(4); b.writeFloatBE(v); return [0x44, ...b]; }
  if (typeof v === 'string') { const body = Buffer.from(v, 'utf8'); const len = body.length + 1; return [...(len < 5 ? [0x70 | len] : [0x75, len]), 0x00, ...body]; }
  if ('objectType' in v) return enc.objectId(OBJECT_TYPE_IDS[v.objectType]!, v.instance);
  return [0x00];
}
export function startSimDevice(o: SimDeviceOpts): Promise<{ port: number; close: () => Promise<void>; objects: SimObject[] }> {
  const objects = o.objects.map((x) => ({ ...x }));
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const nameOf = o.name ?? `SimDevice ${o.instance}`;
  sock.on('message', (msg, rinfo) => {
    const b = new Uint8Array(msg.buffer, msg.byteOffset, msg.length);
    if (b[0] !== 0x81) return; let i = 4; if (b[i] !== 0x01) return; const control = b[i + 1]!; i += 2; if (control & 0x20) { const dlen = b[i + 2]!; i += 3 + dlen + 1; } if (control & 0x08) { const slen = b[i + 2]!; i += 3 + slen; }
    const type = b[i]! >> 4;
    const reply = (apdu: number[]) => { const npdu = [0x01, 0x00]; const len = 4 + npdu.length + apdu.length; sock.send(Uint8Array.from([0x81, 0x0a, len >> 8, len & 0xff, ...npdu, ...apdu]), rinfo.port, rinfo.address); };
    if (type === 1 && b[i + 1] === 0x08) { // Who-Is
      let p = i + 2; if (p < b.length) { const lo = decodeValue(b, p); const hi = decodeValue(b, lo.next); if (o.instance < Number(lo.value) || o.instance > Number(hi.value)) return; }
      reply([0x10, 0x00, ...enc.objectId(8, o.instance), ...enc.unsigned(1476), ...enc.enumerated(3), ...enc.unsigned(999)]); return;
    }
    if (type === 0 && b[i + 3] === 0x0c) { // ReadProperty
      const invokeId = b[i + 2]!; let p = i + 4;
      const oid = decodeTag(b, p); const raw = b.subarray(oid.next, oid.next + 4); const v = ((raw[0]! << 24) | (raw[1]! << 16) | (raw[2]! << 8) | raw[3]!) >>> 0; const ot = v >>> 22, inst = v & 0x3fffff; p = oid.next + 4;
      const prop = decodeValue(b, p); p = prop.next; let index: number | undefined; if (p < b.length) { const t = decodeTag(b, p); if (t.cls === 1 && t.tag === 2) index = decodeValue(b, p).value as number; }
      const err = (cls: number, code: number) => reply([0x50, invokeId, 0x0c, ...enc.enumerated(cls), ...enc.enumerated(code)]);
      const ack = (vals: number[]) => reply([0x30, invokeId, 0x0c, ...enc.objectId(ot, inst, 0), ...enc.unsigned(prop.value as number, 1), ...(index !== undefined ? enc.unsigned(index, 2) : []), ...enc.open(3), ...vals, ...enc.close(3)]);
      const pid = prop.value as number;
      if (ot === 8 && inst === o.instance) {
        if (pid === PROP.objectName) return ack(encValue(nameOf, 'device'));
        if (pid === PROP.modelName) return ack(encValue(o.model ?? 'Synthetic lab device', 'device'));
        if (pid === PROP.objectList) { if (index === 0) return ack(enc.unsigned(objects.length + 1)); if (index === undefined) return ack([...enc.objectId(8, o.instance), ...objects.flatMap((x) => enc.objectId(OBJECT_TYPE_IDS[x.objectType]!, x.instance))]); if (index === 1) return ack(enc.objectId(8, o.instance)); const x = objects[index - 2]; return x ? ack(enc.objectId(OBJECT_TYPE_IDS[x.objectType]!, x.instance)) : err(2, 42); }
        return err(2, 32);
      }
      const obj = objects.find((x) => OBJECT_TYPE_IDS[x.objectType] === ot && x.instance === inst); if (!obj) return err(1, 31);
      if (pid === PROP.presentValue) { if (typeof obj.value === 'number' && obj.drift && /^analog/.test(obj.objectType)) obj.value = Math.round((obj.value + (Math.random() - 0.5) * obj.drift) * 10) / 10; return ack(encValue(obj.value, obj.objectType)); }
      if (pid === PROP.objectName) return ack(encValue(obj.name, 'x'));
      if (pid === PROP.units) return obj.units !== undefined ? ack(enc.enumerated(obj.units)) : err(2, 32);
      return err(2, 32);
    }
    // anything else, including any write, gets no answer
  });
  return new Promise((res, rej) => { sock.once('error', rej); sock.bind(o.port ?? 0, o.bind ?? '127.0.0.1', () => { res({ port: (sock.address() as { port: number }).port, close: () => new Promise<void>((r) => sock.close(() => r())), objects }); }); });
}
export const LAB_VAV = (instance: number, name: string): SimDeviceOpts => ({ instance, name, model: 'Synthetic VAV', objects: [
  { objectType: 'analogInput', instance: 1, name: 'ZN_T', units: 64, value: 72.4, drift: 0.6 },
  { objectType: 'analogOutput', instance: 2, name: 'DPR_O', units: 98, value: 42, drift: 3 },
  { objectType: 'binaryInput', instance: 3, name: 'SF_S', value: 1 },
  { objectType: 'multiStateValue', instance: 4, name: 'MODE', value: 1 },
  { objectType: 'binaryOutput', instance: 5, name: 'SF_C', value: 1 },
  { objectType: 'analogInput', instance: 6, name: 'DA_T', units: 64, value: 58.1, drift: 0.4 },
  { objectType: 'analogOutput', instance: 7, name: 'HTG_O', units: 98, value: 35, drift: 2 },
  { objectType: 'analogValue', instance: 8, name: 'CLG_MAXFLOW', units: 84, value: 1250 },
] });
