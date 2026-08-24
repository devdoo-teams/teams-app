import crypto from 'node:crypto';

import {
  A2AContractError,
  redactAndBoundText,
} from './a2a-contract.js';
import type { AgentJobMode } from './agent-job-store.js';

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const CAPABILITY_ID = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const MAX_DISPATCH_PROMPT_LENGTH = 2_000;

export const A2A_ROLE_DISPATCH_SCHEMA_VERSION = 'a2a-core-role-dispatch.v1' as const;

const ROLE_IDS = [
  'provider-adapter',
  'release-auditor',
  'reviewer',
  'test-runner',
] as const;

export const A2A_ROLE_IDS: typeof ROLE_IDS = Object.freeze([...ROLE_IDS]);
export type A2ARoleId = typeof A2A_ROLE_IDS[number];

const CAPABILITIES = [
  'provider.adapter.write',
  'provider.contract.read',
  'provider.health.read',
  'release.audit',
  'release.evidence.read',
  'release.manifest.read',
  'review.report',
  'source.read',
  'tests.read',
  'tests.run',
] as const;

export const A2A_CAPABILITIES: typeof CAPABILITIES = Object.freeze([...CAPABILITIES]);
export type A2ACapability = typeof A2A_CAPABILITIES[number];

export type A2ARoleDefinition = Readonly<{
  id: A2ARoleId;
  description: string;
  mode: AgentJobMode;
  capabilities: readonly A2ACapability[];
}>;

export type A2ARoleDispatchRequest = Readonly<{
  roleId: string;
  requestedCapabilities?: readonly string[];
  parentTaskId?: string;
  childKey?: string;
  prompt?: string;
}>;

export type A2ADispatchPlan = Readonly<{
  schemaVersion: typeof A2A_ROLE_DISPATCH_SCHEMA_VERSION;
  roleId: A2ARoleId;
  mode: AgentJobMode;
  capabilities: readonly A2ACapability[];
  parentTaskId?: string;
  childKey?: string;
  promptSha256?: string;
}>;

function freezeCapabilities(capabilities: readonly A2ACapability[]): readonly A2ACapability[] {
  return Object.freeze([...capabilities].sort()) as readonly A2ACapability[];
}

function freezeRole(input: {
  id: A2ARoleId;
  description: string;
  mode: AgentJobMode;
  capabilities: readonly A2ACapability[];
}): A2ARoleDefinition {
  return Object.freeze({
    id: input.id,
    description: input.description,
    mode: input.mode,
    capabilities: freezeCapabilities(input.capabilities),
  });
}

// Keep this list finite, provider-independent, and sorted by role ID. The
// workspace-write role remains an explicit approval boundary in AgentService.
export const A2A_ROLE_CATALOG: readonly A2ARoleDefinition[] = Object.freeze([
  freezeRole({
    id: 'provider-adapter',
    description: 'Adapt an explicitly selected provider contract after workspace-write approval.',
    mode: 'workspace-write',
    capabilities: ['provider.adapter.write', 'provider.contract.read', 'provider.health.read'],
  }),
  freezeRole({
    id: 'release-auditor',
    description: 'Inspect Core source, manifest, and release evidence without workspace mutation.',
    mode: 'read-only',
    capabilities: ['release.audit', 'release.evidence.read', 'release.manifest.read', 'source.read'],
  }),
  freezeRole({
    id: 'reviewer',
    description: 'Review bounded Core changes and report findings without workspace mutation.',
    mode: 'read-only',
    capabilities: ['review.report', 'source.read'],
  }),
  freezeRole({
    id: 'test-runner',
    description: 'Run bounded Core tests and inspect their results without workspace mutation.',
    mode: 'read-only',
    capabilities: ['source.read', 'tests.read', 'tests.run'],
  }),
]);

function invalid(message: string): never {
  throw new A2AContractError('InvalidRequestError', message);
}

function unsupported(message: string): never {
  throw new A2AContractError('UnsupportedOperationError', message);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('A2A role dispatch value must be an object.');
  return value as Record<string, unknown>;
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    invalid('A2A role dispatch contains an unsupported field.');
  }
}

function roleById(roleId: A2ARoleId): A2ARoleDefinition {
  const role = A2A_ROLE_CATALOG.find((candidate) => candidate.id === roleId);
  if (!role) invalid('A2A role ID is not in the Core role catalog.');
  return role;
}

export function validateA2ARoleId(value: unknown): A2ARoleId {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
    invalid('A2A role ID is invalid.');
  }
  if (!A2A_ROLE_IDS.includes(value as A2ARoleId)) {
    invalid('A2A role ID is not in the Core role catalog.');
  }
  return value as A2ARoleId;
}

export function getA2ARoleDefinition(roleId: unknown): A2ARoleDefinition {
  return roleById(validateA2ARoleId(roleId));
}

export const lookupA2ARole = getA2ARoleDefinition;

function normalizeRequestedCapabilities(
  role: A2ARoleDefinition,
  value: unknown,
  options: { defaultToRole: boolean },
): readonly A2ACapability[] {
  if (value === undefined) {
    if (options.defaultToRole) return freezeCapabilities(role.capabilities);
    invalid('A2A dispatch capabilities are required.');
  }
  if (!Array.isArray(value) || value.length > A2A_CAPABILITIES.length) {
    invalid('A2A dispatch capabilities must be a bounded array.');
  }

  const selected = new Set<A2ACapability>();
  for (const capability of value) {
    if (typeof capability !== 'string' || !CAPABILITY_ID.test(capability)) {
      invalid('A2A dispatch contains an unknown capability.');
    }
    if (!A2A_CAPABILITIES.includes(capability as A2ACapability)) {
      invalid('A2A dispatch contains an unknown capability.');
    }
    const normalized = capability as A2ACapability;
    if (!role.capabilities.includes(normalized)) {
      unsupported('A2A dispatch requests a capability outside the selected role allowlist.');
    }
    selected.add(normalized);
  }
  return freezeCapabilities([...selected]);
}

export function validateA2ARequestedCapabilities(
  roleId: unknown,
  requestedCapabilities?: unknown,
): readonly A2ACapability[] {
  const role = getA2ARoleDefinition(roleId);
  return normalizeRequestedCapabilities(role, requestedCapabilities, { defaultToRole: true });
}

function optionalOpaqueId(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) invalid(`${field} is invalid.`);
  return value;
}

function promptSha256(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_DISPATCH_PROMPT_LENGTH) {
    invalid('prompt is outside the allowed bounds.');
  }
  if (CONTROL_CHARACTERS.test(value)) {
    CONTROL_CHARACTERS.lastIndex = 0;
    invalid('prompt is outside the allowed bounds.');
  }
  CONTROL_CHARACTERS.lastIndex = 0;
  const safePrompt = redactAndBoundText(value, MAX_DISPATCH_PROMPT_LENGTH);
  return crypto.createHash('sha256').update(safePrompt, 'utf8').digest('hex');
}

function freezePlan(input: {
  roleId: A2ARoleId;
  mode: AgentJobMode;
  capabilities: readonly A2ACapability[];
  parentTaskId?: string;
  childKey?: string;
  promptSha256?: string;
}): A2ADispatchPlan {
  return Object.freeze({
    schemaVersion: A2A_ROLE_DISPATCH_SCHEMA_VERSION,
    roleId: input.roleId,
    mode: input.mode,
    capabilities: freezeCapabilities(input.capabilities),
    ...(input.parentTaskId === undefined ? {} : { parentTaskId: input.parentTaskId }),
    ...(input.childKey === undefined ? {} : { childKey: input.childKey }),
    ...(input.promptSha256 === undefined ? {} : { promptSha256: input.promptSha256 }),
  });
}

export function createA2ADispatchPlan(value: unknown): A2ADispatchPlan {
  const request = asRecord(value);
  assertAllowedKeys(request, ['roleId', 'requestedCapabilities', 'parentTaskId', 'childKey', 'prompt']);
  const role = getA2ARoleDefinition(request.roleId);
  const capabilities = normalizeRequestedCapabilities(role, request.requestedCapabilities, { defaultToRole: true });
  return freezePlan({
    roleId: role.id,
    mode: role.mode,
    capabilities,
    parentTaskId: optionalOpaqueId(request.parentTaskId, 'parentTaskId'),
    childKey: optionalOpaqueId(request.childKey, 'childKey'),
    promptSha256: promptSha256(request.prompt),
  });
}

export function validateA2ADispatchPlan(value: unknown): A2ADispatchPlan {
  const plan = asRecord(value);
  assertAllowedKeys(plan, [
    'schemaVersion',
    'roleId',
    'mode',
    'capabilities',
    'parentTaskId',
    'childKey',
    'promptSha256',
  ]);
  if (plan.schemaVersion !== A2A_ROLE_DISPATCH_SCHEMA_VERSION) {
    throw new A2AContractError('VersionNotSupportedError', 'A2A role dispatch schema version is not supported.');
  }
  const role = getA2ARoleDefinition(plan.roleId);
  const capabilities = normalizeRequestedCapabilities(role, plan.capabilities, { defaultToRole: false });
  if (plan.mode !== role.mode) invalid('A2A dispatch mode does not match the selected role.');
  const promptDigest = plan.promptSha256;
  if (promptDigest !== undefined && (typeof promptDigest !== 'string' || !SHA256.test(promptDigest))) {
    invalid('A2A dispatch prompt digest is invalid.');
  }
  return freezePlan({
    roleId: role.id,
    mode: role.mode,
    capabilities,
    parentTaskId: optionalOpaqueId(plan.parentTaskId, 'parentTaskId'),
    childKey: optionalOpaqueId(plan.childKey, 'childKey'),
    promptSha256: promptDigest as string | undefined,
  });
}

export function serializeA2ADispatchPlan(value: unknown): string {
  return JSON.stringify(validateA2ADispatchPlan(value));
}
