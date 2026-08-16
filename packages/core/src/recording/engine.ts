/**
 * The injectable "world step" used to replay recorded flights (PLAN.md §3.6/§7
 * Agent F). Rewinding means "load the nearest snapshot, then replay commands
 * forward without rendering" — which requires re-running the *same* physics
 * the live flight loop used, tick for tick.
 *
 * At the time this module was written, Agent A's orbit mechanics
 * (`orbitFromState`/`stateFromOrbit`) and Agent B's `stepFlight` were still
 * `throw new Error('not implemented')` stubs in this worktree — §7 for this
 * agent explicitly says not to implement someone else's contract, and to
 * depend on it only through the existing exported signatures. So `recording/`
 * never imports `stepFlight` directly: every place that needs to advance a
 * vessel takes a `WorldStepFn` as a parameter, defaulting to nothing baked in.
 *
 * Wiring instructions for whoever integrates the finished branches (see this
 * agent's report): construct the real `WorldStepFn` once orbits + flight are
 * implemented, e.g.
 *
 * ```ts
 * const stepWorld: WorldStepFn = (vessels, t, dt, step) =>
 *   vessels.map((v) => {
 *     if (v.id !== step.activeVesselId) {
 *       // Inactive vessels are always on-rails (PLAN.md §3.3): recompute
 *       // analytically, independent of dt/warp factor.
 *       if (!v.railOrbit) return v;
 *       const { r, v: vel } = stateFromOrbit(v.railOrbit, t);
 *       return { ...v, position: r, velocity: vel };
 *     }
 *     const env = deriveFlightEnvironment(v, t); // gravity/atmosphere from v.soi/v.position
 *     const next = cloneVessel(v);
 *     stepFlight(next, dt, env, step.input);
 *     const loads = measureLoads(next); // from the same tick's forces
 *     const breaks = evaluateStructure(next, loads);
 *     if (breaks.length === 0) return next;
 *     return splitVessel(next, breaks); // flattened into the returned array below
 *   }).flat();
 * ```
 *
 * and pass it as `RecorderOptions.stepWorld` (recorder.ts) and
 * `startFromReplay`'s `options.stepWorld`.
 */
import type { ControlInput } from '../flight/types';
import type { Vessel } from '../vessels/vessel';

/** Which vessel is under player/autopilot control this tick, and what it was told to do. */
export interface WorldStepInput {
  /** `Vessel.id` of the actively-controlled vessel this tick. */
  readonly activeVesselId: number;
  /** The command for the active vessel. Inactive vessels never receive direct input — they're always on-rails (PLAN.md §3.3). */
  readonly input: ControlInput;
}

/**
 * Advances every vessel in the registry by exactly one physics tick, in
 * place semantics via return value (implementations should treat `vessels`
 * as read-only and return a fresh array — this mirrors `splitVessel`, which
 * can change the vessel count on a structural break or stage separation).
 *
 * Must be **deterministic**: the same `(vessels, t, dt, step)` must always
 * produce the same result (PLAN.md §3.6) — no `Math.random`, no wall-clock
 * reads, no iteration over `Map`/`Set` without a stable sort.
 *
 * @param vessels every vessel that currently exists, in deterministic `Vessel.id` order
 * @param t simulation time at the *start* of this tick, s
 * @param dt fixed physics tick length, s (PLAN.md §3.2: `1/60` in practice)
 * @param step which vessel is active and what it was commanded to do
 * @returns the resulting vessel roster (same length unless a split/merge occurred), in `Vessel.id` order
 */
export type WorldStepFn = (
  vessels: readonly Vessel[],
  t: number,
  dt: number,
  step: WorldStepInput
) => readonly Vessel[];
