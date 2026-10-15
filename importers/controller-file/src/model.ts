import type { PointKind, NativeRef } from '@archipelago/core';

/** What a controller application file says the controller exposes. Vendor-neutral shape; each parser fills it. */
export interface ControllerPoint { name: string; kind: PointKind; writable: boolean; units?: string; states?: string[]; ref: NativeRef; exposed: boolean; locator: string }
export interface ControllerFile {
  format: 'caf' | 'gfx';
  deviceName: string;
  deviceInstance?: number;
  points: ControllerPoint[];
  unknownObjectTypes: Record<string, number>;
  warnings: string[];
  /** experimental: validated on synthetic fixtures only; real files may differ */
  confidence: 'synthetic-only';
}

export const BACNET_OBJECT_TYPES: Record<number, string> = {
  0: 'analogInput', 1: 'analogOutput', 2: 'analogValue', 3: 'binaryInput', 4: 'binaryOutput', 5: 'binaryValue',
  6: 'calendar', 7: 'command', 8: 'device', 9: 'eventEnrollment', 10: 'file', 11: 'group', 12: 'loop',
  13: 'multiStateInput', 14: 'multiStateOutput', 15: 'notificationClass', 16: 'program', 17: 'schedule',
  19: 'multiStateValue', 20: 'trendLog', 21: 'lifeSafetyPoint', 23: 'accumulator', 24: 'pulseConverter',
  39: 'characterStringValue', 40: 'dateValue', 48: 'positiveIntegerValue',
};
export function kindOf(objectType: string): PointKind | undefined {
  if (/^analog/.test(objectType) || objectType === 'accumulator' || objectType === 'pulseConverter' || objectType === 'positiveIntegerValue') return 'numeric';
  if (/^binary/.test(objectType)) return 'boolean';
  if (/^multiState/.test(objectType)) return 'enum';
  if (objectType === 'characterStringValue') return 'string';
  return undefined;
}
export const isOutput = (objectType: string) => /Output$|Value$/.test(objectType);
