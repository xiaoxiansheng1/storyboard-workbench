import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, ListTodo, RotateCcw, X } from 'lucide-react';
import { useWorkbench } from '../../store';
import type { AudioData, ShotData } from '../../types';
import { Button } from '../common/Button';

type TaskKind = 'shot' | 'audio';
type TaskTab = 'active' | 'failed';

interface Task {
  id: string;
  kind: TaskKind;
  no: number;
  title: string;
  status: 'queued' | 'running' | 'error';
  progress: { done: number; total: number } | null;
  error: string | null;
}

interface ActiveExport {
  key: string;
  label: string;
  progress: number;
  stage: string;
  cancel: () => void;
}

const pad = (no: number) => String(no).padStart(2, '0');
const isActive = (status: string) => status === 'queued' || status === 'running';

function percent(task: Task) {
  if (task.status === 'queued') return 0;
  const progress = task.progress;
  if (!progress || !progress.total) return 1;
  return Math.min(100, Math.round((progress.done / progress.total) * 100));
}

export function TaskCenter() {
  const open = useWorkbench((s) => s.taskOpen);
  const setOpen = useWorkbench((s) => s.setTaskOpen);
  const nodes = useWorkbench((s) => s.nodes);
  const cancelTask = useWorkbench((s) => s.cancelTask);
  const cancelJobs = useWorkbench((s) => s.cancelJobs);
  const focusNode = useWorkbench((s) => s.focusNode);
  const generate = useWorkbench((s) => s.generate);
  const generateAudio = useWorkbench((s) => s.generateAudio);
  const exportJob = useWorkbench((s) => s.exportJob);
  const audioExportJob = useWorkbench((s) => s.audioExportJob);
  const cancelExport = useWorkbench((s) => s.cancelExport);
  const cancelAudioExport = useWorkbench((s) => s.cancelAudioExport);

  const rootRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<TaskTab>('active');
  const [batch, setBatch] = useState<string[]>([]);

  const tasks = useMemo(
    () =>
      nodes
        .map((node): Task | null => {
          if (node.type === 'audio') {
            const data = node.data as AudioData;
            const run = data.run;
            if (!isActive(run.status) && run.status !== 'error') return null;
            return {
              id: node.id,
              kind: 'audio',
              no: Number(data.no) || 0,
              title: String(data.text || '').trim() || '未命名配音',
              status: run.status as Task['status'],
              progress: run.progress,
              error: run.status === 'error' ? run.error : null,
            };
          }
          const data = node.data as ShotData;
          const run = data.run;
          if (!isActive(run.status) && run.status !== 'error') return null;
          return {
            id: node.id,
            kind: 'shot',
            no: Number(data.no) || 0,
            title: String(data.caption || data.promptZh || data.promptEn || '').trim() || '未命名镜头',
            status: run.status as Task['status'],
            progress: run.progress,
            error: run.status === 'error' ? run.error : null,
          };
        })
        .filter((task): task is Task => Boolean(task))
        .sort((a, b) => {
          const order = { running: 0, queued: 1, error: 2 };
          return order[a.status] - order[b.status] || a.no - b.no;
        }),
    [nodes],
  );

  const active = tasks.filter((task) => isActive(task.status));
  const failed = tasks.filter((task) => task.status === 'error');

  const activeKey = active.map((task) => task.id).join(',');

  useEffect(() => {
    if (!activeKey) {
      setBatch((prev) => (prev.length ? [] : prev));
      return;
    }
    const current = activeKey.split(',');
    setBatch((prev) => {
      const missing = current.filter((id) => !prev.includes(id));
      return missing.length ? [...prev, ...missing] : prev;
    });
  }, [activeKey]);

  const queue = useMemo(() => {
    if (!active.length) return null;
    const ids = new Set(batch);
    for (const task of active) ids.add(task.id);
    let total = 0;
    let done = 0;
    for (const node of nodes) {
      if (!ids.has(node.id)) continue;
      const status = node.data.run.status;
      if (status === 'done' || status === 'error') {
        total += 1;
        done += 1;
      } else if (status === 'queued' || status === 'running') {
        total += 1;
      }
    }
    return { done, total };
  }, [active, batch, nodes]);

  const activeExports: ActiveExport[] = [];
  if (exportJob && isActive(exportJob.status)) {
    activeExports.push({
      key: 'video',
      label: '视频合成',
      progress: exportJob.progress ?? 0,
      stage: exportJob.stage || '',
      cancel: () => void cancelExport(exportJob.id),
    });
  }
  if (audioExportJob && isActive(audioExportJob.status)) {
    activeExports.push({
      key: 'audio',
      label: '音频合成',
      progress: audioExportJob.progress ?? 0,
      stage: audioExportJob.stage || '',
      cancel: () => void cancelAudioExport(audioExportJob.id),
    });
  }

  const visible = active.length > 0 || failed.length > 0;

  useEffect(() => {
    if (!open) return;
    setTab(active.length === 0 && failed.length > 0 ? 'failed' : 'active');
    // 只在面板打开时按当前任务情况选择默认页签
  }, [open]);

  useEffect(() => {
    if (!visible && open) setOpen(false);
  }, [visible, open, setOpen]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  if (!visible) return null;

  const busy = active.length > 0;
  const visibleTasks = tab === 'active' ? active : failed;

  const retry = (task: Task) => {
    if (task.kind === 'audio') void generateAudio(task.id, true);
    else void generate(task.id, { force: true });
  };

  const retryAll = () => {
    for (const task of failed) retry(task);
  };

  return (
    <div className="task-hud" ref={rootRef}>
      <Button
        type="button"
        className={`task-trigger${busy ? ' busy' : ''}${!busy && failed.length ? ' alert' : ''}`}
        aria-expanded={open}
        aria-controls="task-popover"
        onClick={() => setOpen(!open)}
      >
        {busy || failed.length > 0 ? (
          <span className={`task-dot${busy ? ' busy' : ' alert'}`} />
        ) : (
          <ListTodo size={13} />
        )}
        任务
      </Button>
      {queue && (
        <span className="task-stat" title="当前队列已完成 / 总数">
          完成{' '}
          <b className="hot">
            {queue.done}/{queue.total}
          </b>
        </span>
      )}

      {open && (
        <div className="task-popover" id="task-popover" role="dialog" aria-label="任务中心">
          <div className="task-tabs" role="tablist" aria-label="任务分类">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'active'}
              className={tab === 'active' ? 'on' : ''}
              onClick={() => setTab('active')}
            >
              进行中 <b>{active.length}</b>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'failed'}
              className={tab === 'failed' ? 'on' : ''}
              onClick={() => setTab('failed')}
            >
              失败 <b className={failed.length ? 'bad' : ''}>{failed.length}</b>
            </button>
          </div>

          <div className="task-body">
            {activeExports.length > 0 && (
              <section className="task-exports">
                <h4>合成任务</h4>
                {activeExports.map((item) => (
                  <div className="task-export-row" key={item.key}>
                    <span className="task-kind export">{item.label}</span>
                    <div className="task-info">
                      <div className="task-head">
                        <span className="task-title">{item.stage || '处理中'}</span>
                        <span className="task-status running">合成中</span>
                      </div>
                      <div className="task-progress-wrap">
                        <div className="task-progress">
                          <i style={{ width: `${Math.min(100, Math.max(1, item.progress))}%` }} />
                        </div>
                        <span className="task-progress-text">{item.progress}%</span>
                      </div>
                    </div>
                    <div className="task-actions">
                      <Button type="button" variant="icon" title="取消合成" onClick={item.cancel}>
                        <X size={13} />
                      </Button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {visibleTasks.length ? (
              <ul className="task-list">
                {visibleTasks.map((task) => (
                  <li key={task.id} className={`task-row ${task.status}`}>
                    <span className={`task-kind ${task.kind}`}>
                      {task.kind === 'audio' ? '配音' : '首帧'}
                    </span>
                    <div className="task-info">
                      <div className="task-head">
                        <span className="task-no">{pad(task.no)}</span>
                        <span className="task-title" title={task.title}>
                          {task.title}
                        </span>
                        <span className={`task-status ${task.status}`}>
                          {task.status === 'running'
                            ? '生成中'
                            : task.status === 'queued'
                              ? '排队中'
                              : '失败'}
                        </span>
                      </div>
                      {task.status === 'running' && (
                        <div className="task-progress-wrap">
                          <div className="task-progress">
                            <i style={{ width: `${percent(task)}%` }} />
                          </div>
                          {task.progress && task.progress.total > 1 && (
                            <span className="task-progress-text">
                              {task.progress.done}/{task.progress.total}
                            </span>
                          )}
                        </div>
                      )}
                      {task.error && (
                        <p className="task-error" title={task.error}>
                          {task.error}
                        </p>
                      )}
                    </div>
                    <div className="task-actions">
                      <Button
                        type="button"
                        variant="icon"
                        title="定位到画布节点"
                        onClick={() => focusNode(task.id)}
                      >
                        <Crosshair size={13} />
                      </Button>
                      {task.status === 'error' ? (
                        <Button type="button" variant="icon" title="重试" onClick={() => retry(task)}>
                          <RotateCcw size={13} />
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="icon"
                          title="取消任务"
                          onClick={() => void cancelTask(task.id)}
                        >
                          <X size={13} />
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="task-empty">
                {tab === 'active' ? '暂无进行中的任务' : '暂无失败任务'}
              </div>
            )}
          </div>

          <div className="task-pop-foot">
            {tab === 'failed' && failed.length > 0 && (
              <Button type="button" onClick={retryAll}>
                重试全部失败
              </Button>
            )}
            <Button type="button" disabled={!busy} onClick={() => void cancelJobs()}>
              停止全部
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
