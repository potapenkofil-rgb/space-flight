import { describe, expect, it } from 'vitest';
import { createMarkerDetector } from './markers';
import { createFakeBody, createFakeVessel } from './testFixtures';

const BODY = createFakeBody({ radius: 1_000_000, atmosphere: { rho0: 1.225, scaleHeight: 7000, top: 60_000 } });

function vesselAt(id: number, radius: number, radialSpeed: number): ReturnType<typeof createFakeVessel> {
  return createFakeVessel(id, {
    soi: BODY,
    position: { x: 0, y: radius },
    velocity: { x: 0, y: radialSpeed },
  });
}

describe('createMarkerDetector', () => {
  it('reports launch on the very first observation', () => {
    const detector = createMarkerDetector();
    const markers = detector.observe(0, [vesselAt(1, 1_100_000, 0)], 1, false);
    expect(markers).toContainEqual({ t: 0, kind: 'launch', vesselId: 1 });
  });

  it('reports atmosphere-entry when altitude crosses below the atmosphere top', () => {
    const detector = createMarkerDetector();
    detector.observe(0, [vesselAt(1, BODY.radius + 100_000, -10)], 1, false); // above atmosphere
    const markers = detector.observe(1, [vesselAt(1, BODY.radius + 50_000, -10)], 1, false); // below top (60km)
    expect(markers).toContainEqual(expect.objectContaining({ kind: 'atmosphere-entry', vesselId: 1 }));
  });

  it('reports apoapsis one tick after a local radius maximum', () => {
    const detector = createMarkerDetector();
    const radii = [1_100_000, 1_150_000, 1_180_000, 1_150_000, 1_100_000];
    let all: ReturnType<typeof detector.observe> = [];
    radii.forEach((r, i) => {
      all = all.concat(detector.observe(i, [vesselAt(1, r, 0)], 1, false));
    });
    const apo = all.find((m) => m.kind === 'apoapsis');
    expect(apo).toBeDefined();
    expect(apo?.t).toBe(2); // the peak (index 2, radius 1,180,000) confirmed once index 3 comes in
  });

  it('reports periapsis one tick after a local radius minimum', () => {
    const detector = createMarkerDetector();
    const radii = [1_180_000, 1_120_000, 1_100_000, 1_120_000, 1_180_000];
    let all: ReturnType<typeof detector.observe> = [];
    radii.forEach((r, i) => {
      all = all.concat(detector.observe(i, [vesselAt(1, r, 0)], 1, false));
    });
    expect(all.some((m) => m.kind === 'periapsis' && m.t === 2)).toBe(true);
  });

  it('reports a soft landing for a slow descent through the surface', () => {
    const detector = createMarkerDetector();
    detector.observe(0, [vesselAt(1, BODY.radius + 10, -2)], 1, false);
    const markers = detector.observe(1, [vesselAt(1, BODY.radius - 1, -2)], 1, false);
    expect(markers).toContainEqual(expect.objectContaining({ kind: 'landing', vesselId: 1 }));
  });

  it('reports an impact for a fast descent through the surface', () => {
    const detector = createMarkerDetector();
    detector.observe(0, [vesselAt(1, BODY.radius + 500, -300)], 1, false);
    const markers = detector.observe(1, [vesselAt(1, BODY.radius - 200, -300)], 1, false);
    expect(markers).toContainEqual(expect.objectContaining({ kind: 'impact', vesselId: 1 }));
  });

  it('distinguishes voluntary stage-separation from unplanned part-loss by the staged flag', () => {
    const withStage = createMarkerDetector();
    withStage.observe(0, [vesselAt(1, 1_100_000, 0)], 1, false);
    const staged = withStage.observe(1, [vesselAt(1, 1_100_000, 0), vesselAt(2, 1_050_000, 0)], 1, true);
    expect(staged).toContainEqual(expect.objectContaining({ kind: 'stage-separation' }));

    const withoutStage = createMarkerDetector();
    withoutStage.observe(0, [vesselAt(1, 1_100_000, 0)], 1, false);
    const broke = withoutStage.observe(1, [vesselAt(1, 1_100_000, 0), vesselAt(2, 1_050_000, 0)], 1, false);
    expect(broke).toContainEqual(expect.objectContaining({ kind: 'part-loss' }));
  });
});
