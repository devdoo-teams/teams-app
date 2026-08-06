import { useId } from 'react';
import './genui.css';

/**
 * This local contract is intentionally compatible with the planned
 * `src/shared/genui.ts` type. Once that shared module exists, these types can
 * be replaced with a type-only import without changing the renderer API.
 */
export type GenUiKind =
  | 'answer'
  | 'weather'
  | 'task-list'
  | 'job-status'
  | 'approval'
  | 'result'
  | 'error';

export type GenUiState = 'loading' | 'ready' | 'empty' | 'error' | 'approval' | 'complete';
export type GenUiTheme = 'light' | 'dark' | 'auto';
export type GenUiTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export type GenUiItem = {
  id?: string | number;
  label?: string;
  title?: string;
  value?: string | number | null;
  description?: string;
  status?: string;
  tone?: GenUiTone;
};

export type GenUiSection = {
  id?: string;
  label?: string;
  title?: string;
  value?: string | number | null;
  unit?: string;
  description?: string;
  content?: string;
  icon?: string;
  status?: string;
  tone?: GenUiTone;
  type?: 'text' | 'metric' | 'list' | 'progress' | 'status';
  progress?: number;
  items?: GenUiItem[];
};

export type GenUiAction = {
  id: string;
  label: string;
  action?: string;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** `type` is accepted for forward compatibility with card action schemas. */
  type?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  payload?: Record<string, unknown>;
};

export type GenUiCitation = {
  title: string;
  url: string;
  snippet?: string;
};

export type GenUiEnvelopeV1 = {
  kind: GenUiKind;
  id?: string;
  correlationId?: string;
  title?: string;
  summary?: string;
  sections?: GenUiSection[];
  actions?: GenUiAction[];
  citations?: GenUiCitation[];
  aiGenerated?: boolean;
  fallbackText?: string;
  /** Optional state field used by streaming and long-running job renderers. */
  status?: GenUiState;
};

export type GenUiActionHandler = (
  action: GenUiAction,
  envelope: GenUiEnvelopeV1,
) => void;

export type GenUiCardProps = {
  envelope?: GenUiEnvelopeV1 | null;
  onAction?: GenUiActionHandler;
  theme?: GenUiTheme;
  className?: string;
};

const KIND_LABELS: Record<GenUiKind, string> = {
  answer: '답변',
  weather: '날씨',
  'task-list': '업무 목록',
  'job-status': '작업 상태',
  approval: '승인 필요',
  result: '완료 결과',
  error: '오류',
};

const KIND_ICONS: Record<GenUiKind, string> = {
  answer: '✦',
  weather: '☀',
  'task-list': '✓',
  'job-status': '↗',
  approval: '!',
  result: '✓',
  error: '!',
};

const STATUS_LABELS: Record<GenUiState, string> = {
  loading: '처리 중',
  ready: '',
  empty: '내용 없음',
  error: '오류',
  approval: '승인 필요',
  complete: '완료',
};

function resolveState(envelope: GenUiEnvelopeV1 | null | undefined): GenUiState {
  if (!envelope) return 'loading';
  if (envelope.status) return envelope.status;
  if (envelope.kind === 'error') return 'error';
  if (envelope.kind === 'approval') return 'approval';
  if (envelope.kind === 'result') return 'complete';
  return 'ready';
}

function displayValue(value: string | number | null | undefined, unit?: string): string {
  if (value === null || value === undefined || value === '') return '';
  return `${String(value)}${unit ? ` ${unit}` : ''}`;
}

function clampProgress(progress: number): number {
  return Math.min(100, Math.max(0, Math.round(progress)));
}

function hasText(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function sectionHasContent(section: GenUiSection): boolean {
  return Boolean(
    hasText(section.label)
      || hasText(section.title)
      || (section.value !== null && section.value !== undefined)
      || hasText(section.description)
      || hasText(section.content)
      || section.progress !== undefined
      || section.items?.length,
  );
}

function isFeedbackAction(action: GenUiAction): boolean {
  const identifier = `${action.action ?? ''} ${action.id}`.toLowerCase();
  return identifier.includes('feedback')
    || identifier.includes('positive')
    || identifier.includes('negative')
    || identifier.includes('helpful');
}

function defaultFeedbackActions(): GenUiAction[] {
  return [
    {
      id: 'feedback-positive',
      action: 'feedback',
      kind: 'ghost',
      label: '도움이 됐어요',
      payload: { value: 'positive' },
    },
    {
      id: 'feedback-negative',
      action: 'feedback',
      kind: 'ghost',
      label: '개선이 필요해요',
      payload: { value: 'negative' },
    },
  ];
}

function isSafeCitationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function SectionBlock({ section, index }: { section: GenUiSection; index: number }) {
  const heading = section.title || section.label;
  const sectionId = `genui-section-${section.id ?? index}`;
  const progress = section.progress === undefined ? null : clampProgress(section.progress);
  const hasItems = Boolean(section.items?.length);
  const hasEmptyItems = Array.isArray(section.items) && section.items.length === 0;

  return (
    <section className="genui-card__section" aria-labelledby={heading ? sectionId : undefined}>
      {heading && (
        <div className="genui-card__section-heading">
          <h3 id={sectionId} className="genui-card__section-title">
            {section.icon && <span aria-hidden="true">{section.icon}</span>}
            {heading}
          </h3>
          {section.status && (
            <span className={`genui-card__status genui-card__status--${section.tone ?? 'neutral'}`}>
              {section.status}
            </span>
          )}
        </div>
      )}

      {section.value !== null && section.value !== undefined && (
        <p className="genui-card__metric">
          <strong>{displayValue(section.value)}</strong>
          {section.unit && <span>{section.unit}</span>}
        </p>
      )}

      {(hasText(section.description) || hasText(section.content)) && (
        <p className="genui-card__section-copy">
          {section.description || section.content}
        </p>
      )}

      {progress !== null && (
        <div className="genui-card__progress-group">
          <div className="genui-card__progress-label">
            <span>{section.label || section.title || '진행률'}</span>
            <strong>{progress}%</strong>
          </div>
          <div
            className="genui-card__progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            aria-valuetext={`진행률 ${progress}%`}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {(hasItems || hasEmptyItems) && (
        <ul className="genui-card__item-list">
          {hasItems ? section.items!.map((item, itemIndex) => {
            const itemTitle = item.title || item.label || `항목 ${itemIndex + 1}`;
            return (
              <li className="genui-card__item" key={String(item.id ?? `${sectionId}-${itemIndex}`)}>
                <span className="genui-card__item-marker" aria-hidden="true">•</span>
                <span className="genui-card__item-main">
                  <span className="genui-card__item-title">{itemTitle}</span>
                  {item.description && <span className="genui-card__item-description">{item.description}</span>}
                </span>
                {item.value !== null && item.value !== undefined && (
                  <span className="genui-card__item-value">{displayValue(item.value)}</span>
                )}
                {item.status && (
                  <span className={`genui-card__status genui-card__status--${item.tone ?? 'neutral'}`}>
                    {item.status}
                  </span>
                )}
              </li>
            );
          }) : (
            <li className="genui-card__empty-item">표시할 항목이 없습니다.</li>
          )}
        </ul>
      )}
    </section>
  );
}

function ActionButton({
  action,
  disabled,
  onAction,
  envelope,
}: {
  action: GenUiAction;
  disabled: boolean;
  onAction?: GenUiActionHandler;
  envelope: GenUiEnvelopeV1;
}) {
  const actionKind = action.kind ?? action.type ?? 'secondary';
  return (
    <button
      className={`genui-card__action genui-card__action--${actionKind}`}
      type="button"
      disabled={disabled}
      aria-disabled={disabled}
      onClick={() => onAction?.(action, envelope)}
    >
      {action.label}
    </button>
  );
}

function ActionBar({
  envelope,
  onAction,
  aiGenerated,
}: {
  envelope: GenUiEnvelopeV1;
  onAction?: GenUiActionHandler;
  aiGenerated: boolean;
}) {
  const actions = envelope.actions ?? [];
  const regularActions = actions.filter((action) => !isFeedbackAction(action));
  const feedbackActions = aiGenerated
    ? actions.filter(isFeedbackAction).length > 0
      ? actions.filter(isFeedbackAction)
      : defaultFeedbackActions()
    : [];

  if (regularActions.length === 0 && feedbackActions.length === 0) return null;

  return (
    <div className="genui-card__actions-wrap">
      {regularActions.length > 0 && (
        <div className="genui-card__actions" aria-label="응답 작업">
          {regularActions.map((action) => (
            <ActionButton
              key={action.id}
              action={action}
              disabled={Boolean(action.disabled) || !onAction}
              envelope={envelope}
              onAction={onAction}
            />
          ))}
        </div>
      )}
      {feedbackActions.length > 0 && (
        <div className="genui-card__feedback" aria-label="AI 응답 피드백">
          <span className="genui-card__feedback-label">이 답변이 도움이 되었나요?</span>
          {feedbackActions.map((action) => (
            <ActionButton
              key={action.id}
              action={action}
              disabled={Boolean(action.disabled) || !onAction}
              envelope={envelope}
              onAction={onAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CitationList({ citations }: { citations: GenUiCitation[] }) {
  const validCitations = citations.filter((citation) => citation.title && citation.url);
  if (validCitations.length === 0) return null;

  return (
    <section className="genui-card__citations" aria-label="출처">
      <h3 className="genui-card__section-title">출처</h3>
      <ul>
        {validCitations.map((citation, index) => (
          <li key={`${citation.url}-${index}`}>
            {isSafeCitationUrl(citation.url) ? (
              <a href={citation.url} target="_blank" rel="noreferrer">
                {citation.title}
              </a>
            ) : (
              <span>{citation.title}</span>
            )}
            {citation.snippet && <small>{citation.snippet}</small>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function LoadingBody() {
  return (
    <div className="genui-card__loading-body" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

export function GenUiCard({
  envelope,
  onAction,
  theme = 'auto',
  className,
}: GenUiCardProps) {
  const headingId = useId();
  const state = resolveState(envelope);
  const isLoading = state === 'loading';
  const isError = state === 'error';
  const aiGenerated = envelope?.aiGenerated === true;
  const sections = envelope?.sections ?? [];
  const hasBodyContent = Boolean(
    envelope && (
      hasText(envelope.summary)
      || hasText(envelope.fallbackText)
      || sections.some(sectionHasContent)
    ),
  );
  const isEmpty = state === 'empty' || Boolean(envelope && !isLoading && !isError && !hasBodyContent);
  const title = envelope?.title || (envelope ? KIND_LABELS[envelope.kind] : '응답 준비 중');
  const kind = envelope?.kind ?? 'answer';
  const statusLabel = STATUS_LABELS[state];
  const rootClassName = ['genui-card', className].filter(Boolean).join(' ');
  const rootRole = isError ? 'alert' : isLoading || isEmpty ? 'status' : undefined;

  return (
    <article
      className={rootClassName}
      data-kind={kind}
      data-state={state}
      data-theme={theme}
      aria-busy={isLoading}
      role={rootRole}
      aria-labelledby={headingId}
    >
      <div className="genui-card__header">
        <div className="genui-card__heading">
          <span className={`genui-card__icon genui-card__icon--${kind}`} aria-hidden="true">
            {KIND_ICONS[kind]}
          </span>
          <div className="genui-card__title-group">
            <span className="genui-card__kind">{KIND_LABELS[kind]}</span>
            <h2 id={headingId} className="genui-card__title">{title}</h2>
          </div>
        </div>
        <div className="genui-card__meta">
          {aiGenerated && <span className="genui-card__ai-label">AI 생성</span>}
          {statusLabel && <span className={`genui-card__state genui-card__state--${state}`}>{statusLabel}</span>}
        </div>
      </div>

      <div className="genui-card__body">
        {isLoading ? (
          <LoadingBody />
        ) : isError ? (
          <p className="genui-card__error-copy">{envelope?.fallbackText || envelope?.summary || '요청을 처리하지 못했습니다.'}</p>
        ) : isEmpty ? (
          <p className="genui-card__empty-copy">{envelope?.fallbackText || '표시할 내용이 없습니다.'}</p>
        ) : (
          <>
            {hasText(envelope?.summary) && <p className="genui-card__summary">{envelope!.summary}</p>}
            <div className="genui-card__sections">
              {sections.map((section, index) => (
                <SectionBlock key={section.id ?? index} index={index} section={section} />
              ))}
            </div>
          </>
        )}
      </div>

      {!isLoading && envelope && aiGenerated && envelope.citations && (
        <CitationList citations={envelope.citations} />
      )}

      {!isLoading && envelope && !isError && (
        <ActionBar envelope={envelope} onAction={onAction} aiGenerated={aiGenerated} />
      )}
    </article>
  );
}

