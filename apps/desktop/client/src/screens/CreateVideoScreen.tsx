import { useCallback, useEffect, useRef, useState } from 'react';
import { VOICE_PRESETS, type VoicePresetId } from '@miaoma/video-project';
import { unwrapIpc } from '../lib/ipc';
import { EditorIcon } from './editor-icons';
import './create-video.css';

const MAX_SCRIPT_LENGTH = 10_000;

const DEFAULT_VOICE = VOICE_PRESETS[0]!;

export function CreateVideoScreen() {
  const [script, setScript] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState<VoicePresetId>(DEFAULT_VOICE.id);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [assetPath, setAssetPath] = useState('');
  const voiceRef = useRef<HTMLDivElement>(null);
  const noticeTimer = useRef<number | null>(null);

  const selectedVoice =
    VOICE_PRESETS.find((preset) => preset.id === selectedVoiceId) ?? DEFAULT_VOICE;

  const notify = useCallback((message: string) => {
    setNotice(message);

    if (noticeTimer.current !== null) {
      window.clearTimeout(noticeTimer.current);
    }

    noticeTimer.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimer.current = null;
    }, 2400);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimer.current !== null) {
        window.clearTimeout(noticeTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!voiceOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!voiceRef.current?.contains(event.target as Node)) {
        setVoiceOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [voiceOpen]);

  const handleCreate = useCallback(async () => {
    const trimmed = script.trim();

    if (!trimmed) {
      notify('请先输入视频文稿');
      return;
    }

    if (creating) {
      return;
    }

    setCreating(true);

    try {
      if (!window.miaoma?.project) {
        notify('Preload 桥接未加载，无法创建项目。');
        return;
      }

      const name = trimmed.split(/\r?\n/, 1)[0]?.trim().slice(0, 40) || '未命名创作';
      const normalizedAssetPath = assetPath.trim() || undefined;
      const project = unwrapIpc(
        await window.miaoma.project.create({
          assetPath: normalizedAssetPath,
          creation: {
            script: trimmed,
            voicePresetId: selectedVoiceId,
            ...(normalizedAssetPath ? { assetPath: normalizedAssetPath } : {}),
          },
          name,
        }),
      );

      window.location.hash = `#/create-chat/${project.project.projectId}`;
    } catch (error) {
      notify(error instanceof Error ? error.message : '创建项目失败。');
    } finally {
      setCreating(false);
    }
  }, [assetPath, creating, notify, script, selectedVoiceId]);

  return (
    <div className="cr-main">
      <div aria-hidden="true" className="cr-ambient cr-ambient--purple" />
      <div aria-hidden="true" className="cr-ambient cr-ambient--cyan" />

      <div className="cr-content">
        <header className="cr-title">
          <h1 className="cr-title-line">
            <span>让文字</span>
            <span className="cr-title-gradient">赴一场光影之约</span>
          </h1>
          <p className="cr-subtitle">顷刻成帧，每一种表达都自有回响</p>
        </header>

        <section aria-label="创作输入" className="cr-panel">
          <div aria-label="创作方式" className="cr-mode-tabs" role="group">
            <button aria-pressed="true" className="cr-mode-tab cr-mode-tab--active" type="button">
              输入文稿
            </button>
            <button
              aria-pressed="false"
              className="cr-mode-tab"
              disabled
              title="上传口播音频将在后续版本开放"
              type="button"
            >
              上传口播音频
            </button>
          </div>

          <textarea
            aria-describedby="cr-script-count"
            aria-label="视频文稿"
            className="cr-script"
            maxLength={MAX_SCRIPT_LENGTH}
            placeholder="输入/粘贴视频文稿，为你生成精彩视频"
            value={script}
            onChange={(event) => setScript(event.target.value)}
          />

          <div aria-live="polite" className="cr-counter" id="cr-script-count">
            {script.length} / {MAX_SCRIPT_LENGTH}
          </div>

          <div className="cr-assets">
            <input
              aria-label="本机视频素材路径"
              className="cr-assets-input"
              disabled={creating}
              onChange={(event) => setAssetPath(event.target.value)}
              placeholder="输入本机视频素材目录或文件路径"
              spellCheck={false}
              type="text"
              value={assetPath}
            />
            {assetPath.trim() ? (
              <button
                className="cr-assets-clear"
                disabled={creating}
                type="button"
                onClick={() => setAssetPath('')}
              >
                清空
              </button>
            ) : null}
          </div>

          <div className="cr-voice" ref={voiceRef}>
            <button
              aria-expanded={voiceOpen}
              aria-haspopup="listbox"
              aria-label={`配音音色：${selectedVoice.name}`}
              className="cr-voice-trigger"
              type="button"
              onClick={() => setVoiceOpen((open) => !open)}
            >
              <span className="cr-voice-current">
                <span className="cr-voice-field">配音</span>
                <span className="cr-voice-value">{selectedVoice.name}</span>
              </span>
              <EditorIcon name={voiceOpen ? 'chevron-up' : 'chevron-down'} size={16} />
            </button>

            {voiceOpen ? (
              <div aria-label="选择配音音色" className="cr-voice-menu" role="listbox">
                {VOICE_PRESETS.map((preset) => {
                  const active = preset.id === selectedVoiceId;

                  return (
                    <button
                      aria-selected={active}
                      className={`cr-voice-option${active ? ' is-active' : ''}`}
                      key={preset.id}
                      role="option"
                      type="button"
                      onClick={() => {
                        setSelectedVoiceId(preset.id);
                        setVoiceOpen(false);
                      }}
                    >
                      <span className="cr-voice-option-copy">
                        <span className="cr-voice-option-name">{preset.name}</span>
                        <span className="cr-voice-option-desc">{preset.description}</span>
                      </span>
                      {active ? (
                        <EditorIcon name="check" size={16} />
                      ) : (
                        <span aria-hidden="true" className="cr-voice-option-placeholder" />
                      )}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <button
            className="cr-create"
            disabled={creating}
            type="button"
            onClick={() => {
              void handleCreate();
            }}
          >
            <EditorIcon name="sparkles" size={21} />
            <span>{creating ? '创建中…' : '创建'}</span>
          </button>
        </section>
      </div>

      {notice ? (
        <div className="cr-toast" role="status">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
