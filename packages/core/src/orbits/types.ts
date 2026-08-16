/**
 * Orbits, bodies and trajectory prediction. See PLAN.md §3.3 and §5.1 for the
 * physical model (patched conics, off-rails/on-rails), and §4 for the exact
 * contract these types must satisfy — six other agents import them verbatim.
 *
 * This file holds only the shapes from PLAN.md §4. Implementations live in
 * `kepler.ts` (state <-> orbit, Kepler's equation, apoapsis/periapsis/period),
 * `body.ts` (`createBody`, resolving `positionAt`/`velocityAt` through the
 * parent chain) and `predictor.ts` (`createTrajectoryPredictor`) — see
 * `orbits/index.ts` for the re-exports that keep this module's public surface
 * identical to before the split.
 */
import type { Vec2 } from '../math/vec2';

/**
 * A Keplerian conic section around one `Body`. Valid for ellipses (`0 ≤ e < 1`),
 * parabolas (`e === 1`) and hyperbolas (`e > 1`); `a` is negative for hyperbolas
 * by convention (see PLAN.md §4). For a parabola, `a` instead holds the
 * periapsis distance `q` (m) — see the "Convention for `Orbit.a`" note at the
 * top of `kepler.ts`, since §4 reserves no separate field for it.
 */
export interface Orbit {
  /** Semi-major axis, m. Negative for a hyperbolic orbit; periapsis distance `q`, m, for a parabola. */
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
