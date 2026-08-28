import crypto from 'node:crypto';

import { A2AContractError, redactAndBoundText } from './a2a-contract.js';
import { A2A_ROLE_IDS } from './a2a-role-catalog.js';
import { redactSensitiveText } from './sensitive-text.js';

/**
 * Internal evidence only. This shape is not an A2A protocol response and is
 * intentionally kept out of the agent card and task wire models.
 */
export const A2A_DISPATCH_AUDIT_SCHEMA_VERSION = 'a2a-core-dispatch-audit.v2' as const;
export const MAX_A2A_AUDIT_ENTRIES = 16;

const MAX_A2A_AUDIT_TOTAL_CHILDREN = 1_024;
const MAX_A2A_AUDIT_ROLE_BUCKETS = 16;
const MAX_A2A_AUDIT_ID_LENGTH = 200;
const MAX_A2A_AUDIT_ROLE_HASH_LENGTH = 16;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SAFE_ROLE_HASH = /^role-[a-f0-9]{16}$/;
const OTHER_ROLE = '__other__' as const;
const STATUS_ORDER = ['completed', 'failed', 'canceled'] as const;

export type A2ADispatchAuditStatus = typeof STATUS_ORDER[number];

export type A2ADispatchAuditChildInput = Readonly<{
  childKey: string;
  childIdempotencyKey: string;
  agentId: string;
  providerId: string;
  role: string;
  requestSha256: string;
  status: A2ADispatchAuditStatus;
  duplicated: boolean;
}>;

export type A2ADispatchAuditEntry = Readonly<{
  childKey: string;
  childIdempotencyKey: string;
  agentId: string;
  providerId: string;
  role: string;
  requestSha256: string;
  status: A2ADispatchAuditStatus;
  duplicated: boolean;
}>;

export type A2ADispatchAudit = Readonly<{
  schemaVersion: typeof A2A_DISPATCH_AUDIT_SCHEMA_VERSION;
  parentTaskId: string;
  totalChildren: number;
  uniqueChildren: number;
  duplicateChildren: number;
  omittedChildren: number;
  roleCounts: readonly Readonly<{ role: string; count: number }>[];
  statusCounts: readonly Readonly<{ status: A2ADispatchAuditStatus; count: number }>[];
  entries: readonly A2ADispatchAuditEntry[];
}>;

export type A2ADispatchAuditInput = Readonly<{
  parentTaskId: string;
  children: readonly A2ADispatchAuditChildInput[];
}>;

export function createA2ADispatchAudit(input: A2ADispatchAuditInput): A2ADispatchAudit {
  const parentTaskId = validateOpaqueId(input.parentTaskId, 'parentTaskId');
  if (!Array.isArray(input.children) || input.children.length > MAX_A2A_AUDIT_TOTAL_CHILDREN) {
    throw new A2AContractError('GraphLimitExceededError', 'A2A dispatch audit exceeds the maximum child count.');
  }

  const normalizedChildren = input.children.map(normalizeChild);
  const roleTotals = new Map<string, number>();
  for (const child of normalizedChildren) {
    roleTotals.set(child.role, (roleTotals.get(child.role) ?? 0) + 1);
  }

  const roleCounts = [...roleTotals.entries()]
    .sort(([left], [right]) => compareRoleLabels(left, right))
    .map(([role, count]) => ({ role, count }));
  const boundedRoleCounts = roleCounts.length > MAX_A2A_AUDIT_ROLE_BUCKETS
    ? [
      ...roleCounts.slice(0, MAX_A2A_AUDIT_ROLE_BUCKETS - 1),
      { role: OTHER_ROLE, count: roleCounts.slice(MAX_A2A_AUDIT_ROLE_BUCKETS - 1).reduce((sum, entry) => sum + entry.count, 0) },
    ]
    : roleCounts;

  const audit = {
    schemaVersion: A2A_DISPATCH_AUDIT_SCHEMA_VERSION,
    parentTaskId,
    totalChildren: normalizedChildren.length,
    uniqueChildren: normalizedChildren.filter((child) => !child.duplicated).length,
    duplicateChildren: normalizedChildren.filter((child) => child.duplicated).length,
    omittedChildren: Math.max(0, normalizedChildren.length - MAX_A2A_AUDIT_ENTRIES),
    roleCounts: boundedRoleCounts,
    statusCounts: STATUS_ORDER.map((status) => ({
      status,
      count: normalizedChildren.filter((child) => child.status === status).length,
    })),
    entries: normalizedChildren.slice(0, MAX_A2A_AUDIT_ENTRIES),
  };
  return validateA2ADispatchAudit(audit);
}

export function validateA2ADispatchAudit(value: unknown): A2ADispatchAudit {
  const audit = asRecord(value);
  assertAllowedKeys(audit, [
    'schemaVersion',
    'parentTaskId',
    'totalChildren',
    'uniqueChildren',
    'duplicateChildren',
    'omittedChildren',
    'roleCounts',
    'statusCounts',
    'entries',
  ]);
  if (audit.schemaVersion !== A2A_DISPATCH_AUDIT_SCHEMA_VERSION) {
    throw new A2AContractError('VersionNotSupportedError', 'A2A dispatch audit schema version is not supported.');
  }

  const parentTaskId = validateOpaqueId(audit.parentTaskId, 'parentTaskId');
  const totalChildren = validateCount(audit.totalChildren, 'totalChildren');
  const uniqueChildren = validateCount(audit.uniqueChildren, 'uniqueChildren');
  const duplicateChildren = validateCount(audit.duplicateChildren, 'duplicateChildren');
  const omittedChildren = validateCount(audit.omittedChildren, 'omittedChildren');
  if (uniqueChildren + duplicateChildren !== totalChildren) {
    invalid('A2A dispatch audit child counts are inconsistent.');
  }
  if (omittedChildren > totalChildren || totalChildren - omittedChildren > MAX_A2A_AUDIT_ENTRIES) {
    invalid('A2A dispatch audit entries are outside the allowed bounds.');
  }

  const roleCounts = validateRoleCounts(audit.roleCounts, totalChildren);
  const statusCounts = validateStatusCounts(audit.statusCounts, totalChildren);
  const entries = validateEntries(audit.entries, totalChildren - omittedChildren);

  return Object.freeze({
    schemaVersion: A2A_DISPATCH_AUDIT_SCHEMA_VERSION,
    parentTaskId,
    totalChildren,
    uniqueChildren,
    duplicateChildren,
    omittedChildren,
    roleCounts: Object.freeze(roleCounts),
    statusCounts: Object.freeze(statusCounts),
    entries: Object.freeze(entries),
  });
}

export function serializeA2ADispatchAudit(value: unknown): string {
  return JSON.stringify(validateA2ADispatchAudit(value));
}

function normalizeChild(value: A2ADispatchAuditChildInput): A2ADispatchAuditEntry {
  const child = asRecord(value);
  assertAllowedKeys(child, [
    'childKey',
    'childIdempotencyKey',
    'agentId',
    'providerId',
    'role',
    'requestSha256',
    'status',
    'duplicated',
  ]);
  const rawRole = boundedText(child.role, 'role');
  const role = A2A_ROLE_IDS.includes(rawRole as typeof A2A_ROLE_IDS[number])
    ? rawRole
    : `role-${sha256(redactAndBoundText(redactSensitiveText(rawRole), MAX_A2A_AUDIT_ID_LENGTH)).slice(0, MAX_A2A_AUDIT_ROLE_HASH_LENGTH)}`;
  const status = child.status;
  if (!STATUS_ORDER.includes(status as A2ADispatchAuditStatus)) invalid('A2A dispatch audit status is invalid.');
  if (typeof child.duplicated !== 'boolean') invalid('A2A dispatch audit duplicated flag is invalid.');

  return Object.freeze({
    childKey: validateOpaqueId(child.childKey, 'childKey'),
    childIdempotencyKey: validateOpaqueId(child.childIdempotencyKey, 'childIdempotencyKey'),
    agentId: validateOpaqueId(child.agentId, 'agentId'),
    providerId: validateOpaqueId(child.providerId, 'providerId'),
    role,
    requestSha256: validateSha256(child.requestSha256, 'requestSha256'),
    status: status as A2ADispatchAuditStatus,
    duplicated: child.duplicated,
  });
}

function validateEntries(value: unknown, expectedLength: number): A2ADispatchAuditEntry[] {
  if (!Array.isArray(value) || value.length > MAX_A2A_AUDIT_ENTRIES || value.length !== expectedLength) {
    invalid('A2A dispatch audit entries are outside the allowed bounds.');
  }
  return value.map((entry) => normalizeValidatedEntry(entry));
}

function normalizeValidatedEntry(value: unknown): A2ADispatchAuditEntry {
  const entry = normalizeChild(value as A2ADispatchAuditChildInput);
  if (entry.role === OTHER_ROLE) invalid('A2A dispatch audit role bucket is reserved.');
  return entry;
}

function validateRoleCounts(value: unknown, totalChildren: number): Readonly<{ role: string; count: number }>[] {
  if (!Array.isArray(value) || value.length > MAX_A2A_AUDIT_ROLE_BUCKETS) {
    invalid('A2A dispatch audit role counters are outside the allowed bounds.');
  }
  const seenRoles = new Set<string>();
  const counts = value.map((entry) => {
    const item = asRecord(entry);
    assertAllowedKeys(item, ['role', 'count']);
    const role = boundedText(item.role, 'role counter');
    if (role !== OTHER_ROLE && !A2A_ROLE_IDS.includes(role as typeof A2A_ROLE_IDS[number]) && !SAFE_ROLE_HASH.test(role)) {
      invalid('A2A dispatch audit role counter is invalid.');
    }
    if (seenRoles.has(role)) invalid('A2A dispatch audit role counters contain a duplicate role.');
    seenRoles.add(role);
    return { role, count: validateCount(item.count, 'role counter count') };
  });
  if (counts.reduce((sum, entry) => sum + entry.count, 0) !== totalChildren) {
    invalid('A2A dispatch audit role counters are inconsistent.');
  }
  return counts.sort(({ role: left }, { role: right }) => compareRoleLabels(left, right));
}

function compareRoleLabels(left: string, right: string): number {
  if (left === OTHER_ROLE) return right === OTHER_ROLE ? 0 : 1;
  if (right === OTHER_ROLE) return -1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateStatusCounts(value: unknown, totalChildren: number): Readonly<{ status: A2ADispatchAuditStatus; count: number }>[] {
  if (!Array.isArray(value) || value.length !== STATUS_ORDER.length) {
    invalid('A2A dispatch audit status counters are invalid.');
  }
  const counts = value.map((entry, index) => {
    const item = asRecord(entry);
    assertAllowedKeys(item, ['status', 'count']);
    if (item.status !== STATUS_ORDER[index]) invalid('A2A dispatch audit status counters must use canonical order.');
    return { status: STATUS_ORDER[index], count: validateCount(item.count, 'status counter count') };
  });
  if (counts.reduce((sum, entry) => sum + entry.count, 0) !== totalChildren) {
    invalid('A2A dispatch audit status counters are inconsistent.');
  }
  return counts;
}

function validateCount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_A2A_AUDIT_TOTAL_CHILDREN) {
    invalid(`${field} is outside the allowed bounds.`);
  }
  return value as number;
}

function validateOpaqueId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > MAX_A2A_AUDIT_ID_LENGTH || !SAFE_ID.test(value)) {
    invalid(`${field} is invalid.`);
  }
  return value;
}

function validateSha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) invalid(`${field} is invalid.`);
  return value;
}

function boundedText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_A2A_AUDIT_ID_LENGTH) {
    invalid(`${field} is outside the allowed bounds.`);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('A2A dispatch audit value must be an object.');
  return value as Record<string, unknown>;
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid('A2A dispatch audit contains an unsupported field.');
}

function invalid(message: string): never {
  throw new A2AContractError('InvalidRequestError', message);
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}
