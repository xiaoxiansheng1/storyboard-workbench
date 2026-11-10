import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Node } from '@xyflow/react';
import { useWorkbench } from '../../store';
import type { ShotData } from '../../types';
import { ChevronRight, Copy, Download, Film, Image as ImageIcon, Trash2, Upload, X } from 'lucide-react';
import { Button } from '../common/Button';
import { Segmented } from '../common/Segmented';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible';
import { Textarea } from '../ui/textarea';

interface FormState {
  caption: string;
  promptZh: string;
  promptEn: string;
  negativeZh: string;
  negativeEn: string;
}

const LANG_OPTIONS: { value: 'en' | 'zh'; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'zh', label: '中文' },
];

function fields(data: ShotData): FormState {
  return {
    caption: data.caption || '',
    promptZh: data.promptZh || '',
    promptEn: data.promptEn || '',
    negativeZh: data.negativeZh || '',
    negativeEn: data.negativeEn || '',
  };
}

export function ShotInspector({ node }: { node: Node<ShotData> }) {
  const config = useWorkbench((s) => s.project?.config);
  const patchNode = useWorkbench((s) => s.patchNode);
  const generate = useWorkbench((s) => s.generate);
  const setLightbox = useWorkbench((s) => s.setLightbox);
  const selectNode = useWorkbench((s) => s.selectNode);
  const setSettingsOpen = useWorkbench((s) => s.setSettingsOpen);
  const uploadImage = useWorkbench((s) => s.uploadImage);
  const uploadVideo = useWorkbench((s) => s.uploadVideo);
  const removeVideo = useWorkbench((s) => s.removeVideo);
  const notify = useWorkbench((s) => s.notify);

  const fileRef = useRef<HTMLInputElement>(null);
  const videoFileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);

  const [form, setForm] = useState<FormState>({
    caption: '',
    promptZh: '',
    promptEn: '',
    negativeZh: '',
    negativeEn: '',
  });
  const [tab, setTab] = useState<'en' | 'zh'>('zh');
  const [negTab, setNegTab] = useState<'en' | 'zh'>('zh');
  const [submitting, setSubmitting] = useState(false);
  const [mediaTab, setMediaTab] = useState<'image' | 'video'>('image');
  const busy = node ? node.data.run.status === 'queued' || node.data.run.status === 'running' : false;
  const video = node?.data.video || null;

  useEffect(() => {
    if (!node) return;
    setForm(fields(node.data));
    setTab(config?.promptLang === 'en' ? 'en' : 'zh');
    setNegTab(config?.promptLang === 'en' ? 'en' : 'zh');
    // 只在切换镜头时重置编辑器，避免 SSE 更新覆盖正在输入的内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id]);

  useEffect(() => {
    if (busy) setSubmitting(false);
  }, [busy, node?.id]);

  useEffect(() => {
    const current = node?.data;
    if (!current) return;
    setMediaTab(current.video && current.run.candidates.length === 0 ? 'video' : 'image');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id]);

  useEffect(() => {
    if (!video) setMediaTab('image');
  }, [video]);

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
  const negativeEditValue = negTab === 'en' ? form.negativeEn : form.negativeZh;
  const working = busy || submitting;
  const showVideo = mediaTab === 'video' && Boolean(video);

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
      setMediaTab('image');
    } finally {
      setUploading(false);
    }
  };

  const pickVideo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploadingVideo(true);
    try {
      await uploadVideo(node.id, file);
      setMediaTab('video');
    } finally {
      setUploadingVideo(false);
    }
  };

  const slot = data.duration;
  const available = video ? Math.max(0, video.durationSec - video.inPoint) : 0;
  let alignLabel = '';
  let alignTone = '';
  if (video) {
    if (available >= slot - 0.01) {
      alignLabel = `截取 ${slot.toFixed(2)}s`;
      alignTone = 'ok';
    } else if (available >= slot * 0.9) {
      alignLabel = `略短，放慢补齐`;
      alignTone = 'warn';
    } else {
      alignLabel = `偏短，尾部定格 ${(slot - available).toFixed(2)}s`;
      alignTone = 'warn';
    }
  }

  return (
    <aside className="inspector">
      <header className="inspector-head">
        <div className="inspector-head-main">
          <span className="inspector-no">{String(data.no).padStart(2, '0')}</span>
          <span className={`anchor-tag ${data.anchor === 'B' ? 'b' : 'a'}`}>
            {data.anchor} {data.anchor === 'B' ? '空镜' : '人物'}
          </span>
          <span className="inspector-dur">{data.duration.toFixed(2)}s</span>
          <span
            className="inspector-inline"
            title={`${data.srtStart} → ${data.srtEnd}`}
          >
            {data.srtStart} → {data.srtEnd}
          </span>
        </div>
        <Button variant="icon" type="button" onClick={() => selectNode(null)} title="关闭">
          <X size={15} />
        </Button>
      </header>

      <div className="inspector-scroll">
        <section className="media">
          {video && (
            <div className="media-head">
              <Segmented
                label="预览内容"
                value={mediaTab}
                onChange={(value) => setMediaTab(value)}
                options={[
                  { value: 'image', label: '首帧' },
                  { value: 'video', label: '视频' },
                ]}
              />
              <div className="media-head-right">
                {mediaTab === 'video' && (
                  <span className="video-dims">
                    {video.width}×{video.height}
                  </span>
                )}
                {mediaTab === 'video' && (
                  <Button
                    type="button"
                    className="copy-mini"
                    title="移除镜头视频"
                    aria-label="移除镜头视频"
                    onClick={() => void removeVideo(node.id)}
                  >
                    <Trash2 size={13} />
                  </Button>
                )}
              </div>
            </div>
          )}

          <div
            className={`hero ${
              selected || (!working && video?.posterUrl) || showVideo ? '' : 'is-empty'
            } ${working && !selected && !showVideo ? 'is-loading' : ''}`}
          >
          {showVideo && video ? (
            <video
              className="hero-video"
              src={video.url}
              poster={video.posterUrl || undefined}
              controls
              playsInline
              preload="metadata"
            />
          ) : selected ? (
            <img
              src={selected.url}
              alt={`镜头 ${data.no}`}
              onClick={() => setLightbox({ nodeId: node.id, index: selectedIndex })}
            />
          ) : !working && video?.posterUrl ? (
            <img
              className="is-poster"
              src={video.posterUrl}
              alt={`镜头 ${data.no} 视频`}
            />
          ) : (
            <div className={`hero-empty ${working ? 'is-loading' : ''}`}>
              {working ? (
                <span className="spinner" />
              ) : (
                <span className="hero-glyph">
                  <ImageIcon size={26} />
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
          {selected && !showVideo && <div className="hero-shade" />}
          {selected && working && !showVideo && (
            <div className="hero-loading">
              <span className="marquee" aria-hidden="true">
                <span>AI 正在绘制 · GENERATING · AI 正在绘制 · GENERATING ·&nbsp;</span>
              </span>
              <span className="scan" />
            </div>
          )}
          {showVideo && video && (
            <span className={`media-tag ${alignTone}`}>
              {video.durationSec.toFixed(2)}s · {alignLabel}
            </span>
          )}
          <div className="hero-actions">
            <Button
              type="button"
              className="hero-action"
              title={working ? '生成中，暂不能上传' : '上传本地图片'}
              aria-label="上传本地图片"
              disabled={uploading || working}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? <span className="spinner tiny" /> : <Upload size={14} />}
            </Button>
            <Button
              type="button"
              className={`hero-action ${video ? 'is-on' : ''}`}
              title={video ? '替换镜头视频' : '上传镜头视频'}
              aria-label={video ? '替换镜头视频' : '上传镜头视频'}
              disabled={uploadingVideo}
              onClick={() => videoFileRef.current?.click()}
            >
              {uploadingVideo ? <span className="spinner tiny" /> : <Film size={14} />}
            </Button>
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
                <Download size={14} />
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
          <input
            ref={videoFileRef}
            className="file-input"
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/ogg"
            onChange={(event) => void pickVideo(event)}
          />
          </div>
        </section>

        <div className="deck">
          <Button
            type="button"
            variant="primary"
            block
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
          </Button>
          {needsKey ? (
            <div className="deck-hint">
              未配置 AIClone Key，
              <Button
                type="button"
                className="link-mini"
                onClick={() => setSettingsOpen(true)}
              >
                去系统设置
              </Button>
            </div>
          ) : (
            run.status === 'error' && <div className="deck-error">{run.error}</div>
          )}
        </div>

        <section className="panel prompt-panel">
          <div className="panel-head">
            <span className="eyebrow">首帧提示词</span>
            <div className="prompt-tools">
              <Segmented
                compact
                label="提示词语言"
                options={LANG_OPTIONS}
                value={tab}
                onChange={(value) => setTab(value)}
              />
              <Button
                type="button"
                className="copy-mini"
                onClick={copyPrompt}
                title="复制提示词"
                aria-label="复制提示词"
              >
                <Copy size={14} />
              </Button>
            </div>
          </div>
          <Textarea
            className="prompt-area"
            rows={6}
            spellCheck={false}
            value={promptValue}
            onChange={setField(tab === 'en' ? 'promptEn' : 'promptZh')}
          />
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="eyebrow">分镜文案</span>
          </div>
          <Textarea
            className="caption-area"
            rows={2}
            value={form.caption}
            onChange={setField('caption')}
          />
        </section>

        <Collapsible className="panel collapsible">
          <div className="collapsible-head">
            <CollapsibleTrigger className="collapsible-trigger">
              <span className="eyebrow">负面词</span>
              <span className="chev">
                <ChevronRight size={14} />
              </span>
            </CollapsibleTrigger>
            <div className="collapsible-tools">
              <Segmented
                compact
                label="负面词语言"
                options={LANG_OPTIONS}
                value={negTab}
                onChange={(value) => setNegTab(value)}
              />
            </div>
          </div>
          <CollapsibleContent className="collapsible-content">
            <div className="collapsible-body">
              <Textarea
                className="neg-area"
                rows={4}
                value={negativeEditValue}
                onChange={setField(negTab === 'en' ? 'negativeEn' : 'negativeZh')}
                spellCheck={false}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible className="panel collapsible">
          <CollapsibleTrigger className="collapsible-trigger">
            <span className="eyebrow">视频提示词</span>
            <span className="chev">
              <ChevronRight size={14} />
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="collapsible-content">
            <div className="collapsible-body">
              <pre className="video-prompt">{data.videoPrompt || '（无）'}</pre>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <footer className="inspector-foot">
        {dirty && <span className="foot-note warn">有未保存修改</span>}
        <Button type="button" disabled={!dirty} onClick={() => setForm(fields(data))}>
          还原
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={!dirty}
          onClick={() => void patchNode(node.id, { ...form })}
        >
          保存修改
        </Button>
      </footer>
    </aside>
  );
}
