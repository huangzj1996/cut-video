/**
 * 金标准 ffprobe JSON。
 *
 * 两段都是本仓库随包 ffprobe（Lavf58.24.101）对真实成片的原始输出，
 * 保持 `-show_streams -show_format -of json` 的字段顺序与格式，未手工改写：
 *
 * - GOLDEN_SYNC_OK_FFPROBE_JSON：两段式渲染的正常成片（1920×1080 / 30fps / h264 + AAC，
 *   两路都是 2.000s、起点 0）。
 * - GOLDEN_SYNC_OFFSET_FFPROBE_JSON：同一成片在渲染时给预混音轨注入 `-itsoffset 0.1` 后的输出。
 *   音频流起点被编码器吸附到 0.078s、时长 1.941333s，正是同步自检必须判失败的真实样本。
 *
 * 单测用它们证明判定是纯函数；真实链路另有 export-integration.test.ts 的端到端用例。
 */

export const GOLDEN_SYNC_OK_FFPROBE_JSON = `{
    "streams": [
        {
            "index": 0,
            "codec_name": "h264",
            "codec_long_name": "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10",
            "profile": "High",
            "codec_type": "video",
            "codec_tag_string": "avc1",
            "codec_tag": "0x31637661",
            "width": 1920,
            "height": 1080,
            "coded_width": 1920,
            "coded_height": 1080,
            "closed_captions": 0,
            "film_grain": 0,
            "has_b_frames": 2,
            "sample_aspect_ratio": "1:1",
            "display_aspect_ratio": "16:9",
            "pix_fmt": "yuv420p",
            "level": 40,
            "chroma_location": "left",
            "field_order": "progressive",
            "refs": 1,
            "is_avc": "true",
            "nal_length_size": "4",
            "id": "0x1",
            "r_frame_rate": "30/1",
            "avg_frame_rate": "30/1",
            "time_base": "1/15360",
            "start_pts": 0,
            "start_time": "0.000000",
            "duration_ts": 30720,
            "duration": "2.000000",
            "bit_rate": "22684",
            "bits_per_raw_sample": "8",
            "nb_frames": "60",
            "extradata_size": 44,
            "disposition": {
                "default": 1,
                "dub": 0,
                "original": 0,
                "comment": 0,
                "lyrics": 0,
                "karaoke": 0,
                "forced": 0,
                "hearing_impaired": 0,
                "visual_impaired": 0,
                "clean_effects": 0,
                "attached_pic": 0,
                "timed_thumbnails": 0,
                "captions": 0,
                "descriptions": 0,
                "metadata": 0,
                "dependent": 0,
                "still_image": 0
            },
            "tags": {
                "language": "und",
                "handler_name": "VideoHandler",
                "vendor_id": "[0][0][0][0]"
            }
        },
        {
            "index": 1,
            "codec_name": "aac",
            "codec_long_name": "AAC (Advanced Audio Coding)",
            "profile": "LC",
            "codec_type": "audio",
            "codec_tag_string": "mp4a",
            "codec_tag": "0x6134706d",
            "sample_fmt": "fltp",
            "sample_rate": "48000",
            "channels": 2,
            "channel_layout": "stereo",
            "bits_per_sample": 0,
            "initial_padding": 0,
            "id": "0x2",
            "r_frame_rate": "0/0",
            "avg_frame_rate": "0/0",
            "time_base": "1/48000",
            "start_pts": 0,
            "start_time": "0.000000",
            "duration_ts": 96000,
            "duration": "2.000000",
            "bit_rate": "103167",
            "nb_frames": "95",
            "extradata_size": 5,
            "disposition": {
                "default": 1,
                "dub": 0,
                "original": 0,
                "comment": 0,
                "lyrics": 0,
                "karaoke": 0,
                "forced": 0,
                "hearing_impaired": 0,
                "visual_impaired": 0,
                "clean_effects": 0,
                "attached_pic": 0,
                "timed_thumbnails": 0,
                "captions": 0,
                "descriptions": 0,
                "metadata": 0,
                "dependent": 0,
                "still_image": 0
            },
            "tags": {
                "language": "und",
                "handler_name": "SoundHandler",
                "vendor_id": "[0][0][0][0]"
            }
        }
    ],
    "format": {
        "filename": "C:\\\\Users\\\\11132\\\\AppData\\\\Local\\\\Temp\\\\sync-golden2-071b3ab8\\\\normal.mp4",
        "nb_streams": 2,
        "nb_programs": 0,
        "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
        "format_long_name": "QuickTime / MOV",
        "start_time": "0.000000",
        "duration": "2.000000",
        "size": "35312",
        "bit_rate": "141248",
        "probe_score": 100,
        "tags": {
            "major_brand": "isom",
            "minor_version": "512",
            "compatible_brands": "isomiso2avc1mp41",
            "encoder": "Lavf58.24.101"
        }
    }
}`;

export const GOLDEN_SYNC_OFFSET_FFPROBE_JSON = `{
    "streams": [
        {
            "index": 0,
            "codec_name": "h264",
            "codec_long_name": "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10",
            "profile": "High",
            "codec_type": "video",
            "codec_tag_string": "avc1",
            "codec_tag": "0x31637661",
            "width": 1920,
            "height": 1080,
            "coded_width": 1920,
            "coded_height": 1080,
            "closed_captions": 0,
            "film_grain": 0,
            "has_b_frames": 2,
            "sample_aspect_ratio": "1:1",
            "display_aspect_ratio": "16:9",
            "pix_fmt": "yuv420p",
            "level": 40,
            "chroma_location": "left",
            "field_order": "progressive",
            "refs": 1,
            "is_avc": "true",
            "nal_length_size": "4",
            "id": "0x1",
            "r_frame_rate": "30/1",
            "avg_frame_rate": "30/1",
            "time_base": "1/15360",
            "start_pts": 0,
            "start_time": "0.000000",
            "duration_ts": 30720,
            "duration": "2.000000",
            "bit_rate": "22684",
            "bits_per_raw_sample": "8",
            "nb_frames": "60",
            "extradata_size": 44,
            "disposition": {
                "default": 1,
                "dub": 0,
                "original": 0,
                "comment": 0,
                "lyrics": 0,
                "karaoke": 0,
                "forced": 0,
                "hearing_impaired": 0,
                "visual_impaired": 0,
                "clean_effects": 0,
                "attached_pic": 0,
                "timed_thumbnails": 0,
                "captions": 0,
                "descriptions": 0,
                "metadata": 0,
                "dependent": 0,
                "still_image": 0
            },
            "tags": {
                "language": "und",
                "handler_name": "VideoHandler",
                "vendor_id": "[0][0][0][0]"
            }
        },
        {
            "index": 1,
            "codec_name": "aac",
            "codec_long_name": "AAC (Advanced Audio Coding)",
            "profile": "LC",
            "codec_type": "audio",
            "codec_tag_string": "mp4a",
            "codec_tag": "0x6134706d",
            "sample_fmt": "fltp",
            "sample_rate": "48000",
            "channels": 2,
            "channel_layout": "stereo",
            "bits_per_sample": 0,
            "initial_padding": 0,
            "id": "0x2",
            "r_frame_rate": "0/0",
            "avg_frame_rate": "0/0",
            "time_base": "1/48000",
            "start_pts": 3744,
            "start_time": "0.078000",
            "duration_ts": 93184,
            "duration": "1.941333",
            "bit_rate": "101975",
            "nb_frames": "91",
            "extradata_size": 5,
            "disposition": {
                "default": 1,
                "dub": 0,
                "original": 0,
                "comment": 0,
                "lyrics": 0,
                "karaoke": 0,
                "forced": 0,
                "hearing_impaired": 0,
                "visual_impaired": 0,
                "clean_effects": 0,
                "attached_pic": 0,
                "timed_thumbnails": 0,
                "captions": 0,
                "descriptions": 0,
                "metadata": 0,
                "dependent": 0,
                "still_image": 0
            },
            "tags": {
                "language": "und",
                "handler_name": "SoundHandler",
                "vendor_id": "[0][0][0][0]"
            }
        }
    ],
    "format": {
        "filename": "C:\\\\Users\\\\11132\\\\AppData\\\\Local\\\\Temp\\\\sync-golden2-071b3ab8\\\\offset.mp4",
        "nb_streams": 2,
        "nb_programs": 0,
        "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
        "format_long_name": "QuickTime / MOV",
        "start_time": "0.000000",
        "duration": "2.019333",
        "size": "33931",
        "bit_rate": "134424",
        "probe_score": 100,
        "tags": {
            "major_brand": "isom",
            "minor_version": "512",
            "compatible_brands": "isomiso2avc1mp41",
            "encoder": "Lavf58.24.101"
        }
    }
}`;

/** 在真实 ffprobe 输出上改字段，用于构造“某个维度不符”的样本；不改变其余字段。 */
export function withFfprobeJson(
  json: string,
  mutate: (output: { format: Record<string, unknown>; streams: Record<string, unknown>[] }) => void,
): string {
  const parsed = JSON.parse(json) as {
    format: Record<string, unknown>;
    streams: Record<string, unknown>[];
  };

  mutate(parsed);

  return JSON.stringify(parsed);
}

/** 取真实 ffprobe 输出里的某一路流，方便测试就地改字段。 */
export function ffprobeStream(json: string, type: 'audio' | 'video'): Record<string, unknown> {
  const parsed = JSON.parse(json) as { streams: Record<string, unknown>[] };
  const stream = parsed.streams.find((candidate) => candidate.codec_type === type);

  if (!stream) {
    throw new Error('ffprobe golden json has no ' + type + ' stream');
  }

  return stream;
}
