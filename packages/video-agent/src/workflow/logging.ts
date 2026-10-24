import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { WorkflowLogEntry, WorkflowLogger } from './types';

const SECRET_PATTERN = /(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*\S+/gi;

export function redactLogText(value: string): string {
  return value.replace(SECRET_PATTERN, '$1=[redacted]');
}

export class JsonlWorkflowLogger implements WorkflowLogger {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  log(entry: WorkflowLogEntry): void {
    const record = {
      timestamp: new Date().toISOString(),
      ...entry,
      ...(entry.message !== undefined ? { message: redactLogText(entry.message) } : {}),
      ...(entry.error !== undefined
        ? {
            error: {
              ...entry.error,
              message: redactLogText(entry.error.message),
            },
          }
        : {}),
    };

    const line = `${JSON.stringify(record)}\n`;
    this.queue = this.queue
      .then(async () => {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await appendFile(this.filePath, line, 'utf8');
      })
      .catch(() => undefined);
  }

  async flush(): Promise<void> {
    await this.queue;
  }
}

export class NullWorkflowLogger implements WorkflowLogger {
  log(_entry: WorkflowLogEntry): void {
    // no-op
  }

  async flush(): Promise<void> {
    // no-op
  }
}
