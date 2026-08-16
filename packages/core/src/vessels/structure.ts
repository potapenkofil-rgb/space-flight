/**
 * Structural load evaluation and breakage (PLAN.md §3.4/§5.6). A vessel is one
 * rigid body for flight purposes; joints are only consulted here, to decide
 * whether the vessel should split apart this tick.
 */
import type { Vec2 } from '../math/vec2';
import type { Vessel } from './vessel';

/**
 * The forces acting on a vessel this tick, as needed to evaluate joint loads.
 * Per PLAN.md §5.6: `F_axial = m_subtree · |a| + F_aero_subtree` for each joint,
 * where the subtree is whichever side of the joint is farther from the vessel's
 * root/thrust source.
 */
export interface Loads {
  /** Linear acceleration of the vessel's centre of mass this tick, m/s² (world frame). */
  readonly acceleration: Vec2;
  /** Angular acceleration this tick, rad/s² — contributes bending loads at joints away from the COM. */
  readonly angularAcceleration: number;
  /**
   * Aerodynamic force on each part this tick, N (world frame), keyed by
   * `PartInstance.id`. Parts with no aerodynamic force (or outside the
   * atmosphere) may be omitted; missing entries are treated as zero.
   */
  readonly aeroForceByPart: ReadonlyMap<number, Vec2>;
}

/** One joint that failed under load this tick. */
export interface JointBreak {
  /** `JointLink.id` of the joint that broke. */
  readonly jointId: number;
  /** The axial load that exceeded the joint's `strength`, N. */
  readonly axialForce: number;
}

/**
 * Checks every joint in `v` against `loads` and reports which ones exceed their
 * `strength`. Pure — does not mutate `v`; pass the result to `splitVessel` to
 * actually separate the vessel.
 *
 * @param v the vessel to check
 * @param loads this tick's forces, as measured/estimated by the flight integrator
 * @returns joints whose axial load exceeds their strength, in deterministic
 *   `JointLink.id` order
 */
export function evaluateStructure(v: Vessel, loads: Loads): JointBreak[] {
  void v;
  void loads;
  throw new Error('not implemented: evaluateStructure');
}

/**
 * Splits `v` at the given broken joints. Removing `breaks` from `v.joints`
 * generally disconnects the part graph into several connected components; each
 * component becomes its own `Vessel`, inheriting the original vessel's velocity
 * and angular velocity (conservation of momentum — PLAN.md §3.4). The same
 * function backs both structural failure (called with joints that broke under
 * load) and voluntary stage separation (called with the joint(s) the player's
 * separator just fired).
 *
 * @param v the vessel to split
 * @param breaks the joints to remove (from `evaluateStructure`, or synthesized
 *   for a deliberate stage separation)
 * @returns the resulting vessels, in deterministic order (one per connected
 *   component of the remaining part graph); returns `[v]` unchanged if no
 *   component actually became disconnected
 */
export function splitVessel(v: Vessel, breaks: JointBreak[]): Vessel[] {
  void v;
  void breaks;
  throw new Error('not implemented: splitVessel');
}
