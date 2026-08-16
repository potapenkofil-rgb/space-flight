import { beforeEach, describe, expect, it } from 'vitest';
import { createLocalWorldStorage } from './localWorldStorage';

describe('createLocalWorldStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a write/read behind the same WorldStorage interface as the in-memory adapter', () => {
    const storage = createLocalWorldStorage();
    storage.write('saves/worlds/x/world.json', '{"a":1}');
    expect(storage.read('saves/worlds/x/world.json')).toBe('{"a":1}');
  });

  it('read returns null for a missing path', () => {
    const storage = createLocalWorldStorage();
    expect(storage.read('nope')).toBeNull();
  });

  it('remove deletes an entry', () => {
    const storage = createLocalWorldStorage();
    storage.write('a', '1');
    storage.remove('a');
    expect(storage.read('a')).toBeNull();
  });

  it('list returns matching paths, sorted, and does not leak unrelated localStorage keys', () => {
    const storage = createLocalWorldStorage();
    storage.write('saves/worlds/zeta/world.json', '{}');
    storage.write('saves/worlds/alpha/world.json', '{}');
    localStorage.setItem('karman:locale', 'ru'); // unrelated app state, same localStorage
    expect(storage.list('saves/worlds/')).toEqual([
      'saves/worlds/alpha/world.json',
      'saves/worlds/zeta/world.json',
    ]);
  });

  it('does not collide with plain localStorage keys of the same name', () => {
    localStorage.setItem('a', 'not-ours');
    const storage = createLocalWorldStorage();
    expect(storage.read('a')).toBeNull();
    storage.write('a', 'ours');
    expect(localStorage.getItem('a')).toBe('not-ours');
    expect(storage.read('a')).toBe('ours');
  });
});
