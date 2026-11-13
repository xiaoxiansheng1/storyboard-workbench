import { useEffect, useMemo, useState } from 'react';
import type { Node } from '@xyflow/react';
import { useWorkbench } from '../../store';
import type { ShotData, WorkbenchConfig } from '../../types';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { pad } from '../../utils/format';

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

  const selected = useMemo(
    () =>
      nodes
        .filter((node): node is Node<ShotData> => node.type !== 'audio' && Boolean(node.selected))
        .sort((a, b) => a.data.no - b.data.no),
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
    <Modal
      title="批量生成首帧"
      onClose={() => setOpen(false)}
      footer={
        <>
          <Button type="button" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canStart}
            aria-busy={busy || undefined}
            onClick={() =>
              void batchNodes(
                selected.map((node) => node.id),
                force,
              )
            }
          >
            {busy ? '提交中…' : force ? `重新生成 ${planned} 个镜头` : `生成 ${planned} 个镜头`}
          </Button>
        </>
      }
    >
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
        默认只生成需要更新的镜头，生成中或排队的会跳过。
        {running > 0 && <span className="warn"> 其中 {running} 个正在生成。</span>}
      </p>

      {overBatch && (
        <p className="batch-warning">
          单次最多 {maxBatch} 个镜头，请减少选择或在系统设置中调高上限。
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
    </Modal>
  );
}
