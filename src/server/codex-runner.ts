import { spawn, type ChildProcess } from 'node:child_process';

import type { AgentJobMode } from './agent-job-store.js';

export interface CodexRunEvent {
  type?: string;
  item?: {
    type?: string;
    text?: string;
    command?: string;
  };
  thread_id?: string;
  error?: string;
}

export interface CodexRunResult {
  threadId?: string;
  finalMessage: string;
  eventCount: number;
}

export class CodexRunner {
  private readonly processes = new Map<string, ChildProcess>();

  async run(options: {
    jobId: string;
    prompt: string;
    workspace: string;
    mode: AgentJobMode;
    onEvent?: (event: CodexRunEvent) => Promise<void> | void;
  }): Promise<CodexRunResult> {
    const command = process.env.CODEX_BIN ?? 'codex';
    const script = process.env.CODEX_SCRIPT;
    const args = [
      ...(script ? [script] : []),
      'exec',
      '--json',
      '--sandbox',
      options.mode,
      '--cd',
      options.workspace,
      options.prompt,
    ];

    const child = spawn(command, args, {
      cwd: options.workspace,
      env: { ...process.env, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.processes.set(options.jobId, child);

    let threadId: string | undefined;
    let finalMessage = '';
    let eventCount = 0;
    let stdoutBuffer = '';
    let stderr = '';

    const handleLine = async (line: string): Promise<void> => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let event: CodexRunEvent;
      try {
        event = JSON.parse(trimmed) as CodexRunEvent;
      } catch {
        return;
      }

      eventCount += 1;
      if (event.type === 'thread.started') threadId = event.thread_id;
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        finalMessage = event.item.text?.trim() || finalMessage;
      }

      await options.onEvent?.(event);
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      void Promise.all(lines.map((line) => handleLine(line)));
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });

    if (stdoutBuffer.trim()) await handleLine(stdoutBuffer);
    this.processes.delete(options.jobId);

    if (exitCode !== 0) {
      const reason = stderr.trim().split('\n').slice(-3).join('\n') || `Codex exited with code ${exitCode}`;
      throw new Error(reason);
    }

    return {
      threadId,
      finalMessage: finalMessage || 'Codex 작업이 완료되었지만 최종 메시지가 없습니다.',
      eventCount,
    };
  }

  cancel(jobId: string): boolean {
    const child = this.processes.get(jobId);
    if (!child) return false;
    child.kill('SIGTERM');
    return true;
  }
}
