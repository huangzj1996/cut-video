import { describe, expect, it } from 'vitest';
import {
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
