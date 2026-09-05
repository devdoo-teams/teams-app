/**
 * Compatibility export for the original queue module path.
 *
 * Keep one authoritative implementation so the legacy import path cannot
 * drift from the owner/generation CAS contract used by the Azure worker.
 */
export * from '../azure-agent-dispatch-queue.js';
