import { useEffect, useState, type ChangeEvent } from 'react';
import { useWorkbench } from '../store';
import type { RunStatus, ShotData } from '../types';

interface FormState {
  caption: string;
  promptZh: string;
  promptEn: string;
  negativeZh: string;
  negativeEn: string;
}

const STATUS_TEXT: Record<RunStatus, string> = {
  idle: '待生成',
  queued: '排队中',
  running: '生成中',
  done: '已完成',
  error: '失败',
};

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
  const selectCandidate = useWorkbench((s) => s.selectCandidate);
  const clearRun = useWorkbench((s) => s.clearRun);
  const setLightbox = useWorkbench((s) => s.setLightbox);
  const selectNode = useWorkbench((s) => s.selectNode);
  const notify = useWorkbench((s) => s.notify);

  const [form, setForm] = useState<FormState>({
    caption: '',
    promptZh: '',
    promptEn: '',
    negativeZh: '',
    negativeEn: '',
  });
  const [tab, setTab] = useState<'en' | 'zh'>('en');
  const [n, setN] = useState(4);
  const [seed, setSeed] = useState('');
  const [force, setForce] = useState(true);

  useEffect(() => {
    if (!node) return;
    setForm(fields(node.data));
    setTab(config?.promptLang === 'zh' ? 'zh' : 'en');
    // 只在切换镜头时重置编辑器，避免 SSE 更新覆盖正在输入的内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id]);

  if (!node) return null;

  const data = node.data;
  const run = data.run;
  const selectedIndex = Math.max(
    0,
    run.candidates.findIndex((candidate) => candidate.id === run.selectedId),
  );
  const selected = run.candidates[selectedIndex] || null;
  const busy = run.status === 'queued' || run.status === 'running';
  const dirty =
    form.caption !== data.caption ||
    form.promptZh !== data.promptZh ||
    form.promptEn !== data.promptEn ||
    form.negativeZh !== data.negativeZh ||
    form.negativeEn !== data.negativeEn;

  const promptValue = tab === 'en' ? form.promptEn : form.promptZh;
  const negativeValue = tab === 'en' ? form.negativeEn : form.negativeZh;
  const inUse = config?.promptLang === tab;

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
      .then(() => notify('提示词已复制'))
      .catch(() => notify('复制失败'));
  };

  const statusText = run.status === 'done' && !run.candidates.length ? '待生成' : STATUS_TEXT[run.status];

  return (
    <aside className="inspector">
      <header className="inspector-head">
        <div>
          <div className="inspector-eyebrow">SHOT</div>
          <div className="inspector-title-row">
            <span className="inspector-no">{String(data.no).padStart(2, '0')}</span>
            <span className={`anchor-tag ${data.anchor === 'B' ? 'b' : 'a'}`}>
              {data.anchor} {data.anchor === 'B' ? '空镜' : '人物'}
            </span>
            <span className="inspector-dur">{data.duration.toFixed(2)}s</span>
          </div>
          <div className="inspector-tc">
            {data.srtStart} → {data.srtEnd}
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={() => selectNode(null)} title="关闭">
          ×
        </button>
      </header>

      <div className="inspector-scroll">
        <div className={`hero ${selected ? '' : 'is-empty'}`}>
          {selected ? (
            <img
              src={selected.url}
              alt={`镜头 ${data.no}`}
              onClick={() => setLightbox({ nodeId: node.id, index: selectedIndex })}
            />
          ) : (
            <div className="hero-empty">
              <span className="hero-glyph">{data.anchor === 'B' ? '▤' : '▣'}</span>
              <span>{busy ? '正在生成…' : '暂无首帧'}</span>
            </div>
          )}
          {selected && <div className="hero-shade" />}
          <div className="hero-top">
            <span className="hero-chip">
              {String(run.candidates.length).padStart(2, '0')} TAKES
            </span>
            <span className={`status-pill ${run.status}`}>{statusText}</span>
          </div>
          {selected && (
            <div className="hero-bottom">
              <span className="hero-take">TAKE {String(selectedIndex + 1).padStart(2, '0')}</span>
              <button
                type="button"
                className="hero-link"
                onClick={() => setLightbox({ nodeId: node.id, index: selectedIndex })}
              >
                查看大图 ↗
              </button>
            </div>
          )}
        </div>

        {run.candidates.length > 0 && (
          <>
            <div className="strip-head">
              <span className="eyebrow">TAKES</span>
              <span className="strip-hint">单击选用 · 双击放大</span>
            </div>
            <div className="candidate-strip">
              {run.candidates.map((candidate, index) => (
                <button
                  type="button"
                  key={candidate.id}
                  className={`candidate ${candidate.id === run.selectedId ? 'on' : ''}`}
                  onClick={() => void selectCandidate(node.id, candidate.id)}
                  onDoubleClick={() => setLightbox({ nodeId: node.id, index })}
                  title={`候选 ${index + 1} · ${candidate.size}${candidate.seed !== null ? ` · seed ${candidate.seed}` : ''}`}
                >
                  <img src={candidate.url} alt="" loading="lazy" />
                  <span className="candidate-index">{String(index + 1).padStart(2, '0')}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="deck">
          <div className="deck-row">
            <span className="deck-label">张数</span>
            <div className="segmented">
              {[1, 2, 4, 8].map((value) => (
                <button
                  type="button"
                  key={value}
                  className={n === value ? 'on' : ''}
                  onClick={() => setN(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            <span className="deck-label">SEED</span>
            <input
              type="number"
              className="seed-input"
              placeholder="随机"
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
            />
          </div>
          <div className="deck-row between">
            <label className="switch">
              <input
                type="checkbox"
                checked={force}
                onChange={(event) => setForce(event.target.checked)}
              />
              <span className="switch-track">
                <span className="switch-thumb" />
              </span>
              强制重跑
            </label>
            <span className="deck-hint">
              {busy && run.progress
                ? `${run.progress.done}/${run.progress.total}`
                : dirty
                  ? '先保存提示词'
                  : '同参幂等跳过'}
            </span>
          </div>
          <button
            type="button"
            className="primary block"
            disabled={busy || dirty}
            onClick={() =>
              void generate(node.id, {
                n,
                force,
                seed: seed.trim() === '' ? undefined : Number(seed),
              })
            }
          >
            {busy ? `生成中 ${run.progress?.done ?? 0}/${run.progress?.total ?? n}…` : `生成 ${n} 张首帧`}
          </button>
          {run.status === 'error' && <div className="deck-error">{run.error}</div>}
        </div>

        <div className="tech-line">
          <span>
            {selected
              ? `${selected.provider} · ${selected.model} · ${selected.size}${
                  selected.seed !== null ? ` · seed ${selected.seed}` : ''
                }`
              : `promptHash ${data.promptHash}`}
          </span>
          {run.candidates.length > 0 && (
            <button
              type="button"
              className="link-danger"
              onClick={() => {
                if (window.confirm('清空当前镜头的候选图记录？（磁盘文件不会删除）')) {
                  void clearRun(node.id);
                }
              }}
            >
              清空候选
            </button>
          )}
        </div>

        <section className="panel">
          <div className="panel-head">
            <span className="eyebrow">PROMPT</span>
            <div className="lang-tabs">
              <button
                type="button"
                className={tab === 'en' ? 'on' : ''}
                onClick={() => setTab('en')}
              >
                EN{form.promptEn ? '' : ' · 空'}
              </button>
              <button
                type="button"
                className={tab === 'zh' ? 'on' : ''}
                onClick={() => setTab('zh')}
              >
                中文{form.promptZh ? '' : ' · 空'}
              </button>
            </div>
            <button type="button" className="ghost-mini" onClick={copyPrompt}>
              复制
            </button>
          </div>
          <textarea
            className="prompt-area"
            rows={9}
            spellCheck={false}
            value={promptValue}
            onChange={setField(tab === 'en' ? 'promptEn' : 'promptZh')}
          />
          <div className="panel-foot">
            <span>{promptValue.length} chars</span>
            {inUse && <span className="in-use">送模型</span>}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="eyebrow">CAPTION</span>
            <span className="panel-count">{form.caption.length}</span>
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
            <span className="eyebrow">NEGATIVE</span>
            <span className="summary-hint">负面词</span>
            <span className="chev">›</span>
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
            <div className="panel-foot">
              <span>
                {config?.appendNegative ? '以 Avoid: … 追加到 prompt' : '未开启追加，负面词不会送模型'}
              </span>
            </div>
          </div>
        </details>

        <details className="panel collapsible">
          <summary>
            <span className="eyebrow">MOTION</span>
            <span className="summary-hint">视频提示词 · P1</span>
            <span className="chev">›</span>
          </summary>
          <div className="collapsible-body">
            <pre className="video-prompt">{data.videoPrompt || '（无）'}</pre>
          </div>
        </details>
      </div>

      <footer className="inspector-foot">
        <span className={`foot-note ${dirty ? 'warn' : ''}`}>
          {dirty ? '有未保存修改' : '已保存'}
        </span>
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
