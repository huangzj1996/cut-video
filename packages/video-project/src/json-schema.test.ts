import { describe, expect, it } from 'vitest';
import {
  CreativeBriefContentSchema,
  JSON_SCHEMA_EXPORTS,
  TimelineClipSchema,
  VideoProjectSchema,
  getJsonSchema,
} from './index';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value as JsonObject;
}

describe('JSON Schema exports', () => {
  it('exports the video project as draft 2020-12', () => {
    const schema = asObject(getJsonSchema(VideoProjectSchema));

    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'ai',
        'assets',
        'canvas',
        'project',
        'render',
        'scenes',
        'schemaVersion',
        'tracks',
      ]),
    );

    const properties = asObject(schema.properties);
    expect(asObject(properties.schemaVersion).const).toBe('1.0.0');
    expect(asObject(asObject(asObject(properties.canvas).properties).width).const).toBe(1920);
  });

  it('exports the creative brief content for function calling', () => {
    const schema = asObject(getJsonSchema(CreativeBriefContentSchema));

    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'audience',
        'contentType',
        'coreMessage',
        'coverageIssues',
        'durationSeconds',
        'narrativeStructure',
        'openQuestions',
        'style',
        'summary',
        'title',
        'topic',
      ]),
    );

    const properties = asObject(schema.properties);
    expect(asObject(properties.durationSeconds).minimum).toBe(15);
    expect(asObject(properties.durationSeconds).maximum).toBe(300);
    expect(asObject(properties.title).maxLength).toBe(80);
  });

  it('exports timeline clips as a four-way oneOf', () => {
    const schema = asObject(getJsonSchema(TimelineClipSchema));
    const options = schema.oneOf as JsonObject[];

    expect(Array.isArray(options)).toBe(true);
    expect(options).toHaveLength(4);
    expect(options.map((option) => asObject(asObject(option.properties).kind).const)).toEqual(
      expect.arrayContaining(['video', 'voice', 'subtitle', 'music']),
    );
  });

  it('exports tracks as a four-way oneOf', () => {
    const schema = asObject(getJsonSchema(VideoProjectSchema));
    const tracks = asObject(asObject(schema.properties).tracks);
    const options = asObject(tracks.items).oneOf as JsonObject[];

    expect(Array.isArray(options)).toBe(true);
    expect(options).toHaveLength(4);
  });

  it('exports chat messages as an eleven-way oneOf', () => {
    const schema = asObject(getJsonSchema(JSON_SCHEMA_EXPORTS.chatMessage));
    const options = schema.oneOf as JsonObject[];

    expect(Array.isArray(options)).toBe(true);
    expect(options).toHaveLength(11);
    expect(
      options.map((option) => asObject(asObject(asObject(option.properties).type).const)),
    ).toEqual(
      expect.arrayContaining([
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
      ]),
    );
  });

  it('exports script analysis and streaming snapshot schemas', () => {
    const analysis = asObject(getJsonSchema(JSON_SCHEMA_EXPORTS.scriptAnalysis));
    const event = asObject(getJsonSchema(JSON_SCHEMA_EXPORTS.chatStreamEvent));

    expect(analysis.required).toEqual(
      expect.arrayContaining([
        'intro',
        'structureIntro',
        'scriptType',
        'voiceoverScript',
        'schemeRecommendation',
      ]),
    );
    expect(event.required).toEqual(
      expect.arrayContaining(['attempt', 'done', 'draft', 'runId', 'streamId']),
    );
  });

  it('exports scene plan content for structured output', () => {
    const schema = asObject(getJsonSchema(JSON_SCHEMA_EXPORTS.scenePlanContent));

    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(expect.arrayContaining(['scenes']));
    const scenes = asObject(asObject(schema.properties).scenes);
    expect(scenes.minItems).toBe(1);
    expect(scenes.maxItems).toBe(30);
  });

  it('locks production spec delivery constants', () => {
    const schema = asObject(getJsonSchema(JSON_SCHEMA_EXPORTS.productionSpec));
    const properties = asObject(schema.properties);

    expect(asObject(properties.aspectRatio).const).toBe('16:9');
    expect(asObject(properties.resolution).const).toBe('1920x1080');
    expect(asObject(properties.fps).const).toBe(30);
    expect(asObject(properties.recommendedScheme).const).toBe('material_edit');
  });

  it('caches and serializes without cycles', () => {
    const first = getJsonSchema(VideoProjectSchema);
    const second = getJsonSchema(VideoProjectSchema);

    expect(second).toBe(first);
    expect(() => JSON.stringify(first)).not.toThrow();
  });

  it('exports every registered schema', () => {
    for (const schema of Object.values(JSON_SCHEMA_EXPORTS)) {
      expect(() => getJsonSchema(schema)).not.toThrow();
    }
  });
});
