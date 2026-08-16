/** Test-only fixtures for `saves/`. Not exported from `index.ts` — see `recording/testFixtures.ts` for the sibling fixtures this reuses. */
import type { SystemLibrary } from '../data/types';
import type { Body } from '../orbits/types';
import { createFakeBody } from '../recording/testFixtures';

export function createFakeSystemLibrary(bodies: readonly Body[] = [createFakeBody()]): SystemLibrary {
  const byId = new Map(bodies.map((b) => [b.id, b]));
  return {
    root: bodies[0]!,
    get(id: string): Body {
      const body = byId.get(id);
      if (!body) throw new Error(`fake SystemLibrary: unknown body "${id}"`);
      return body;
    },
  };
}
