import { describe, expect, it } from 'vitest';
import {
  alignMediaElement,
  applySlotSource,
  handleMusicEnded,
  syncAudioElement,
  syncAudioMetadata,
} from './media-sync';
import type { PreviewAudioPlan } from './preview-media';

interface FakeMediaElement {
  currentTime: number;
  dataset: Record<string, string | undefined>;
  loadCalls: number;
  muted: boolean;
  pauseCalls: number;
  paused: boolean;
  playCalls: number;
  playbackRate: number;
  removedAttributes: string[];
  src: string;
  volume: number;
  load: () => void;
  pause: () => void;
  play: () => Promise<void>;
  removeAttribute: (name: string) => void;
}

function createMediaElement(
  overrides: Partial<
    Pick<FakeMediaElement, 'currentTime' | 'muted' | 'paused' | 'playbackRate' | 'volume'>
  > & { assetId?: string } = {},
): FakeMediaElement {
  const element: FakeMediaElement = {
    currentTime: overrides.currentTime ?? 0,
    dataset: overrides.assetId === undefined ? {} : { assetId: overrides.assetId },
    loadCalls: 0,
    muted: overrides.muted ?? false,
    pauseCalls: 0,
    paused: overrides.paused ?? true,
    playCalls: 0,
    playbackRate: overrides.playbackRate ?? 1,
    removedAttributes: [],
    src: '',
    volume: overrides.volume ?? 1,
    load() {
      this.loadCalls += 1;
    },
    pause() {
      this.pauseCalls += 1;
      this.paused = true;
    },
    play() {
      this.playCalls += 1;
      this.paused = false;

      return Promise.resolve();
    },
    removeAttribute(name: string) {
      this.removedAttributes.push(name);
      this.src = '';
    },
  };

  return element;
}

function asMedia<T extends FakeMediaElement>(element: T): HTMLMediaElement {
  return element as unknown as HTMLMediaElement;
}

function audioPlan(overrides: Partial<PreviewAudioPlan> = {}): PreviewAudioPlan {
  return {
    assetId: 'audio-1',
    clipId: 'clip-1',
    endSeconds: 5,
    isMock: false,
    loop: false,
    playbackRate: 1,
    sourceEndSeconds: 4,
    sourceSeconds: 1.5,
    startSeconds: 0,
    volume: 1,
    ...overrides,
  };
}

describe('alignMediaElement', () => {
  it('corrects a playing element that drifts more than 50ms from the master clock', () => {
    const element = createMediaElement({ currentTime: 1, paused: false });

    alignMediaElement(asMedia(element), 1.2, true);

    expect(element.currentTime).toBe(1.2);
    // 已在播放，校正只 seek，不重复调用 play。
    expect(element.playCalls).toBe(0);
  });

  it('leaves a playing element alone while it stays within 50ms', () => {
    const element = createMediaElement({ currentTime: 1, paused: false });

    alignMediaElement(asMedia(element), 1.05, true);

    expect(element.currentTime).toBe(1);
    expect(element.playCalls).toBe(0);
    expect(element.pauseCalls).toBe(0);
  });

  it('always seeks when paused so scrubbing and pausing share one time point', () => {
    const element = createMediaElement({ currentTime: 5, paused: false });

    alignMediaElement(asMedia(element), 2, false);

    expect(element.currentTime).toBe(2);
    expect(element.pauseCalls).toBe(1);
  });

  it('starts an already aligned but paused element when playback begins', () => {
    const element = createMediaElement({ currentTime: 2, paused: true });

    alignMediaElement(asMedia(element), 2, true);

    expect(element.playCalls).toBe(1);
  });
});

describe('applySlotSource', () => {
  it('loads a new asset into the slot', () => {
    const element = createMediaElement({ assetId: 'old-asset' });

    applySlotSource(asMedia(element) as HTMLVideoElement, 'new-asset', 'project-1');

    expect(element.dataset.assetId).toBe('new-asset');
    expect(element.src).toBe('asset://project-1/new-asset');
    expect(element.loadCalls).toBe(1);
  });

  it('reuses the element when the asset is unchanged', () => {
    const element = createMediaElement({ assetId: 'same-asset' });
    element.src = 'asset://project-1/same-asset';

    applySlotSource(asMedia(element) as HTMLVideoElement, 'same-asset', 'project-1');

    expect(element.loadCalls).toBe(0);
  });

  it('clears the source when the slot has no asset', () => {
    const element = createMediaElement({ assetId: 'old-asset' });
    element.src = 'asset://project-1/old-asset';

    applySlotSource(asMedia(element) as HTMLVideoElement, null, 'project-1');

    expect(element.dataset.assetId).toBeUndefined();
    expect(element.removedAttributes).toEqual(['src']);
    expect(element.loadCalls).toBe(1);
  });
});

describe('syncAudioElement', () => {
  it('pauses and ignores a missing clip plan', () => {
    const element = createMediaElement({ paused: false });

    const reloaded = syncAudioElement(
      asMedia(element) as HTMLAudioElement,
      null,
      'project-1',
      false,
      true,
    );

    expect(reloaded).toBe(false);
    expect(element.pauseCalls).toBe(1);
    expect(element.loadCalls).toBe(0);
  });

  it('loads a new asset, applies mute/volume/rate, and starts playback', () => {
    const element = createMediaElement({ paused: true });

    const reloaded = syncAudioElement(
      asMedia(element) as HTMLAudioElement,
      audioPlan({ playbackRate: 1.5, volume: 0.4 }),
      'project-1',
      true,
      true,
    );

    expect(reloaded).toBe(true);
    expect(element.dataset.assetId).toBe('audio-1');
    expect(element.src).toBe('asset://project-1/audio-1');
    expect(element.loadCalls).toBe(1);
    expect(element.muted).toBe(true);
    expect(element.volume).toBe(0.4);
    expect(element.playbackRate).toBe(1.5);
    expect(element.playCalls).toBe(1);
    // 新来源的定位交给 loadedmetadata，避免元数据就绪前 seek 被忽略。
    expect(element.currentTime).toBe(0);
  });

  it('aligns an already loaded asset to the clip source time', () => {
    const element = createMediaElement({ assetId: 'audio-1', currentTime: 1, paused: false });

    const reloaded = syncAudioElement(
      asMedia(element) as HTMLAudioElement,
      audioPlan({ sourceSeconds: 1.4, volume: 0.6 }),
      'project-1',
      false,
      true,
    );

    expect(reloaded).toBe(false);
    expect(element.loadCalls).toBe(0);
    expect(element.currentTime).toBe(1.4);
    expect(element.volume).toBe(0.6);
    expect(element.paused).toBe(false);
  });

  it('pauses once a non-looping clip reaches its source end', () => {
    const element = createMediaElement({ assetId: 'audio-1', paused: false });

    const reloaded = syncAudioElement(
      asMedia(element) as HTMLAudioElement,
      audioPlan({ sourceSeconds: 4, sourceEndSeconds: 4 }),
      'project-1',
      false,
      true,
    );

    expect(reloaded).toBe(false);
    expect(element.pauseCalls).toBe(1);
    expect(element.playCalls).toBe(0);
  });
});

describe('syncAudioMetadata', () => {
  it('seeks, applies the rate, and plays when metadata arrives mid-playback', () => {
    const element = createMediaElement({ currentTime: 0, paused: true });

    syncAudioMetadata(asMedia(element) as HTMLAudioElement, audioPlan({ playbackRate: 2 }), true);

    expect(element.currentTime).toBe(1.5);
    expect(element.playbackRate).toBe(2);
    expect(element.playCalls).toBe(1);
  });

  it('does not start playback when the clip is already past its source end', () => {
    const element = createMediaElement();

    syncAudioMetadata(
      asMedia(element) as HTMLAudioElement,
      audioPlan({ sourceSeconds: 4, sourceEndSeconds: 4 }),
      true,
    );

    expect(element.playCalls).toBe(0);
  });

  it('does nothing without a plan', () => {
    const element = createMediaElement({ currentTime: 3 });

    syncAudioMetadata(asMedia(element) as HTMLAudioElement, null, true);

    expect(element.currentTime).toBe(3);
    expect(element.playCalls).toBe(0);
  });
});

describe('handleMusicEnded', () => {
  it('restarts a looping clip at the mapped source time', () => {
    const element = createMediaElement({ assetId: 'music-1', paused: true });

    handleMusicEnded(
      asMedia(element) as HTMLAudioElement,
      audioPlan({ assetId: 'music-1', loop: true, sourceSeconds: 0.5 }),
      true,
    );

    expect(element.currentTime).toBe(0.5);
    expect(element.playCalls).toBe(1);
  });

  it('stays paused for non-looping music', () => {
    const element = createMediaElement({ assetId: 'music-1', paused: false });

    handleMusicEnded(
      asMedia(element) as HTMLAudioElement,
      audioPlan({ assetId: 'music-1', loop: false }),
      true,
    );

    expect(element.pauseCalls).toBe(1);
    expect(element.playCalls).toBe(0);
  });

  it('ignores the ended event from a stale asset', () => {
    const element = createMediaElement({ assetId: 'old-music', paused: false });

    handleMusicEnded(
      asMedia(element) as HTMLAudioElement,
      audioPlan({ assetId: 'music-1', loop: true }),
      true,
    );

    expect(element.pauseCalls).toBe(1);
    expect(element.currentTime).toBe(0);
  });

  it('does not resume a looping clip while the timeline is paused', () => {
    const element = createMediaElement({ assetId: 'music-1', paused: true });

    handleMusicEnded(
      asMedia(element) as HTMLAudioElement,
      audioPlan({ assetId: 'music-1', loop: true, sourceSeconds: 0.5 }),
      false,
    );

    expect(element.currentTime).toBe(0.5);
    expect(element.playCalls).toBe(0);
  });
});
