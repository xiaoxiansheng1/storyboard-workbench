import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useWorkbench } from '../store';
import type { ShotData } from '../types';

function shortTime(timecode: string): string {
  return String(timecode || '').replace(/^00:/, '').replace(',', '.');
}

export function ShotNode({ id, data, selected }: NodeProps<Node<ShotData>>) {
  const generate = useWorkbench((s) => s.generate);
  const selectCandidate = useWorkbench((s) => s.selectCandidate);
  const setLightbox = useWorkbench((s) => s.setLightbox);

  const run = data.run;
  const busy = run.status === 'queued' || run.status === 'running';
  const stale = run.candidates.some((candidate) => candidate.promptHash !== data.promptHash);
  const preview = data.promptEn || data.promptZh;

  const selectedIndex = Math.max(
    0,
    run.candidates.findIndex((candidate) => candidate.id === run.selectedId),
  );
  const selectedCandidate = run.candidates[selectedIndex] || null;
  const progress =
    run.progress && run.progress.total
      ? Math.round((run.progress.done / run.progress.total) * 100)
      : 0;

  let stateLabel = '尚未生成';
  let stateTone = '';
  if (run.status === 'queued') {
    stateLabel = '排队中…';
    stateTone = 'running';
  } else if (run.status === 'running') {
    stateLabel = `生成中 ${run.progress?.done ?? 0}/${run.progress?.total ?? 4}`;
    stateTone = 'running';
  } else if (run.status === 'error') {
    stateLabel = `失败 · ${run.error || '未知错误'}`;
    stateTone = 'error';
  } else if (stale) {
    stateLabel = '提示词已改 · 图为旧版';
    stateTone = 'stale';
  } else if (run.candidates.length) {
    stateLabel = `${run.candidates.length} 个候选 · 已选 ${String(selectedIndex + 1).padStart(2, '0')}`;
  }

  return (
    <div
      className={`shot-node ${data.anchor === 'B' ? 'anchor-b' : 'anchor-a'} ${
        selected ? 'is-selected' : ''
      }`}
    >
      <Handle type="target" position={Position.Left} className="port" />

      <header className="node-head">
        <span className="shot-no">{String(data.no).padStart(2, '0')}</span>
        <span className={`anchor-tag ${data.anchor === 'B' ? 'b' : 'a'}`}>{data.anchor}</span>
        <span className="node-head-meta">
          <span className="node-time">{shortTime(data.srtStart)}</span>
          <span className="node-dur">{data.duration.toFixed(2)}s</span>
        </span>
      </header>

      <div
        className={`node-frame ${selectedCandidate ? 'has-frame' : ''}`}
        onClick={() => {
          if (selectedCandidate) {
            setLightbox({ nodeId: id, index: selectedIndex });
          }
        }}
        title={selectedCandidate ? '点击查看大图' : '还没有首帧'}
      >
        {selectedCandidate ? (
          <img src={selectedCandidate.url} alt={`镜头 ${data.no}`} loading="lazy" />
        ) : (
          <div className="frame-empty">
            <span className="frame-glyph">{data.anchor === 'B' ? '▤' : '▣'}</span>
            <span className="frame-empty-label">NO FRAME</span>
            <span className="frame-empty-hint">首帧未生成</span>
          </div>
        )}
        {busy && (
          <div className="frame-bar">
            <span style={{ width: run.status === 'queued' ? '10%' : `${Math.max(10, progress)}%` }} />
          </div>
        )}
        {selectedCandidate && (
          <span className="frame-badge">
            {String(selectedIndex + 1).padStart(2, '0')} / {String(run.candidates.length).padStart(2, '0')}
          </span>
        )}
      </div>

      <div className="node-caption" title={data.caption}>
        {data.caption || '（无文案）'}
      </div>
      <div className="node-prompt" title={preview}>
        {preview || '（无提示词）'}
      </div>

      {run.candidates.length > 0 && (
        <div className="takes">
          {run.candidates.map((candidate, index) => (
            <button
              type="button"
              key={candidate.id}
              className={`take nodrag nopan ${candidate.id === run.selectedId ? 'on' : ''}`}
              title={`候选 ${index + 1} · 单击选用，双击看大图`}
              onClick={(event) => {
                event.stopPropagation();
                void selectCandidate(id, candidate.id);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                setLightbox({ nodeId: id, index });
              }}
            >
              <img src={candidate.url} alt="" loading="lazy" />
              <span className="take-no">{String(index + 1).padStart(2, '0')}</span>
            </button>
          ))}
        </div>
      )}

      <footer className="node-foot">
        <span className={`node-state ${stateTone}`} title={run.error || stateLabel}>
          {stateLabel}
        </span>
        <button
          type="button"
          className="node-gen nodrag nopan"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            void generate(id, { n: 4, force: run.candidates.length > 0 });
          }}
        >
          {run.candidates.length ? '再生成' : '生成'} ×4
        </button>
      </footer>

      <Handle type="source" position={Position.Right} className="port" />
    </div>
  );
}
