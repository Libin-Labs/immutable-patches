import { createPatches, applyPatches, invertPatches, type Patch } from '@lp-labs/immutable-patches';
const patches: readonly Patch[] = createPatches({ count: 1 }, { count: 2 });
const changed = applyPatches({ count: 1 }, patches);
const original = applyPatches(changed, invertPatches(patches));
const count: number = original.count;
void count;
