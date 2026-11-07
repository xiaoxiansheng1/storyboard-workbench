import { useMemo } from 'react';
import { useWorkbench } from '../store';

export function SelectionBar() {
  const nodes = useWorkbench((s) => s.nodes);
  const selectedId = useWorkbench((s) => s.selectedId);
  const setBatchOpen = useWorkbench((s) => s.setBatchOpen);
  const clearSelection = useWorkbench((s) => s.clearSelection);
  const count = useMemo(() => nodes.filter((node) => node.selected).length, [nodes]);

  return (
    <div className={`selection-bar ${selectedId ? 'with-inspector' : ''}`} role="status">
      <span className="selection-count">
        {count ? (
          <>
            已选 <b>{count}</b> 个镜头
          </>
        ) : (
          '未选择镜头'
        )}
      </span>
      <span className="selection-hint">Shift 框选 · Ctrl 加选</span>
      <button type="button" onClick={clearSelection} disabled={!count}>
        取消选择
      </button>
      <button
        type="button"
        className="primary"
        onClick={() => setBatchOpen(true)}
        disabled={!count}
      >
        批量生成
      </button>
    </div>
  );
}
