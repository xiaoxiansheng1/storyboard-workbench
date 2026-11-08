import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, FolderKanban, Moon, Pencil, Plus, Sun, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api';
import { useWorkbench } from '../store';
import type { ProjectSummary } from '../types';
import { Button } from '../components/common/Button';
import { Modal } from '../components/common/Modal';
import styles from './ProjectsPage.module.css';

type DialogState = { mode: 'create' } | { mode: 'rename'; project: ProjectSummary } | null;

function formatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 2 * day) return '昨天';
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const theme = useWorkbench((s) => s.theme);
  const setTheme = useWorkbench((s) => s.setTheme);
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ projects: ProjectSummary[] }>('/api/projects');
      setItems(res.projects);
    } catch (error) {
      setItems([]);
      toast.error(`读取项目失败：${(error as Error).message}`);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const openCreate = () => {
    setName('');
    setDialog({ mode: 'create' });
  };

  const openRename = (project: ProjectSummary) => {
    setName(project.name);
    setDialog({ mode: 'rename', project });
  };

  const submitName = async () => {
    const value = name.trim();
    if (!value || busy || !dialog) return;
    setBusy(true);
    try {
      if (dialog.mode === 'rename') {
        const res = await api<{ project: ProjectSummary }>(`/api/projects/${dialog.project.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: value }),
        });
        setItems((prev) =>
          prev ? prev.map((item) => (item.id === res.project.id ? res.project : item)) : prev,
        );
        setDialog(null);
        toast.success('已重命名');
      } else {
        const res = await api<{ project: ProjectSummary }>('/api/projects', {
          method: 'POST',
          body: JSON.stringify({ name: value }),
        });
        toast.success('项目已创建');
        navigate(`/p/${res.project.id}`);
      }
    } catch (error) {
      toast.error(`操作失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      await api(`/api/projects/${deleting.id}`, { method: 'DELETE' });
      setItems((prev) => (prev ? prev.filter((item) => item.id !== deleting.id) : prev));
      setDeleting(null);
      toast.success('项目已移入回收目录');
    } catch (error) {
      toast.error(`删除失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.mark}>
            <FolderKanban size={15} />
          </span>
          <div className={styles.brandText}>
            <strong>分镜工作台</strong>
            <span>项目</span>
          </div>
        </div>
        <div className={styles.actions}>
          <Button type="button" className={styles.headerAction} onClick={openCreate}>
            <Plus size={14} />
            新建项目
          </Button>
          <Button
            type="button"
            className={styles.themeToggle}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? '切换到光亮模式' : '切换到暗黑模式'}
            aria-label={theme === 'dark' ? '切换到光亮模式' : '切换到暗黑模式'}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </Button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.titleRow}>
          <h1>项目</h1>
          {items && items.length > 0 && (
            <span className={styles.count}>{items.length} 个项目</span>
          )}
        </div>

        {items === null ? (
          <div className={styles.loading}>正在读取项目…</div>
        ) : items.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>
              <FolderKanban size={24} />
            </span>
            <h2>还没有项目</h2>
            <p>新建一个项目，然后导入分镜 CSV 开始生成首帧。</p>
            <Button type="button" variant="primary" onClick={openCreate}>
              <Plus size={14} />
              新建项目
            </Button>
          </div>
        ) : (
          <div className={styles.grid}>
            {items.map((project) => (
              <article
                key={project.id}
                className={styles.card}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/p/${project.id}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(`/p/${project.id}`);
                  }
                }}
              >
                <div className={styles.cover}>
                  {project.cover ? (
                    <img src={project.cover} alt="" loading="lazy" />
                  ) : (
                    <span className={styles.coverEmpty}>
                      <FolderKanban size={22} />
                    </span>
                  )}
                  <div className={styles.cardActions}>
                    <Button
                      type="button"
                      variant="icon"
                      className={styles.cardAction}
                      title="重命名"
                      aria-label="重命名"
                      onClick={(event) => {
                        event.stopPropagation();
                        openRename(project);
                      }}
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      type="button"
                      variant="icon"
                      className={styles.cardAction}
                      title="删除"
                      aria-label="删除"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleting(project);
                      }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
                <div className={styles.cardBody}>
                  <h3 title={project.name}>{project.name}</h3>
                  <p>
                    {project.shots} 镜头 · {project.generated} 已生成
                  </p>
                </div>
                <footer className={styles.cardFoot}>
                  <span>{formatTime(project.updatedAt)}更新</span>
                  <span className={styles.openHint}>
                    打开
                    <ArrowUpRight size={12} />
                  </span>
                </footer>
              </article>
            ))}
          </div>
        )}
      </main>

      {dialog && (
        <Modal
          title={dialog.mode === 'create' ? '新建项目' : '重命名项目'}
          size="sm"
          onClose={() => {
            if (!busy) setDialog(null);
          }}
          closeDisabled={busy}
          footer={
            <>
              <Button type="button" onClick={() => setDialog(null)} disabled={busy}>
                取消
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => void submitName()}
                disabled={!name.trim() || busy}
              >
                {dialog.mode === 'create' ? '创建' : '保存'}
              </Button>
            </>
          }
        >
          <label className={styles.field}>
            <span>项目名称</span>
            <input
              type="text"
              value={name}
              autoFocus
              maxLength={80}
              placeholder="例如：10月28日 纪录片"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitName();
              }}
            />
          </label>
        </Modal>
      )}

      {deleting && (
        <Modal
          title="删除项目"
          size="sm"
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
          closeDisabled={busy}
          footer={
            <>
              <Button type="button" onClick={() => setDeleting(null)} disabled={busy}>
                取消
              </Button>
              <Button
                type="button"
                className={styles.danger}
                onClick={() => void confirmDelete()}
                disabled={busy}
              >
                删除
              </Button>
            </>
          }
        >
          <p className={styles.confirmText}>
            确定删除「{deleting.name}」？项目会移入 <code>data/.trash</code>，需要时可手动恢复。
          </p>
        </Modal>
      )}
    </div>
  );
}
