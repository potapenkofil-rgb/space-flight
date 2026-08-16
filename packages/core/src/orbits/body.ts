/**
 * Concrete `Body` construction. PLAN.md §4 defines `Body` as an interface with
 * `positionAt`/`velocityAt` methods but no constructor — {@link createBody} is
 * Agent A's factory for it, resolving positions through the parent chain
 * (PLAN.md §7, Agent A: "Body.positionAt/velocityAt through the parent chain").
 *
 * Not itself part of the frozen §4 signature list (only the `Body` interface
 * is), but Agent E's data loader needs some way to build `Body` instances from
 * `data/systems/*.json` without reimplementing this recursion — import
 * `createBody` from `@karman/core` for that.
 */
import { v2, ZERO, type Vec2 } from '../math/vec2';
import { stateFromOrbit } from './kepler';
import type { Atmosphere, Body, Orbit } from './types';

/** Inputs needed to construct one `Body`. `soiRadius` is derived, not accepted — PLAN.md §5.1. */
export interface BodyParams {
  readonly id: string;
  /** Standard gravitational parameter `μ = G·M`, m³/s². */
  readonly mu: number;
  /** Mean radius of the solid/liquid surface, m. */
  readonly radius: number;
  /** Sidereal rotation period, s. */
  readonly rotationPeriod: number;
  readonly atmosphere: Atmosphere | null;
  /** Parent body this one orbits, or `null` for the system root. */
  readonly parent: Body | null;
  /** This body's own orbit around `parent`. Must be `null` iff `parent` is `null`. */
  readonly orbit: Orbit | null;
}

/**
 * Builds a `Body` whose `positionAt`/`velocityAt` resolve absolute coordinates
 * by walking up the `parent` chain, and whose `soiRadius` is derived from
 * `R_soi = a·(μ_body/μ_parent)^0.4` (PLAN.md §5.1). The root of a system (no
 * parent) gets `soiRadius = Infinity` — there is nothing further out to escape
 * into within a single `SystemLibrary`.
 */
export function createBody(params: BodyParams): Body {
  const { id, mu, radius, rotationPeriod, atmosphere, parent, orbit } = params;

  if (parent === null && orbit !== null) {
    throw new Error(`createBody(${id}): the root body (parent=null) must not have an orbit`);
  }
  if (parent !== null && orbit === null) {
    throw new Error(`createBody(${id}): a non-root body must have an orbit around its parent`);
  }

  const soiRadius = parent === null ? Infinity : orbit!.a * (mu / parent.mu) ** 0.4;

  const body: Body = {
    id,
    mu,
    radius,
    soiRadius,
    rotationPeriod,
    atmosphere,
    parent,
    orbit,
    positionAt(t: number): Vec2 {
      if (parent === null) return ZERO;
      return v2.add(parent.positionAt(t), stateFromOrbit(orbit!, t).r);
    },
    velocityAt(t: number): Vec2 {
      if (parent === null) return ZERO;
      return v2.add(parent.velocityAt(t), stateFromOrbit(orbit!, t).v);
    },
  };

  return body;
}
