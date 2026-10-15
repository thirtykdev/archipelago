import { describe, it, expect } from 'vitest';
import { bacnetConnector } from './index.ts';
import { startSimDevice, LAB_VAV } from './testdevice.ts';
import { whoIs, readProperty, parse, decodeValue, enc } from './protocol.ts';

describe('bacnet/ip protocol', () => {
  it('encodes Who-Is and ReadProperty as the standard lays them out', () => {
    expect([...whoIs()]).toEqual([0x81, 0x0b, 0x00, 0x0c, 0x01, 0x20, 0xff, 0xff, 0x00, 0xff, 0x10, 0x08]);
    expect([...readProperty(7, 0, 1, 85)]).toEqual([0x81, 0x0a, 0x00, 0x11, 0x01, 0x04, 0x00, 0x05, 0x07, 0x0c, 0x0c, 0x00, 0x00, 0x00, 0x01, 0x19, 0x55]);
  });
  it('decodes application tags', () => {
    expect(decodeValue(Uint8Array.from([0x44, 0x42, 0x91, 0x99, 0x9a]), 0).value).toBeCloseTo(72.8, 1);
    expect(decodeValue(Uint8Array.from([0x75, 0x05, 0x00, 0x5a, 0x4e, 0x5f, 0x54]), 0).value).toBe('ZN_T');
    expect(decodeValue(Uint8Array.from(enc.objectId(0, 1)), 0).value).toEqual({ objectType: 'analogInput', instance: 1 });
    expect(decodeValue(Uint8Array.from([0x91, 0x01]), 0).value).toBe(1);
    expect(decodeValue(Uint8Array.from([0x82, 0x04, 0xa0]), 0).value).toEqual({ bits: '1010' });
  });
  it('parses an I-Am and an error', () => {
    const iam = Uint8Array.from([0x81, 0x0b, 0x00, 0x14, 0x01, 0x00, 0x10, 0x00, ...enc.objectId(8, 2001), ...enc.unsigned(1476), ...enc.enumerated(3), ...enc.unsigned(999)]);
    expect(parse(iam)).toMatchObject({ kind: 'iam', device: { instance: 2001, maxApdu: 1476, vendorId: 999 } });
    expect(parse(Uint8Array.from([0x81, 0x0a, 0x00, 0x0b, 0x01, 0x00, 0x50, 0x03, 0x0c, 0x91, 0x02, 0x91, 0x20]))).toMatchObject({ kind: 'error', invokeId: 3 });
  });
  it('has no write encoder at all', async () => { const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('./protocol.ts', import.meta.url), 'utf8') + fs.readFileSync(new URL('./index.ts', import.meta.url), 'utf8')); const code = src.replace(/\/\/.*$/gm, ''); expect(/\bwriteProperty\s*\(|function\s+writeProperty|WriteProperty/.test(code)).toBe(false); });
});

describe('bacnet/ip connector against a loopback device', () => {
  it('discovers the device and its objects, reads present values, and polls', async () => {
    const dev = await startSimDevice(LAB_VAV(2001, 'VAV_01'));
    const s = await bacnetConnector.open({ port: 0, bind: '127.0.0.1', broadcast: '127.0.0.1', targets: [`127.0.0.1:${dev.port}`], discoverMs: 250, pollMs: 60, timeoutMs: 800 });
    expect(bacnetConnector.describe().capabilities.write).toBe(false);
    const nodes = []; for await (const n of s.discover()) nodes.push(n);
    expect(nodes[0]).toMatchObject({ kind: 'device', name: 'VAV_01', ref: { device: 2001, objectType: 'device', instance: 2001, address: '127.0.0.1' } });
    const zn = nodes.find((n) => n.name === 'ZN_T'); expect(zn).toMatchObject({ kind: 'numeric', units: '°F', ref: { device: 2001, objectType: 'analogInput', instance: 1 } });
    expect(nodes.find((n) => n.name === 'CLG_MAXFLOW')!.units).toBe('cfm');
    expect(nodes.filter((n) => n.kind !== 'device').length).toBe(8);
    const [r] = await s.read([{ device: 2001, objectType: 'analogInput', instance: 1, address: '127.0.0.1' }]);
    expect(r!.source).toBe('bacnet-ip'); expect(r!.status).toBe('ok'); expect(r!.value as number).toBeGreaterThan(60);
    const [b] = await s.read([{ device: 2001, objectType: 'binaryInput', instance: 3, address: '127.0.0.1' }]); expect(b!.value).toBe(true);
    const [bad] = await s.read([{ device: 2001, objectType: 'analogInput', instance: 99, address: '127.0.0.1' }]); expect(bad!.status).toBe('fault');
    const got: number[] = []; const stop = s.subscribe([{ device: 2001, objectType: 'analogOutput', instance: 2, address: '127.0.0.1' }], (x) => got.push(x.value as number));
    await new Promise((r) => setTimeout(r, 400)); stop();
    expect(got.length).toBeGreaterThanOrEqual(3);
    expect(s.health().connected).toBe(true);
    await s.close(); await dev.close();
  });
});
