import { execFile } from 'node:child_process';
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
}

export class GitService {
  constructor(private readonly workspace: string) {}

  async captureWorkspaceSnapshot(): Promise<GitWorkspaceSnapshot> {
    const status = await this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    return {
      dirtyPaths: this.allowedStatusPaths(status),
    };
  }

  async changedPathsSince(snapshot: GitWorkspaceSnapshot): Promise<string[]> {
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

    const status = await this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    const changedPaths = this.allowedStatusPaths(status);
    const pathSet = new Set(ownedPaths);
    const paths = changedPaths.filter((filePath) => pathSet.has(filePath));

    if (paths.length === 0) {
      return { committed: false, message: '작업 소유 변경 경로에서 커밋할 파일을 찾지 못했습니다.' };
    }

    await this.run(['add', '-A', '--', ...paths]);
    await this.run(['commit', '--only', '-m', message, '--', ...paths]);
    const hash = (await this.run(['rev-parse', '--short', 'HEAD'])).trim();
    return { committed: true, hash, message: `커밋을 생성했습니다: ${hash}` };
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

  private allowedStatusPaths(status: string): string[] {
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
    });
    return result.stdout;
  }
}
