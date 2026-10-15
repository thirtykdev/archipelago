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
