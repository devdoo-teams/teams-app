import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { useCallback, useEffect, useState } from 'react';

import type { GenUiEnvelopeV1 } from '../../shared/genui.js';

type ToolResult = { structuredContent?: unknown };
type EnvelopeRecord = GenUiEnvelopeV1 & Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asEnvelope(value: unknown): EnvelopeRecord | null {
  if (!isRecord(value)) return null;
  if (typeof value.kind !== 'string') return null;
  return value as EnvelopeRecord;
}

function sectionItems(section: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(section.items) ? section.items.filter(isRecord) : [];
}

function WeatherSection({ section }: { section: Record<string, unknown> }) {
  const temperature = numberValue(section.temperature);
  return (
    <div className="mcp-weather">
      <div className="mcp-weather-heading">
        <span className="mcp-weather-icon" aria-hidden="true">{stringValue(section.icon) === 'rain' ? '🌧️' : '☀️'}</span>
        <div>
          <strong>{temperature.toFixed(1)}°C</strong>
          <span>{stringValue(section.condition, '현재 날씨')}</span>
        </div>
      </div>
      <div className="mcp-facts">
        <span>체감 {numberValue(section.apparentTemperature).toFixed(1)}°C</span>
        <span>습도 {Math.round(numberValue(section.humidity))}%</span>
        <span>바람 {numberValue(section.windSpeed).toFixed(1)}km/h</span>
        <span>강수 {numberValue(section.precipitation).toFixed(1)}mm</span>
      </div>
      <small>{stringValue(section.location, '위치 미확인')} · {stringValue(section.source, '데이터')}</small>
    </div>
  );
}

function StatsSection({ section }: { section: Record<string, unknown> }) {
  const fields = Array.isArray(section.fields) ? section.fields.filter(isRecord) : [];
  return (
    <div className="mcp-stats" aria-label={stringValue(section.title, '요약')}>
      {fields.map((field, index) => (
        <div className="mcp-stat" key={`${stringValue(field.label)}-${index}`}>
          <strong>{String(field.value ?? '')}</strong>
          <span>{stringValue(field.label)}</span>
        </div>
      ))}
    </div>
  );
}

function ListSection({ section }: { section: Record<string, unknown> }) {
  const items = sectionItems(section);
  return (
    <section className="mcp-list-section">
      <h3>{stringValue(section.title, '목록')}</h3>
      {items.length === 0 ? (
        <p className="mcp-muted">표시할 항목이 없습니다.</p>
      ) : (
        <ul>
          {items.slice(0, 10).map((item, index) => (
            <li key={stringValue(item.id, String(index))}>
              <span>{stringValue(item.label, '항목')}</span>
              {item.status !== undefined && <small>{String(item.status)}</small>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusSection({ section }: { section: Record<string, unknown> }) {
  return (
    <section className="mcp-status-section">
      <span className="mcp-status-dot" aria-hidden="true" />
      <div>
        <strong>{stringValue(section.status, 'unknown')}</strong>
        {section.mode !== undefined && <small>{String(section.mode)}</small>}
        {section.error !== undefined && <p className="mcp-error">{String(section.error)}</p>}
      </div>
    </section>
  );
}

function EnvelopeView({ envelope }: { envelope: EnvelopeRecord }) {
  const rawEnvelope = envelope as Record<string, unknown>;
  const sections = Array.isArray(rawEnvelope.sections) ? rawEnvelope.sections.filter(isRecord) : [];
  const citations: Array<Record<string, unknown>> = Array.isArray(rawEnvelope.citations)
    ? rawEnvelope.citations.filter(isRecord)
    : [];
  return (
    <article className="mcp-card" aria-live="polite">
      <header className="mcp-card-header">
        <div>
          <span className="mcp-eyebrow">TEAMS WORKSPACE · GENUI</span>
          <h1>{stringValue(rawEnvelope.title, 'Teams 업무 허브')}</h1>
          <p>{stringValue(rawEnvelope.summary)}</p>
        </div>
        {rawEnvelope.aiGenerated === true && <span className="mcp-ai-badge">AI 생성</span>}
      </header>
      <div className="mcp-sections">
        {sections.map((section, index) => {
          const type = stringValue(section.type);
          if (type === 'weather') return <WeatherSection key={index} section={section} />;
          if (type === 'stats') return <StatsSection key={index} section={section} />;
          if (type === 'list') return <ListSection key={index} section={section} />;
          if (type === 'status') return <StatusSection key={index} section={section} />;
          return <p className="mcp-text" key={index}>{stringValue(section.text, stringValue(section.label))}</p>;
        })}
      </div>
      {citations.length > 0 && (
        <footer className="mcp-citations">
          <span>출처</span>
          {citations.slice(0, 20).map((citation, index) => {
            const url = stringValue(citation.url);
            return url ? <a href={url} key={`${url}-${index}`} rel="noreferrer" target="_blank">{stringValue(citation.title, url)}</a> : null;
          })}
        </footer>
      )}
    </article>
  );
}

function PreviewNotice({ connected, error }: { connected: boolean; error: Error | null }) {
  return (
    <section className="mcp-empty" aria-live="polite">
      <span className="mcp-empty-icon" aria-hidden="true">◈</span>
      <h1>MCP GenUI 미리보기</h1>
      <p>{connected ? '도구 결과를 기다리고 있습니다.' : 'MCP Apps 호스트에 연결되지 않았습니다.'}</p>
      {error && <code>{error.message}</code>}
      <small>
        이 화면은 Teams 모바일 탭 iframe이 아닙니다. Teams 모바일은 Adaptive Card 렌더러를 사용하고,
        이 리소스는 MCP Apps를 지원하는 ChatGPT·Codex 호스트에서 structuredContent를 표시합니다.
      </small>
    </section>
  );
}

export function McpGenUiWidget() {
  const [envelope, setEnvelope] = useState<EnvelopeRecord | null>(null);
  const [toolResultError, setToolResultError] = useState<string | null>(null);
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [bridgeError, setBridgeError] = useState<Error | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const handleToolResult = useCallback((result: ToolResult) => {
    const next = asEnvelope(result.structuredContent);
    if (!next) {
      setToolResultError('structuredContent가 GenUiEnvelopeV1 형식이 아닙니다. 데이터 도구 결과를 확인하세요.');
      return;
    }
    setToolResultError(null);
    setEnvelope(next);
  }, []);

  useEffect(() => {
    // MCP Apps standard bridge: the view talks to its host through App and
    // PostMessageTransport. A normal browser preview intentionally does not
    // connect to itself, so it remains safe and explains the missing host.
    if (window.parent === window) {
      setBridgeError(new Error('MCP Apps 호스트가 없습니다. 이 페이지는 일반 브라우저 미리보기로 열렸습니다.'));
      return;
    }

    const bridge = new App({ name: 'teams-workspace-genui', version: '1.0.0' }, {});
    bridge.ontoolresult = handleToolResult;
    bridge.onhostcontextchanged = (context) => {
      if (context.theme === 'dark' || context.theme === 'light') setTheme(context.theme);
    };
    let active = true;
    const transport = new PostMessageTransport(window.parent, window.parent);

    void bridge.connect(transport)
      .then(() => {
        if (!active) return;
        const hostTheme = bridge.getHostContext()?.theme;
        if (hostTheme === 'dark' || hostTheme === 'light') setTheme(hostTheme);
        setBridgeConnected(true);
      })
      .catch((caught) => {
        if (!active) return;
        setBridgeError(caught instanceof Error ? caught : new Error('MCP Apps bridge 연결에 실패했습니다.'));
      });

    return () => {
      active = false;
      void transport.close();
    };
  }, [handleToolResult]);

  return (
    <main className="mcp-root" data-theme={theme}>
      <style>{styles}</style>
      {envelope ? <EnvelopeView envelope={envelope} /> : <PreviewNotice connected={bridgeConnected} error={bridgeError} />}
      {toolResultError && <p className="mcp-inline-error" role="alert">{toolResultError}</p>}
    </main>
  );
}

const styles = `
:root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; background: transparent; color: var(--color-text-primary, #242424); }
.mcp-root { width: 100%; max-width: 720px; margin: 0 auto; padding: 12px; }
.mcp-card, .mcp-empty { border: 1px solid var(--color-border-primary, rgba(128,128,128,.28)); border-radius: 18px; background: var(--color-background-primary, rgba(255,255,255,.96)); box-shadow: 0 8px 24px rgba(0,0,0,.08); overflow: hidden; }
.mcp-card-header { display: flex; gap: 12px; justify-content: space-between; padding: 18px 18px 14px; background: linear-gradient(135deg, #6264a7, #8b8dd8); color: white; }
.mcp-card-header h1, .mcp-empty h1 { margin: 5px 0; font-size: 21px; line-height: 1.2; }
.mcp-card-header p { margin: 6px 0 0; opacity: .9; font-size: 13px; }
.mcp-eyebrow { font-size: 10px; letter-spacing: .12em; font-weight: 700; opacity: .82; }
.mcp-ai-badge { height: fit-content; padding: 5px 8px; border-radius: 999px; background: rgba(255,255,255,.2); font-size: 11px; white-space: nowrap; }
.mcp-sections { display: grid; gap: 12px; padding: 14px; }
.mcp-weather, .mcp-stats, .mcp-list-section, .mcp-status-section { border: 1px solid var(--color-border-primary, rgba(128,128,128,.2)); border-radius: 13px; padding: 13px; }
.mcp-weather-heading { display: flex; gap: 12px; align-items: center; }
.mcp-weather-icon { font-size: 38px; }
.mcp-weather-heading strong { display: block; font-size: 29px; }
.mcp-weather-heading span { display: block; opacity: .75; }
.mcp-weather small, .mcp-status-section small { display: block; margin-top: 9px; opacity: .65; }
.mcp-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; margin-top: 13px; font-size: 12px; }
.mcp-facts span { padding: 8px; border-radius: 8px; background: var(--color-background-secondary, rgba(128,128,128,.1)); }
.mcp-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.mcp-stat { min-width: 0; }
.mcp-stat strong, .mcp-stat span { display: block; }
.mcp-stat strong { font-size: 20px; }
.mcp-stat span { margin-top: 2px; font-size: 11px; opacity: .7; }
.mcp-list-section h3 { margin: 0 0 8px; font-size: 14px; }
.mcp-list-section ul { display: grid; gap: 7px; list-style: none; padding: 0; margin: 0; }
.mcp-list-section li { display: flex; gap: 8px; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--color-border-primary, rgba(128,128,128,.15)); font-size: 13px; }
.mcp-list-section li:last-child { border-bottom: 0; }
.mcp-list-section li small { opacity: .6; }
.mcp-status-section { display: flex; gap: 10px; align-items: flex-start; }
.mcp-status-dot { width: 10px; height: 10px; margin-top: 4px; border-radius: 50%; background: #6264a7; box-shadow: 0 0 0 4px rgba(98,100,167,.15); }
.mcp-status-section strong { display: block; }
.mcp-error, .mcp-inline-error { color: #b42318; font-size: 12px; }
.mcp-text { margin: 0; white-space: pre-wrap; font-size: 13px; }
.mcp-muted { margin: 0; opacity: .65; font-size: 13px; }
.mcp-citations { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 14px 15px; border-top: 1px solid var(--color-border-primary, rgba(128,128,128,.18)); font-size: 11px; }
.mcp-citations span { opacity: .65; }
.mcp-citations a { color: #6264a7; }
.mcp-empty { padding: 32px 22px; text-align: center; }
.mcp-empty-icon { display: block; color: #6264a7; font-size: 36px; }
.mcp-empty p { margin: 8px 0; font-size: 14px; }
.mcp-empty code { display: block; margin: 10px 0; padding: 8px; overflow-wrap: anywhere; border-radius: 8px; background: rgba(128,128,128,.12); text-align: left; font-size: 11px; }
.mcp-empty small { display: block; margin-top: 14px; line-height: 1.5; opacity: .65; }
.mcp-inline-error { margin: 10px 2px 0; }
@media (max-width: 430px) { .mcp-root { padding: 8px; } .mcp-card-header { padding: 15px; } .mcp-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
`;
