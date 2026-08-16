/**
 * Per-tick inputs to `stepFlight`: what the player commanded, and what the
 * environment (gravity, atmosphere) is doing at the vessel's current position.
 * Both are plain data — computed by the caller (Agent D's flight scene reads
 * the keymap into `ControlInput`; the integrator itself derives
 * `FlightEnvironment` from `Vessel.soi`/`Vessel.position` — see PLAN.md §5).
 */
import type { Vec2 } from '../math/vec2';
import type { Body } from '../orbits/types';

/**
 * Player/autopilot control commands for one physics tick. Corresponds to the
 * keymap in PLAN.md §7 (Agent D): `Z`/`X`/`Shift`/`Ctrl` drive `throttle`,
 * `A`/`D` drive `rotate`, `Space` sets `stage`, `T` toggles `sas`.
 */
export interface ControlInput {
  /** Commanded throttle, `0..1` (dimensionless fraction of max thrust). */
  readonly throttle: number;
  /**
   * Commanded rotation axis, `-1..1` (dimensionless). Positive = counter-clockwise.
   * Applied to gimbal, RCS torque and aero surfaces per PLAN.md §5.5, weighted
   * by whichever actuators the vessel has.
   */
  readonly rotate: number;
  /** RCS translation command, `-1..1` per axis (dimensionless), in the vessel's local frame. */
  readonly rcsTranslate: Vec2;
  /** Stability-assist system enabled: holds current heading via a PD controller (PLAN.md §5.5). */
  readonly sas: boolean;
  /**
   * **Contract extension (Agent B):** heading, rad, that SAS should hold while
   * `sas` is `true`. PLAN.md §5.5 says SAS is "a PD controller on heading
   * error" but the frozen `ControlInput` fields (per §4) give no target angle
   * to hold, and no such setpoint is stored on `Vessel` either — without one
   * the PD error is always zero. Optional and additive: the caller (e.g. the
   * flight scene, capturing `v.rotation` the tick SAS is toggled on) may set
   * it; when omitted `stepFlight` falls back to damping `angularVelocity`
   * toward zero (kills tumbling without a heading lock). See report.
   */
  readonly sasTargetHeading?: number;
  /**
   * `true` on exactly the tick a stage separation was requested, `false`
   * otherwise. Edge-triggered, not level-triggered — the integrator must not
   * re-fire the stage every tick this stays `true`.
   */
  readonly stage: boolean;
}

/**
 * The ambient physical environment at a vessel's current position, for one
 * physics tick. Computed by the caller from `Vessel.soi`/`Vessel.position`
 * before calling `stepFlight` (kept separate from `Vessel` so `stepFlight`
 * doesn't have to re-derive it, and so it's trivial to unit-test in isolation).
 */
export interface FlightEnvironment {
  /** Simulation time this tick starts at, s. */
  readonly t: number;
  /** The body currently providing gravity/atmosphere (== `Vessel.soi`). */
  readonly body: Body;
  /** Local gravitational acceleration at the vessel's position, m/s² (world frame; `a = −μ·r̂/|r|²`, PLAN.md §5.1). */
  readonly gravity: Vec2;
  /** Local air density `ρ(h)`, kg/m³ (PLAN.md §5.2); `0` above the atmosphere's `top` or with no atmosphere. */
  readonly airDensity: number;
  /** Ambient pressure as a fraction of sea-level pressure, `0` (vacuum) to `1` (sea level). */
  readonly ambientPressure: number;
  /**
   * Velocity of the local atmosphere at the vessel's position, m/s (world
   * frame) — i.e. what the ground/air is moving at due to planetary rotation.
   * Drag must be computed against velocity *relative to this*, not against
   * inertial velocity, or a vessel sitting on the launchpad would experience
   * spurious sideways drag (PLAN.md §5.2).
   */
  readonly atmosphereVelocity: Vec2;
}
