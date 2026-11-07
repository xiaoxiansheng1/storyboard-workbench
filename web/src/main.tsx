import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import App from './App';
import { useWorkbench } from './store';

document.documentElement.dataset.theme = useWorkbench.getState().theme;

createRoot(document.getElementById('root')!).render(<App />);
