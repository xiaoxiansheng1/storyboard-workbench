import { useEffect } from 'react';
import { useWorkbench } from '../store';
import { IconClose } from './icons';

export function Lightbox() {
  const lightbox = useWorkbench((s) => s.lightbox);
  const node = useWorkbench(
    (s) => (lightbox ? s.nodes.find((item) => item.id === lightbox.nodeId) || null : null),
  );
  const setLightbox = useWorkbench((s) => s.setLightbox);

  const candidates = node?.data.run.candidates || [];
  const index = lightbox ? Math.min(Math.max(lightbox.index, 0), Math.max(candidates.length - 1, 0)) : 0;
  const candidate = candidates[index];

  useEffect(() => {
    if (!lightbox || !node || !candidate) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, node, candidate, setLightbox]);

  if (!lightbox || !node || !candidate) return null;

  return (
    <div className="overlay lightbox" onClick={() => setLightbox(null)}>
      <div className="lightbox-inner" onClick={(event) => event.stopPropagation()}>
        <div className="lightbox-head">
          <div>
            <b>镜头 {String(node.data.no).padStart(2, '0')}</b>
            <span className="lightbox-sub">
              {node.data.srtStart} → {node.data.srtEnd} · {node.data.duration.toFixed(2)}s
            </span>
          </div>
          <button type="button" className="icon-btn" onClick={() => setLightbox(null)} title="关闭">
            <IconClose size={15} />
          </button>
        </div>

        <div className="lightbox-stage">
          <img src={candidate.url} alt={`镜头 ${node.data.no}`} />
        </div>

        <div className="lightbox-foot">
          {node.data.caption && <div className="lightbox-caption">{node.data.caption}</div>}
          <div className="lightbox-actions">
            <a className="button-link" href={candidate.url} download>
              下载
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
