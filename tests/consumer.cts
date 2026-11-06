import { createPatches, applyPatches, PatchError } from '@lp-labs/immutable-patches';
const patches = createPatches({ x: true }, { x: false });
const updated = applyPatches({ x: true }, patches);
const error = new PatchError('conflict', 'stale');
void [updated, error];
