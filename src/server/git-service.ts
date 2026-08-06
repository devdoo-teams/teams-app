import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitCommitResult {
  committed: boolean;
  hash?: string;
  message: string;
}

export class GitService {
  constructor(private readonly workspace: string) {}

  async commit(message: string): Promise<GitCommitResult> {
    const status = await this.run(['status', '--porcelain']);
    const paths = status
      .split('\n')
      .map((line) => line.slice(3).trim())
      .filter((filePath) => filePath && this.isAllowedPath(filePath));

    if (paths.length === 0) {
      return { committed: false, message: '커밋할 안전한 변경 파일이 없습니다.' };
    }

    await this.run(['add', '--', ...paths]);
    await this.run(['commit', '-m', message]);
    const hash = (await this.run(['rev-parse', '--short', 'HEAD'])).trim();
    return { committed: true, hash, message: `커밋을 생성했습니다: ${hash}` };
  }

  private isAllowedPath(filePath: string): boolean {
    const normalized = filePath.replaceAll('\\', '/');
    if (normalized.startsWith('../') || normalized.includes('/../')) return false;
    if (normalized === '.git' || normalized.startsWith('.git/')) return false;
    if (normalized.startsWith('node_modules/')) return false;
    if (normalized.startsWith('dist/')) return false;
    if (normalized.startsWith('data/')) return false;
    if (normalized === '.env' || normalized.startsWith('.env.')) return false;
    return true;
  }

  private async run(args: string[]): Promise<string> {
    const result = await execFileAsync('git', args, {
      cwd: this.workspace,
      maxBuffer: 2 * 1024 * 1024,
    });
    return result.stdout;
  }
}
