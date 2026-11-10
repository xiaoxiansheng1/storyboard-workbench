import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useWorkbench } from '../../store';
import type { AudioData, ShotData } from '../../types';
import { ShotInspector } from './Inspector';
import { AudioInspector } from './AudioInspector';

export const NodeInspector = memo(function NodeInspector() {
  const node = useWorkbench(
    useShallow((s) => {
      const found = s.nodes.find((item) => item.id === s.selectedId);
      // 只取 id/type/data：拖动只改 position，data 引用不变，检查器不随拖动重渲染
      return found ? { id: found.id, type: found.type, data: found.data } : null;
    }),
  );

  if (!node) return null;
  if (node.type === 'audio') {
    return <AudioInspector node={{ id: node.id, data: node.data as AudioData }} />;
  }
  return <ShotInspector node={{ id: node.id, data: node.data as ShotData }} />;
});
