import { z } from 'zod';
import { IdSchema, IsoDateSchema } from '../schema';
import { ArtifactReferenceSchema } from '../workflow/artifact';
import { ChatMessageStatusSchema } from './enums';
import {
  ApprovalRequestPayloadSchema,
  ErrorPayloadSchema,
  ExecutionUpdatePayloadSchema,
  ProductionSpecPayloadSchema,
  SchemeRecommendationPayloadSchema,
  ScriptAnalysisPayloadSchema,
  ScriptRewritePayloadSchema,
  SystemNoticePayloadSchema,
  UserConfirmationPayloadSchema,
  UserRequirementPayloadSchema,
  VideoOverviewPayloadSchema,
} from './payloads';

const messageBase = {
  id: IdSchema,
  projectId: IdSchema,
  runId: IdSchema.optional(),
  artifactRef: ArtifactReferenceSchema.optional(),
  relatedSceneIds: z.array(IdSchema).max(30).optional(),
  revision: z.number().int().nonnegative(),
  status: ChatMessageStatusSchema,
  createdAt: IsoDateSchema,
};

export const ChatMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...messageBase,
    role: z.literal('user'),
    type: z.literal('user_requirement'),
    payload: UserRequirementPayloadSchema,
  }),
  z.strictObject({
    ...messageBase,
    role: z.literal('user'),
    type: z.literal('user_confirmation'),
    payload: UserConfirmationPayloadSchema,
  }),
  z.strictObject({
    ...messageBase,
    role: z.literal('assistant'),
    type: z.literal('script_analysis'),
    payload: ScriptAnalysisPayloadSchema,
  }),
  z.strictObject({
    ...messageBase,
    role: z.literal('assistant'),
    type: z.literal('script_rewrite'),
    payload: ScriptRewritePayloadSchema,
  }),
  z.strictObject({
    ...messageBase,
    role: z.literal('assistant'),
    type: z.literal('scheme_recommendation'),
    payload: SchemeRecommendationPayloadSchema,
  }),
  z.strictObject({
    ...messageBase,
    role: z.literal('assistant'),
    type: z.literal('production_spec'),
    payload: ProductionSpecPayloadSchema,
  }),
  z.strictObject({
    ...messageBase,
    role: z.literal('assistant'),
    type: z.literal('approval_request'),
    payload: ApprovalRequestPayloadSchema,
  }),
  z.strictObject({
    ...messageBase,
    role: z.literal('assistant'),
    type: z.literal('execution_update'),
    payload: ExecutionUpdatePayloadSchema,
  }),
  z.strictObject({
    ...messageBase,
    role: z.literal('assistant'),
    type: z.literal('video_overview'),
    payload: VideoOverviewPayloadSchema,
  }),
  z.strictObject({
    ...messageBase,
    role: z.literal('assistant'),
    type: z.literal('error'),
    payload: ErrorPayloadSchema,
  }),
  z.strictObject({
    ...messageBase,
    role: z.literal('system'),
    type: z.literal('system_notice'),
    payload: SystemNoticePayloadSchema,
  }),
]);

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatMessageOfType<T extends ChatMessage['type']> = Extract<ChatMessage, { type: T }>;
