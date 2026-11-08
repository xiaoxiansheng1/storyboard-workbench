import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkbench } from '../../store';
import { FolderKanban, Moon, PanelTop, Settings, Sun } from 'lucide-react';
import { Button } from '../common/Button';

export function Toolbar() {
  const navigate = useNavigate();
  const project = useWorkbench((s) => s.project);
  const nodes = useWorkbench((s) => s.nodes);
  const theme = useWorkbench((s) => s.theme);
  const setTheme = useWorkbench((s) => s.setTheme);
  const setImportOpen = useWorkbench((s) => s.setImportOpen);
  const setSettingsOpen = useWorkbench((s) => s.setSettingsOpen);
  const setExportOpen = useWorkbench((s) => s.setExportOpen);
  const setAudioAddOpen = useWorkbench((s) => s.setAudioAddOpen);
  const setAudioExportOpen = useWorkbench((s) => s.setAudioExportOpen);
  const exportJob = useWorkbench((s) => s.exportJob);
  const audioExportJob = useWorkbench((s) => s.audioExportJob);

  const stats = useMemo(() => {
    let shots = 0;
    let generated = 0;
    let audio = 0;
    let voiced = 0;
    for (const node of nodes) {
      if (node.type === 'audio') {
        audio += 1;
        if (node.data.run.candidates.length) voiced += 1;
        continue;
      }
      shots += 1;
      if (node.data.run.candidates.length) generated += 1;
    }
    return { shots, generated, audio, voiced };
  }, [nodes]);

  const exporting = exportJob?.status === 'queued' || exportJob?.status === 'running';
  const audioExporting =
    audioExportJob?.status === 'queued' || audioExportJob?.status === 'running';

  const modelLabel =
    project && project.config.provider !== 'mock'
      ? project.config.models.find((item) => item.id === project.config.model)?.label ||
        project.config.model
      : '';

  return (
    <header className="toolbar">
      <div className="brand" title={project?.meta.name || '未导入项目'}>
        <span className="brand-mark">
          <PanelTop size={15} />
        </span>
        <span className="brand-title">分镜工作台</span>
        {project && <span className="brand-project">{project.meta.name}</span>}
      </div>

      <div className="stats">
        <div className="stat">
          <b>{stats.shots}</b>
          <span>镜头</span>
        </div>
        <div className="stat">
          <b>{stats.generated}</b>
          <span>已生成</span>
        </div>
        {stats.audio > 0 && (
          <>
            <div className="stat">
              <b>{stats.audio}</b>
              <span>音频</span>
            </div>
            <div className="stat">
              <b>{stats.voiced}</b>
              <span>已配音</span>
            </div>
          </>
        )}
      </div>

      <div className="toolbar-actions">
        <Button
          type="button"
          className="toolbar-action"
          onClick={() => navigate('/projects')}
          title="项目列表"
        >
          <FolderKanban size={14} />
          项目
        </Button>
        <Button
          type="button"
          className={`toolbar-action${exporting ? ' exporting' : ''}`}
          onClick={() => setExportOpen(true)}
          disabled={stats.shots === 0}
        >
          {exporting ? `视频 ${exportJob?.progress ?? 0}%` : '合成视频'}
        </Button>
        <Button
          type="button"
          className={`toolbar-action${audioExporting ? ' exporting' : ''}`}
          onClick={() => setAudioExportOpen(true)}
          disabled={stats.audio === 0}
        >
          {audioExporting ? `音频 ${audioExportJob?.progress ?? 0}%` : '合成音频'}
        </Button>
        <Button
          type="button"
          className="toolbar-action"
          onClick={() => setAudioAddOpen(true)}
        >
          添加音频
        </Button>
        <Button
          type="button"
          className="toolbar-action"
          onClick={() => setImportOpen(true)}
        >
          导入 CSV
        </Button>
        <Button
          type="button"
          className="theme-toggle"
          onClick={() => setSettingsOpen(true)}
          title={`系统设置${modelLabel ? ` · ${modelLabel}` : ''}`}
          aria-label="系统设置"
        >
          <Settings size={15} />
        </Button>
        <Button
          type="button"
          className="theme-toggle"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? '切换到光亮模式' : '切换到暗黑模式'}
          aria-label={theme === 'dark' ? '切换到光亮模式' : '切换到暗黑模式'}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </Button>
      </div>
    </header>
  );
}
