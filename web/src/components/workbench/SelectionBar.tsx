import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useWorkbench } from '../../store';
import { Button } from '../common/Button';
import { TaskCenter } from './TaskCenter';

export const SelectionBar = memo(function SelectionBar() {
  const selectedId = useWorkbench((s) => s.selectedId);
  const setBatchOpen = useWorkbench((s) => s.setBatchOpen);
  const clearSelection = useWorkbench((s) => s.clearSelection);
  const batchAudio = useWorkbench((s) => s.batchAudio);
  // 只订阅选中数量：拖动期间选中集合不变，选择栏不随每帧重渲染；id 在点击时再取
  const picked = useWorkbench(
    useShallow((s) => {
      let shots = 0;
      let audio = 0;
      for (const node of s.nodes) {
        if (!node.selected) continue;
        if (node.type === 'audio') audio += 1;
        else shots += 1;
      }
      return { shots, audio };
    }),
  );

  const count = picked.shots + picked.audio;

  return (
    <div className={`selection-bar ${selectedId ? 'with-inspector' : ''}`}>
      <TaskCenter />
      <span className="selection-count" aria-live="polite">
        {count ? (
          <>
            已选 {picked.shots > 0 && <b>{picked.shots}</b>}
            {picked.shots > 0 && ' 镜'}
            {picked.shots > 0 && picked.audio > 0 && ' · '}
            {picked.audio > 0 && <b>{picked.audio}</b>}
            {picked.audio > 0 && ' 音频'}
          </>
        ) : (
          '未选择节点'
        )}
      </span>
      <span className="selection-hint">Shift 框选 · Ctrl 加选</span>
      <Button type="button" className="selection-action" onClick={clearSelection} disabled={!count}>
        取消选择
      </Button>
      {picked.audio > 0 && (
        <Button
          type="button"
          variant="primary"
          className="selection-action"
          onClick={() => {
            const audioIds = useWorkbench
              .getState()
              .nodes.filter((node) => node.selected && node.type === 'audio')
              .map((node) => node.id);
            void batchAudio(audioIds, true);
          }}
        >
          批量配音
        </Button>
      )}
      {picked.shots > 0 && (
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
});
