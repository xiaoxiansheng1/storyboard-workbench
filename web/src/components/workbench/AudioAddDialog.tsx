import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { FileText, SplitSquareHorizontal } from 'lucide-react';
import { useWorkbench } from '../../store';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Segmented } from '../common/Segmented';
import { Textarea } from '../ui/textarea';
import { parseIntInRange } from '../../utils/number';
import { pad } from '../../utils/format';

type Mode = 'single' | 'import';

const CHUNK_MIN = 20;
const CHUNK_MAX = 500;

export function AudioAddDialog() {
  const open = useWorkbench((s) => s.audioAddOpen);
  const setOpen = useWorkbench((s) => s.setAudioAddOpen);
  const createAudioNode = useWorkbench((s) => s.createAudioNode);
  const createAudioNodes = useWorkbench((s) => s.createAudioNodes);
  const splitAudioText = useWorkbench((s) => s.splitAudioText);
  const selectNode = useWorkbench((s) => s.selectNode);
  const notify = useWorkbench((s) => s.notify);

  const [mode, setMode] = useState<Mode>('single');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [chunkRaw, setChunkRaw] = useState('80');
  const [chunks, setChunks] = useState<string[] | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) return;
    setMode('single');
    setText('');
    setFileName('');
    setChunkRaw('80');
    setChunks(null);
    setSplitting(false);
    setCreating(false);
  }, [open]);

  if (!open) return null;

  const chunkChars = parseIntInRange(chunkRaw, CHUNK_MIN, CHUNK_MAX);
  const chars = chunks?.reduce((sum, item) => sum + item.length, 0) || 0;

  const changeText = (value: string) => {
    setText(value);
    setChunks(null);
  };

  const pickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setReading(true);
    try {
      const content = await file.text();
      setText(content);
      setFileName(file.name);
      setChunks(null);
    } catch {
      notify('读取文本失败', 'error');
    } finally {
      setReading(false);
    }
  };

  const split = async () => {
    if (!text.trim() || !chunkChars || splitting) return;
    setSplitting(true);
    try {
      const res = await splitAudioText(text, chunkChars);
      setChunks(res?.chunks?.length ? res.chunks : null);
    } finally {
      setSplitting(false);
    }
  };

  const submitSingle = async () => {
    if (!text.trim() || creating) return;
    setCreating(true);
    try {
      const node = await createAudioNode(text.trim());
      if (node) {
        setOpen(false);
        selectNode(node.id);
        notify('已新建音频节点', 'success');
      }
    } finally {
      setCreating(false);
    }
  };

  const submitImport = async () => {
    if (!chunks?.length || creating) return;
    setCreating(true);
    try {
      const count = await createAudioNodes(chunks);
      if (count) {
        setOpen(false);
        notify(`已创建 ${count} 个音频节点`, 'success');
      }
    } finally {
      setCreating(false);
    }
  };

  const footer =
    mode === 'single' ? (
      <>
        <Button type="button" onClick={() => setOpen(false)} disabled={creating}>
          取消
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={!text.trim() || creating}
          onClick={() => void submitSingle()}
        >
          {creating ? '创建中…' : '新建音频节点'}
        </Button>
      </>
    ) : (
      <>
        <Button type="button" onClick={() => setOpen(false)} disabled={creating}>
          取消
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={!chunks?.length || creating}
          onClick={() => void submitImport()}
        >
          {creating ? '创建中…' : chunks?.length ? `创建 ${chunks.length} 个节点` : '先拆分预览'}
        </Button>
      </>
    );

  return (
    <Modal
      title="添加音频"
      onClose={() => setOpen(false)}
      closeDisabled={creating}
      size="lg"
      footer={footer}
    >
      <div className="audio-add-tabs">
        <Segmented
          block
          label="添加方式"
          value={mode}
          options={[
            { value: 'single', label: '新建一条' },
            { value: 'import', label: '导入文本' },
          ]}
          onChange={(value) => setMode(value)}
        />
      </div>

      {mode === 'single' ? (
        <>
          <label className="field">
            <span>配音文本</span>
            <Textarea
              className="audio-text-area"
              rows={7}
              spellCheck={false}
              placeholder="输入要配音的文字…"
              value={text}
              onChange={(event) => changeText(event.target.value)}
            />
          </label>
          <p className="modal-note">创建后只建节点，需要在检查器里手动生成音频。</p>
        </>
      ) : (
        <>
          <div className="import-file audio-import-file">
            <div className="import-file-main">
              <b>{fileName || '尚未选择文本文件'}</b>
              <span>{text ? `${text.length} 字` : '支持 TXT / SRT / VTT'}</span>
            </div>
            <Button
              type="button"
              className="import-reselect"
              disabled={reading}
              onClick={() => fileRef.current?.click()}
            >
              <FileText size={13} />
              {reading ? '读取中…' : '选择文件'}
            </Button>
          </div>

          <label className="field">
            <span>文本内容</span>
            <Textarea
              className="audio-text-area"
              rows={6}
              spellCheck={false}
              placeholder="也可以直接粘贴文本…"
              value={text}
              onChange={(event) => {
                changeText(event.target.value);
                if (fileName) setFileName('');
              }}
            />
          </label>

          <div className="audio-split-row">
            <label className={`limit-field ${chunkChars === null ? 'invalid' : ''}`}>
              <span>每段字数</span>
              <input
                type="number"
                inputMode="numeric"
                min={CHUNK_MIN}
                max={CHUNK_MAX}
                step={10}
                value={chunkRaw}
                aria-invalid={chunkChars === null || undefined}
                onChange={(event) => {
                  setChunkRaw(event.target.value);
                  setChunks(null);
                }}
              />
              <small>
                {CHUNK_MIN}–{CHUNK_MAX} 字
              </small>
            </label>
            <Button
              type="button"
              className="audio-split-btn"
              disabled={!text.trim() || chunkChars === null || splitting}
              onClick={() => void split()}
            >
              <SplitSquareHorizontal size={13} />
              {splitting ? '拆分中…' : '拆分预览'}
            </Button>
          </div>

          {chunks && (
            <div className="audio-split-preview">
              <div className="audio-split-summary">
                共 <b>{chunks.length}</b> 段 · {chars} 字
              </div>
              <div className="audio-split-list">
                {chunks.map((chunk, index) => (
                  <div key={index} className="audio-split-item">
                    <span className="audio-split-no">{pad(index + 1)}</span>
                    <span className="audio-split-text">{chunk}</span>
                    <span className="audio-split-len">{chunk.length}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="modal-note">
            按句号、问号等切分，过长的句子再按逗号或字数拆分。导入只创建节点，不会自动生成音频。
          </p>
        </>
      )}

      <input
        ref={fileRef}
        className="file-input"
        type="file"
        accept=".txt,.srt,.vtt,text/plain"
        onChange={(event) => void pickFile(event)}
      />
    </Modal>
  );
}
