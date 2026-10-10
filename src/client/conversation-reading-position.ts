export type ConversationScrollMetrics = Readonly<{ scrollTop: number; scrollHeight: number; clientHeight: number }>;
export type ConversationReadingAnchor = Readonly<{ jobId: string; offset: number }>;
export type ConversationReadingPosition = Readonly<{
  scrollTop: number;
  wasAtEnd: boolean;
  anchor?: ConversationReadingAnchor;
}>;

function finite(value: number): number { return Number.isFinite(value) ? value : 0; }
function maxScroll(metrics: ConversationScrollMetrics): number {
  return Math.max(0, finite(metrics.scrollHeight) - finite(metrics.clientHeight));
}
function clamp(value: number, metrics: ConversationScrollMetrics): number {
  return Math.min(maxScroll(metrics), Math.max(0, finite(value)));
}

/** Only layout coordinates and an already-visible job ID; no transcript or persistent storage. */
export function snapshotConversationReadingPosition(metrics: ConversationScrollMetrics,
  anchor?: ConversationReadingAnchor): ConversationReadingPosition | undefined {
  if (metrics.clientHeight <= 0 || metrics.scrollHeight <= 0) return undefined;
  const scrollTop = clamp(metrics.scrollTop, metrics);
  return { scrollTop, wasAtEnd: maxScroll(metrics) - scrollTop <= 4,
    ...(anchor && Number.isFinite(anchor.offset) ? { anchor } : {}),
  };
}

/** Follow appended content only if the reader was at the end. During explicit prepend,
 * the caller sets wasAtEnd=false and supplies the same turn's new viewport offset. */
export function restoreConversationReadingPosition(position: ConversationReadingPosition | undefined,
  metrics: ConversationScrollMetrics, currentAnchorOffset?: number): number {
  if (!position) return clamp(metrics.scrollTop, metrics);
  if (position.wasAtEnd) return maxScroll(metrics);
  if (position.anchor && currentAnchorOffset !== undefined && Number.isFinite(currentAnchorOffset)) {
    return clamp(metrics.scrollTop + currentAnchorOffset - position.anchor.offset, metrics);
  }
  return clamp(position.scrollTop, metrics);
}
