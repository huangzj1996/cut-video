/**
 * 模拟预览层。
 *
 * 组件只接收当前时间与时间线片段，内部自行决定要显示什么；后续接入真实
 * 视频时，把内部实现替换为 <video> 并按 currentTime seek 即可，父组件和
 * 时间线交互都不需要改动。
 */
import { formatTime, resolvePreviewFrame, type TimelineClip } from './timeline';

interface PreviewStageProps {
  clips: readonly TimelineClip[];
  currentTime: number;
  projectSeconds: number;
}

export function PreviewStage({ clips, currentTime, projectSeconds }: PreviewStageProps) {
  const frame = resolvePreviewFrame(currentTime, clips, projectSeconds);

  if (frame.kind === 'empty') {
    return (
      <div aria-label="视频预览：空白区域" className="ed-preview ed-preview--empty" role="img" />
    );
  }

  const { clip, frameIndex, localSeconds } = frame;
  const clipDuration = Math.max(0.001, clip.endSeconds - clip.startSeconds);
  const progress = Math.min(1, Math.max(0, localSeconds / clipDuration));

  return (
    <div
      aria-label={`视频预览：${clip.label}，${formatTime(currentTime)}`}
      className="ed-preview"
      role="img"
    >
      <div
        className="ed-preview-frame"
        style={{
          background: `radial-gradient(120% 120% at 72% 16%, ${clip.background} 0%, #0a0b0e 74%)`,
        }}
      >
        <span className="ed-preview-badge">模拟预览</span>
        <span className="ed-preview-clip">{clip.label}</span>
        <span className="ed-preview-frame-time">{formatTime(currentTime)}</span>
        <span className="ed-preview-frame-index">FRAME {String(frameIndex).padStart(4, '0')}</span>
        <span aria-hidden="true" className="ed-preview-progress">
          <span style={{ background: clip.accent, width: `${progress * 100}%` }} />
        </span>
      </div>
    </div>
  );
}
