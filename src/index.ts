export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Patch {
  readonly path: string;
  readonly beforeExists: boolean;
  readonly before?: Json;
  readonly afterExists: boolean;
  readonly after?: Json;
}

export interface PatchOptions {
  readonly maxPatches?: number;
  readonly maxNodes?: number;
  readonly maxDepth?: number;
}

export class PatchError extends Error {
  constructor(
    readonly code: 'invalid' | 'conflict' | 'capacity',
    message: string,
  ) {
    super(message);
    this.name = 'PatchError';
  }
}

function cloneJson(value: unknown, limits: { nodes: number; depth: number }, level = 0): Json {
  limits.nodes--;
  if (limits.nodes < 0 || level > limits.depth)
    throw new PatchError('capacity', 'Value exceeds patch node or depth limits.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > limits.nodes)
      throw new PatchError('capacity', 'Array exceeds the patch node limit.');
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
        throw new PatchError('invalid', 'JSON arrays cannot have extra properties.');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor))
        throw new PatchError('invalid', 'JSON arrays must be dense data properties.');
    }
    const copy: Json[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !('value' in descriptor))
        throw new PatchError('invalid', 'JSON arrays must be dense data properties.');
      copy.push(cloneJson(descriptor.value, limits, level + 1));
    }
    return copy;
  }
  if (
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  ) {
    const copy: { [key: string]: Json } = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string')
        throw new PatchError('invalid', 'JSON records cannot contain symbol keys.');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor))
        throw new PatchError('invalid', 'JSON records must contain enumerable data properties.');
      Object.defineProperty(copy, key, {
        value: cloneJson(descriptor.value, limits, level + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return copy;
  }
  throw new PatchError('invalid', 'Patches support finite plain JSON data only.');
}

function freezeJson(value: Json): Json {
  if (value && typeof value === 'object') {
    for (const child of Array.isArray(value) ? value : Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

function pointer(parts: readonly string[]): string {
  return parts.map((part) => `/${part.replaceAll('~', '~0').replaceAll('/', '~1')}`).join('');
}

function equal(left: Json, right: Json): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => equal(value, right[index]!))
    );
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const a = Object.keys(left).sort();
    const b = Object.keys(right).sort();
    return (
      a.length === b.length &&
      a.every((key, index) => key === b[index] && equal(left[key]!, right[key]!))
    );
  }
  return false;
}

interface Limits {
  maxPatches: number;
  maxNodes: number;
  maxDepth: number;
}

function limits(options: PatchOptions): Limits {
  const result = {
    maxPatches: options.maxPatches ?? 1000,
    maxNodes: options.maxNodes ?? 10_000,
    maxDepth: options.maxDepth ?? 64,
  };
  if (
    !Number.isSafeInteger(result.maxPatches) ||
    result.maxPatches < 1 ||
    result.maxPatches > 100_000
  )
    throw new RangeError('maxPatches must be an integer from 1 through 100000.');
  if (!Number.isSafeInteger(result.maxNodes) || result.maxNodes < 1 || result.maxNodes > 1_000_000)
    throw new RangeError('maxNodes must be an integer from 1 through 1000000.');
  if (!Number.isSafeInteger(result.maxDepth) || result.maxDepth < 0 || result.maxDepth > 256)
    throw new RangeError('maxDepth must be an integer from 0 through 256.');
  return result;
}

export function createPatches(
  before: unknown,
  after: unknown,
  options: PatchOptions = {},
): readonly Patch[] {
  const setting = limits(options);
  const left = cloneJson(before, { nodes: setting.maxNodes, depth: setting.maxDepth });
  const right = cloneJson(after, { nodes: setting.maxNodes, depth: setting.maxDepth });
  const patches: Patch[] = [];
  const add = (
    path: readonly string[],
    oldExists: boolean,
    oldValue: Json | undefined,
    newExists: boolean,
    newValue: Json | undefined,
  ) => {
    patches.push(
      Object.freeze({
        path: pointer(path),
        beforeExists: oldExists,
        ...(oldExists ? { before: freezeJson(oldValue!) } : {}),
        afterExists: newExists,
        ...(newExists ? { after: freezeJson(newValue!) } : {}),
      }),
    );
    if (patches.length > setting.maxPatches)
      throw new PatchError('capacity', `Diff exceeds ${setting.maxPatches} patches.`);
  };
  const walk = (oldValue: Json, newValue: Json, path: string[], level: number) => {
    if (level > setting.maxDepth)
      throw new PatchError('capacity', 'Diff exceeds the maximum depth.');
    if (equal(oldValue, newValue)) return;
    if (
      oldValue &&
      newValue &&
      !Array.isArray(oldValue) &&
      !Array.isArray(newValue) &&
      typeof oldValue === 'object' &&
      typeof newValue === 'object'
    ) {
      const keys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);
      for (const key of [...keys].sort()) {
        const hasOld = Object.hasOwn(oldValue, key);
        const hasNew = Object.hasOwn(newValue, key);
        if (!hasOld) add([...path, key], false, undefined, true, newValue[key]!);
        else if (!hasNew) add([...path, key], true, oldValue[key]!, false, undefined);
        else walk(oldValue[key]!, newValue[key]!, [...path, key], level + 1);
      }
      return;
    }
    add(path, true, oldValue, true, newValue);
  };
  walk(left, right, [], 0);
  return Object.freeze(patches);
}

function parsePath(path: unknown): string[] {
  if (typeof path !== 'string' || (path !== '' && !path.startsWith('/')))
    throw new PatchError('invalid', 'Patch path must be an empty root path or a JSON pointer.');
  if (path === '') return [];
  return path
    .slice(1)
    .split('/')
    .map((part) => {
      if (/~(?![01])/.test(part)) throw new PatchError('invalid', 'Malformed JSON pointer escape.');
      return part.replaceAll('~1', '/').replaceAll('~0', '~');
    });
}

function updateAt(root: Json, parts: readonly string[], patch: Patch, depth = 0): Json {
  if (depth === parts.length) {
    const exists = root !== MISSING;
    if (exists !== patch.beforeExists || (exists && !equal(root, patch.before!))) {
      throw new PatchError('conflict', `Patch precondition failed at "${patch.path}".`);
    }
    return patch.afterExists ? cloneJson(patch.after, { nodes: 1_000_000, depth: 256 }) : MISSING;
  }
  const part = parts[depth]!;
  if (!root || Array.isArray(root) || typeof root !== 'object')
    throw new PatchError('conflict', `Patch parent does not exist at "${patch.path}".`);
  if (depth === parts.length - 1) {
    const exists = Object.hasOwn(root, part);
    const next = updateAt(exists ? root[part]! : MISSING, parts, patch, depth + 1);
    if (next === MISSING) {
      if (!exists)
        throw new PatchError('conflict', `Patch target does not exist at "${patch.path}".`);
      const copy = { ...root };
      delete copy[part];
      return copy;
    }
    return { ...root, [part]: next };
  }
  if (!Object.hasOwn(root, part))
    throw new PatchError('conflict', `Patch parent does not exist at "${patch.path}".`);
  const next = updateAt(root[part]!, parts, patch, depth + 1);
  if (next === MISSING) {
    const copy = { ...root };
    delete copy[part];
    return copy;
  }
  return { ...root, [part]: next };
}

const MISSING = Symbol('missing') as unknown as Json;

export function applyPatches<T>(
  input: T,
  patches: readonly Patch[],
  options: PatchOptions = {},
): T {
  const setting = limits(options);
  if (!Array.isArray(patches) || patches.length > setting.maxPatches)
    throw new PatchError('capacity', `Expected at most ${setting.maxPatches} patches.`);
  cloneJson(input, { nodes: setting.maxNodes, depth: setting.maxDepth });
  let value = input as Json;
  for (const candidate of patches) {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      typeof candidate.beforeExists !== 'boolean' ||
      typeof candidate.afterExists !== 'boolean' ||
      (!candidate.beforeExists && Object.hasOwn(candidate, 'before')) ||
      (!candidate.afterExists && Object.hasOwn(candidate, 'after')) ||
      (candidate.beforeExists && !Object.hasOwn(candidate, 'before')) ||
      (candidate.afterExists && !Object.hasOwn(candidate, 'after'))
    ) {
      throw new PatchError('invalid', 'Malformed patch record.');
    }
    const path = parsePath(candidate.path);
    if (path.length === 0) {
      if (!candidate.beforeExists || !equal(value, candidate.before!))
        throw new PatchError('conflict', 'Root patch precondition failed.');
      if (!candidate.afterExists)
        throw new PatchError('invalid', 'Removing a root value is not supported.');
      value = candidate.afterExists
        ? cloneJson(candidate.after, { nodes: setting.maxNodes, depth: setting.maxDepth })
        : (undefined as unknown as Json);
    } else {
      const next = updateAt(value, path, candidate);
      if (next === MISSING) throw new PatchError('invalid', 'A root value cannot be removed.');
      value = next;
    }
  }
  cloneJson(value, { nodes: setting.maxNodes, depth: setting.maxDepth });
  return value as T;
}

export function invertPatches(
  patches: readonly Patch[],
  options: PatchOptions = {},
): readonly Patch[] {
  const setting = limits(options);
  if (!Array.isArray(patches) || patches.length > setting.maxPatches)
    throw new PatchError('capacity', `Expected at most ${setting.maxPatches} patches.`);
  return Object.freeze(
    patches.map((patch) => {
      parsePath(patch.path);
      return Object.freeze({
        path: patch.path,
        beforeExists: patch.afterExists,
        ...(patch.afterExists
          ? {
              before: freezeJson(
                cloneJson(patch.after, { nodes: setting.maxNodes, depth: setting.maxDepth }),
              ),
            }
          : {}),
        afterExists: patch.beforeExists,
        ...(patch.beforeExists
          ? {
              after: freezeJson(
                cloneJson(patch.before, { nodes: setting.maxNodes, depth: setting.maxDepth }),
              ),
            }
          : {}),
      });
    }),
  );
}
