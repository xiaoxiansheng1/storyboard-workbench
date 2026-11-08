import { Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useWorkbench } from './store';
import { ProjectsPage } from './pages/ProjectsPage';
import { WorkbenchPage } from './pages/WorkbenchPage';

export default function App() {
  const theme = useWorkbench((s) => s.theme);

  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/p/:projectId" element={<WorkbenchPage />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
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
