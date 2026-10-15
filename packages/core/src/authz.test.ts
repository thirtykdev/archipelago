import { describe, it, expect } from 'vitest';
import { can, capabilitiesAt, requireCapability, Forbidden, ANONYMOUS, type Principal } from './index.ts';
describe('authorization', () => {
  const night: Principal = { id: 'u1', name: 'night operator', grants: [{ role: 'viewer', scope: '/' }, { role: 'operator', scope: '/Drivers/BacnetNetwork/BuildingB' }] };
  const admin: Principal = { id: 'u2', name: 'admin', grants: [{ role: 'administrator', scope: '/' }] };
  it('scopes a role to a subtree', () => {
    expect(can(night, 'model.read', '/Drivers/BacnetNetwork/BuildingA/VAV_1')).toBe(true);
    expect(can(night, 'questions.answer', '/Drivers/BacnetNetwork/BuildingB/VAV_7')).toBe(true);
    expect(can(night, 'questions.answer', '/Drivers/BacnetNetwork/BuildingA/VAV_1')).toBe(false);
    expect(can(night, 'questions.answer')).toBe(false);
  });
  it('writes to a building are never implied by a role', () => { expect(can(admin, 'points.write')).toBe(false); expect(can({ ...admin, grants: [{ role: 'administrator', scope: '/', extra: ['points.write'] }] }, 'points.write')).toBe(true); });
  it('anonymous can do nothing, and the throwing form names what was missing', () => {
    expect(capabilitiesAt(ANONYMOUS)).toEqual([]);
    expect(() => requireCapability(night, 'admin.users')).toThrow(Forbidden);
    try { requireCapability(night, 'config.import', '/x'); } catch (e) { expect((e as Forbidden).message).toBe('night operator lacks config.import on /x'); }
  });
});
