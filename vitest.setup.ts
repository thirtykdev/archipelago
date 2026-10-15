// Egress tripwire: nothing in the test suite may open a socket, resolve a name or fetch, except to loopback.
// The edge server is tested over 127.0.0.1; everything else is refused.
import net from 'node:net';
import dns from 'node:dns';
import tls from 'node:tls';
import dgram from 'node:dgram';
const LOOP = /^(127\.\d+\.\d+\.\d+|::1|localhost)$/;
const deny = (what: string, host?: string) => { throw new Error(`egress tripwire: ${what}${host ? ' to ' + host : ''} attempted during tests`); };
const hostOf = (args: any[]): string | undefined => {
  const a = args[0];
  if (typeof a === 'object' && a && 'host' in a) return (a as any).host ?? '127.0.0.1';
  if (typeof a === 'number') return typeof args[1] === 'string' ? args[1] : '127.0.0.1';
  return undefined;
};
const origConnect = net.Socket.prototype.connect;
(net.Socket.prototype as any).connect = function (...args: any[]) { const h = hostOf(args); if (h !== undefined && !LOOP.test(h)) deny('net.Socket.connect', h); return (origConnect as any).apply(this, args); };
(tls as any).connect = () => deny('tls.connect');
(dns as any).lookup = (host: string, ...rest: any[]) => { if (LOOP.test(host)) { const cb = rest[rest.length - 1]; if (typeof cb === 'function') cb(null, '127.0.0.1', 4); return; } deny('dns.lookup', host); };
(dns.promises as any).lookup = async (host: string) => { if (LOOP.test(host)) return { address: '127.0.0.1', family: 4 }; deny('dns.promises.lookup', host); };
const origFetch = globalThis.fetch;
(globalThis as any).fetch = async (input: any, init?: any) => { const u = new URL(typeof input === 'string' ? input : input.url); if (!LOOP.test(u.hostname)) deny('fetch', u.hostname); return origFetch(input, init); };
const origSend = dgram.Socket.prototype.send;
(dgram.Socket.prototype as any).send = function (...args: any[]) { const addr = args.find((a, i) => i > 0 && typeof a === 'string'); if (addr && !LOOP.test(addr)) deny('dgram send', addr); return (origSend as any).apply(this, args); };
