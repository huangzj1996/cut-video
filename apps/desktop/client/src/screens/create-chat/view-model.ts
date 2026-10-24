import type {
  ChatMessage,
  ChatMessageOfType,
  CreativeBriefContent,
  ProductionSpec,
  WorkflowNodeId,
  WorkflowPhaseId,
  WorkflowRunStatus,
} from '@miaoma/video-project';
import type { WorkflowPublicState } from '../../../../shared/ipc-contract';

export type ApprovalMessage = ChatMessageOfType<'approval_request'>;
export type ConfirmationMessage = ChatMessageOfType<'user_confirmation'>;

export type GateStatus = 'waiting' | 'approved' | 'changes_requested' | 'stale';

export interface GateView {
  approval: ApprovalMessage;
  confirmation?: ConfirmationMessage;
  status: GateStatus;
}

export type PlanTone = 'done' | 'active' | 'pending' | 'failed';

export interface PlanStep {
  detail: string;
  id: string;
  status: WorkflowRunStatus;
  title: string;
  tone: PlanTone;
}

const PLAN_PHASES: readonly {
  phase: WorkflowPhaseId;
  id: string;
  title: string;
  defaultDetail: string;
}[] = [
  { phase: 'prepare', id: '01', title: '准备阶段', defaultDetail: '素材扫描、分析与创意简报' },
  { phase: 'storyboard', id: '02', title: '创建分镜', defaultDetail: '规划分镜并等待确认' },
  { phase: 'voice', id: '03', title: '配音生成', defaultDetail: '生成模拟配音与字幕时间' },
  { phase: 'video', id: '04', title: '视频生成', defaultDetail: '匹配素材、组装时间线与保存' },
];

const NODE_LABELS: Record<WorkflowNodeId, string> = {
  scan_assets: '扫描素材',
  analyze_assets: '分析素材',
  creative_brief: '创意简报',
  plan_scenes: '规划分镜',
  scene_approval: '分镜审批',
  synthesize_voice: '生成配音',
  match_assets: '匹配素材',
  assemble_timeline: '组装时间线',
  validate_project: '校验工程',
  save_project: '保存工程',
};

function executionDetail(payload: ChatMessageOfType<'execution_update'>['payload']): string {
  const nodeLabel = payload.nodeId ? NODE_LABELS[payload.nodeId] : undefined;

  if (!nodeLabel) {
    return payload.detail;
  }

  switch (payload.status) {
    case 'running':
      return `执行中 · ${nodeLabel}`;
    case 'succeeded':
      return `已完成 · ${nodeLabel}`;
    case 'waiting_user':
      return `等待确认 · ${nodeLabel}`;
    case 'failed':
      return `执行失败 · ${nodeLabel}`;
    default:
      return payload.detail;
  }
}

const STATUS_LABELS: Record<WorkflowRunStatus, string> = {
  pending: '待开始',
  running: '执行中',
  waiting_user: '等待确认',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
};

const STATUS_TONES: Record<WorkflowRunStatus, PlanTone> = {
  pending: 'pending',
  running: 'active',
  waiting_user: 'active',
  succeeded: 'done',
  failed: 'failed',
  cancelled: 'pending',
  interrupted: 'pending',
};

/**
 * 消息流中不直接渲染的消息：
 * - execution_update 只驱动左侧执行要点；
 * - script_analysis / production_spec 的内容由 A1/A2 审批卡统一展示，
 *   避免同一份简报/成片需求出现两张卡片。
 */
const HIDDEN_MESSAGE_TYPES: ReadonlySet<ChatMessage['type']> = new Set([
  'execution_update',
  'script_analysis',
  'production_spec',
]);

export function isChatMessageVisible(message: ChatMessage): boolean {
  return !HIDDEN_MESSAGE_TYPES.has(message.type);
}

export function planStatusLabel(status: WorkflowRunStatus): string {
  return STATUS_LABELS[status];
}

export function planTone(status: WorkflowRunStatus): PlanTone {
  return STATUS_TONES[status];
}

export function derivePlan(
  messages: readonly ChatMessage[],
  workflow: WorkflowPublicState | null,
): PlanStep[] {
  const statuses: Record<WorkflowPhaseId, WorkflowRunStatus> = {
    prepare: 'pending',
    storyboard: 'pending',
    voice: 'pending',
    video: 'pending',
  };
  const details: Partial<Record<WorkflowPhaseId, string>> = {};

  if (workflow) {
    for (const phase of PLAN_PHASES) {
      statuses[phase.phase] = workflow.phaseStatus[phase.phase];
    }
  }

  for (const message of messages) {
    if (message.type !== 'execution_update') {
      continue;
    }

    // run.json/phaseStatus 是权威状态：它由同一批事件实时更新，
    // 且不会像历史消息那样把已经结束的 waiting_user 一直留在计划里。
    // 只有尚未拿到 workflow 时才用消息状态兜底。
    if (!workflow) {
      statuses[message.payload.phase] = message.payload.status;
    }

    details[message.payload.phase] = executionDetail(message.payload);
  }

  return PLAN_PHASES.map((phase) => ({
    id: phase.id,
    title: phase.title,
    detail: details[phase.phase] ?? phase.defaultDetail,
    status: statuses[phase.phase],
    tone: planTone(statuses[phase.phase]),
  }));
}

export function deriveGates(messages: readonly ChatMessage[]): Map<string, GateView> {
  const approvals = messages.filter(
    (message): message is ApprovalMessage => message.type === 'approval_request',
  );
  const confirmations = messages.filter(
    (message): message is ConfirmationMessage => message.type === 'user_confirmation',
  );
  const gates = new Map<string, GateView>();

  approvals.forEach((approval, index) => {
    const confirmation = confirmations.find(
      (entry) => entry.payload.approvalMessageId === approval.id,
    );
    const hasLaterVersion = approvals
      .slice(index + 1)
      .some(
        (entry) =>
          entry.payload.gate === approval.payload.gate &&
          entry.payload.artifact.version > approval.payload.artifact.version,
      );
    let status: GateStatus = 'waiting';

    if (hasLaterVersion) {
      status = 'stale';
    } else if (confirmation) {
      status = confirmation.payload.decision === 'approve' ? 'approved' : 'changes_requested';
    }

    gates.set(approval.id, {
      approval,
      status,
      ...(confirmation ? { confirmation } : {}),
    });
  });

  return gates;
}

export function gateLabel(gate: 'A1' | 'A2' | 'A3'): string {
  switch (gate) {
    case 'A1':
      return '创意简报与方案';
    case 'A2':
      return '成片需求';
    default:
      return '分镜';
  }
}

export function gateStatusLabel(status: GateStatus): string {
  switch (status) {
    case 'approved':
      return '已确认';
    case 'changes_requested':
      return '已提交修改';
    case 'stale':
      return '版本已更新';
    default:
      return '等待确认';
  }
}

export function formatMessageTime(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatClockSeconds(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;

  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function formatOverviewDuration(totalSeconds: number): string {
  const safe = Math.max(1, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;

  if (minutes === 0) {
    return `约 ${seconds} 秒`;
  }

  return `约 ${minutes} 分 ${String(seconds).padStart(2, '0')} 秒`;
}

export interface BriefSummaryItem {
  label: string;
  range: string;
  summary: string;
}

export interface TimelineBeatInput {
  estimatedSeconds?: number;
  label: string;
}

export interface TimelineBeatView {
  label: string;
  range?: string;
}

/**
 * 把简报段落换算成原型图中的时间线：`开场（00:00–00:05）`。
 * 流式阶段某段时长尚未到达时，从该段起不再展示区间，避免出现错误时间。
 */
export function toTimelineBeats(beats: readonly TimelineBeatInput[]): TimelineBeatView[] {
  let cursor = 0;
  let rangesAvailable = true;

  return beats.map((beat) => {
    if (beat.estimatedSeconds === undefined) {
      rangesAvailable = false;
      return { label: beat.label };
    }

    const start = cursor;
    const end = cursor + beat.estimatedSeconds;
    cursor = end;

    return rangesAvailable
      ? { label: beat.label, range: `${formatClockSeconds(start)}–${formatClockSeconds(end)}` }
      : { label: beat.label };
  });
}

export function briefToSummaryItems(brief: CreativeBriefContent): BriefSummaryItem[] {
  let cursor = 0;

  return brief.narrativeStructure.beats.map((beat) => {
    const start = cursor;
    const end = cursor + beat.estimatedSeconds;
    cursor = end;

    return {
      label: beat.label,
      range: `${formatClockSeconds(start)}–${formatClockSeconds(end)}`,
      summary: beat.summary,
    };
  });
}

export interface SpecRow {
  label: string;
  value: string;
}

const SUBTITLE_PRESET_LABELS: Record<string, string> = {
  'white-outline': '白字描边',
  'classic-white': '经典白',
  yellow: '明黄',
  red: '红色',
  cyan: '青色',
  pink: '粉色',
  blue: '蓝色',
};

export function specToRows(spec: ProductionSpec): SpecRow[] {
  return [
    { label: '视频类型', value: spec.videoType },
    { label: '推荐方案', value: '素材匹配 + 基础剪辑（material_edit）' },
    { label: '视觉风格', value: spec.visualStyle },
    { label: '配色', value: `${spec.palette.name}：${spec.palette.description}` },
    { label: '字体', value: `${spec.font.family}（${spec.font.usage}）` },
    {
      label: '音色',
      value: `${spec.voiceProfile.displayName}（${spec.voiceProfile.description}）`,
    },
    {
      label: '字幕',
      value: `${SUBTITLE_PRESET_LABELS[spec.subtitleStyle.presetId] ?? spec.subtitleStyle.presetId} / ${spec.subtitleStyle.fontSize}px`,
    },
    { label: '素材策略', value: spec.materialStrategy },
    { label: '节奏', value: spec.rhythm },
    {
      label: '交付规格',
      value: `${spec.aspectRatio} / ${spec.resolution} / ${spec.fps}fps / MP4 H.264 + AAC 192kbps / 烧录字幕 / 原声静音`,
    },
  ];
}

export function durationRangeLabel(spec: ProductionSpec): string {
  return `${spec.durationRange.minSeconds}–${spec.durationRange.maxSeconds} 秒（目标 ${spec.durationRange.targetSeconds} 秒）`;
}

export function workflowStatusLabel(status: WorkflowRunStatus | undefined): string {
  return status ? STATUS_LABELS[status] : '未开始';
}

export function isRunActive(workflow: WorkflowPublicState | null): boolean {
  return workflow?.status === 'running';
}

export function canSend(workflow: WorkflowPublicState | null): boolean {
  return workflow?.status === 'waiting_user' || workflow?.status === 'succeeded';
}
