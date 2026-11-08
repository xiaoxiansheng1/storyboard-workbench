import type { Node } from '@xyflow/react';
import { useWorkbench } from '../../store';
import type { AudioData, ShotData } from '../../types';
import { ShotInspector } from './Inspector';
import { AudioInspector } from './AudioInspector';

export function NodeInspector() {
  const selectedId = useWorkbench((s) => s.selectedId);
  const node = useWorkbench((s) => s.nodes.find((item) => item.id === selectedId) || null);

  if (!node) return null;
  if (node.type === 'audio') return <AudioInspector node={node as Node<AudioData>} />;
  return <ShotInspector node={node as Node<ShotData>} />;
}
