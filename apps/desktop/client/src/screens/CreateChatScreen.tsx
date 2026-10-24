import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ChatMessage, ChatStreamEvent } from '@miaoma/video-project';
import type { WorkflowPublicState } from '../../../shared/ipc-contract';
import { unwrapIpc } from '../lib/ipc';
import { ChatMessageItem } from './create-chat/ChatMessageItem';
import {
  ChatEmpty,
  ChatErrorBanner,
  ChatLoading,
  ChatMissingContext,
} from './create-chat/ChatStates';
import { PlanList } from './create-chat/PlanList';
import { ScriptAnalysisCard } from './create-chat/ScriptAnalysisCard';
import {
  canSend,
  deriveGates,
  derivePlan,
  formatMessageTime,
  isChatMessageVisible,
  workflowStatusLabel,
} from './create-chat/view-model';
import { EditorIcon } from './editor-icons';
import './create-chat.css';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请稍后重试。';
}

export function CreateChatScreen({ projectId }: { projectId?: string } = {}) {
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [projectName, setProjectName] = useState('');
  const [workflow, setWorkflow] = useState<WorkflowPublicState | null>(null);
  const [stream, setStream] = useState<ChatStreamEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const mountedRef = useRef(true);
  const refreshTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId || !window.miaoma?.chat) {
      return;
    }

    try {
      const result = unwrapIpc(await window.miaoma.chat.list(projectId));

      if (!mountedRef.current) {
        return;
      }

      setMessages(result.messages);
      setProjectName(result.projectName);
      setWorkflow(result.workflow);
      setError(null);
    } catch (cause) {
      if (mountedRef.current) {
        setError(errorMessage(cause));
      }
    }
  }, [projectId]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) {
      window.clearTimeout(refreshTimer.current);
    }

    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void refresh();
    }, 140);
  }, [refresh]);

  const showToast = useCallback((message: string) => {
    setToast(message);

    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
    }

    toastTimer.current = window.setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 2_800);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (!projectId) {
      setLoading(false);
      return;
    }

    if (!window.miaoma?.chat || !window.miaoma?.workflow) {
      setError('Preload 桥接未加载，无法加载创作消息。');
      setLoading(false);
      return;
    }

    const offMessage = window.miaoma.chat.onMessage((message) => {
      if (message.projectId !== projectId || !mountedRef.current) {
        return;
      }

      setMessages((previous) =>
        previous.some((entry) => entry.id === message.id) ? previous : [...previous, message],
      );

      // A1 审批卡落库后，用最终产物替代流式草稿。
      if (message.type === 'approval_request' && message.payload.gate === 'A1') {
        setStream((current) => (current && current.runId === message.runId ? null : current));
      }
    });
    const offStream = window.miaoma.chat.onStream((event) => {
      if (event.projectId !== projectId || !mountedRef.current) {
        return;
      }

      setStream(event);
    });
    const offEvent = window.miaoma.workflow.onEvent((event) => {
      if (event.projectId !== projectId) {
        return;
      }

      if (event.type === 'run.failed' || event.type === 'run.cancelled') {
        setStream((current) => (current && current.runId === event.runId ? null : current));
      }

      scheduleRefresh();
    });

    void (async () => {
      try {
        const result = unwrapIpc(await window.miaoma.chat.list(projectId));

        if (!mountedRef.current) {
          return;
        }

        setMessages(result.messages);
        setProjectName(result.projectName);
        setWorkflow(result.workflow);
        setLoading(false);

        const hasAssistantReply = result.messages.some((message) => message.role === 'assistant');

        if (result.creation && !result.workflow && !hasAssistantReply) {
          setStarting(true);
          setStream(null);

          try {
            const started = unwrapIpc(await window.miaoma.chat.start(projectId));

            if (mountedRef.current) {
              setMessages(started.messages);
              setWorkflow(started.workflow);
            }
          } catch (cause) {
            if (mountedRef.current) {
              setError(errorMessage(cause));
            }
          } finally {
            if (mountedRef.current) {
              setStarting(false);
            }
          }
        }
      } catch (cause) {
        if (mountedRef.current) {
          setError(errorMessage(cause));
          setLoading(false);
        }
      }
    })();

    return () => {
      mountedRef.current = false;
      offMessage();
      offStream();
      offEvent();

      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }

      if (toastTimer.current !== null) {
        window.clearTimeout(toastTimer.current);
        toastTimer.current = null;
      }
    };
  }, [projectId, scheduleRefresh]);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;

    if (!node) {
      return;
    }

    stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    const content = node?.firstElementChild;

    if (!node || !content) {
      return;
    }

    // 卡片数据、流式内容和图片会异步撑高聊天区；只要用户仍在底部，
    // 就继续吸底，避免打开已完成工程时停在半路。
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) {
        node.scrollTop = node.scrollHeight;
      }
    });

    observer.observe(content);

    return () => observer.disconnect();
  }, []);

  const handleSend = useCallback(async () => {
    const text = draft.trim();

    if (!projectId || !text || sending || !canSend(workflow) || !window.miaoma?.chat) {
      return;
    }

    setSending(true);
    setError(null);

    try {
      const result = unwrapIpc(await window.miaoma.chat.send({ projectId, text }));

      if (mountedRef.current) {
        setMessages(result.messages);
        setWorkflow(result.workflow);
        setDraft('');
      }
    } catch (cause) {
      if (mountedRef.current) {
        setError(errorMessage(cause));
      }
    } finally {
      if (mountedRef.current) {
        setSending(false);
      }
    }
  }, [draft, projectId, sending, workflow]);

  const handleAttach = useCallback(async () => {
    if (!projectId || !window.miaoma?.project) {
      return;
    }

    try {
      const result = unwrapIpc(await window.miaoma.project.selectAssets(projectId));

      if (result.selected) {
        showToast(
          workflow?.status === 'succeeded'
            ? '素材目录已更新；发送修改意见后将使用新素材重新生成。'
            : '素材目录已更新，将在下一轮生成时生效。',
        );
      }
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [projectId, showToast, workflow?.status]);

  const handleRetry = useCallback(async () => {
    if (!projectId || !window.miaoma?.chat) {
      return;
    }

    setError(null);
    setStream(null);

    try {
      const result = unwrapIpc(await window.miaoma.chat.retry(projectId));

      if (mountedRef.current) {
        setMessages(result.messages);
        setWorkflow(result.workflow);
      }
    } catch (cause) {
      if (mountedRef.current) {
        setError(errorMessage(cause));
      }
    }
  }, [projectId]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleBack = () => {
    window.location.hash = projectId ? '#/workspace' : '#/create';
  };

  if (!projectId) {
    return (
      <div className="create-chat-screen">
        <ChatMissingContext onBack={handleBack} />
      </div>
    );
  }

  const plan = derivePlan(messages, workflow);
  const gates = deriveGates(messages);
  const waiting = workflow?.status === 'waiting_user';
  const running = workflow?.status === 'running' || starting;
  const canCompose = waiting || workflow?.status === 'succeeded';
  const editable = canCompose && !sending;
  const visibleMessages = messages.filter(isChatMessageVisible);
  // 同一 run 里可能有上一版 A1（用户要求修改后重生成）；只有晚于本次流式
  // 开始的 A1 才代表当前这版简报已经落库。
  const hasA1ForStream = stream
    ? messages.some(
        (message) =>
          message.type === 'approval_request' &&
          message.payload.gate === 'A1' &&
          message.runId === stream.runId &&
          message.createdAt >= stream.timestamp,
      )
    : false;
  const showStream =
    stream !== null &&
    !hasA1ForStream &&
    workflow?.runId === stream.runId &&
    (workflow.status === 'running' || workflow.status === 'waiting_user');

  const placeholder = waiting
    ? '回复「确认」继续，或直接说明要修改的内容'
    : running
      ? '智能体正在执行…'
      : workflow?.status === 'succeeded'
        ? '继续补充创作要求，或要求智能体修改分镜'
        : workflow?.status === 'failed'
          ? '运行失败，请点击重试'
          : '等待智能体启动…';

  const hint = waiting
    ? '回复「确认」继续；任何其他文字都会作为修改意见'
    : running
      ? '执行过程会持续更新，可以先离开页面'
      : workflow?.status === 'succeeded'
        ? '例如：缩短到 90 秒、加重技术感、换成沉稳男声'
        : workflow?.status === 'failed'
          ? '点击错误卡上的重试，或返回工作台'
          : '正在读取创作上下文';

  return (
    <div className="create-chat-screen">
      <button aria-label="返回工作台" className="cc-back" type="button" onClick={handleBack}>
        <EditorIcon name="arrow-left" size={18} />
      </button>

      {toast ? (
        <div className="cc-toast" role="status">
          {toast}
        </div>
      ) : null}

      <aside aria-label="创作执行要点" className="cc-aside">
        <PlanList steps={plan} />
      </aside>

      <main className="cc-scroll" ref={scrollRef} onScroll={handleScroll}>
        <div className="cc-stage">
          <div className="cc-column">
            <div className="cc-project-bar">
              <span className="cc-project-name">{projectName || '未命名创作'}</span>
              <span className={`cc-run-status cc-run-status--${workflow?.status ?? 'pending'}`}>
                {workflowStatusLabel(workflow?.status)}
              </span>
            </div>

            <p className="cc-time">{messages[0] ? formatMessageTime(messages[0].createdAt) : ''}</p>

            <div className="cc-plan-inline">
              <PlanList steps={plan} variant="inline" />
            </div>

            {error ? (
              <ChatErrorBanner
                message={error}
                onRetry={workflow?.status === 'failed' ? () => void handleRetry() : undefined}
              />
            ) : null}

            {loading ? <ChatLoading /> : null}

            {!loading && messages.length === 0 && !starting ? <ChatEmpty /> : null}

            <div className="cc-flow">
              {visibleMessages.map((message) => (
                <ChatMessageItem
                  gate={gates.get(message.id)}
                  key={message.id}
                  message={message}
                  onOpenEditor={() => {
                    window.location.hash = '#/editor';
                  }}
                  onRetry={() => void handleRetry()}
                  projectId={projectId}
                />
              ))}

              {showStream && stream ? (
                <article className="cc-analysis-live">
                  <div className="cc-analysis-live-head">
                    <span
                      aria-hidden="true"
                      className={`cc-live-dot${stream.done ? ' cc-live-dot--done' : ''}`}
                    />
                    <span>{stream.done ? '文稿分析完成，正在准备确认…' : '正在分析文稿…'}</span>
                  </div>
                  <ScriptAnalysisCard analysis={stream.draft} />
                </article>
              ) : null}

              {starting ? <p className="cc-prose">正在启动创作流程…</p> : null}
            </div>
          </div>
        </div>
      </main>

      <div className="cc-dock">
        <div className="cc-column">
          <div className={`cc-composer${editable ? '' : ' cc-composer--disabled'}`}>
            <button
              aria-label="添加视频素材"
              className="cc-attach"
              disabled={running}
              title={running ? '工作流执行中，暂不能更换素材' : '选择视频素材目录'}
              type="button"
              onClick={() => void handleAttach()}
            >
              <EditorIcon name="plus" size={20} />
            </button>

            <div className="cc-composer-main">
              <textarea
                aria-label="审批回复或修改意见"
                className="cc-composer-input"
                disabled={!editable}
                placeholder={placeholder}
                rows={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
              />
              <span className="cc-composer-hint">{hint}</span>
            </div>

            <button
              aria-label="发送消息"
              className="cc-send"
              disabled={!editable || draft.trim().length === 0}
              type="button"
              onClick={() => void handleSend()}
            >
              <EditorIcon name="send" size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
