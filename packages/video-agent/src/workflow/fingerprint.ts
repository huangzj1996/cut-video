import { createHash } from 'node:crypto';

type JsonLike = null | boolean | number | string | JsonLike[] | { [key: string]: JsonLike };

/**
 * 稳定序列化：对象键排序、忽略 undefined/function，保证相同内容得到相同指纹。
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown, seen = new WeakSet<object>()): JsonLike {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalize(item, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      throw new Error('cannot fingerprint a cyclic value');
    }

    seen.add(value);
    const result: { [key: string]: JsonLike } = {};

    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];

      if (child === undefined || typeof child === 'function') {
        continue;
      }

      result[key] = normalize(child, seen);
    }

    seen.delete(value);
    return result;
  }

  return null;
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function computeFingerprint(value: unknown): string {
  return sha256Hex(stableStringify(value));
}

export function createStableId(prefix: string, value: unknown): string {
  const slug = prefix.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40);
  return `${slug}-${computeFingerprint(value).slice(0, 16)}`;
}
