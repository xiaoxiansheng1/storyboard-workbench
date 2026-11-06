import { useEffect } from 'react';
import { useWorkbench } from '../store';

export function Lightbox() {
  const lightbox = useWorkbench((s) => s.lightbox);
  const node = useWorkbench(
    (s) => (lightbox ? s.nodes.find((item) => item.id === lightbox.nodeId) || null : null),
  );
  const setLightbox = useWorkbench((s) => s.setLightbox);
  const selectCandidate = useWorkbench((s) => s.selectCandidate);

  const candidates = node?.data.run.candidates || [];
  const index = lightbox ? Math.min(Math.max(lightbox.index, 0), Math.max(candidates.length - 1, 0)) : 0;
  const candidate = candidates[index];

  useEffect(() => {
    if (!lightbox || !node || !candidates.length) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightbox(null);
      if (event.key === 'ArrowRight') {
        setLightbox({ nodeId: node.id, index: (index + 1) % candidates.length });
      }
      if (event.key === 'ArrowLeft') {
        setLightbox({ nodeId: node.id, index: (index - 1 + candidates.length) % candidates.length });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, node, candidates.length, index, setLightbox]);

  if (!lightbox || !node || !candidate) return null;

  const selected = candidate.id === node.data.run.selectedId;

  return (
    <div className="overlay lightbox" onClick={() => setLightbox(null)}>
      <div className="lightbox-inner" onClick={(event) => event.stopPropagation()}>
        <div className="lightbox-head">
          <div>
            <b>#{String(node.data.no).padStart(2, '0')}</b>
            <span className="lightbox-sub">
              {node.data.srtStart} → {node.data.srtEnd} · {node.data.duration.toFixed(2)}s · 候选{' '}
              {index + 1}/{candidates.length}
            </span>
          </div>
          <button type="button" className="icon-btn" onClick={() => setLightbox(null)}>
            ×
          </button>
        </div>

        <div className="lightbox-stage">
          {candidates.length > 1 && (
            <button
              type="button"
              className="nav prev"
              onClick={() =>
                setLightbox({
                  nodeId: node.id,
                  index: (index - 1 + candidates.length) % candidates.length,
                })
              }
            >
              ‹
            </button>
          )}
          <img src={candidate.url} alt={`镜头 ${node.data.no}`} />
          {candidates.length > 1 && (
            <button
              type="button"
              className="nav next"
              onClick={() => setLightbox({ nodeId: node.id, index: (index + 1) % candidates.length })}
            >
              ›
            </button>
          )}
        </div>

        <div className="lightbox-foot">
          <div className="lightbox-caption">{node.data.caption}</div>
          <div className="lightbox-meta">
            {candidate.provider} · {candidate.model} · {candidate.size}
            {candidate.seed !== null ? ` · seed ${candidate.seed}` : ''}
          </div>
          <div className="lightbox-actions">
            <button
              type="button"
              className={selected ? '' : 'primary'}
              onClick={() => void selectCandidate(node.id, candidate.id)}
            >
              {selected ? '已选中' : '设为选用图'}
            </button>
            <a className="button-link" href={candidate.url} download>
              下载
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
