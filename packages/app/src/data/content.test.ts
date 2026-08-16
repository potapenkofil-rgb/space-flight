import { describe, expect, it } from 'vitest';
import { loadContent } from './content';

describe('loadContent', () => {
  it('loads all 25 base parts with no validation issues', () => {
    const { library, issues } = loadContent();
    expect(library.all()).toHaveLength(25);
    expect(issues).toEqual([]);
  });

  it('loads the karman system with terra as root and luna as a child', () => {
    const { system } = loadContent();
    expect(system.root.id).toBe('terra');
    expect(system.get('luna').parent?.id).toBe('terra');
    expect(system.get('luna').orbit?.a).toBe(6_000_000);
  });

  it('returns parts sorted deterministically by id', () => {
    const { library } = loadContent();
    const ids = library.all().map((p) => p.id);
    const sorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(ids).toEqual(sorted);
  });

  it('is cached — repeated calls return the same instances', () => {
    const first = loadContent();
    const second = loadContent();
    expect(first).toBe(second);
  });
});
