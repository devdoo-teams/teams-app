import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { renderChannelsNativeCard } from './channels-native-card-renderer.js';

export async function loadChannelsNativeRenderer(options: { enabled: boolean; runtimeDistRoot: string; sourceCommit: string }) {
  if (!options.enabled) return undefined;
  const root = path.join(options.runtimeDistRoot, 'channels-renderer');
  const file = path.join(root, 'channels-native-card-renderer.js');
  const marker = JSON.parse(readFileSync(path.join(root, '.teams-channels-renderer-build.json'), 'utf8'));
  if (marker.schemaVersion !== 1 || marker.sourceCommit !== options.sourceCommit || marker.commit !== options.sourceCommit
    || !/^[a-f0-9]{40}$/u.test(options.sourceCommit) || marker.worktree !== 'clean'
    || marker.mode !== 'channels-native-renderer' || marker.output !== 'channels-native-card-renderer.js'
    || !/^[a-f0-9]{64}$/u.test(marker.artifactSha256 ?? '')
    || createHash('sha256').update(readFileSync(file)).digest('hex') !== marker.artifactSha256) {
    throw new Error('CHANNELS_RENDERER_IDENTITY_BLOCKED');
  }
  const loaded = await import(pathToFileURL(file).href);
  if (typeof loaded.renderChannelsNativeCard !== 'function' || loaded.CHANNELS_NATIVE_RENDERER_CONTRACT?.packageVersion !== '0.7.3'
    || loaded.CHANNELS_NATIVE_RENDERER_CONTRACT?.deliveredVersion !== '1.6') throw new Error('CHANNELS_RENDERER_CONTRACT_DRIFT_BLOCKED');
  return { render: loaded.renderChannelsNativeCard as typeof renderChannelsNativeCard, marker };
}
