// BACnet/IP read-only connector. Who-Is, ReadProperty (present value, name, units, object list), polling.
// No WriteProperty encoder exists in this package; the descriptor says write: false (ADR 0005).
import dgram from 'node:dgram';
import type { Connector, ConnectorDescriptor, DiscoveredNode, NativeRef, Reading, Session, PointKind } from '@archipelago/core';
import { refKey } from '@archipelago/core';
import { whoIs, readProperty, parse, OBJECT_TYPE_IDS, PROP, UNITS, type Value } from './protocol.ts';

export interface BacnetConfig { port?: number; broadcast?: string; bind?: string; pollMs?: number; discoverMs?: number; timeoutMs?: number; maxObjectsPerDevice?: number; /** unicast targets to Who-Is besides the broadcast, e.g. a JACE's address */ targets?: string[] }
export interface Device { instance: number; address: string; port: number; name?: string; vendorId?: number; model?: string }

const kindOf = (objectType: string): PointKind | undefined => /^analog|^accumulator|^pulse|^integerValue|^largeAnalog|^positiveInteger/.test(objectType) ? 'numeric' : /^binary/.test(objectType) ? 'boolean' : /^multiState/.test(objectType) ? 'enum' : objectType === 'characterStringValue' ? 'string' : undefined;

export const bacnetConnector: Connector = {
  describe(): ConnectorDescriptor { return { id: 'bacnet-ip', label: 'BACnet/IP (read-only)', capabilities: { discover: true, read: true, subscribe: true, history: false, alarms: false, write: false } }; },
  async open(config: unknown): Promise<Session> {
    const cfg = { port: 47808, broadcast: '255.255.255.255', bind: '0.0.0.0', pollMs: 5000, discoverMs: 3000, timeoutMs: 2500, maxObjectsPerDevice: 500, targets: [] as string[], ...((config ?? {}) as BacnetConfig) };
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    await new Promise<void>((res, rej) => { sock.once('error', rej); sock.bind(cfg.port, cfg.bind, () => { sock.removeListener('error', rej); try { sock.setBroadcast(true); } catch {} res(); }); });
    const devices = new Map<number, Device>();
    const pending = new Map<number, { resolve: (v: Value[]) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
    let invoke = 1; let lastSeen: string | undefined; let closed = false; let errors = 0;
    const now = () => new Date().toISOString();
    sock.on('message', (msg, rinfo) => {
      const pdu = parse(new Uint8Array(msg.buffer, msg.byteOffset, msg.length)); lastSeen = now();
      if (pdu.kind === 'iam' && pdu.device) { const d = devices.get(pdu.device.instance) ?? { instance: pdu.device.instance, address: rinfo.address, port: rinfo.port }; d.address = rinfo.address; d.port = rinfo.port; d.vendorId = pdu.device.vendorId; devices.set(d.instance, d); return; }
      if (pdu.invokeId !== undefined) { const p = pending.get(pdu.invokeId); if (!p) return; pending.delete(pdu.invokeId); clearTimeout(p.timer); if (pdu.kind === 'ack') p.resolve(pdu.values ?? []); else { errors++; p.reject(new Error(pdu.error ?? pdu.kind)); } }
    });
    const split = (t: string): [string, number] => { const m = /^(.*?)(?::(\d+))?$/.exec(t)!; return [m[1]!, m[2] ? Number(m[2]) : cfg.port]; };
    const send = (buf: Uint8Array, address: string, port = cfg.port) => new Promise<void>((res, rej) => sock.send(buf, port, address, (e) => (e ? rej(e) : res())));
    const rp = (d: Device, objectType: number, instance: number, property: number, index?: number): Promise<Value[]> => new Promise((resolve, reject) => {
      const id = invoke; invoke = (invoke % 255) + 1;
      const timer = setTimeout(() => { pending.delete(id); errors++; reject(new Error(`timeout reading ${objectType}:${instance} property ${property} from device ${d.instance}`)); }, cfg.timeoutMs);
      pending.set(id, { resolve, reject, timer });
      send(readProperty(id, objectType, instance, property, index), d.address, d.port).catch((e) => { pending.delete(id); clearTimeout(timer); reject(e); });
    });
    async function discoverDevices(): Promise<Device[]> {
      await send(whoIs(), cfg.broadcast).catch(() => {}); for (const t of cfg.targets) { const [h, p] = split(t); await send(whoIs(), h, p).catch(() => {}); }
      await new Promise((r) => setTimeout(r, cfg.discoverMs));
      for (const d of devices.values()) if (!d.name) { try { const [n] = await rp(d, 8, d.instance, PROP.objectName); if (typeof n === 'string') d.name = n; } catch {} try { const [m] = await rp(d, 8, d.instance, PROP.modelName); if (typeof m === 'string') d.model = m; } catch {} }
      return [...devices.values()];
    }
    const deviceOf = (ref: NativeRef): Device | undefined => { const inst = Number(ref.device); const d = devices.get(inst); if (d) return d; const addr = ref.address ? String(ref.address) : undefined; return addr ? { instance: inst, address: addr, port: cfg.port } : undefined; };
    const readOne = async (ref: NativeRef): Promise<Reading> => {
      const d = deviceOf(ref); const ot = OBJECT_TYPE_IDS[String(ref.objectType)];
      if (!d || ot === undefined) return { ref, value: null, status: 'down', at: now(), source: 'bacnet-ip' };
      try { const [v] = await rp(d, ot, Number(ref.instance), PROP.presentValue); const value = typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' ? v : v === null ? null : JSON.stringify(v); return { ref, value: typeof value === 'number' && /^binary/.test(String(ref.objectType)) ? value === 1 : value, status: 'ok', at: now(), source: 'bacnet-ip' }; }
      catch { return { ref, value: null, status: 'fault', at: now(), source: 'bacnet-ip' }; }
    };
    const subs = new Map<string, { refs: NativeRef[]; cb: (r: Reading) => void }>(); let timer: NodeJS.Timeout | undefined; let polling = false;
    const poll = async () => { if (polling || closed) return; polling = true; try { for (const s of subs.values()) for (const ref of s.refs) { if (closed) break; s.cb(await readOne(ref)); } } finally { polling = false; } };
    return {
      async *discover() {
        for (const d of await discoverDevices()) {
          yield { ref: { device: d.instance, objectType: 'device', instance: d.instance, address: d.address }, name: d.name ?? `device ${d.instance}`, kind: 'device' };
          let count = 0; try { const [c] = await rp(d, 8, d.instance, PROP.objectList, 0); count = Number(c) || 0; } catch { continue; }
          for (let k = 1; k <= Math.min(count, cfg.maxObjectsPerDevice); k++) {
            let oid: { objectType: string; instance: number } | undefined; try { const [o] = await rp(d, 8, d.instance, PROP.objectList, k); if (o && typeof o === 'object' && 'objectType' in o) oid = o; } catch { continue; }
            if (!oid) continue; const kind = kindOf(oid.objectType); if (!kind) continue; const ot = OBJECT_TYPE_IDS[oid.objectType]!;
            const node: DiscoveredNode = { ref: { device: d.instance, objectType: oid.objectType, instance: oid.instance, address: d.address }, name: `${oid.objectType}:${oid.instance}`, kind, writable: /Output$|Value$/.test(oid.objectType) };
            try { const [n] = await rp(d, ot, oid.instance, PROP.objectName); if (typeof n === 'string' && n) node.name = n; } catch {}
            if (kind === 'numeric') { try { const [u] = await rp(d, ot, oid.instance, PROP.units); if (typeof u === 'number') node.units = UNITS[u] ?? `unit ${u}`; } catch {} }
            yield node;
          }
        }
      },
      async read(refs) { const out: Reading[] = []; for (const r of refs) out.push(await readOne(r)); return out; },
      subscribe(refs, cb) { const id = `${subs.size + 1}:${Math.random()}`; subs.set(id, { refs, cb }); if (!timer) { timer = setInterval(() => { void poll(); }, cfg.pollMs); timer.unref?.(); } void poll(); return () => { subs.delete(id); if (!subs.size && timer) { clearInterval(timer); timer = undefined; } }; },
      health() { return { connected: !closed, ...(lastSeen ? { lastSeen } : {}), backlog: pending.size }; },
      async close() { closed = true; if (timer) clearInterval(timer); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('closed')); } pending.clear(); await new Promise<void>((r) => sock.close(() => r())); },
    };
  },
};
export { refKey };
export { OBJECT_TYPES, UNITS } from './protocol.ts';
