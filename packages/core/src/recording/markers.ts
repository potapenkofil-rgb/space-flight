/**
 * Timeline event detection for the black box (PLAN.md §7 Agent F): launch,
 * staging, part loss, atmosphere entry, apoapsis/periapsis, landing/impact.
 * Pure and incremental — `MarkerDetector.observe` is called once per recorded
 * tick with just that tick's vessel roster and consumes O(1) history, so it
 * costs nothing extra beyond what `FlightRecorder.tick` already does.
 *
 * Deliberately self-contained: it only reads `Vessel.position/velocity/soi`
 * (already implemented — `math/vec2.ts` and `orbits/types.ts`'s `Body`
 * shape), never `railOrbit` apoapsis/periapsis helpers (`orbits/index.ts`'s
 * `apoapsis`/`periapsis` are Agent A's not-implemented stubs in this
 * worktree) — so marker detection works before and after Agent A's branch
 * lands, off-rails or on-rails, without caring which.
 */
import { v2 } from '../math/vec2';
import type { Vessel } from '../vessels/vessel';
import type { ReplayMarker } from './types';

/** Vertical (radial) speed below this, m/s, counts as a soft touchdown rather than a crash.
 *  A generic heuristic — the real per-leg threshold is `PartDef.maxLandingSpeed`
 *  (PLAN.md §6.1), which this generic, part-library-agnostic detector doesn't
 *  have access to. Good enough for a timeline marker; not used for gameplay pass/fail. */
const LANDING_SPEED_THRESHOLD = 8;

interface VesselHistory {
  radius: number;
  altitude: number | null; // null when the vessel has no atmosphere at all
  aboveGround: boolean;
}

/** Incrementally detects `ReplayMarker`s from a sequence of `(t, vessels, ...)` ticks. */
export interface MarkerDetector {
  /**
   * Feeds one tick's state to the detector. `activeVesselId`/`staged` describe
   * the command that produced `vessels` (used to tell voluntary staging apart
   * from a structural break, and to know whose orbit to watch for
   * apoapsis/periapsis/atmosphere/landing).
   *
   * @returns newly-confirmed markers this call (may be empty; apoapsis/periapsis
   *   are confirmed one tick late, once the following sample proves the extremum)
   */
  observe(t: number, vessels: readonly Vessel[], activeVesselId: number, staged: boolean): ReplayMarker[];
}

export function createMarkerDetector(): MarkerDetector {
  let tickIndex = 0;
  let prevVesselCount: number | null = null;
  let history: VesselHistory | null = null;
  // 3-point radius window for local-extremum (apoapsis/periapsis) detection.
  let r2: { t: number; radius: number } | null = null; // two ticks ago
  let r1: { t: number; radius: number } | null = null; // one tick ago

  return {
    observe(t, vessels, activeVesselId, staged) {
      const out: ReplayMarker[] = [];
      const active = vessels.find((v) => v.id === activeVesselId) ?? vessels[0];

      if (tickIndex === 0) {
        out.push({ t, kind: 'launch', vesselId: active ? active.id : activeVesselId });
      }

      if (active) {
        const radius = v2.len(active.position);
        const bodyRadius = active.soi.radius;
        const atmosphereTop = active.soi.atmosphere?.top ?? null;
        const altitude = radius - bodyRadius;
        const aboveGround = radius > bodyRadius;

        if (history) {
          if (atmosphereTop !== null && history.altitude !== null && history.altitude >= atmosphereTop && altitude < atmosphereTop) {
            out.push({ t, kind: 'atmosphere-entry', vesselId: active.id });
          }
          if (history.aboveGround && !aboveGround) {
            const radial = v2.len2(active.position) > 0 ? v2.dot(active.velocity, v2.norm(active.position)) : 0;
            const speed = Math.abs(radial) > 0 ? Math.abs(radial) : v2.len(active.velocity);
            out.push({
              t,
              kind: speed <= LANDING_SPEED_THRESHOLD ? 'landing' : 'impact',
              vesselId: active.id,
            });
          }
        }

        history = { radius, altitude, aboveGround };

        if (r2 && r1) {
          if (r1.radius > r2.radius && r1.radius > radius) {
            out.push({ t: r1.t, kind: 'apoapsis', vesselId: active.id });
          } else if (r1.radius < r2.radius && r1.radius < radius) {
            out.push({ t: r1.t, kind: 'periapsis', vesselId: active.id });
          }
        }
        r2 = r1;
        r1 = { t, radius };
      }

      if (prevVesselCount !== null && vessels.length > prevVesselCount) {
        out.push({
          t,
          kind: staged ? 'stage-separation' : 'part-loss',
          vesselId: activeVesselId,
        });
      }
      prevVesselCount = vessels.length;

      tickIndex += 1;
      out.sort((a, b) => a.t - b.t);
      return out;
    },
  };
}
