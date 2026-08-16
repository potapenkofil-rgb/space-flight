/**
 * Kepler orbit mechanics: state-vector <-> orbital-element conversion, Kepler's
 * equation (elliptic, hyperbolic and parabolic), and the derived scalar
 * quantities (apoapsis/periapsis/period/time-of-true-anomaly). See PLAN.md §3.3
 * (on-rails/off-rails transitions must round-trip to 1e-9 relative error) and
 * §4/§7 (Agent A) for the exact contract.
 *
 * Convention for `Orbit.a` on a parabola (`e === 1`, within {@link PARABOLIC_EPS}):
 * a true parabola has no finite semi-major axis, and PLAN.md §4 only specifies
 * "negative for hyperbola" — it does not reserve a field for periapsis distance.
 * Rather than leave parabolic orbits unrepresentable, this implementation reuses
 * `a` to store the **periapsis distance `q`** (m) when `e === 1`. This is an
 * additive convention, not a change to the `Orbit` shape: every function in this
 * module (and `body.ts`/`predictor.ts`) goes through {@link regimeOf} so ellipse,
 * parabola and hyperbola are always handled consistently. Flagged in the Agent A
 * report as the one place §4 needed a documented extension.
 */
import { v2, type Vec2 } from '../math/vec2';
import { normalizeAngle } from '../math/mathx';
import type { Orbit } from './types';

/** Eccentricity band around `1` treated as parabolic (dimensionless). */
const PARABOLIC_EPS = 1e-9;

type Regime = 'ellipse' | 'parabola' | 'hyperbola';

function regimeOf(e: number): Regime {
  if (Math.abs(e - 1) < PARABOLIC_EPS) return 'parabola';
  return e < 1 ? 'ellipse' : 'hyperbola';
}

/** `Math.atanh` with its input clamped just inside `(-1, 1)` to absorb float overshoot. */
function safeAtanh(x: number): number {
  const clamped = Math.min(Math.max(x, -1 + 1e-15), 1 - 1e-15);
  return Math.atanh(clamped);
}

// ── true anomaly <-> anomaly (E / H / D) ────────────────────────────────────

function trueAnomalyToEccentric(nu: number, e: number): number {
  return 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
}

function eccentricToTrueAnomaly(E: number, e: number): number {
  return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
}

function trueAnomalyToHyperbolic(nu: number, e: number): number {
  const ratio = Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2);
  return 2 * safeAtanh(ratio);
}

function hyperbolicToTrueAnomaly(H: number, e: number): number {
  return 2 * Math.atan2(Math.sqrt(e + 1) * Math.tanh(H / 2), Math.sqrt(e - 1));
}

function trueAnomalyToParabolic(nu: number): number {
  return Math.tan(nu / 2);
}

function parabolicToTrueAnomaly(D: number): number {
  return 2 * Math.atan(D);
}

/** Converts a true anomaly `nu` (rad) directly to mean anomaly `M` (rad), regime-aware. */
function trueAnomalyToMeanAnomaly(nu: number, e: number): number {
  const regime = regimeOf(e);
  if (regime === 'ellipse') {
    const E = trueAnomalyToEccentric(nu, e);
    return E - e * Math.sin(E);
  }
  if (regime === 'hyperbola') {
    const H = trueAnomalyToHyperbolic(nu, e);
    return e * Math.sinh(H) - H;
  }
  const D = trueAnomalyToParabolic(nu);
  return D + (D * D * D) / 3;
}

// ── mean motion / mean anomaly propagation ──────────────────────────────────

function meanMotionEllipse(o: Orbit): number {
  return Math.sqrt(o.mu / (o.a * o.a * o.a));
}

function meanMotionHyperbola(o: Orbit): number {
  const a = -o.a;
  return Math.sqrt(o.mu / (a * a * a));
}

/** `o.a` holds the periapsis distance `q` for a parabola (see module doc). */
function meanMotionParabola(o: Orbit): number {
  const q = o.a;
  return Math.sqrt(o.mu / (2 * q * q * q));
}

function meanMotionOf(o: Orbit, regime: Regime): number {
  if (regime === 'ellipse') return meanMotionEllipse(o);
  if (regime === 'hyperbola') return meanMotionHyperbola(o);
  return meanMotionParabola(o);
}

/** Mean anomaly (rad) at time `t` (s), unwrapped (not reduced into any particular range). */
function meanAnomalyAt(o: Orbit, t: number): number {
  const n = meanMotionOf(o, regimeOf(o.e));
  return o.m0 + n * (t - o.epoch);
}

// ── Kepler's equation solver: safeguarded Newton with bisection fallback ───
// Newton alone diverges as e -> 1 for M near 0 (f'(E) = 1 - e*cos(E) -> 0),
// which is exactly the case that hangs the game on eccentric orbits (PLAN.md,
// Agent A acceptance criteria). This is the classic "Numerical Recipes rtsafe"
// hybrid: every step tries a Newton update, but falls back to a bisection step
// whenever Newton would leave the bracket — guaranteed convergence, usually in
// far fewer than `maxIter` iterations.

interface SolveResult {
  readonly anomaly: number;
  readonly iterations: number;
}

function safeguardedSolve(
  f: (x: number) => number,
  fPrime: (x: number) => number,
  x0: number,
  loInit: number,
  hiInit: number,
  maxIter = 50,
  tol = 1e-12
): SolveResult {
  let lo = loInit;
  let hi = hiInit;
  let flo = f(lo);
  let fhi = f(hi);
  // f is monotonic increasing for both the elliptic and hyperbolic Kepler
  // equations; expand the bracket outward until it actually contains the root.
  let expand = 0;
  const maxExpand = 80;
  while (flo > 0 && expand < maxExpand) {
    const width = hi - lo || 1;
    lo -= width;
    flo = f(lo);
    expand++;
  }
  while (fhi < 0 && expand < maxExpand) {
    const width = hi - lo || 1;
    hi += width;
    fhi = f(hi);
    expand++;
  }

  let x = x0 > lo && x0 < hi ? x0 : (lo + hi) / 2;
  let fx = f(x);
  let iterations = 0;

  for (; iterations < maxIter; iterations++) {
    if (Math.abs(fx) <= tol) {
      iterations++;
      break;
    }
    if (fx < 0) lo = x;
    else hi = x;

    const deriv = fPrime(x);
    let next = deriv !== 0 ? x - fx / deriv : NaN;
    if (!Number.isFinite(next) || next <= lo || next >= hi) {
      next = (lo + hi) / 2;
    }
    const step = Math.abs(next - x);
    x = next;
    fx = f(x);
    if (step <= tol) {
      iterations++;
      break;
    }
  }

  return { anomaly: x, iterations };
}

function solveKeplerEllipse(M: number, e: number): SolveResult {
  const f = (E: number): number => E - e * Math.sin(E) - M;
  const fPrime = (E: number): number => 1 - e * Math.cos(E);
  // |E - M| = e*|sin E| <= e < 1, so [M-(1+e), M+(1+e)] always brackets the root.
  return safeguardedSolve(f, fPrime, M, M - (1 + e), M + (1 + e));
}

function solveKeplerHyperbola(M: number, e: number): SolveResult {
  const f = (H: number): number => e * Math.sinh(H) - H - M;
  const fPrime = (H: number): number => e * Math.cosh(H) - 1;
  const guess = Math.asinh(M / e);
  return safeguardedSolve(f, fPrime, guess, guess - 1, guess + 1);
}

/** Closed-form (Cardano) solution of Barker's equation `D + D^3/3 = M` for the parabolic anomaly `D`. */
function solveBarkerEquation(M: number): SolveResult {
  // D^3 + 3D - 3M = 0, a depressed cubic t^3 + p*t + q = 0 with p=3, q=-3M (p>0 => one real root).
  const q = -3 * M;
  const disc = Math.sqrt((q * q) / 4 + 1); // (p/3)^3 = 1
  const u = Math.cbrt(-q / 2 + disc);
  const v = Math.cbrt(-q / 2 - disc);
  return { anomaly: u + v, iterations: 0 };
}

/**
 * Solves Kepler's equation for the eccentric/hyperbolic/parabolic anomaly, and
 * exposes the iteration count for testing (Agent A acceptance criterion: fewer
 * than 20 iterations at `e = 0.999`). {@link eccentricAnomaly} is the public,
 * contract-shaped wrapper around this.
 */
export function solveKeplerEquation(meanAnomaly: number, e: number): SolveResult {
  const regime = regimeOf(e);
  if (regime === 'parabola') return solveBarkerEquation(meanAnomaly);
  if (regime === 'ellipse') return solveKeplerEllipse(meanAnomaly, e);
  return solveKeplerHyperbola(meanAnomaly, e);
}

/**
 * Solves Kepler's equation `M = E − e·sin(E)` for the eccentric anomaly `E`.
 * Implementations must use a Newton solver with a bisection fallback: Newton
 * diverges as `e → 1` for some `M`, and the fallback prevents that from hanging
 * (PLAN.md, Agent A acceptance criteria: converges in < 20 iterations at `e = 0.999`).
 *
 * @param meanAnomaly mean anomaly `M`, rad
 * @param e eccentricity, dimensionless (`0 ≤ e`; behaviour for `e ≥ 1` is
 *   parabolic/hyperbolic anomaly and is defined by the implementation)
 * @returns eccentric anomaly `E`, rad (or the hyperbolic/parabolic analogue for `e ≥ 1`)
 */
export function eccentricAnomaly(meanAnomaly: number, e: number): number {
  return solveKeplerEquation(meanAnomaly, e).anomaly;
}

// ── state <-> orbit ──────────────────────────────────────────────────────────

/**
 * Computes the osculating `Orbit` from a Cartesian state vector at time `t`.
 * Inverse of {@link stateFromOrbit}; the round trip must be accurate to a
 * relative error no worse than `1e-9` (PLAN.md §3.3).
 *
 * @param r position relative to the body's centre, m
 * @param v velocity relative to the body's centre, m/s
 * @param mu standard gravitational parameter of the body, m³/s²
 * @param t simulation time of this state, s
 */
export function orbitFromState(r: Vec2, v: Vec2, mu: number, t: number): Orbit {
  const rLen = v2.len(r);
  const vLen = v2.len(v);

  const hz = v2.cross(r, v);
  const dir: 1 | -1 = hz >= 0 ? 1 : -1;

  const rvDot = v2.dot(r, v);
  const energyTerm = vLen * vLen - mu / rLen;
  const eVec: Vec2 = {
    x: (energyTerm * r.x - rvDot * v.x) / mu,
    y: (energyTerm * r.y - rvDot * v.y) / mu,
  };
  const e = v2.len(eVec);

  const regime = regimeOf(e);
  const eps = (vLen * vLen) / 2 - mu / rLen;
  const a = regime === 'parabola' ? (hz * hz) / (2 * mu) : -mu / (2 * eps);

  const argPe = Math.atan2(eVec.y, eVec.x);
  const phi0 = Math.atan2(r.y, r.x);
  const nu0 = dir * normalizeAngle(phi0 - argPe);

  const m0 = trueAnomalyToMeanAnomaly(nu0, e);

  return { a, e, argPe, m0, epoch: t, mu, dir };
}

/**
 * Computes the Cartesian state vector of an `Orbit` at time `t`.
 * Inverse of {@link orbitFromState}.
 *
 * @param o the orbit
 * @param t simulation time to evaluate at, s
 * @returns position `r` (m) and velocity `v` (m/s) relative to the body's centre
 */
export function stateFromOrbit(o: Orbit, t: number): { r: Vec2; v: Vec2 } {
  const regime = regimeOf(o.e);
  const M = meanAnomalyAt(o, t);
  const { anomaly } = solveKeplerEquation(M, o.e);

  let nu: number;
  if (regime === 'ellipse') nu = eccentricToTrueAnomaly(anomaly, o.e);
  else if (regime === 'hyperbola') nu = hyperbolicToTrueAnomaly(anomaly, o.e);
  else nu = parabolicToTrueAnomaly(anomaly);

  const p = regime === 'parabola' ? 2 * o.a : o.a * (1 - o.e * o.e);
  const r = p / (1 + o.e * Math.cos(nu));
  const phi = o.argPe + o.dir * nu;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const rVec: Vec2 = { x: r * cosPhi, y: r * sinPhi };

  const h = Math.sqrt(o.mu * p);
  const vr = (o.mu / h) * o.e * Math.sin(nu);
  const vt = (o.mu / h) * (1 + o.e * Math.cos(nu));
  const vVec: Vec2 = {
    x: vr * cosPhi - o.dir * vt * sinPhi,
    y: vr * sinPhi + o.dir * vt * cosPhi,
  };

  return { r: rVec, v: vVec };
}

/** Apoapsis distance from the body's centre, m. `+Infinity` for `e ≥ 1` (no apoapsis). */
export function apoapsis(o: Orbit): number {
  return regimeOf(o.e) === 'ellipse' ? o.a * (1 + o.e) : Infinity;
}

/** Periapsis distance from the body's centre, m. */
export function periapsis(o: Orbit): number {
  const regime = regimeOf(o.e);
  if (regime === 'parabola') return o.a; // `a` holds periapsis distance for e===1, see module doc.
  return o.a * (1 - o.e);
}

/** Orbital period, s. `NaN` for parabolic/hyperbolic orbits (`e ≥ 1`), which never repeat. */
export function period(o: Orbit): number {
  if (regimeOf(o.e) !== 'ellipse') return NaN;
  return 2 * Math.PI * Math.sqrt((o.a * o.a * o.a) / o.mu);
}

/**
 * Time (absolute simulation time, s) at which the orbit reaches true anomaly `nu`,
 * searching forward from `from`. For elliptical orbits this is periodic; for
 * parabolic/hyperbolic orbits `nu` is only reached once (or never, outside the
 * asymptotic range) and the search does not wrap — the returned time may be
 * earlier than `from` if that unique crossing already lies in the past.
 *
 * @param o the orbit
 * @param nu target true anomaly, rad
 * @param from simulation time to search forward from, s
 */
export function timeToTrueAnomaly(o: Orbit, nu: number, from: number): number {
  const regime = regimeOf(o.e);
  const mTarget = trueAnomalyToMeanAnomaly(nu, o.e);

  if (regime === 'ellipse') {
    const n = meanMotionEllipse(o);
    const mFrom = meanAnomalyAt(o, from);
    const twoPi = Math.PI * 2;
    let deltaPhase = (mTarget - mFrom) % twoPi;
    if (deltaPhase < 0) deltaPhase += twoPi;
    return from + deltaPhase / n;
  }

  const n = regime === 'hyperbola' ? meanMotionHyperbola(o) : meanMotionParabola(o);
  return o.epoch + (mTarget - o.m0) / n;
}
