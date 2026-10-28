/**
 * `<video>`/`<audio>` 元素与主时钟之间的同步原语。
 *
 * 这里只操作传入的媒体元素，不持有 React 状态，因此可以在单测里用假元素
 * 直接验证 seek、播放状态、音量/倍速和音乐循环的行为。预览组件负责在
 * 正确的时机调用这些函数。
 */
import { assetUrl } from '../../lib/media';
import { needsDriftCorrection } from './playback';
import { audioReachedSourceEnd, type PreviewAudioPlan } from './preview-media';

/** 元数据尚未就绪时设置 currentTime 会被忽略，返回 false 让调用方等待 loadedmetadata。 */
export function seekMediaElement(element: HTMLMediaElement, seconds: number): boolean {
  try {
    element.currentTime = seconds;
    return true;
  } catch {
    return false;
  }
}

export function pauseMediaElement(element: HTMLMediaElement): void {
  if (!element.paused) {
    element.pause();
  }
}

export function syncMediaPlayState(element: HTMLMediaElement, playing: boolean): void {
  if (!playing) {
    pauseMediaElement(element);
    return;
  }

  if (element.paused) {
    void element.play().catch(() => {
      // 自动播放/解码失败由 onError 呈现为占位说明。
    });
  }
}

/** 暂停或偏差超过阈值时对齐到主时钟，然后同步播放状态。 */
export function alignMediaElement(
  element: HTMLMediaElement,
  sourceSeconds: number,
  playing: boolean,
): void {
  if (!playing || needsDriftCorrection(sourceSeconds, element.currentTime)) {
    seekMediaElement(element, sourceSeconds);
  }

  syncMediaPlayState(element, playing);
}

export function loadMediaSource(
  element: HTMLMediaElement,
  assetId: string,
  projectId: string,
): void {
  element.dataset.assetId = assetId;
  element.src = assetUrl(projectId, assetId);
  element.load();
}

type PlayableSlot = { assetId: string | null };

export function applySlotSource(
  element: HTMLVideoElement | null,
  slot: PlayableSlot,
  projectId: string,
): void {
  if (!element) {
    return;
  }

  if (!slot.assetId) {
    if (element.dataset.assetId) {
      delete element.dataset.assetId;
      element.removeAttribute('src');
      element.load();
    }

    return;
  }

  if (element.dataset.assetId !== slot.assetId) {
    loadMediaSource(element, slot.assetId, projectId);
  }
}

/** 对齐并播放音频元素；返回值表示 source 是否刚被重新加载（用于清掉旧错误）。 */
export function syncAudioElement(
  element: HTMLAudioElement | null,
  plan: PreviewAudioPlan | null,
  projectId: string,
  muted: boolean,
  playing: boolean,
): boolean {
  if (!element) {
    return false;
  }

  if (!plan) {
    pauseMediaElement(element);
    return false;
  }

  const sourceChanged = element.dataset.assetId !== plan.assetId;

  if (sourceChanged) {
    loadMediaSource(element, plan.assetId, projectId);
  }

  element.muted = muted;
  element.volume = plan.volume;
  element.playbackRate = plan.playbackRate;

  if (audioReachedSourceEnd(plan)) {
    pauseMediaElement(element);
    return false;
  }

  if (sourceChanged) {
    syncMediaPlayState(element, playing);
  } else {
    alignMediaElement(element, plan.sourceSeconds, playing);
  }

  return sourceChanged;
}

/** 新来源的元数据就绪后再定位：此时设置 currentTime 才不会被浏览器忽略。 */
export function syncAudioMetadata(
  element: HTMLAudioElement | null,
  plan: PreviewAudioPlan | null,
  playing: boolean,
): void {
  if (!element || !plan || !seekMediaElement(element, plan.sourceSeconds)) {
    return;
  }

  element.playbackRate = plan.playbackRate;

  if (playing && !audioReachedSourceEnd(plan)) {
    void element.play().catch(() => {
      // 解码失败由 onError 呈现。
    });
  }
}

/**
 * 循环音乐播放到素材末尾时，按当前映射的 source 时间重新开始；
 * 非循环、素材已切换或时间线已暂停时保持暂停。
 */
export function handleMusicEnded(
  element: HTMLAudioElement | null,
  plan: PreviewAudioPlan | null,
  playing: boolean,
): void {
  if (!element) {
    return;
  }

  if (!plan || !plan.loop || element.dataset.assetId !== plan.assetId) {
    pauseMediaElement(element);
    return;
  }

  if (!seekMediaElement(element, plan.sourceSeconds)) {
    return;
  }

  if (playing) {
    void element.play().catch(() => {
      // 循环失败时保持暂停，状态仍由主时钟控制。
    });
  }
}
