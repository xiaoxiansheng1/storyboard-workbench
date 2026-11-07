import { useEffect, useRef, useState } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react';
import { useWorkbench } from './store';
import type { ExportJob, Run, ShotData, WorkbenchConfig } from './types';
import { ShotNode } from './components/ShotNode';
import { Toolbar } from './components/Toolbar';
import { Inspector } from './components/Inspector';
import { ImportDialog } from './components/ImportDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { Lightbox } from './components/Lightbox';
import { ExportDialog } from './components/ExportDialog';
import { BatchDialog } from './components/BatchDialog';
import { SelectionBar } from './components/SelectionBar';
import { EmptyState } from './components/EmptyState';
import { Toaster } from 'sonner';

const nodeTypes = { shot: ShotNode };
const VIEWPORT_KEY = 'storyboard-viewport';

function readViewport(): { x: number; y: number; zoom: number } | null {
  try {
    const raw = sessionStorage.getItem(VIEWPORT_KEY);
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

function Canvas() {
  const nodes = useWorkbench((s) => s.nodes);
  const edges = useWorkbench((s) => s.edges);
  const ready = useWorkbench((s) => s.ready);
  const revision = useWorkbench((s) => s.revision);
  const onNodesChange = useWorkbench((s) => s.onNodesChange);
  const onEdgesChange = useWorkbench((s) => s.onEdgesChange);
  const selectNode = useWorkbench((s) => s.selectNode);
  const persistPosition = useWorkbench((s) => s.persistPosition);
  const applyRun = useWorkbench((s) => s.applyRun);
  const applyConfig = useWorkbench((s) => s.applyConfig);
  const applyExport = useWorkbench((s) => s.applyExport);
  const theme = useWorkbench((s) => s.theme);
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const [restoredViewport] = useState(readViewport);
  const [fitted, setFitted] = useState(restoredViewport !== null);
  const lastFit = useRef(restoredViewport ? 0 : -1);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as {
          type?: string;
          nodeId?: string;
          run?: Run;
          usage?: number;
          config?: WorkbenchConfig;
          job?: ExportJob;
        };
        if (message.type === 'run' && message.nodeId && message.run) {
          applyRun(message.nodeId, message.run, message.usage);
        }
        if (message.type === 'settings' && message.config) {
          applyConfig(message.config);
        }
        if (message.type === 'export' && message.job) {
          applyExport(message.job);
        }
      } catch {
        // 忽略心跳或非 JSON 消息
      }
    };
    return () => source.close();
  }, [applyRun, applyConfig, applyExport]);

  useEffect(() => {
    if (!ready || !nodesInitialized || nodes.length === 0) return;
    if (lastFit.current === revision) return;
    const first = !fitted;
    lastFit.current = revision;
    void fitView({ padding: 0.12, duration: first ? 0 : 320 }).then(() => {
      if (first) setFitted(true);
    });
  }, [ready, nodesInitialized, nodes.length, revision, fitted, fitView]);

  const handleNodeClick: NodeMouseHandler<Node<ShotData>> = (_event, node) => {
    selectNode(node.id);
  };

  const persistViewport = (viewport: { x: number; y: number; zoom: number }) => {
    try {
      sessionStorage.setItem(VIEWPORT_KEY, JSON.stringify(viewport));
    } catch {
      // 忽略持久化失败
    }
  };

  return (
    <>
      <div className={`canvas-wrap ${nodes.length > 0 && !fitted ? 'pending' : ''}`}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onPaneClick={() => selectNode(null)}
          onNodeDragStop={(_event, node) => {
            void persistPosition(node.id);
          }}
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
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
        <SelectionBar />
        {ready && nodes.length === 0 && <EmptyState />}
      </div>
      <Toolbar />
      <Inspector />
      <ImportDialog />
      <SettingsDialog />
      <ExportDialog />
      <BatchDialog />
      <Lightbox />
      <Toaster
        position="top-left"
        theme={theme}
        offset={{ top: 64, left: 16 }}
        visibleToasts={3}
        richColors
        toastOptions={{
          style: {
            borderRadius: '9px',
            fontFamily: 'var(--font-ui)',
            fontSize: '12px',
          },
        }}
      />
    </>
  );
}

export default function App() {
  const load = useWorkbench((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
