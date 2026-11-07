import { useMemo } from 'react';
import { useWorkbench } from '../store';
import { IconFrame, IconMoon, IconSettings, IconSun } from './icons';

export function Toolbar() {
  const project = useWorkbench((s) => s.project);
  const nodes = useWorkbench((s) => s.nodes);
  const theme = useWorkbench((s) => s.theme);
  const setTheme = useWorkbench((s) => s.setTheme);
  const setImportOpen = useWorkbench((s) => s.setImportOpen);
  const setSettingsOpen = useWorkbench((s) => s.setSettingsOpen);
  const setExportOpen = useWorkbench((s) => s.setExportOpen);
  const exportJob = useWorkbench((s) => s.exportJob);

  const stats = useMemo(() => {
    let generated = 0;
    for (const node of nodes) {
      if (node.data.run.candidates.length) generated += 1;
    }
    return { total: nodes.length, generated };
  }, [nodes]);

  const exporting = exportJob?.status === 'queued' || exportJob?.status === 'running';

  const modelLabel =
    project && project.config.provider !== 'mock'
      ? project.config.models.find((item) => item.id === project.config.model)?.label ||
        project.config.model
      : '';

  return (
    <header className="toolbar">
      <div className="brand" title={project?.meta.name || '未导入项目'}>
        <span className="brand-mark">
          <IconFrame size={15} />
        </span>
        <span className="brand-title">分镜工作台</span>
      </div>

      <div className="stats">
        <div className="stat">
          <b>{stats.total}</b>
          <span>镜头</span>
        </div>
        <div className="stat">
          <b>{stats.generated}</b>
          <span>已生成</span>
        </div>
      </div>

      <div className="toolbar-actions">
        <button
          type="button"
          onClick={() => setExportOpen(true)}
          disabled={nodes.length === 0}
          className={exporting ? 'exporting' : undefined}
        >
          {exporting ? `合成中 ${exportJob?.progress ?? 0}%` : '合成视频'}
        </button>
        <button type="button" onClick={() => setImportOpen(true)}>
          导入 CSV
        </button>
        <button
          type="button"
          className="theme-toggle"
          onClick={() => setSettingsOpen(true)}
          title={`系统设置${modelLabel ? ` · ${modelLabel}` : ''}`}
          aria-label="系统设置"
        >
          <IconSettings size={15} />
        </button>
        <button
          type="button"
          className="theme-toggle"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? '切换到光亮模式' : '切换到暗黑模式'}
          aria-label={theme === 'dark' ? '切换到光亮模式' : '切换到暗黑模式'}
        >
          {theme === 'dark' ? <IconSun size={15} /> : <IconMoon size={15} />}
        </button>
      </div>
    </header>
  );
}
