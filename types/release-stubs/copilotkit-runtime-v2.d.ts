export class CopilotRuntime {
  constructor(options?: {
    agents?: (context: { request: { headers: Headers } }) => Record<string, unknown>;
    [key: string]: unknown;
  });
}
