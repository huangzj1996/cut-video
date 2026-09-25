import { useLayoutEffect, useRef, useState } from 'react';
import { SUBTITLE_PRESETS } from '../../constants/subtitle';
import type { SubtitleOverlayProps } from '../../types/preview';

export function SubtitleOverlay({ scene, settings }: SubtitleOverlayProps) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [previewFontSize, setPreviewFontSize] = useState(settings.fontSize);

  useLayoutEffect(() => {
    const text = textRef.current;
    const frame = text?.parentElement?.parentElement;
    if (!text || !frame || !settings.visible) {
      return;
    }

    const fitText = () => {
      const availableHeight = frame.clientHeight * 0.84;
      if (!availableHeight) {
        return;
      }

      let smallest = 12;
      let largest = settings.fontSize;
      let fitted = smallest;
      while (smallest <= largest) {
        const candidate = Math.floor((smallest + largest) / 2);
        text.style.fontSize = `${candidate}px`;
        if (text.getBoundingClientRect().height <= availableHeight) {
          fitted = candidate;
          smallest = candidate + 1;
        } else {
          largest = candidate - 1;
        }
      }
      text.style.fontSize = `${fitted}px`;
      setPreviewFontSize(fitted);
    };

    fitText();
    const observer = new ResizeObserver(fitText);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [scene, settings.fontSize, settings.visible]);

  if (!settings.visible) {
    return null;
  }

  const preset = SUBTITLE_PRESETS.find((item) => item.id === settings.presetId) ?? SUBTITLE_PRESETS[0];
  const outlineWidth = Math.max(2, Math.round(settings.fontSize / 14));

  return (
    <div className="pointer-events-none absolute bottom-[8%] left-1/2 w-[85%] -translate-x-1/2 text-center" aria-label="字幕预览">
      <p
        ref={textRef}
        className="m-0 whitespace-pre-line break-words font-black"
        style={{
          color: preset.textColor,
          fontSize: previewFontSize,
          lineHeight: 1.25,
          WebkitTextStroke: `${outlineWidth}px ${preset.outlineColor}`,
          paintOrder: 'stroke fill',
        }}
      >
        {scene.lines.join('\n')}
      </p>
    </div>
  );
}
