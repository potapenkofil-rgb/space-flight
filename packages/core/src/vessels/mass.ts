/** Aggregate mass properties of a vessel — dry mass, resources, centre of mass, inertia. */
import type { MassProperties, Vessel } from './vessel';

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
  void v;
  throw new Error('not implemented: computeMass');
}
