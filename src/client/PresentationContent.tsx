import { useState } from 'react';

const imageToken = /!\[([^\]\r\n]{0,200})\]\(([^)\s]{1,240})\)/g;
// Existing public static assets only. No remote requests, credentials, query strings,
// encoded traversal, SVG, raw HTML or arbitrary attachment endpoints are introduced.
const rasterAsset = /^\/assets\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:png|jpe?g|webp|gif|avif)$/i;

export function presentationTextPreview(content: string, limit = 480): string {
  const text = content.replace(imageToken, (_token, alt: string) => `[이미지: ${alt || '결과 이미지'}]`);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function ImageRow({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const label = alt || '결과 이미지';
  return <figure className="presentation-image-row">
    {failed ? <p role="status">이미지를 불러오지 못했습니다. {label}</p>
      : <img src={src} alt={label} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
    {alt ? <figcaption>{alt}</figcaption> : null}
  </figure>;
}

/** Limited image syntax inside otherwise literal, escaped result text. Display only. */
export function PresentationContent({ content }: { content: string }) {
  const parts = [];
  let offset = 0, images = 0;
  for (const match of content.matchAll(imageToken)) {
    if (!rasterAsset.test(match[2]) || images >= 4) continue;
    if (match.index > offset) parts.push(<span key={`text-${offset}`}>{content.slice(offset, match.index)}</span>);
    parts.push(<ImageRow key={`${match.index}-${match[2]}`} src={match[2]} alt={match[1]} />);
    offset = match.index + match[0].length;
    images++;
  }
  if (offset < content.length) parts.push(<span key={`text-${offset}`}>{content.slice(offset)}</span>);
  return <div className="execution-presentation-text presentation-content">{parts}</div>;
}
