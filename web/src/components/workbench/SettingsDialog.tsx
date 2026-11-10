import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useWorkbench } from '../../store';
import { api } from '../../api';
import type { AudioHealth, AudioInferMode } from '../../types';
import { AudioLines, Image as ImageIcon, RotateCcw, Trash2, Upload, type LucideIcon } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Segmented } from '../common/Segmented';

type LimitKey = 'concurrency' | 'maxBatch';

type SettingsTab = 'image' | 'audio';

const TABS: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: 'image', label: '生图', icon: ImageIcon },
  { id: 'audio', label: '语音合成', icon: AudioLines },
];

const LIMIT_FIELDS: { key: LimitKey; label: string; min: number; max: number }[] = [
  { key: 'concurrency', label: '并发数', min: 1, max: 8 },
  { key: 'maxBatch', label: '单次批量上限', min: 1, max: 500 },
];

const LANG_OPTIONS: { value: 'zh' | 'en'; label: string }[] = [
  { value: 'zh', label: '中文提示词' },
  { value: 'en', label: 'English 提示词' },
];

const INFER_OPTIONS: { value: AudioInferMode; label: string }[] = [
  { value: '普通推理', label: '普通推理' },
  { value: '批次推理', label: '批次推理' },
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
  const liveUsage = useWorkbench((s) => s.project?.config.usage);
  const saveSettings = useWorkbench((s) => s.saveSettings);
  const resetUsage = useWorkbench((s) => s.resetUsage);
  const uploadVoice = useWorkbench((s) => s.uploadVoice);
  const removeVoice = useWorkbench((s) => s.removeVoice);
  const busy = useWorkbench((s) => s.busy === 'settings');

  const [tab, setTab] = useState<SettingsTab>('image');
  const [model, setModel] = useState('');
  const [lang, setLang] = useState<'en' | 'zh'>('zh');
  const [key, setKey] = useState('');
  const [limits, setLimits] = useState<Record<LimitKey, string>>({
    concurrency: '',
    maxBatch: '',
  });
  const [audioBaseUrl, setAudioBaseUrl] = useState('');
  const [inferMode, setInferMode] = useState<AudioInferMode>('普通推理');
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
    setTab('image');
    if (settings) {
      setModel(settings.imageModel);
      setLang(settings.promptLang);
      setLimits({
        concurrency: String(settings.concurrency),
        maxBatch: String(settings.maxBatch),
      });
      setAudioBaseUrl(settings.audio.baseUrl);
      setInferMode(settings.audio.inferMode || '普通推理');
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

  const dailyCap = settings?.dailyCap ?? 0;
  const used = liveUsage ?? settings?.usage ?? 0;
  const usagePct = dailyCap > 0 ? Math.min(100, Math.round((used / dailyCap) * 100)) : 0;

  const handleResetUsage = async () => {
    if (!window.confirm('重置今日全局用量？所有项目今天已生成的张数都会清零。')) return;
    await resetUsage();
  };

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
      maxBatch: number;
      audioBaseUrl: string;
      audioInferMode: AudioInferMode;
    } = {
      provider: 'aiclone',
      imageModel: model,
      promptLang: lang,
      concurrency: parsedLimits.concurrency!,
      maxBatch: parsedLimits.maxBatch!,
      audioBaseUrl: audioBaseUrl.trim(),
      audioInferMode: inferMode,
    };
    if (key.trim()) patch.apiKey = key.trim();
    const ok = await saveSettings(patch);
    if (ok) setOpen(false);
  };

  return (
    <Modal
      title="系统设置"
      size="lg"
      className="settings-modal"
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
      <div className="settings-layout">
        <nav
          className="settings-nav"
          role="tablist"
          aria-label="设置分类"
          aria-orientation="vertical"
        >
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="settings-panel"
              className={`settings-nav-item ${tab === id ? 'on' : ''}`}
              onClick={() => setTab(id)}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </nav>

        <div
          className="settings-panel"
          id="settings-panel"
          role="tabpanel"
          aria-labelledby={`settings-tab-${tab}`}
        >
          {tab === 'image' ? (
            <>
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
                <Segmented
                  block
                  label="送模型提示词"
                  options={LANG_OPTIONS}
                  value={lang}
                  onChange={setLang}
                />
                <p className="settings-hint">
                  {lang === 'zh'
                    ? '发送中文提示词与负面词。'
                    : '发送英文提示词；英文列缺少画风约束时可能偏离。'}
                </p>
              </div>

              <div className="settings-section">
                <div className="settings-label">生成限制</div>
                <div className="usage-card">
                  <div className="usage-head">
                    <span className="usage-title">今日全局生图用量</span>
                    <span className="usage-right">
                      <span className="usage-count">
                        <b>{used}</b>
                        <span className="usage-sep">/</span>
                        {dailyCap} 张
                      </span>
                      {dailyCap > 0 && used >= dailyCap && (
                        <Button
                          type="button"
                          className="usage-reset"
                          title="重置今日全局用量"
                          onClick={() => void handleResetUsage()}
                        >
                          <RotateCcw size={11} />
                          重置
                        </Button>
                      )}
                    </span>
                  </div>
                  <div
                    className={`usage-bar${usagePct >= 100 ? ' full' : usagePct >= 80 ? ' near' : ''}`}
                    role="progressbar"
                    aria-label="今日全局生图用量"
                    aria-valuemin={0}
                    aria-valuemax={dailyCap || undefined}
                    aria-valuenow={dailyCap > 0 ? Math.min(used, dailyCap) : used}
                  >
                    <i style={{ width: `${usagePct}%` }} />
                  </div>
                </div>
                <div className="limit-grid">
                  {LIMIT_FIELDS.map((field) => {
                    const invalid = parsedLimits[field.key] === null;
                    return (
                      <label
                        key={field.key}
                        className={`limit-field ${invalid ? 'invalid' : ''}`}
                      >
                        <span>
                          {field.label}
                          <span className="limit-range">
                            （{field.min}–{field.max}）
                          </span>
                        </span>
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
                      </label>
                    );
                  })}
                </div>
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
            </>
          ) : (
            <>
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
                <div className="settings-label">推理模式</div>
                <Segmented
                  block
                  label="推理模式"
                  options={INFER_OPTIONS}
                  value={inferMode}
                  onChange={setInferMode}
                />
                <p className="settings-hint">
                  {inferMode === '普通推理'
                    ? '逐句合成，单句稳定性更好，适合长段落。'
                    : '按句子分桶并行合成，长文本更快，句间停顿可能略有差异。'}
                </p>
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
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
