// The preview runtime's HTTP server. Plain node:http, loopback by default, strict CSP, no dependencies.
// Files sent to /api/import are read in memory and never written to disk. Nothing here opens an outbound socket.
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refKey, type Reading, type Session } from '@archipelago/core';
import { CapExceeded, Refused } from '@archipelago/importer-station-file';
import { simulatedConnector } from '@archipelago/connector-simulated';
import { EdgeModel } from './model.ts';

export interface EdgeOptions { port?: number; host?: string; simulate?: boolean; maxUploadBytes?: number; tickMs?: number }
const STATIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'static');
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'";

export function createEdge(opts: EdgeOptions = {}) {
  const model = new EdgeModel();
  const clients = new Set<http.ServerResponse>();
  let session: Session | undefined; let unsubscribe: (() => void) | undefined;
  const maxUpload = opts.maxUploadBytes ?? 256 * 1024 * 1024;

  const broadcast = (event: string, data: unknown) => { const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(msg); };

  async function resubscribe() {
    unsubscribe?.(); unsubscribe = undefined;
    if (!opts.simulate) return;
    const refs = model.refs();
    if (!session) session = await simulatedConnector.open({ seed: 11, tickMs: opts.tickMs ?? 2000, nodes: refs.map((r) => ({ ref: r.ref, name: r.name, kind: r.kind as any, ...(r.units ? { units: r.units } : {}) })) });
    if (!refs.length) return;
    unsubscribe = session.subscribe(refs.map((r) => r.ref), (reading: Reading) => { model.readings.set(refKey(reading.ref), reading); broadcast('reading', reading); });
  }

  const json = (res: http.ServerResponse, code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-security-policy': CSP, 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/api/model') return json(res, 200, { ...model.snapshot(), atoll: { name: 'Atoll preview', mode: 'local', storage: 'in-memory (preview)', connectors: opts.simulate ? [simulatedConnector.describe()] : [] } });
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, local: true, simulate: !!opts.simulate, artifacts: model.artifacts.length, connector: session?.health() ?? null });
      if (req.method === 'POST' && url.pathname === '/api/import') {
        const name = decodeURIComponent(req.headers['x-filename']?.toString() ?? 'upload');
        const len = Number(req.headers['content-length'] ?? 0);
        if (len > maxUpload) return json(res, 413, { error: `file exceeds ${maxUpload} bytes` });
        const chunks: Buffer[] = []; let size = 0;
        for await (const ch of req) { size += (ch as Buffer).length; if (size > maxUpload) return json(res, 413, { error: `file exceeds ${maxUpload} bytes` }); chunks.push(ch as Buffer); }
        const bytes = new Uint8Array(Buffer.concat(chunks));
        try { const a = model.import(name.split(/[\\/]/).pop() ?? name, bytes); await resubscribe(); broadcast('model', { changed: a.name }); return json(res, 200, { ok: true, artifact: a }); }
        catch (e) { if (e instanceof Refused || e instanceof CapExceeded) return json(res, 422, { error: `${e.name}: ${e.message}` }); throw e; }
      }
      if (req.method === 'POST' && url.pathname === '/api/reset') { model.reset(); unsubscribe?.(); unsubscribe = undefined; broadcast('model', { changed: null }); return json(res, 200, { ok: true }); }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'content-security-policy': CSP });
        res.write(`event: hello\ndata: ${JSON.stringify({ simulate: !!opts.simulate })}\n\n`);
        clients.add(res); req.on('close', () => clients.delete(res)); return;
      }
      if (req.method === 'GET') {
        let p = url.pathname === '/' ? '/index.html' : url.pathname;
        if (p.includes('..')) return json(res, 400, { error: 'bad path' });
        const f = join(STATIC, p);
        if (!existsSync(f)) return json(res, 404, { error: 'not found' });
        res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream', 'content-security-policy': CSP, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
        return res.end(readFileSync(f));
      }
      return json(res, 405, { error: 'method not allowed' });
    } catch (e) { return json(res, 500, { error: (e as Error).message }); }
  });

  const listen = () => new Promise<{ port: number; host: string }>((resolve) => { server.listen(opts.port ?? 2865, opts.host ?? '127.0.0.1', () => { const a = server.address() as { port: number; address: string }; resolve({ port: a.port, host: a.address }); }); });
  const close = async () => { unsubscribe?.(); await session?.close(); for (const c of clients) c.end(); await new Promise<void>((r) => server.close(() => r())); };
  const preload = async (name: string, bytes: Uint8Array) => { const a = model.import(name, bytes); await resubscribe(); return a; };
  return { server, model, listen, close, preload };
}
