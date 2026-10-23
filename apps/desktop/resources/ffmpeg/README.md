# FFmpeg / ffprobe

这里放置随应用分发的 FFmpeg 二进制，**二进制不提交仓库**。

当前开发环境已放置（仅本机，未提交）：

- `ffprobe.exe`：2023-02-13 git-2296078397 essentials build，来自 npm `@ffprobe-installer/win32-x64@5.1.0`
- `ffmpeg.exe`：N-92722-gf22fcd4483，来自 npm `@ffmpeg-installer/win32-x64@4.1.0`

T06 需要替换为同源、较新的正式构建，并记录版本、来源和许可证。

- Windows 打包前放入：`ffmpeg.exe`、`ffprobe.exe`。
- 开发态优先级：`MIAOMA_FFMPEG_PATH` / `MIAOMA_FFPROBE_PATH` → 本目录 → 系统 `PATH`。
- 打包态：Forge 会把本目录复制到 `process.resourcesPath/ffmpeg`。
- 未找到 ffprobe 时，创作页创建带素材的工程会提示 `ASSET_PROBE_UNAVAILABLE`。
