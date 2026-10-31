import type { ExportExpectedOutput } from '../plan';
import type { ExportProcessRequest } from '../runner';

/** 计划里与同步自检相关的期望字段；直接取自计划编译器的 expected，避免再声明一份。 */
export type ExportProbeExpected = Pick<
  ExportExpectedOutput,
  'audioCodec' | 'durationMs' | 'fps' | 'height' | 'videoCodec' | 'width'
>;

/**
 * 同步自检的探测请求是唯一带 -show_streams 的进程调用。
 * 注入式运行器用它区分“渲染/预混”和“探测 ffprobe”。
 */
export function isProbeRequest(request: ExportProcessRequest): boolean {
  return request.args.includes('-show_streams');
}

/**
 * 假 ffprobe 的正常回答：按导出计划的期望规格生成一份“两路起点 0、时长正好”的 ffprobe JSON。
 * 注入式运行器的成功路径用它回答探测请求，避免测试手写一份和计划可能不同步的 JSON。
 */
export function ffprobeAnswerFor(expected: ExportProbeExpected): string {
  const seconds = (expected.durationMs / 1_000).toFixed(6);
  const frameRate = `${expected.fps}/1`;

  return JSON.stringify({
    format: { duration: seconds },
    streams: [
      {
        avg_frame_rate: frameRate,
        codec_name: expected.videoCodec,
        codec_type: 'video',
        duration: seconds,
        height: expected.height,
        r_frame_rate: frameRate,
        start_time: '0.000000',
        width: expected.width,
      },
      {
        avg_frame_rate: '0/0',
        codec_name: expected.audioCodec,
        codec_type: 'audio',
        duration: seconds,
        r_frame_rate: '0/0',
        start_time: '0.000000',
      },
    ],
  });
}
