/**
 * 2D vector math. Every value is a plain, immutable `{x, y}` pair — there is no
 * mutable `Vec2` class, so every `v2` operation returns a brand-new object and never
 * modifies its inputs. Units are whatever the caller says they are (metres, metres
 * per second, etc.); this module itself is unit-agnostic.
 */

/** An immutable 2D vector or point. Units depend on context (m, m/s, m/s², ...). */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** The zero vector. Safe to share — vectors are immutable. */
export const ZERO: Vec2 = Object.freeze({ x: 0, y: 0 });

function make(x: number, y: number): Vec2 {
  return { x, y };
}

export const v2 = {
  /** Componentwise sum `a + b`. Same units as `a` and `b`. */
  add(a: Vec2, b: Vec2): Vec2 {
    return make(a.x + b.x, a.y + b.y);
  },

  /** Componentwise difference `a − b`. Same units as `a` and `b`. */
  sub(a: Vec2, b: Vec2): Vec2 {
    return make(a.x - b.x, a.y - b.y);
  },

  /** Scales `a` by scalar `k` (unitless multiplier). Result has the same units as `a`. */
  scale(a: Vec2, k: number): Vec2 {
    return make(a.x * k, a.y * k);
  },

  /** Euclidean length (magnitude) of `a`. Same unit as `a`'s components. */
  len(a: Vec2): number {
    return Math.hypot(a.x, a.y);
  },

  /** Squared length of `a` — cheaper than {@link len} when only comparing magnitudes. */
  len2(a: Vec2): number {
    return a.x * a.x + a.y * a.y;
  },

  /**
   * Unit vector in the direction of `a` (dimensionless, length 1).
   * Returns `{x:0, y:0}` for the zero vector instead of throwing or producing NaN,
   * since flight code frequently normalizes vectors that may transiently be zero
   * (e.g. zero relative velocity) and must keep running deterministically.
   */
  norm(a: Vec2): Vec2 {
    const l = Math.hypot(a.x, a.y);
    if (l === 0) return ZERO;
    return make(a.x / l, a.y / l);
  },

  /**
   * Rotates `a` counter-clockwise by `rad` radians around the origin.
   * `rad` is in radians, positive = counter-clockwise, consistent with a
   * right-handed, Y-up world (see PLAN.md §3.1).
   */
  rot(a: Vec2, rad: number): Vec2 {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return make(a.x * c - a.y * s, a.x * s + a.y * c);
  },

  /** Dot product `a · b`. Unit is the product of `a`'s and `b`'s units. */
  dot(a: Vec2, b: Vec2): number {
    return a.x * b.x + a.y * b.y;
  },

  /**
   * 2D "cross product" `a × b`, i.e. the z-component of the 3D cross product of
   * `(a.x, a.y, 0)` and `(b.x, b.y, 0)`. Positive when `b` is counter-clockwise
   * from `a`. Unit is the product of `a`'s and `b`'s units.
   */
  cross(a: Vec2, b: Vec2): number {
    return a.x * b.y - a.y * b.x;
  },
};
