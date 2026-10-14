import { redactSensitiveText } from './sensitive-text.js';

const PRIVATE_START = /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/i;
const PRIVATE_END = /-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/i;
const UNSAFE_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;

/**
 * Safe text projection of actual PTY callbacks, not a VT byte stream. Hold an
 * unfinished line so a credential split across callbacks/read requests cannot
 * leak its prefix. Control-bearing lines and private-key blocks are omitted.
 */
export class PtyOutputLines {
  private pending = '';
  private pendingBytes = 0;
  private privateKey = false;
  private suppressed = false;
  private finished = false;

  constructor(private readonly maxPendingBytes: number, private readonly emit: (line: string) => void) {}

  get pendingOutput(): boolean { return Boolean(this.pending || this.privateKey); }
  get outputSuppressed(): boolean { return this.suppressed; }

  push(value: string): void {
    if (this.finished || this.suppressed) return;
    for (const character of value) {
      if (character === '\n') {
        this.flushLine();
      } else if (character !== '\r') {
        this.pendingBytes += Buffer.byteLength(character, 'utf8');
        if (this.pendingBytes > this.maxPendingBytes) {
          this.pending = '';
          this.pendingBytes = 0;
          // An overlong line may hide a private-key delimiter. Do not resume
          // disclosure mid-session after losing the framing boundary.
          this.suppressed = true;
          this.emit('[PTY output omitted: line too long]\n');
          return;
        }
        this.pending += character;
      }
    }
  }

  finish(): void {
    if (this.finished) return;
    if (!this.suppressed && this.pending) this.flushLine();
    this.finished = true;
    this.pending = '';
    this.privateKey = false;
  }

  private flushLine(): void {
    const line = this.pending;
    this.pending = '';
    this.pendingBytes = 0;
    if (this.privateKey) {
      if (PRIVATE_END.test(line)) this.privateKey = false;
      return;
    }
    if (PRIVATE_START.test(line)) {
      this.privateKey = !PRIVATE_END.test(line);
      this.emit('[PTY private key omitted]\n');
    } else if (UNSAFE_CONTROLS.test(line)) {
      this.emit('[PTY control output omitted]\n');
    } else {
      this.emit(`${redactSensitiveText(line)}\n`);
    }
  }
}
