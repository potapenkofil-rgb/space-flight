/**
 * Black-box telemetry charts (PLAN.md §7 Agent F): altitude, speed, g-force
 * and remaining fuel over the recorded flight. Per DESIGN.md §1/§2: colors
 * only from tokens, a thin grid, monospace labels — and per DESIGN.md's own
 * semantic assignments, not invented ones: `Warning` for fuel under 25%
 * (DESIGN.md §1 defines that role for exactly this case: low propellant/plan
 * deviation), `Critical` for a g-force spike, `Orbit` otherwise (the same
 * role the map uses for trajectories/axes).
 *
 * The numbers themselves come from `@karman/core`'s `computeTelemetrySeries`
 * (pure, already unit-tested) — this module only draws them.
 */
import type { TelemetrySample } from '@karman/core';
import './replay.css';
import { getColor } from '../tokens';

const FUEL_WARNING_FRACTION = 0.25;
const G_FORCE_CRITICAL = 8;

interface ChartDef {
  readonly labelKey: string;
  readonly select: (s: TelemetrySample) => number;
  readonly lineColor: (samples: readonly TelemetrySample[]) => string;
}

const CHART_DEFS: readonly ChartDef[] = [
  { labelKey: 'REPLAY_CHART_ALTITUDE', select: (s) => s.altitude, lineColor: () => getColor('orbit') },
  { labelKey: 'REPLAY_CHART_SPEED', select: (s) => s.speed, lineColor: () => getColor('orbit') },
  {
    labelKey: 'REPLAY_CHART_G_FORCE',
    select: (s) => s.gForce,
    lineColor: (samples) =>
      samples.some((s) => s.gForce >= G_FORCE_CRITICAL) ? getColor('critical') : getColor('orbit'),
  },
  {
    labelKey: 'REPLAY_CHART_FUEL',
    select: (s) => s.fuelFraction,
    lineColor: (samples) => {
      const last = samples[samples.length - 1];
      return last && last.fuelFraction < FUEL_WARNING_FRACTION ? getColor('warning') : getColor('orbit');
    },
  },
];

function drawLineChart(canvas: HTMLCanvasElement, values: readonly number[], lineColor: string): void {
  const dpr = Math.max(1, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round((rect.width || canvas.clientWidth || 100) * dpr));
  const height = Math.max(1, Math.round((rect.height || canvas.clientHeight || 56) * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = getColor('hairlineSoft');
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i += 1) {
    const y = Math.round((height * i) / 4) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  if (values.length < 2) return;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = Math.max(1, Math.round(dpr));
  ctx.beginPath();
  values.forEach((value, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

export interface ChartsOptions {
  readonly t: (key: string) => string;
}

export interface Charts {
  /** Redraws all four charts from a new sample set (e.g. after seeking or after more of the flight has been recorded). */
  update(samples: readonly TelemetrySample[]): void;
  unmount(): void;
}

/** Mounts the four telemetry mini-charts into `root`. */
export function mountCharts(root: HTMLElement, options: ChartsOptions): Charts {
  const grid = document.createElement('div');
  grid.className = 'replay-charts';
  grid.dataset['testid'] = 'replay-charts';

  const canvases = CHART_DEFS.map((def) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'replay-chart';
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = options.t(def.labelKey);
    const canvas = document.createElement('canvas');
    canvas.dataset['testid'] = `replay-chart-${def.labelKey}`;
    wrapper.append(label, canvas);
    grid.appendChild(wrapper);
    return canvas;
  });

  root.appendChild(grid);

  return {
    update(samples) {
      CHART_DEFS.forEach((def, i) => {
        const canvas = canvases[i];
        if (!canvas) return;
        drawLineChart(canvas, samples.map(def.select), def.lineColor(samples));
      });
    },
    unmount() {
      grid.remove();
    },
  };
}
