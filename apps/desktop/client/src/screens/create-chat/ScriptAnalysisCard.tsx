import type { ScriptAnalysisContent, ScriptAnalysisDraft } from '@miaoma/video-project';
import { toTimelineBeats } from './view-model';

export type ScriptAnalysisView = Partial<ScriptAnalysisContent> & {
  beats?: ScriptAnalysisDraft['beats'];
};

function paragraphs(value: string): string[] {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

/**
 * 原型图「文稿内容分析消息」的五段式内容：
 * 开场 → 结构摘要（时间线）→ 类型判断 → 纯口播预览 → 方案推荐。
 * 既用于流式中的实时草稿，也用于 A1 审批卡里的最终产物。
 */
export function ScriptAnalysisCard({ analysis }: { analysis: ScriptAnalysisView }) {
  const timeline = toTimelineBeats(analysis.beats ?? []);
  const voiceover = analysis.voiceoverScript ? paragraphs(analysis.voiceoverScript) : [];

  return (
    <div className="cc-analysis">
      {analysis.intro ? <p className="cc-analysis-intro">{analysis.intro}</p> : null}

      {analysis.structureIntro || timeline.length > 0 ? (
        <section className="cc-structure-card">
          <h3 className="cc-structure-title">{analysis.structureIntro || '文稿时间结构'}</h3>
          {timeline.length > 0 ? (
            <ul className="cc-timeline">
              {timeline.map((beat, index) => (
                <li className="cc-timeline-row" key={`${beat.label}-${index}`}>
                  <span aria-hidden="true" className="cc-timeline-dot" />
                  <span className="cc-timeline-text">
                    {beat.label}
                    {beat.range ? `（${beat.range}）` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {analysis.scriptType ? <p className="cc-analysis-text">{analysis.scriptType}</p> : null}

      {analysis.voiceoverScript ? (
        <section className="cc-voiceover-card">
          <h3 className="cc-voiceover-title">转化后的纯口播文稿</h3>
          <div className="cc-voiceover-body">
            {voiceover.map((paragraph, index) => (
              <p key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph}</p>
            ))}
          </div>
        </section>
      ) : null}

      {analysis.schemeRecommendation ? (
        <p className="cc-analysis-text">{analysis.schemeRecommendation}</p>
      ) : null}
    </div>
  );
}
