/**
 * Orbits, bodies and trajectory prediction. See PLAN.md §3.3 and §5.1 for the
 * physical model (patched conics, off-rails/on-rails), and §4 for the exact
 * contract these types must satisfy — six other agents import them verbatim.
 */
import type { Vec2 } from '../math/vec2';

/**
 * A Keplerian conic section around one `Body`. Valid for ellipses (`0 ≤ e < 1`),
 * parabolas (`e === 1`) and hyperbolas (`e > 1`); `a` is negative for hyperbolas
 * by convention (see PLAN.md §4).
 */
export interface Orbit {
  /** Semi-major axis, m. Negative for a hyperbolic orbit. */
  readonly a: number;
  /** Eccentricity, dimensionless. `0` = circle, `<1` = ellipse, `1` = parabola, `>1` = hyperbola. */
  readonly e: number;
  /** Argument of periapsis, rad, measured in the body's equatorial/orbital plane. */
  readonly argPe: number;
  /** Mean anomaly at `epoch`, rad. */
  readonly m0: number;
  /** Epoch time `t₀` at which the orbit's anomaly equals `m0`, s (simulation time). */
  readonly epoch: number;
  /** Standard gravitational parameter `μ` of the body this orbit is around, m³/s². */
  readonly mu: number;
  /** Direction of travel: `1` = counter-clockwise (prograde), `-1` = clockwise (retrograde). */
  readonly dir: 1 | -1;
}

/**
 * Computes the osculating `Orbit` from a Cartesian state vector at time `t`.
 * Inverse of {@link stateFromOrbit}; the round trip must be accurate to a
 * relative error no worse than `1e-9` (PLAN.md §3.3).
 *
 * @param r position relative to the body's centre, m
 * @param v velocity relative to the body's centre, m/s
 * @param mu standard gravitational parameter of the body, m³/s²
 * @param t simulation time of this state, s
 */
export function orbitFromState(r: Vec2, v: Vec2, mu: number, t: number): Orbit {
  void r;
  void v;
  void mu;
  void t;
  throw new Error('not implemented: orbitFromState');
}

/**
 * Computes the Cartesian state vector of an `Orbit` at time `t`.
 * Inverse of {@link orbitFromState}.
 *
 * @param o the orbit
 * @param t simulation time to evaluate at, s
 * @returns position `r` (m) and velocity `v` (m/s) relative to the body's centre
 */
export function stateFromOrbit(o: Orbit, t: number): { r: Vec2; v: Vec2 } {
  void o;
  void t;
  throw new Error('not implemented: stateFromOrbit');
}

/**
 * Solves Kepler's equation `M = E − e·sin(E)` for the eccentric anomaly `E`.
 * Implementations must use a Newton solver with a bisection fallback: Newton
 * diverges as `e → 1` for some `M`, and the fallback prevents that from hanging
 * (PLAN.md, Agent A acceptance criteria: converges in < 20 iterations at `e = 0.999`).
 *
 * @param meanAnomaly mean anomaly `M`, rad
 * @param e eccentricity, dimensionless (`0 ≤ e`; behaviour for `e ≥ 1` is
 *   parabolic/hyperbolic anomaly and is defined by the implementation)
 * @returns eccentric anomaly `E`, rad (or the hyperbolic analogue for `e > 1`)
 */
export function eccentricAnomaly(meanAnomaly: number, e: number): number {
  void meanAnomaly;
  void e;
  throw new Error('not implemented: eccentricAnomaly');
}

/** Apoapsis distance from the body's centre, m. `+Infinity` for `e ≥ 1` (no apoapsis). */
export function apoapsis(o: Orbit): number {
  void o;
  throw new Error('not implemented: apoapsis');
}

/** Periapsis distance from the body's centre, m. */
export function periapsis(o: Orbit): number {
  void o;
  throw new Error('not implemented: periapsis');
}

/** Orbital period, s. `NaN` for parabolic/hyperbolic orbits (`e ≥ 1`), which never repeat. */
export function period(o: Orbit): number {
  void o;
  throw new Error('not implemented: period');
}

/**
 * Time (absolute simulation time, s) at which the orbit reaches true anomaly `nu`,
 * searching forward from `from`. For elliptical orbits this is periodic; for
 * parabolic/hyperbolic orbits `nu` is only reached once (or never, outside the
 * asymptotic range) and the search does not wrap.
 *
 * @param o the orbit
 * @param nu target true anomaly, rad
 * @param from simulation time to search forward from, s
 */
export function timeToTrueAnomaly(o: Orbit, nu: number, from: number): number {
  void o;
  void nu;
  void from;
  throw new Error('not implemented: timeToTrueAnomaly');
}

/** Atmospheric model of a `Body`, per PLAN.md §5.2: `ρ(h) = ρ₀·exp(−h/H)`, clamped to 0 above `top`. */
export interface Atmosphere {
  /** Sea-level density `ρ₀`, kg/m³. */
  readonly rho0: number;
  /** Scale height `H`, m. */
  readonly scaleHeight: number;
  /** Altitude above which density is exactly 0, m. */
  readonly top: number;
}

/** A celestial body: planet or moon. Bodies form a tree via `parent`/`orbit`. */
export interface Body {
  /** Stable identifier, e.g. `"terra"`, `"luna"`. Matches `data/systems/*.json`. */
  readonly id: string;
  /** Standard gravitational parameter `μ = G·M`, m³/s². */
  readonly mu: number;
  /** Mean radius of the solid/liquid surface, m. */
  readonly radius: number;
  /** Sphere-of-influence radius, m (see PLAN.md §5.1: `R_soi = a·(μ_body/μ_parent)^0.4`). */
  readonly soiRadius: number;
  /** Sidereal rotation period, s. */
  readonly rotationPeriod: number;
  /** Atmosphere model, or `null` if the body has no atmosphere. */
  readonly atmosphere: Atmosphere | null;
  /** Parent body this one orbits, or `null` for the root of the system (e.g. Terra). */
  readonly parent: Body | null;
  /** This body's own orbit around `parent`, or `null` for the root. */
  readonly orbit: Orbit | null;
  /**
   * Absolute position at time `t`, m, resolved through the full parent chain
   * (i.e. already includes the parent's own position, recursively).
   */
  positionAt(t: number): Vec2;
  /** Absolute velocity at time `t`, m/s, resolved through the full parent chain. */
  velocityAt(t: number): Vec2;
}

/** Why a `ConicSegment` ended. See PLAN.md §3.3/§5.1 and Agent A's acceptance criteria. */
export type SegmentEnd = 'soi-entry' | 'soi-exit' | 'impact' | 'escape' | 'time-limit';

/** One leg of a predicted trajectory: a single conic around a single body, valid for one time span. */
export interface ConicSegment {
  /** `Body.id` this segment's orbit is relative to. */
  readonly bodyId: string;
  /** The conic for this segment. */
  readonly orbit: Orbit;
  /** Simulation time this segment begins, s. */
  readonly startTime: number;
  /** Simulation time this segment ends, s. */
  readonly endTime: number;
  /** Why the segment ends at `endTime`. */
  readonly endReason: SegmentEnd;
  /** `Body.id` of the next segment's body (on `soi-entry`/`soi-exit`), or `null` otherwise. */
  readonly nextBodyId: string | null;
}

/**
 * Minimal read-only vessel state needed to predict a ballistic (on-rails) trajectory:
 * a position and velocity relative to the body whose SOI the vessel currently occupies,
 * at a given time. Does not include mass, attitude or parts — prediction under
 * patched conics is a pure two-body problem (PLAN.md §3.3/§5.1).
 */
export interface VesselState {
  /** Position relative to `soi`'s centre, m. */
  readonly position: Vec2;
  /** Velocity relative to `soi`'s centre, m/s. */
  readonly velocity: Vec2;
  /** The body whose sphere of influence this state is expressed relative to. */
  readonly soi: Body;
  /** Simulation time of this state, s. */
  readonly t: number;
}

/** Predicts a vessel's future trajectory as a chain of `ConicSegment`s across SOI changes. */
export interface TrajectoryPredictor {
  /**
   * Predicts forward from `state.t` up to `horizonSeconds` of simulation time
   * (s), or until `maxSegments` segments have been produced, whichever comes
   * first. Each SOI transition, impact, escape from the root body, or the time
   * horizon itself ends the current segment (see `SegmentEnd`).
   */
  predict(state: VesselState, horizonSeconds: number, maxSegments: number): ConicSegment[];
}
