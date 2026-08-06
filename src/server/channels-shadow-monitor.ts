import { TEAMS_CARD_BUDGET_BYTES } from './copilot-channels-shadow.js';

export interface ChannelsShadowComparison {
  nativeActionCount: number;
  nativeBytes: number;
  shadowActionCount: number;
  shadowBytes: number;
  shadowWithinBudget: boolean;
}

export interface ChannelsShadowHealth {
  enabled: true;
  renderCount: number;
  failureCount: number;
  budgetFailures: number;
  actionCountMismatches: number;
  lastNativeBytes: number | null;
  lastShadowBytes: number | null;
  lastWithinBudget: boolean | null;
}

/** Aggregate-only comparison diagnostics; no envelope, identity, or token data is retained. */
export class ChannelsShadowMonitor {
  private renderCount = 0;
  private failureCount = 0;
  private budgetFailures = 0;
  private actionCountMismatches = 0;
  private lastNativeBytes: number | null = null;
  private lastShadowBytes: number | null = null;
  private lastWithinBudget: boolean | null = null;

  recordFailure(): void {
    this.renderCount += 1;
    this.failureCount += 1;
  }

  record(comparison: ChannelsShadowComparison): void {
    this.renderCount += 1;
    this.lastNativeBytes = comparison.nativeBytes;
    this.lastShadowBytes = comparison.shadowBytes;

    if (comparison.nativeActionCount !== comparison.shadowActionCount) {
      this.actionCountMismatches += 1;
    }

    const withinBudget = comparison.nativeBytes <= TEAMS_CARD_BUDGET_BYTES
      && comparison.shadowBytes <= TEAMS_CARD_BUDGET_BYTES
      && comparison.shadowWithinBudget;
    this.lastWithinBudget = withinBudget;
    if (!withinBudget) this.budgetFailures += 1;
  }

  snapshot(): ChannelsShadowHealth {
    return {
      enabled: true,
      renderCount: this.renderCount,
      failureCount: this.failureCount,
      budgetFailures: this.budgetFailures,
      actionCountMismatches: this.actionCountMismatches,
      lastNativeBytes: this.lastNativeBytes,
      lastShadowBytes: this.lastShadowBytes,
      lastWithinBudget: this.lastWithinBudget,
    };
  }
}
