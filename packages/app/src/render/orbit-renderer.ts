/**
 * Map/orbit drawing (DESIGN.md §5) — every line width, dash pattern and
 * marker size below is copied verbatim from the spec, in *screen* pixels
 * (constant regardless of zoom, per §5: "constant thickness at any zoom
 * level"), which is why every draw call here works with already-projected
 * `worldToScreen` points and never touches `ctx.scale`/`camera.pixelsPerMeter`
 * for line widths — only for radii/positions.
 */
import { getColor } from '../ui/tokens';
import { type Camera, worldToScreen } from './camera';
import {
  apoapsisRadius,
  periapsisRadius,
  sampleOrbitPoints,
  type OrbitShape,
} from './orbitGeometry';
import type { Vec2 } from '@karman/core';

const APSIS_DOT_RADIUS_PX = 3.4;
const APSIS_RING_RADIUS_PX = 7;
const CURRENT_ORBIT_WIDTH_PX = 1.6;
const PLANNED_ORBIT_DASH: readonly [number, number] = [6, 5];
const SOI_DASH: readonly [number, number] = [3, 7];
const SOI_ALPHA = 0.7;
const MANEUVER_NODE_RADIUS_PX = 8;
const MANEUVER_NODE_CROSSHAIR_PX = 13;
const ATMOSPHERE_RING_ALPHA = 0.55;

export type OrbitLineStyle = 'current' | 'planned';

function projectOrbit(
  camera: Camera,
  center: Vec2,
  orbit: OrbitShape,
  viewportWidthPx: number,
  viewportHeightPx: number
): Vec2[] {
  const points = sampleOrbitPoints(orbit, camera.pixelsPerMeter);
  return points.map((p) =>
    worldToScreen(camera, { x: center.x + p.x, y: center.y + p.y }, viewportWidthPx, viewportHeightPx)
  );
}

/**
 * Draws one orbit as a closed polyline. `style: 'current'` is a solid
 * `Orbit`-colored line 1.6px wide; `style: 'planned'` (the preview after a
 * maneuver node) is the same width but dashed `Burn` 6/5 (DESIGN.md §5).
 */
export function drawOrbitPath(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  center: Vec2,
  orbit: OrbitShape,
  style: OrbitLineStyle,
  viewportWidthPx: number,
  viewportHeightPx: number
): void {
  const screenPoints = projectOrbit(camera, center, orbit, viewportWidthPx, viewportHeightPx);
  if (screenPoints.length < 2) return;

  ctx.save();
  ctx.beginPath();
  const first = screenPoints[0]!;
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < screenPoints.length; i++) {
    const p = screenPoints[i]!;
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();

  ctx.lineWidth = CURRENT_ORBIT_WIDTH_PX;
  if (style === 'current') {
    ctx.strokeStyle = getColor('orbit');
    ctx.setLineDash([]);
  } else {
    ctx.strokeStyle = getColor('burn');
    ctx.setLineDash([...PLANNED_ORBIT_DASH]);
  }
  ctx.stroke();
  ctx.restore();
}

/** One apsis marker's screen data, for callers that want to also draw a label. */
export interface ApsisMarker {
  readonly screen: Vec2;
  readonly altitude: number; // above the body's surface, m (radius from focus minus bodyRadius)
}

/**
 * Draws the apoapsis and periapsis markers for `orbit` (DESIGN.md §5: "a
 * 3.4 px dot plus a 7 px ring, same color") and returns their screen positions and
 * surface altitudes so the caller can place the mono altitude label (font
 * choice/text is UI concern, not this module's).
 */
export function drawApsisMarkers(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  center: Vec2,
  orbit: OrbitShape,
  bodyRadiusMeters: number,
  style: OrbitLineStyle,
  viewportWidthPx: number,
  viewportHeightPx: number
): { readonly apoapsis: ApsisMarker; readonly periapsis: ApsisMarker } {
  const color = style === 'current' ? getColor('orbit') : getColor('burn');
  const apoWorld = { x: center.x + Math.cos(orbit.argPe + Math.PI) * apoapsisRadius(orbit), y: center.y + Math.sin(orbit.argPe + Math.PI) * apoapsisRadius(orbit) };
  const periWorld = { x: center.x + Math.cos(orbit.argPe) * periapsisRadius(orbit), y: center.y + Math.sin(orbit.argPe) * periapsisRadius(orbit) };

  const apoScreen = worldToScreen(camera, apoWorld, viewportWidthPx, viewportHeightPx);
  const periScreen = worldToScreen(camera, periWorld, viewportWidthPx, viewportHeightPx);

  for (const p of [apoScreen, periScreen]) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, APSIS_DOT_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, APSIS_RING_RADIUS_PX, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  return {
    apoapsis: { screen: apoScreen, altitude: apoapsisRadius(orbit) - bodyRadiusMeters },
    periapsis: { screen: periScreen, altitude: periapsisRadius(orbit) - bodyRadiusMeters },
  };
}

/**
 * Draws the dashed sphere-of-influence boundary (DESIGN.md §5: "a `Muted`
 * 3/7 dash, 70% opacity").
 */
export function drawSoiBoundary(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  center: Vec2,
  soiRadiusMeters: number,
  viewportWidthPx: number,
  viewportHeightPx: number
): void {
  const screenCenter = worldToScreen(camera, center, viewportWidthPx, viewportHeightPx);
  const radiusPx = soiRadiusMeters * camera.pixelsPerMeter;

  ctx.save();
  ctx.strokeStyle = getColor('muted');
  ctx.globalAlpha = SOI_ALPHA;
  ctx.lineWidth = 1;
  ctx.setLineDash([...SOI_DASH]);
  ctx.beginPath();
  ctx.arc(screenCenter.x, screenCenter.y, radiusPx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws the maneuver-node glyph (DESIGN.md §5: "an 8 px `Burn` circle with a
 * ±13 px crosshair"). The ΔV label is UI text, drawn by the caller.
 */
export function drawManeuverNodeMarker(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  worldPos: Vec2,
  viewportWidthPx: number,
  viewportHeightPx: number
): Vec2 {
  const p = worldToScreen(camera, worldPos, viewportWidthPx, viewportHeightPx);
  ctx.save();
  ctx.strokeStyle = getColor('burn');
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(p.x, p.y, MANEUVER_NODE_RADIUS_PX, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(p.x - MANEUVER_NODE_CROSSHAIR_PX, p.y);
  ctx.lineTo(p.x + MANEUVER_NODE_CROSSHAIR_PX, p.y);
  ctx.moveTo(p.x, p.y - MANEUVER_NODE_CROSSHAIR_PX);
  ctx.lineTo(p.x, p.y + MANEUVER_NODE_CROSSHAIR_PX);
  ctx.stroke();
  ctx.restore();
  return p;
}

/**
 * Draws a body on the map: radial gradient disc plus a thin atmosphere ring
 * (DESIGN.md §5: "radial gradient sky-hi → sky-lo, thin atmosphere ring in
 * `Orbit` at 55%").
 */
export function drawMapBody(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  center: Vec2,
  radiusMeters: number,
  hasAtmosphere: boolean,
  viewportWidthPx: number,
  viewportHeightPx: number
): void {
  const p = worldToScreen(camera, center, viewportWidthPx, viewportHeightPx);
  const radiusPx = Math.max(radiusMeters * camera.pixelsPerMeter, 1);

  ctx.save();
  const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radiusPx);
  gradient.addColorStop(0, getColor('skyHi'));
  gradient.addColorStop(1, getColor('skyLo'));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radiusPx, 0, Math.PI * 2);
  ctx.fill();

  if (hasAtmosphere) {
    ctx.strokeStyle = getColor('orbit');
    ctx.globalAlpha = ATMOSPHERE_RING_ALPHA;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radiusPx + 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
