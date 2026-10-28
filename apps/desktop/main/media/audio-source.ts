import path from 'node:path';
import type { StoredProject } from '@miaoma/video-project';
import { mimeTypeForPath } from './asset-protocol';

/**
 * 波形读取：主进程按工程资产白名单找到音频文件，只把字节交给渲染进程解码。
 *
 * 渲染进程不接触真实文件路径，也不为波形重开媒体协议；这里只允许配音与音乐素材，
 * 并对文件大小设上限，避免把超大文件一次性塞进 IPC。
 */

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * 单条音频最大 16MB；波形只为显示服务，超过时回退静态占位，
 * 避免把超长音频送进渲染进程解码造成内存峰值。
 */
export const MAX_AUDIO_SOURCE_BYTES = 16 * 1024 * 1024;

export type AudioSourceProject = Pick<StoredProject, 'assets'>;

export type AudioSourceRejectionCode = 'MEDIA_AUDIO_NOT_FOUND' | 'MEDIA_AUDIO_TOO_LARGE';

export interface AudioSourceFileStat {
  isFile: boolean;
  size: number;
}

export type AudioSourcePlan =
  | { mimeType: string; ok: true; filePath: string }
  | { code: AudioSourceRejectionCode; message: string; ok: false };

export interface AudioSourcePlanInput {
  assetId: string;
  project: AudioSourceProject;
  stat(filePath: string): AudioSourceFileStat | null;
}

/** 只在 voices / music 中查找；字幕与缩略图没有可解码的音频。 */
function findAudioAsset(project: AudioSourceProject, assetId: string) {
  return [...project.assets.voices, ...project.assets.music].find((asset) => asset.id === assetId);
}

export function planAudioSourceRead(input: AudioSourcePlanInput): AudioSourcePlan {
  if (!ID_PATTERN.test(input.assetId)) {
    return { code: 'MEDIA_AUDIO_NOT_FOUND', message: '音频素材无效。', ok: false };
  }

  const asset = findAudioAsset(input.project, input.assetId);

  if (!asset || !path.isAbsolute(asset.path)) {
    return { code: 'MEDIA_AUDIO_NOT_FOUND', message: '音频素材不存在或未登记。', ok: false };
  }

  let stat: AudioSourceFileStat | null;

  try {
    stat = input.stat(asset.path);
  } catch {
    stat = null;
  }

  if (!stat || !stat.isFile) {
    return { code: 'MEDIA_AUDIO_NOT_FOUND', message: '音频文件缺失。', ok: false };
  }

  if (stat.size > MAX_AUDIO_SOURCE_BYTES) {
    return {
      code: 'MEDIA_AUDIO_TOO_LARGE',
      message: '音频素材过大，暂不生成波形。',
      ok: false,
    };
  }

  return {
    filePath: asset.path,
    mimeType: mimeTypeForPath(asset.path),
    ok: true,
  };
}
