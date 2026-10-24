import { describe, expect, it } from 'vitest';
import { classifyGateInput, normalizeGateText } from './gate-input';

function expectErrorCode(callback: () => unknown, code: string): void {
  try {
    callback();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error(`expected error code ${code}`);
}

describe('gate input classification', () => {
  it.each(['确认', '确认。', ' 确认并继续 ', '可以！', '同意', '通过', '没问题', '就这样', '继续'])(
    'treats %s as approval',
    (text) => {
      expect(classifyGateInput(text)).toMatchObject({ decision: 'approve' });
    },
  );

  it('treats any other text as request_changes with feedback', () => {
    expect(classifyGateInput('把时长缩短到 45 秒')).toEqual({
      decision: 'request_changes',
      feedback: '把时长缩短到 45 秒',
      rawText: '把时长缩短到 45 秒',
    });
    expect(classifyGateInput('确认一下')).toMatchObject({
      decision: 'request_changes',
    });
  });

  it('rejects empty input', () => {
    expectErrorCode(() => classifyGateInput('   '), 'CHAT_INVALID_ARGUMENT');
  });

  it('normalizes punctuation and whitespace', () => {
    expect(normalizeGateText('  「确认」！ ')).toBe('确认');
  });
});
