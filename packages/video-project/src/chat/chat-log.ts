import { z } from 'zod';
import { IdSchema } from '../schema';
import { ChatMessageSchema } from './message';

export const CHAT_LOG_SCHEMA_VERSION = '1.0.0' as const;
export const MAX_CHAT_MESSAGES = 2_000;

export const ChatLogSchema = z
  .strictObject({
    schemaVersion: z.literal(CHAT_LOG_SCHEMA_VERSION),
    projectId: IdSchema,
    messages: z.array(ChatMessageSchema).max(MAX_CHAT_MESSAGES),
  })
  .superRefine((log, ctx) => {
    const ids = new Set<string>();

    log.messages.forEach((message, position) => {
      if (message.projectId !== log.projectId) {
        ctx.addIssue({
          code: 'custom',
          message: 'message.projectId must match chat log projectId',
          path: ['messages', position, 'projectId'],
        });
      }

      if (ids.has(message.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate chat message id: ${message.id}`,
          path: ['messages', position, 'id'],
        });
      }

      ids.add(message.id);
    });
  });

export type ChatLog = z.infer<typeof ChatLogSchema>;
