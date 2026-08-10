import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitCommitResult {
  committed: boolean;
  hash?: string;
  message: string;
}

export interface GitCommitOptions {
  ownedPaths?: readonly string[];
}

export interface GitWorkspaceSnapshot {
  dirtyPaths: readonly string[];
  fingerprints?: ReadonlyMap<string, string>;
}

const GIT_COMMAND_TIMEOUT_MS = 10_000;

export class GitService {
  constructor(private readonly workspace: string) {}

  async captureWorkspaceSnapshot(): Promise<GitWorkspaceSnapshot> {
    // Do not use a repository-wide `git status` here. On macOS, a workspace
    // under FileProvider can contain local `dataless` files; asking Git to
    // stat every tracked and untracked path can block an agent job for an
    // unbounded amount of time. A filesystem fingerprint is sufficient for
    // the before/after ownership proof and does not hydrate file contents.
    const fingerprints = await this.captureFilesystemFingerprints();
    return {
      dirtyPaths: [...fingerprints.keys()].sort(),
      fingerprints,
    };
  }

  async changedPathsSince(snapshot: GitWorkspaceSnapshot): Promise<string[]> {
    if (snapshot.fingerprints) {
      const after = await this.captureFilesystemFingerprints();
      const changed = new Set<string>();
      for (const [filePath, fingerprint] of snapshot.fingerprints) {
        if (after.get(filePath) !== fingerprint) changed.add(filePath);
      }
      for (const filePath of after.keys()) {
        if (!snapshot.fingerprints.has(filePath)) changed.add(filePath);
      }
      return [...changed].sort();
    }

    // Keep compatibility with small test doubles and snapshots created by
    // older callers. New production snapshots always take the bounded path
    // above.
    const before = new Set(snapshot.dirtyPaths);
    const after = await this.captureWorkspaceSnapshot();
    return after.dirtyPaths.filter((filePath) => !before.has(filePath));
  }

  async commit(message: string, options: GitCommitOptions = {}): Promise<GitCommitResult> {
    const ownedPaths = [...new Set((options.ownedPaths ?? [])
      .map((entry) => entry.trim())
      .filter((entry) => entry && this.isAllowedPath(entry)))];
    if (ownedPaths.length === 0) {
      return { committed: false, message: '작업의 기록된 변경 경로를 확인할 수 없어 커밋을 중단했습니다.' };
    }

    await this.run(['add', '-A', '--', ...ownedPaths]);
    const staged = this.parseNameOnlyPaths(await this.run(['diff', '--cached', '--name-only', '-z', '--', ...ownedPaths]));
    if (staged.length === 0) {
      return { committed: false, message: '작업 소유 변경 경로에서 커밋할 파일을 찾지 못했습니다.' };
    }

    await this.run(['commit', '--only', '-m', message, '--', ...ownedPaths]);
    const hash = (await this.run(['rev-parse', '--short', 'HEAD'])).trim();
    return { committed: true, hash, message: `커밋을 생성했습니다: ${hash}` };
  }

  private async captureFilesystemFingerprints(): Promise<Map<string, string>> {
    const fingerprints = new Map<string, string>();

    const visit = async (absoluteDirectory: string, relativeDirectory: string): Promise<void> => {
      const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
      for (const entry of entries) {
        const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (this.shouldSkipDirectory(relativePath)) continue;
          await visit(path.join(absoluteDirectory, entry.name), relativePath);
          continue;
        }
        if (!this.isAllowedPath(relativePath) || entry.isSymbolicLink()) continue;
        const stat = await fs.lstat(path.join(absoluteDirectory, entry.name));
        fingerprints.set(relativePath, `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.mode}`);
      }
    };

    await visit(this.workspace, '');
    return fingerprints;
  }

  private shouldSkipDirectory(relativePath: string): boolean {
    return relativePath === '.git'
      || relativePath === 'node_modules'
      || relativePath === 'dist'
      || relativePath === 'data'
      || relativePath === 'appPackage/build'
      || !this.isAllowedPath(relativePath);
  }

  private isAllowedPath(filePath: string): boolean {
    const normalized = filePath.replaceAll('\\', '/');
    if (!normalized || normalized !== normalized.trim()) return false;
    if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return false;
    if (normalized.startsWith('../') || normalized.includes('/../')) return false;
    if (normalized === '.git' || normalized.startsWith('.git/')) return false;
    if (normalized.startsWith('node_modules/')) return false;
    if (normalized.startsWith('dist/')) return false;
    if (normalized.startsWith('data/')) return false;
    if (normalized === '.env' || normalized.startsWith('.env.')) return false;
    return true;
  }

  private parseNameOnlyPaths(output: string): string[] {
    return [...new Set(output.split('\0')
      .map((entry) => entry.trim())
      .filter((entry) => this.isAllowedPath(entry)))].sort();
  }

  private parsePathList(status: string): string[] {
    const records = status.split('\0');
    const paths = new Set<string>();

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!record || record.length < 4) continue;
      const statusCode = record.slice(0, 2);
      const filePath = record.slice(3);
      if (this.isAllowedPath(filePath)) paths.add(filePath);

      if (statusCode.includes('R') || statusCode.includes('C')) {
        const sourcePath = records[index + 1];
        index += 1;
        if (sourcePath && this.isAllowedPath(sourcePath)) paths.add(sourcePath);
      }
    }

    return [...paths].sort();
  }

  private async run(args: string[]): Promise<string> {
    const result = await execFileAsync('git', args, {
      cwd: this.workspace,
      maxBuffer: 2 * 1024 * 1024,
      timeout: GIT_COMMAND_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    return result.stdout;
  }
}
