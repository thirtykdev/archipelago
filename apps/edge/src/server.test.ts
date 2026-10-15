import { describe, it, expect } from 'vitest';
import { createEdge } from './server.ts';
import { stationXml, dist } from '../../../fixtures/synthetic/station.ts';
import { caf } from '../../../fixtures/synthetic/controller.ts';
describe('edge preview server', () => {
  it('serves the UI with a strict CSP, imports files in memory, correlates and streams simulated readings', async () => {
    const edge = createEdge({ port: 0, simulate: true, tickMs: 30 });
    const { port } = await edge.listen();
    const base = `http://127.0.0.1:${port}`;
    const home = await fetch(base + '/'); expect(home.status).toBe(200); expect(home.headers.get('content-security-policy')).toMatch(/default-src 'self'/);
    expect(await (await fetch(base + '/api/health')).json()).toMatchObject({ ok: true, local: true, simulate: true });
    const up = async (name: string, bytes: Uint8Array) => (await fetch(base + '/api/import', { method: 'POST', headers: { 'x-filename': name }, body: new Blob([bytes as unknown as BlobPart]) })).json();
    expect(await up('site.dist', dist(stationXml({ devices: 2, pointsPerDevice: 6 })))).toMatchObject({ ok: true, artifact: { kind: 'station' } });
    expect(await up('VAV_01.caf', caf())).toMatchObject({ ok: true, artifact: { kind: 'controller', format: 'caf' } });
    expect((await up('bad.bin', new Uint8Array([9, 9, 9]))).error).toMatch(/Refused/);
    const m = await (await fetch(base + '/api/model')).json();
    expect(m.station.devices.length).toBe(2);
    expect(m.controllers[0].matchedDevice).toBe('/Drivers/BacnetNetwork/VAV_01');
    expect(m.controllers[0].correlation.matched).toBe(6);
    expect(m.controllers[0].correlation.onlyController.map((p: any) => p.name).sort()).toEqual(['CLG-MAXFLOW', 'HTG-O']);
    expect(m.questions.some((q: any) => q.kind === 'missing-points')).toBe(true);
    await new Promise((r) => setTimeout(r, 120));
    const m2 = await (await fetch(base + '/api/model')).json();
    expect(Object.keys(m2.readings).length).toBeGreaterThanOrEqual(14); // 12 station points + 2 controller-only
    expect(Object.values(m2.readings).every((r: any) => r.source === 'simulated')).toBe(true);
    await edge.close();
  });
});

describe('edge persistence and answers', () => {
  it('answers a question with a confirmed fact, snapshots every import, diffs, and survives a restart', async () => {
    const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'atoll-data-'));
    let edge = createEdge({ port: 0, dataDir: dir }); let { port } = await edge.listen(); let base = `http://127.0.0.1:${port}`;
    const up = async (name: string, bytes: Uint8Array) => (await fetch(base + '/api/import', { method: 'POST', headers: { 'x-filename': name }, body: new Blob([bytes as unknown as BlobPart]) })).json();
    await up('site.dist', dist(stationXml({ devices: 2, pointsPerDevice: 6 })));
    await up('VAV_01.caf', caf());
    let m = await (await fetch(base + '/api/model')).json();
    expect(m.snapshots.length).toBe(2);
    const q = m.questions.find((x: any) => x.kind === 'missing-points');
    const ans = await (await fetch(base + `/api/questions/${encodeURIComponent(q.id)}/answer`, { method: 'POST', body: JSON.stringify({ answer: q.options[0] }) })).json();
    expect(ans.question.answered).toMatchObject({ answer: 'Read them directly from the controller', by: 'Site administrator' });
    await up('site.dist', dist(stationXml({ devices: 3, pointsPerDevice: 6 })));   // the station grew by a device
    m = await (await fetch(base + '/api/model')).json();
    expect(m.diff.added.some((e: any) => e.kind === 'device' && e.name === 'VAV_03')).toBe(true);
    await edge.close();
    edge = createEdge({ port: 0, dataDir: dir }); ({ port } = await edge.listen()); base = `http://127.0.0.1:${port}`;
    m = await (await fetch(base + '/api/model')).json();
    expect(m.atoll.replayedEvents).toBeGreaterThan(10);
    expect(m.station.devices.length).toBe(3);
    expect(m.questions.find((x: any) => x.kind === 'missing-points').answered.by).toBe('Site administrator');
    await edge.close();
  });
});

describe('permissions', () => {
  it('a viewer can read but not answer, a scoped operator can answer only inside the scope, an admin can grant', async () => {
    const edge = createEdge({ port: 0 }); const { port } = await edge.listen(); const base = `http://127.0.0.1:${port}`;
    const as = (user: string) => ({ 'x-atoll-user': user });
    const up = async (name: string, bytes: Uint8Array, user = 'admin') => (await fetch(base + '/api/import', { method: 'POST', headers: { 'x-filename': name, ...as(user) }, body: new Blob([bytes as unknown as BlobPart]) }));
    expect((await up('site.dist', dist(stationXml({ devices: 2, pointsPerDevice: 6 })), 'viewer')).status).toBe(403);
    expect((await up('site.dist', dist(stationXml({ devices: 2, pointsPerDevice: 6 })))).status).toBe(200);
    expect((await up('VAV_01.caf', caf(), 'tech')).status).toBe(200);
    const me = await (await fetch(base + '/api/me', { headers: as('viewer') })).json();
    expect(me.capabilities).toEqual(['model.read']);
    const m = await (await fetch(base + '/api/model', { headers: as('viewer') })).json();
    const q = m.questions.find((x: any) => x.kind === 'missing-points');          // target: /Drivers/BacnetNetwork/VAV_01
    const answer = (user: string) => fetch(base + `/api/questions/${encodeURIComponent(q.id)}/answer`, { method: 'POST', headers: as(user), body: JSON.stringify({ answer: q.options[0] }) });
    expect((await answer('viewer')).status).toBe(403);
    const r = await answer('ops-b'); expect(r.status).toBe(200); expect((await r.json()).question.answered.by).toBe('Night operator (BacnetNetwork only)');
    expect((await fetch(base + '/api/reset', { method: 'POST', headers: as('tech') })).status).toBe(403);
    expect((await fetch(base + '/api/users', { method: 'POST', headers: as('tech'), body: JSON.stringify({ id: 'x', name: 'x', grants: [] }) })).status).toBe(403);
    const g = await fetch(base + '/api/users', { method: 'POST', headers: as('admin'), body: JSON.stringify({ id: 'eng', name: 'Engineer', grants: [{ role: 'engineer', scope: '/' }] }) });
    expect(g.status).toBe(200);
    expect((await (await fetch(base + '/api/me', { headers: as('eng') })).json()).capabilities).toContain('config.connectors');
    expect((await fetch(base + '/api/model', { headers: as('nobody') })).status).toBe(200); // unknown caller in the open preview is the admin
    await edge.close();
    const closed = createEdge({ port: 0, openPreview: false }); const c = await closed.listen();
    expect((await fetch(`http://127.0.0.1:${c.port}/api/model`, { headers: as('nobody') })).status).toBe(403);
    await closed.close();
  });
});

describe('drawings and submittals', () => {
  it('accepts a PDF by content, serves it only to a reader, and attaches it to equipment as a confirmed fact', async () => {
    const edge = createEdge({ port: 0 }); const { port } = await edge.listen(); const base = `http://127.0.0.1:${port}`;
    const as = (user: string) => ({ 'x-atoll-user': user });
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
    const up = async (name: string, bytes: Uint8Array, user = 'admin') => (await fetch(base + '/api/import', { method: 'POST', headers: { 'x-filename': name, ...as(user) }, body: new Blob([bytes as unknown as BlobPart]) })).json();
    await up('site.dist', dist(stationXml({ devices: 1, pointsPerDevice: 2 })));
    const r = await up('Level 5 mechanical.pdf', pdf); expect(r.artifact).toMatchObject({ kind: 'document', format: 'pdf' });
    const fake = await up('submittal.pdf', new TextEncoder().encode('not a pdf at all')); expect(fake.error).toMatch(/Refused/);
    const m = await (await fetch(base + '/api/model')).json();
    expect(m.documents[0]).toMatchObject({ name: 'Level 5 mechanical.pdf', mime: 'application/pdf', attachedTo: null });
    const get = await fetch(base + `/api/documents/${r.artifact.sha256}`, { headers: as('viewer') });
    expect(get.status).toBe(200); expect(get.headers.get('content-type')).toBe('application/pdf'); expect(get.headers.get('cache-control')).toBe('no-store');
    const closed = createEdge({ port: 0, openPreview: false }); const c = await closed.listen();
    expect((await fetch(`http://127.0.0.1:${c.port}/api/documents/${r.artifact.sha256}`)).status).toBe(403); await closed.close();
    const dev = m.station.devices[0]; const devId = `${m.station.stationName}|h:${m.station.handles[dev.path]}`;
    const attach = await fetch(base + `/api/documents/${r.artifact.sha256}/attach`, { method: 'POST', headers: as('viewer'), body: JSON.stringify({ entity: devId, kind: 'mechanical' }) });
    expect(attach.status).toBe(403);
    const ok = await (await fetch(base + `/api/documents/${r.artifact.sha256}/attach`, { method: 'POST', headers: as('tech'), body: JSON.stringify({ entity: devId, kind: 'mechanical' }) })).json();
    expect(ok.document).toMatchObject({ kind: 'mechanical', by: 'Technician', attachedTo: devId, attachedToName: 'VAV_01' });
    await edge.close();
  });
});

describe('intake with accountability', () => {
  it('declares what is owed, receipts every delivery with a controls-language diff, lists what is late, and exports the record', async () => {
    const edge = createEdge({ port: 0 }); const { port } = await edge.listen(); const base = `http://127.0.0.1:${port}`;
    const as = (user: string) => ({ 'x-atoll-user': user });
    const up = async (name: string, bytes: Uint8Array, user = 'tech') => (await fetch(base + '/api/import', { method: 'POST', headers: { 'x-filename': name, ...as(user) }, body: new Blob([bytes as unknown as BlobPart]) })).json();
    expect((await fetch(base + '/api/expectations', { method: 'POST', headers: as('viewer'), body: JSON.stringify({ label: 'x', kind: 'station-backup', owedBy: 'y' }) })).status).toBe(403);
    const exp = await (await fetch(base + '/api/expectations', { method: 'POST', headers: as('admin'), body: JSON.stringify({ label: 'JACE 12 monthly backup', kind: 'station-backup', owedBy: 'Contractor LLC', cadenceDays: 30 }) })).json();
    expect(exp.expectation).toMatchObject({ kind: 'station-backup', owedBy: 'Contractor LLC', cadenceDays: 30, createdBy: 'Site administrator' });
    await (await fetch(base + '/api/expectations', { method: 'POST', headers: as('admin'), body: JSON.stringify({ label: 'AHU-3 controller file', kind: 'controller-file', owedBy: 'Contractor LLC', cadenceDays: null, match: 'AHU' }) })).json();
    let m = await (await fetch(base + '/api/model')).json();
    expect(m.overdue.map((o: any) => o.status)).toEqual(['never', 'never']);
    await up('backup_jace12.dist', dist(stationXml({ devices: 2, pointsPerDevice: 6 })));
    m = await (await fetch(base + '/api/model')).json();
    expect(m.receipts[0]).toMatchObject({ name: 'backup_jace12.dist', by: 'Technician', expectation: exp.expectation.id, onTime: true });
    expect(m.receipts[0].summary).toBeUndefined();
    // a later backup: a setpoint moved, alarms inhibited on VAV_02, a high limit changed, VAV_02 renamed
    await up('backup_jace12.dist', dist(stationXml({ devices: 2, pointsPerDevice: 6, tweak: (d) => d === 'VAV_02' ? { fallback: { DPR_O: '45.0' }, inhibitAlarms: true, highLimit: '80.0', renameTo: 'VAV_02_RELO' } : {} })));
    m = await (await fetch(base + '/api/model')).json();
    const r = m.receipts[0]; expect(r.previous).toBeDefined(); expect(r.summary.lines.length).toBeGreaterThan(0);
    const kinds = r.summary.counts; expect(kinds.setpoint).toBe(1); expect(kinds['alarm-disabled']).toBe(2); expect(kinds['alarm-limit']).toBe(1); expect(kinds.renamed).toBeGreaterThanOrEqual(1);
    expect(r.summary.lines.find((l: any) => l.kind === 'setpoint').text).toMatch(/DPR_O: setpoint 30.0 → 45.0/);
    const txt = await (await fetch(base + `/api/report?from=${r.summary.from}&to=${r.summary.to}&format=text`)).text();
    expect(txt).toMatch(/Setpoints changed \(1\)/); expect(txt).toMatch(/Alarms inhibited \(2\)/);
    expect(m.overdue.find((o: any) => o.expectation.kind === 'station-backup').status).toBe('ok');
    expect(m.overdue.find((o: any) => o.expectation.kind === 'controller-file').status).toBe('never');
    expect((await fetch(base + '/api/export', { headers: as('viewer') })).status).toBe(403);
    const z = await fetch(base + '/api/export', { headers: as('admin') }); expect(z.status).toBe(200); expect(z.headers.get('content-type')).toBe('application/zip');
    const bytes = new Uint8Array(await z.arrayBuffer()); expect(bytes[0]).toBe(0x50); expect(bytes[1]).toBe(0x4b);
    const { listZip, readZipEntry } = await import('@archipelago/importer-station-file');
    const names = listZip(bytes).map((e) => e.name); expect(names).toContain('facts.json'); expect(names).toContain('receipts.json'); expect(names.some((n) => n.startsWith('artifacts/'))).toBe(true);
    const facts = JSON.parse(new TextDecoder().decode(readZipEntry(bytes, listZip(bytes).find((e) => e.name === 'facts.json')!)));
    expect(facts.assertions.length).toBeGreaterThan(50); expect(JSON.stringify(facts)).not.toContain('MATCH_ME_NEVER_PRINTED');
    await edge.close();
  });
});
