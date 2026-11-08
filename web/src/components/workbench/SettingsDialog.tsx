import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useWorkbench } from '../../store';
import { api } from '../../api';
import type { AudioHealth } from '../../types';
import { AudioLines, Trash2, Upload } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

type LimitKey = 'concurrency' | 'dailyCap' | 'maxBatch';

const LIMIT_FIELDS: { key: LimitKey; label: string; min: number; max: number }[] = [
  { key: 'concurrency', label: '并发数', min: 1, max: 8 },
  { key: 'dailyCap', label: '每日生成上限', min: 1, max: 10000 },
  { key: 'maxBatch', label: '单次批量上限', min: 1, max: 500 },
];

function parseIntInRange(raw: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
}

export function SettingsDialog() {
  const open = useWorkbench((s) => s.settingsOpen);
  const setOpen = useWorkbench((s) => s.setSettingsOpen);
  const settings = useWorkbench((s) => s.settings);
  const saveSettings = useWorkbench((s) => s.saveSettings);
  const uploadVoice = useWorkbench((s) => s.uploadVoice);
  const removeVoice = useWorkbench((s) => s.removeVoice);
  const busy = useWorkbench((s) => s.busy === 'settings');

  const [model, setModel] = useState('');
  const [lang, setLang] = useState<'en' | 'zh'>('zh');
  const [key, setKey] = useState('');
  const [limits, setLimits] = useState<Record<LimitKey, string>>({
    concurrency: '',
    dailyCap: '',
    maxBatch: '',
  });
  const [audioBaseUrl, setAudioBaseUrl] = useState('');
  const [health, setHealth] = useState<AudioHealth | null>(null);
  const [checking, setChecking] = useState(false);
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const voiceFileRef = useRef<HTMLInputElement>(null);

  const checkAudio = async (url: string) => {
    setChecking(true);
    try {
      const res = await api<AudioHealth>(
        `/api/audio/health?baseUrl=${encodeURIComponent(url.trim())}`,
      );
      setHealth(res);
    } catch (error) {
      setHealth({ ok: false, error: (error as Error).message });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setKey('');
      return;
    }
    if (settings) {
      setModel(settings.imageModel);
      setLang(settings.promptLang);
      setLimits({
        concurrency: String(settings.concurrency),
        dailyCap: String(settings.dailyCap),
        maxBatch: String(settings.maxBatch),
      });
      setAudioBaseUrl(settings.audio.baseUrl);
      void checkAudio(settings.audio.baseUrl);
    }
    // 只在打开或设置重新读取时同步表单
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings]);

  const pickVoice = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploadingVoice(true);
    try {
      await uploadVoice(file);
    } finally {
      setUploadingVoice(false);
    }
  };

  const dropVoice = async () => {
    if (!window.confirm('移除当前参考音色？之后需要重新上传才能生成音频。')) return;
    await removeVoice();
  };

  if (!open) return null;

  const parsedLimits = Object.fromEntries(
    LIMIT_FIELDS.map((field) => [field.key, parseIntInRange(limits[field.key], field.min, field.max)]),
  ) as Record<LimitKey, number | null>;
  const limitsValid = LIMIT_FIELDS.every((field) => parsedLimits[field.key] !== null);

  const close = () => {
    if (busy) return;
    setOpen(false);
  };

  const connected = settings?.provider === 'aiclone' && settings.hasKey;
  const statusText = !settings
    ? '正在读取设置…'
    : settings.provider === 'aiclone'
      ? connected
        ? 'AIClone · Key 已配置'
        : 'AIClone · 未配置 Key'
      : settings.provider === 'openai'
        ? 'OpenAI 兼容端点'
        : '本地占位图 · 保存后切到 AIClone';

  const submit = async () => {
    if (!settings || !model || !limitsValid) return;
    const patch: {
      provider: string;
      imageModel: string;
      promptLang: 'en' | 'zh';
      apiKey?: string;
      concurrency: number;
      dailyCap: number;
      maxBatch: number;
      audioBaseUrl: string;
    } = {
      provider: 'aiclone',
      imageModel: model,
      promptLang: lang,
      concurrency: parsedLimits.concurrency!,
      dailyCap: parsedLimits.dailyCap!,
      maxBatch: parsedLimits.maxBatch!,
      audioBaseUrl: audioBaseUrl.trim(),
    };
    if (key.trim()) patch.apiKey = key.trim();
    const ok = await saveSettings(patch);
    if (ok) setOpen(false);
  };

  return (
    <Modal
      title="系统设置"
      onClose={close}
      closeDisabled={busy}
      footer={
        <>
          <Button type="button" onClick={close}>
            取消
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy || !settings || !model || !limitsValid}
            onClick={() => void submit()}
          >
            {busy ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
        <div className="settings-status">
          <span className={`settings-dot ${connected ? 'on' : ''}`} />
          <span>{statusText}</span>
          {settings?.hasKey && settings.keyHint && (
            <span className="settings-key">{settings.keyHint}</span>
          )}
        </div>

        <div className="settings-section">
          <div className="settings-label">默认生图模型</div>
          <div className="model-list">
            {(settings?.models || []).map((option) => (
              <Button
                key={option.id}
                type="button"
                className={`model-option ${model === option.id ? 'on' : ''}`}
                onClick={() => setModel(option.id)}
              >
                <span className="model-radio" />
                <span className="model-main">
                  <b>{option.label}</b>
                  {option.note && <small>{option.note}</small>}
                </span>
                <span className="model-id">{option.id}</span>
              </Button>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-label">送模型提示词</div>
          <div className="settings-lang">
            <Button
              type="button"
              className={`lang-option ${lang === 'zh' ? 'on' : ''}`}
              onClick={() => setLang('zh')}
            >
              中文提示词
            </Button>
            <Button
              type="button"
              className={`lang-option ${lang === 'en' ? 'on' : ''}`}
              onClick={() => setLang('en')}
            >
              English 提示词
            </Button>
          </div>
          <p className="settings-hint">
            {lang === 'zh'
              ? '发送中文提示词与负面词。'
              : '发送英文提示词；英文列缺少画风约束时可能偏离。'}
          </p>
        </div>

        <div className="settings-section">
          <div className="settings-label">生成限制</div>
          <div className="limit-grid">
            {LIMIT_FIELDS.map((field) => {
              const invalid = parsedLimits[field.key] === null;
              return (
                <label key={field.key} className={`limit-field ${invalid ? 'invalid' : ''}`}>
                  <span>{field.label}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={field.min}
                    max={field.max}
                    step={1}
                    value={limits[field.key]}
                    aria-invalid={invalid || undefined}
                    onChange={(event) =>
                      setLimits((prev) => ({ ...prev, [field.key]: event.target.value }))
                    }
                  />
                  <small>
                    {field.min}–{field.max}
                  </small>
                </label>
              );
            })}
          </div>
          <p className="settings-hint">每日上限按自然日重置，并发数保存后生效。</p>
        </div>

        <div className="settings-section">
          <div className="settings-label">IndexTTS 服务</div>
          <div className="audio-url-row">
            <input
              type="text"
              spellCheck={false}
              value={audioBaseUrl}
              placeholder="http://127.0.0.1:7860"
              onChange={(event) => {
                setAudioBaseUrl(event.target.value);
                setHealth(null);
              }}
            />
            <Button
              type="button"
              className="audio-test"
              disabled={checking}
              onClick={() => void checkAudio(audioBaseUrl)}
            >
              {checking ? '检测中…' : '测试连接'}
            </Button>
          </div>
          <div
            className={`audio-health ${health?.ok ? 'on' : health ? 'off' : ''}`}
            title={health?.error || undefined}
          >
            <span className={`settings-dot ${health?.ok ? 'on' : ''}`} />
            <span>
              {checking
                ? '正在检测…'
                : !health
                  ? '尚未检测'
                  : health.ok
                    ? `已连接 · ${health.title || 'IndexTTS'}${health.version ? ` ${health.version}` : ''}`
                    : `连接失败：${health.error || '未知错误'}`}
            </span>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-label">参考音色</div>
          {settings?.audio.hasVoice ? (
            <div className="voice-box">
              <span className="voice-icon">
                <AudioLines size={16} />
              </span>
              <div className="voice-main">
                <b>{settings.audio.voiceName || '参考音色'}</b>
                <span>
                  {settings.audio.voiceDurationSec != null
                    ? `${settings.audio.voiceDurationSec.toFixed(2)}s · 已就绪`
                    : '已就绪'}
                </span>
              </div>
              <Button
                type="button"
                className="voice-action"
                disabled={uploadingVoice}
                onClick={() => voiceFileRef.current?.click()}
              >
                {uploadingVoice ? '上传中…' : '替换'}
              </Button>
              <Button
                type="button"
                className="voice-remove"
                title="移除参考音色"
                aria-label="移除参考音色"
                onClick={() => void dropVoice()}
              >
                <Trash2 size={13} />
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              block
              className="voice-upload"
              disabled={uploadingVoice}
              onClick={() => voiceFileRef.current?.click()}
            >
              <Upload size={14} />
              {uploadingVoice ? '上传中…' : '上传参考音频'}
            </Button>
          )}
          {settings?.audio.voiceUrl && (
            <audio
              className="voice-audio"
              src={settings.audio.voiceUrl}
              controls
              preload="metadata"
            />
          )}
          <p className="settings-hint">
            所有音频节点共用这一条音色，建议上传 5–15 秒的干净人声。
          </p>
          <input
            ref={voiceFileRef}
            className="file-input"
            type="file"
            accept="audio/*"
            onChange={(event) => void pickVoice(event)}
          />
        </div>

        <label className="field">
          <span>AIClone API Key</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            placeholder={settings?.hasKey ? '已配置，留空则保持不变' : 'sk_...'}
            onChange={(event) => setKey(event.target.value)}
          />
        </label>

        <p className="modal-note">Key 仅保存在本机服务端，不会下发到浏览器。</p>
    </Modal>
  );
}
