import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { request } from 'node:http';
import { isIP } from 'node:net';
import path from 'node:path';

import { isValidPublicHostname } from '../src/shared/public-hostname.js';

const providers = {
  none: { stableHostname: 'not-applicable', webSocket: 'unverified', sse: 'unverified' },
  devtunnel: { stableHostname: 'configured', webSocket: 'unverified', sse: 'unverified' },
  'cloudflare-quick': { stableHostname: 'no', webSocket: 'documented', sse: 'unsupported' },
  'cloudflare-named': { stableHostname: 'configured', webSocket: 'documented', sse: 'unverified' },
  ngrok: { stableHostname: 'assigned-domain', webSocket: 'documented', sse: 'unverified' },
};

function object(value, fields) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Configuration must contain JSON objects.');
  }
  if (Object.keys(value).some((key) => !fields.includes(key))) {
    throw new Error('Unsupported configuration fields; use the documented schema without inline credentials.');
  }
}

function localAddress(value) {
  const match = typeof value === 'string' && /^http:\/\/(127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})\/?$/.exec(value);
  if (!match || Number(match[2]) > 65535) {
    throw new Error('server.localUrl must be an HTTP literal loopback origin with an explicit port from 1 to 65535.');
  }
  return { localUrl: `http://${match[1]}:${match[2]}`, host: match[1], port: Number(match[2]) };
}

function publicAddress(value) {
  if (typeof value !== 'string' || !/^https:\/\/[a-z0-9.-]+\/?$/.test(value)) {
    throw new Error('tunnel.publicOrigin must be a lowercase public HTTPS origin without credentials, path, port, query or fragment.');
  }
  const url = new URL(value);
  if (!isValidPublicHostname(url.hostname) || isIP(url.hostname) || /\.(?:local|localhost|internal)$/.test(url.hostname)) {
    throw new Error('tunnel.publicOrigin must use a public DNS hostname.');
  }
  return url.origin;
}

function reference(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error('tunnel.reference must be a tunnel ID or name, without flags or shell syntax.');
  }
  return value;
}

function configurationFile(value) {
  if (typeof value !== 'string' || !/^(?:\/|\.\/)[A-Za-z0-9._ /-]+\.ya?ml$/.test(value)
    || value.split('/').includes('..')) {
    throw new Error('tunnel.configFile must be an explicit YAML file path, without flags, traversal or shell syntax.');
  }
  return value;
}

export function parseExposureConfig(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536) {
    throw new Error('Configuration must be JSON of at most 64 KiB.');
  }
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('Configuration is not valid JSON.'); }
  object(value, ['schema', 'server', 'tunnel']);
  return value;
}

export function createExposurePlan(input) {
  object(input, ['schema', 'server', 'tunnel']);
  if (input.schema !== 1) throw new Error('Configuration schema must be 1.');
  const server = input.server === undefined ? {} : input.server;
  object(server, ['kind', 'localUrl', 'image']);
  const kind = server.kind === undefined ? 'existing' : server.kind;
  if (!['existing', 'node', 'docker'].includes(kind)) throw new Error('Unsupported server.kind.');
  const address = localAddress(server.localUrl === undefined ? 'http://127.0.0.1:3978' : server.localUrl);
  if (kind !== 'docker' && server.image !== undefined) throw new Error('server.image is only valid for Docker.');
  if (kind === 'docker' && (typeof server.image !== 'string'
    || !/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(server.image))) {
    throw new Error('Docker requires an explicit immutable server.image digest.');
  }
  const tunnel = input.tunnel === undefined ? { provider: 'devtunnel' } : input.tunnel;
  object(tunnel, ['provider', 'reference', 'configFile', 'publicOrigin']);
  const provider = tunnel.provider;
  if (!Object.hasOwn(providers, provider)) throw new Error('Unsupported tunnel.provider.');
  const fields = {
    none: ['provider'], devtunnel: ['provider', 'reference', 'publicOrigin'],
    'cloudflare-quick': ['provider'],
    'cloudflare-named': ['provider', 'reference', 'configFile', 'publicOrigin'],
    ngrok: ['provider', 'publicOrigin'],
  };
  object(tunnel, fields[provider]);
  const publicOrigin = tunnel.publicOrigin === undefined ? null : publicAddress(tunnel.publicOrigin);
  if (['cloudflare-named', 'ngrok'].includes(provider) && !publicOrigin) {
    throw new Error('This provider requires an explicitly assigned tunnel.publicOrigin.');
  }
  const normalizedTunnel = { provider };
  if (publicOrigin) normalizedTunnel.publicOrigin = publicOrigin;
  if (tunnel.reference !== undefined) normalizedTunnel.reference = reference(tunnel.reference);
  if (tunnel.configFile !== undefined) normalizedTunnel.configFile = configurationFile(tunnel.configFile);
  if (provider === 'cloudflare-named' && (!normalizedTunnel.reference || !normalizedTunnel.configFile)) {
    throw new Error('Named Cloudflare requires an existing tunnel.reference and tunnel.configFile.');
  }
  const command = (executable, args, environment = {}) => ({ executable, args, environment });
  let serverCommand = null;
  const serverRequirements = ['verify-local-release-identity'];
  if (kind === 'node') {
    if (address.host !== '127.0.0.1') throw new Error('Node localUrl requires 127.0.0.1 for the existing TEAMS_BIND_HOST contract.');
    serverCommand = command('npm', ['start'], { PORT: String(address.port), TEAMS_BIND_HOST: '127.0.0.1' });
    serverRequirements.push('built-core-runtime', 'existing-runtime-environment', 'verify-port-is-free-before-start');
  }
  if (kind === 'docker') {
    serverCommand = command('docker', [
      'run', '--rm', '--pull=never', '--publish', `${address.host}:${address.port}:3978`,
      '--env-file', '.env.runtime', '--env', 'PORT=3978', server.image,
    ]);
    serverRequirements.push('locally-prepared-image', 'review-auth-stores-worker-configuration', 'verify-port-is-free-before-start');
  }
  let tunnelCommand = null;
  const tunnelRequirements = [];
  if (provider === 'devtunnel') {
    if (normalizedTunnel.reference) tunnelCommand = command('devtunnel', ['host', normalizedTunnel.reference]);
    tunnelRequirements.push('reuse-existing-tunnel-and-acl', 'verify-existing-port-mapping-and-domain');
  } else if (provider === 'cloudflare-quick') {
    tunnelCommand = command('cloudflared', ['tunnel', '--url', address.localUrl]);
    tunnelRequirements.push('synthetic-data-only', 'approve-new-public-exposure', 'no-sse-or-stable-teams-route');
  } else if (provider === 'cloudflare-named') {
    tunnelCommand = command('cloudflared', ['tunnel', '--config', normalizedTunnel.configFile, 'run', normalizedTunnel.reference]);
    tunnelRequirements.push('existing-account-domain-credentials-and-dns', 'verify-existing-ingress-target', 'approve-new-public-exposure');
  } else if (provider === 'ngrok') {
    tunnelCommand = command('ngrok', ['http', address.localUrl, '--url', publicOrigin]);
    tunnelRequirements.push('existing-account-and-assigned-domain', 'verify-teams-html-without-interstitial', 'review-plan-quotas', 'approve-new-public-exposure');
  }
  const tabDomain = publicOrigin ? new URL(publicOrigin).hostname : null;
  return {
    schema: 1,
    configuration: {
      schema: 1, server: { kind, localUrl: address.localUrl, ...(kind === 'docker' ? { image: server.image } : {}) },
      tunnel: normalizedTunnel,
    },
    sideEffects: 'none',
    server: { kind, ...address, command: serverCommand, requirements: serverRequirements },
    tunnel: { provider, command: tunnelCommand, capabilities: { ...providers[provider] }, requirements: tunnelRequirements },
    publicOrigin,
    teamsRoute: provider === 'cloudflare-quick' ? 'synthetic-only' : provider === 'none' ? 'local-only' : 'requires-host-verification',
    teamsProposal: tabDomain ? {
      status: 'review-required', tabDomain, validDomains: [tabDomain],
      contentUrl: `${publicOrigin}/tabs/home/`, websiteUrl: publicOrigin,
      botMessagingEndpoint: `${publicOrigin}/api/messages`,
      applicationIdUriTemplate: `api://${tabDomain}/botid-{existing-bot-client-id}`,
      redirectUris: 'review-existing-auth-flow; pure tab SSO alone does not require a new redirect URI',
    } : null,
    externalVerification: 'unverified',
    externalDataFlow: provider === 'none' ? null : {
      source: address.localUrl, destination: publicOrigin ?? 'provider-assigned-origin-not-yet-known',
      data: 'HTTP and WebSocket traffic, including any authentication and application data sent through that route',
    },
  };
}

async function findExecutable(name) {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch { /* Continue through the existing PATH; never install a tool. */ }
  }
  return null;
}

function toolVersion(executable) {
  return new Promise((resolve) => {
    execFile(executable, ['--version'], {
      timeout: 2000, maxBuffer: 32768, encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
        ...(process.env.DOTNET_BUNDLE_EXTRACT_BASE_DIR ? { DOTNET_BUNDLE_EXTRACT_BASE_DIR: process.env.DOTNET_BUNDLE_EXTRACT_BASE_DIR } : {}),
        ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}),
      },
    }, (error, stdout) => {
      const observed = stdout.match(/\b[0-9]+\.[0-9]+(?:\.[0-9]+){0,2}(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0];
      const version = observed && observed.length <= 80 ? observed : null;
      resolve({ status: !error && version ? 'version-checked' : 'version-unverified', version });
    });
  });
}

export function probeLocalHealth(localUrl, { timeoutMs = 2000 } = {}) {
  const address = localAddress(localUrl);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 10000) throw new Error('Invalid local health timeout.');
  return new Promise((resolve) => {
    let finished = false;
    const done = (value) => { if (!finished) { finished = true; clearTimeout(timer); resolve(value); } };
    const req = request(`${address.localUrl}/api/health`, { method: 'GET', agent: false }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 65536) { done({ status: 'response-too-large', httpStatus: response.statusCode }); req.destroy(); }
        else chunks.push(chunk);
      });
      response.on('error', () => done({ status: 'unavailable', httpStatus: response.statusCode }));
      response.on('end', () => {
        if (response.statusCode !== 200) { done({ status: 'http-error', httpStatus: response.statusCode }); return; }
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const version = body?.version ?? body?.appVersion;
          const sourceCommit = body?.sourceCommit;
          const identity = {
            version: typeof version === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version) && version.length <= 64 ? version : null,
            sourceCommit: typeof sourceCommit === 'string' && /^[a-f0-9]{40}$/.test(sourceCommit) ? sourceCommit : null,
          };
          done({ status: identity.version && identity.sourceCommit ? 'checked' : 'identity-unverified', httpStatus: 200, identity });
        } catch { done({ status: 'invalid-json', httpStatus: response.statusCode }); }
      });
    });
    const timer = setTimeout(() => { done({ status: 'timeout', httpStatus: null }); req.destroy(); }, timeoutMs);
    req.on('error', () => done({ status: 'unavailable', httpStatus: null }));
    req.end();
  });
}

export async function checkExposurePlan(input, options = {}) {
  // Revalidate config; callers cannot turn a plan's command into arbitrary execution.
  const plan = createExposurePlan(input.configuration);
  const locate = options.findExecutable ?? findExecutable;
  const probe = options.probeHealth ?? probeLocalHealth;
  const names = new Set();
  if (plan.server.kind === 'node') names.add('npm');
  if (plan.server.kind === 'docker') names.add('docker');
  if (plan.tunnel.provider === 'devtunnel') names.add('devtunnel');
  if (plan.tunnel.provider.startsWith('cloudflare-')) names.add('cloudflared');
  if (plan.tunnel.provider === 'ngrok') names.add('ngrok');
  const tools = {};
  for (const name of names) {
    const executable = await locate(name);
    tools[name] = executable ? await toolVersion(executable) : { status: 'not-installed', version: null };
  }
  const localHealth = await probe(plan.server.localUrl);
  const passed = localHealth.status === 'checked' && Object.values(tools).every((tool) => tool.status === 'version-checked');
  return {
    schema: 1, status: passed ? 'local-check-passed' : 'blocked', sideEffects: 'local-health-and-cli-version-reads-only',
    tools, localHealth, externalVerification: 'unverified',
    notChecked: ['runtime-auth-and-served-assets', 'external-domain', 'provider-authentication', 'named-tunnel-ingress', 'external-websocket-and-sse', 'Teams-installation-and-hosts'],
  };
}
