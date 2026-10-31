# 文档索引

## 需求与任务

- [需求文档 v1.1](requirements/花生AI_妙剪Magicut_需求文档_v1.1.md) — 当前基线
- [任务清单 v1.1](requirements/花生AI_妙剪Magicut_任务清单_v1.1.md) — 21 个任务与验收标准
- [需求文档 v1.0](requirements/花生AI桌面创作工具_需求文档_v1.0.md) — 历史版本

## 设计

- [前端原型](design/miaoma-magicut.pen) — 唯一 UI 依据

## 领域语言

- [GLOSSARY.md](../GLOSSARY.md) — 工程、时间线与导出的领域词汇（含各概念的 _Avoid_ 用词）

## 研究

- [FFmpeg 导出能力事实核查（2026-10-31）](research/2026-10-31-ffmpeg-export-facts.md) — T19 的一手实测记录、版本陷阱与来源链接

## 决策

- [ADR-0001 导出采用两段式渲染](adr/0001-export-two-phase-render.md) — 先预混音轨，再单遍视频编码、烧录与封装

## 阅读顺序

1. 先看需求文档的产品范围、原型索引和用户流程。
2. 再看任务清单中的依赖、验收标准和里程碑。
3. UI 细节直接对照原型；需求文档只定义行为、数据和验收。
