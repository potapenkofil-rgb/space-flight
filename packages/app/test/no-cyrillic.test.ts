/**
 * Guard test: no Cyrillic text outside `i18n/` (PLAN.md §7 item 10, DESIGN.md
 * §6 — "ни одной строки, видимой игроку, не хардкодится в коде"). Scans every
 * `.ts`/`.css`/`.html` file under both packages' `src/`, skipping any path
 * that contains an `i18n` directory segment.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = [join(__dirname, '..', 'src'), join(__dirname, '..', '..', 'core', 'src')];
const EXTENSIONS = ['.ts', '.css', '.html'];
const CYRILLIC = /[Ѐ-ӿ]/;

/**
 * `math/units.ts` is the one deliberate exception to "no Cyrillic outside
 * i18n/": DESIGN.md §6.1 explicitly assigns localized unit symbols (м/км,
 * м/с, кг/т vs. m/km, m/s, kg/t) to `@karman/core`'s `math/units` module,
 * not to `i18n/` (core has no i18n dependency at all — see PLAN.md §2). Its
 * test file legitimately asserts those Cyrillic symbols as expected output.
 */
const ALLOWLISTED_SUFFIXES = ['core/src/math/units.ts', 'core/src/math/units.test.ts'];

function isAllowlisted(path: string): boolean {
  return ALLOWLISTED_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'i18n') continue;
      out.push(...listFiles(full));
    } else if (EXTENSIONS.includes(full.slice(full.lastIndexOf('.'))) && !isAllowlisted(full)) {
      out.push(full);
    }
  }
  return out;
}

describe('no-cyrillic guard', () => {
  const files = ROOTS.flatMap((root) => listFiles(root));

  it('found source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} has no Cyrillic characters`, () => {
      const content = readFileSync(file, 'utf8');
      const match = CYRILLIC.exec(content);
      const context = match ? content.slice(Math.max(0, match.index - 20), match.index + 20) : '';
      expect(match, `found Cyrillic near "${context}" in ${file}`).toBeNull();
    });
  }
});
