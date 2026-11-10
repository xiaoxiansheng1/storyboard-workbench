import type { Edge, Node, XYPosition } from '@xyflow/react';
import type { AudioData, ProjectNode, WorkbenchNodeData } from '../types';

export const NODE_WIDTH = 360;
export const AUDIO_WIDTH = 330;
export const HISTORY_LIMIT = 50;

export type PositionChange = { id: string; from: XYPosition; to: XYPosition };

export function toFlowNode(node: ProjectNode): Node<WorkbenchNodeData> {
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    data: node.data,
    style: { width: node.type === 'audio' ? AUDIO_WIDTH : NODE_WIDTH },
  };
}

export function toFlowEdge(edge: { id: string; source: string; target: string; kind?: string }): Edge {
  const audio = edge.kind === 'audio';
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'smoothstep',
    selectable: audio,
    interactionWidth: audio ? 16 : 20,
    className: audio ? 'audio-edge' : 'shot-edge',
    data: { kind: audio ? 'audio' : 'shot' },
    style: audio
      ? {
          stroke: 'var(--edge)',
          strokeWidth: 1.3,
          strokeDasharray: '3 7',
        }
      : {
          stroke: 'var(--edge)',
          strokeWidth: 1.3,
          strokeDasharray: '3 7',
        },
  };
}

export function patchNodeList(
  nodes: Node<WorkbenchNodeData>[],
  serverNode: ProjectNode,
): Node<WorkbenchNodeData>[] {
  return nodes.map((node) =>
    node.id === serverNode.id
      ? { ...node, position: serverNode.position, data: serverNode.data }
      : node,
  );
}

export function patchAudioList(
  nodes: Node<WorkbenchNodeData>[],
  serverNode: ProjectNode,
): Node<WorkbenchNodeData>[] {
  return nodes.map((node) =>
    node.id === serverNode.id
      ? { ...node, position: serverNode.position, data: serverNode.data as AudioData }
      : node,
  );
}

export function withAudioData(
  nodes: Node<WorkbenchNodeData>[],
  id: string,
  patch: Partial<AudioData>,
): Node<WorkbenchNodeData>[] {
  return nodes.map((node) =>
    node.id === id ? { ...node, data: { ...(node.data as AudioData), ...patch } } : node,
  );
}

export function withAudioNos(
  nodes: Node<WorkbenchNodeData>[],
  renumbered: { id: string; position?: { x: number; y: number }; data: { no: number } }[],
): Node<WorkbenchNodeData>[] {
  const map = new Map(renumbered.map((item) => [item.id, item]));
  return nodes.map((node) => {
    const item = map.get(node.id);
    if (!item) return node;
    return {
      ...node,
      ...(item.position ? { position: item.position } : null),
      data: { ...(node.data as AudioData), no: Number(item.data?.no) },
    };
  });
}

export function withPositions(
  nodes: Node<WorkbenchNodeData>[],
  positions: Record<string, XYPosition>,
): Node<WorkbenchNodeData>[] {
  return nodes.map((node) =>
    positions[node.id] ? { ...node, position: { ...positions[node.id] } } : node,
  );
}

export function projectBase(state: { projectId: string | null }): string {
  return state.projectId ? `/api/projects/${state.projectId}` : '/api';
}
