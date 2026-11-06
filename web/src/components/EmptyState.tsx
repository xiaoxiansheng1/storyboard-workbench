import { useWorkbench } from '../store';

export function EmptyState() {
  const setImportOpen = useWorkbench((s) => s.setImportOpen);

  return (
    <div className="empty-state">
      <div className="empty-card">
        <div className="empty-eyebrow">Storyboard Workbench</div>
        <h1>把分镜表变成画布</h1>
        <p className="empty-lead">
          导入 <code>expand_prompts.mjs</code> 导出的 CSV，每个镜头会生成一张卡片，
          按时间轴横向排布、按锚点分层。
        </p>
        <ol className="empty-steps">
          <li>导入 CSV：镜号、时间码、双锚点提示词、负面词、视频提示词</li>
          <li>逐镜生成首帧（4 张候选），点缩略图挑选</li>
          <li>提示词可直接在右侧检查器里改，改完重新生成</li>
        </ol>
        <button type="button" className="primary big" onClick={() => setImportOpen(true)}>
          导入分镜 CSV
        </button>
        <p className="empty-tip">
          示例文件：<code>samples/10月28日-提示词.csv</code>
          <br />
          先用 mock 模式跑通流程，再在 <code>.env</code> 里换成兼容 OpenAI 的端点。
        </p>
      </div>
    </div>
  );
}
