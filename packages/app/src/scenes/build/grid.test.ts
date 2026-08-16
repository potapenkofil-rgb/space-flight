import { describe, expect, it } from 'vitest';
import { createCamera } from '../../render/camera';
import { pickNearestCandidate, snapPointToGrid, snapToGrid } from './grid';
import type { AttachCandidate } from './state';

function candidate(id: number, worldPos: { x: number; y: number }): AttachCandidate {
  return {
    parentInstanceId: id,
    parentNodeIndex: 0,
    ownNodeIndex: 0,
    worldPos,
    transform: { position: worldPos, rotation: 0 },
    kind: 'stack',
  };
}

describe('snapToGrid', () => {
  it('rounds to the nearest step', () => {
    expect(snapToGrid(0.4)).toBe(0);
    expect(snapToGrid(0.6)).toBe(1);
    expect(snapToGrid(2.5, 2)).toBe(2); // banker's-adjacent: Math.round(1.25)*2 = 2 per Math.round semantics
  });
  it('snapPointToGrid rounds both axes', () => {
    expect(snapPointToGrid({ x: 1.6, y: -1.4 })).toEqual({ x: 2, y: -1 });
  });
});

describe('pickNearestCandidate: screen-pixel capture radius, not metres', () => {
  it('snaps at a close zoom when the node is within radius on screen', () => {
    const camera = createCamera({ x: 0, y: 0 }, 20); // 20 px per metre — close zoom
    const candidates = [candidate(1, { x: 0.5, y: 0 })]; // 0.5 m away == 10 px on screen
    const picked = pickNearestCandidate(candidates, { x: 0, y: 0 }, camera, 800, 600, 18);
    expect(picked).not.toBeNull();
  });

  it('still snaps at a distant zoom, because the radius is screen-pixel not metre-based', () => {
    // At a very wide (zoomed-out) view, 0.5 m of world distance is a fraction of a pixel —
    // a metres-based radius would never catch it, but a screen-pixel radius still does
    // once the *screen* distance (here: 0) is within `radiusPx`.
    const camera = createCamera({ x: 0, y: 0 }, 0.01); // 0.01 px per metre — very far zoom
    const candidates = [candidate(1, { x: 0.5, y: 0 })]; // 0.005 px away on screen
    const picked = pickNearestCandidate(candidates, { x: 0, y: 0 }, camera, 800, 600, 18);
    expect(picked).not.toBeNull();
  });

  it('does not snap once the node is farther than radiusPx on screen, even up close', () => {
    const camera = createCamera({ x: 0, y: 0 }, 20);
    const candidates = [candidate(1, { x: 5, y: 0 })]; // 5 m == 100 px, well outside 18px radius
    const picked = pickNearestCandidate(candidates, { x: 0, y: 0 }, camera, 800, 600, 18);
    expect(picked).toBeNull();
  });

  it('picks the nearest of several candidates', () => {
    const camera = createCamera({ x: 0, y: 0 }, 20);
    const candidates = [candidate(1, { x: 0.8, y: 0 }), candidate(2, { x: 0.2, y: 0 })];
    const picked = pickNearestCandidate(candidates, { x: 0, y: 0 }, camera, 800, 600, 100);
    expect(picked?.parentInstanceId).toBe(2);
  });
});
