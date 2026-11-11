export interface PreviewStateStorage {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
}

const PREFIX = "puff:preview-state:v1";
const KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const MAX_VALUE_BYTES = 8192;

function hashScope(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createPreviewStateScope(cwd: string, rootPath: string): string {
  return hashScope(`${cwd.replace(/\\/g, "/").replace(/\/+$/, "")}::${rootPath}`);
}

function storageKey(scope: string, key: string): string | null {
  return /^[a-z0-9]+$/i.test(scope) && KEY_PATTERN.test(key)
    ? `${PREFIX}:${scope}:${key}`
    : null;
}

function encodeValue(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > MAX_VALUE_BYTES) {
      return null;
    }
    return encoded;
  } catch {
    return null;
  }
}

export async function readPreviewState(
  storage: PreviewStateStorage,
  scope: string,
  key: string,
): Promise<unknown | null> {
  const fullKey = storageKey(scope, key);
  if (!fullKey) return null;
  try {
    const raw = await storage.getItem(fullKey);
    if (raw == null || new TextEncoder().encode(raw).byteLength > MAX_VALUE_BYTES) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writePreviewState(
  storage: PreviewStateStorage,
  scope: string,
  key: string,
  value: unknown,
): Promise<boolean> {
  const fullKey = storageKey(scope, key);
  const encoded = encodeValue(value);
  if (!fullKey || encoded == null) return false;
  try {
    await storage.setItem(fullKey, encoded);
    return true;
  } catch {
    return false;
  }
}
