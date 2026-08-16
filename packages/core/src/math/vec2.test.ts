import { describe, expect, it } from 'vitest';
import { v2, ZERO, type Vec2 } from './vec2';

describe('v2', () => {
  const a: Vec2 = { x: 3, y: 4 };
  const b: Vec2 = { x: 1, y: 2 };

  it('add / sub are inverses', () => {
    expect(v2.add(a, b)).toEqual({ x: 4, y: 6 });
    expect(v2.sub(v2.add(a, b), b)).toEqual(a);
  });

  it('scale', () => {
    expect(v2.scale(a, 2)).toEqual({ x: 6, y: 8 });
    expect(v2.scale(a, 0)).toEqual(ZERO);
  });

  it('len / len2', () => {
    expect(v2.len(a)).toBe(5);
    expect(v2.len2(a)).toBe(25);
  });

  it('norm produces a unit vector, and is safe on the zero vector', () => {
    const n = v2.norm(a);
    expect(v2.len(n)).toBeCloseTo(1, 12);
    expect(n.x).toBeCloseTo(0.6, 12);
    expect(n.y).toBeCloseTo(0.8, 12);
    expect(v2.norm(ZERO)).toEqual(ZERO);
  });

  it('rot by 90deg (pi/2) rotates (1,0) to (0,1)', () => {
    const r = v2.rot({ x: 1, y: 0 }, Math.PI / 2);
    expect(r.x).toBeCloseTo(0, 12);
    expect(r.y).toBeCloseTo(1, 12);
  });

  it('rot by 2*pi is identity', () => {
    const r = v2.rot(a, Math.PI * 2);
    expect(r.x).toBeCloseTo(a.x, 9);
    expect(r.y).toBeCloseTo(a.y, 9);
  });

  it('dot', () => {
    expect(v2.dot(a, b)).toBe(3 * 1 + 4 * 2);
    expect(v2.dot({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(0);
  });

  it('cross', () => {
    expect(v2.cross({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(1);
    expect(v2.cross({ x: 0, y: 1 }, { x: 1, y: 0 })).toBe(-1);
  });

  it('operations do not mutate their inputs', () => {
    const before = { ...a };
    v2.add(a, b);
    v2.scale(a, 5);
    v2.rot(a, 1);
    expect(a).toEqual(before);
  });
});
