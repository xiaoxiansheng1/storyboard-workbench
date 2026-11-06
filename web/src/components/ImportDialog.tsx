import { useEffect, useState } from 'react';
import { useWorkbench } from '../store';

export function ImportDialog() {
  const open = useWorkbench((s) => s.importOpen);
  const setOpen = useWorkbench((s) => s.setImportOpen);
  const importCsv = useWorkbench((s) => s.importCsv);
  const nodeCount = useWorkbench((s) => s.nodes.length);
  const busy = useWorkbench((s) => s.busy === 'import');

  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);

  useEffect(() => {
    if (open) return;
    setText('');
    setName('');
    setFileName('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      const content = await file.text();
      setText(content);
      setFileName(file.name);
      if (!name) setName(file.name.replace(/\.csv$/i, ''));
    } finally {
      setReading(false);
    }
  };

  const canSubmit = text.trim().length > 0 && !busy && !reading;

  return (
    <div className="overlay" onClick={() => setOpen(false)}>
      <div className="modal import-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-eyebrow">Import</div>
            <h2>导入分镜 CSV</h2>
          </div>
          <button type="button" className="icon-btn" onClick={() => setOpen(false)}>
            ×
          </button>
        </div>

        <p className="modal-note">
          使用 <code>expand_prompts.mjs</code> 导出的 11 列 CSV。导入会替换当前画布；
          提示词未变的镜头会保留已生成的图。
          {nodeCount > 0 && <span className="warn"> 当前已有 {nodeCount} 个镜头。</span>}
        </p>

        <div className="file-row">
          <label className="file-button">
            选择 CSV 文件
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(event) => void pickFile(event.target.files?.[0])}
            />
          </label>
          <span className="file-name">{fileName || '未选择文件，也可以直接粘贴'}</span>
        </div>

        <label className="field">
          <span>项目名称</span>
          <input
            type="text"
            value={name}
            placeholder="例如：10月28日"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className="field">
          <span>CSV 内容</span>
          <textarea
            className="csv-input"
            rows={10}
            placeholder="镜号,SRT起始,SRT结束,时长(秒),锚点,文案,中文提示词,English Prompt,负面词(中文),Negative Prompt,视频提示词"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>

        <div className="modal-actions">
          <button type="button" onClick={() => setOpen(false)}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={!canSubmit}
            onClick={() => void importCsv(text, name || fileName || '未命名分镜', fileName || undefined)}
          >
            {busy ? '导入中…' : reading ? '读取中…' : '导入并重建画布'}
          </button>
        </div>
      </div>
    </div>
  );
}
