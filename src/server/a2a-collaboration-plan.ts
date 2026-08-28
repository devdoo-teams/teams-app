import { createHash } from 'node:crypto';

import {
  A2A_CAPABILITIES,
  A2A_ROLE_CATALOG,
  A2A_ROLE_IDS,
  type A2ACapability,
  type A2ARoleDefinition,
  type A2ARoleId,
} from './a2a-role-catalog.js';
import { MAX_AGENT_PROMPT_LENGTH } from './agent-job-store.js';
import { redactSensitiveText } from './sensitive-text.js';

/** Keep collaboration children within the existing Core agent-job prompt contract. */
export const MAX_NORMALIZED_PROMPT_LENGTH = MAX_AGENT_PROMPT_LENGTH;
export const MAX_CHILD_PROMPT_LENGTH = MAX_AGENT_PROMPT_LENGTH;
export const MAX_TRUSTED_WORKERS = 16;
export const A2A_COLLABORATION_PLAN_SCHEMA_VERSION = 'a2a-core-collaboration-plan.v1' as const;

const MAX_RAW_PROMPT_LENGTH = MAX_NORMALIZED_PROMPT_LENGTH * 2;
const MAX_ID_LENGTH = 200;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const CORE_ROLE_IDS = new Set<string>(A2A_ROLE_IDS);
const CORE_CAPABILITIES = new Set<string>(A2A_CAPABILITIES);

// The default is deliberately expressed in terms of the finite Core catalog.
// It is not a second collaboration-only role vocabulary.
export const DEFAULT_A2A_COLLABORATION_ROLES: readonly A2ARoleId[] = Object.freeze([
  'release-auditor',
  'reviewer',
]);

export type A2ACollaborationRole = A2ARoleId;
export type A2AWorkerCapability = A2ACapability;

/** A server-trusted provider execution profile and its declared Core contract. */
export interface A2ACollaborationWorker {
  readonly agentId: string;
  readonly providerId: string;
  readonly executionIdentity: string;
  readonly executionBoundaryId: string;
  readonly roles: readonly string[];
  readonly capabilities: readonly string[];
}

export type A2AWorker = A2ACollaborationWorker;

export type TeamsA2AChatRoleSelection = Readonly<{
  requestedRoles: readonly A2ARoleId[];
  parallelism: number;
}>;

/**
 * Select the Teams chat collaboration shape from the server-owned roster.
 *
 * A single worker must retain the existing reviewer-only behavior. The
 * two-role plan is enabled only when two workers can actually be assigned
 * independently; the collaboration planner remains the final assignment and
 * authorization boundary.
 */
export function selectTeamsA2AChatRoles(
  workers: readonly A2ACollaborationWorker[],
): TeamsA2AChatRoleSelection {
  const reviewerWorkers = workers.filter((worker) => worker.roles.includes('reviewer'));
  const releaseAuditorWorkers = workers.filter((worker) => worker.roles.includes('release-auditor'));
  const hasIndependentPair = releaseAuditorWorkers.some((releaseAuditor) => (
    reviewerWorkers.some((reviewer) => (
      releaseAuditor.agentId !== reviewer.agentId
      && releaseAuditor.executionIdentity !== reviewer.executionIdentity
      && releaseAuditor.executionBoundaryId !== reviewer.executionBoundaryId
    ))
  ));

  if (hasIndependentPair) {
    return { requestedRoles: ['release-auditor', 'reviewer'], parallelism: 2 };
  }
  return { requestedRoles: ['reviewer'], parallelism: 1 };
}

export interface A2ACollaborationPlanInput {
  readonly prompt: string;
  readonly requestedRoles?: readonly string[];
  readonly workers: readonly A2ACollaborationWorker[];
}

export interface A2AChildPlanRequest {
  readonly key: string;
  readonly childIdempotencyKey: string;
  readonly role: A2ACollaborationRole;
  readonly capabilities: readonly A2AWorkerCapability[];
  readonly prompt: string;
  readonly agentId: string;
  readonly providerId: string;
  readonly executionIdentity: string;
  readonly executionBoundaryId: string;
}

export type A2ACollaborationPlanStrategy = 'single' | 'parallel-specialists' | 'blocked';

export interface A2ACollaborationPlanResult {
  readonly strategy: A2ACollaborationPlanStrategy;
  readonly requests: readonly A2AChildPlanRequest[];
  readonly blockedReason?: string;
  readonly planFingerprint: string;
}

export type A2ACollaborationChildStatus =
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'working'
  | 'pending'
  | 'input-required'
  | 'auth-required'
  | 'rejected';

export interface A2ACollaborationChildResult {
  readonly key: string;
  readonly role: string;
  readonly agentId: string;
  readonly providerId: string;
  readonly executionIdentity?: string;
  readonly executionBoundaryId?: string;
  readonly status: A2ACollaborationChildStatus;
  readonly result?: string;
  readonly error?: string;
}

export interface A2ACollaborationSummary {
  readonly status: 'complete' | 'partial' | 'failed' | 'canceled' | 'working' | 'pending';
  readonly completed: number;
  readonly failed: number;
  readonly canceled: number;
  readonly working: number;
  readonly pending: number;
  readonly text: string;
}

type NormalizedWorker = {
  readonly agentId: string;
  readonly providerId: string;
  readonly executionIdentity: string;
  readonly executionBoundaryId: string;
  readonly roles: readonly string[];
  readonly capabilities: readonly string[];
};

type NormalizedList = {
  readonly values: readonly string[];
  readonly reason?: string;
};

type NormalizedPrompt = {
  readonly value: string;
  readonly fingerprintValue: string;
  readonly reason?: string;
};

const ROLE_DEFINITIONS = new Map<string, A2ARoleDefinition>(
  A2A_ROLE_CATALOG.map((role) => [role.id, role]),
);

export function capabilitiesForA2ACollaborationRole(
  role: string,
): readonly A2AWorkerCapability[] | undefined {
  return ROLE_DEFINITIONS.get(role)?.capabilities;
}

/**
 * Build a deterministic, integration-neutral child plan.
 *
 * Invalid input is represented as a blocked result rather than an exception so
 * a caller cannot accidentally fall back to reusing one worker as independent
 * workers.
 */
export function createA2ACollaborationPlan(
  input: A2ACollaborationPlanInput,
): A2ACollaborationPlanResult {
  const prompt = normalizePrompt((input as { prompt?: unknown } | null | undefined)?.prompt);
  const requestedRoles = normalizeRequestedRoles(
    (input as { requestedRoles?: unknown } | null | undefined)?.requestedRoles,
  );
  const workers = normalizeWorkers(
    (input as { workers?: unknown } | null | undefined)?.workers,
  );
  const effectiveRoles = requestedRoles.values.length > 0
    ? [...requestedRoles.values]
    : [...DEFAULT_A2A_COLLABORATION_ROLES];

  const planFingerprint = fingerprint({
    schemaVersion: A2A_COLLABORATION_PLAN_SCHEMA_VERSION,
    prompt: prompt.fingerprintValue,
    requestedRoles: effectiveRoles,
    workers: canonicalWorkers(workers.values),
  });

  const firstReason = prompt.reason ?? requestedRoles.reason ?? workers.reason;
  if (firstReason) return blocked(planFingerprint, firstReason);

  const duplicateRole = findDuplicate(effectiveRoles);
  if (duplicateRole) {
    return blocked(planFingerprint, `Blocked: duplicate requested role "${duplicateRole}" is not allowed.`);
  }

  const unknownRole = effectiveRoles.find((role) => !CORE_ROLE_IDS.has(role));
  if (unknownRole) {
    return blocked(planFingerprint, `Blocked: requested role "${unknownRole}" is not in the Core role catalog.`);
  }

  const workerReason = validateWorkers(workers.values);
  if (workerReason) return blocked(planFingerprint, workerReason);

  if (effectiveRoles.length > workers.values.length) {
    return blocked(
      planFingerprint,
      `Blocked: requested roles [${effectiveRoles.join(', ')}] need ${effectiveRoles.length} distinct trusted workers; worker reuse is not treated as independence.`,
    );
  }

  const assignment = assignWorkersToRoles(
    effectiveRoles as readonly A2ARoleId[],
    workers.values,
  );
  if (!assignment) {
    return blocked(
      planFingerprint,
      `Blocked: requested roles [${effectiveRoles.join(', ')}] have no one-to-one trusted worker assignment.`,
    );
  }

  const requests = effectiveRoles.map((role) => {
    const roleId = role as A2ARoleId;
    const definition = ROLE_DEFINITIONS.get(roleId)!;
    const worker = assignment.get(roleId)!;
    const childDigest = sha256(canonicalize({
      planFingerprint,
      role: roleId,
      worker: {
        agentId: worker.agentId,
        providerId: worker.providerId,
        executionIdentity: worker.executionIdentity,
        executionBoundaryId: worker.executionBoundaryId,
      },
    })).slice(0, 16);
    const key = `child-${roleId}-${childDigest}`;
    return Object.freeze({
      key,
      childIdempotencyKey: `a2a-child:${planFingerprint}:${key}`,
      role: roleId,
      capabilities: Object.freeze([...definition.capabilities]),
      prompt: buildChildPrompt(prompt.value, definition),
      agentId: worker.agentId,
      providerId: worker.providerId,
      executionIdentity: worker.executionIdentity,
      executionBoundaryId: worker.executionBoundaryId,
    });
  });

  return Object.freeze({
    strategy: requests.length > 1 ? 'parallel-specialists' : 'single',
    requests: Object.freeze(requests),
    planFingerprint,
  });
}

/** Merge child outcomes in key order without mutating or exposing credentials. */
export function summarizeA2ACollaborationResults(
  results: readonly A2ACollaborationChildResult[],
): A2ACollaborationSummary {
  const completed = results.filter((result) => result.status === 'completed').length;
  const failed = results.filter((result) => result.status === 'failed' || result.status === 'rejected').length;
  const canceled = results.filter((result) => result.status === 'canceled').length;
  const working = results.filter((result) => result.status === 'working').length;
  const pending = results.filter((result) => (
    result.status === 'pending'
      || result.status === 'input-required'
      || result.status === 'auth-required'
  )).length;
  const status: A2ACollaborationSummary['status'] = results.length > 0 && completed === results.length
    ? 'complete'
    : canceled === results.length && results.length > 0
      ? 'canceled'
      : working > 0
        ? 'working'
        : pending > 0
          ? 'pending'
          : completed > 0
            ? 'partial'
            : 'failed';

  const lines = [
    `deterministic-merge: ${status} · completed=${completed} · failed=${failed} · canceled=${canceled} · working=${working} · pending=${pending}`,
    ...[...results]
      .sort(compareResults)
      .map((result) => {
        const detail = redactAndBound(result.result ?? result.error ?? '결과가 기록되지 않았습니다.', 900);
        const execution = result.executionIdentity ? `/${redactAndBound(result.executionIdentity, 200)}` : '';
        const boundary = result.executionBoundaryId ? `@${redactAndBound(result.executionBoundaryId, 200)}` : '';
        return `[${redactAndBound(result.role, 200)}] ${redactAndBound(result.agentId, 200)}/${redactAndBound(result.providerId, 200)}${execution}${boundary} · ${result.status}\n${detail}`;
      }),
  ];

  return Object.freeze({
    status,
    completed,
    failed,
    canceled,
    working,
    pending,
    text: redactAndBound(lines.join('\n\n'), 6_000),
  });
}

function normalizePrompt(value: unknown): NormalizedPrompt {
  if (typeof value !== 'string') {
    return {
      value: '',
      fingerprintValue: '',
      reason: 'Blocked: the collaboration prompt must be a string.',
    };
  }
  if (value.length > MAX_RAW_PROMPT_LENGTH) {
    return {
      value: '',
      fingerprintValue: `${redactSensitiveText(value.slice(0, MAX_NORMALIZED_PROMPT_LENGTH))}#${value.length}`,
      reason: `Blocked: the collaboration prompt exceeds ${MAX_NORMALIZED_PROMPT_LENGTH} characters.`,
    };
  }
  if (CONTROL_CHARACTERS.test(value)) {
    return {
      value: '',
      fingerprintValue: redactSensitiveText(value.slice(0, MAX_NORMALIZED_PROMPT_LENGTH)),
      reason: 'Blocked: the collaboration prompt contains unsupported control characters.',
    };
  }

  const normalized = redactSensitiveText(value.trim().replace(/\s+/gu, ' '));
  if (!normalized) {
    return {
      value: '',
      fingerprintValue: '',
      reason: 'Blocked: the collaboration prompt is empty after normalization.',
    };
  }
  if (normalized.length > MAX_NORMALIZED_PROMPT_LENGTH) {
    return {
      value: '',
      fingerprintValue: `${normalized.slice(0, MAX_NORMALIZED_PROMPT_LENGTH)}#${normalized.length}`,
      reason: `Blocked: the collaboration prompt exceeds ${MAX_NORMALIZED_PROMPT_LENGTH} characters.`,
    };
  }
  return {
    value: normalized,
    fingerprintValue: normalized,
  };
}

function normalizeRequestedRoles(value: unknown): NormalizedList {
  if (value === undefined) return { values: [] };
  if (!Array.isArray(value)) {
    return { values: [], reason: 'Blocked: requested roles must be an array.' };
  }
  if (value.length > A2A_ROLE_IDS.length) {
    return { values: [], reason: 'Blocked: requested roles exceed the finite Core role bound.' };
  }
  const values: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) {
      return { values: [], reason: 'Blocked: every requested role must be a non-empty string.' };
    }
    values.push(entry.trim());
  }
  values.sort(compareRoleIds);
  return { values };
}

function normalizeWorkers(value: unknown): { values: readonly NormalizedWorker[]; reason?: string } {
  if (!Array.isArray(value)) {
    return { values: [], reason: 'Blocked: the trusted worker roster must be an array.' };
  }
  if (value.length === 0) return { values: [], reason: 'Blocked: the trusted worker roster is empty.' };
  if (value.length > MAX_TRUSTED_WORKERS) {
    return { values: [], reason: `Blocked: the trusted worker roster exceeds ${MAX_TRUSTED_WORKERS} workers.` };
  }

  const workers: NormalizedWorker[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { values: workers, reason: 'Blocked: every trusted worker must be an object.' };
    }
    const candidate = entry as Record<string, unknown>;
    const roles = normalizeStringList(candidate.roles, 'worker roles', A2A_ROLE_IDS.length);
    if (roles.reason) return { values: workers, reason: roles.reason };
    const capabilities = normalizeStringList(candidate.capabilities, 'worker capabilities', A2A_CAPABILITIES.length);
    if (capabilities.reason) return { values: workers, reason: capabilities.reason };
    workers.push({
      agentId: normalizeString(candidate.agentId),
      providerId: normalizeString(candidate.providerId),
      executionIdentity: normalizeString(candidate.executionIdentity),
      executionBoundaryId: normalizeString(candidate.executionBoundaryId),
      roles: roles.values,
      capabilities: capabilities.values,
    });
  }
  return { values: workers };
}

function normalizeStringList(value: unknown, field: string, maxLength: number): NormalizedList {
  if (!Array.isArray(value)) return { values: [], reason: `Blocked: ${field} must be an array.` };
  if (value.length > maxLength) return { values: [], reason: `Blocked: ${field} exceed the Core catalog bound.` };
  const values: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) {
      return { values: [], reason: `Blocked: every ${field} entry must be a non-empty string.` };
    }
    values.push(entry.trim());
  }
  return { values };
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validateWorkers(workers: readonly NormalizedWorker[]): string | undefined {
  if (workers.length === 0) return 'Blocked: the trusted worker roster is empty.';

  const agentIds = new Set<string>();
  const executionIdentities = new Set<string>();
  const executionBoundaries = new Set<string>();

  for (const worker of workers) {
    if (!isOpaqueId(worker.agentId)) return 'Blocked: every trusted worker needs a bounded agentId.';
    if (!isOpaqueId(worker.providerId)) return `Blocked: worker "${worker.agentId}" has an invalid providerId.`;
    if (!isOpaqueId(worker.executionIdentity)) {
      return `Blocked: worker "${worker.agentId}" needs a bounded executionIdentity.`;
    }
    if (!isOpaqueId(worker.executionBoundaryId)) {
      return `Blocked: worker "${worker.agentId}" needs a bounded executionBoundaryId.`;
    }
    if (agentIds.has(worker.agentId)) return `Blocked: duplicate worker agentId "${worker.agentId}" is not allowed.`;
    if (executionIdentities.has(worker.executionIdentity)) {
      return `Blocked: executionIdentity "${worker.executionIdentity}" is shared; independent execution requires distinct identities.`;
    }
    if (executionBoundaries.has(worker.executionBoundaryId)) {
      return `Blocked: executionBoundaryId "${worker.executionBoundaryId}" is shared; independent execution requires distinct boundaries.`;
    }
    agentIds.add(worker.agentId);
    executionIdentities.add(worker.executionIdentity);
    executionBoundaries.add(worker.executionBoundaryId);

    if (worker.roles.length === 0) return `Blocked: worker "${worker.agentId}" must declare at least one Core role.`;
    if (worker.capabilities.length === 0) return `Blocked: worker "${worker.agentId}" must declare Core capabilities.`;

    const declaredCapabilities = new Set(worker.capabilities);
    const allowedByDeclaredRoles = new Set<string>();
    for (const role of worker.roles) {
      if (!CORE_ROLE_IDS.has(role)) return `Blocked: worker "${worker.agentId}" has unknown Core role "${role}".`;
      const definition = ROLE_DEFINITIONS.get(role)!;
      for (const capability of definition.capabilities) allowedByDeclaredRoles.add(capability);
      const missing = definition.capabilities.find((capability) => !declaredCapabilities.has(capability));
      if (missing) {
        return `Blocked: worker "${worker.agentId}" does not declare capability "${missing}" required by role "${role}".`;
      }
    }
    for (const capability of worker.capabilities) {
      if (!CORE_CAPABILITIES.has(capability)) {
        return `Blocked: worker "${worker.agentId}" has unknown Core capability "${capability}".`;
      }
      if (!allowedByDeclaredRoles.has(capability)) {
        return `Blocked: worker "${worker.agentId}" declares capability "${capability}" outside its role allowlist.`;
      }
    }
  }
  return undefined;
}

function assignWorkersToRoles(
  roles: readonly A2ARoleId[],
  workers: readonly NormalizedWorker[],
): Map<A2ARoleId, NormalizedWorker> | undefined {
  const sortedWorkers = [...workers].sort(compareWorkers);
  const candidates = roles.map((role, index) => ({
    role,
    index,
    workers: sortedWorkers.filter((worker) => isEligible(worker, role)),
  }));
  if (candidates.some((candidate) => candidate.workers.length === 0)) return undefined;

  // Assign constrained roles first while retaining deterministic role output.
  const searchOrder = [...candidates].sort((left, right) => (
    left.workers.length - right.workers.length
      || compareRoleIds(left.role, right.role)
      || left.index - right.index
  ));
  const assignedIdentities = new Set<string>();
  const assignment = new Map<A2ARoleId, NormalizedWorker>();

  const visit = (position: number): boolean => {
    if (position === searchOrder.length) return true;
    const candidate = searchOrder[position]!;
    for (const worker of candidate.workers) {
      if (assignedIdentities.has(worker.executionIdentity)) continue;
      assignedIdentities.add(worker.executionIdentity);
      assignment.set(candidate.role, worker);
      if (visit(position + 1)) return true;
      assignment.delete(candidate.role);
      assignedIdentities.delete(worker.executionIdentity);
    }
    return false;
  };

  return visit(0) ? assignment : undefined;
}

function isEligible(worker: NormalizedWorker, role: A2ARoleId): boolean {
  const definition = ROLE_DEFINITIONS.get(role)!;
  return worker.roles.includes(role)
    && definition.capabilities.every((capability) => worker.capabilities.includes(capability));
}

function buildChildPrompt(prompt: string, definition: A2ARoleDefinition): string {
  const value = [
    `Role: ${definition.id}`,
    `Task: ${prompt}`,
    `Mode: ${definition.mode}`,
    `Required capabilities: ${definition.capabilities.join(', ')}`,
    `Role guidance: ${definition.description}`,
    'Boundary: stay within this role, report blocked work explicitly, and do not claim unperformed execution.',
  ].join('\n');
  return value.slice(0, MAX_CHILD_PROMPT_LENGTH);
}

function canonicalWorkers(workers: readonly NormalizedWorker[]): readonly NormalizedWorker[] {
  return [...workers]
    .sort(compareWorkers)
    .map((worker) => ({
      ...worker,
      roles: [...worker.roles].sort(compareStrings),
      capabilities: [...worker.capabilities].sort(compareStrings),
    }));
}

function compareWorkers(left: NormalizedWorker, right: NormalizedWorker): number {
  return compareStrings(left.agentId, right.agentId)
    || compareStrings(left.providerId, right.providerId)
    || compareStrings(left.executionIdentity, right.executionIdentity)
    || compareStrings(left.executionBoundaryId, right.executionBoundaryId);
}

function compareResults(left: A2ACollaborationChildResult, right: A2ACollaborationChildResult): number {
  return compareStrings(left.key, right.key)
    || compareStrings(left.role, right.role)
    || compareStrings(left.agentId, right.agentId);
}

function compareRoleIds(left: string, right: string): number {
  const leftIndex = A2A_ROLE_IDS.indexOf(left as A2ARoleId);
  const rightIndex = A2A_ROLE_IDS.indexOf(right as A2ARoleId);
  if (leftIndex >= 0 && rightIndex >= 0 && leftIndex !== rightIndex) return leftIndex - rightIndex;
  if (leftIndex >= 0) return -1;
  if (rightIndex >= 0) return 1;
  return compareStrings(left, right);
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function findDuplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

function isOpaqueId(value: string): boolean {
  return value.length <= MAX_ID_LENGTH && OPAQUE_ID.test(value);
}

function blocked(planFingerprint: string, blockedReason: string): A2ACollaborationPlanResult {
  return Object.freeze({
    strategy: 'blocked',
    requests: Object.freeze([]),
    blockedReason,
    planFingerprint,
  });
}

function redactAndBound(value: string, maxLength: number): string {
  return redactSensitiveText(String(value)).slice(0, maxLength);
}

function fingerprint(value: unknown): string {
  return sha256(canonicalize(value));
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(String(value));
}
