import { describe, it, expect } from 'vitest';
import { assertionId, sha256 } from './index.ts';
describe('core', () => {
  it('assertion ids are content-addressed', () => {
    expect(assertionId('eq:1', 'serves', 'zone 214', '/a')).toBe(assertionId('eq:1', 'serves', 'zone 214', '/a'));
    expect(assertionId('eq:1', 'serves', 'zone 214', '/a')).not.toBe(assertionId('eq:1', 'serves', 'zone 215', '/a'));
  });
  it('sha256 of empty input is the known value', () => { expect(sha256(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'); });
});
