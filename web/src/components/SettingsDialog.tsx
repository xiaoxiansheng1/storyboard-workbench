import { useEffect, useState } from 'react';
import { useWorkbench } from '../store';
import { IconClose } from './icons';

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

function ratioLabel(size: string): string {
  const matched = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(String(size || ''));
  if (!matched) return size || '16:9';
  const width = Number(matched[1]);
  const height = Number(matched[2]);
  if (!width || !height) return '16:9';
  if (Math.abs(width / height - 1) < 0.05) return '1:1';
  return width > height ? '16:9' : '9:16';
}

export function SettingsDialog() {
  const open = useWorkbench((s) => s.settingsOpen);
  const setOpen = useWorkbench((s) => s.setSettingsOpen);
  const settings = useWorkbench((s) => s.settings);
  const saveSettings = useWorkbench((s) => s.saveSettings);
  const busy = useWorkbench((s) => s.busy === 'settings');

  const [model, setModel] = useState('');
  const [lang, setLang] = useState<'en' | 'zh'>('zh');
  const [key, setKey] = useState('');
  const [limits, setLimits] = useState<Record<LimitKey, string>>({
    concurrency: '',
    dailyCap: '',
    maxBatch: '',
  });

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
    }
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, setOpen]);

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
    } = {
      provider: 'aiclone',
      imageModel: model,
      promptLang: lang,
      concurrency: parsedLimits.concurrency!,
      dailyCap: parsedLimits.dailyCap!,
      maxBatch: parsedLimits.maxBatch!,
    };
    if (key.trim()) patch.apiKey = key.trim();
    const ok = await saveSettings(patch);
    if (ok) setOpen(false);
  };

  return (
    <div className="overlay" onClick={close}>
      <div className="modal settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>系统设置</h2>
          </div>
          <button type="button" className="icon-btn" onClick={close} title="关闭">
            <IconClose size={15} />
          </button>
        </div>

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
              <button
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
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-label">送模型提示词</div>
          <div className="settings-lang">
            <button
              type="button"
              className={lang === 'zh' ? 'on' : ''}
              onClick={() => setLang('zh')}
            >
              中文提示词
            </button>
            <button
              type="button"
              className={lang === 'en' ? 'on' : ''}
              onClick={() => setLang('en')}
            >
              English 提示词
            </button>
          </div>
          <p className="settings-hint">
            {lang === 'zh'
              ? '生成时发送中文提示词与中文负面词。'
              : '生成时发送 English 提示词与 English 负面词；若英文列缺少画风约束，出图会偏离。'}
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
          <p className="settings-hint settings-usage">
            今日已生成 <b>{settings?.usage ?? 0}</b> 张，每日上限按自然日重置；并发数保存后立即生效，单次批量超过上限会被服务端拒绝。
          </p>
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

        <p className="modal-note">
          Key 仅保存在本机服务端（data/settings.json），不会下发到浏览器。每张首帧消耗 3
          credits，尺寸按当前 {settings?.size || '1280x720'} 自动换算为 {ratioLabel(settings?.size || '')}。
        </p>

        <div className="modal-actions">
          <button type="button" onClick={close}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !settings || !model || !limitsValid}
            onClick={() => void submit()}
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
