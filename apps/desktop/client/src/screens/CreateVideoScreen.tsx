import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceClip } from '@miaoma/video-project';
import brandMarkUrl from '../assets/brand-mark.png';
import { unwrapIpc } from '../lib/ipc';
import { EditorIcon } from './editor-icons';
import './create-video.css';

const MAX_SCRIPT_LENGTH = 10_000;

interface VoicePreset {
  description: string;
  id: VoiceClip['voicePreset'];
  name: string;
}

const VOICE_PRESETS: readonly VoicePreset[] = [
  { description: '柔和亲切 · 适合知识口播', id: 'wenrou-xuejie', name: '温婉学姐' },
  { description: '清晰正式 · 适合资讯解说', id: 'xinwen-bobao', name: '新闻播报' },
  { description: '低沉可靠 · 适合商业叙事', id: 'chenwen-nansheng', name: '沉稳男声' },
  { description: '明快有力 · 适合教程种草', id: 'huoli-jiangjie', name: '活力讲解' },
];

const DEFAULT_VOICE = VOICE_PRESETS[0]!;

export function CreateVideoScreen() {
  const [script, setScript] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState<VoiceClip['voicePreset']>(
    DEFAULT_VOICE.id,
  );
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
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
      if (window.miaoma?.project) {
        const name = trimmed.split(/\r?\n/, 1)[0]?.trim().slice(0, 40) || '未命名创作';
        unwrapIpc(await window.miaoma.project.create({ name }));
      }

      window.location.hash = '#/create-chat';
    } catch (error) {
      notify(error instanceof Error ? error.message : '创建项目失败。');
    } finally {
      setCreating(false);
    }
  }, [creating, notify, script]);

  return (
    <div className="create-screen">
      <aside className="cr-sidebar">
        <div aria-hidden="true" className="cr-sidebar-glow" />
        <div aria-hidden="true" className="cr-sidebar-band" />

        <button
          className="cr-brand"
          type="button"
          onClick={() => {
            window.location.hash = '#/status';
          }}
        >
          <img alt="" className="cr-brand-mark" src={brandMarkUrl} />
          <span className="cr-brand-copy">
            <strong>妙剪 Magicut</strong>
            <small>智能视频剪辑工具</small>
          </span>
        </button>

        <nav aria-label="主导航" className="cr-capsule">
          <button className="cr-nav-item" disabled title="后续任务" type="button">
            <span className="cr-nav-icon">
              <EditorIcon name="home" size={20} />
            </span>
            <span className="cr-nav-label">首页</span>
          </button>

          <button aria-current="page" className="cr-nav-item cr-nav-item--active" type="button">
            <span className="cr-nav-icon">
              <EditorIcon name="scissors" size={22} />
            </span>
            <span className="cr-nav-label">创作</span>
          </button>

          <button
            className="cr-nav-item"
            type="button"
            onClick={() => {
              window.location.hash = '#/workspace';
            }}
          >
            <span className="cr-nav-icon">
              <EditorIcon name="folder" size={20} />
            </span>
            <span className="cr-nav-label">项目</span>
          </button>
        </nav>
      </aside>

      <main className="cr-main">
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
      </main>
    </div>
  );
}
