import { useEffect } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react';
import { useWorkbench } from './store';
import type { Run, ShotData } from './types';
import { ShotNode } from './components/ShotNode';
import { Toolbar } from './components/Toolbar';
import { Inspector } from './components/Inspector';
import { ImportDialog } from './components/ImportDialog';
import { Lightbox } from './components/Lightbox';
import { EmptyState } from './components/EmptyState';
import { Toast } from './components/Toast';

const nodeTypes = { shot: ShotNode };

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
  const { setViewport } = useReactFlow();

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as {
          type?: string;
          nodeId?: string;
          run?: Run;
          usage?: number;
        };
        if (message.type === 'run' && message.nodeId && message.run) {
          applyRun(message.nodeId, message.run, message.usage);
        }
      } catch {
        // 忽略心跳或非 JSON 消息
      }
    };
    return () => source.close();
  }, [applyRun]);

  useEffect(() => {
    if (revision > 0) setViewport({ x: 40, y: 40, zoom: 0.5 });
  }, [revision, setViewport]);

  const handleNodeClick: NodeMouseHandler<Node<ShotData>> = (_event, node) => {
    selectNode(node.id);
  };

  return (
    <>
      <div className="canvas-wrap">
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
          onInit={() => {
            if (revision === 0) setViewport({ x: 40, y: 40, zoom: 0.5 });
          }}
          minZoom={0.02}
          maxZoom={1.6}
          fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
          proOptions={{ hideAttribution: false }}
        >
          <Background gap={28} size={1} color="#565160" />
          <Panel position="top-left" className="canvas-legend">
            <span className="legend-title">Timeline</span>
            <span>
              <i className="lane-dot a" /> A 人物锚点
            </span>
            <span>
              <i className="lane-dot b" /> B 空镜锚点
            </span>
          </Panel>
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            maskColor="rgba(38, 35, 42, 0.5)"
            nodeColor={(node) => ((node.data as ShotData).anchor === 'B' ? '#6b93a4' : '#b09a75')}
          />
        </ReactFlow>
        {ready && nodes.length === 0 && <EmptyState />}
      </div>
      <Toolbar />
      <Inspector />
      <ImportDialog />
      <Lightbox />
      <Toast />
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
