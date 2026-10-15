// The preview runtime's HTTP server. Plain node:http, loopback by default, strict CSP, no dependencies.
// Files sent to /api/import are read in memory and never written to disk. Nothing here opens an outbound socket.
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refKey, can, capabilitiesAt, Forbidden, requireCapability, ANONYMOUS, type Reading, type Session, type Principal, type Capability } from '@archipelago/core';
import { Users } from './users.ts';
import { CapExceeded, Refused } from '@archipelago/importer-station-file';
import { simulatedConnector } from '@archipelago/connector-simulated';
import { EdgeModel } from './model.ts';
import { Store } from './store.ts';

export interface EdgeOptions { port?: number; host?: string; simulate?: boolean; maxUploadBytes?: number; tickMs?: number; /** folder for the model log and encrypted artifacts; omitted = in memory only */ dataDir?: string; /** preview: an unidentified caller is the seeded site administrator (default true); false = anonymous, which can do nothing */ openPreview?: boolean }
const STATIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'static');
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'";

export function createEdge(opts: EdgeOptions = {}) {
  const model = new EdgeModel();
  const store = opts.dataDir ? new Store(opts.dataDir) : undefined;
  const users = new Users(model.model);
  let replayed = 0;
  if (store) { replayed = store.attach(model.model); users.seedPreview(); for (const a of store.listArtifacts()) { const bytes = store.getArtifact(a.sha256); if (bytes) { try { model.import(a.name, bytes); } catch { /* an artifact that no longer parses is kept but not loaded */ } } } }
  const clients = new Set<http.ServerResponse>();
  let session: Session | undefined; let unsubscribe: (() => void) | undefined;
  const maxUpload = opts.maxUploadBytes ?? 256 * 1024 * 1024;
  if (!store) users.seedPreview();
  // Identity, preview edition: the caller names a known principal in a header. Sessions replace this in the first
  // release; the authorization below does not change when they do.
  const whoIs = (req: http.IncomingMessage): Principal => { const id = req.headers['x-atoll-user']?.toString(); return (id ? users.get(id) : undefined) ?? (opts.openPreview === false ? ANONYMOUS : users.get('admin') ?? ANONYMOUS); };
  const guard = (req: http.IncomingMessage, capability: Capability, target = '/') => { const p = whoIs(req); requireCapability(p, capability, target); return p; };

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
      if (req.method === 'GET' && url.pathname === '/api/me') { const p = whoIs(req); return json(res, 200, { principal: p, capabilities: capabilitiesAt(p), users: users.list().map((u) => ({ id: u.id, name: u.name, grants: u.grants })) }); }
      if (req.method === 'POST' && url.pathname === '/api/users') { const by = guard(req, 'admin.users'); let body = ''; for await (const ch of req) { body += ch; if (body.length > 64 * 1024) return json(res, 413, { error: 'too large' }); } let b: { id?: string; name?: string; grants?: any[] } = {}; try { b = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'bad json' }); } if (!b.id || !b.name || !Array.isArray(b.grants)) return json(res, 400, { error: 'id, name and grants are required' }); const u = users.set(b.id, b.name, b.grants, by); broadcast('model', { changed: 'users' }); return json(res, 200, { ok: true, user: u }); }
      if (req.method === 'GET' && url.pathname.startsWith('/api/documents/')) {
        guard(req, 'model.read');
        const sha = url.pathname.slice('/api/documents/'.length).replace(/\/.*$/, '');
        const d = model.documents.find((x) => x.sha256 === sha); if (!d) return json(res, 404, { error: 'unknown document' });
        const bytes = store?.getArtifact(sha) ?? model.documentBytes.get(sha); if (!bytes) return json(res, 404, { error: 'document bytes not available' });
        res.writeHead(200, { 'content-type': d.mime, 'content-length': String(bytes.length), 'content-security-policy': CSP, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-disposition': `inline; filename="${d.name.replace(/[^\w.\- ]/g, '_')}"` });
        return res.end(Buffer.from(bytes));
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/documents/') && url.pathname.endsWith('/attach')) {
        const sha = url.pathname.slice('/api/documents/'.length).replace(/\/attach$/, '');
        let body = ''; for await (const ch of req) { body += ch; if (body.length > 64 * 1024) return json(res, 413, { error: 'too large' }); }
        let b: { entity?: string; kind?: string } = {}; try { b = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'bad json' }); }
        const target = b.entity ? (model.model.entities.get(b.entity)?.path ?? '/') : '/';
        const who = guard(req, 'facts.confirm', target);
        const d = model.attachDocument(sha, b.entity ?? null, b.kind ?? 'drawing', who.name); if (!d) return json(res, 404, { error: 'unknown document or entity' });
        broadcast('model', { changed: 'documents' }); return json(res, 200, { ok: true, document: d });
      }
      if (req.method === 'GET' && url.pathname === '/api/model') { guard(req, 'model.read'); return json(res, 200, { ...model.snapshot(), atoll: { name: 'Atoll preview', mode: 'local', storage: store ? `on disk · ${store.dir} · artifacts encrypted` : 'in-memory (preview)', replayedEvents: replayed, connectors: opts.simulate ? [simulatedConnector.describe()] : [] } }); }
      if (req.method === 'GET' && url.pathname === '/api/diff') { guard(req, 'model.read'); const from = url.searchParams.get('from'), to = url.searchParams.get('to'); if (!from || !to) return json(res, 400, { error: 'from and to are required' }); try { return json(res, 200, model.model.diff(from, to)); } catch (e) { return json(res, 404, { error: (e as Error).message }); } }
      if (req.method === 'GET' && url.pathname.startsWith('/api/facts/')) { guard(req, 'model.read'); const id = decodeURIComponent(url.pathname.slice('/api/facts/'.length)); const e = model.model.entities.get(id); if (!e) return json(res, 404, { error: 'unknown entity' }); return json(res, 200, { entity: e, facts: model.model.facts(id).map((a) => ({ ...a, history: model.model.history(id, a.key).length })) }); }
      if (req.method === 'POST' && url.pathname.startsWith('/api/questions/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/questions/'.length).replace(/\/answer$/, ''));
        const q0 = model.questions(true).find((x) => x.id === id); if (!q0) return json(res, 404, { error: 'unknown question' });
        const who = guard(req, 'questions.answer', q0.target ?? '/');
        let body = ''; for await (const ch of req) { body += ch; if (body.length > 64 * 1024) return json(res, 413, { error: 'too large' }); }
        let parsed: { answer?: string; by?: string } = {}; try { parsed = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'bad json' }); }
        if (!parsed.answer) return json(res, 400, { error: 'answer is required' });
        const q = model.answer(id, parsed.answer, who.name); if (!q) return json(res, 404, { error: 'unknown question' });
        broadcast('model', { changed: 'question' }); return json(res, 200, { ok: true, question: q });
      }
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, local: true, simulate: !!opts.simulate, artifacts: model.artifacts.length, connector: session?.health() ?? null });
      if (req.method === 'POST' && url.pathname === '/api/import') {
        guard(req, 'config.import');
        const name = decodeURIComponent(req.headers['x-filename']?.toString() ?? 'upload');
        const len = Number(req.headers['content-length'] ?? 0);
        if (len > maxUpload) return json(res, 413, { error: `file exceeds ${maxUpload} bytes` });
        const chunks: Buffer[] = []; let size = 0;
        for await (const ch of req) { size += (ch as Buffer).length; if (size > maxUpload) return json(res, 413, { error: `file exceeds ${maxUpload} bytes` }); chunks.push(ch as Buffer); }
        const bytes = new Uint8Array(Buffer.concat(chunks));
        try { const a = model.import(name.split(/[\\/]/).pop() ?? name, bytes); if (a.kind === 'document' && !store) model.documentBytes.set(a.sha256, bytes); if (store) { store.putArtifact(a.sha256, a.name, bytes); for (const old of store.listArtifacts()) if (!model.artifacts.some((x) => x.sha256 === old.sha256)) store.removeArtifact(old.sha256); } await resubscribe(); broadcast('model', { changed: a.name }); return json(res, 200, { ok: true, artifact: a }); }
        catch (e) { if (e instanceof Refused || e instanceof CapExceeded) return json(res, 422, { error: `${e.name}: ${e.message}` }); throw e; }
      }
      if (req.method === 'POST' && url.pathname === '/api/reset') { guard(req, 'admin.site'); model.reset(); store?.wipe(); unsubscribe?.(); unsubscribe = undefined; broadcast('model', { changed: null }); return json(res, 200, { ok: true }); }
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
    } catch (e) { if (e instanceof Forbidden) return json(res, 403, { error: e.message, capability: e.capability, target: e.target }); return json(res, 500, { error: (e as Error).message }); }
  });

  const listen = () => new Promise<{ port: number; host: string }>((resolve) => { server.listen(opts.port ?? 2865, opts.host ?? '127.0.0.1', () => { const a = server.address() as { port: number; address: string }; resolve({ port: a.port, host: a.address }); }); });
  const close = async () => { unsubscribe?.(); await session?.close(); for (const c of clients) c.end(); await new Promise<void>((r) => server.close(() => r())); };
  const preload = async (name: string, bytes: Uint8Array) => { const a = model.import(name, bytes); if (a.kind === 'document' && !store) model.documentBytes.set(a.sha256, bytes); if (store) { store.putArtifact(a.sha256, a.name, bytes); for (const old of store.listArtifacts()) if (!model.artifacts.some((x) => x.sha256 === old.sha256)) store.removeArtifact(old.sha256); } await resubscribe(); return a; };
  return { server, model, listen, close, preload };
}
