import { useEffect, useState } from 'react';
import { decodeAudioChannels, loadWaveformPeaks } from './waveform';

/**
 * 时间线波形的 React 接缝：按 assetId 读取并解码音频，模块级缓存保证
 * 同一素材只解码一次；解码失败缓存为 null，界面回退到静态占位。
 */
export type AudioWaveformMap = ReadonlyMap<string, Float32Array | null>;

const waveformCache = new Map<string, Promise<Float32Array | null>>();

async function readAudioBase64(projectId: string, assetId: string): Promise<string | null> {
  const media = window.miaoma?.media;

  if (!media) {
    return null;
  }

  try {
    const response = await media.readAudio({ assetId, projectId });

    return response.ok ? response.data.base64 : null;
  } catch {
    return null;
  }
}

function loadCachedWaveform(projectId: string, assetId: string): Promise<Float32Array | null> {
  const cacheKey = `${projectId}:${assetId}`;
  const cached = waveformCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const pending = loadWaveformPeaks(
    assetId,
    (id) => readAudioBase64(projectId, id),
    decodeAudioChannels,
  );

  waveformCache.set(cacheKey, pending);

  return pending;
}

/**
 * 读取一组音频素材的峰值波形。`enabled` 为 false（波形开关关闭）时不读取，
 * 避免为用户不看的素材做解码。
 */
export function useAudioWaveforms(
  projectId: string,
  assetIds: readonly string[],
  enabled: boolean,
): AudioWaveformMap {
  const [waveforms, setWaveforms] = useState<AudioWaveformMap>(() => new Map());
  const assetKey = assetIds.slice().sort().join('|');

  useEffect(() => {
    if (!enabled || assetKey.length === 0) {
      return;
    }

    let cancelled = false;

    for (const assetId of assetKey.split('|')) {
      void loadCachedWaveform(projectId, assetId).then((peaks) => {
        if (cancelled) {
          return;
        }

        setWaveforms((previous) =>
          previous.has(assetId) ? previous : new Map(previous).set(assetId, peaks),
        );
      });
    }

    return () => {
      cancelled = true;
    };
  }, [assetKey, enabled, projectId]);

  return waveforms;
}
