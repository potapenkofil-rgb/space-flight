/**
 * The black box (PLAN.md §3.6/§7 Agent F): `createFlightRecorder` observes a
 * flight tick by tick — a full snapshot every ~30s of simulation time, one
 * `RecordedCommand` every tick — and `openReplay()` turns that into a
 * `ReplaySession` that can reconstruct state at any recorded time by loading
 * the nearest snapshot and replaying commands forward, without rendering.
 *
 * Convention this module relies on (documented for whoever wires it into the
 * flight loop, since `ControlInput` alone doesn't say which vessel it's for):
 * **the actively-controlled vessel must be `vessels[0]`** in every `tick()`
 * call. Everything else in `vessels` is passive scenery for snapshot purposes
 * (inactive vessels are always on-rails per PLAN.md §3.3, so they need no
 * recorded input at all).
 */
import type { ControlInput } from '../flight/types';
import type { Vessel } from '../vessels/vessel';
import { cloneVessels } from './clone';
import type { WorldStepFn } from './engine';
import { createMarkerDetector } from './markers';
import type {
  FlightRecorder,
  RecordedCommand,
  ReplayMarker,
  ReplaySession,
  ReplaySnapshot,
} from './types';

export interface RecorderOptions {
  /** Fixed physics tick length, s. PLAN.md §3.2 mandates `1/60`; that's also the default. */
  readonly dt?: number;
  /** How often to take a full snapshot, s of simulation time. PLAN.md §7 Agent F mandates ~30s; that's also the default. */
  readonly snapshotIntervalSeconds?: number;
}

const DEFAULT_DT = 1 / 60;
const DEFAULT_SNAPSHOT_INTERVAL_SECONDS = 30;
// Tolerance for the "has 30s of sim time elapsed?" check: summing `dt` many
// times (as the caller's fixed-step loop does, PLAN.md §3.2) drifts a few ULPs
// short of the exact multiple, which would otherwise delay a snapshot by a
// whole extra tick and creep out of sync with `snapshotIntervalSeconds`.
const SNAPSHOT_INTERVAL_EPSILON = 1e-6;

function sortById<T extends { id: number }>(items: readonly T[]): T[] {
  return items.slice().sort((a, b) => a.id - b.id);
}

/** Creates a `FlightRecorder`. `stepWorld` is only used later, by `ReplaySession.seekTo` on the session `openReplay()` returns — see `engine.ts` for what to wire in once orbits/flight land. */
export function createFlightRecorder(
  stepWorld: WorldStepFn,
  options: RecorderOptions = {}
): FlightRecorder {
  const dt = options.dt ?? DEFAULT_DT;
  const snapshotIntervalSeconds = options.snapshotIntervalSeconds ?? DEFAULT_SNAPSHOT_INTERVAL_SECONDS;
  if (dt <= 0) throw new RangeError('createFlightRecorder: dt must be positive');
  if (snapshotIntervalSeconds <= 0) {
    throw new RangeError('createFlightRecorder: snapshotIntervalSeconds must be positive');
  }

  const snapshots: ReplaySnapshot[] = [];
  const snapshotTicks: number[] = []; // parallel to `snapshots`: the tick index each was taken at
  const commands: RecordedCommand[] = []; // commands[tick] === the command recorded for that tick
  const markers: ReplayMarker[] = [];
  const markerDetector = createMarkerDetector();

  let tickCount = 0;
  let startTime: number | null = null;
  let endTime = 0;
  let lastSnapshotTime = -Infinity;

  function takeSnapshot(t: number, vessels: readonly Vessel[]): void {
    snapshots.push({ t, vessels: sortById(cloneVessels(vessels)) });
    snapshotTicks.push(tickCount);
    lastSnapshotTime = t;
  }

  return {
    tick(t: number, vessels: Vessel[], input: ControlInput): void {
      if (startTime === null) startTime = t;
      endTime = t;

      const activeVesselId = vessels.length > 0 ? vessels[0]!.id : -1;
      markers.push(...markerDetector.observe(t, vessels, activeVesselId, input.stage));
      commands.push({ tick: tickCount, vesselId: activeVesselId, input });

      if (t - lastSnapshotTime >= snapshotIntervalSeconds - SNAPSHOT_INTERVAL_EPSILON) {
        takeSnapshot(t, vessels);
      }

      tickCount += 1;
    },

    openReplay(): ReplaySession {
      if (startTime === null) {
        throw new Error('FlightRecorder.openReplay: no ticks recorded yet — call tick() at least once');
      }
      const start = startTime;
      const end = endTime;
      // Freeze the current contents into a session; recording can keep going
      // on this recorder afterwards without retroactively changing an
      // already-opened session (openReplay may be called mid-flight, e.g. to
      // populate the timeline UI while still flying).
      const snapshotsSnapshot = snapshots.slice();
      const snapshotTicksSnapshot = snapshotTicks.slice();
      const commandsSnapshot = commands.slice();
      const markersSnapshot = markers.slice().sort((a, b) => a.t - b.t);

      function seekTo(t: number): readonly Vessel[] {
        const clamped = Math.min(Math.max(t, start), end);

        // Binary search for the last snapshot at or before `clamped`.
        let lo = 0;
        let hi = snapshotsSnapshot.length - 1;
        let idx = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (snapshotsSnapshot[mid]!.t <= clamped) {
            idx = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
        const snapshot = snapshotsSnapshot[idx];
        const snapshotTick = snapshotTicksSnapshot[idx];
        if (!snapshot || snapshotTick === undefined) {
          // No snapshot at all yet (shouldn't happen once tick() has run once,
          // since tick 0 always snapshots) — nothing to reconstruct from.
          return [];
        }

        const targetTick = Math.round((clamped - start) / dt);
        let vessels: readonly Vessel[] = cloneVessels(snapshot.vessels);
        for (let tickIndex = snapshotTick + 1; tickIndex <= targetTick; tickIndex += 1) {
          const cmd = commandsSnapshot[tickIndex];
          if (!cmd) break; // ran out of recorded commands before reaching targetTick
          const tickTime = start + tickIndex * dt;
          vessels = stepWorld(vessels, tickTime, dt, { activeVesselId: cmd.vesselId, input: cmd.input });
        }
        return vessels;
      }

      return {
        snapshots: snapshotsSnapshot,
        commands: commandsSnapshot,
        markers: markersSnapshot,
        startTime: start,
        endTime: end,
        seekTo,
      };
    },
  };
}

/**
 * "Start from marker" (PLAN.md §7 Agent F): reconstructs vessel state at
 * `atTime` from a previously recorded session, and returns a brand-new
 * `FlightRecorder` ready to record the branch that continues from there. The
 * caller must feed the returned `vessels` back through `recorder.tick(atTime,
 * vessels, input)` as the branch's first tick — that call establishes the new
 * recording's `startTime` and takes its first snapshot, exactly like any
 * other fresh recorder.
 */
export function startFromReplay(
  session: ReplaySession,
  atTime: number,
  stepWorld: WorldStepFn,
  options: RecorderOptions = {}
): { readonly vessels: readonly Vessel[]; readonly recorder: FlightRecorder } {
  const vessels = session.seekTo(atTime);
  const recorder = createFlightRecorder(stepWorld, options);
  return { vessels, recorder };
}
