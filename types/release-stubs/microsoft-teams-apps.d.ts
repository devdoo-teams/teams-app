export class ExpressAdapter {
  server: Record<string, unknown>;
  start(port: number | string): Promise<void>;
}

export class App {
  constructor(options?: Record<string, unknown>);
  readonly entraTokenValidator: unknown;
}
