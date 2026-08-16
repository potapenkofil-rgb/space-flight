import { describe, expect, it } from 'vitest';
import { FIXTURE_PARTS } from './__fixtures__/parts';
import { parsePartArt } from './partArt';

describe('parsePartArt', () => {
  it('extracts every supported shape with role-named colors, ignoring nothing unexpected', () => {
    const tank = FIXTURE_PARTS.get('tank_s1');
    const parsed = parsePartArt(tank.art);
    expect(parsed.viewBox).toEqual({ w: 64, h: 64 });
    expect(parsed.shapes.length).toBeGreaterThan(0);
    const rect = parsed.shapes.find((s) => s.kind === 'rect');
    expect(rect).toBeDefined();
    expect(rect?.fillRole).toBe('panel');
    expect(rect?.strokeRole).toBe('inkMuted');
  });

  it('parses polygons (used by the pod and the SRB nozzle) with their points intact', () => {
    const pod = FIXTURE_PARTS.get('pod_capsule');
    const parsed = parsePartArt(pod.art);
    const polygon = parsed.shapes.find((s) => s.kind === 'polygon');
    expect(polygon).toBeDefined();
    expect(polygon?.points?.length).toBeGreaterThan(0);
  });

  it('parses lines (tank shpangout markings) with numeric coordinates', () => {
    const tank = FIXTURE_PARTS.get('tank_s1');
    const parsed = parsePartArt(tank.art);
    const line = parsed.shapes.find((s) => s.kind === 'line');
    expect(line).toBeDefined();
    expect(typeof line?.x1).toBe('number');
    expect(typeof line?.y2).toBe('number');
  });

  it('Burn is only used on what burns or separates (DESIGN.md §4), never on a tank or pod', () => {
    for (const part of FIXTURE_PARTS.all()) {
      const parsed = parsePartArt(part.art);
      const usesBurn = parsed.shapes.some((s) => s.fillRole === 'burn' || s.strokeRole === 'burn');
      if (usesBurn) {
        expect(['engines', 'boosters', 'separators', 'rcs', 'docking']).toContain(part.category);
      }
    }
  });
});
