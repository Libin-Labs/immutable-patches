# @lp-labs/immutable-patches

Generate and apply bounded, reversible patches to plain JSON values. Object paths are JSON pointers;
arrays are replaced as a unit to keep edits predictable and preserve unchanged object branches.

- Zero runtime and peer dependencies; ESM, CommonJS, and TypeScript declarations.
- Optimistic before-value checks detect stale/conflicting updates.
- No class instances, dates, sparse arrays, custom serializers, or mutable patch application.
- [MIT](./LICENSE). Node.js 18+.

## Installation

```sh
npm install @lp-labs/immutable-patches
```

## Quickstart

```js
import { createPatches, applyPatches, invertPatches } from '@lp-labs/immutable-patches';

const original = { user: { name: 'Ada', active: false }, tags: ['math'] };
const updated = { user: { name: 'Ada', active: true }, tags: ['math', 'logic'] };
const patches = createPatches(original, updated);
const next = applyPatches(original, patches);
const restored = applyPatches(next, invertPatches(patches));
console.log(next.user.active, restored.user.active); // true, false
console.log(next.tags === original.tags); // false; arrays are replaced as a unit
```

CommonJS: `const { createPatches, applyPatches, invertPatches } = require('@lp-labs/immutable-patches')`.

## API

- `createPatches(before, after, options?)` returns a frozen patch array. Patches contain an escaped
  JSON-pointer `path`, before/after presence flags, and corresponding JSON values. Missing object
  properties are distinct from properties whose value is `null`.
- `applyPatches(value, patches, options?)` returns a new value with structural sharing. Each patch's
  recorded prior value must match; otherwise `PatchError` with code `conflict` is thrown.
- `invertPatches(patches, options?)` swaps before/after states. Apply the inverse to the patched
  value, not to the original.

Options default to `maxPatches: 1000`, `maxNodes: 10000`, `maxDepth: 64`; bounds are 100,000
patches, one million nodes, and depth 256. Invalid values throw `PatchError` (`invalid`,
`conflict`, or `capacity`). A no-op diff is an empty array.

## Customization and limitations

Tune limits for your expected document sizes. Values must be finite JSON data with ordinary
objects and dense arrays; getters/accessors and custom prototypes are rejected. Object fields are
diffed individually. If a node changes between array, object, or scalar, the whole node is replaced;
array element-level operations are intentionally not generated. Patch application is synchronous
and local; it does not merge concurrent edits, encode binary data, or validate an application schema.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
