/**
 * 「妙剪创作消息页」frame 的静态 UI 实现。
 * 设计依据：docs/design/miaoma-magicut.pen（frame id K4Avtd）。
 * 当前使用 mock 数据，不接入真实 AI、持久化与文件上传。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { EditorIcon } from './editor-icons';
import './create-chat.css';

const TIMESTAMP = '18:26';

const USER_REQUEST =
  '帮我生成一条 60 秒产品介绍短视频，突出智能视频剪辑、素材自动匹配、口播配音和一键导出。整体节奏清晰，适合在官网和社媒同步发布。';

const USER_TAGS: readonly (readonly string[])[] = [
  ['视频画面', '智能匹配素材'],
  ['旁白配音', '清朗青年'],
];

const SUMMARY_TITLE =
  '这是一份完整的技术教学口播稿，主题聚焦“前端 AI 进阶学习路线”，包含 4 个时间段的内容：';

const SUMMARY_ITEMS: readonly string[] = [
  '开场问题引入（0:00-0:25）',
  '为什么不能直接学 AI（0:25-0:55）',
  '三个月学习路线详解（0:55-2:45）',
  '收尾总结（2:45-3:05）',
];

const SCRIPT_PARAGRAPHS: readonly string[] = [
  '很多前端同学现在都在焦虑一件事：AI 到底应该怎么学。我先问你，如果现在项目里要做一个 AI 功能，比如智能客服、知识库问答，你第一步会怎么做？',
  '我猜很多同学第一反应是调大模型接口、写个聊天框。这个思路没错，但它只是最外面那一层。真实项目里，你还得考虑用户权限、业务数据、上下文怎么组织、工具怎么调用、日志怎么记录、效果怎么评测、异常怎么兜底。那些 50K 以上的前端 AI 架构岗，要的不是只会调接口的人，而是能讲清楚全链路落地逻辑的人。',
  '那具体怎么学？我给你一条三个月的进阶路线。第一个月，死磕前端基本盘；第二个月，补全服务端链路；第三个月，进入 AI Agent 工程化。每个阶段都要用真实项目证据来证明能力，而不是只背概念。你当前的学习瓶颈是什么？评论区聊聊。记得点赞关注，我们下期拆解每个阶段的具体落地细节。',
];

const SPEC_ROWS: readonly (readonly [string, string])[] = [
  ['视频类型', '抖音/视频号竖屏成片，品牌种草与转化型短视频，适配 15-30 秒主版本'],
  ['推荐方案', 'AIDA 结构：痛点开场、产品亮点、使用场景、信任背书、明确行动号召'],
  ['视频风格', '暗色即时通信卡片风格，消息气泡、文件预览、进度轨道与轻量数据标签组合'],
  ['配色', 'Carbon Frost 暗底：#0D1015/#151B22，蓝色高亮 #4A9FD8，白灰文本分层'],
  ['字体', 'Inter 承载标题与正文；Geist Mono 用于规格、时长、版本号等数据型信息'],
  ['口播音色', '清晰专业的年轻中性音色，中速偏稳，结尾 CTA 轻微提速增强行动感'],
  ['字幕样式', '双行以内白字字幕，关键词蓝色描边或底托，底部安全区内显示并避开控件'],
  ['素材策略', '产品实拍为主，补充界面录屏、聊天截图、客户证言与轻量动效过渡'],
  ['节奏', '0-3 秒强钩子，4-15 秒密集卖点，16-24 秒场景证明，末尾 3 秒收束 CTA'],
  ['交付规格', '1080x1920 MP4/H.264，24/30fps，含无字幕版、带字幕版、封面与工程源文件'],
];

type PlanTone = 'done' | 'active' | 'pending';

interface PlanStep {
  id: string;
  title: string;
  detail: string;
  status: string;
  tone: PlanTone;
}

const PLAN_STEPS: readonly PlanStep[] = [
  {
    id: '01',
    title: '准备阶段',
    detail: '加载制片规范与文稿',
    status: '已完成',
    tone: 'done',
  },
  {
    id: '02',
    title: '创建分镜',
    detail: '生成 6 个镜头，每段绑定字幕与素材意图',
    status: '已完成',
    tone: 'done',
  },
  {
    id: '03',
    title: '配音生成',
    detail: '合成清朗青年旁白',
    status: '进行中',
    tone: 'active',
  },
  {
    id: '04',
    title: '视频生成',
    detail: '输出预览并进入编辑',
    status: '待确认',
    tone: 'pending',
  },
];

type MetricTone = 'blue' | 'purple' | 'teal' | 'amber';

interface OverviewMetric {
  label: string;
  value: string;
  tone: MetricTone;
}

const OVERVIEW_METRICS: readonly OverviewMetric[] = [
  { label: '成片时长', value: '约 3 分 05 秒', tone: 'blue' },
  { label: '视频风格', value: '科技蓝紫 MG 动画', tone: 'purple' },
  { label: '口播音色', value: '清朗青年', tone: 'teal' },
  { label: '导出状态', value: '预览已生成', tone: 'amber' },
];

function BackArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={18}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
      width={18}
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function SendPlaneIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={20}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.7}
      viewBox="0 0 24 24"
      width={20}
    >
      <path d="M21 3 3 10.5l7.2 3.3L21 3Z" />
      <path d="m21 3-7.8 17.2-3-6.4" />
    </svg>
  );
}

function PlanList({ variant }: { variant: 'flow' | 'aside' }) {
  return (
    <ul className={`cc-plan cc-plan--${variant}`}>
      {PLAN_STEPS.map((step) => (
        <li className="cc-plan-row" key={step.id}>
          <span aria-hidden="true" className={`cc-plan-dot cc-plan-dot--${step.tone}`} />
          <span className="cc-plan-copy">
            <span className="cc-plan-title">
              {step.id} {step.title}
            </span>
            <span className="cc-plan-detail">{step.detail}</span>
          </span>
          <span className={`cc-plan-status cc-plan-status--${step.tone}`}>{step.status}</span>
        </li>
      ))}
    </ul>
  );
}

export function CreateChatScreen() {
  const [requestOpen, setRequestOpen] = useState(true);
  const [planConfirmed, setPlanConfirmed] = useState(false);
  const [specConfirmed, setSpecConfirmed] = useState(false);
  const [draft, setDraft] = useState('');
  const [sentMessages, setSentMessages] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const noticeTimer = useRef<number | null>(null);

  const notify = useCallback((message: string) => {
    setNotice(message);

    if (noticeTimer.current !== null) {
      window.clearTimeout(noticeTimer.current);
    }

    noticeTimer.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimer.current = null;
    }, 2200);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimer.current !== null) {
        window.clearTimeout(noticeTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (sentMessages.length === 0) {
      return;
    }

    const node = scrollRef.current;

    if (node) {
      node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
    }
  }, [sentMessages]);

  const handleSend = useCallback(() => {
    const text = draft.trim();

    if (!text) {
      return;
    }

    setSentMessages((previous) => [...previous, text]);
    setDraft('');
  }, [draft]);

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleConfirmPlan = () => {
    if (planConfirmed) {
      return;
    }

    setPlanConfirmed(true);
    notify('方案已确认（演示）');
  };

  const handleConfirmSpec = () => {
    if (specConfirmed) {
      return;
    }

    setSpecConfirmed(true);
    notify('成片需求已确认（演示）');
  };

  return (
    <div className="create-chat-screen">
      <button
        aria-label="返回创作页"
        className="cc-back"
        type="button"
        onClick={() => {
          window.location.hash = '#/create';
        }}
      >
        <BackArrowIcon />
      </button>

      <aside aria-label="创作执行要点" className="cc-aside">
        <PlanList variant="aside" />
      </aside>

      <main className="cc-scroll" ref={scrollRef}>
        <div className="cc-stage">
          <div className="cc-column">
            <p className="cc-time">{TIMESTAMP}</p>

            <div className="cc-flow">
              <article className={`cc-request${requestOpen ? ' cc-request--expanded' : ''}`}>
                <div className="cc-request-head">
                  <span aria-hidden="true" className="cc-avatar" />
                  <span className="cc-request-name">你</span>
                  <button
                    aria-expanded={requestOpen}
                    aria-label={requestOpen ? '收起创作需求' : '展开创作需求'}
                    className="cc-request-toggle"
                    type="button"
                    onClick={() => setRequestOpen((open) => !open)}
                  >
                    <EditorIcon name="chevron-down" size={17} />
                  </button>
                </div>

                {requestOpen ? (
                  <>
                    <p className="cc-request-text">{USER_REQUEST}</p>
                    <div className="cc-request-tags">
                      {USER_TAGS.map((tags) => (
                        <div className="cc-tag-row" key={tags.join('-')}>
                          {tags.map((tag) => (
                            <span className="cc-tag" key={tag}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </article>

              <div className="cc-prose">
                <p>
                  我来分析你的文稿，这是一份关于“前端 AI
                  进阶学习路线”的教学内容，时间线清晰、结构完整。让我先加载制片技能来完成方案设计。
                </p>
                <p>我已经加载了制片技能。现在分析你的文稿：</p>
              </div>

              <section className="cc-summary-card">
                <h2 className="cc-card-title">{SUMMARY_TITLE}</h2>
                <ul className="cc-summary-list">
                  {SUMMARY_ITEMS.map((item) => (
                    <li className="cc-summary-item" key={item}>
                      <span aria-hidden="true" className="cc-summary-dot" />
                      {item}
                    </li>
                  ))}
                </ul>
              </section>

              <p className="cc-prose">
                {'文稿已经包含时间轴和画面描述，属于'}
                <span className="cc-type-highlight">类型 3</span>
                {
                  '：有实质内容但不是纯口播文稿，需要先转化为纯口播文稿。同时，内容涉及大量技术概念、学习路径、时间规划，非常适合用 MG 动画来可视化呈现。'
                }
              </p>

              <section className="cc-doc-card">
                <h2 className="cc-script-title">转化后的纯口播文稿</h2>
                <div className="cc-script">
                  {SCRIPT_PARAGRAPHS.map((paragraph) => (
                    <p key={paragraph.slice(0, 18)}>{paragraph}</p>
                  ))}
                </div>
              </section>

              <p className="cc-prose">
                文稿已转化为纯口播形式。现在为你推荐制作方案：素材混合 MG
                动画。该方案既能保留技术教学的专业感，又能用动态图表和流程示意降低理解成本。
              </p>

              <div className="cc-actions">
                <button
                  className="cc-confirm cc-confirm--wide"
                  disabled={planConfirmed}
                  type="button"
                  onClick={handleConfirmPlan}
                >
                  {planConfirmed ? '已确认' : '确认并继续'}
                </button>
              </div>

              <div className="cc-prose">
                <p>
                  好的，你选择素材混合 MG 动画方案。现在我来读取 MG
                  动画方案的详细规范，为你形成完整的成片需求。
                </p>
                <p>
                  现在我来为你生成完整的成片需求文档。根据你的内容特点，我选择科技蓝紫配色方案，配合阿里妈妈数黑体字体，打造专业前沿的技术教学风格。
                </p>
              </div>

              <section className="cc-doc-card">
                <h2 className="cc-spec-title">成片需求文档</h2>
                <table className="cc-table">
                  <thead>
                    <tr>
                      <th scope="col">字段</th>
                      <th scope="col">完整需求说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SPEC_ROWS.map(([field, detail]) => (
                      <tr key={field}>
                        <td>{field}</td>
                        <td>{detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <div className="cc-actions">
                <button
                  className="cc-confirm"
                  disabled={specConfirmed}
                  type="button"
                  onClick={handleConfirmSpec}
                >
                  {specConfirmed ? '已确认' : '确认'}
                </button>
              </div>

              <div className="cc-agent">
                <p className="cc-prose">
                  我已收到创作需求。接下来会按即时协作流程推进：先拆解目标受众与叙事节奏，再生成分镜规划、匹配素材、选择口播音色，最后进入编辑器等待你确认细节。
                </p>
                <PlanList variant="flow" />
              </div>

              <section className="cc-overview">
                <h2 className="cc-overview-title">视频概览</h2>
                <p className="cc-overview-desc">
                  整个制作流程已完成。智能体已经完成文稿确认、成片需求、分镜规划、配音生成和视频生成，下面是当前视频概览。
                </p>

                <div className="cc-metrics">
                  {OVERVIEW_METRICS.map((metric) => (
                    <div className="cc-metric" key={metric.label}>
                      <span className="cc-metric-label">{metric.label}</span>
                      <span className={`cc-metric-value cc-metric-value--${metric.tone}`}>
                        {metric.value}
                      </span>
                    </div>
                  ))}
                </div>

                <button
                  className="cc-complete"
                  type="button"
                  onClick={() => {
                    window.location.hash = '#/editor';
                  }}
                >
                  <EditorIcon name="check" size={17} />
                  <span>视频制作完成，可进入编辑器预览并微调轨道。</span>
                </button>
              </section>

              {sentMessages.map((message, index) => (
                <article className="cc-request cc-sent" key={`${index}-${message}`}>
                  <div className="cc-request-head">
                    <span aria-hidden="true" className="cc-avatar" />
                    <span className="cc-request-name">你</span>
                  </div>
                  <p className="cc-request-text cc-sent-text">{message}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </main>

      <div className="cc-dock">
        <div className="cc-column">
          <div className="cc-composer">
            <button
              aria-label="上传附件"
              className="cc-attach"
              type="button"
              onClick={() => notify('附件上传将在后续版本开放')}
            >
              <EditorIcon name="plus" size={20} />
            </button>

            <div className="cc-composer-main">
              <textarea
                aria-label="继续补充创作要求"
                className="cc-composer-input"
                placeholder="继续补充创作要求，或要求智能体修改分镜"
                rows={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
              />
              <span className="cc-composer-hint">例如：缩短到 90 秒、加重技术感、换成沉稳男声</span>
            </div>

            <button
              aria-label="发送消息"
              className="cc-send"
              disabled={draft.trim().length === 0}
              type="button"
              onClick={handleSend}
            >
              <SendPlaneIcon />
            </button>
          </div>
        </div>
      </div>

      {notice ? (
        <div className="cc-toast" role="status">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
