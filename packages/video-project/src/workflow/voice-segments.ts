import { z } from 'zod';
import { IdSchema, IsoDateSchema, TimeMsSchema } from '../schema';
import { VoicePresetIdSchema } from './voice-presets';

export const VOICE_SEGMENTS_SCHEMA_VERSION = '1.0.0' as const;

export const VoiceSubtitleCueSchema = z
  .strictObject({
    id: IdSchema,
    text: z.string().trim().min(1).max(500),
    startMs: TimeMsSchema,
    endMs: TimeMsSchema,
  })
  .refine((cue) => cue.endMs > cue.startMs, {
    message: 'subtitle cue endMs must be greater than startMs',
    path: ['endMs'],
  });

export type VoiceSubtitleCue = z.infer<typeof VoiceSubtitleCueSchema>;

export const VoiceSegmentSchema = z
  .strictObject({
    segmentId: IdSchema,
    sceneId: IdSchema,
    assetId: IdSchema,
    path: z.string().trim().min(1).max(2_000),
    durationMs: z.number().int().positive(),
    isMock: z.literal(true),
    provider: z.literal('mock-tts'),
    voicePresetId: VoicePresetIdSchema,
    speed: z.number().min(0.5).max(2),
    timingSource: z.literal('mock_estimate'),
    subtitles: z.array(VoiceSubtitleCueSchema).min(1).max(200),
  })
  .refine(
    (segment) =>
      segment.subtitles.every((cue) => cue.startMs >= 0 && cue.endMs <= segment.durationMs),
    { message: 'subtitle cues must stay within segment duration', path: ['subtitles'] },
  );

export type VoiceSegment = z.infer<typeof VoiceSegmentSchema>;

export const VoiceSegmentFailureSchema = z.strictObject({
  sceneId: IdSchema,
  code: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(500),
  retryable: z.boolean(),
});

export type VoiceSegmentFailure = z.infer<typeof VoiceSegmentFailureSchema>;

export const VoiceSegmentCollectionSchema = z
  .strictObject({
    schemaVersion: z.literal(VOICE_SEGMENTS_SCHEMA_VERSION),
    voiceVersion: z.number().int().positive(),
    projectId: IdSchema,
    generatedAt: IsoDateSchema,
    inputFingerprint: z.string().trim().min(1).max(128),
    segments: z.array(VoiceSegmentSchema).max(30),
    failures: z.array(VoiceSegmentFailureSchema).max(30),
  })
  .superRefine((collection, ctx) => {
    const segmentIds = new Set<string>();
    const sceneIds = new Set<string>();

    collection.segments.forEach((segment, position) => {
      if (segmentIds.has(segment.segmentId)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate voice segment id: ${segment.segmentId}`,
          path: ['segments', position, 'segmentId'],
        });
      }

      if (sceneIds.has(segment.sceneId)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate voice segment sceneId: ${segment.sceneId}`,
          path: ['segments', position, 'sceneId'],
        });
      }

      segmentIds.add(segment.segmentId);
      sceneIds.add(segment.sceneId);
    });
  });

export type VoiceSegmentCollection = z.infer<typeof VoiceSegmentCollectionSchema>;
