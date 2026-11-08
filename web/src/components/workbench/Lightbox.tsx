import { useWorkbench } from '../../store';
import type { ShotData } from '../../types';
import { Modal } from '../common/Modal';

export function Lightbox() {
  const lightbox = useWorkbench((s) => s.lightbox);
  const node = useWorkbench(
    (s) => (lightbox ? s.nodes.find((item) => item.id === lightbox.nodeId) || null : null),
  );
  const setLightbox = useWorkbench((s) => s.setLightbox);

  const data = node?.type === 'shot' ? (node.data as ShotData) : null;
  const candidates = data?.run.candidates || [];
  const index = lightbox ? Math.min(Math.max(lightbox.index, 0), Math.max(candidates.length - 1, 0)) : 0;
  const candidate = candidates[index];

  if (!lightbox || !node || !data || !candidate) return null;

  return (
    <Modal
      title={`镜头 ${String(data.no).padStart(2, '0')}`}
      onClose={() => setLightbox(null)}
      size="xl"
      className="lightbox-modal"
      footer={
        <>
          <span className="lightbox-meta">
            {data.srtStart} → {data.srtEnd} · {data.duration.toFixed(2)}s
          </span>
          <a className="button-link" href={candidate.url} download>
            下载
          </a>
        </>
      }
    >
      <div className="lightbox-stage">
        <img src={candidate.url} alt={`镜头 ${data.no}`} />
      </div>
      {data.caption && <div className="lightbox-caption">{data.caption}</div>}
    </Modal>
  );
}
