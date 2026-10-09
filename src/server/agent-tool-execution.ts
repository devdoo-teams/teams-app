import type { CoreAgentToolExecution } from '../shared/core-orchestration.js';
import { stripVTControlCharacters } from 'node:util';
import { redactCliDiagnostics } from './cli-diagnostics.js';
import { redactSensitiveText } from './sensitive-text.js';

export const MAX_AGENT_TOOL_OUTPUT_LENGTH = 1024;
const MAX_RAW_OUTPUT_LENGTH = 64 * 1024;
export const COMMAND_EXECUTION_SOURCE = 'codex.exec.jsonl.command_execution' as const;
const ITEM_ID = /^item_[0-9]{1,10}$/u;
const TERMINAL_STATUS = new Set(['completed', 'failed', 'declined']);

export function maskAgentToolOutput(input: string): { output: string; outputTruncated: boolean } {
  // Never cut an unmasked credential or an unterminated private key at the cap.
  if (input.length > MAX_RAW_OUTPUT_LENGTH) return { output: '[출력 크기 제한]', outputTruncated: true };
  const normalized = stripVTControlCharacters(input).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, '');
  if (/["']?\b(?:command|argv|arguments)["']?\s*[:=]/iu.test(normalized)) {
    // Whole-payload omission also covers multiline/nested JSON argument arrays.
    return { output: '[원시 실행 정보 숨김]', outputTruncated: true };
  }
  const protectedText = normalized.replace(/-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?(?:-----END(?: [A-Z0-9]+)* PRIVATE KEY-----|$)/giu, '[비밀키 숨김]');
  const safe = redactCliDiagnostics(redactSensitiveText(protectedText), { maxChars: MAX_RAW_OUTPUT_LENGTH })
    .replace(/[\u0080-\u009f]/gu, '')
    .replace(/\b(?:command|argv|arguments)\s*[:=][^\n]*/giu, '[원시 실행 정보 숨김]')
    .replace(/https?:\/\/[^\s<>"'`]+/giu, '[URL 숨김]')
    .replace(/(?:\\\\|\/\/)[^\r\n|,;]+/gu, '[경로 숨김]')
    .replace(/[A-Za-z]:\\[^\r\n|,;]+/gu, '[경로 숨김]')
    .replace(/~?\/(?:[^\s"'`,;|()[\]{}<>]+\/?)+/gu, '[경로 숨김]');
  return { output: safe.slice(0, MAX_AGENT_TOOL_OUTPUT_LENGTH), outputTruncated: safe.length > MAX_AGENT_TOOL_OUTPUT_LENGTH };
}

/** Read only the pinned command event contract. Text in agent_message is excluded. */
export function projectCommandExecution(type: string | undefined, item: Record<string, unknown>, observedAt: string): CoreAgentToolExecution | undefined {
  if (item.type !== 'command_execution' || typeof item.id !== 'string' || !ITEM_ID.test(item.id)) return undefined;
  if (type === 'item.started' && item.status === 'in_progress') {
    return { source: COMMAND_EXECUTION_SOURCE, itemId: item.id, status: 'in_progress' };
  }
  if (type !== 'item.completed' || typeof item.status !== 'string' || !TERMINAL_STATUS.has(item.status)) return undefined;
  if (item.exit_code != null && (typeof item.exit_code !== 'number' || !Number.isInteger(item.exit_code)
    || item.exit_code < -2147483648 || item.exit_code > 2147483647)) return undefined;
  return {
    source: COMMAND_EXECUTION_SOURCE, itemId: item.id, status: item.status as CoreAgentToolExecution['status'], observedAt,
    ...(typeof item.exit_code === 'number' ? { exitCode: item.exit_code } : {}),
    ...(typeof item.aggregated_output === 'string' ? maskAgentToolOutput(item.aggregated_output) : {}),
  };
}

/** Normalize persisted/merged records through the same whitelist and masker. */
export function readCommandExecution(value: unknown): CoreAgentToolExecution | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.source !== COMMAND_EXECUTION_SOURCE || typeof raw.itemId !== 'string' || !ITEM_ID.test(raw.itemId)) return undefined;
  if (raw.status === 'in_progress') {
    if (raw.exitCode !== undefined || raw.output !== undefined || raw.outputTruncated !== undefined || raw.observedAt !== undefined) return undefined;
    return { source: COMMAND_EXECUTION_SOURCE, itemId: raw.itemId, status: 'in_progress' };
  }
  if (typeof raw.observedAt !== 'string' || Number.isNaN(Date.parse(raw.observedAt))) return undefined;
  if ((raw.output !== undefined && (typeof raw.output !== 'string' || raw.output.length > MAX_AGENT_TOOL_OUTPUT_LENGTH))
    || (raw.outputTruncated !== undefined && typeof raw.outputTruncated !== 'boolean')) return undefined;
  const projected = projectCommandExecution('item.completed', {
    type: 'command_execution', id: raw.itemId, status: raw.status, exit_code: raw.exitCode, aggregated_output: raw.output,
  }, raw.observedAt);
  return projected ? { ...projected, ...(typeof raw.outputTruncated === 'boolean' ? { outputTruncated: raw.outputTruncated || projected.outputTruncated === true } : {}) } : undefined;
}
