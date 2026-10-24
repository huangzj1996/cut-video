import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CreativeBriefContentSchema, ScenePlanContentSchema } from '@miaoma/video-project';
import { renderPrompt } from './prompts';

function readPrompt(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../../.agents/prompts/${name}`, import.meta.url)),
    'utf8',
  );
}

function extractJsonExample(markdown: string): unknown {
  const match = markdown.match(/### 示例输出\s+```json\s*([\s\S]*?)```/);

  if (!match?.[1]) {
    throw new Error('missing JSON example');
  }

  return JSON.parse(match[1]);
}

describe('renderPrompt', () => {
  it('replaces variables and fills missing values with 无', () => {
    expect(renderPrompt('文稿：{{script}}；要求：{{requirements}}', { script: '内容' })).toBe(
      '文稿：内容；要求：无',
    );
    expect(renderPrompt('{{script}}', { script: '   ' })).toBe('无');
  });

  it('rejects malformed placeholders', () => {
    expect(() => renderPrompt('{{script}} {{bad-value}}', { script: 'x' })).toThrow(
      /unresolved prompt placeholders/,
    );
  });
});

describe('prompt templates', () => {
  it('ships a valid creative-brief example', () => {
    const system = readPrompt('creative-brief.system.md');
    const user = readPrompt('creative-brief.user.md');

    expect(system).toContain('只输出一个 JSON 对象');
    expect(user).toContain('{{script}}');
    expect(user).toContain('{{assetSummary}}');
    expect(CreativeBriefContentSchema.safeParse(extractJsonExample(system)).success).toBe(true);
  });

  it('ships an ordered script-analysis streaming template', () => {
    const system = readPrompt('script-analysis.system.md');
    const user = readPrompt('script-analysis.user.md');
    const markers = [
      '<<<INTRO>>>',
      '<<<STRUCTURE>>>',
      '<<<SCRIPT_TYPE>>>',
      '<<<VOICEOVER>>>',
      '<<<SCHEME>>>',
    ];
    const positions = markers.map((marker) => system.indexOf(marker));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((left, right) => left - right)).toEqual(positions);
    expect(user).toContain('{{script}}');
    expect(user).toContain('{{assetSummary}}');
    expect(user).toContain('{{feedback}}');
  });

  it('ships a valid plan-scenes example', () => {
    const system = readPrompt('plan-scenes.system.md');
    const user = readPrompt('plan-scenes.user.md');

    expect(system).toContain('只输出一个 JSON 对象');
    expect(user).toContain('{{brief}}');
    expect(user).toContain('{{feedback}}');
    expect(ScenePlanContentSchema.safeParse(extractJsonExample(system)).success).toBe(true);
  });
});
