/**
 * A cosmetic, deterministically-seeded star field for the empty-scene skeleton
 * (PLAN.md §7 item 7). Stars are generated once in world space and drawn
 * through the same floating-origin `Camera` as everything else, so panning and
 * zooming the demo scene visibly exercises the camera math.
 */
import type { Vec2 } from '@karman/core';

export interface Star {
  readonly position: Vec2; // m, world space, scattered around the origin
  readonly radiusPx: number; // screen px, constant regardless of zoom (stars are infinitely far away)
  readonly brightness: number; // 0..1
}

/** Small deterministic PRNG (mulberry32) — avoids `Math.random` so the field is stable across reloads. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates `count` stars scattered uniformly within `radiusMeters` of the
 * world origin. `radiusMeters` should comfortably exceed the largest zoom-out
 * distance the demo camera reaches, so stars don't visibly "run out".
 */
export function createStarfield(count: number, radiusMeters: number, seed = 1): Star[] {
  const rand = mulberry32(seed);
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const angle = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * radiusMeters;
    stars.push({
      position: { x: Math.cos(angle) * r, y: Math.sin(angle) * r },
      radiusPx: 0.6 + rand() * 1.4,
      brightness: 0.35 + rand() * 0.65,
    });
  }
  return stars;
}
