import { useMemo } from 'react';
import { useWorkbench } from '../../store';
import { Button } from '../common/Button';
import { TaskCenter } from './TaskCenter';

export function SelectionBar() {
  const nodes = useWorkbench((s) => s.nodes);
  const selectedId = useWorkbench((s) => s.selectedId);
  const setBatchOpen = useWorkbench((s) => s.setBatchOpen);
  const clearSelection = useWorkbench((s) => s.clearSelection);
  const batchAudio = useWorkbench((s) => s.batchAudio);
  const picked = useMemo(() => {
    const shots: string[] = [];
    const audio: string[] = [];
    for (const node of nodes) {
      if (!node.selected) continue;
      if (node.type === 'audio') audio.push(node.id);
      else shots.push(node.id);
    }
    return { shots, audio, total: shots.length + audio.length };
  }, [nodes]);

  const count = picked.total;

  return (
    <div className={`selection-bar ${selectedId ? 'with-inspector' : ''}`}>
      <TaskCenter />
      <span className="selection-count" aria-live="polite">
        {count ? (
          <>
            已选 {picked.shots.length > 0 && <b>{picked.shots.length}</b>}
            {picked.shots.length > 0 && ' 镜'}
            {picked.shots.length > 0 && picked.audio.length > 0 && ' · '}
            {picked.audio.length > 0 && <b>{picked.audio.length}</b>}
            {picked.audio.length > 0 && ' 音频'}
          </>
        ) : (
          '未选择节点'
        )}
      </span>
      <span className="selection-hint">Shift 框选 · Ctrl 加选</span>
      <Button
        type="button"
        className="selection-action"
        onClick={clearSelection}
        disabled={!count}
      >
        取消选择
      </Button>
      {picked.audio.length > 0 && (
        <Button
          type="button"
          variant="primary"
          className="selection-action"
          onClick={() => void batchAudio(picked.audio, true)}
        >
          批量配音
        </Button>
      )}
      {picked.shots.length > 0 && (
        <Button
          type="button"
          variant="primary"
          className="selection-action"
          onClick={() => setBatchOpen(true)}
        >
          批量生成
        </Button>
      )}
    </div>
  );
}
