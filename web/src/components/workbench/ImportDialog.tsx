import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useWorkbench } from '../../store';
import type { ImportResponse } from '../../types';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { clock, formatSize } from '../../utils/format';

type Stage = 'pick' | 'preview' | 'done';

export function ImportDialog() {
  const open = useWorkbench((s) => s.importOpen);
  const setOpen = useWorkbench((s) => s.setImportOpen);
  const importCsv = useWorkbench((s) => s.importCsv);
  const nodeCount = useWorkbench((s) => s.nodes.length);
  const notify = useWorkbench((s) => s.notify);
  const busy = useWorkbench((s) => s.busy === 'import');

  const [stage, setStage] = useState<Stage>('pick');
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) return;
    setStage('pick');
    setText('');
    setName('');
    setFileName('');
    setFileSize(0);
    setDragging(false);
    setResult(null);
  }, [open]);

  if (!open) return null;

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      const content = await file.text();
      setText(content);
      setFileName(file.name);
      setFileSize(file.size);
      setName(file.name.replace(/\.csv$/i, ''));
      setResult(null);
      setStage('preview');
    } catch {
      notify('读取 CSV 失败', 'error');
    } finally {
      setReading(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    void pickFile(event.dataTransfer.files?.[0]);
  };

  const submit = async () => {
    const res = await importCsv(
      text,
      name.trim() || fileName.replace(/\.csv$/i, '') || '未命名分镜',
      fileName || undefined,
    );
    if (res) {
      setResult(res);
      setStage('done');
    }
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
  };

  const fileInput = (
    <input
      ref={inputRef}
      className="file-input"
      type="file"
      accept=".csv,text/csv,text/plain"
      onChange={(event) => {
        void pickFile(event.target.files?.[0]);
        event.target.value = '';
      }}
    />
  );

  return (
    <Modal
      title={stage === 'done' ? '导入完成' : stage === 'preview' ? '确认导入' : '导入分镜 CSV'}
      onClose={close}
      size="lg"
      closeDisabled={busy}
      footer={
        stage === 'preview' ? (
          <>
            <Button type="button" onClick={close}>
              取消
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={busy || !text.trim()}
              onClick={() => void submit()}
            >
              {busy ? '导入中…' : '导入并重建画布'}
            </Button>
          </>
        ) : stage === 'done' ? (
          <Button type="button" variant="primary" onClick={close}>
            完成
          </Button>
        ) : undefined
      }
    >
      {stage === 'pick' && (
        <>
          <div
            className={`dropzone ${dragging ? 'dragging' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <span className="dropzone-title">
              {reading ? '正在读取…' : '拖入 CSV 文件，或点击选择'}
            </span>
            <span className="dropzone-hint">11 列分镜表</span>
            <span className="dropzone-action">选择文件</span>
          </div>
          <p className="modal-note">
            导入会替换当前画布，提示词未变的镜头保留已生成的图。
            {nodeCount > 0 && <span className="warn"> 当前已有 {nodeCount} 个镜头。</span>}
          </p>
        </>
      )}

      {stage === 'preview' && (
        <>
          <div className="import-file">
            <div className="import-file-main">
              <b>{fileName}</b>
              <span>
                {formatSize(fileSize)} · {text.split(/\r?\n/).filter(Boolean).length} 行
              </span>
            </div>
            <Button
              type="button"
              className="import-reselect"
              onClick={() => inputRef.current?.click()}
            >
              重新选择
            </Button>
          </div>

          {nodeCount > 0 && (
            <p className="modal-note warn">将替换当前画布的 {nodeCount} 个镜头。</p>
          )}

          <label className="field">
            <span>项目名称</span>
            <input
              type="text"
              value={name}
              placeholder="例如：10月28日"
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <div className="field">
            <span>CSV 内容</span>
            <pre className="csv-preview">{text}</pre>
          </div>
        </>
      )}

      {stage === 'done' && result && (
        <>
          <div className="import-summary">
            <div className="import-summary-name">{result.project.meta.name}</div>
            <div className="summary-grid">
              <div>
                <b>{result.stats.count}</b>
                <span>镜头</span>
              </div>
              <div>
                <b>{clock(result.stats.span)}</b>
                <span>总时长</span>
              </div>
              {(result.stats.reused ?? 0) > 0 && (
                <div>
                  <b>{result.stats.reused}</b>
                  <span>复用已生成</span>
                </div>
              )}
              {result.stats.warnings.length > 0 && (
                <div>
                  <b>{result.stats.warnings.length}</b>
                  <span>提示</span>
                </div>
              )}
            </div>
            {result.stats.warnings.length > 0 && (
              <ul className="summary-warnings">
                {result.stats.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {fileInput}
    </Modal>
  );
}
