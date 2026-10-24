import { useEffect, useState } from 'react';
import type {
  ArtifactReference,
  ChatMessage,
  CreativeBrief,
  ExportStatus,
  ProductionSpec,
  ScenePlan,
  ValidationReport,
} from '@miaoma/video-project';
import { unwrapIpc } from '../../lib/ipc';
import { EditorIcon } from '../editor-icons';
import { ScriptAnalysisCard } from './ScriptAnalysisCard';
import {
  briefToSummaryItems,
  formatOverviewDuration,
  gateLabel,
  gateStatusLabel,
  specToRows,
  type GateView,
} from './view-model';

const CONTENT_TYPE_LABELS: Record<string, string> = {
  knowledge: '知识口播',
  product_promo: '产品种草',
  brand_story: '品牌故事',
  tutorial: '教程讲解',
  opinion: '观点表达',
  vlog: '生活记录',
  other: '其他',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBrief(value: unknown): value is CreativeBrief {
  return (
    isRecord(value) &&
    typeof value.title === 'string' &&
    isRecord(value.narrativeStructure) &&
    typeof value.durationSeconds === 'number'
  );
}

function isSpec(value: unknown): value is ProductionSpec {
  return (
    isRecord(value) &&
    value.recommendedScheme === 'material_edit' &&
    isRecord(value.deliverySpec) &&
    isRecord(value.durationRange)
  );
}

function isScenePlan(value: unknown): value is ScenePlan {
  return (
    isRecord(value) && Array.isArray(value.scenes) && typeof value.scenePlanVersion === 'number'
  );
}

function isValidationReport(value: unknown): value is ValidationReport {
  return (
    isRecord(value) &&
    typeof value.passed === 'boolean' &&
    Array.isArray(value.errors) &&
    Array.isArray(value.warnings)
  );
}

function useArtifact(
  projectId: string,
  reference: ArtifactReference | undefined,
): { data: unknown; error: boolean } {
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!reference) {
      return;
    }

    let cancelled = false;
    setData(null);
    setError(false);

    void (async () => {
      try {
        const result = unwrapIpc(
          await window.miaoma.workflow.getArtifact({
            projectId,
            reference,
          }),
        );

        if (!cancelled) {
          setData(result);
        }
      } catch {
        if (!cancelled) {
          setError(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, reference?.kind, reference?.ref, reference?.version]);

  return { data, error };
}

function SpecTable({ spec }: { spec: ProductionSpec }) {
  return (
    <div className="cc-doc-card">
      <h2 className="cc-spec-title">成片需求</h2>
      <table className="cc-table">
        <thead>
          <tr>
            <th>项目</th>
            <th>内容</th>
          </tr>
        </thead>
        <tbody>
          {specToRows(spec).map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SceneList({ plan }: { plan: ScenePlan }) {
  return (
    <div className="cc-scene-list">
      {plan.scenes.slice(0, 12).map((scene) => (
        <article className="cc-scene-item" key={scene.id}>
          <div className="cc-scene-head">
            <span className="cc-scene-title">
              {String(scene.index).padStart(2, '0')} {scene.title}
            </span>
            <span className="cc-scene-meta">
              {(scene.estimatedDurationMs / 1_000).toFixed(1)} 秒
            </span>
          </div>
          <p className="cc-scene-script">{scene.script}</p>
          <p className="cc-scene-intent">画面：{scene.visualIntent}</p>
        </article>
      ))}
    </div>
  );
}

function ApprovalCard({
  message,
  gate,
  projectId,
}: {
  message: Extract<ChatMessage, { type: 'approval_request' }>;
  gate?: GateView;
  projectId: string;
}) {
  const status = gate?.status ?? 'waiting';
  const { data, error } = useArtifact(projectId, message.payload.artifact);
  const brief = message.payload.gate === 'A1' && isBrief(data) ? data : null;
  const hasAnalysis = brief?.scriptAnalysis !== undefined;

  return (
    <section className={`cc-gate cc-gate--${status}`}>
      <div className="cc-gate-head">
        <div>
          <p className="cc-gate-kicker">{gateLabel(message.payload.gate)}</p>
          <h2 className="cc-gate-title">{message.payload.title}</h2>
        </div>
        <span className={`cc-gate-status cc-gate-status--${status}`}>
          {gateStatusLabel(status)}
        </span>
      </div>
      {hasAnalysis ? null : <p className="cc-gate-summary">{message.payload.summary}</p>}

      {brief ? (
        brief.scriptAnalysis ? (
          <ScriptAnalysisCard
            analysis={{
              ...brief.scriptAnalysis,
              beats: brief.narrativeStructure.beats,
            }}
          />
        ) : (
          <div className="cc-summary-card">
            <h3 className="cc-card-title">
              {brief.title} · 目标 {brief.durationSeconds} 秒
            </h3>
            <ul className="cc-summary-list">
              {briefToSummaryItems(brief).map((item) => (
                <li className="cc-summary-item" key={`${item.range}-${item.label}`}>
                  <span aria-hidden="true" className="cc-summary-dot" />
                  <span>
                    <strong>{item.range}</strong> {item.label}：{item.summary}
                  </span>
                </li>
              ))}
            </ul>
            <p className="cc-gate-note">
              方案：素材匹配 + 基础剪辑（只使用直切）；文稿类型：
              {CONTENT_TYPE_LABELS[brief.contentType] ?? brief.contentType}
            </p>
          </div>
        )
      ) : null}

      {message.payload.gate === 'A2' && isSpec(data) ? <SpecTable spec={data} /> : null}

      {message.payload.gate === 'A3' && isScenePlan(data) ? <SceneList plan={data} /> : null}

      {!data && !error ? <p className="cc-gate-loading">正在读取审批内容…</p> : null}
      {error ? <p className="cc-gate-error">审批内容读取失败，请重试。</p> : null}

      {status === 'waiting' ? <p className="cc-gate-hint">{message.payload.prompt}</p> : null}
      {status === 'changes_requested' ? (
        <p className="cc-gate-hint">已提交修改，正在生成新版本。</p>
      ) : null}
      {status === 'stale' ? (
        <p className="cc-gate-hint">需求已更新，请在新一轮审批中确认。</p>
      ) : null}
    </section>
  );
}

function exportStatusLabel(status: ExportStatus): string {
  switch (status) {
    case 'exported':
      return '已导出';
    case 'failed':
      return '导出失败';
    default:
      return '未导出';
  }
}

function VideoOverview({
  message,
  projectId,
  onOpenEditor,
}: {
  message: Extract<ChatMessage, { type: 'video_overview' }>;
  projectId: string;
  onOpenEditor: () => void;
}) {
  const { data: specArtifact, error: specError } = useArtifact(projectId, message.payload.spec);
  const spec = isSpec(specArtifact) ? specArtifact : null;
  const styleLabel = spec ? `${spec.palette.name} · 素材剪辑` : specError ? '—' : '读取中…';
  const voiceLabel = spec ? spec.voiceProfile.displayName : specError ? '—' : '读取中…';
  const exportLabel = exportStatusLabel(message.payload.exportStatus);
  const exportTone = message.payload.exportStatus === 'exported' ? 'teal' : 'amber';

  return (
    <section className="cc-overview">
      <h2 className="cc-overview-title">视频概览</h2>
      <p className="cc-overview-desc">
        整个制作流程已完成。智能体已经完成文稿确认、成片需求、分镜规划、配音生成和视频生成，下面是当前视频概览。
      </p>
      <div className="cc-metrics">
        <div className="cc-metric">
          <span className="cc-metric-label">成片时长</span>
          <span className="cc-metric-value cc-metric-value--blue">
            {formatOverviewDuration(message.payload.durationSeconds)}
          </span>
        </div>
        <div className="cc-metric">
          <span className="cc-metric-label">视频风格</span>
          <span
            className="cc-metric-value cc-metric-value--purple"
            title={spec?.visualStyle ?? styleLabel}
          >
            {styleLabel}
          </span>
        </div>
        <div className="cc-metric">
          <span className="cc-metric-label">口播音色</span>
          <span className="cc-metric-value cc-metric-value--teal" title={voiceLabel}>
            {voiceLabel}
          </span>
        </div>
        <div className="cc-metric">
          <span className="cc-metric-label">导出状态</span>
          <span className={`cc-metric-value cc-metric-value--${exportTone}`}>{exportLabel}</span>
        </div>
      </div>
      <button className="cc-overview-status" type="button" onClick={onOpenEditor}>
        <EditorIcon name="check" size={18} />
        <span>视频制作完成，可进入编辑器预览并微调轨道。</span>
      </button>
    </section>
  );
}

export function ChatMessageItem({
  message,
  gate,
  projectId,
  onRetry,
  onOpenEditor,
}: {
  message: ChatMessage;
  gate?: GateView;
  projectId: string;
  onRetry: () => void;
  onOpenEditor: () => void;
}) {
  const { data: errorArtifact } = useArtifact(projectId, message.artifactRef);

  switch (message.type) {
    case 'user_requirement': {
      if (message.payload.kind === 'follow_up') {
        return (
          <article className="cc-request cc-sent">
            <div className="cc-request-head">
              <span aria-hidden="true" className="cc-avatar" />
              <span className="cc-request-name">你</span>
            </div>
            <p className="cc-request-text cc-sent-text">{message.payload.text}</p>
          </article>
        );
      }

      return (
        <article className="cc-request">
          <div className="cc-request-head">
            <span aria-hidden="true" className="cc-avatar" />
            <span className="cc-request-name">你</span>
          </div>
          <p className="cc-request-text cc-sent-text">{message.payload.script}</p>
          <div className="cc-request-tags">
            {message.payload.tags.map((tag) => (
              <div className="cc-tag-row" key={tag.group}>
                {tag.values.map((value) => (
                  <span className="cc-tag" key={value}>
                    {value}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </article>
      );
    }
    case 'user_confirmation':
      return (
        <article className="cc-request cc-sent">
          <div className="cc-request-head">
            <span aria-hidden="true" className="cc-avatar" />
            <span className="cc-request-name">你</span>
          </div>
          <p className="cc-request-text cc-sent-text">{message.payload.rawText}</p>
          <p className="cc-confirm-note">
            {message.payload.decision === 'approve' ? '已确认，继续执行' : '已提交修改意见'}
          </p>
        </article>
      );
    case 'script_analysis': {
      const items = briefToSummaryItems(message.payload.brief);

      return (
        <div className="cc-agent">
          <p className="cc-prose">
            我已经完成文稿分析并生成创意简报：
            <strong>{message.payload.brief.title}</strong>。目标时长{' '}
            {message.payload.brief.durationSeconds} 秒，文稿类型{' '}
            {CONTENT_TYPE_LABELS[message.payload.brief.contentType] ??
              message.payload.brief.contentType}
            。
          </p>
          <section className="cc-summary-card">
            <h2 className="cc-card-title">{message.payload.brief.summary}</h2>
            <ul className="cc-summary-list">
              {items.map((item) => (
                <li className="cc-summary-item" key={`${item.range}-${item.label}`}>
                  <span aria-hidden="true" className="cc-summary-dot" />
                  <span>
                    <strong>{item.range}</strong> {item.label}：{item.summary}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      );
    }
    case 'production_spec':
      return <SpecTable spec={message.payload.spec} />;
    case 'approval_request':
      return <ApprovalCard message={message} gate={gate} projectId={projectId} />;
    case 'video_overview':
      return <VideoOverview message={message} projectId={projectId} onOpenEditor={onOpenEditor} />;
    case 'error': {
      const issues = isValidationReport(errorArtifact)
        ? [...errorArtifact.errors, ...errorArtifact.warnings].slice(0, 12)
        : [];

      return (
        <section className="cc-error-card" role="alert">
          <div className="cc-error-head">
            <span className="cc-error-code">{message.payload.code}</span>
            <span className="cc-error-message">{message.payload.message}</span>
          </div>
          {issues.length > 0 ? (
            <ul className="cc-validation-list">
              {issues.map((issue, index) => (
                <li
                  className={`cc-validation-item cc-validation-item--${issue.severity}`}
                  key={`${issue.code}-${index}`}
                >
                  {issue.message}
                  {issue.fixHint ? `（${issue.fixHint}）` : ''}
                </li>
              ))}
            </ul>
          ) : null}
          {message.payload.retryable ? (
            <button className="cc-retry" type="button" onClick={onRetry}>
              重试
            </button>
          ) : null}
        </section>
      );
    }
    case 'system_notice':
      return (
        <div className={`cc-notice cc-notice--${message.payload.level}`} role="status">
          {message.payload.message}
        </div>
      );
    case 'script_rewrite':
      return (
        <section className="cc-doc-card">
          <h2 className="cc-script-title">{message.payload.content.title}</h2>
          <div className="cc-script">
            {message.payload.content.paragraphs.map((paragraph, index) => (
              <p key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph}</p>
            ))}
          </div>
        </section>
      );
    case 'scheme_recommendation':
      return (
        <section className="cc-summary-card">
          <h2 className="cc-card-title">推荐方案：素材匹配 + 基础剪辑</h2>
          <ul className="cc-summary-list">
            {message.payload.reasons.map((reason) => (
              <li className="cc-summary-item" key={reason}>
                <span aria-hidden="true" className="cc-summary-dot" />
                {reason}
              </li>
            ))}
          </ul>
        </section>
      );
    case 'execution_update':
    default:
      return null;
  }
}
