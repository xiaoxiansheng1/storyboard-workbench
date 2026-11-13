import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@xyflow/react/dist/style.css';
import './styles.css';
import App from './App';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useWorkbench } from './store';

document.documentElement.dataset.theme = useWorkbench.getState().theme;

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </ErrorBoundary>,
);
