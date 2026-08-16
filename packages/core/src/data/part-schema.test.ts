import { describe, expect, it } from 'vitest';
import { validatePartFields } from './part-schema';

const VALID = {
  id: 'tank_s1',
  name: { en: 'Fuel Tank S', ru: 'test-ru-name' },
  description: { en: 'x', ru: 'y' },
  category: 'tanks',
  dryMass: 300,
  resources: [{ id: 'fuel', capacity: 2700 }],
  engine: null,
  dragArea: 1.4,
  nodeStrength: 480000,
  maxLandingSpeed: 0,
  crossfeed: true,
  bounds: { w: 1.6, h: 3.2 },
  nodes: [
    { pos: [0, 0], dir: [0, -1], size: 1, kind: 'stack' },
    { pos: [0, 3.2], dir: [0, 1], size: 1, kind: 'stack' },
    { pos: [0.8, 1.6], dir: [1, 0], size: 1, kind: 'radial' },
  ],
};

describe('validatePartFields', () => {
  it('accepts a well-formed part', () => {
    const result = validatePartFields(VALID, 'test');
    expect('fields' in result).toBe(true);
    if ('fields' in result) {
      expect(result.fields.id).toBe('tank_s1');
      expect(result.fields.nodes).toHaveLength(3);
      expect(result.fields.engine).toBeNull();
    }
  });

  it('rejects a non-object payload with ERR_PART_INVALID_JSON', () => {
    const result = validatePartFields('not an object', 'test');
    expect('issues' in result).toBe(true);
    if ('issues' in result) {
      expect(result.issues[0]?.code).toBe('ERR_PART_INVALID_JSON');
    }
  });

  it('rejects when id does not match the folder name', () => {
    const result = validatePartFields(VALID, 'test', 'some_other_folder');
    expect('issues' in result).toBe(true);
    if ('issues' in result) {
      expect(result.issues.some((i) => i.code === 'ERR_PART_INVALID_ID')).toBe(true);
    }
  });

  it('rejects an unknown category', () => {
    const result = validatePartFields({ ...VALID, category: 'not-a-category' }, 'test');
    expect('issues' in result).toBe(true);
    if ('issues' in result) {
      expect(result.issues.some((i) => i.code === 'ERR_PART_INVALID_CATEGORY')).toBe(true);
    }
  });

  it('rejects a node with a zero-length direction vector: ERR_PART_INVALID_NODE', () => {
    const bad = { ...VALID, nodes: [{ pos: [0, 0], dir: [0, 0], size: 1, kind: 'stack' }] };
    const result = validatePartFields(bad, 'test');
    expect('issues' in result).toBe(true);
    if ('issues' in result) {
      expect(result.issues.some((i) => i.code === 'ERR_PART_INVALID_NODE')).toBe(true);
    }
  });

  it('rejects a node with an invalid kind: ERR_PART_INVALID_NODE', () => {
    const bad = { ...VALID, nodes: [{ pos: [0, 0], dir: [0, 1], size: 1, kind: 'glue' }] };
    const result = validatePartFields(bad, 'test');
    expect('issues' in result).toBe(true);
    if ('issues' in result) {
      expect(result.issues.some((i) => i.code === 'ERR_PART_INVALID_NODE')).toBe(true);
    }
  });

  it('normalizes a non-unit direction vector to unit length', () => {
    const almost = { ...VALID, nodes: [{ pos: [0, 0], dir: [0, 5], size: 1, kind: 'stack' }] };
    const result = validatePartFields(almost, 'test');
    expect('fields' in result).toBe(true);
    if ('fields' in result) {
      expect(result.fields.nodes[0]?.dir).toEqual({ x: 0, y: 1 });
    }
  });

  it('rejects a negative dryMass', () => {
    const result = validatePartFields({ ...VALID, dryMass: -5 }, 'test');
    expect('issues' in result).toBe(true);
  });

  it('rejects an engine with minThrottle > 1', () => {
    const bad = {
      ...VALID,
      engine: { thrustVac: 100, thrustSl: 90, ispVac: 300, ispSl: 250, gimbalDeg: 0, minThrottle: 1.5, fuel: 'fuel' },
    };
    const result = validatePartFields(bad, 'test');
    expect('issues' in result).toBe(true);
    if ('issues' in result) {
      expect(result.issues.some((i) => i.code === 'ERR_PART_INVALID_ENGINE')).toBe(true);
    }
  });

  it('converts gimbalDeg to radians on a valid engine', () => {
    const withEngine = {
      ...VALID,
      engine: { thrustVac: 100, thrustSl: 90, ispVac: 300, ispSl: 250, gimbalDeg: 90, minThrottle: 0.5, fuel: 'fuel' },
    };
    const result = validatePartFields(withEngine, 'test');
    expect('fields' in result).toBe(true);
    if ('fields' in result) {
      expect(result.fields.engine?.gimbal).toBeCloseTo(Math.PI / 2, 10);
    }
  });

  it('collects multiple issues at once rather than stopping at the first', () => {
    const bad = { id: 'BAD ID', category: 'nope', dryMass: -1 };
    const result = validatePartFields(bad, 'test');
    expect('issues' in result).toBe(true);
    if ('issues' in result) {
      expect(result.issues.length).toBeGreaterThan(2);
    }
  });
});
