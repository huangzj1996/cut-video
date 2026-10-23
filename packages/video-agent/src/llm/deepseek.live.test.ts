import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chat } from './chat';
import { createDeepSeekProviderFromEnv } from './deepseek';

const LIVE = process.env.MIAOMA_LLM_LIVE === '1';

if (LIVE && !process.env.DEEPSEEK_API_KEY) {
  const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));

  if (existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // 没有可读的 .env 时保持 skip。
    }
  }
}

const ENABLED = LIVE && Boolean(process.env.DEEPSEEK_API_KEY?.trim());

describe.skipIf(!ENABLED)('DeepSeek live', () => {
  it('completes a basic chat call', async () => {
    const provider = createDeepSeekProviderFromEnv();
    const result = await chat(provider, '请只回复两个字：你好', { timeoutMs: 60_000 });

    expect(result.text.trim().length).toBeGreaterThan(0);
    expect(result.model.length).toBeGreaterThan(0);
  }, 120_000);

  it('streams a basic response', async () => {
    const provider = createDeepSeekProviderFromEnv();
    let text = '';
    let done = false;

    for await (const event of provider.stream([{ content: '请只回复两个字：你好', role: 'user' }], {
      timeoutMs: 60_000,
    })) {
      if (event.type === 'content') {
        text += event.delta;
      }

      if (event.type === 'done') {
        done = true;
      }
    }

    expect(done).toBe(true);
    expect(text.trim().length).toBeGreaterThan(0);
  }, 120_000);
});
