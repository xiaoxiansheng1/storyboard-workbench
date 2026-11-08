import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Link, useParams } from 'react-router-dom';
import { useWorkbench } from '../store';
import { Button } from '../components/common/Button';
import { WorkbenchCanvas } from './WorkbenchCanvas';

function ProjectMissing() {
  return (
    <div className="route-loading">
      <div className="empty-card">
        <h1>项目不存在</h1>
        <p className="empty-lead">它可能已被删除，或链接有误。</p>
        <Button asChild variant="primary" big>
          <Link to="/projects">返回项目列表</Link>
        </Button>
      </div>
    </div>
  );
}

export function WorkbenchPage() {
  const { projectId = '' } = useParams();
  const load = useWorkbench((s) => s.load);
  const ready = useWorkbench((s) => s.ready);
  const notFound = useWorkbench((s) => s.notFound);
  const activeId = useWorkbench((s) => s.projectId);

  useEffect(() => {
    void load(projectId);
  }, [load, projectId]);

  if (notFound) return <ProjectMissing />;
  if (activeId !== projectId || !ready) {
    return <div className="route-loading">正在打开项目…</div>;
  }

  return (
    <ReactFlowProvider key={projectId}>
      <WorkbenchCanvas projectId={projectId} />
    </ReactFlowProvider>
  );
}
