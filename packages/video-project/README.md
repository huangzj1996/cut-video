# @miaoma/video-project

妙剪 Magicut 视频项目数据模型（Zod 4 Schema）。

所有时间字段使用非负整数毫秒，所有 Schema 通过 `z.infer` 推导 TypeScript 类型，不维护重复 interface。

## 模型分层

```text
VideoProject
├── project      ProjectMetadata      工程头（projectId、contentRevision、名称、时间）
├── canvas       CanvasConfig         v1 固定 16:9 / 1920×1080 / 30fps
├── render       RenderConfig         固定 MP4 / H.264 / AAC 192kbps、源声静音、字幕烧录
├── ai           AiRunMetadata        运行标识、模型/提供者配置版本、输入指纹
├── assets       ProjectAssets        videos / voices / music / subtitles / thumbnails
├── scenes       Scene[]              分镜
└── tracks       TimelineTrack[]      video / voice / subtitle / music 四轨
```

片段使用 `kind` 判别联合：`VideoClip | VoiceClip | SubtitleClip | MusicClip`。轨道同样按 `kind` 判别，确保轨道只容纳对应种类的片段。

## 使用

```ts
import { VideoProjectSchema, type VideoProject } from '@miaoma/video-project';

const project: VideoProject = VideoProjectSchema.parse(rawProject);
```

## JSON Schema 导出

```ts
import {
  JSON_SCHEMA_EXPORTS,
  getJsonSchema,
  VideoProjectSchema,
} from '@miaoma/video-project';

const jsonSchema = getJsonSchema(VideoProjectSchema);
// 或使用预注册的导出：
const sceneSchema = getJsonSchema(JSON_SCHEMA_EXPORTS.scene);
```

导出目标为 JSON Schema draft 2020-12，结果按 Schema 实例缓存。

注意：`z.refine` 中的业务约束（片段起止、裁剪边界、视频素材必须带 fps）不会出现在 JSON Schema 中。JSON Schema 只覆盖结构约束；完整业务校验由 T14/T15 负责。

## v1 约束

- 画布 16:9 / 1920×1080 / 30fps。
- 输出 MP4、H.264、AAC 192kbps；源视频原声静音；字幕烧录。
- 字幕样式预设与 `apps/desktop/client/src/screens/panels/SubtitlePanel.tsx` 的 7 个预设一致，字号 24–72。
- 每类轨道首版一条；该约束及轨道覆盖/重叠等时间不变量不在本包结构校验中。

## 脚本

```bash
pnpm --filter @miaoma/video-project typecheck
pnpm --filter @miaoma/video-project test
```
