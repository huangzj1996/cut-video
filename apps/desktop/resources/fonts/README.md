# 随包字幕字体

导出（T19）用 ffmpeg 的 `ass` 滤镜烧录字幕后，ASS 的 `Fontname` 固定为 `Noto Sans SC`，
与预览 CSS 的字体族保持一致。烧录时主进程把字体复制到导出目录下的临时字体目录，
再把 `fontsdir` 指向它（相对 ASCII 路径 + 进程 cwd），避免滤镜参数出现中文绝对路径。

| 文件                     | 说明                                                  |
| ------------------------ | ----------------------------------------------------- |
| `NotoSansSC-Regular.otf` | Noto Sans SC Regular（单字重），字族名 `Noto Sans SC` |
| `OFL.txt`                | SIL Open Font License 1.1 许可证原文                  |

来源（Noto 官方仓库）：

- 字体：<https://github.com/notofonts/noto-cjk> 的 `Sans/SubsetOTF/SC/NotoSansSC-Regular.otf`
- 许可证：<https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE>

分发：`apps/desktop/forge.config.ts` 的 `extraResource` 把本目录带到 `<resources>/fonts`；
开发态从 `apps/desktop/resources/fonts` 解析。字体缺失时导出前置校验会报
`EXPORT_FONT_MISSING` 并阻止导出。
