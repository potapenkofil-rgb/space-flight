/**
 * Guard test: `@karman/core` must never touch the DOM (PLAN.md §2/§3.6). This
 * scans every `.ts` source file under `packages/core/src` for references to
 * `document`, `window`, `Image`, `performance` or `localStorage` in actual
 * code (comments and TSDoc are stripped first, since this file's own contract
 * types document the rule by name).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = join(__dirname, '..', 'src');
const FORBIDDEN = ['document', 'window', 'Image', 'performance', 'localStorage'];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Strips `/* ... *\/` block comments and `// ...` line comments (good enough for our own source, not a full tokenizer). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('no-dom guard', () => {
  const files = listTsFiles(SRC_DIR);

  it('found source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file.slice(SRC_DIR.length + 1)} does not reference DOM globals`, () => {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const name of FORBIDDEN) {
        const re = new RegExp(`\\b${name}\\b`);
        expect(re.test(code), `found forbidden DOM reference "${name}" in ${file}`).toBe(false);
      }
    });
  }
});
