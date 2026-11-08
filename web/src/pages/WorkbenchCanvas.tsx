import { useEffect, useRef, useState } from 'react';
import {
  Background,
  ControlButton,
  Controls,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  useStore,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react';
import { Maximize, Minus, Plus, Redo2, Undo2 } from 'lucide-react';
import { useWorkbench } from '../store';
import type {
  AudioExportJob,
  AudioRun,
  ExportJob,
  Run,
  WorkbenchConfig,
  WorkbenchNodeData,
} from '../types';
import { ShotNode } from '../components/workbench/ShotNode';
import { AudioNode } from '../components/workbench/AudioNode';
import { Toolbar } from '../components/workbench/Toolbar';
import { NodeInspector } from '../components/workbench/NodeInspector';
import { ImportDialog } from '../components/workbench/ImportDialog';
import { SettingsDialog } from '../components/workbench/SettingsDialog';
import { Lightbox } from '../components/workbench/Lightbox';
import { ExportDialog } from '../components/workbench/ExportDialog';
import { BatchDialog } from '../components/workbench/BatchDialog';
import { AudioAddDialog } from '../components/workbench/AudioAddDialog';
import { AudioExportDialog } from '../components/workbench/AudioExportDialog';
import { SelectionBar } from '../components/workbench/SelectionBar';
import { EmptyState } from '../components/workbench/EmptyState';

const nodeTypes = { shot: ShotNode, audio: AudioNode };
const VIEWPORT_PREFIX = 'storyboard-viewport';

function viewportKey(projectId: string) {
  return `${VIEWPORT_PREFIX}:${projectId}`;
}

function readViewport(projectId: string): { x: number; y: number; zoom: number } | null {
  try {
    const raw = sessionStorage.getItem(viewportKey(projectId));
    if (!raw) return null;
    const value = JSON.parse(raw) as { x?: number; y?: number; zoom?: number };
    if (
      typeof value.x === 'number' &&
      typeof value.y === 'number' &&
      typeof value.zoom === 'number'
    ) {
      return { x: value.x, y: value.y, zoom: value.zoom };
    }
  } catch {
    // 忽略无法读取的旧视口
  }
  return null;
}

export function WorkbenchCanvas({ projectId }: { projectId: string }) {
  const nodes = useWorkbench((s) => s.nodes);
  const edges = useWorkbench((s) => s.edges);
  const ready = useWorkbench((s) => s.ready);
  const revision = useWorkbench((s) => s.revision);
  const onNodesChange = useWorkbench((s) => s.onNodesChange);
  const onEdgesChange = useWorkbench((s) => s.onEdgesChange);
  const selectNode = useWorkbench((s) => s.selectNode);
  const beginPositionDrag = useWorkbench((s) => s.beginPositionDrag);
  const commitPositionDrag = useWorkbench((s) => s.commitPositionDrag);
  const undoPositions = useWorkbench((s) => s.undoPositions);
  const redoPositions = useWorkbench((s) => s.redoPositions);
  const undo = useWorkbench((s) => s.undo);
  const redo = useWorkbench((s) => s.redo);
  const applyRun = useWorkbench((s) => s.applyRun);
  const applyAudioRun = useWorkbench((s) => s.applyAudioRun);
  const applyConfig = useWorkbench((s) => s.applyConfig);
  const applyExport = useWorkbench((s) => s.applyExport);
  const applyAudioExport = useWorkbench((s) => s.applyAudioExport);
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const minZoomReached = useStore((s) => s.transform[2] <= s.minZoom);
  const maxZoomReached = useStore((s) => s.transform[2] >= s.maxZoom);
  const nodesInitialized = useNodesInitialized();
  const [restoredViewport] = useState(() => readViewport(projectId));
  const [fitted, setFitted] = useState(restoredViewport !== null);
  const lastFit = useRef(restoredViewport ? 0 : -1);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as {
          type?: string;
          projectId?: string;
          nodeId?: string;
          run?: Run | AudioRun;
          usage?: number;
          config?: WorkbenchConfig;
          job?: ExportJob | AudioExportJob;
        };
        if (message.projectId && message.projectId !== projectId) return;
        if (message.type === 'run' && message.nodeId && message.run) {
          applyRun(message.nodeId, message.run as Run, message.usage);
        }
        if (message.type === 'audio-run' && message.nodeId && message.run) {
          applyAudioRun(message.nodeId, message.run as AudioRun);
        }
        if (message.type === 'settings' && message.config) {
          applyConfig(message.config);
        }
        if (message.type === 'export' && message.job) {
          applyExport(message.job as ExportJob);
        }
        if (message.type === 'audio-export' && message.job) {
          applyAudioExport(message.job as AudioExportJob);
        }
      } catch {
        // 忽略心跳或非 JSON 消息
      }
    };
    return () => source.close();
  }, [applyRun, applyAudioRun, applyConfig, applyExport, applyAudioExport, projectId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      if (document.querySelector('[data-modal-overlay]')) return;
      event.preventDefault();
      if (key === 'y' || event.shiftKey) redoPositions();
      else undoPositions();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undoPositions, redoPositions]);

  useEffect(() => {
    if (!ready || !nodesInitialized || nodes.length === 0) return;
    if (lastFit.current === revision) return;
    const first = !fitted;
    lastFit.current = revision;
    void fitView({ padding: 0.12, duration: first ? 0 : 320 }).then(() => {
      if (first) setFitted(true);
    });
  }, [ready, nodesInitialized, nodes.length, revision, fitted, fitView]);

  const handleNodeClick: NodeMouseHandler<Node<WorkbenchNodeData>> = (_event, node) => {
    selectNode(node.id);
  };

  const persistViewport = (viewport: { x: number; y: number; zoom: number }) => {
    try {
      sessionStorage.setItem(viewportKey(projectId), JSON.stringify(viewport));
    } catch {
      // 忽略持久化失败
    }
  };

  return (
    <>
      <div
        className={`canvas-wrap ${nodes.length > 0 && !fitted ? 'pending' : ''} ${
          fitted ? 'arrived' : ''
        }`}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onPaneClick={() => selectNode(null)}
          onNodeDragStart={(_event, _node, dragged) => {
            beginPositionDrag(dragged.map((item) => item.id));
          }}
          onNodeDragStop={() => commitPositionDrag()}
          defaultViewport={restoredViewport ?? undefined}
          onMoveEnd={(_event, viewport) => persistViewport(viewport)}
          minZoom={0.02}
          maxZoom={1.6}
          fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
          multiSelectionKeyCode={['Control', 'Meta']}
          selectionKeyCode="Shift"
          deleteKeyCode={null}
          proOptions={{ hideAttribution: false }}
        >
          <Background gap={20} size={1.3} color="var(--grid-dot)" />
          <Controls
            showZoom={false}
            showFitView={false}
            showInteractive={false}
            position="bottom-left"
          >
            <ControlButton
              onClick={() => zoomIn()}
              disabled={maxZoomReached}
              title="放大"
              aria-label="放大"
            >
              <Plus size={14} />
            </ControlButton>
            <ControlButton
              onClick={() => zoomOut()}
              disabled={minZoomReached}
              title="缩小"
              aria-label="缩小"
            >
              <Minus size={14} />
            </ControlButton>
            <ControlButton
              onClick={() => void fitView({ padding: 0.12, maxZoom: 1, duration: 320 })}
              title="适应视图"
              aria-label="适应视图"
            >
              <Maximize size={14} />
            </ControlButton>
            <ControlButton
              onClick={undoPositions}
              disabled={undo.length === 0}
              title="撤销移动 (Ctrl+Z)"
              aria-label="撤销移动"
            >
              <Undo2 size={14} />
            </ControlButton>
            <ControlButton
              onClick={redoPositions}
              disabled={redo.length === 0}
              title="重做移动 (Ctrl+Shift+Z)"
              aria-label="重做移动"
            >
              <Redo2 size={14} />
            </ControlButton>
          </Controls>
        </ReactFlow>
        <SelectionBar />
        {ready && nodes.length === 0 && <EmptyState />}
      </div>
      <Toolbar />
      <NodeInspector />
      <ImportDialog />
      <SettingsDialog />
      <ExportDialog />
      <BatchDialog />
      <AudioAddDialog />
      <AudioExportDialog />
      <Lightbox />
    </>
  );
}
