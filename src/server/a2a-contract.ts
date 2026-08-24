import crypto from 'node:crypto';

import type { AgentJobStatus } from './agent-job-store.js';

export const A2A_PROTOCOL_VERSION = '1.0' as const;

export const CORE_AGENT_CAPABILITIES = {
  streaming: false,
  pushNotifications: false,
  extendedAgentCard: false,
} as const;

export const CORE_INPUT_MODES = ['text/plain', 'application/json'] as const;
export const CORE_OUTPUT_MODES = ['text/plain', 'application/json'] as const;

const MAX_ID_LENGTH = 200;
const MAX_TEXT_LENGTH = 16_000;
const MAX_PART_COUNT = 16;
const MAX_JSON_BYTES = 16_000;
const MAX_METADATA_KEYS = 32;
const MAX_METADATA_DEPTH = 5;
const MAX_METADATA_NODES = 256;
const MAX_METADATA_ITEMS = 32;
const MAX_METADATA_BYTES = 16_000;
const MAX_METADATA_STRING_LENGTH = 2_000;
const MAX_PAGE_LIMIT = 100;
const MAX_DEADLINE_MS = 24 * 60 * 60 * 1000;
export const CORE_A2A_GRAPH_POLICY = Object.freeze({
  maxDepth: 8,
  maxFanOut: 16,
});
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const CURSOR = /^[A-Za-z0-9._:-]{1,200}$/;
const SHA256 = /^[a-f0-9]{64}$/i;

export type A2AScope = {
  tenantId: string;
  requesterId: string;
  conversationId: string;
};

export type A2AErrorName =
  | 'InvalidRequestError'
  | 'InvalidPartError'
  | 'ContentTypeNotSupportedError'
  | 'ExtensionSupportRequiredError'
  | 'VersionNotSupportedError'
  | 'UnsupportedOperationError'
  | 'PushNotificationNotSupportedError'
  | 'ScopeMismatchError'
  | 'DeadlineExceededError'
  | 'GraphLimitExceededError'
  | 'InvalidArtifactRefError'
  | 'InvalidTaskError'
  | 'TerminalStateImmutableError';

export class A2AContractError extends Error {
  readonly code: A2AErrorName;
  readonly retryable: boolean;
  readonly details?: Record<string, string | number | boolean>;

  constructor(
    name: A2AErrorName,
    message: string,
    options: {
      retryable?: boolean;
      details?: Record<string, string | number | boolean>;
    } = {},
  ) {
    super(message);
    this.name = name;
    this.code = name;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }

  toJSON(): {
    error: {
      name: A2AErrorName;
      code: A2AErrorName;
      message: string;
      retryable: boolean;
      details?: Record<string, string | number | boolean>;
    };
  } {
    return {
      error: {
        name: this.name as A2AErrorName,
        code: this.code,
        message: redactAndBoundText(this.message, 500),
        retryable: this.retryable,
        ...(this.details ? { details: safeErrorDetails(this.details) } : {}),
      },
    };
  }
}

export type A2AAgentInterface = {
  url: string;
  protocolBinding: 'HTTP+JSON';
  protocolVersion: typeof A2A_PROTOCOL_VERSION;
};

export type A2AAgentCard = {
  agentId: string;
  name: string;
  description: string;
  version: string;
  supportedInterfaces: A2AAgentInterface[];
  capabilities: typeof CORE_AGENT_CAPABILITIES;
  defaultInputModes: readonly string[];
  defaultOutputModes: readonly string[];
  skills: Array<{ id: string; name: string; description: string }>;
};

export type A2AOfficialAgentCard = {
  name: string;
  description: string;
  supportedInterfaces: Array<{
    url: string;
    protocolBinding: 'JSONRPC';
    protocolVersion: typeof A2A_PROTOCOL_VERSION;
  }>;
  version: string;
  capabilities: typeof CORE_AGENT_CAPABILITIES;
  securitySchemes: Record<string, Record<string, unknown>>;
  securityRequirements: Array<Record<string, string[]>>;
  defaultInputModes: readonly string[];
  defaultOutputModes: readonly string[];
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
    inputModes?: string[];
    outputModes?: string[];
  }>;
};

export type A2AJsonData = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type A2APart =
  | { text: string; mediaType?: 'text/plain'; metadata?: Record<string, unknown> }
  | { data: A2AJsonData; mediaType: 'application/json'; metadata?: Record<string, unknown> };

export type A2AMessage = {
  messageId: string;
  role: 'user' | 'agent';
  parts: A2APart[];
  contextId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
};

export type A2ASendRequest = {
  message: A2AMessage;
  idempotencyKey: string;
  scope?: Partial<A2AScope>;
  inputMode?: string;
  outputMode?: string;
  deadline?: string;
  depth?: number;
  fanOutIndex?: number;
  stream?: boolean;
  extension?: unknown;
};

export type A2AArtifactRef = {
  artifactId: string;
  taskId: string;
  sourceTaskId: string;
  sha256: string;
  byteSize: number;
  mediaType: string;
  name: string;
  scope: A2AScope;
  content?: {
    mediaType: 'text/plain';
    text: string;
  };
  metadata?: Record<string, unknown>;
};

export type A2ATaskStatus =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'canceled';

export type A2ATask = {
  id: string;
  contextId: string;
  status: A2ATaskStatus;
  scope: A2AScope;
  artifacts: A2AArtifactRef[];
  error?: string;
};

function fail(
  name: A2AErrorName,
  message: string,
  options?: { retryable?: boolean; details?: Record<string, string | number | boolean> },
): never {
  throw new A2AContractError(name, message, options);
}

function asRecord(value: unknown, name: A2AErrorName = 'InvalidRequestError'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(name, 'A2A value must be an object.');
  return value as Record<string, unknown>;
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], name: A2AErrorName): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(name, `Unsupported A2A field: ${key}.`);
  }
}

function boundedText(value: unknown, field: string, max = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string') fail('InvalidRequestError', `${field} must be a string.`);
  if (!value.trim()) fail('InvalidRequestError', `${field} must not be empty.`);
  if (value.length > max || CONTROL_CHARACTERS.test(value)) {
    CONTROL_CHARACTERS.lastIndex = 0;
    fail('InvalidRequestError', `${field} is outside the allowed bounds.`);
  }
  CONTROL_CHARACTERS.lastIndex = 0;
  return value;
}

function opaqueId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
    fail('InvalidRequestError', `${field} must be a bounded opaque identifier.`);
  }
  return value;
}

const METADATA_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,80}$/;
const DISALLOWED_METADATA_KEY = /(token|secret|password|credential|api.?key|authorization|bearer|private.?key|client.?secret)/i;
const DANGEROUS_METADATA_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const BEARER_SECRET = /((?:\bauthorization\s*[:=]\s*)?\bbearer\s+)[^\s,;]+/gi;
const KEY_VALUE_SECRET = /(\b(?:api[_-]?key|token|secret|password|credential|authorization)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;

function normalizeMetadataValue(
  value: unknown,
  field: string,
  depth: number,
  state: { nodes: number },
): unknown {
  if (depth > MAX_METADATA_DEPTH) fail('InvalidRequestError', `${field} exceeds the metadata nesting limit.`);
  state.nodes += 1;
  if (state.nodes > MAX_METADATA_NODES) fail('InvalidRequestError', `${field} contains too many metadata values.`);

  if (value === null) return null;
  if (typeof value === 'string') return boundedText(value, field, MAX_METADATA_STRING_LENGTH);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('InvalidRequestError', `${field} must contain only finite numbers.`);
    return value;
  }
  if (typeof value !== 'object') fail('InvalidRequestError', `${field} contains a non-JSON value.`);

  if (Array.isArray(value)) {
    if (value.length > MAX_METADATA_ITEMS) fail('InvalidRequestError', `${field} has too many items.`);
    return value.map((item, index) => normalizeMetadataValue(item, `${field}[${index}]`, depth + 1, state));
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail('InvalidRequestError', `${field} must contain only plain JSON objects.`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length > MAX_METADATA_KEYS) fail('InvalidRequestError', `${field} has too many keys.`);
  if (Object.getOwnPropertySymbols(record).some((symbol) => Object.prototype.propertyIsEnumerable.call(record, symbol))) {
    fail('InvalidRequestError', `${field} must not contain symbol keys.`);
  }

  const normalized: Record<string, unknown> = {};
  for (const key of keys) {
    if (!METADATA_KEY.test(key) || DISALLOWED_METADATA_KEY.test(key) || DANGEROUS_METADATA_KEYS.has(key)) {
      fail('InvalidRequestError', `${field} contains a disallowed key.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !('value' in descriptor)) fail('InvalidRequestError', `${field}.${key} must be a data property.`);
    normalized[key] = normalizeMetadataValue(descriptor.value, `${field}.${key}`, depth + 1, state);
  }
  return normalized;
}

function metadata(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizeMetadataValue(value, field, 0, { nodes: 0 });
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    fail('InvalidRequestError', `${field} must be an object.`);
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(normalized);
  } catch {
    fail('InvalidRequestError', `${field} must be JSON serializable.`);
  }
  if (typeof serialized !== 'string') fail('InvalidRequestError', `${field} must be JSON serializable.`);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_METADATA_BYTES) {
    fail('InvalidRequestError', `${field} exceeds the metadata size limit.`);
  }
  return normalized as Record<string, unknown>;
}

export function createCoreAgentCard(input: {
  agentId: string;
  name: string;
  description: string;
  version: string;
  endpoint: string;
}): A2AAgentCard {
  const endpoint = boundedText(input.endpoint, 'endpoint', 500).replace(/\/$/, '');
  let url: URL;
  try {
    url = new URL(`${endpoint}/message:send`);
  } catch {
    fail('InvalidRequestError', 'endpoint must be an absolute HTTPS URL.');
  }
  if (url.protocol !== 'https:') fail('InvalidRequestError', 'endpoint must be an absolute HTTPS URL.');

  return {
    agentId: opaqueId(input.agentId, 'agentId'),
    name: boundedText(input.name, 'name', 200),
    description: boundedText(input.description, 'description', 1_000),
    version: boundedText(input.version, 'version', 120),
    supportedInterfaces: [{
      url: url.toString(),
      protocolBinding: 'HTTP+JSON',
      protocolVersion: A2A_PROTOCOL_VERSION,
    }],
    capabilities: CORE_AGENT_CAPABILITIES,
    defaultInputModes: [...CORE_INPUT_MODES],
    defaultOutputModes: [...CORE_OUTPUT_MODES],
    skills: [{
      id: 'teams-core-tasks',
      name: 'Teams Core tasks',
      description: 'Bounded authenticated task execution with polling.',
    }],
  };
}

/**
 * Create the public Agent Card shape defined by the current A2A specification.
 * The internal Core card above remains available for the legacy REST surface.
 */
export function createCoreOfficialAgentCard(input: {
  name: string;
  description: string;
  version: string;
  endpoint: string;
  securitySchemes: Record<string, Record<string, unknown>>;
  securityRequirements: Array<Record<string, string[]>>;
}): A2AOfficialAgentCard {
  const endpoint = boundedText(input.endpoint, 'endpoint', 500).replace(/\/$/, '');
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    fail('InvalidRequestError', 'endpoint must be an absolute HTTPS URL.');
  }
  if (url.protocol !== 'https:') fail('InvalidRequestError', 'endpoint must be an absolute HTTPS URL.');

  if (Object.keys(input.securitySchemes).length === 0 || input.securityRequirements.length === 0) {
    fail('InvalidRequestError', 'securitySchemes and securityRequirements are required.');
  }
  const securitySchemeNames = new Set(Object.keys(input.securitySchemes));
  for (const requirement of input.securityRequirements) {
    if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement)) {
      fail('InvalidRequestError', 'securityRequirements must contain objects.');
    }
    for (const [name, scopes] of Object.entries(requirement)) {
      if (!securitySchemeNames.has(name) || !Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string')) {
        fail('InvalidRequestError', 'securityRequirements must reference declared security schemes.');
      }
    }
  }

  return {
    name: boundedText(input.name, 'name', 200),
    description: boundedText(input.description, 'description', 1_000),
    supportedInterfaces: [{
      url: url.toString(),
      protocolBinding: 'JSONRPC',
      protocolVersion: A2A_PROTOCOL_VERSION,
    }],
    version: boundedText(input.version, 'version', 120),
    capabilities: CORE_AGENT_CAPABILITIES,
    securitySchemes: JSON.parse(JSON.stringify(input.securitySchemes)) as Record<string, Record<string, unknown>>,
    securityRequirements: input.securityRequirements.map((requirement) => ({
      ...requirement,
      ...Object.fromEntries(Object.entries(requirement).map(([name, scopes]) => [name, [...scopes]])),
    })),
    defaultInputModes: [...CORE_INPUT_MODES],
    defaultOutputModes: ['text/plain'],
    skills: [{
      id: 'teams-core-tasks',
      name: 'Teams Core tasks',
      description: 'Bounded authenticated task execution with polling.',
      tags: ['teams', 'tasks', 'a2a'],
      inputModes: [...CORE_INPUT_MODES],
      outputModes: ['text/plain'],
    }],
  };
}

export function validateAgentCard(value: unknown): A2AAgentCard {
  const card = asRecord(value);
  assertAllowedKeys(card, [
    'agentId', 'name', 'description', 'version', 'supportedInterfaces',
    'capabilities', 'defaultInputModes', 'defaultOutputModes', 'skills',
  ], 'InvalidRequestError');
  const capabilities = asRecord(card.capabilities);
  assertAllowedKeys(capabilities, ['streaming', 'pushNotifications', 'extendedAgentCard'], 'InvalidRequestError');
  if (capabilities.streaming === true) fail('UnsupportedOperationError', 'Core does not support streaming.');
  if (capabilities.pushNotifications === true) fail('PushNotificationNotSupportedError', 'Core does not support push notifications.');
  if (capabilities.streaming !== false || capabilities.pushNotifications !== false || capabilities.extendedAgentCard !== false) {
    fail('InvalidRequestError', 'Core capability declarations must be explicit and disabled unless implemented.');
  }
  const interfaces = card.supportedInterfaces;
  if (!Array.isArray(interfaces) || interfaces.length === 0) fail('InvalidRequestError', 'supportedInterfaces is required.');
  const normalizedInterfaces = interfaces.map((entry) => {
    const item = asRecord(entry);
    assertAllowedKeys(item, ['url', 'protocolBinding', 'protocolVersion'], 'InvalidRequestError');
    const rawUrl = boundedText(item.url, 'supportedInterfaces.url', 1_000);
    let parsed: URL;
    try { parsed = new URL(rawUrl); } catch { fail('InvalidRequestError', 'interface URL must be absolute HTTPS.'); }
    if (parsed.protocol !== 'https:') fail('InvalidRequestError', 'interface URL must be absolute HTTPS.');
    if (item.protocolBinding !== 'HTTP+JSON' || item.protocolVersion !== A2A_PROTOCOL_VERSION) {
      fail('VersionNotSupportedError', 'Core supports only HTTP+JSON A2A v1.0.');
    }
    return { url: parsed.toString(), protocolBinding: 'HTTP+JSON' as const, protocolVersion: A2A_PROTOCOL_VERSION };
  });
  const inputs = card.defaultInputModes;
  const outputs = card.defaultOutputModes;
  if (!Array.isArray(inputs) || inputs.some((mode) => !CORE_INPUT_MODES.includes(mode as typeof CORE_INPUT_MODES[number]))) {
    fail('ContentTypeNotSupportedError', 'Unsupported default input mode.');
  }
  if (!Array.isArray(outputs) || outputs.some((mode) => !CORE_OUTPUT_MODES.includes(mode as typeof CORE_OUTPUT_MODES[number]))) {
    fail('ContentTypeNotSupportedError', 'Unsupported default output mode.');
  }
  if (!Array.isArray(card.skills)) fail('InvalidRequestError', 'skills is required.');
  const skills = card.skills.map((skill) => {
    const item = asRecord(skill);
    assertAllowedKeys(item, ['id', 'name', 'description'], 'InvalidRequestError');
    return {
      id: opaqueId(item.id, 'skill.id'),
      name: boundedText(item.name, 'skill.name', 200),
      description: boundedText(item.description, 'skill.description', 1_000),
    };
  });
  return {
    agentId: opaqueId(card.agentId, 'agentId'),
    name: boundedText(card.name, 'name', 200),
    description: boundedText(card.description, 'description', 1_000),
    version: boundedText(card.version, 'version', 120),
    supportedInterfaces: normalizedInterfaces,
    capabilities: CORE_AGENT_CAPABILITIES,
    defaultInputModes: [...inputs] as string[],
    defaultOutputModes: [...outputs] as string[],
    skills,
  };
}

export function serializeAgentCard(card: A2AAgentCard): string {
  return JSON.stringify(validateAgentCard(card));
}

export function validateA2AVersion(value: unknown): typeof A2A_PROTOCOL_VERSION {
  if (value !== A2A_PROTOCOL_VERSION) fail('VersionNotSupportedError', 'A2A protocol version 1.0 is required.');
  return A2A_PROTOCOL_VERSION;
}

export function validateScope(value: unknown): A2AScope {
  const scope = asRecord(value);
  assertAllowedKeys(scope, ['tenantId', 'requesterId', 'conversationId'], 'InvalidRequestError');
  return {
    tenantId: boundedText(scope.tenantId, 'scope.tenantId', 256),
    requesterId: boundedText(scope.requesterId, 'scope.requesterId', 256),
    conversationId: boundedText(scope.conversationId, 'scope.conversationId', 512),
  };
}

export function assertScopeMatchesServer(bodyScope: unknown, serverScope: Partial<A2AScope>): void {
  const raw = asRecord(bodyScope);
  assertAllowedKeys(raw, ['tenantId', 'requesterId', 'conversationId'], 'InvalidRequestError');
  const body = Object.fromEntries(
    (['tenantId', 'requesterId', 'conversationId'] as const)
      .filter((key) => raw[key] !== undefined)
      .map((key) => [key, boundedText(raw[key], `scope.${key}`, key === 'conversationId' ? 512 : 256)]),
  ) as Partial<A2AScope>;
  for (const key of ['tenantId', 'requesterId', 'conversationId'] as const) {
    const expected = serverScope[key];
    if (body[key] !== undefined && expected !== undefined && body[key] !== expected) {
      fail('ScopeMismatchError', `scope.${key} does not match authenticated server scope.`);
    }
  }
}

export function validatePart(value: unknown): A2APart {
  const part = asRecord(value, 'InvalidPartError');
  if ('extensions' in part) fail('ExtensionSupportRequiredError', 'A2A extensions are not enabled in Core.');
  const hasText = 'text' in part;
  const hasData = 'data' in part;
  const hasRaw = 'raw' in part;
  const hasUrl = 'url' in part;
  if (hasRaw || hasUrl) fail('ContentTypeNotSupportedError', 'Core accepts text and structured JSON Parts only.');
  if (Number(hasText) + Number(hasData) !== 1) fail('InvalidPartError', 'A Part must contain exactly one supported payload.');
  const partMetadata = metadata(part.metadata, 'part.metadata');
  if (hasText) {
    if (part.mediaType !== undefined && part.mediaType !== 'text/plain') fail('ContentTypeNotSupportedError', 'Only text/plain Parts are supported.');
    let text: string;
    try {
      text = boundedText(part.text, 'part.text');
    } catch (error) {
      if (error instanceof A2AContractError) fail('InvalidPartError', 'part.text is outside the allowed bounds.');
      throw error;
    }
    return { text, ...(part.mediaType ? { mediaType: 'text/plain' as const } : {}), ...(partMetadata ? { metadata: partMetadata } : {}) };
  }
  if (part.mediaType !== 'application/json') fail('ContentTypeNotSupportedError', 'Structured Parts require application/json.');
  const data = part.data;
  if (data === undefined || ['function', 'symbol', 'bigint'].includes(typeof data)) {
    fail('InvalidPartError', 'Structured Part data must be a JSON value.');
  }
  let serialized: string | undefined;
  try { serialized = JSON.stringify(data); } catch { fail('InvalidPartError', 'Structured Part data must be JSON serializable.'); }
  if (typeof serialized !== 'string') fail('InvalidPartError', 'Structured Part data must serialize to a JSON string.');
  if (serialized.length > MAX_JSON_BYTES || CONTROL_CHARACTERS.test(serialized)) {
    CONTROL_CHARACTERS.lastIndex = 0;
    fail('InvalidPartError', 'Structured Part data is outside the allowed bounds.');
  }
  CONTROL_CHARACTERS.lastIndex = 0;
  return { data: JSON.parse(serialized) as A2AJsonData, mediaType: 'application/json', ...(partMetadata ? { metadata: partMetadata } : {}) };
}

export function validateMessage(value: unknown): A2AMessage {
  const message = asRecord(value);
  assertAllowedKeys(message, ['messageId', 'role', 'parts', 'contextId', 'taskId', 'metadata'], 'InvalidRequestError');
  const parts = message.parts;
  if (!Array.isArray(parts) || parts.length === 0 || parts.length > MAX_PART_COUNT) fail('InvalidRequestError', 'message.parts must be a bounded non-empty array.');
  return {
    messageId: opaqueId(message.messageId, 'messageId'),
    role: message.role === 'user' || message.role === 'agent' ? message.role : fail('InvalidRequestError', 'message.role is invalid.'),
    parts: parts.map(validatePart),
    ...(message.contextId === undefined ? {} : { contextId: opaqueId(message.contextId, 'contextId') }),
    ...(message.taskId === undefined ? {} : { taskId: opaqueId(message.taskId, 'taskId') }),
    ...(message.metadata === undefined ? {} : { metadata: metadata(message.metadata, 'message.metadata') }),
  };
}

export function validateIdempotencyKey(value: unknown): string {
  return opaqueId(value, 'idempotencyKey');
}

export function validateCursor(value: unknown): string {
  if (typeof value !== 'string' || !CURSOR.test(value)) fail('InvalidRequestError', 'cursor is invalid.');
  return value;
}

export function validatePageLimit(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_PAGE_LIMIT) fail('InvalidRequestError', 'page limit is invalid.');
  return value as number;
}

export function validateDeadline(value: unknown, options: { nowMs?: number } = {}): string {
  if (typeof value !== 'string') fail('InvalidRequestError', 'deadline must be an ISO timestamp.');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail('InvalidRequestError', 'deadline must be canonical ISO-8601.');
  const now = options.nowMs ?? Date.now();
  if (parsed.getTime() <= now || parsed.getTime() - now > MAX_DEADLINE_MS) fail('DeadlineExceededError', 'deadline is outside the allowed execution window.');
  return value;
}

export function validateGraphLimits(input: {
  depth: unknown;
  fanOutIndex: unknown;
  maxDepth?: number;
  maxFanOut?: number;
}): void {
  const maxDepth = input.maxDepth ?? CORE_A2A_GRAPH_POLICY.maxDepth;
  const maxFanOut = input.maxFanOut ?? CORE_A2A_GRAPH_POLICY.maxFanOut;
  if (!Number.isSafeInteger(input.depth) || (input.depth as number) < 0 || (input.depth as number) > maxDepth
    || !Number.isSafeInteger(input.fanOutIndex) || (input.fanOutIndex as number) < 0 || (input.fanOutIndex as number) >= maxFanOut) {
    fail('GraphLimitExceededError', 'A2A graph depth or fan-out exceeds the Core budget.');
  }
}

export function validateSendRequest(value: unknown, serverScope: A2AScope, options: { nowMs?: number } = {}): A2ASendRequest {
  const request = asRecord(value);
  assertAllowedKeys(request, ['message', 'idempotencyKey', 'scope', 'inputMode', 'outputMode', 'deadline', 'depth', 'fanOutIndex', 'stream', 'extension'], 'InvalidRequestError');
  if (request.scope !== undefined) assertScopeMatchesServer(request.scope, serverScope);
  if ('stream' in request && request.stream !== undefined && request.stream !== false) fail('UnsupportedOperationError', 'Core supports polling only.');
  if ('extension' in request && request.extension !== undefined) fail('ExtensionSupportRequiredError', 'A2A extensions are not enabled in Core.');
  const inputMode = request.inputMode === undefined ? 'text/plain' : boundedText(request.inputMode, 'inputMode', 120);
  const outputMode = request.outputMode === undefined ? 'text/plain' : boundedText(request.outputMode, 'outputMode', 120);
  if (!CORE_INPUT_MODES.includes(inputMode as typeof CORE_INPUT_MODES[number])) fail('ContentTypeNotSupportedError', 'inputMode is not supported.');
  if (!CORE_OUTPUT_MODES.includes(outputMode as typeof CORE_OUTPUT_MODES[number])) fail('ContentTypeNotSupportedError', 'outputMode is not supported.');
  const depth = request.depth ?? 0;
  const fanOutIndex = request.fanOutIndex ?? 0;
  validateGraphLimits({ depth, fanOutIndex });
  return {
    message: validateMessage(request.message),
    idempotencyKey: validateIdempotencyKey(request.idempotencyKey),
    ...(request.scope ? { scope: request.scope as Partial<A2AScope> } : {}),
    inputMode,
    outputMode,
    ...(request.deadline === undefined ? {} : { deadline: validateDeadline(request.deadline, options) }),
    depth: depth as number,
    fanOutIndex: fanOutIndex as number,
  };
}

export function validateArtifactRef(value: unknown, serverScope: A2AScope): A2AArtifactRef {
  const artifact = asRecord(value, 'InvalidArtifactRefError');
  assertAllowedKeys(artifact, ['artifactId', 'taskId', 'sourceTaskId', 'sha256', 'byteSize', 'mediaType', 'name', 'scope', 'content', 'metadata'], 'InvalidArtifactRefError');
  const scope = validateScope(artifact.scope);
  assertScopeMatchesServer(scope, serverScope);
  const name = boundedText(artifact.name, 'artifact.name', 256);
  if (name.includes('..') || name.includes('/') || name.includes('\\')) fail('InvalidArtifactRefError', 'artifact.name must be a logical filename.');
  if (typeof artifact.byteSize !== 'number' || !Number.isSafeInteger(artifact.byteSize) || artifact.byteSize <= 0 || artifact.byteSize > MAX_JSON_BYTES * 64) {
    fail('InvalidArtifactRefError', 'artifact.byteSize is invalid.');
  }
  if (typeof artifact.sha256 !== 'string' || !SHA256.test(artifact.sha256)) fail('InvalidArtifactRefError', 'artifact.sha256 is invalid.');
  const mediaType = boundedText(artifact.mediaType, 'artifact.mediaType', 120);
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mediaType)) fail('InvalidArtifactRefError', 'artifact.mediaType is invalid.');
  let content: A2AArtifactRef['content'];
  if (artifact.content !== undefined) {
    const rawContent = asRecord(artifact.content, 'InvalidArtifactRefError');
    assertAllowedKeys(rawContent, ['mediaType', 'text'], 'InvalidArtifactRefError');
    if (rawContent.mediaType !== 'text/plain' || mediaType !== 'text/plain') {
      fail('InvalidArtifactRefError', 'Only text/plain artifact content is supported.');
    }
    const text = boundedText(rawContent.text, 'artifact.content.text');
    const bytes = Buffer.byteLength(text, 'utf8');
    const sha256 = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    if (bytes !== artifact.byteSize || sha256 !== artifact.sha256) {
      fail('InvalidArtifactRefError', 'artifact content integrity does not match its reference.');
    }
    content = { mediaType: 'text/plain', text };
  }
  let artifactMetadata: Record<string, unknown> | undefined;
  try {
    artifactMetadata = metadata(artifact.metadata, 'artifact.metadata');
  } catch (error) {
    if (error instanceof A2AContractError) fail('InvalidArtifactRefError', 'artifact.metadata is not safe to persist.');
    throw error;
  }
  return {
    artifactId: opaqueId(artifact.artifactId, 'artifact.artifactId'),
    taskId: opaqueId(artifact.taskId, 'artifact.taskId'),
    sourceTaskId: opaqueId(artifact.sourceTaskId, 'artifact.sourceTaskId'),
    sha256: artifact.sha256,
    byteSize: artifact.byteSize,
    mediaType,
    name,
    scope,
    ...(content ? { content } : {}),
    ...(artifactMetadata ? { metadata: artifactMetadata } : {}),
  };
}

export function mapInternalTaskStatus(status: AgentJobStatus): A2ATaskStatus {
  const mapping: Record<AgentJobStatus, A2ATaskStatus> = {
    queued: 'submitted',
    awaiting_approval: 'input-required',
    running: 'working',
    completed: 'completed',
    failed: 'failed',
    cancelled: 'canceled',
  };
  return mapping[status];
}

export function validateTask(value: unknown): A2ATask {
  const task = asRecord(value, 'InvalidTaskError');
  assertAllowedKeys(task, ['id', 'contextId', 'status', 'scope', 'artifacts', 'error'], 'InvalidTaskError');
  const status = task.status;
  const allowedStatuses: readonly A2ATaskStatus[] = ['submitted', 'working', 'input-required', 'completed', 'failed', 'canceled'];
  if (!allowedStatuses.includes(status as A2ATaskStatus)) fail('InvalidTaskError', 'task.status is invalid.');
  const artifacts = task.artifacts;
  if (!Array.isArray(artifacts)) fail('InvalidTaskError', 'task.artifacts must be an array.');
  const scope = validateScope(task.scope);
  const normalizedArtifacts = artifacts.map((artifact) => validateArtifactRef(artifact, scope));
  const taskId = opaqueId(task.id, 'task.id');
  if (normalizedArtifacts.some((artifact) => artifact.taskId !== taskId)) {
    fail('InvalidTaskError', 'task artifacts must belong to the enclosing Core task.');
  }
  if (status === 'completed' && normalizedArtifacts.length === 0) fail('InvalidTaskError', 'completed tasks require an artifact.');
  return {
    id: taskId,
    contextId: opaqueId(task.contextId, 'task.contextId'),
    status: status as A2ATaskStatus,
    scope,
    artifacts: normalizedArtifacts,
    ...(task.error === undefined ? {} : { error: redactAndBoundText(boundedText(task.error, 'task.error', 10_000), 10_000) }),
  };
}

function safeErrorDetails(details: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(details)) {
    if (/(token|secret|password|credential|api.?key|authorization|bearer)/i.test(key)) {
      safe[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      safe[key] = redactAndBoundText(value, 500);
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

export function assertTaskTransition(previous: A2ATask, next: A2ATask): void {
  const before = validateTask(previous);
  const after = validateTask(next);
  if (before.id !== after.id || before.contextId !== after.contextId
    || before.scope.tenantId !== after.scope.tenantId
    || before.scope.requesterId !== after.scope.requesterId
    || before.scope.conversationId !== after.scope.conversationId) {
    fail('InvalidTaskError', 'task identity and scope are immutable.');
  }
  const terminal: readonly A2ATaskStatus[] = ['completed', 'failed', 'canceled'];
  if (terminal.includes(before.status) && before.status !== after.status) fail('TerminalStateImmutableError', 'terminal task state is immutable.');
  if (terminal.includes(before.status) && normalizedTaskSnapshot(before) !== normalizedTaskSnapshot(after)) {
    fail('TerminalStateImmutableError', 'terminal task payload is immutable.');
  }
}

function normalizedTaskSnapshot(task: A2ATask): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map((key) => [key, normalize(record[key])]));
    }
    return value;
  };
  return JSON.stringify(normalize(task));
}

export function redactAndBoundText(value: string, maxLength = MAX_TEXT_LENGTH): string {
  let normalized = String(value).replace(CONTROL_CHARACTERS, '�');
  normalized = normalized
    .replace(BEARER_SECRET, '$1[REDACTED]')
    .replace(KEY_VALUE_SECRET, '$1[REDACTED]');
  return normalized.slice(0, Math.max(0, maxLength));
}
