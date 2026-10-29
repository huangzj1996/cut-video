# 内置本地音乐库

应用启动后，编辑器「音乐」面板从这里读取可用的背景音乐。为避免仓库体积和版权问题，
**音频文件与 `song.json` 清单不提交仓库**（见仓库根 `.gitignore`），只保留本说明与
`song.example.json`。

## 目录结构

```text
resources/assets/song/
├── song.json          # 音乐库清单（不入库）
├── song.example.json  # 清单格式示例（入库）
├── README.md
└── *.m4a / *.mp3 / *.wav
```

开发态读取 `apps/desktop/resources/assets/song/`；打包态读取安装目录的
`resources/assets/song/`（`forge.config.ts` 的 `extraResource` 会把整个
`resources/assets` 带入安装包）。

## song.json 格式

```json
{
  "sort": "created_at_ascending",
  "items": [
    {
      "order": 1,
      "fileName": "示例音乐.m4a",
      "title": "示例音乐",
      "description": "平静｜适合社会题材｜偏慢｜02:01",
      "mood": "平静",
      "scenes": ["社会题材"],
      "tempo": "偏慢",
      "duration": "02:01"
    }
  ]
}
```

字段说明：

- `order`：列表排序，越小越靠前；缺失时按数组顺序。
- `fileName`：相对本目录的音频文件名，支持中文与空格。
- `title`：面板展示的曲名；缺失时回退为文件名。
- `description` / `mood` / `scenes` / `tempo`：展示用元数据。
- `duration`：展示用时长文案；**片段边界以 ffprobe 探测的精确毫秒为准**。

音频文件缺失或无法探测时，面板只禁用对应曲目并标注原因，不影响其他曲目和编辑器。
