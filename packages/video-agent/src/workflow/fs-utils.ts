import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const RENAME_RETRIES = 3;
const RENAME_RETRY_DELAY_MS = 25;

export function isPathInside(parent: string, candidate: string): boolean {
  const parentResolved = path.resolve(parent);
  const candidateResolved = path.resolve(candidate);

  return (
    candidateResolved === parentResolved ||
    candidateResolved.startsWith(`${parentResolved}${path.sep}`)
  );
}

export function resolveInside(parent: string, relativePath: string): string {
  const resolved = path.resolve(parent, relativePath);

  if (!isPathInside(parent, resolved)) {
    throw new Error(`path escapes project directory: ${relativePath}`);
  }

  return resolved;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function renameWithRetry(source: string, target: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < RENAME_RETRIES; attempt += 1) {
    try {
      await fs.rename(source, target);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;

      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') {
        break;
      }

      await sleep(RENAME_RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError;
}

/**
 * 同目录临时文件 + fsync + rename，避免 Windows 上出现半个文件。
 */
export async function writeFileAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });

  const tempPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  const handle = await fs.open(tempPath, 'wx');

  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text) as T;
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function removePath(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true, recursive: true });
}
