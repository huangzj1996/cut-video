import {
  ChatMessageSchema,
  CreativeBriefSchema,
  ProductionSpecSchema,
  VideoProjectSchema,
  type ArtifactReference,
  type ChatMessage,
  type RunEvent,
} from '@miaoma/video-project';
import { FileArtifactStore } from '@miaoma/video-agent/workflow';
import type { ZodType } from 'zod';
import type { ProjectStore } from '../projects/project-store';

interface MapperOptions {
  projectId: string;
  projectStore: ProjectStore;
}

/**
 * RunEvent → 持久化 ChatMessage。
 *
 * 消息 id 使用 `runId + seq + type + suffix`：事件先落 events.jsonl，
 * 重放同一事件得到同一个 id，ChatStore 按 id 去重。
 */
export class ChatMessageMapper {
  private readonly artifacts: FileArtifactStore;

  constructor(private readonly options: MapperOptions) {
    this.artifacts = new FileArtifactStore(
      options.projectStore.getProjectDirectory(options.projectId),
    );
  }

  async mapEvent(event: RunEvent): Promise<ChatMessage[]> {
    switch (event.type) {
      case 'node.started':
        return this.executionUpdate(event, 'running', `开始执行 ${event.nodeId ?? ''}`.trim());
      case 'node.completed': {
        const messages = this.executionUpdate(
          event,
          'succeeded',
          `完成 ${event.nodeId ?? ''}`.trim(),
        );

        if (event.nodeId === 'synthesize_voice') {
          messages.push(
            this.message(
              event,
              'system_notice',
              {
                level: 'info',
                message: '当前为模拟配音，时长按文本估算；后续可替换为真实 TTS。',
              },
              'mock-tts',
            ),
          );
        }

        return messages;
      }
      case 'node.failed':
        return this.executionUpdate(event, 'failed', event.error?.message ?? '节点执行失败。');
      case 'node.waiting_user': {
        const messages = this.executionUpdate(event, 'waiting_user', '等待用户确认');

        if (event.approval) {
          messages.push(
            this.message(event, 'approval_request', event.approval, `gate-${event.approval.gate}`),
          );
        }

        return messages;
      }
      case 'artifact.written':
        return this.mapArtifact(event);
      case 'run.completed':
        return this.mapCompleted(event);
      case 'run.failed':
        return [
          this.message(
            event,
            'error',
            {
              code: event.error?.code ?? 'WORKFLOW_STEP_FAILED',
              message: event.error?.message ?? '工作流执行失败。',
              retryable: event.error?.retryable ?? true,
            },
            'run-failed',
          ),
        ];
      case 'run.cancelled':
        return [
          this.message(
            event,
            'system_notice',
            { level: 'warning', message: '工作流已取消。' },
            'cancelled',
          ),
        ];
      case 'run.interrupted':
        return [
          this.message(
            event,
            'system_notice',
            { level: 'warning', message: '上次运行被中断，可点击继续或重试。' },
            'interrupted',
          ),
        ];
      case 'run.started':
      case 'run.resumed':
      case 'node.progress':
      default:
        return [];
    }
  }

  private executionUpdate(
    event: RunEvent,
    status: 'running' | 'waiting_user' | 'succeeded' | 'failed',
    detail: string,
  ): ChatMessage[] {
    if (!event.phase) {
      return [];
    }

    return [
      this.message(
        event,
        'execution_update',
        {
          phase: event.phase,
          ...(event.nodeId !== undefined ? { nodeId: event.nodeId } : {}),
          status,
          detail: detail.slice(0, 300),
          ...(event.attempt !== undefined ? { attempt: event.attempt } : {}),
          ...(event.progress !== undefined ? { progress: event.progress } : {}),
        },
        `exec-${status}`,
      ),
    ];
  }

  private async mapArtifact(event: RunEvent): Promise<ChatMessage[]> {
    if (!event.artifact) {
      return [];
    }

    if (event.artifact.kind === 'creative_brief') {
      const brief = await this.tryRead(event.artifact, CreativeBriefSchema);

      if (!brief) {
        return [];
      }

      const {
        briefVersion,
        schemaVersion: _schemaVersion,
        generatedAt: _generatedAt,
        inputFingerprint: _inputFingerprint,
        ...content
      } = brief;

      return [
        this.message(
          event,
          'script_analysis',
          {
            brief: content,
            briefVersion,
            contentFingerprint: event.artifact.contentFingerprint,
            artifact: event.artifact,
          },
          'brief',
        ),
      ];
    }

    if (event.artifact.kind === 'production_spec') {
      const spec = await this.tryRead(event.artifact, ProductionSpecSchema);

      if (!spec) {
        return [];
      }

      return [this.message(event, 'production_spec', { spec, artifact: event.artifact }, 'spec')];
    }

    return [];
  }

  private async mapCompleted(event: RunEvent): Promise<ChatMessage[]> {
    const [projectRef, specRef, validationRef] = await Promise.all([
      this.artifacts.findLatest('video_project'),
      this.artifacts.findLatest('production_spec'),
      this.artifacts.findLatest('validation_report'),
    ]);

    if (!projectRef || !specRef) {
      return [];
    }

    const project = await this.tryRead(projectRef, VideoProjectSchema);

    if (!project) {
      return [];
    }

    const durationSeconds = Math.max(
      1,
      Math.round(project.scenes.reduce((total, scene) => total + scene.durationMs, 0) / 1_000),
    );

    return [
      this.message(
        event,
        'video_overview',
        {
          title: project.project.name,
          description: '创作流程已完成，工程已保存。',
          durationSeconds,
          exportStatus: 'not_exported',
          projectRevision: project.project.contentRevision,
          spec: specRef,
          project: projectRef,
          ...(validationRef ? { validation: validationRef } : {}),
        },
        'overview',
      ),
    ];
  }

  private async tryRead<T>(reference: ArtifactReference, schema: ZodType<T>): Promise<T | null> {
    try {
      return await this.artifacts.read(reference, schema);
    } catch {
      return null;
    }
  }

  private message(
    event: RunEvent,
    type: ChatMessage['type'],
    payload: unknown,
    suffix: string,
  ): ChatMessage {
    const role = type === 'system_notice' ? 'system' : 'assistant';

    return ChatMessageSchema.parse({
      id: `msg-${event.runId}-${event.seq}-${type}-${suffix}`,
      projectId: this.options.projectId,
      runId: event.runId,
      role,
      type,
      payload,
      ...(event.artifact ? { artifactRef: event.artifact } : {}),
      revision: event.artifact?.version ?? 0,
      status: 'completed',
      createdAt: event.timestamp,
    });
  }
}
