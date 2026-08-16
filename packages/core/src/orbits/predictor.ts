/**
 * `TrajectoryPredictor`: chains `ConicSegment`s forward through time across
 * SOI transitions, surface impact and the prediction horizon (PLAN.md §3.3,
 * §5.1, §7 Agent A). Each segment is a pure two-body Kepler orbit; the
 * boundary of each segment is found by sampling forward in time and then
 * bisecting the bracketed step to `SOI_BISECTION_TOLERANCE_S` (PLAN.md §7:
 * "search for the SOI-boundary crossing by bisecting on time, to a precision
 * of 0.01 s").
 *
 * Contract note (see also `body.ts`): PLAN.md §4's `Body` only exposes
 * `parent`, not a list of children, and `SystemLibrary` only exposes
 * `root`/`get(id)`, not "every body". Discovering which bodies a vessel could
 * enter the SOI of therefore needs the flat list of every body in the system
 * up front. {@link createTrajectoryPredictor} takes that list as a constructor
 * argument — additive (the `TrajectoryPredictor` interface itself is
 * unchanged), but whoever wires this up (Agent D/F) must pass every `Body` the
 * `SystemLibrary` loaded, not just the root.
 */
import { v2, type Vec2 } from '../math/vec2';
import { orbitFromState, stateFromOrbit } from './kepler';
import type { Body, ConicSegment, Orbit, SegmentEnd, TrajectoryPredictor, VesselState } from './types';

/** Time resolution for SOI/impact boundary bisection, s (PLAN.md §7, Agent A). */
const SOI_BISECTION_TOLERANCE_S = 0.01;

/** Forward-time samples taken per segment while hunting for the first boundary crossing. */
const SAMPLES_PER_SEGMENT = 5000;

interface EventCandidate {
  readonly time: number;
  readonly reason: SegmentEnd;
  readonly nextBody: Body | null;
}

interface Track {
  readonly kind: SegmentEnd;
  readonly nextBody: Body | null;
  /** Signed "distance to the boundary": positive before crossing, `<= 0` at/after. */
  gap(t: number): number;
}

function childrenByParentId(bodies: readonly Body[]): Map<string, Body[]> {
  const map = new Map<string, Body[]>();
  for (const b of bodies) {
    if (b.parent === null) continue;
    const parentId = b.parent.id;
    const existing = map.get(parentId);
    if (existing) existing.push(b);
    else map.set(parentId, [b]);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return map;
}

/** Bisects `[lo, hi]`, where `gap(lo) > 0` and `gap(hi) <= 0`, to `SOI_BISECTION_TOLERANCE_S`. */
function bisectCrossing(gap: (t: number) => number, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  while (b - a > SOI_BISECTION_TOLERANCE_S) {
    const mid = (a + b) / 2;
    if (gap(mid) > 0) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

/**
 * Builds a `TrajectoryPredictor` over the given set of bodies (see the
 * contract note in the module doc for why the flat list is required).
 */
export function createTrajectoryPredictor(bodies: readonly Body[]): TrajectoryPredictor {
  const childrenOf = childrenByParentId(bodies);

  function tracksFor(body: Body, orbit: Orbit): Track[] {
    const tracks: Track[] = [
      {
        kind: 'impact',
        nextBody: null,
        gap: (t: number) => v2.len(stateFromOrbit(orbit, t).r) - body.radius,
      },
    ];

    if (Number.isFinite(body.soiRadius)) {
      tracks.push({
        kind: body.parent === null ? 'escape' : 'soi-exit',
        nextBody: body.parent,
        gap: (t: number) => body.soiRadius - v2.len(stateFromOrbit(orbit, t).r),
      });
    }

    for (const child of childrenOf.get(body.id) ?? []) {
      tracks.push({
        kind: 'soi-entry',
        nextBody: child,
        gap: (t: number) => {
          const r = stateFromOrbit(orbit, t).r;
          const childRel: Vec2 = v2.sub(child.positionAt(t), body.positionAt(t));
          return v2.len(v2.sub(r, childRel)) - child.soiRadius;
        },
      });
    }

    return tracks;
  }

  function findEvent(body: Body, orbit: Orbit, fromT: number, toT: number): EventCandidate {
    const tracks = tracksFor(body, orbit);

    // Already below the surface at the start of this segment — impact "now".
    if (tracks[0]!.gap(fromT) <= 0) {
      return { time: fromT, reason: 'impact', nextBody: null };
    }

    const steps = Math.max(1, SAMPLES_PER_SEGMENT);
    const dt = (toT - fromT) / steps;
    let prevT = fromT;
    let prevValues = tracks.map((tr) => tr.gap(fromT));

    for (let i = 1; i <= steps; i++) {
      const t = i === steps ? toT : fromT + dt * i;
      const values = tracks.map((tr) => tr.gap(t));

      for (let k = 0; k < tracks.length; k++) {
        const before = prevValues[k]!;
        const after = values[k]!;
        if (before > 0 && after <= 0) {
          const track = tracks[k]!;
          const time = bisectCrossing(track.gap, prevT, t);
          return { time, reason: track.kind, nextBody: track.nextBody };
        }
      }

      prevT = t;
      prevValues = values;
    }

    return { time: toT, reason: 'time-limit', nextBody: null };
  }

  return {
    predict(state: VesselState, horizonSeconds: number, maxSegments: number): ConicSegment[] {
      const segments: ConicSegment[] = [];
      const searchEnd = state.t + horizonSeconds;

      let curBody = state.soi;
      let curR = state.position;
      let curV = state.velocity;
      let curT = state.t;

      while (segments.length < maxSegments && curT < searchEnd) {
        const orbit = orbitFromState(curR, curV, curBody.mu, curT);
        const event = findEvent(curBody, orbit, curT, searchEnd);

        segments.push({
          bodyId: curBody.id,
          orbit,
          startTime: curT,
          endTime: event.time,
          endReason: event.reason,
          nextBodyId: event.nextBody ? event.nextBody.id : null,
        });

        if (event.nextBody === null) break; // impact, escape-from-root, or time-limit

        const eventState = stateFromOrbit(orbit, event.time);
        const absR = v2.add(curBody.positionAt(event.time), eventState.r);
        const absV = v2.add(curBody.velocityAt(event.time), eventState.v);

        const nextBody = event.nextBody;
        curR = v2.sub(absR, nextBody.positionAt(event.time));
        curV = v2.sub(absV, nextBody.velocityAt(event.time));
        curBody = nextBody;
        curT = event.time;
      }

      return segments;
    },
  };
}
