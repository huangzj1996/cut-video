import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function isBinaryAvailable(binaryPath: string): boolean {
  if (path.isAbsolute(binaryPath)) {
    return existsSync(binaryPath);
  }

  const result = spawnSync(binaryPath, ['-version'], {
    windowsHide: true,
    stdio: 'ignore',
  });

  return result.status === 0;
}
