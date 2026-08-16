/** Aggregate mass properties of a vessel — dry mass, resources, centre of mass, inertia. */
import { v2, ZERO, type Vec2 } from '../math/vec2';
import type { MassProperties, PartInstance, Vessel } from './vessel';

/**
 * Instantaneous mass of one part instance: dry mass plus every resource
 * currently held, kg. Every `ResourceCapacity` is treated as mass-bearing
 * (1 unit = 1 kg) — PLAN.md §6.1 documents capacities as "kg for propellants"
 * without a separate massless-resource flag, so this is the simplest reading
 * consistent with the contract; see report.
 */
export function partMass(part: PartInstance): number {
  let m = part.def.dryMass;
  // Sorted keys: determinism independent of object-key insertion order (PLAN.md §3.6).
  for (const key of Object.keys(part.resources).sort()) {
    m += part.resources[key] ?? 0;
  }
  return m;
}

/**
 * A part's own centre of mass in the vessel's local frame. Per DESIGN.md §4,
 * a part's local origin `(0,0)` is its *bottom* attach node and its local +Y
 * points toward the nose, so — assuming uniform density along the part's own
 * body, with no data field giving a finer offset — its centroid sits at local
 * `(0, bounds.h/2)`, rotated into the vessel frame and translated by `position`.
 */
function partCentroidLocal(part: PartInstance): Vec2 {
  const localUp = v2.rot({ x: 0, y: part.def.bounds.h / 2 }, part.rotation);
  return v2.add(part.position, localUp);
}

/** Sorts parts by id ascending — the deterministic traversal order PLAN.md §3.6/§5.3 mandates. */
function byIdAscending(a: PartInstance, b: PartInstance): number {
  return a.id - b.id;
}

/**
 * Recomputes `MassProperties` (total mass, centre of mass, moment of inertia)
 * from a vessel's current part tree and resource levels. Pure — does not mutate
 * `v.mass`; callers are responsible for storing the result back (`v.mass =
 * computeMass(v)`) after resource consumption or staging changes.
 *
 * @param v the vessel to measure
 * @returns total mass (kg), centre of mass (m, vessel-local), inertia about the
 *   centre of mass (kg·m²)
 */
export function computeMass(v: Vessel): MassProperties {
  const parts = [...v.parts].sort(byIdAscending);
  if (parts.length === 0) {
    return { total: 0, com: ZERO, inertia: 0 };
  }

  let total = 0;
  let sumX = 0;
  let sumY = 0;
  const measured: Array<{ mass: number; centroid: Vec2; w: number; h: number }> = [];
  for (const part of parts) {
    const mass = partMass(part);
    const centroid = partCentroidLocal(part);
    total += mass;
    sumX += mass * centroid.x;
    sumY += mass * centroid.y;
    measured.push({ mass, centroid, w: part.def.bounds.w, h: part.def.bounds.h });
  }

  const com: Vec2 = total > 0 ? { x: sumX / total, y: sumY / total } : ZERO;

  let inertia = 0;
  for (const { mass, centroid, w, h } of measured) {
    // Own inertia about the part's own centroid, modeled as a uniform rectangular
    // plate (PLAN.md gives no per-part inertia field to do better than this).
    const selfInertia = (mass * (w * w + h * h)) / 12;
    const offset = v2.sub(centroid, com);
    inertia += selfInertia + mass * v2.len2(offset);
  }

  return { total, com, inertia };
}
