import { useEffect } from 'react';
import { useWorkbench } from '../store';

export function Toast() {
  const toast = useWorkbench((s) => s.toast);
  const notify = useWorkbench((s) => s.notify);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => notify(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast, notify]);

  if (!toast) return null;
  return (
    <div className="toast" role="status" onClick={() => notify(null)}>
      {toast}
    </div>
  );
}
