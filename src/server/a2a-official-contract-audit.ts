const OFFICIAL_A2A_V026_RPC_METHODS = ['message/send', 'tasks/get', 'tasks/cancel'] as const;

const OFFICIAL_A2A_V1_RPC_METHODS = ['SendMessage', 'GetTask', 'ListTasks', 'CancelTask'] as const;

export const A2A_LATEST_REQUIRED_CONTRACT = Object.freeze({
  source: 'https://a2a-protocol.org/latest/specification/',
  protocolVersion: '1.0',
  discoveryPath: '/.well-known/agent-card.json',
  transport: 'JSON-RPC 2.0 over HTTP(S)',
  jsonRpcVersion: '2.0',
  protocolBinding: 'JSONRPC',
  requiredRpcMethods: Object.freeze([...OFFICIAL_A2A_V1_RPC_METHODS]),
  versionHeader: 'A2A-Version: 1.0',
  authLayer: 'HTTP transport',
  taskStatusShape: 'Task.status.state=TASK_STATE_*',
  artifactShape: 'Artifact.parts with current Part one-of payload',
} as const);

export type A2ALatestTaskModel = Readonly<{
  statusShape: 'legacy-status' | 'task-state';
  artifactShape: 'legacy-kind-parts' | 'official-parts';
  sendResponseShape: 'task' | 'task-wrapper';
}>;

export type A2ALatestCompatibilityIssueCode =
  | 'agent-card.discovery-path'
  | 'agent-card.protocol-version'
  | 'agent-card.shape'
  | 'transport.json-rpc'
  | 'transport.version-header'
  | 'transport.auth-declaration'
  | 'tasks.status-shape'
  | 'tasks.artifact-shape'
  | 'tasks.send-response-shape';

export type A2ALatestCompatibilityIssue = Readonly<{
  code: A2ALatestCompatibilityIssueCode;
  expected: string;
  actual: string;
}>;

export type A2ALatestCompatibilityAuditInput = Readonly<{
  agentCard: unknown;
  discoveryPath: string;
  jsonRpcEndpointPath: string;
  supportedRpcMethods: readonly string[];
  requiresHttpAuth: boolean;
  supportsVersionHeader: boolean;
  taskModel: A2ALatestTaskModel;
}>;

export type A2ALatestCompatibilityAudit = Readonly<{
  compatible: boolean;
  externalInteropClaimAllowed: boolean;
  requiredContract: typeof A2A_LATEST_REQUIRED_CONTRACT;
  issues: readonly A2ALatestCompatibilityIssue[];
}>;

export function auditA2ALatestCompatibility(input: A2ALatestCompatibilityAuditInput): A2ALatestCompatibilityAudit {
  const card = isRecord(input.agentCard) ? input.agentCard : {};
  const issues: A2ALatestCompatibilityIssue[] = [];

  if (input.discoveryPath !== A2A_LATEST_REQUIRED_CONTRACT.discoveryPath) {
    issues.push({
      code: 'agent-card.discovery-path',
      expected: A2A_LATEST_REQUIRED_CONTRACT.discoveryPath,
      actual: input.discoveryPath || '(missing)',
    });
  }
  const interfaces = Array.isArray(card.supportedInterfaces) ? card.supportedInterfaces : [];
  const currentInterface = isRecord(interfaces[0]) ? interfaces[0] : {};
  if (currentInterface.protocolVersion !== A2A_LATEST_REQUIRED_CONTRACT.protocolVersion) {
    issues.push({
      code: 'agent-card.protocol-version',
      expected: A2A_LATEST_REQUIRED_CONTRACT.protocolVersion,
      actual: printable(currentInterface.protocolVersion),
    });
  }
  if (!hasLatestAgentCardShape(card)) {
    issues.push({
      code: 'agent-card.shape',
      expected: 'name, description, supportedInterfaces, capabilities, securitySchemes/securityRequirements, modes, skills',
      actual: Object.keys(card).sort().join(',') || '(non-object)',
    });
  }
  if (!isHttpsUrl(currentInterface.url) || currentInterface.protocolBinding !== A2A_LATEST_REQUIRED_CONTRACT.protocolBinding
    || !A2A_LATEST_REQUIRED_CONTRACT.requiredRpcMethods.every((method) => input.supportedRpcMethods.includes(method))) {
    issues.push({
      code: 'transport.json-rpc',
      expected: `HTTPS JSONRPC endpoint with ${A2A_LATEST_REQUIRED_CONTRACT.requiredRpcMethods.join(', ')}`,
      actual: `endpoint=${input.jsonRpcEndpointPath || '(missing)'} methods=${input.supportedRpcMethods.join(',') || '(none)'}`,
    });
  }
  if (!input.supportsVersionHeader) {
    issues.push({
      code: 'transport.version-header',
      expected: A2A_LATEST_REQUIRED_CONTRACT.versionHeader,
      actual: 'missing or not enforced',
    });
  }
  if (input.requiresHttpAuth && !hasLatestHttpAuth(card)) {
    issues.push({
      code: 'transport.auth-declaration',
      expected: 'securitySchemes plus securityRequirements for HTTP-layer credentials',
      actual: 'missing or empty security declarations',
    });
  }
  if (input.taskModel.statusShape !== 'task-state') {
    issues.push({
      code: 'tasks.status-shape',
      expected: A2A_LATEST_REQUIRED_CONTRACT.taskStatusShape,
      actual: input.taskModel.statusShape,
    });
  }
  if (input.taskModel.artifactShape !== 'official-parts') {
    issues.push({
      code: 'tasks.artifact-shape',
      expected: A2A_LATEST_REQUIRED_CONTRACT.artifactShape,
      actual: input.taskModel.artifactShape,
    });
  }
  if (input.taskModel.sendResponseShape !== 'task-wrapper') {
    issues.push({
      code: 'tasks.send-response-shape',
      expected: 'SendMessage result contains exactly one task or message field',
      actual: input.taskModel.sendResponseShape,
    });
  }

  const compatible = issues.length === 0;
  return Object.freeze({
    compatible,
    externalInteropClaimAllowed: compatible,
    requiredContract: A2A_LATEST_REQUIRED_CONTRACT,
    issues: Object.freeze(issues.map((issue) => Object.freeze({ ...issue }))),
  });
}

export const A2A_V026_REQUIRED_CONTRACT = Object.freeze({
  source: 'https://a2a-protocol.org/v0.2.6/specification/',
  protocolVersion: '0.2.6',
  discoveryPath: '/.well-known/agent.json',
  transport: 'JSON-RPC 2.0 over HTTP(S)',
  jsonRpcVersion: '2.0',
  preferredTransport: 'JSONRPC',
  requiredRpcMethods: Object.freeze([...OFFICIAL_A2A_V026_RPC_METHODS]),
  authLayer: 'HTTP transport',
  taskStatusShape: 'Task.status.state',
  artifactShape: 'Artifact.parts',
} as const);

export type A2AV026TaskModel = Readonly<{
  statusShape: 'flat-status' | 'status-object-state';
  artifactShape: 'artifact-ref' | 'artifact-parts';
}>;

export type A2AV026CompatibilityIssueCode =
  | 'agent-card.discovery-path'
  | 'agent-card.protocol-version'
  | 'agent-card.shape'
  | 'transport.json-rpc'
  | 'transport.auth-declaration'
  | 'tasks.status-shape'
  | 'tasks.artifact-shape';

export type A2AV026CompatibilityIssue = Readonly<{
  code: A2AV026CompatibilityIssueCode;
  expected: string;
  actual: string;
}>;

export type A2AV026CompatibilityAuditInput = Readonly<{
  agentCard: unknown;
  discoveryPath: string;
  jsonRpcEndpointPath: string;
  supportedRpcMethods: readonly string[];
  requiresHttpAuth: boolean;
  taskModel: A2AV026TaskModel;
}>;

export type A2AV026CompatibilityAudit = Readonly<{
  compatible: boolean;
  externalInteropClaimAllowed: boolean;
  requiredContract: typeof A2A_V026_REQUIRED_CONTRACT;
  issues: readonly A2AV026CompatibilityIssue[];
}>;

export function auditA2AV026Compatibility(input: A2AV026CompatibilityAuditInput): A2AV026CompatibilityAudit {
  const card = isRecord(input.agentCard) ? input.agentCard : {};
  const issues: A2AV026CompatibilityIssue[] = [];

  if (input.discoveryPath !== A2A_V026_REQUIRED_CONTRACT.discoveryPath) {
    issues.push({
      code: 'agent-card.discovery-path',
      expected: A2A_V026_REQUIRED_CONTRACT.discoveryPath,
      actual: input.discoveryPath || '(missing)',
    });
  }

  if (card.protocolVersion !== A2A_V026_REQUIRED_CONTRACT.protocolVersion) {
    issues.push({
      code: 'agent-card.protocol-version',
      expected: A2A_V026_REQUIRED_CONTRACT.protocolVersion,
      actual: printable(card.protocolVersion),
    });
  }

  if (!hasOfficialAgentCardShape(card)) {
    issues.push({
      code: 'agent-card.shape',
      expected: 'top-level url, preferredTransport=JSONRPC, capabilities.stateTransitionHistory, security/skills fields',
      actual: Object.keys(card).sort().join(',') || '(non-object)',
    });
  }

  if (!hasJsonRpcTransport(input, card)) {
    issues.push({
      code: 'transport.json-rpc',
      expected: 'one JSON-RPC HTTP(S) endpoint with message/send, tasks/get, and tasks/cancel methods',
      actual: `endpoint=${input.jsonRpcEndpointPath || '(missing)'} methods=${input.supportedRpcMethods.join(',') || '(none)'}`,
    });
  }

  if (input.requiresHttpAuth && !declaresHttpAuth(card)) {
    issues.push({
      code: 'transport.auth-declaration',
      expected: 'Agent Card securitySchemes plus security requirements for HTTP-layer credentials',
      actual: 'missing or empty securitySchemes/security',
    });
  }

  if (input.taskModel.statusShape !== 'status-object-state') {
    issues.push({
      code: 'tasks.status-shape',
      expected: A2A_V026_REQUIRED_CONTRACT.taskStatusShape,
      actual: input.taskModel.statusShape,
    });
  }

  if (input.taskModel.artifactShape !== 'artifact-parts') {
    issues.push({
      code: 'tasks.artifact-shape',
      expected: A2A_V026_REQUIRED_CONTRACT.artifactShape,
      actual: input.taskModel.artifactShape,
    });
  }

  const compatible = issues.length === 0;
  return Object.freeze({
    compatible,
    externalInteropClaimAllowed: compatible,
    requiredContract: A2A_V026_REQUIRED_CONTRACT,
    issues: Object.freeze(issues.map((issue) => Object.freeze({ ...issue }))),
  });
}

function hasOfficialAgentCardShape(card: Record<string, unknown>): boolean {
  return card.protocolVersion === A2A_V026_REQUIRED_CONTRACT.protocolVersion
    && isHttpsUrl(card.url)
    && card.preferredTransport === A2A_V026_REQUIRED_CONTRACT.preferredTransport
    && hasCapabilities(card.capabilities)
    && declaresHttpAuth(card)
    && hasSkills(card.skills);
}

function hasLatestAgentCardShape(card: Record<string, unknown>): boolean {
  const interfaces = card.supportedInterfaces;
  const first = Array.isArray(interfaces) && isRecord(interfaces[0]) ? interfaces[0] : undefined;
  return typeof card.name === 'string'
    && typeof card.description === 'string'
    && typeof card.version === 'string'
    && Boolean(first)
    && isHttpsUrl(first?.url)
    && first?.protocolBinding === A2A_LATEST_REQUIRED_CONTRACT.protocolBinding
    && first?.protocolVersion === A2A_LATEST_REQUIRED_CONTRACT.protocolVersion
    && hasLatestCapabilities(card.capabilities)
    && hasLatestHttpAuth(card)
    && Array.isArray(card.defaultInputModes)
    && Array.isArray(card.defaultOutputModes)
    && hasSkills(card.skills);
}

function hasLatestHttpAuth(card: Record<string, unknown>): boolean {
  return nonEmptyRecord(card.securitySchemes)
    && Array.isArray(card.securityRequirements)
    && card.securityRequirements.length > 0;
}

function hasLatestCapabilities(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (value.streaming === undefined || typeof value.streaming === 'boolean')
    && (value.pushNotifications === undefined || typeof value.pushNotifications === 'boolean')
    && (value.extendedAgentCard === undefined || typeof value.extendedAgentCard === 'boolean')
    && value.stateTransitionHistory === undefined;
}

function hasJsonRpcTransport(
  input: Pick<A2AV026CompatibilityAuditInput, 'jsonRpcEndpointPath' | 'supportedRpcMethods'>,
  card: Record<string, unknown>,
): boolean {
  if (!isHttpsUrl(card.url)) return false;
  if (!input.jsonRpcEndpointPath || input.jsonRpcEndpointPath.includes(':')) return false;
  return OFFICIAL_A2A_V026_RPC_METHODS.every((method) => input.supportedRpcMethods.includes(method));
}

function hasCapabilities(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.streaming === 'boolean'
    && typeof value.pushNotifications === 'boolean'
    && typeof value.stateTransitionHistory === 'boolean';
}

function declaresHttpAuth(card: Record<string, unknown>): boolean {
  return nonEmptyRecord(card.securitySchemes) && Array.isArray(card.security) && card.security.length > 0;
}

function hasSkills(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((skill) => {
    if (!isRecord(skill)) return false;
    return typeof skill.id === 'string'
      && typeof skill.name === 'string'
      && typeof skill.description === 'string'
      && Array.isArray(skill.tags);
  });
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function nonEmptyRecord(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function printable(value: unknown): string {
  if (typeof value === 'string' && value) return value;
  if (value === undefined) return '(missing)';
  return typeof value;
}
