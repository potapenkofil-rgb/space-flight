/**
 * A `Vessel` is the assembled, flyable rocket: a tree of `PartInstance`s connected
 * by `JointLink`s, grouped into `Stage`s. Per PLAN.md §3.4, a vessel is simulated
 * as **one rigid composite body** (aggregate mass/COM/inertia), never as N
 * separately-integrated part bodies — joints only matter for structural load
 * checks (`evaluateStructure`) and for splitting on breakage (`splitVessel`).
 */
import type { Vec2 } from '../math/vec2';
import type { Body, Orbit } from '../orbits/types';
import type { NodeKind } from './parts';

/**
 * One placed part aboard a vessel: a mutable instance of a `PartDef`.
 * `position`/`rotation` are in the vessel's local frame (metres/radians,
 * relative to the vessel's own origin — NOT world space; world placement comes
 * from `Vessel.position`/`Vessel.rotation`).
 */
export interface PartInstance {
  /** Instance id, unique within this vessel (stable across ticks; reused nowhere else). */
  readonly id: number;
  /** `PartDef.id` this instance was created from. */
  readonly partId: string;
  /** Position in the vessel's local frame, m. */
  position: Vec2;
  /** Orientation in the vessel's local frame, rad. */
  rotation: number;
  /** Current amount held of each resource, keyed by `ResourceCapacity.id`, in the resource's unit. */
  resources: Record<string, number>;
}

/**
 * A structural connection between two `PartInstance`s, formed at a specific pair
 * of attach nodes. `strength` is the load, in N, at which `evaluateStructure`
 * will report a `JointBreak` for this joint — per PLAN.md §5.6, the minimum of
 * the two connected parts' `nodeStrength`.
 */
export interface JointLink {
  /** Joint id, unique within this vessel. */
  readonly id: number;
  /** `PartInstance.id` of one side of the joint. */
  readonly a: number;
  /** `PartInstance.id` of the other side of the joint. */
  readonly b: number;
  readonly nodeKind: NodeKind;
  /** Load capacity of this joint, N — `min(a.nodeStrength, b.nodeStrength)` (PLAN.md §5.6). */
  readonly strength: number;
}

/**
 * A group of parts that activate together: engines that ignite, separators
 * that fire. `index` is the burn order (`0` = first to fire; typically the
 * *bottom* stage), matching `Vessel.currentStage`.
 */
export interface Stage {
  readonly index: number;
  /** `PartInstance.id`s that activate when this stage fires. */
  readonly partIds: readonly number[];
}

/** Cached aggregate mass properties of a vessel, about its own centre of mass. */
export interface MassProperties {
  /** Total mass (dry + all remaining resources) of every part, kg. */
  readonly total: number;
  /** Centre of mass, in the vessel's local frame, m. */
  readonly com: Vec2;
  /** Moment of inertia about the centre of mass, kg·m². */
  readonly inertia: number;
}

/**
 * An assembled, flyable rocket. One `Vessel` is either fully off-rails
 * (numerically integrated every physics tick, see `stepFlight`) or fully
 * on-rails (`railOrbit` is authoritative and `position`/`velocity` are derived
 * from it) — never a mix, per PLAN.md §3.3.
 */
export interface Vessel {
  /** Vessel id, unique within the world/vessel registry. */
  readonly id: number;
  parts: PartInstance[];
  joints: JointLink[];
  stages: Stage[];
  /** Index into `stages` of the next stage to fire. */
  currentStage: number;
  /** Position relative to `soi`'s centre, m. */
  position: Vec2;
  /** Velocity relative to `soi`'s centre, m/s. */
  velocity: Vec2;
  /** Vessel orientation, rad. */
  rotation: number;
  /** Angular velocity, rad/s. */
  angularVelocity: number;
  /** The body whose sphere of influence this vessel currently occupies. */
  soi: Body;
  /** Analytic Kepler orbit while on-rails; `null` while off-rails (PLAN.md §3.3). */
  railOrbit: Orbit | null;
  /**
   * Cached aggregate mass properties. Invalidated (must be recomputed via
   * `computeMass`) whenever resources are consumed or parts separate — callers
   * must not assume this cache updates itself.
   */
  mass: MassProperties;
}
