# FFmpeg / ffprobe

这里放置随应用分发的 FFmpeg 二进制，**二进制不提交仓库**。

- Windows 打包前放入：`ffmpeg.exe`、`ffprobe.exe`。
- 开发态优先级：`MIAOMA_FFMPEG_PATH` / `MIAOMA_FFPROBE_PATH` → 本目录 → 系统 `PATH`。
- 打包态：Forge 会把本目录复制到 `process.resourcesPath/ffmpeg`。
- 构建来源、版本和许可在 T06 选定并记录。
