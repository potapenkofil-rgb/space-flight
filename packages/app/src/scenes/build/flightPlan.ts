/**
 * Flight plan: the hangar-exclusive feature from PLAN.md §7, Agent C's zone
 * (listed among "beyond SFS" features in PLAN.md §0: flight plan and ΔV in
 * the hangar). The player strings together steps (orbit → transfer → brake →
 * land); each step's required ΔV is derived from `SystemLibrary` body data
 * via vis-viva and Hohmann-transfer formulas — never a hardcoded number — so
 * a mod that swaps in a different planet gets correct figures automatically
 * (PLAN.md §7: otherwise the flight plan breaks on the very first mod that
 * changes the planet).
 *
 * Every formula here is standard two-body orbital mechanics, verified against
 * PLAN.md §5.7's own checked reference figures in `flightPlan.test.ts`
 * (circular LEO ≈ 2986 m/s, Terra→Luna transfer ≈ 896 m/s, Luna SOI ≈
 * 1 108 000 m) — those numbers were *derived*, not copied in, which is the
 * whole point of the exercise.
 */
import type { Body } from '@karman/core';

/** Local surface gravity `g = μ/r²`, m/s² (PLAN.md §5.1). */
function surfaceGravity(body: Body): number {
  return body.mu / (body.radius * body.radius);
}

/** Circular-orbit speed at radius `r` (m, from the body's centre) around a body of parameter `mu`. */
export function circularOrbitSpeed(mu: number, r: number): number {
  return Math.sqrt(mu / r);
}

/** Vis-viva: instantaneous speed at radius `r` on an orbit of semi-major axis `a`. */
export function visViva(mu: number, r: number, a: number): number {
  return Math.sqrt(mu * (2 / r - 1 / a));
}

export interface HohmannTransfer {
  /** ΔV of the departure burn at `r1`, m/s. */
  readonly dv1: number;
  /** ΔV of the arrival/circularization burn at `r2`, m/s. */
  readonly dv2: number;
  /** `dv1 + dv2`, m/s. */
  readonly total: number;
}

/** Two-impulse Hohmann transfer between circular orbits of radius `r1` and `r2` around a body of parameter `mu`. */
export function hohmannTransfer(mu: number, r1: number, r2: number): HohmannTransfer {
  const transferA = (r1 + r2) / 2;
  const v1Circular = circularOrbitSpeed(mu, r1);
  const v2Circular = circularOrbitSpeed(mu, r2);
  const dv1 = Math.abs(visViva(mu, r1, transferA) - v1Circular);
  const dv2 = Math.abs(v2Circular - visViva(mu, r2, transferA));
  return { dv1, dv2, total: dv1 + dv2 };
}

/**
 * Estimated gravity-loss overhead for a launch to orbit from `body`'s
 * surface, m/s: proportional to local surface gravity and a fixed nominal
 * ascent duration, so it scales sensibly for other bodies/mods (a higher-g
 * or thicker-atmosphere world costs more, an airless low-g moon costs
 * near-zero) even though it is *not* a substitute for Agent D's real
 * trajectory simulation — this hangar estimate exists so the flight plan has
 * *a* number before a real ascent has ever been flown.
 */
const NOMINAL_ASCENT_SECONDS = 83; // tuned so Terra (g=9.81) reproduces PLAN.md §5.7's own "~814 m/s" launch-loss figure
export function estimateAscentLosses(body: Body): number {
  const g = surfaceGravity(body);
  const atmosphereFactor = body.atmosphere ? 1 : 0.35; // airless bodies still pay a little steering/gravity loss, just far less
  return g * NOMINAL_ASCENT_SECONDS * atmosphereFactor;
}

export type FlightStepKind = 'orbit' | 'transfer' | 'brake' | 'land';

export interface FlightStepDef {
  readonly kind: FlightStepKind;
  /** The body this step's orbit/transfer/landing is relative to. */
  readonly bodyId: string;
  /** Target/parking altitude above the body's surface, m — meaningless for `transfer` (computed from both endpoints instead). */
  readonly altitudeM: number;
  /** For a `transfer` step: the body being transferred *to*. */
  readonly toBodyId?: string;
}

export interface FlightStepResult extends FlightStepDef {
  readonly requiredDeltaV: number;
}

/** `body.get`-style lookup, kept minimal so this module doesn't need the full `SystemLibrary` contract just to resolve two ids. */
export type BodyLookup = (id: string) => Body;

/**
 * Computes the required ΔV for one flight-plan step, from `SystemLibrary`
 * body data (never hardcoded — see file header).
 */
export function computeStepDeltaV(step: FlightStepDef, getBody: BodyLookup): number {
  const body = getBody(step.bodyId);
  const r = body.radius + step.altitudeM;

  switch (step.kind) {
    case 'orbit':
      return circularOrbitSpeed(body.mu, r) + estimateAscentLosses(body);
    case 'transfer': {
      if (!step.toBodyId) throw new Error('computeStepDeltaV: a "transfer" step needs toBodyId');
      const target = getBody(step.toBodyId);
      if (!target.orbit || target.parent !== body) {
        throw new Error(`computeStepDeltaV: "${step.toBodyId}" must orbit "${step.bodyId}" directly`);
      }
      // The first (departure) burn of a Hohmann transfer from the parking
      // orbit up to the target body's own orbital radius around the same parent.
      return hohmannTransfer(body.mu, r, target.orbit.a).dv1;
    }
    case 'brake': {
      // Capture-into-orbit estimate: the target body's own low-orbit circular
      // speed, a standard simplification (PLAN.md doesn't fix an exact
      // patched-conic capture cost for the hangar; the real number comes from
      // the map's maneuver-node predictor once a trajectory is actually flown).
      return circularOrbitSpeed(body.mu, r);
    }
    case 'land': {
      // Deorbit + suicide-burn estimate for an airless body: comparable to the
      // low-orbit circular speed being cancelled out.
      return circularOrbitSpeed(body.mu, r);
    }
  }
}

export interface FlightPlanVerdict {
  readonly steps: readonly FlightStepResult[];
  readonly totalRequired: number;
  readonly available: number;
  readonly sufficient: boolean;
  readonly margin: number; // available - totalRequired; negative when insufficient
}

/** Evaluates a whole flight plan (an ordered list of steps) against the ΔV the ship actually has. */
export function evaluateFlightPlan(
  steps: readonly FlightStepDef[],
  getBody: BodyLookup,
  availableDeltaV: number
): FlightPlanVerdict {
  const resolved = steps.map((step) => ({ ...step, requiredDeltaV: computeStepDeltaV(step, getBody) }));
  const totalRequired = resolved.reduce((sum, s) => sum + s.requiredDeltaV, 0);
  return {
    steps: resolved,
    totalRequired,
    available: availableDeltaV,
    sufficient: availableDeltaV >= totalRequired,
    margin: availableDeltaV - totalRequired,
  };
}
