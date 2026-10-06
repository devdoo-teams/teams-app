/** Last user selection wins, including when an older transport ignores abort. */
export function createLatestDetailRequestController() {
  let generation = 0;
  let active: AbortController | undefined;
  return {
    async request<T>(
      load: (signal: AbortSignal) => Promise<T>,
      handlers: { success: (value: T) => void; error?: (error: unknown) => void; settled?: () => void },
    ): Promise<void> {
      active?.abort();
      const controller = new AbortController();
      active = controller;
      const current = ++generation;
      try {
        const value = await load(controller.signal);
        if (current === generation && !controller.signal.aborted) handlers.success(value);
      } catch (error) {
        if (current === generation && !controller.signal.aborted) handlers.error?.(error);
      } finally {
        if (current === generation && !controller.signal.aborted) handlers.settled?.();
      }
    },
    dispose() { generation += 1; active?.abort(); active = undefined; },
  };
}
