/**
 * FIXTURE — a self-contained, browser-safe stand-in for `@karman/core`'s
 * `orbitFromState`/`stateFromOrbit`/`eccentricAnomaly`, which currently
 * `throw new Error('not implemented')` because Agent A's orbits branch
 * hasn't landed yet (PLAN.md §7 Agent A). Everything in this file is scoped
 * to `scenes/map/**` and used only to drive the maneuver-node preview and
 * the demo/e2e vessel-on-orbit marker — never exported as "the" orbit math
 * for the rest of the app.
 *
 * `maneuverNode.ts` takes an `orbitFromState`-shaped function as a
 * parameter (matching `@karman/core`'s exact signature) instead of importing
 * this module directly, so once Agent A's real implementation exists the
 * orchestrator swaps the one call site in `MapScene.ts` and this file can be
 * deleted outright — nothing else depends on it.
 *
 * The math itself is standard 2D two-body orbital mechanics (state vector →
 * classical elements, and the analogous inverse), restricted to ellipses
 * (`0 ≤ e < 1`), which is all the maneuver-node demo needs.
 */
import type { Orbit } from '@karman/core';
import { v2, type Vec2 } from '@karman/core';

/**
 * Computes the osculating ellipse from a Cartesian state, matching
 * `@karman/core`'s `orbitFromState(r, v, mu, t)` signature exactly (PLAN.md
 * §4) so it's a drop-in stand-in until that function is implemented for
 * real.
 */
export function localOrbitFromState(r: Vec2, v: Vec2, mu: number, t: number): Orbit {
  const rMag = v2.len(r);
  const vMag = v2.len(v);
  const specificEnergy = (vMag * vMag) / 2 - mu / rMag;
  const a = -mu / (2 * specificEnergy);

  const h = v2.cross(r, v); // scalar angular momentum (2D cross product), signed
  const dir: 1 | -1 = h >= 0 ? 1 : -1;

  const eSquared = 1 + (2 * specificEnergy * h * h) / (mu * mu);
  const e = Math.sqrt(Math.max(eSquared, 0));

  const rDotV = v2.dot(r, v);
  const trueLongitude = Math.atan2(r.y, r.x);

  let nu: number;
  if (e < 1e-9) {
    nu = 0; // circular orbit: periapsis direction is arbitrary, argPe/nu split is not unique — pin nu=0
  } else {
    const cosNu = Math.min(1, Math.max(-1, (h * h) / (mu * rMag) / e - 1 / e));
    const magnitude = Math.acos(cosNu);
    // r·v < 0 means the vessel is approaching periapsis (moving inward), i.e. true anomaly is negative.
    nu = rDotV < 0 ? -magnitude : magnitude;
  }

  const argPe = normalizeAngle(dir === 1 ? trueLongitude - nu : trueLongitude + nu);
  const meanAnomaly = meanAnomalyAtTrueAnomaly(nu, e);

  return { a, e, argPe, m0: normalizeAngle(meanAnomaly), epoch: t, mu, dir };
}

/** True anomaly (rad) at `nu` converted to mean anomaly (rad), via the eccentric anomaly, for `0 ≤ e < 1`. */
export function meanAnomalyAtTrueAnomaly(nu: number, e: number): number {
  const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
  return E - e * Math.sin(E);
}

/** Mean anomaly (rad) solved for eccentric anomaly (rad) via Newton's method with a bisection fallback. */
function solveEccentricAnomaly(meanAnomaly: number, e: number): number {
  const m = normalizeAngle(meanAnomaly);
  let E = e < 0.8 ? m : Math.PI;
  for (let i = 0; i < 30; i++) {
    const f = E - e * Math.sin(E) - m;
    const fPrime = 1 - e * Math.cos(E);
    const step = f / fPrime;
    const next = E - step;
    if (Math.abs(next - E) < 1e-12) return next;
    E = next;
  }
  // Newton failed to converge (can happen for e close to 1): fall back to bisection.
  let lo = 0;
  let hi = Math.PI * 2;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const f = mid - e * Math.sin(mid) - m;
    if (f > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Computes the Cartesian state at time `t`, matching `@karman/core`'s
 * `stateFromOrbit(o, t)` signature (PLAN.md §4).
 */
export function localStateFromOrbit(o: Orbit, t: number): { r: Vec2; v: Vec2 } {
  const n = Math.sqrt(o.mu / Math.pow(o.a, 3)); // mean motion, rad/s
  const meanAnomaly = normalizeAngle(o.m0 + o.dir * n * (t - o.epoch));
  const E = solveEccentricAnomaly(meanAnomaly, o.e);
  const nu =
    2 *
    Math.atan2(Math.sqrt(1 + o.e) * Math.sin(E / 2), Math.sqrt(1 - o.e) * Math.cos(E / 2));

  const r = (o.a * (1 - o.e * o.e)) / (1 + o.e * Math.cos(nu));
  const theta = o.argPe + o.dir * nu;
  const position: Vec2 = { x: r * Math.cos(theta), y: r * Math.sin(theta) };

  const p = o.a * (1 - o.e * o.e);
  const h = Math.sqrt(o.mu * p);
  const vr = (o.mu / h) * o.e * Math.sin(nu);
  const vt = h / r;
  const radialDir: Vec2 = { x: Math.cos(theta), y: Math.sin(theta) };
  const tangentDir: Vec2 = { x: -Math.sin(theta) * o.dir, y: Math.cos(theta) * o.dir };
  const velocity: Vec2 = {
    x: vr * radialDir.x + vt * tangentDir.x,
    y: vr * radialDir.y + vt * tangentDir.y,
  };

  return { r: position, v: velocity };
}

/**
 * Earliest simulation time at or after `from` when `o` reaches true anomaly
 * `nu`, matching `@karman/core`'s `timeToTrueAnomaly(o, nu, from)` signature
 * (PLAN.md §4). Elliptical orbits only (`0 ≤ e < 1`), which is all the
 * maneuver-node fixture needs (see module doc).
 */
export function localTimeToTrueAnomaly(o: Orbit, nu: number, from: number): number {
  const n = Math.sqrt(o.mu / Math.pow(o.a, 3));
  const period = (2 * Math.PI) / n;
  const targetM = meanAnomalyAtTrueAnomaly(nu, o.e);

  // o.m0 + o.dir·n·(t−epoch) ≡ targetM (mod 2π)  ⇒  (t−epoch) ≡ o.dir·(targetM−o.m0)/n (mod period),
  // since o.dir is ±1 and dividing by (o.dir·n) is the same as multiplying by (o.dir/n).
  let dt = (o.dir * (targetM - o.m0)) / n;
  dt = ((dt % period) + period) % period;
  let t = o.epoch + dt;

  if (t < from) {
    const periodsBehind = Math.ceil((from - t) / period);
    t += periodsBehind * period;
  }
  return t;
}

function normalizeAngle(rad: number): number {
  const twoPi = Math.PI * 2;
  let a = rad % twoPi;
  if (a < 0) a += twoPi;
  if (a >= Math.PI) a -= twoPi;
  return a;
}
