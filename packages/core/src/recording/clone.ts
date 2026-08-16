/**
 * Deep-enough vessel cloning for the black box and for save games. `Vessel`
 * mixes truly-immutable data (per `math/vec2.ts`, `Vec2`/`Orbit`/`MassProperties`
 * values are never mutated in place — a fresh object is always assigned) with
 * mutable substructures that flight code *does* mutate in place
 * (`consumeFuel` mutates `PartInstance.resources`, per its own TSDoc). A
 * snapshot or a save must be immune to those later in-place mutations, so this
 * clones exactly the parts that need it and shares references to everything
 * that's already treated as immutable.
 */
import type { PartInstance, Stage, Vessel } from '../vessels/vessel';

function clonePartInstance(part: PartInstance): PartInstance {
  return {
    id: part.id,
    partId: part.partId,
    position: part.position,
    rotation: part.rotation,
    resources: { ...part.resources },
  };
}

function cloneStage(stage: Stage): Stage {
  return { index: stage.index, partIds: stage.partIds.slice() };
}

/**
 * Returns an independent copy of `v`: later in-place mutation of the
 * original's parts/resources/joints/stages cannot affect the clone (or vice
 * versa). `position`, `velocity`, `railOrbit` and `mass` are shared by
 * reference — safe because nothing in the codebase mutates a `Vec2`, `Orbit`
 * or `MassProperties` value in place; they're always replaced wholesale.
 * `soi` (a `Body`) is shared by reference too — bodies are static content,
 * never mutated per vessel.
 */
export function cloneVessel(v: Vessel): Vessel {
  return {
    id: v.id,
    parts: v.parts.map(clonePartInstance),
    joints: v.joints.slice(),
    stages: v.stages.map(cloneStage),
    currentStage: v.currentStage,
    position: v.position,
    velocity: v.velocity,
    rotation: v.rotation,
    angularVelocity: v.angularVelocity,
    soi: v.soi,
    railOrbit: v.railOrbit,
    mass: v.mass,
  };
}

/** Clones every vessel in `vessels`, preserving order. */
export function cloneVessels(vessels: readonly Vessel[]): Vessel[] {
  return vessels.map(cloneVessel);
}
