/**
 * The black box (PLAN.md §3.6/§7 Agent F): a full snapshot every 30s of
 * simulation time plus a stream of player commands with tick numbers, so
 * rewinding means "load the nearest snapshot at or before the target time, then
 * replay commands forward without rendering" — far cheaper than snapshotting
 * every tick.
 */
import type { ControlInput } from '../flight/types';
import type { Vessel } from '../vessels/vessel';

/** A full-state snapshot of every vessel at one moment, taken roughly every 30s of sim time. */
export interface ReplaySnapshot {
  /** Simulation time of this snapshot, s. */
  readonly t: number;
  /** Every vessel that existed at time `t`, in deterministic `Vessel.id` order. */
  readonly vessels: readonly Vessel[];
}

/** One player/autopilot command, tagged with the exact tick it was applied on. */
export interface RecordedCommand {
  /** Physics tick number (since recording start) this input applies to. */
  readonly tick: number;
  /** Which vessel this input targets. */
  readonly vesselId: number;
  readonly input: ControlInput;
}

/** A notable event on the flight timeline (PLAN.md §7 Agent F: launch, staging, ...). */
export type ReplayMarkerKind =
  | 'launch'
  | 'stage-separation'
  | 'part-loss'
  | 'atmosphere-entry'
  | 'apoapsis'
  | 'periapsis'
  | 'landing'
  | 'impact';

/** A single labeled point on the flight timeline, e.g. for the timeline UI (PLAN.md §7 Agent F). */
export interface ReplayMarker {
  /** Simulation time this event occurred, s. */
  readonly t: number;
  readonly kind: ReplayMarkerKind;
  readonly vesselId: number;
}

/**
 * A recorded flight, opened for scrubbing/playback. `seekTo` must reconstruct
 * state by loading the nearest snapshot at or before `t` and replaying
 * `commands` forward without rendering (PLAN.md §3.6) — target performance is
 * under 2s to seek anywhere within a 10-minute flight (PLAN.md §7 Agent F).
 */
export interface ReplaySession {
  /** Full-state snapshots, one roughly every 30s of sim time, sorted by `t` ascending. */
  readonly snapshots: readonly ReplaySnapshot[];
  /** The complete command stream for this flight, sorted by `tick` ascending. */
  readonly commands: readonly RecordedCommand[];
  /** Timeline markers, sorted by `t` ascending. */
  readonly markers: readonly ReplayMarker[];
  /** Simulation time of the first snapshot, s. */
  readonly startTime: number;
  /** Simulation time of the last recorded tick, s. */
  readonly endTime: number;
  /**
   * Reconstructs vessel state at simulation time `t` by loading the nearest
   * snapshot at or before `t` and replaying `commands` forward without
   * rendering. `t` is clamped into `[startTime, endTime]`.
   */
  seekTo(t: number): readonly Vessel[];
}

/** Records a flight as it happens, for later black-box playback. */
export interface FlightRecorder {
  /**
   * Called once per physics tick with the current simulation time and the full
   * vessel registry. Implementations decide internally when to take a full
   * snapshot (roughly every 30s of sim time) versus just appending `input` to
   * the command stream.
   *
   * @param t simulation time of this tick, s
   * @param vessels every vessel that currently exists, in deterministic `Vessel.id` order
   * @param input this tick's player/autopilot command (recorded against the active vessel)
   */
  tick(t: number, vessels: Vessel[], input: ControlInput): void;
  /** Finalizes and returns a `ReplaySession` covering everything recorded so far. */
  openReplay(): ReplaySession;
}
