import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { LlmChatMessage, LlmChatUsage } from '../../../shared/ipc-contract';
import { IpcClientError, unwrapIpc } from '../lib/ipc';
import './llm-test.css';

interface ChatEntry {
  content: string;
  role: 'user' | 'assistant';
}

function formatError(caught: unknown): string {
  if (caught instanceof IpcClientError) {
    return `${caught.payload.code}: ${caught.message}`;
  }

  return caught instanceof Error ? caught.message : String(caught);
}

export function LlmTestScreen() {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ model: string; usage?: LlmChatUsage } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [error, messages, pending]);

  async function send(): Promise<void> {
    const content = input.trim();

    if (!content || pending) {
      return;
    }

    const nextMessages: ChatEntry[] = [...messages, { content, role: 'user' }];
    setMessages(nextMessages);
    setInput('');
    setError(null);
    setPending(true);

    try {
      if (!window.miaoma?.llm) {
        throw new Error('Preload 桥接未加载：window.miaoma.llm 不存在');
      }

      const payload: LlmChatMessage[] = nextMessages.map((message) => ({
        content: message.content,
        role: message.role,
      }));
      const result = unwrapIpc(await window.miaoma.llm.chat(payload));

      setMessages([...nextMessages, { content: result.reply, role: 'assistant' }]);
      setMeta({ model: result.model, ...(result.usage ? { usage: result.usage } : {}) });
    } catch (caught) {
      setError(formatError(caught));
    } finally {
      setPending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  function clear(): void {
    setMessages([]);
    setInput('');
    setError(null);
    setMeta(null);
  }

  return (
    <div className="llm-test-shell">
      <header className="llm-test-header">
        <div>
          <div className="llm-test-kicker">DeepSeek · 基础对话</div>
          <h1>LLM 测试台</h1>
          <p>在下方输入消息，验证统一 Provider 的基础对话调用与错误处理。</p>
        </div>
        <div className="llm-test-actions">
          <button className="button button-ghost" type="button" onClick={clear} disabled={pending}>
            清空
          </button>
          <a className="button button-ghost" href="#/create">
            返回创作页
          </a>
        </div>
      </header>

      <main className="llm-test-panel">
        <div className="llm-test-messages">
          {messages.length === 0 && !pending && !error ? (
            <div className="llm-test-empty">输入一条消息开始测试。</div>
          ) : null}

          {messages.map((message, index) => (
            <article
              className={`llm-test-message llm-test-message-${message.role}`}
              key={`${message.role}-${index}`}
            >
              <div className="llm-test-role">{message.role === 'user' ? '你' : '助手'}</div>
              <div className="llm-test-content">{message.content}</div>
            </article>
          ))}

          {pending ? <div className="llm-test-pending">模型思考中…</div> : null}

          {error ? (
            <div className="llm-test-error" role="alert">
              {error}
            </div>
          ) : null}

          <div ref={endRef} />
        </div>

        <div className="llm-test-composer">
          <textarea
            disabled={pending}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            rows={3}
            value={input}
          />
          <div className="llm-test-composer-row">
            <span className="llm-test-hint">
              密钥读取自仓库根 .env 的 DEEPSEEK_API_KEY，修改后需重启应用。
            </span>
            <button
              className="button"
              disabled={pending || input.trim().length === 0}
              onClick={() => void send()}
              type="button"
            >
              {pending ? '请求中…' : '发送'}
            </button>
          </div>
        </div>

        {meta ? (
          <div className="llm-test-meta">
            <span>model: {meta.model}</span>
            {meta.usage?.totalTokens !== undefined ? (
              <span>tokens: {meta.usage.totalTokens}</span>
            ) : null}
            {meta.usage?.inputTokens !== undefined ? (
              <span>in: {meta.usage.inputTokens}</span>
            ) : null}
            {meta.usage?.outputTokens !== undefined ? (
              <span>out: {meta.usage.outputTokens}</span>
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}
