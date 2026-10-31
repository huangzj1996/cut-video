# FFmpeg 导出能力事实核查（T19 前置研究）

- 日期：2026-10-31
- 环境：Windows 11、随包 ffmpeg `apps/desktop/resources/ffmpeg/ffmpeg.exe`，版本 `N-92722-gf22fcd4483`（2018 构建，对应源码提交 `f22fcd4483`）
- 构建能力（`ffmpeg -buildconf` 实测）：`--enable-libass --enable-fontconfig --enable-libfreetype --enable-libx264 --enable-libmp3lame --enable-gpl`
- 方法：直接实测随包二进制（一手事实）+ 官方文档/对应源码（链接见文末）。凡「未证实」都已标注。

## 1. 进度输出（`-progress pipe:1`）

实测命令（3 秒 320×180 测试源）：

```
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=30 -t 3 -c:v libx264 -preset ultrafast \
  -progress pipe:1 -nostats out.mp4
```

实测输出（节选，按块重复，每块最后一行是 `progress=continue` 或 `progress=end`）：

```
frame=90
fps=0.00
stream_0_0_q=-1.0
bitrate= 748.4kbits/s
total_size=277555
out_time_us=2966732
out_time_ms=2966732
out_time=00:00:02.966732
dup_frames=0
drop_frames=0
speed=55.5x
progress=end
```

事实：

- **`out_time_ms` 实际是微秒**，与 `out_time_us` 同值。对应源码 `fftools/ffmpeg.c`（提交 f22fcd4483）里两者都由同一个 `pts` 打印：`out_time_us=%PRId64` / `out_time_ms=%PRId64`。解析一律用 `out_time_us`，不要用 `out_time_ms` 除以 1e3。
- 本构建**没有 `-stats_period`**（`ffmpeg -h full` 中不存在该选项）。进度按 ffmpeg 内置统计节流输出（约 0.5s 一块），不要假设可调。
- `progress=end` **不是成功信号**：实测「渲染中往 stdin 写 `q`」后，ffmpeg 正常退出（exit code 0）仍打印 `progress=end`，但输出只有 12.5s（原计划 60s）。成功判定必须叠加「未取消 + exit code 0 + 产物 ffprobe 校验」。
- ETA 的原始量是 `speed`（如 `55.5x`）与 `out_time_us / 时间线总时长`；`speed` 会随滤镜图/磁盘抖动，直接线性外推会跳。

## 2. 取消：优雅关闭 vs 硬杀

同一 1920×1080 / 60s 计划，1.5s 后取消：

| 方式 | 退出码 | 耗时 | 产物 |
| --- | --- | --- | --- |
| 向 stdin 写 `q` | **0** | 1.2–1.7s | **有效 mp4**（moov 已写，时长 12.5s，被截断） |
| 直接 `Process.Kill()`（等价 `child.kill()`） | -1 | 立即 | **不可播**：`moov atom not found` |

- 优雅关闭的可行通道是 **stdin `q`**（ffmpeg 交互命令）。要求：spawn 时给 stdin 管道、**不要加 `-nostdin`**。
- 优雅关闭仍会留下一个「可播放但被截断」的文件；要满足「取消不展示成功成品」，**取消后必须删除**该文件。
- `taskkill /T /F` 是硬杀兜底：`/T` = 终止该进程及其子进程，`/F` = 强制结束（Microsoft Learn taskkill 原文：`/f` "Specifies that processes be forcefully ended"；`/t` "Ends the specified process and any child processes started by it"）。
- Node 官方文档语义：`subprocess.kill()` 只对子进程自身发信号，不保证结束其子进程树；Windows 上 POSIX 信号并不真正存在（SIGTERM/SIGKILL/SIGINT 走的是无条件终止路径）。**未在本次抓取中复核原文段落**，引用 URL 见文末。

## 3. 临时文件与提交

- ffmpeg 靠**输出扩展名**推断容器。实测输出到 `out.partial`：`Unable to find a suitable output format for '...out.partial'`；加 `-f mp4` 后正常。**写 `.partial` 必须显式 `-f mp4`**。
- `-movflags +faststart` 在 muxer 里是**第二遍**：`-h muxer=mp4` 原文 "Run a second pass to put the index (moov atom) at the beginning of the file"。第二遍在转码结束后发生，取消/超时可能落在这一遍里；必须等进程真正退出（exit 事件）再判产物。
- 临时文件必须放**目标同盘同目录**（`fs.rename` 跨盘会失败）；提交 = 等 exit 0 且校验通过后 `.partial` → 正式名。
- 中文输出路径实测可用（`中文目录/成片.mp4` 正常写出并通过 ffprobe）。

## 4. 滤镜内路径的硬约束（实测）

用 `-vf ass=filename=...` 烧录同一份 ASS：

| ASS 路径 | 结果 |
| --- | --- |
| ASCII 无空格 | 通过 |
| ASCII 含空格（加引号） | 通过 |
| **中文绝对路径（有/无空格、转义/不转义）** | **失败**：`Error reinitializing filters! ... Invalid argument`，输出 0 字节 |
| 相对 ASCII 文件名 + `cwd` 为中文目录 | **通过** |

结论（实现约束，非官方保证）：**所有进入滤镜参数的路径（ASS、fontsdir 等）都用「相对 ASCII 文件名 + 设置进程 cwd」**，不要传中文绝对路径。输出路径、输入素材路径不受此限（实测中文输出 OK）。

## 5. 音频混音与变速（本构建实测）

- `amix` 选项只有：`inputs`、`duration`、`dropout_transition`、`weights`。**没有 `normalize` 选项**（新版才有）。
- 归一化行为实测：两个相同的 0.5 幅度正弦源，单路 `mean_volume: -27.1 dB`；`amix=inputs=2` 后仍是 `-27.1 dB`（被除以 2）；`volume=2` 后 `-21.1 dB`；`amix weights=2 2` 仍是 `-27.1 dB`。**weights 不能关掉归一化**。
  - 可行策略：先把每轨拼成与时间线等长的一条流，再混固定 2 路，混后 `volume=2` 补偿；或用 `amerge`+`pan` 求和（未实测）。
- `adelay`：`adelay=500|500`（逐声道毫秒）可用；`adelay=500:all=1` 在本构建实测报错 → 不要用 `all=1`。
- `atempo` 存在（帮助显示范围 0.5–100）；语音变速链式组合需自行保证在范围内。
- AAC 输出：`-c:a aac -b:a 192k`（构建有原生 aac 编码器）。

## 6. 字幕与字体

- 本构建有 `ass` 滤镜且带 `fontsdir` 选项（`ffmpeg -h filter=ass`）；构建含 libass + fontconfig + freetype。
- 仓库**没有任何字体文件**（`apps/desktop/resources` 下无 ttf/otf/ttc）；需求要求随包 Noto Sans SC + ASS `fontsdir`，需在 T19 落地（见讨论 Q8=a）。
- 实测：ASS 用 UTF-8 无 BOM、中文正文、`Microsoft YaHei` 字体名可正常烧录（ASCII 路径下）。
- `fontsdir` 传中文目录名本身没报错（未验证其中字体是否被加载）；稳妥做法仍是相对 ASCII 路径 + cwd。

## 7. 音画同步的可验证性

- 实测样本（`docs/video/14385-256955049_medium.mp4`）：video/audio 两个流 `start_time=0.000000`；video 首包 `pts_time=0.000000`、`dts_time=-0.066733`（B 帧导致负 dts）。**比较起点要比较 `start_time`/`pts`，不要比 dts**。
- `ffprobe -show_entries stream=start_time,duration` 与 `-show_packets`/`-show_frames` 可取客观时间戳。
- 本构建**没有** `axcorrelate`（实测 `Unknown filter`），也没有内置的 A/V 同步检测滤镜；ffmpeg 只负责按时间戳封装，不保证内容级同步。
- 可执行的客观校验：① ffprobe 断言两路 `start_time=0`、时长差 ≤ 1 输出帧、编码/分辨率/帧率符合 RenderConfig；② 测试夹具（彩条 + 已知时刻 beep）抽 PCM（`-f s16le`）后自行检测 onset，与时间线期望比对。

## 8. 本构建的版本陷阱（命令不能用新版写法）

| 项 | 本构建（2018） | 结论 |
| --- | --- | --- |
| `-stats_period` | 无 | 进度节流不可调 |
| `-fps_mode` | 无（只有 `-vsync`） | 用 `-vsync cfr` 或 `fps=30` 滤镜 |
| `amix normalize` | 无 | 必须自己做音量补偿 |
| `axcorrelate` | 无 | 同步检测自己算 |
| `adelay all=1` | 实测报错 | 用逐声道 `delays` |
| `ass` 中文绝对路径 | 实测失败 | 相对 ASCII 路径 + cwd |

## 9. 对本项目 T19 的硬事实（直接可用）

1. 进度：解析 `-progress pipe:1` 的 `out_time_us`（微秒）与 `speed`；`progress=end` 不可作为成功判据。
2. 取消：stdin `q` 优雅（exit 0 + 有效但截断的文件，**必须删除**），3s 内未退出再 `taskkill /T /F`；失败/取消都不提交 `.partial`。
3. 提交：`.partial` 同目录 + `-f mp4` + `+faststart`，等 exit 0 且 ffprobe 校验通过再 rename；中文目标路径可用。
4. 滤镜路径：ASS/fontsdir 用相对 ASCII 文件名并设置 cwd，避免中文绝对路径（实测失败）。
5. 混音：本构建 amix 恒归一化且不能关；先各轨对齐成等长流，再混 2 路 + `volume=2`（或 `amerge`+`pan`）。
6. 字幕：本构建可烧录 ASS，但仓库无字体；随包 Noto Sans SC + OFL 证书 + `fontsdir`。
7. 同步：无内置检测滤镜；用 ffprobe 流/包时间戳 + 夹具 PCM onset 两层校验（1 帧容差）。
8. 版本：所有命令按 2018 构建能力写；升级 ffmpeg 才能用 `-stats_period`/`-fps_mode`/`amix normalize`/`axcorrelate`。

## 来源

- 本机实测：`apps/desktop/resources/ffmpeg/ffmpeg.exe` 与 `ffprobe.exe`（版本 `N-92722-gf22fcd4483`），2026-10-31。命令与输出见上文各节（测试文件位于 `.dsh/tmp-ffmpeg-test`，可重跑）。
- 源码（进度字段）：https://raw.githubusercontent.com/FFmpeg/FFmpeg/f22fcd4483/fftools/ffmpeg.c （`out_time_us`/`out_time_ms` 同值；`received_sigterm`/信号处理）。
- taskkill 官方文档：https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill （`/f` 强制结束；`/t` 结束该进程及其子进程）。
- Node.js `child_process` 文档（kill 语义与 Windows 信号）：https://nodejs.org/api/child_process.html#subprocesskillsignal
- FFmpeg 官方文档（滤镜、muxer 选项）：https://ffmpeg.org/ffmpeg-filters.html 、https://ffmpeg.org/ffmpeg-formats.html
- 未证实项：Node 文档原文段落本次未抓取成功（按官方文档语义转述）；`fontsdir` 在中文目录下字体是否实际加载未验证。
