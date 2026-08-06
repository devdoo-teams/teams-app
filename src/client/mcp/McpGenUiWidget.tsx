import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { useCallback, useEffect, useState } from 'react';

import { GenUiCard } from '../genui/GenUiCard.js';
import {
  GenUiEnvelopeV1Schema,
  type GenUiEnvelopeV1,
} from '../../shared/genui.js';

type ToolResult = Parameters<NonNullable<App['ontoolresult']>>[0];

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
  const [envelope, setEnvelope] = useState<GenUiEnvelopeV1 | null>(null);
  const [toolResultError, setToolResultError] = useState<string | null>(null);
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [bridgeError, setBridgeError] = useState<Error | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const handleToolResult = useCallback((result: ToolResult) => {
    const parsed = GenUiEnvelopeV1Schema.safeParse(result.structuredContent);
    if (!parsed.success) {
      setToolResultError('structuredContent가 GenUiEnvelopeV1 형식이 아닙니다. 데이터 도구 결과를 확인하세요.');
      return;
    }
    setToolResultError(null);
    setEnvelope(parsed.data);
  }, []);

  useEffect(() => {
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
      {envelope ? <GenUiCard envelope={envelope} theme={theme} /> : <PreviewNotice connected={bridgeConnected} error={bridgeError} />}
      {toolResultError && <p className="mcp-inline-error" role="alert">{toolResultError}</p>}
    </main>
  );
}

const styles = `
:root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; background: transparent; color: #242424; }
.mcp-root { width: 100%; max-width: 720px; margin: 0 auto; padding: 12px; }
.mcp-empty { border: 1px solid rgba(128,128,128,.28); border-radius: 18px; background: rgba(255,255,255,.96); padding: 32px 22px; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,.08); }
.mcp-empty-icon { display: block; color: #6264a7; font-size: 36px; }
.mcp-empty h1 { margin: 5px 0; font-size: 21px; }
.mcp-empty p { margin: 8px 0; font-size: 14px; }
.mcp-empty code { display: block; margin: 10px 0; padding: 8px; overflow-wrap: anywhere; border-radius: 8px; background: rgba(128,128,128,.12); text-align: left; font-size: 11px; }
.mcp-empty small { display: block; margin-top: 14px; line-height: 1.5; opacity: .65; }
.mcp-inline-error { color: #b42318; font-size: 12px; }
.genui-card { width: 100%; max-width: 640px; margin: 0 auto; overflow: hidden; border: 1px solid #e0e3f2; border-radius: 16px; background: #fff; color: #25274b; box-shadow: 0 12px 32px rgba(37,52,89,.09); font-family: inherit; }
.genui-card[data-theme="dark"] { border-color: #3b3e4e; background: #1e1f25; color: #f5f6ff; }
.genui-card__header { display: flex; gap: 12px; justify-content: space-between; padding: 16px; color: #fff; background: linear-gradient(135deg,#4f518e,#6264a7); }
.genui-card__heading { display: flex; gap: 10px; min-width: 0; align-items: center; }
.genui-card__icon { display: inline-flex; flex: 0 0 28px; width: 28px; height: 28px; align-items: center; justify-content: center; border-radius: 50%; background: rgba(255,255,255,.18); }
.genui-card__title-group { min-width: 0; }
.genui-card__kind { display: block; font-size: 10px; opacity: .76; letter-spacing: .08em; text-transform: uppercase; }
.genui-card__title { margin: 0; font-size: 16px; overflow-wrap: anywhere; }
.genui-card__meta { display: flex; flex: 0 0 auto; flex-direction: column; gap: 6px; align-items: flex-end; }
.genui-card__ai-label, .genui-card__state { padding: 6px 8px; border: 1px solid rgba(255,255,255,.28); border-radius: 999px; color: #fff; font-size: 10px; white-space: nowrap; }
.genui-card__body { padding: 16px; }
.genui-card__summary, .genui-card__section-copy, .genui-card__error-copy, .genui-card__empty-copy { margin: 0 0 10px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.genui-card__sections { display: grid; gap: 12px; }
.genui-card__section { min-width: 0; padding-top: 12px; border-top: 1px solid #e0e3f2; }
.genui-card__section:first-child { padding-top: 0; border-top: 0; }
.genui-card__section-heading, .genui-card__progress-label { display: flex; gap: 8px; justify-content: space-between; align-items: center; }
.genui-card__section-title { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
.genui-card__status { padding: 5px 7px; border: 1px solid #cfd4ed; border-radius: 999px; color: #667085; font-size: 10px; white-space: nowrap; }
.genui-card__metric { display: flex; gap: 6px; align-items: baseline; margin: 10px 0; }
.genui-card__metric strong { font-size: 25px; }
.genui-card__facts { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; margin: 10px 0; }
.genui-card__facts div { min-width: 0; padding: 8px; border-radius: 8px; background: #f5f6fa; }
.genui-card__facts dt { color: #667085; font-size: 11px; }
.genui-card__facts dd { margin: 2px 0 0; font-size: 13px; overflow-wrap: anywhere; }
.genui-card__progress-group { margin-top: 12px; }
.genui-card__progress-label { margin-bottom: 6px; color: #667085; font-size: 11px; }
.genui-card__progress { height: 7px; overflow: hidden; border-radius: 999px; background: #f5f6fa; }
.genui-card__progress span { display: block; height: 100%; border-radius: inherit; background: #6264a7; }
.genui-card__item-list { display: grid; gap: 8px; margin: 10px 0 0; padding: 0; list-style: none; }
.genui-card__item { display: flex; gap: 8px; min-width: 0; align-items: flex-start; padding: 9px 10px; border: 1px solid #e0e3f2; border-radius: 9px; background: #f7f8ff; }
.genui-card__item-main { display: grid; gap: 2px; min-width: 0; }
.genui-card__item-title, .genui-card__item-description { overflow-wrap: anywhere; }
.genui-card__item-description, .genui-card__item-value { color: #667085; font-size: 11px; }
.genui-card__item-value { margin-left: auto; flex: 0 0 auto; }
.genui-card__empty-item, .genui-card__empty-copy { color: #667085; text-align: center; }
.genui-card__loading-body { display: grid; gap: 10px; }
.genui-card__loading-body span { display: block; height: 12px; border-radius: 6px; background: #f5f6fa; }
.genui-card__citations { padding: 12px 16px 0; border-top: 1px solid #e0e3f2; }
.genui-card__citations ul { display: grid; gap: 8px; margin: 10px 0 0; padding: 0; list-style: none; }
.genui-card__citations li { display: grid; gap: 2px; }
.genui-card__citations a { color: #4f518e; font-size: 12px; text-decoration: underline; }
.genui-card__citations small { color: #667085; font-size: 11px; }
.genui-card__actions-wrap { display: grid; gap: 10px; padding: 12px 16px 16px; border-top: 1px solid #e0e3f2; }
.genui-card__actions, .genui-card__feedback { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.genui-card__feedback-label { color: #667085; font-size: 11px; }
.genui-card__action { min-height: 40px; padding: 9px 12px; border: 1px solid #e0e3f2; border-radius: 9px; background: #f5f6fa; color: #4f518e; font-weight: 700; }
.genui-card__action--primary { border-color: #6264a7; background: #6264a7; color: #fff; }
.genui-card__action--danger { border-color: #b42318; color: #b42318; }
.genui-card__action:disabled { cursor: not-allowed; opacity: .55; }
@media (max-width: 430px) { .mcp-root { padding: 8px; } .genui-card__header, .genui-card__body { padding: 14px; } }
`;
