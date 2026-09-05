import type { CoreAgentToolUsage } from '../shared/core-orchestration.js';
import type { CodexRunEvent } from './codex-runner.js';

export const MAX_OBSERVED_AGENT_TOOLS = 32;
export const MAX_AGENT_TOOL_NAME_LENGTH = 120;

const SAFE_TOOL_PART = /^[a-z0-9][a-z0-9._:+-]{0,79}$/iu;
const SAFE_TOOL_CATEGORIES = new Set<CoreAgentToolUsage['category']>([
  'skill',
  'plugin',
  'mcp',
  'cli',
  'builtin',
]);
const SHELL_PREFIX = /^(?:['"]?[^\s'"]*\/)?(?:bash|sh|zsh)['"]?\s+-[a-z]*c[a-z]*\s+(.+)$/iu;

function safePart(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().normalize('NFKC');
  return SAFE_TOOL_PART.test(normalized) ? normalized : undefined;
}

function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function commandExecutable(command: string): string | undefined {
  const shellBody = command.trim().match(SHELL_PREFIX)?.[1] ?? command.trim();
  const tokens = stripOuterQuotes(shellBody).match(/(?:'[^']*'|"[^"]*"|[^\s]+)/gu) ?? [];
  let index = 0;
  if (stripOuterQuotes(tokens[index] ?? '') === 'env') index += 1;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[index] ?? '')) index += 1;
  const token = stripOuterQuotes(tokens[index] ?? '').replace(/[;&|]+$/u, '');
  if (!token || token.startsWith('-') || token.includes('=')) return undefined;
  return safePart(token.split('/').at(-1));
}

function pushUnique(target: CoreAgentToolUsage[], usage: CoreAgentToolUsage): void {
  if (!target.some((candidate) => candidate.category === usage.category && candidate.name === usage.name)) {
    target.push(usage);
  }
}

/**
 * Project a Codex JSONL event into a bounded, argument-free audit record.
 * Raw commands, tool input, output, paths, and credentials are never returned.
 */
export function observeCodexToolUsage(
  event: CodexRunEvent,
  observedAt = new Date().toISOString(),
): CoreAgentToolUsage[] {
  if (event.type !== 'item.started' || !event.item) return [];
  const observed: CoreAgentToolUsage[] = [];

  if (event.item.type === 'command_execution' && typeof event.item.command === 'string') {
    const executable = commandExecutable(event.item.command);
    if (executable) pushUnique(observed, { category: 'cli', name: executable, observedAt });

  }

  if (event.item.type === 'mcp_tool_call') {
    const server = safePart(event.item.server);
    const name = safePart(event.item.name);
    if (server && name) {
      pushUnique(observed, { category: 'mcp', name: `${server}/${name}`, observedAt });
    }
  }

  if (event.item.type === 'tool_call') {
    const name = safePart(event.item.name);
    if (name) pushUnique(observed, { category: 'builtin', name, observedAt });
  }

  return observed.slice(0, MAX_OBSERVED_AGENT_TOOLS);
}

export function mergeObservedToolUsage(
  existing: readonly CoreAgentToolUsage[],
  incoming: readonly CoreAgentToolUsage[],
): CoreAgentToolUsage[] {
  const merged: CoreAgentToolUsage[] = [];
  for (const usage of [...existing, ...incoming]) {
    if (!SAFE_TOOL_CATEGORIES.has(usage.category)
      || typeof usage.observedAt !== 'string'
      || Number.isNaN(Date.parse(usage.observedAt))) {
      continue;
    }
    const nameParts = usage.name.split('/');
    if (usage.name.length > MAX_AGENT_TOOL_NAME_LENGTH || nameParts.some((part) => !safePart(part))) continue;
    pushUnique(merged, { ...usage });
    if (merged.length >= MAX_OBSERVED_AGENT_TOOLS) break;
  }
  return merged;
}
