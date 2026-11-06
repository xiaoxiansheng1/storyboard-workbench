import { useMemo } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useWorkbench } from '../store';

export function Toolbar() {
  const project = useWorkbench((s) => s.project);
  const nodes = useWorkbench((s) => s.nodes);
  const busy = useWorkbench((s) => s.busy);
  const setImportOpen = useWorkbench((s) => s.setImportOpen);
  const batch = useWorkbench((s) => s.batch);
  const resetUsage = useWorkbench((s) => s.resetUsage);
  const notify = useWorkbench((s) => s.notify);
  const { fitView } = useReactFlow();

  const stats = useMemo(() => {
    let generated = 0;
    let images = 0;
    let laneA = 0;
    let laneB = 0;
    for (const node of nodes) {
      if (node.data.anchor === 'A') laneA += 1;
      else laneB += 1;
      images += node.data.run.candidates.length;
      if (node.data.run.candidates.length) generated += 1;
    }
    return { total: nodes.length, generated, images, laneA, laneB };
  }, [nodes]);

  const config = project?.config;

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">◧</span>
        <div>
          <div className="brand-title">分镜工作台</div>
          <div className="brand-sub" title={project?.meta.sourceFile || ''}>
            {project?.meta.name || '未导入项目'}
          </div>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <b>{stats.total}</b>
          <span>Shots</span>
        </div>
        <div className="stat">
          <b>{stats.generated}</b>
          <span>Framed</span>
        </div>
        <div className="stat">
          <b>{stats.images}</b>
          <span>Images</span>
        </div>
        <div className="stat">
          <b>
            {stats.laneA} · {stats.laneB}
          </b>
          <span>A / B</span>
        </div>
      </div>

      <div className="toolbar-actions">
        {config && (
          <span
            className={`provider-badge ${config.provider} ${config.hasKey ? '' : 'warn'}`}
            title={`${config.provider} / ${config.model} / ${config.size} · 并发 ${config.concurrency}`}
          >
            <span className="dot" />
            {config.provider === 'mock' ? 'MOCK 占位图' : config.model}
            {!config.hasKey && ' · 缺 Key'}
          </span>
        )}
        {config && (
          <span className="usage" title="今日已生成的图片数 / 每日上限">
            {config.usage}/{config.dailyCap}
          </span>
        )}
        <button type="button" onClick={() => setImportOpen(true)}>
          导入 CSV
        </button>
        <button
          type="button"
          className="primary"
          disabled={!stats.total || busy === 'batch'}
          onClick={() => void batch('missing')}
        >
          生成缺失
        </button>
        <details className="menu">
          <summary>更多</summary>
          <div className="menu-pop">
            <button
              type="button"
              onClick={() => {
                const ok = window.confirm(
                  `将无视已有结果，按当前参数重跑全部 ${stats.total} 个镜头。\n` +
                    `每个镜头 4 张，共 ${stats.total * 4} 张图，请确认预算。`,
                );
                if (ok) void batch('all', 4, true);
              }}
            >
              全部重跑（消耗额度）
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(
                    nodes
                      .map((node) => `${node.data.no}. ${node.data.caption}`)
                      .join('\n'),
                  )
                  .then(() => notify('文案清单已复制'))
                  .catch(() => notify('复制失败'));
              }}
            >
              复制文案清单
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('把今日已生成图片的计数清零？只影响额度统计，不删除任何图片。')) {
                  void resetUsage();
                }
              }}
            >
              重置今日用量
            </button>
          </div>
        </details>
        <button
          type="button"
          onClick={() => void fitView({ padding: 0.12, duration: 400 })}
          disabled={!stats.total}
        >
          全览
        </button>
      </div>
    </header>
  );
}
