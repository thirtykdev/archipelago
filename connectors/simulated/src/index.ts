// A simulated connector: the first implementation of the connector interface. It invents plausible values for
// whatever refs it is asked about, so the model, the UI and the priority scheme can be exercised with no building
// and no network. Everything it produces is labeled source 'simulated'. It has no write method (ADR 0005).
import type { Connector, ConnectorDescriptor, DiscoveredNode, NativeRef, Reading, Session } from '@archipelago/core';
import { refKey } from '@archipelago/core';

export interface SimConfig { seed?: number; tickMs?: number; nodes?: DiscoveredNode[] }

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** A value model per point kind: numerics random-walk inside a band, booleans flip rarely, enums rotate slowly. */
class Channel {
  value: number | boolean | string;
  constructor(private kind: string, private r: () => number, private units?: string, private states?: string[]) {
    if (kind === 'boolean') this.value = r() < 0.7;
    else if (kind === 'enum') this.value = states?.[0] ?? '1';
    else if (kind === 'string') this.value = '';
    else this.value = this.base() + (r() - 0.5) * this.span() * 0.2;
  }
  private base() { const u = this.units ?? ''; if (/°F|degF/i.test(u)) return 72; if (/°C|degC/i.test(u)) return 22; if (/cfm/i.test(u)) return 600; if (/%/.test(u)) return 45; if (/psi/i.test(u)) return 12; if (/in|wc/i.test(u)) return 1.2; return 50; }
  private span() { const u = this.units ?? ''; if (/°F|degF/i.test(u)) return 10; if (/°C/i.test(u)) return 5; if (/cfm/i.test(u)) return 400; if (/%/.test(u)) return 60; return 20; }
  tick() {
    if (this.kind === 'boolean') { if (this.r() < 0.02) this.value = !this.value; }
    else if (this.kind === 'enum') { if (this.r() < 0.01 && this.states?.length) this.value = this.states[Math.floor(this.r() * this.states.length)]!; }
    else if (this.kind === 'numeric') { const v = this.value as number; const b = this.base(), s = this.span(); this.value = Math.round((v + (b - v) * 0.05 + (this.r() - 0.5) * s * 0.08) * 10) / 10; }
    return this.value;
  }
}

export const simulatedConnector: Connector = {
  describe(): ConnectorDescriptor { return { id: 'simulated', label: 'Simulated devices (no building, no network)', capabilities: { discover: true, read: true, subscribe: true, history: false, alarms: false, write: false } }; },
  async open(config: unknown): Promise<Session> {
    const cfg = (config ?? {}) as SimConfig;
    const r = rng(cfg.seed ?? 7);
    const nodes = cfg.nodes ?? [];
    const channels = new Map<string, Channel>();
    const chan = (ref: NativeRef) => { const k = refKey(ref); let c = channels.get(k); if (!c) { const n = nodes.find((x) => refKey(x.ref) === k); c = new Channel(n?.kind ?? inferKind(ref), r, n?.units, undefined); channels.set(k, c); } return c; };
    const subs = new Map<string, { refs: NativeRef[]; cb: (x: Reading) => void }>();
    let timer: NodeJS.Timeout | undefined; let closed = false; let lastSeen = new Date().toISOString();
    const now = () => new Date().toISOString();
    const reading = (ref: NativeRef): Reading => ({ ref, value: chan(ref).tick(), status: 'ok', at: now(), source: 'simulated' });
    const start = () => { if (timer || closed) return; timer = setInterval(() => { lastSeen = now(); for (const s of subs.values()) for (const ref of s.refs) s.cb(reading(ref)); }, cfg.tickMs ?? 2000); timer.unref?.(); };
    return {
      async *discover() { for (const n of nodes) yield n; },
      async read(refs) { lastSeen = now(); return refs.map(reading); },
      subscribe(refs, cb) { const id = String(subs.size + 1) + ':' + Math.random(); subs.set(id, { refs, cb }); start(); for (const ref of refs) cb(reading(ref)); return () => { subs.delete(id); if (!subs.size && timer) { clearInterval(timer); timer = undefined; } }; },
      health() { return { connected: !closed, lastSeen, backlog: 0 }; },
      async close() { closed = true; if (timer) clearInterval(timer); subs.clear(); },
    };
  },
};
function inferKind(ref: NativeRef): string { const t = String(ref.objectType ?? ''); if (/^binary/.test(t)) return 'boolean'; if (/^multiState/.test(t)) return 'enum'; return 'numeric'; }
