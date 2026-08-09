import { useId } from 'react';
import {
  isSafeGenUiUrl,
  type GenUiAction,
  type GenUiCitation,
  type GenUiEnvelopeV1,
  type GenUiKind,
  type GenUiSection,
  type GenUiState,
} from '../../shared/genui.js';

export type GenUiTheme = 'light' | 'dark' | 'auto';

export type GenUiActionHandler = (
  action: GenUiAction,
  envelope: GenUiEnvelopeV1,
) => void;

export type GenUiCardProps = {
  envelope?: GenUiEnvelopeV1 | null;
  onAction?: GenUiActionHandler;
  interactive?: boolean;
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

function clampProgress(progress: number): number {
  return Math.min(100, Math.max(0, Math.round(progress)));
}

function hasText(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function sectionHasContent(section: GenUiSection): boolean {
  if (hasText(section.label) || hasText(section.title) || hasText(section.description)) return true;
  switch (section.type) {
    case 'text': return Boolean(hasText(section.text) || hasText(section.content) || section.value !== undefined);
    case 'facts': return Boolean(section.facts?.length || section.value !== undefined);
    case 'stats': return section.stats.length > 0;
    case 'weather': return Boolean(
      section.location
      || section.temperature !== undefined
      || section.apparentTemperature !== undefined
      || section.humidity !== undefined
      || section.windSpeed !== undefined
      || section.precipitation !== undefined
      || section.condition,
    );
    case 'list': return section.items.length > 0;
    case 'progress': return true;
    case 'status': return true;
  }
}

function isFeedbackAction(action: GenUiAction): boolean {
  const identifier = `${action.action ?? ''} ${action.id}`.toLowerCase();
  return identifier.includes('feedback')
    || identifier.includes('positive')
    || identifier.includes('negative')
    || identifier.includes('helpful');
}

function defaultFeedbackActions(envelope: GenUiEnvelopeV1): GenUiAction[] {
  return [
    {
      id: 'feedback-positive',
      action: 'feedback',
      label: '도움이 됐어요',
      entityId: envelope.id,
      correlationId: envelope.correlationId,
      actionToken: 'ui-feedback-positive',
      style: 'default',
    },
    {
      id: 'feedback-negative',
      action: 'feedback',
      label: '개선이 필요해요',
      entityId: envelope.id,
      correlationId: envelope.correlationId,
      actionToken: 'ui-feedback-negative',
      style: 'default',
    },
  ];
}

function displayScalar(value: string | number | boolean | null | undefined, unit?: string): string {
  if (value === null || value === undefined || value === '') return '';
  return `${String(value)}${unit ? ` ${unit}` : ''}`;
}

function SectionBlock({ section, index }: { section: GenUiSection; index: number }) {
  const heading = section.title || section.label;
  const sectionId = `genui-section-${section.id ?? index}`;
  const progress = section.type === 'progress' ? clampProgress(section.progress) : null;

  return (
    <section className="genui-card__section" aria-labelledby={heading ? sectionId : undefined}>
      {heading && (
        <div className="genui-card__section-heading">
          <h3 id={sectionId} className="genui-card__section-title">
            {heading}
          </h3>
          {section.status && (
            <span className={`genui-card__status genui-card__status--${section.tone ?? 'neutral'}`}>
              {section.status}
            </span>
          )}
        </div>
      )}

      {section.description && <p className="genui-card__section-copy">{section.description}</p>}

      {section.type === 'text' && (
        <>
          {(section.text || section.content) && <p className="genui-card__section-copy">{section.text || section.content}</p>}
          {section.value !== undefined && <p className="genui-card__metric"><strong>{displayScalar(section.value)}</strong></p>}
        </>
      )}

      {(section.type === 'facts' || section.type === 'stats') && (
        <dl className="genui-card__facts">
          {(section.type === 'facts' ? section.facts ?? [] : section.stats).map((fact, factIndex) => (
            <div key={fact.id ?? `${sectionId}-fact-${factIndex}`}>
              <dt>{fact.label}</dt>
              <dd>{displayScalar(fact.value, fact.unit)}</dd>
            </div>
          ))}
        </dl>
      )}

      {section.type === 'weather' && (
        <dl className="genui-card__facts">
          {[
            ['위치', section.location],
            ['현재', section.temperature === undefined ? undefined : `${section.temperature.toFixed(1)}°C ${section.condition ?? ''}`.trim()],
            ['체감', section.apparentTemperature === undefined ? undefined : `${section.apparentTemperature.toFixed(1)}°C`],
            ['습도', section.humidity === undefined ? undefined : `${Math.round(section.humidity)}%`],
            ['바람', section.windSpeed === undefined ? undefined : `${section.windSpeed.toFixed(1)}km/h`],
            ['강수', section.precipitation === undefined ? undefined : `${section.precipitation.toFixed(1)}mm`],
          ].filter((fact): fact is [string, string] => typeof fact[1] === 'string' && fact[1].length > 0).map(([label, value]) => (
            <div key={`${sectionId}-${label}`}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
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

      {section.type === 'list' && (
        <ul className="genui-card__item-list">
          {section.items.length > 0 ? section.items.map((item, itemIndex) => {
            const itemTitle = item.label || `항목 ${itemIndex + 1}`;
            return (
              <li className="genui-card__item" key={String(item.id ?? `${sectionId}-${itemIndex}`)}>
                <span className="genui-card__item-marker" aria-hidden="true">•</span>
                <span className="genui-card__item-main">
                  <span className="genui-card__item-title">{itemTitle}</span>
                  {item.description && <span className="genui-card__item-description">{item.description}</span>}
                </span>
                {item.value !== undefined && (
                  <span className="genui-card__item-value">{displayScalar(item.value)}</span>
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

      {section.type === 'status' && (
        <p className="genui-card__section-copy">{section.status}</p>
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
  const actionKind = action.style === 'positive'
    ? 'primary'
    : action.style === 'destructive'
      ? 'danger'
      : 'secondary';
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
  interactive,
}: {
  envelope: GenUiEnvelopeV1;
  onAction?: GenUiActionHandler;
  aiGenerated: boolean;
  interactive: boolean;
}) {
  if (!interactive) return null;

  const actions = envelope.actions ?? [];
  const regularActions = actions.filter((action) => !isFeedbackAction(action));
  const feedbackActions = aiGenerated
    ? actions.filter(isFeedbackAction).length > 0
      ? actions.filter(isFeedbackAction)
      : defaultFeedbackActions(envelope)
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
              disabled={!onAction}
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
              disabled={!onAction}
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
            {isSafeGenUiUrl(citation.url) ? (
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
  interactive = true,
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

      {!isLoading && envelope && (
        <ActionBar
          envelope={envelope}
          onAction={onAction}
          aiGenerated={aiGenerated}
          interactive={interactive}
        />
      )}
    </article>
  );
}
