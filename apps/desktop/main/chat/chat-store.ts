import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  CHAT_LOG_SCHEMA_VERSION,
  ChatLogSchema,
  ChatMessageSchema,
  MAX_CHAT_MESSAGES,
  type ChatMessage,
} from '@miaoma/video-project';
import { IpcError } from '../ipc-error';
import type { ProjectStore } from '../projects/project-store';

const MAX_CHAT_LOG_BYTES = 8 * 1024 * 1024;

/**
 * `<project>/messages.json` 追加写。
 *
 * - 每工程一个 promise 队列，避免并发读改写丢消息；
 * - 按消息 id 去重；
 * - 同目录临时文件 + rename，失败保留上一份；
 * - 损坏文件不覆盖，返回 CHAT_LOG_INVALID。
 */
export class ChatStore {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly getProjectStore: () => ProjectStore) {}

  read(projectId: string): ChatMessage[] {
    const filePath = this.logPath(projectId);

    if (!existsSync(filePath)) {
      return [];
    }

    let raw: unknown;

    try {
      raw = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      throw new IpcError('CHAT_LOG_INVALID', '消息记录不是有效的 JSON。');
    }

    const parsed = ChatLogSchema.safeParse(raw);

    if (!parsed.success) {
      throw new IpcError('CHAT_LOG_INVALID', '消息记录结构无效。', false, {
        issues: parsed.error.issues.slice(0, 10).map((issue) => ({
          message: issue.message,
          path: issue.path.map(String).join('.'),
        })),
      });
    }

    if (parsed.data.projectId !== projectId) {
      throw new IpcError('CHAT_LOG_INVALID', '消息记录与工程不匹配。');
    }

    return parsed.data.messages;
  }

  append(projectId: string, messages: readonly ChatMessage[]): Promise<ChatMessage[]> {
    const operation = async (): Promise<ChatMessage[]> => {
      if (messages.length === 0) {
        return [];
      }

      const current = this.read(projectId);
      const existingIds = new Set(current.map((message) => message.id));
      const additions: ChatMessage[] = [];

      for (const message of messages) {
        if (message.projectId !== projectId) {
          throw new IpcError('CHAT_INVALID_ARGUMENT', '消息与工程不匹配。');
        }

        if (existingIds.has(message.id)) {
          continue;
        }

        const parsed = ChatMessageSchema.safeParse(message);

        if (!parsed.success) {
          throw new IpcError('CHAT_INVALID_ARGUMENT', '消息结构无效。', false, {
            issues: parsed.error.issues.slice(0, 10).map((issue) => ({
              message: issue.message,
              path: issue.path.map(String).join('.'),
            })),
          });
        }

        existingIds.add(parsed.data.id);
        additions.push(parsed.data);
      }

      if (additions.length === 0) {
        return [];
      }

      const next = [...current, ...additions];

      if (next.length > MAX_CHAT_MESSAGES) {
        throw new IpcError('CHAT_LOG_TOO_LARGE', '消息数量超过上限。');
      }

      const serialized = `${JSON.stringify(
        {
          schemaVersion: CHAT_LOG_SCHEMA_VERSION,
          projectId,
          messages: next,
        },
        null,
        2,
      )}\n`;

      if (Buffer.byteLength(serialized, 'utf8') > MAX_CHAT_LOG_BYTES) {
        throw new IpcError('CHAT_LOG_TOO_LARGE', '消息记录超过 8MB 上限。');
      }

      this.write(projectId, serialized);
      return additions;
    };

    const previous = this.queues.get(projectId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.queues.set(
      projectId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );

    return next;
  }

  private write(projectId: string, content: string): void {
    const target = this.logPath(projectId);
    const directory = path.dirname(target);
    const temporary = path.join(directory, `.messages.json.${randomUUID()}.tmp`);

    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
      renameSync(temporary, target);
    } catch {
      try {
        rmSync(temporary, { force: true });
      } catch {
        // 清理失败不影响主错误。
      }
      throw new IpcError('CHAT_WRITE_FAILED', '保存消息记录失败。', true);
    }
  }

  private logPath(projectId: string): string {
    return path.join(this.getProjectStore().getProjectDirectory(projectId), 'messages.json');
  }
}
