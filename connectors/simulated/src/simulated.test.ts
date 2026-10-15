import { describe, it, expect } from 'vitest';
import { simulatedConnector } from './index.ts';
describe('simulated connector', () => {
  it('declares no write capability and produces labeled readings', async () => {
    expect(simulatedConnector.describe().capabilities.write).toBe(false);
    const s = await simulatedConnector.open({ seed: 1, tickMs: 20, nodes: [{ ref: { device: 1, objectType: 'analogInput', instance: 1 }, name: 'ZN_T', kind: 'numeric', units: '°F' }] });
    const [r] = await s.read([{ device: 1, objectType: 'analogInput', instance: 1 }]);
    expect(r!.source).toBe('simulated'); expect(typeof r!.value).toBe('number'); expect(r!.value as number).toBeGreaterThan(60);
    const got: number[] = [];
    const stop = s.subscribe([{ device: 1, objectType: 'analogInput', instance: 1 }], (x) => got.push(x.value as number));
    await new Promise((res) => setTimeout(res, 120)); stop();
    expect(got.length).toBeGreaterThanOrEqual(3);
    expect((s as any).write).toBeUndefined();
    await s.close(); expect(s.health().connected).toBe(false);
  });
});
