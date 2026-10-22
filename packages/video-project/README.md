# @miaoma/video-project

视频项目数据模型（Zod Schema）。

当前包含 T01 所需的最小基线：

- `PROJECT_SCHEMA_VERSION`
- `ProjectHeaderSchema`
- `ProjectSettingsSchema`（锁定 16:9 / 1920×1080 / 30fps / 源声静音）
- `TimeMsSchema`

T03 将扩展为完整的 `VideoProject`、四轨片段、审批、消息、产物与 IPC 契约。所有时间使用非负整数毫秒。
