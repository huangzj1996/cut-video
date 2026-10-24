import { randomUUID } from 'node:crypto';
import {
  ChatMessageSchema,
  getVoicePreset,
  type ChatMessage,
  type ChatMessageOfType,
  type RunEvent,
} from '@miaoma/video-project';
import type {
  ChatActionResult,
  ChatListResult,
  PublicCreationInput,
  WorkflowPublicState,
} from '../../shared/ipc-contract';
import { IpcError } from '../ipc-error';
import type { ProjectStore } from '../projects/project-store';
import type { WorkflowRunManager } from '../workflow/run-manager';
import type { ChatStore } from './chat-store';
import { classifyGateInput } from './gate-input';
import { ChatMessageMapper } from './message-mapper';

export interface ChatServiceOptions {
  getProjectStore: () => ProjectStore;
  runManager: WorkflowRunManager;
  chatStore: ChatStore;
  onMessage?: (message: ChatMessage) => void;
}

type ApprovalRequestMessage = ChatMessageOfType<'approval_request'>;

/**
 * 创作消息页的主进程服务：消息列表、启动、gate 文本分类、重试。
 * 事件 → 消息的映射由 ChatMessageMapper 负责，并保证按 seq 串行落库。
 */
export class ChatService {
  private readonly eventQueues = new Map<string, Promise<void>>();

  constructor(private readonly options: ChatServiceOptions) {}

  async list(projectId: string): Promise<ChatListResult> {
    const store = this.options.getProjectStore();
    const project = store.get(projectId);
    let creation: PublicCreationInput | null;

    try {
      creation = toPublicCreation(store.readCreationInput(projectId));
    } catch {
      creation = null;
    }

    await this.reconcile(projectId);

    return {
      creation,
      messages: this.options.chatStore.read(projectId),
      projectName: project.project.name,
      workflow: this.options.runManager.getState(projectId) ?? null,
    };
  }

  async start(projectId: string): Promise<ChatActionResult> {
    const store = this.options.getProjectStore();
    let creation: ReturnType<ProjectStore['readCreationInput']>;

    try {
      creation = store.readCreationInput(projectId);
    } catch {
      throw new IpcError('CHAT_CONTEXT_MISSING', '工程缺少创作输入。');
    }

    const messages = this.options.chatStore.read(projectId);
    const hasInitialRequest = messages.some(
      (message) =>
        message.type === 'user_requirement' && message.payload.kind === 'initial_request',
    );

    if (!hasInitialRequest) {
      await this.options.chatStore.append(projectId, [this.initialMessage(projectId, creation)]);
    }

    const workflow = await this.options.runManager.start(projectId);

    return {
      messages: this.options.chatStore.read(projectId),
      workflow,
    };
  }

  async send(projectId: string, text: string): Promise<ChatActionResult> {
    const workflow = this.options.runManager.getState(projectId);

    if (!workflow) {
      throw new IpcError('CHAT_CONTEXT_MISSING', '工作流尚未启动。');
    }

    if (workflow.status === 'running') {
      throw new IpcError('WORKFLOW_BUSY', '工作流正在执行中。', true);
    }

    if (workflow.status === 'succeeded') {
      const feedback = text.trim();

      if (!feedback) {
        throw new IpcError('CHAT_INVALID_ARGUMENT', '请输入修改意见。');
      }

      if (feedback.length > 2_000) {
        throw new IpcError('CHAT_INVALID_ARGUMENT', '修改意见不能超过 2000 字。');
      }

      await this.options.chatStore.append(projectId, [
        ChatMessageSchema.parse({
          id: `msg-follow-up-${randomUUID()}`,
          projectId,
          runId: workflow.runId,
          role: 'user',
          type: 'user_requirement',
          payload: { kind: 'follow_up', text: feedback },
          revision: 0,
          status: 'completed',
          createdAt: new Date().toISOString(),
        }),
      ]);

      const next = await this.options.runManager.startFollowUp(projectId, feedback);

      return {
        messages: this.options.chatStore.read(projectId),
        workflow: next,
      };
    }

    if (workflow.status !== 'waiting_user') {
      throw new IpcError('CHAT_INVALID_ARGUMENT', '当前没有待审批事项。');
    }

    const decision = classifyGateInput(text);
    const messages = this.options.chatStore.read(projectId);
    const approval = this.findPendingApproval(messages);

    if (!approval) {
      throw new IpcError('CHAT_APPROVAL_NOT_FOUND', '未找到待审批事项。');
    }

    const confirmation = ChatMessageSchema.parse({
      id: `msg-confirm-${approval.id}`,
      projectId,
      runId: workflow.runId,
      role: 'user',
      type: 'user_confirmation',
      payload: {
        gate: approval.payload.gate,
        decision: decision.decision,
        rawText: decision.rawText ?? text,
        ...(decision.decision === 'request_changes' ? { feedback: decision.feedback } : {}),
        artifact: approval.payload.artifact,
        approvalMessageId: approval.id,
      },
      revision: approval.revision,
      status: 'completed',
      createdAt: new Date().toISOString(),
    });

    await this.options.chatStore.append(projectId, [confirmation]);
    await this.options.runManager.resume(projectId, workflow.runId, decision);

    return {
      messages: this.options.chatStore.read(projectId),
      workflow: this.options.runManager.getState(projectId) ?? null,
    };
  }

  async retry(projectId: string): Promise<ChatActionResult> {
    const workflow = this.options.runManager.getState(projectId);

    if (!workflow) {
      throw new IpcError('CHAT_CONTEXT_MISSING', '工作流尚未启动。');
    }

    if (workflow.status === 'running') {
      throw new IpcError('WORKFLOW_BUSY', '工作流正在执行中。', true);
    }

    if (workflow.status === 'waiting_user') {
      throw new IpcError('WORKFLOW_APPROVAL_REQUIRED', '当前审批尚未回复。');
    }

    if (workflow.status !== 'failed' && workflow.status !== 'interrupted') {
      throw new IpcError('CHAT_INVALID_ARGUMENT', '当前运行不需要重试。');
    }

    await this.options.runManager.resume(projectId, workflow.runId);

    return {
      messages: this.options.chatStore.read(projectId),
      workflow: this.options.runManager.getState(projectId) ?? null,
    };
  }

  handleEvent(event: RunEvent): void {
    const previous = this.eventQueues.get(event.projectId) ?? Promise.resolve();
    const next = previous.then(() => this.processEvent(event)).catch(() => undefined);

    this.eventQueues.set(event.projectId, next);
  }

  async reconcile(projectId: string): Promise<void> {
    const record = this.options.runManager.getRecord(projectId);

    if (!record) {
      return;
    }

    try {
      const events = this.options.runManager.readEvents(projectId, record.runId);
      const mapper = this.createMapper(projectId);
      const messages: ChatMessage[] = [];

      for (const event of events) {
        messages.push(...(await mapper.mapEvent(event)));
      }

      await this.options.chatStore.append(projectId, messages);
    } catch {
      // 对账失败不阻断消息列表展示；原始错误已记录在 run 目录。
    }
  }

  getWorkflow(projectId: string): WorkflowPublicState | null {
    return this.options.runManager.getState(projectId) ?? null;
  }

  private async processEvent(event: RunEvent): Promise<void> {
    try {
      const mapper = this.createMapper(event.projectId);
      const messages = await mapper.mapEvent(event);
      const appended = await this.options.chatStore.append(event.projectId, messages);

      for (const message of appended) {
        this.options.onMessage?.(message);
      }
    } catch {
      // 单条事件映射失败不阻断后续事件；避免工作流事件把主进程打挂。
    }
  }

  private createMapper(projectId: string): ChatMessageMapper {
    return new ChatMessageMapper({
      projectId,
      projectStore: this.options.getProjectStore(),
    });
  }

  private findPendingApproval(
    messages: readonly ChatMessage[],
  ): ApprovalRequestMessage | undefined {
    const resolved = new Set(
      messages
        .filter((message) => message.type === 'user_confirmation')
        .map((message) => message.payload.approvalMessageId),
    );

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]!;

      if (message.type === 'approval_request' && !resolved.has(message.id)) {
        return message;
      }
    }

    return undefined;
  }

  private initialMessage(
    projectId: string,
    creation: ReturnType<ProjectStore['readCreationInput']>,
  ): ChatMessage {
    const voice = getVoicePreset(creation.voicePresetId);

    return ChatMessageSchema.parse({
      id: `msg-initial-${projectId}`,
      projectId,
      role: 'user',
      type: 'user_requirement',
      payload: {
        kind: 'initial_request',
        script: creation.script,
        ...(creation.requirementsText !== undefined
          ? { requirementsText: creation.requirementsText }
          : {}),
        voicePresetId: creation.voicePresetId,
        tags: [
          { group: 'visual', values: ['视频画面', '智能匹配素材'] },
          { group: 'voice', values: ['旁白配音', voice.name] },
        ],
      },
      revision: 0,
      status: 'completed',
      createdAt: creation.createdAt,
    });
  }
}

function toPublicCreation(
  creation: ReturnType<ProjectStore['readCreationInput']>,
): PublicCreationInput {
  return {
    createdAt: creation.createdAt,
    script: creation.script,
    voicePresetId: creation.voicePresetId,
    ...(creation.requirementsText !== undefined
      ? { requirementsText: creation.requirementsText }
      : {}),
  };
}
