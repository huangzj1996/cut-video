import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { RunEventSchema, type RunEvent } from '@miaoma/video-project';
import type { RunEventInput, RunEventSink } from './types';

export interface RunEventSinkOptions {
  runId: string;
  projectId: string;
  initialSeq?: number;
  now?: () => Date;
  onEvent?: (event: RunEvent) => void;
  /** 可选：把事件追加到 JSONL（RunManager 负责真正的持久化）。 */
  filePath?: string;
}

export class DefaultRunEventSink implements RunEventSink {
  private seq: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: RunEventSinkOptions) {
    this.seq = options.initialSeq ?? 0;
  }

  get lastSeq(): number {
    return this.seq;
  }

  emit(input: RunEventInput): RunEvent {
    this.seq += 1;
    const event = RunEventSchema.parse({
      schemaVersion: '1.0.0',
      runId: this.options.runId,
      projectId: this.options.projectId,
      seq: this.seq,
      timestamp: (this.options.now ?? (() => new Date()))().toISOString(),
      ...input,
    });

    this.options.onEvent?.(event);

    if (this.options.filePath) {
      const line = `${JSON.stringify(event)}\n`;
      const filePath = this.options.filePath;
      this.queue = this.queue
        .then(async () => {
          await mkdir(path.dirname(filePath), { recursive: true });
          await appendFile(filePath, line, 'utf8');
        })
        .catch(() => undefined);
    }

    return event;
  }

  async flush(): Promise<void> {
    await this.queue;
  }
}

export function createMemoryRunEventSink(
  options: Omit<RunEventSinkOptions, 'filePath'>,
): DefaultRunEventSink {
  return new DefaultRunEventSink(options);
}

export function createFileRunEventSink(
  options: RunEventSinkOptions & { filePath: string },
): DefaultRunEventSink {
  return new DefaultRunEventSink(options);
}
