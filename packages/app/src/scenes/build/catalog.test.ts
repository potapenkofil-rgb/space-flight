import { describe, expect, it } from 'vitest';
import { FIXTURE_PARTS } from './__fixtures__/parts';
import { emptyFilter, filterCatalog, nonEmptyCategories, sortedCategoryParts } from './catalog';

describe('filterCatalog', () => {
  it('shows only the selected category with no search text', () => {
    const result = filterCatalog(FIXTURE_PARTS, { category: 'tanks', query: '' });
    expect(result.every((p) => p.category === 'tanks')).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('a non-empty query searches across every category', () => {
    const result = filterCatalog(FIXTURE_PARTS, { category: 'tanks', query: 'engine' });
    expect(result.some((p) => p.category === 'engines')).toBe(true);
  });

  it('matches the Russian name too', () => {
    // Pulled from the fixture's own data at runtime, never typed as a literal
    // here — this file lives outside i18n/, where the project's no-cyrillic
    // guard test forbids non-Latin source text.
    const ruQuery = FIXTURE_PARTS.get('tank_s1').name.ru.slice(0, 3);
    const result = filterCatalog(FIXTURE_PARTS, { category: null, query: ruQuery });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.category === 'tanks')).toBe(true);
  });

  it('matches by part id as a fallback', () => {
    const result = filterCatalog(FIXTURE_PARTS, { category: null, query: 'tank_s1' });
    expect(result.map((p) => p.id)).toContain('tank_s1');
  });

  it('empty filter defaults to the pod category', () => {
    expect(emptyFilter().category).toBe('pod');
  });
});

describe('nonEmptyCategories', () => {
  it('only lists categories that actually have parts loaded', () => {
    const categories = nonEmptyCategories(FIXTURE_PARTS);
    expect(categories).toContain('tanks');
    expect(categories).toContain('engines');
    expect(categories).not.toContain('lights'); // no lights in the fixture roster
  });
});

describe('sortedCategoryParts', () => {
  it('sorts by localized name', () => {
    const ru = sortedCategoryParts(FIXTURE_PARTS, 'tanks', 'ru');
    const names = ru.map((p) => p.name.ru);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
