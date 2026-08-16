/**
 * Static part definitions: the immutable, data-driven templates loaded from
 * `data/parts/<id>/part.json` (see PLAN.md §6.1). A `PartDef` never changes at
 * runtime — per-vessel mutable state (resource levels, position in the vessel)
 * lives in `PartInstance` (vessel.ts).
 */
import type { Vec2 } from '../math/vec2';

/** A name/description pair for the two supported UI languages (PLAN.md §6.1, DESIGN.md §6). */
export interface LocalizedText {
  readonly en: string;
  readonly ru: string;
}

/** One resource a part can hold, e.g. `{ id: "fuel", capacity: 2700 }`. */
export interface ResourceCapacity {
  /** Resource identifier, e.g. `"fuel"`, `"rcsFuel"`, `"electricity"`. Matches `EngineSpec.fuel`. */
  readonly id: string;
  /** Maximum amount this part can hold, in the resource's own unit (kg for propellants). */
  readonly capacity: number;
}

/**
 * Catalog grouping used by the hangar's part browser (Agent C) and derived from the
 * 25-part v1 roster in PLAN.md §7 (Agent E).
 */
export type PartCategory =
  | 'pod'
  | 'tanks'
  | 'engines'
  | 'boosters'
  | 'separators'
  | 'fairings'
  | 'parachutes'
  | 'legs'
  | 'rcs'
  | 'power'
  | 'docking'
  | 'adapters'
  | 'control'
  | 'structural'
  | 'lights';

/** How an attachment node connects to its neighbour. */
export type NodeKind = 'stack' | 'radial' | 'docking';

/** A point on a part's surface where another part (or the vessel root) can attach. */
export interface AttachNode {
  /** Position in the part's local space, m (origin is the part's bottom stack node, PLAN.md §6.1). */
  readonly pos: Vec2;
  /** Outward-facing unit direction of the node, dimensionless. */
  readonly dir: Vec2;
  /** Node size class (stack diameter tier); larger parts only attach to nodes of equal or compatible size. */
  readonly size: number;
  readonly kind: NodeKind;
}

/**
 * Raw art payload for a part. `@karman/core` intentionally stores only the raw
 * SVG source and its metadata — parsing into `Path2D` requires `DOMParser`,
 * which only exists in the browser, so that step lives in `@karman/app`
 * (PLAN.md §3.7).
 */
export interface PartArt {
  /** SVG `viewBox` size, e.g. `{ w: 64, h: 64 }` (PLAN.md §6.1: always `0 0 64 64`). */
  readonly viewBox: { readonly w: number; readonly h: number };
  /** Raw `<svg>...</svg>` markup. Colors are role names (`fill="Panel"`), not hex (PLAN.md §3.7). */
  readonly svg: string;
}

/**
 * Engine performance data. Thrust and Isp are both given at vacuum and at sea
 * level and interpolated by ambient pressure (PLAN.md §5.2): `F = lerp(F_sl,
 * F_vac, 1 − p/p₀)`, same formula for Isp.
 */
export interface EngineSpec {
  /** Thrust in vacuum, N. */
  readonly thrustVac: number;
  /** Thrust at sea level (1 atm), N. */
  readonly thrustSl: number;
  /** Specific impulse in vacuum, s. */
  readonly ispVac: number;
  /** Specific impulse at sea level (1 atm), s. */
  readonly ispSl: number;
  /** Maximum gimbal deflection, rad. */
  readonly gimbal: number;
  /** Minimum stable throttle, `0..1` (dimensionless fraction of max thrust). */
  readonly minThrottle: number;
  /** Resource id this engine burns, e.g. `"fuel"`. Matches a `ResourceCapacity.id` reachable via crossfeed. */
  readonly fuel: string;
}

/** The immutable definition of a part, shared by every placed instance of it. */
export interface PartDef {
  /** Stable identifier, e.g. `"tank_s1"`. Matches the `data/parts/<id>/` folder name. */
  readonly id: string;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  readonly category: PartCategory;
  /** Mass with all resources empty, kg. */
  readonly dryMass: number;
  readonly resources: ResourceCapacity[];
  /** `null` for non-engine parts. */
  readonly engine: EngineSpec | null;
  /** Drag coefficient times reference area, `Cd·A`, m². Used in `F = ½·ρ·v²·Σ(Cd·A)` (PLAN.md §5.2). */
  readonly dragArea: number;
  /** Axial load an attach node on this part can carry before breaking, N (PLAN.md §5.6). */
  readonly nodeStrength: number;
  /** Maximum safe vertical touchdown speed, m/s. Only meaningful on landing-leg parts; `0` otherwise. */
  readonly maxLandingSpeed: number;
  /** Whether propellant can flow *through* this part to parts further up the stack (PLAN.md §5.3). */
  readonly crossfeed: boolean;
  readonly nodes: AttachNode[];
  /** Part footprint in its local space, m. */
  readonly bounds: { w: number; h: number };
  readonly art: PartArt;
}
