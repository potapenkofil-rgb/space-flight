/**
 * `@karman/core` — the pure-TypeScript simulation core. Zero DOM access (no
 * `document`, `window`, `Image`, `performance`, `localStorage`) — see
 * PLAN.md §2/§3.6 and `test/no-dom.test.ts`, which enforces this by scanning
 * `src/`.
 */
export * from './math';
export * from './orbits';
export * from './vessels';
export * from './flight';
export * from './data';
export * from './recording';
