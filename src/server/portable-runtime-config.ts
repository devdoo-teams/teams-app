import path from 'node:path';
import { z } from 'zod';
import { isValidPublicHostname } from '../shared/public-hostname.js';
import { PullWorkerError } from './pull-worker.js';

export const portableWorkerBindingSchema = z.object({
  workerId: z.string().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/u),
  tenantId: z.string().uuid(), requesterId: z.string().uuid(), clientId: z.string().uuid(),
}).strict();
export type PortableWorkerBinding = Readonly<z.infer<typeof portableWorkerBindingSchema>>;
export type PortableHostConfig = Readonly<{
  stateDirectory: string; binding: PortableWorkerBinding;
  storePath(environmentKey: string, fileName: string): string;
}>;

/** Configuration only: no filesystem, login, network, timer or process starts. */
export function resolvePortableHostConfig(environment: Readonly<Record<string, string | undefined>>): PortableHostConfig | undefined {
  if (environment.TEAMS_AGENT_DISPATCH_MODE?.trim() !== 'pull-worker') return undefined;
  const env = { ...environment };
  try {
    const root = env.TEAMS_PULL_STATE_DIR?.trim();
    if (!root || !path.isAbsolute(root)) throw new Error();
    const stateDirectory = path.resolve(root);
    if (stateDirectory === path.parse(stateDirectory).root || stateDirectory === process.cwd()
      || (env.WEB_CONCURRENCY?.trim() && env.WEB_CONCURRENCY.trim() !== '1')
      || (env.NODE_APP_INSTANCE?.trim() && env.NODE_APP_INSTANCE.trim() !== '0')
      || (env.TEAMS_STORAGE_BACKEND?.trim() && env.TEAMS_STORAGE_BACKEND.trim() !== 'file')
      || (env.TEAMS_AGENT_CLI_PROVIDER?.trim() && env.TEAMS_AGENT_CLI_PROVIDER.trim() !== 'codex')) throw new Error();
    const binding = Object.freeze(portableWorkerBindingSchema.parse(JSON.parse(env.TEAMS_PULL_WORKER_BINDING ?? '')));
    return Object.freeze({ stateDirectory, binding,
      storePath(environmentKey: string, fileName: string): string {
        if (fileName !== path.basename(fileName) || fileName === '.' || fileName === '..') throw new PullWorkerError('invalid');
        const explicit = env[environmentKey]?.trim();
        if (explicit && !path.isAbsolute(explicit)) throw new PullWorkerError('invalid');
        const value = explicit ? path.resolve(explicit) : path.join(stateDirectory, fileName);
        if (!value.startsWith(stateDirectory + path.sep)) throw new PullWorkerError('invalid', 'portable storage must stay in its explicit state directory');
        return value;
      },
    });
  } catch { throw new PullWorkerError('invalid', 'portable host requires an explicit state directory and verified worker binding'); }
}


export type PortableMacConfig = Readonly<{
  baseUrl: string; resource: string; binding: PortableWorkerBinding;
}>;
export function resolvePortableMacConfig(environment: Readonly<Record<string, string | undefined>>): PortableMacConfig | undefined {
  if (environment.TEAMS_PULL_MAC_ENABLED !== 'true') return undefined;
  try {
    if ((environment.TEAMS_AGENT_DISPATCH_MODE?.trim() || 'local') !== 'local'
      || (environment.TEAMS_AGENT_CLI_PROVIDER?.trim() || 'codex') !== 'codex'
      || environment.TEAMS_PULL_CREDENTIAL_PROVIDER !== 'azure-cli') throw new Error();
    const origin = new URL(environment.TEAMS_PULL_SERVER_ORIGIN ?? '');
    const resource = environment.TEAMS_PULL_RESOURCE_URI?.trim() ?? '';
    const uri = new URL(resource);
    if (origin.protocol !== 'https:' || !isValidPublicHostname(origin.hostname) || origin.hostname.endsWith('.devtunnels.ms')
      || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/'
      || uri.protocol !== 'api:' || uri.hostname !== origin.hostname || uri.port || uri.username || uri.password || uri.search || uri.hash
      || !/^\/botid-[0-9a-f-]{36}$/iu.test(uri.pathname)) throw new Error();
    const binding = Object.freeze(portableWorkerBindingSchema.parse(JSON.parse(environment.TEAMS_PULL_WORKER_BINDING ?? '')));
    return Object.freeze({ baseUrl: origin.origin, resource, binding });
  } catch { throw new PullWorkerError('invalid', 'Mac pull requires a matching HTTPS API, existing delegated provider and explicit worker binding'); }
}
