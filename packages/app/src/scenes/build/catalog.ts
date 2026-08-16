/**
 * Part catalog: category grouping + free-text search over a `PartLibrary`
 * (PLAN.md §7, "catalog by category with search"). Pure data logic — no DOM —
 * `BuildScene.ts` renders the result.
 */
import type { PartCategory, PartDef, PartLibrary } from '@karman/core';
import type { Locale } from '../../i18n';

/** Category order shown in the catalog's tab strip — roughly bottom-of-rocket-to-top, matching how a stack is usually built. */
export const CATEGORY_ORDER: readonly PartCategory[] = [
  'pod',
  'tanks',
  'engines',
  'boosters',
  'separators',
  'fairings',
  'parachutes',
  'legs',
  'rcs',
  'power',
  'docking',
  'adapters',
  'control',
  'structural',
  'lights',
];

export interface CatalogFilter {
  /** `null` shows every category (used together with an active search query). */
  readonly category: PartCategory | null;
  readonly query: string;
}

export function emptyFilter(): CatalogFilter {
  return { category: 'pod', query: '' };
}

function localizedName(part: PartDef, locale: Locale): string {
  return part.name[locale];
}

/** Case-insensitive substring match against the part's localized name (both languages, so switching locale mid-search still finds matches typed in the other one). */
function matchesQuery(part: PartDef, query: string): boolean {
  if (query.trim() === '') return true;
  const q = query.trim().toLowerCase();
  return part.name.en.toLowerCase().includes(q) || part.name.ru.toLowerCase().includes(q) || part.id.toLowerCase().includes(q);
}

/**
 * Parts to show for the given filter: a search query searches every category
 * regardless of the selected tab; with no query, only the selected category
 * (or everything, if `category` is `null`) is shown.
 */
export function filterCatalog(library: PartLibrary, filter: CatalogFilter): readonly PartDef[] {
  const hasQuery = filter.query.trim() !== '';
  return library
    .all()
    .filter((part) => (hasQuery || filter.category === null ? true : part.category === filter.category))
    .filter((part) => matchesQuery(part, filter.query))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Which categories actually have at least one loaded part — so empty tabs (e.g. a mod-only category) don't render. */
export function nonEmptyCategories(library: PartLibrary): readonly PartCategory[] {
  const present = new Set(library.all().map((p) => p.category));
  return CATEGORY_ORDER.filter((c) => present.has(c));
}

export function sortedCategoryParts(library: PartLibrary, category: PartCategory, locale: Locale): readonly PartDef[] {
  return library
    .all()
    .filter((p) => p.category === category)
    .slice()
    .sort((a, b) => localizedName(a, locale).localeCompare(localizedName(b, locale)));
}
