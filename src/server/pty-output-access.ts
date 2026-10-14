import type { AgentExecutionPolicy } from './agent-execution-policy.js';
import type { CoreOrchestrationService, ServerDerivedCoreScope } from './core-orchestration-service.js';
import { PtyReadSessionError, type PtyReadSessionRegistry } from './pty-read-session.js';
import { PtyOutputAccessError, type PtySessionIdentity } from '../shared/pty-read.js';

/** Internal read capability only; production composition does not mount or inject it. */
export function createPtyOutputReadAccess(options: Readonly<{
  jobs: Pick<CoreOrchestrationService, 'get'>;
  sessions: Pick<PtyReadSessionRegistry, 'describe' | 'read'>;
  policy: Pick<AgentExecutionPolicy, 'authorize'>;
}>) {
  const get = options.jobs.get.bind(options.jobs);
  const authorize = options.policy.authorize.bind(options.policy);
  const describe = options.sessions.describe.bind(options.sessions);
  const read = options.sessions.read.bind(options.sessions);
  const check = (scope: ServerDerivedCoreScope, jobId: string) => {
    let job;
    try { job = get(scope, { jobId }); } catch { throw new PtyOutputAccessError('access-denied'); }
    if (!job) throw new PtyOutputAccessError('session-unavailable');
    let decision;
    try { decision = authorize(scope, 'read-only'); } catch { throw new PtyOutputAccessError('access-denied'); }
    if (decision?.allowed !== true) throw new PtyOutputAccessError(decision?.reason === 'isolation-unavailable' ? 'session-unavailable' : 'access-denied');
  };
  const observe = <T>(read: () => T): T => {
    try { return read(); }
    catch (error) {
      throw new PtyOutputAccessError(error instanceof PtyReadSessionError
        ? error.code === 'PTY_CURSOR_INVALID' ? 'invalid-request' : 'session-unavailable'
        : 'read-failed');
    }
  };
  return Object.freeze({
    describe(scope: ServerDerivedCoreScope, jobId: string) {
      check(scope, jobId);
      return observe(() => describe(scope, jobId));
    },
    read(scope: ServerDerivedCoreScope, identity: PtySessionIdentity, after: number) {
      if (!identity || typeof identity !== 'object' || Array.isArray(identity)
        || Object.keys(identity).length !== 3
        || Object.keys(identity).some(key => !['jobId', 'sessionId', 'generation'].includes(key))
        || typeof identity.jobId !== 'string' || typeof identity.sessionId !== 'string'
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(identity.sessionId)
        || !Number.isSafeInteger(identity.generation) || identity.generation < 1
        || !Number.isSafeInteger(after) || after < 0) throw new PtyOutputAccessError('invalid-request');
      check(scope, identity.jobId);
      return observe(() => read(scope, identity, after));
    },
  });
}
