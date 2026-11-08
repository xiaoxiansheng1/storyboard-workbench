import { useWorkbench } from '../../store';
import { Button } from '../common/Button';

export function EmptyState() {
  const setImportOpen = useWorkbench((s) => s.setImportOpen);

  return (
    <div className="empty-state">
      <div className="empty-card">
        <h1>把分镜表变成画布</h1>
        <p className="empty-lead">
          导入 CSV，每个镜头生成一张卡片。逐镜生成首帧，提示词可以直接在右侧修改。
        </p>
        <Button type="button" variant="primary" big onClick={() => setImportOpen(true)}>
          导入分镜 CSV
        </Button>
        <p className="empty-tip">示例：samples/10月28日-提示词.csv</p>
      </div>
    </div>
  );
}
