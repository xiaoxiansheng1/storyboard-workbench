import { useEffect, useMemo, useState } from 'react';
import type { Node } from '@xyflow/react';
import { useWorkbench } from '../store';
import type { ShotData, WorkbenchConfig } from '../types';
import { IconClose } from './icons';

type ShotState = { tone: 'ready' | 'todo' | 'busy'; label: string; framed: boolean };

function shotState(node: Node<ShotData>, config: WorkbenchConfig | null): ShotState {
  const run = node.data.run;
  const framed = run.candidates.length > 0;
  const busy = run.status === 'queued' || run.status === 'running';
  if (busy) return { tone: 'busy', label: '生成中', framed };

  const selected = run.candidates.find((candidate) => candidate.id === run.selectedId);
  if (
    run.status === 'done' &&
    run.promptHash === node.data.promptHash &&
    selected?.provider === 'upload'
  ) {
    return { tone: 'ready', label: '已上传', framed };
  }

  const signature = config
    ? `${node.data.promptHash}|${config.provider}:${config.model}|${config.size}|${config.promptLang}|1`
    : '';
  const satisfied =
    run.status === 'done' &&
    run.candidates.length > 0 &&
    run.promptHash === node.data.promptHash &&
    (!config || run.signature === signature);

  if (satisfied) return { tone: 'ready', label: '已有首帧', framed };
  if (!framed) return { tone: 'todo', label: '未生成', framed };
  if (run.promptHash !== node.data.promptHash) return { tone: 'todo', label: '提示词已改', framed };
  if (run.status === 'error') return { tone: 'todo', label: '上次生成失败', framed };
  return { tone: 'todo', label: '参数已变', framed };
}

const pad = (no: number) => String(no).padStart(2, '0');

export function BatchDialog() {
  const open = useWorkbench((s) => s.batchOpen);
  const setOpen = useWorkbench((s) => s.setBatchOpen);
  const nodes = useWorkbench((s) => s.nodes);
  const config = useWorkbench((s) => s.project?.config ?? null);
  const busy = useWorkbench((s) => s.batchBusy);
  const batchNodes = useWorkbench((s) => s.batchNodes);

  const [force, setForce] = useState(false);

  useEffect(() => {
    if (open) setForce(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const selected = useMemo(
    () => nodes.filter((node) => node.selected).sort((a, b) => a.data.no - b.data.no),
    [nodes],
  );

  if (!open) return null;

  const states = selected.map((node) => ({ node, state: shotState(node, config) }));
  const withFrame = states.filter(({ state }) => state.framed).length;
  const idle = states.filter(({ state }) => state.tone !== 'busy');
  const planned = force ? idle.length : idle.filter(({ state }) => state.tone === 'todo').length;
  const running = selected.length - idle.length;
  const maxBatch = config?.maxBatch || 0;
  const overBatch = maxBatch > 0 && selected.length > maxBatch;
  const canStart = planned > 0 && !busy && !overBatch;

  return (
    <div className="overlay" onClick={() => setOpen(false)}>
      <div className="modal batch-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>批量生成首帧</h2>
          </div>
          <button type="button" className="icon-btn" onClick={() => setOpen(false)} title="关闭">
            <IconClose size={15} />
          </button>
        </div>

        <div className="batch-stats">
          <div className="batch-stat">
            <b>{selected.length}</b>
            <span>已选镜头</span>
          </div>
          <div className="batch-stat">
            <b>{withFrame}</b>
            <span>已有首帧</span>
          </div>
          <div className="batch-stat">
            <b>{planned}</b>
            <span>本次生成</span>
          </div>
        </div>

        <div className="batch-shots">
          {states.map(({ node, state }) => (
            <span
              key={node.id}
              className={`batch-chip ${state.tone}`}
              title={`镜头 ${pad(node.data.no)} · ${state.label}`}
            >
              {pad(node.data.no)}
            </span>
          ))}
        </div>

        <p className="modal-note">
          默认只生成没有首帧、提示词已改、模型或尺寸变化、上次失败的镜头；正在生成或排队的会自动跳过。
          {running > 0 && <span className="warn"> 其中 {running} 个正在生成，本次不会重复提交。</span>}
        </p>

        {overBatch && (
          <p className="batch-warning">
            单次批量最多 {maxBatch} 个镜头，当前已选 {selected.length} 个。请减少选择，或到系统设置调高上限。
          </p>
        )}

        <label className="batch-check">
          <input
            type="checkbox"
            checked={force}
            onChange={(event) => setForce(event.target.checked)}
          />
          <span>已有首帧也重新生成</span>
        </label>

        <div className="modal-actions">
          <button type="button" onClick={() => setOpen(false)}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={!canStart}
            aria-busy={busy || undefined}
            onClick={() => void batchNodes(selected.map((node) => node.id), force)}
          >
            {busy ? '提交中…' : force ? `重新生成 ${planned} 个镜头` : `生成 ${planned} 个镜头`}
          </button>
        </div>
      </div>
    </div>
  );
}
