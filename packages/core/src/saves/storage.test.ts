import { describe, expect, it } from 'vitest';
import { createInMemoryWorldStorage } from './storage';

describe('createInMemoryWorldStorage', () => {
  it('round-trips a write/read', () => {
    const storage = createInMemoryWorldStorage();
    storage.write('a/b.json', '{"x":1}');
    expect(storage.read('a/b.json')).toBe('{"x":1}');
  });

  it('read returns null for a missing path', () => {
    const storage = createInMemoryWorldStorage();
    expect(storage.read('nope')).toBeNull();
  });

  it('remove deletes an entry (no-op if absent)', () => {
    const storage = createInMemoryWorldStorage();
    storage.write('a', '1');
    storage.remove('a');
    expect(storage.read('a')).toBeNull();
    expect(() => storage.remove('a')).not.toThrow();
  });

  it('list returns matching paths sorted, regardless of write order', () => {
    const storage = createInMemoryWorldStorage();
    storage.write('saves/worlds/zeta/world.json', '{}');
    storage.write('saves/worlds/alpha/world.json', '{}');
    storage.write('saves/worlds/mu/world.json', '{}');
    storage.write('saves/blueprints/x.json', '{}');
    expect(storage.list('saves/worlds/')).toEqual([
      'saves/worlds/alpha/world.json',
      'saves/worlds/mu/world.json',
      'saves/worlds/zeta/world.json',
    ]);
  });
});
