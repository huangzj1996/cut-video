import { z } from 'zod';
import { WorkflowRunStatusSchema } from '../workflow/state';

export const CHAT_MESSAGE_TYPES = [
  'user_requirement',
  'user_confirmation',
  'script_analysis',
  'script_rewrite',
  'scheme_recommendation',
  'production_spec',
  'approval_request',
  'execution_update',
  'video_overview',
  'error',
  'system_notice',
] as const;

export const ChatMessageTypeSchema = z.enum(CHAT_MESSAGE_TYPES);
export type ChatMessageType = z.infer<typeof ChatMessageTypeSchema>;

export const CHAT_ROLES = ['user', 'assistant', 'system'] as const;
export const ChatRoleSchema = z.enum(CHAT_ROLES);
export type ChatRole = z.infer<typeof ChatRoleSchema>;

export const CHAT_MESSAGE_STATUSES = ['pending', 'completed', 'failed'] as const;
export const ChatMessageStatusSchema = z.enum(CHAT_MESSAGE_STATUSES);
export type ChatMessageStatus = z.infer<typeof ChatMessageStatusSchema>;

export const ExecutionStatusSchema = WorkflowRunStatusSchema;
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

export const EXPORT_STATUSES = ['not_exported', 'exported', 'failed'] as const;
export const ExportStatusSchema = z.enum(EXPORT_STATUSES);
export type ExportStatus = z.infer<typeof ExportStatusSchema>;

export const CHAT_TAG_GROUPS = ['visual', 'voice', 'other'] as const;
export const ChatTagGroupSchema = z.enum(CHAT_TAG_GROUPS);
export type ChatTagGroup = z.infer<typeof ChatTagGroupSchema>;
