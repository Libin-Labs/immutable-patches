import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPatches, createPatches, invertPatches, PatchError } from '../dist/esm/index.js';

test('generates reversible object and array changes', () => {
  const before = { user: { name: 'Ada', active: false }, tags: ['math'], untouched: { ok: true } };
  const after = {
    user: { name: 'Ada', active: true },
    tags: ['math', 'logic'],
    untouched: { ok: true },
  };
  const patches = createPatches(before, after);
  const changed = applyPatches(before, patches);
  assert.deepEqual(changed, after);
  assert.strictEqual(changed.untouched, before.untouched);
  assert.deepEqual(applyPatches(changed, invertPatches(patches)), before);
  assert.deepEqual(before.tags, ['math']);
});

test('distinguishes a missing property from a null value', () => {
  const patches = createPatches({ keep: null }, { added: null });
  assert.deepEqual(applyPatches({ keep: null }, patches), { added: null });
  assert.deepEqual(applyPatches({ added: null }, invertPatches(patches)), { keep: null });
});

test('escapes slash and tilde in JSON pointer segments', () => {
  const patches = createPatches({ 'a/b~c': 1 }, { 'a/b~c': 2 });
  assert.equal(patches[0].path, '/a~1b~0c');
  assert.deepEqual(applyPatches({ 'a/b~c': 1 }, patches), { 'a/b~c': 2 });
});

test('replaces array nodes as a unit and leaves the input unchanged', () => {
  const before = { list: [1, 2, 3] };
  const patches = createPatches(before, { list: [1, 4] });
  assert.equal(patches.length, 1);
  const updated = applyPatches(before, patches);
  assert.deepEqual(updated, { list: [1, 4] });
  assert.deepEqual(before.list, [1, 2, 3]);
});

test('detects conflicts instead of silently overwriting divergent data', () => {
  const patches = createPatches({ count: 1 }, { count: 2 });
  assert.throws(() => applyPatches({ count: 3 }, patches), { code: 'conflict' });
  assert.throws(() => applyPatches({}, patches), { code: 'conflict' });
});

test('rejects malformed pointers and malformed patch records', () => {
  assert.throws(
    () =>
      applyPatches({}, [
        {
          path: '/bad~2escape',
          beforeExists: false,
          afterExists: true,
          after: 1,
        },
      ]),
    { code: 'invalid' },
  );
  assert.throws(
    () =>
      applyPatches({}, [
        {
          path: '/x',
          beforeExists: false,
          before: 1,
          afterExists: true,
          after: 2,
        },
      ]),
    { code: 'invalid' },
  );
});

test('rejects non-JSON values and non-finite numbers', () => {
  assert.throws(() => createPatches({ x: NaN }, { x: 1 }), { code: 'invalid' });
  assert.throws(() => createPatches(new Date(), {}), { code: 'invalid' });
});

test('rejects array accessors and holes and deeply freezes patch payloads', () => {
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => createPatches(sparse, [1]), { code: 'invalid' });
  const accessor = [];
  Object.defineProperty(accessor, '0', {
    enumerable: true,
    get() {
      return 1;
    },
  });
  accessor.length = 1;
  assert.throws(() => createPatches(accessor, [2]), { code: 'invalid' });
  const patches = createPatches(0, { nested: { value: 1 } });
  assert.equal(Object.isFrozen(patches[0].after.nested), true);
});

test('returns a frozen empty patch list for equal input', () => {
  const patches = createPatches({ a: [1, { b: true }] }, { a: [1, { b: true }] });
  assert.deepEqual(patches, []);
  assert.equal(Object.isFrozen(patches), true);
});

test('enforces patch count, node, and depth capacities', () => {
  assert.throws(() => createPatches({ a: 1, b: 1 }, { a: 2, b: 2 }, { maxPatches: 1 }), {
    code: 'capacity',
  });
  assert.throws(() => createPatches({ a: 1 }, { a: 2 }, { maxNodes: 1 }), { code: 'capacity' });
  assert.throws(() => createPatches({ a: { b: 1 } }, { a: { b: 2 } }, { maxDepth: 0 }), {
    code: 'capacity',
  });
});

test('supports root replacement and its inverse', () => {
  const patches = createPatches('old', { next: true });
  assert.deepEqual(applyPatches('old', patches), { next: true });
  assert.equal(applyPatches({ next: true }, invertPatches(patches)), 'old');
});

test('limits patch application and rejects root deletion', () => {
  const patches = createPatches({ a: 1 }, { a: 2 });
  assert.throws(() => applyPatches({ a: 1 }, patches, { maxPatches: 0 }), RangeError);
  assert.throws(
    () =>
      applyPatches('value', [
        {
          path: '',
          beforeExists: true,
          before: 'value',
          afterExists: false,
        },
      ]),
    { code: 'invalid' },
  );
  assert.throws(() => invertPatches(patches, { maxPatches: 0 }), RangeError);
});
