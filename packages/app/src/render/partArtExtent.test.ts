/**
 * The inked extent of a part's drawing — not its canvas — is what maps onto
 * the part's physical height. Two things go wrong when that slips, and
 * neither shows up in any other test: parts stop meeting flush (an assembled
 * rocket renders with visible gaps at every joint), and parts render upside
 * down (a nozzle pointing at the sky).
 */
import { describe, expect, it } from 'vitest';
import { parsePartArt } from './part-renderer';

const SVG = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`;

describe('parsePartArt content extent', () => {
  it('measures a rect from its edges, stroke overhang included', () => {
    const art = parsePartArt(SVG('<rect x="20" y="10" width="24" height="30" fill="Panel" stroke="InkMuted" stroke-width="2"/>'));
    expect(art.contentY.min).toBeCloseTo(9, 6);
    expect(art.contentY.max).toBeCloseTo(41, 6);
  });

  it('ignores stroke overhang for an unstroked shape', () => {
    const art = parsePartArt(SVG('<rect x="20" y="10" width="24" height="30" fill="Burn"/>'));
    expect(art.contentY.min).toBeCloseTo(10, 6);
    expect(art.contentY.max).toBeCloseTo(40, 6);
  });

  it('spans every shape, taking path coordinates into account', () => {
    const art = parsePartArt(
      SVG(
        '<rect x="21" y="20" width="22" height="16" fill="Panel"/>' +
          '<path d="M 21 36 L 15 62 L 49 62 L 43 36 Z" fill="Burn"/>'
      )
    );
    expect(art.contentY.min).toBeCloseTo(20, 6);
    expect(art.contentY.max).toBeCloseTo(62, 6);
  });

  it('falls back to the full canvas when nothing is drawn', () => {
    const art = parsePartArt(SVG(''));
    expect(art.contentY).toEqual({ min: 0, max: 64 });
  });
});
