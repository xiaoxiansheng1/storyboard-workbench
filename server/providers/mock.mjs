import { pad2 } from '../utils/num.mjs';

function escapeXml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c],
  );
}

function wrap(text, maxChars) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return [];
  const lines = [];
  let line = '';
  for (const token of clean.split(' ')) {
    const piece = line ? `${line} ${token}` : token;
    let rest = piece;
    while (rest.length > maxChars) {
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
}

export function createMockProvider() {
  return {
    name: 'mock',
    model: 'placeholder-svg',
    async generate({ size, meta = {} }) {
      const [w, h] = String(size || '1280x720')
        .split('x')
        .map(Number);
      const width = Number.isFinite(w) ? w : 1280;
      const height = Number.isFinite(h) ? h : 720;
      const accent = meta.anchor === 'B' ? '#9ec4d2' : '#ddc09a';
      const no = pad2(meta.no);
      const unit = width / 1280;
      const pad = Math.round(width * 0.055);
      const captionLines = wrap(meta.caption || '', Math.floor(width / 30)).slice(0, 2);
      const mono = "ui-monospace, 'SFMono-Regular', Menlo, monospace";
      const serif = "Georgia, 'Times New Roman', 'Noto Serif SC', serif";

      const mark = Math.round(22 * unit);
      const corners = [
        `M${mark} ${pad * 0.62}h${-mark}`,
        `M${width - mark} ${pad * 0.62}h${mark}`,
        `M${mark} ${height - pad * 0.62}h${-mark}`,
        `M${width - mark} ${height - pad * 0.62}h${mark}`,
      ].join(' ');

      const caption = captionLines
        .map(
          (line, i) =>
            `<text x="${pad}" y="${height * 0.68 + i * 30 * unit}" font-size="${Math.round(23 * unit)}" fill="#ece2d1" font-family="system-ui, 'Noto Sans SC', sans-serif">${escapeXml(line)}</text>`,
        )
        .join('');

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4b3f31"/>
      <stop offset="0.55" stop-color="#372e24"/>
      <stop offset="1" stop-color="#28211a"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.26" cy="0.58" r="0.6">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.10"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.7 0"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  <rect width="${width}" height="${height}" filter="url(#grain)" opacity="0.10"/>
  <path d="${corners}" stroke="${accent}" stroke-opacity="0.30" stroke-width="${Math.max(1, Math.round(1.4 * unit))}" fill="none"/>
  <rect x="${pad}" y="${pad * 0.62}" width="${width - pad * 2}" height="${Math.max(1, Math.round(1.4 * unit))}" fill="${accent}" opacity="0.32"/>
  <text x="${pad}" y="${pad * 1.55}" font-size="${Math.round(11 * unit)}" letter-spacing="${3 * unit}" fill="${accent}" fill-opacity="0.72" font-family="${mono}">MOCK · ${meta.anchor === 'B' ? 'B-ROLL' : 'SUBJECT'}</text>
  <text x="${width - pad}" y="${pad * 1.55}" text-anchor="end" font-size="${Math.round(11 * unit)}" letter-spacing="${1.5 * unit}" fill="#bdb2a1" font-family="${mono}">${escapeXml(meta.srtStart || '')}${meta.duration ? `  ·  ${meta.duration}s` : ''}</text>
  <text x="${pad - 4 * unit}" y="${height * 0.52}" font-size="${Math.round(158 * unit)}" fill="${accent}" fill-opacity="0.9" font-family="${serif}" letter-spacing="${2 * unit}">${escapeXml(no)}</text>
  ${caption}
  <text x="${pad}" y="${height - pad * 0.52}" font-size="${Math.round(9.5 * unit)}" letter-spacing="${2 * unit}" fill="#a29684" font-family="${mono}">FRAME NOT RENDERED</text>
  <text x="${width - pad}" y="${height - pad * 0.52}" text-anchor="end" font-size="${Math.round(9.5 * unit)}" letter-spacing="${1.5 * unit}" fill="#a29684" font-family="${mono}">${escapeXml(meta.shotId || '')}</text>
</svg>`;

      return { data: Buffer.from(svg, 'utf8'), mime: 'image/svg+xml' };
    },
  };
}
