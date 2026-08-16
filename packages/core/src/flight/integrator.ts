/**
 * The off-rails (numerical) flight integrator (PLAN.md §3.3/§3.4/§3.5). Advances
 * one vessel by exactly one fixed physics tick using symplectic (velocity) Verlet:
 * gravity, thrust, drag, torques and ground contact all apply here.
 */
import type { Vessel } from '../vessels/vessel';
import type { ControlInput, FlightEnvironment } from './types';

/**
 * Advances `v` by exactly `dt` seconds of simulation time in place: integrates
 * gravity + thrust + drag + torque with symplectic Verlet, applies ground
 * contact response (PLAN.md §3.5) if any contact point has penetrated the
 * surface, consumes propellant (via `consumeFuel`) and refreshes `v.mass`.
 * Does **not** decide on/off-rails transitions or structural breakage — callers
 * run `evaluateStructure`/`splitVessel` separately using this tick's loads.
 *
 * @param v the vessel to advance (mutated in place: position, velocity,
 *   rotation, angularVelocity, part resources, mass)
 * @param dt fixed physics tick length, s — PLAN.md §3.2 mandates exactly `1/60`
 *   in practice, but this function must accept any positive `dt` so it stays
 *   unit-testable without depending on the app's timing loop
 * @param env ambient gravity/atmosphere for this tick (see `FlightEnvironment`)
 * @param input this tick's player/autopilot commands
 */
export function stepFlight(
  v: Vessel,
  dt: number,
  env: FlightEnvironment,
  input: ControlInput
): void {
  void v;
  void dt;
  void env;
  void input;
  throw new Error('not implemented: stepFlight');
}
