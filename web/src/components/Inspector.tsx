import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useWorkbench } from '../store';
import type { ShotData } from '../types';
import {
  IconChevronRight,
  IconClose,
  IconCopy,
  IconDownload,
  IconImage,
  IconUpload,
} from './icons';

interface FormState {
  caption: string;
  promptZh: string;
  promptEn: string;
  negativeZh: string;
  negativeEn: string;
}

function fields(data: ShotData): FormState {
  return {
    caption: data.caption || '',
    promptZh: data.promptZh || '',
    promptEn: data.promptEn || '',
    negativeZh: data.negativeZh || '',
    negativeEn: data.negativeEn || '',
  };
}

export function Inspector() {
  const selectedId = useWorkbench((s) => s.selectedId);
  const node = useWorkbench((s) => s.nodes.find((n) => n.id === selectedId) || null);
  const config = useWorkbench((s) => s.project?.config);
  const patchNode = useWorkbench((s) => s.patchNode);
  const generate = useWorkbench((s) => s.generate);
  const setLightbox = useWorkbench((s) => s.setLightbox);
  const selectNode = useWorkbench((s) => s.selectNode);
  const setSettingsOpen = useWorkbench((s) => s.setSettingsOpen);
  const uploadImage = useWorkbench((s) => s.uploadImage);
  const notify = useWorkbench((s) => s.notify);

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const [form, setForm] = useState<FormState>({
    caption: '',
    promptZh: '',
    promptEn: '',
    negativeZh: '',
    negativeEn: '',
  });
  const [tab, setTab] = useState<'en' | 'zh'>('zh');
  const [submitting, setSubmitting] = useState(false);
  const busy = node ? node.data.run.status === 'queued' || node.data.run.status === 'running' : false;

  useEffect(() => {
    if (!node) return;
    setForm(fields(node.data));
    setTab(config?.promptLang === 'en' ? 'en' : 'zh');
    // 只在切换镜头时重置编辑器，避免 SSE 更新覆盖正在输入的内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id]);

  useEffect(() => {
    if (busy) setSubmitting(false);
  }, [busy, node?.id]);

  if (!node) return null;

  const data = node.data;
  const run = data.run;
  const selectedIndex = Math.max(
    0,
    run.candidates.findIndex((candidate) => candidate.id === run.selectedId),
  );
  const selected = run.candidates[selectedIndex] || null;
  const needsKey = config?.provider === 'aiclone' && !config.hasKey;
  const dirty =
    form.caption !== data.caption ||
    form.promptZh !== data.promptZh ||
    form.promptEn !== data.promptEn ||
    form.negativeZh !== data.negativeZh ||
    form.negativeEn !== data.negativeEn;

  const promptValue = tab === 'en' ? form.promptEn : form.promptZh;
  const negativeValue = tab === 'en' ? form.negativeEn : form.negativeZh;
  const inUse = config?.promptLang === tab;
  const working = busy || submitting;

  const submit = async () => {
    if (working || dirty || needsKey) return;
    setSubmitting(true);
    try {
      await generate(node.id, { n: 1, force: true });
    } finally {
      setSubmitting(false);
    }
  };

  const setField =
    (key: keyof FormState) => (event: ChangeEvent<HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [key]: event.target.value }));
    };

  const copyPrompt = () => {
    const text = [promptValue, negativeValue ? `Avoid: ${negativeValue}` : '']
      .filter(Boolean)
      .join('\n\n');
    void navigator.clipboard
      .writeText(text)
      .then(() => notify('提示词已复制', 'success'))
      .catch(() => notify('复制失败', 'error'));
  };

  const pickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      await uploadImage(node.id, file);
    } finally {
      setUploading(false);
    }
  };

  return (
    <aside className="inspector">
      <header className="inspector-head">
        <div className="inspector-head-main">
          <span className="inspector-no">{String(data.no).padStart(2, '0')}</span>
          <div className="inspector-meta">
            <div className="inspector-title-row">
              <span className={`anchor-tag ${data.anchor === 'B' ? 'b' : 'a'}`}>
                {data.anchor} {data.anchor === 'B' ? '空镜' : '人物'}
              </span>
              <span className="inspector-dur">{data.duration.toFixed(2)}s</span>
            </div>
            <div className="inspector-tc">
              {data.srtStart} → {data.srtEnd}
            </div>
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={() => selectNode(null)} title="关闭">
          <IconClose size={15} />
        </button>
      </header>

      <div className="inspector-scroll">
        <div className={`hero ${selected ? '' : 'is-empty'} ${working && !selected ? 'is-loading' : ''}`}>
          {selected ? (
            <img
              src={selected.url}
              alt={`镜头 ${data.no}`}
              onClick={() => setLightbox({ nodeId: node.id, index: selectedIndex })}
            />
          ) : (
            <div className={`hero-empty ${working ? 'is-loading' : ''}`}>
              {working ? (
                <span className="spinner" />
              ) : (
                <span className="hero-glyph">
                  <IconImage size={26} />
                </span>
              )}
              <span>
                {busy
                  ? run.status === 'queued'
                    ? '排队中…'
                    : '正在生成首帧…'
                  : submitting
                    ? '正在提交…'
                    : '暂无首帧'}
              </span>
              {working && (
                <span className="marquee" aria-hidden="true">
                  <span>AI 正在绘制 · GENERATING · AI 正在绘制 · GENERATING ·&nbsp;</span>
                </span>
              )}
              {working && <span className="scan" />}
            </div>
          )}
          {selected && <div className="hero-shade" />}
          {selected && working && (
            <div className="hero-loading">
              <span className="marquee" aria-hidden="true">
                <span>AI 正在绘制 · GENERATING · AI 正在绘制 · GENERATING ·&nbsp;</span>
              </span>
              <span className="scan" />
            </div>
          )}
          <div className="hero-actions">
            <button
              type="button"
              className="hero-action"
              title={working ? '生成中，暂不能上传' : '上传本地图片'}
              aria-label="上传本地图片"
              disabled={uploading || working}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? <span className="spinner tiny" /> : <IconUpload size={14} />}
            </button>
            {selected && (
              <a
                className="hero-action"
                href={selected.url}
                download={
                  selected.filename || selected.url.split('/').pop() || `shot-${data.no}.png`
                }
                title="下载当前图片"
                aria-label="下载当前图片"
              >
                <IconDownload size={14} />
              </a>
            )}
          </div>
          <input
            ref={fileRef}
            className="file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            onChange={(event) => void pickFile(event)}
          />
        </div>

        <div className="deck">
          <button
            type="button"
            className="primary block"
            disabled={working || dirty || needsKey}
            aria-busy={working}
            onClick={() => void submit()}
          >
            {working && <span className="spinner tiny" />}
            {busy
              ? `生成中 ${run.progress?.done ?? 0}/${run.progress?.total ?? 1}…`
              : submitting
                ? '正在提交…'
                : '生成首帧'}
          </button>
          {needsKey ? (
            <div className="deck-hint">
              未配置 AIClone Key，
              <button
                type="button"
                className="link-mini"
                onClick={() => setSettingsOpen(true)}
              >
                去系统设置
              </button>
            </div>
          ) : (
            run.status === 'error' && <div className="deck-error">{run.error}</div>
          )}
        </div>

        <section className="panel prompt-panel">
          <div className="panel-head">
            <span className="eyebrow">首帧提示词</span>
            <button
              type="button"
              className="copy-mini"
              onClick={copyPrompt}
              title="复制提示词"
              aria-label="复制提示词"
            >
              <IconCopy size={14} />
            </button>
          </div>
          <div className="lang-tabs">
            <button
              type="button"
              className={tab === 'en' ? 'on' : ''}
              onClick={() => setTab('en')}
            >
              EN
              {config?.promptLang === 'en' && (
                <i className="tab-use" title="当前送模型" aria-label="当前送模型" />
              )}
            </button>
            <button
              type="button"
              className={tab === 'zh' ? 'on' : ''}
              onClick={() => setTab('zh')}
            >
              中文
              {config?.promptLang === 'zh' && (
                <i className="tab-use" title="当前送模型" aria-label="当前送模型" />
              )}
            </button>
          </div>
          <textarea
            className="prompt-area"
            rows={7}
            spellCheck={false}
            value={promptValue}
            onChange={setField(tab === 'en' ? 'promptEn' : 'promptZh')}
          />
          <div className="panel-foot">
            {inUse ? (
              <span className="in-use">当前送模型</span>
            ) : (
              <span className="foot-warn">
                生成时发送{config?.promptLang === 'en' ? ' English ' : '中文'}
                提示词，当前查看的版本不会送模型
              </span>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="eyebrow">分镜文案</span>
          </div>
          <textarea
            className="caption-area"
            rows={2}
            value={form.caption}
            onChange={setField('caption')}
          />
        </section>

        <details className="panel collapsible">
          <summary>
            <span className="eyebrow">负面词</span>
            <span className="chev">
              <IconChevronRight size={14} />
            </span>
          </summary>
          <div className="collapsible-body">
            <label className="mini-field">
              <span>English</span>
              <textarea
                rows={3}
                value={form.negativeEn}
                onChange={setField('negativeEn')}
                spellCheck={false}
              />
            </label>
            <label className="mini-field">
              <span>中文</span>
              <textarea
                rows={3}
                value={form.negativeZh}
                onChange={setField('negativeZh')}
                spellCheck={false}
              />
            </label>
          </div>
        </details>

        <details className="panel collapsible">
          <summary>
            <span className="eyebrow">视频提示词</span>
            <span className="chev">
              <IconChevronRight size={14} />
            </span>
          </summary>
          <div className="collapsible-body">
            <pre className="video-prompt">{data.videoPrompt || '（无）'}</pre>
          </div>
        </details>
      </div>

      <footer className="inspector-foot">
        {dirty && <span className="foot-note warn">有未保存修改</span>}
        <button type="button" disabled={!dirty} onClick={() => setForm(fields(data))}>
          还原
        </button>
        <button
          type="button"
          className="primary"
          disabled={!dirty}
          onClick={() => void patchNode(node.id, { ...form })}
        >
          保存修改
        </button>
      </footer>
    </aside>
  );
}
