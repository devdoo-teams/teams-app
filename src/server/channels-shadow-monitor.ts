import type { GenUiSemanticSignature } from './genui-teams.js';

// Keep the core Teams server independent from the optional Channels renderer.
export const TEAMS_CARD_BUDGET_BYTES = 28 * 1024;

export interface ChannelsShadowComparison {
  nativeActionCount: number;
  nativeBytes: number;
  shadowActionCount: number;
  shadowBytes: number;
  shadowWithinBudget: boolean;
  nativeSignature: GenUiSemanticSignature;
  shadowSignature: GenUiSemanticSignature;
  deliveredCardMatchesNative: boolean;
}

export interface ChannelsShadowHealth {
  enabled: true;
  renderCount: number;
  failureCount: number;
  budgetFailures: number;
  actionCountMismatches: number;
  kindMismatches: number;
  statusMismatches: number;
  orderedSectionTypeMismatches: number;
  deliveredCardMismatches: number;
  lastNativeBytes: number | null;
  lastShadowBytes: number | null;
  lastWithinBudget: boolean | null;
  lastKindMatch: boolean | null;
  lastStatusMatch: boolean | null;
  lastOrderedSectionTypesMatch: boolean | null;
  lastDeliveredCardMatch: boolean | null;
}

/** Aggregate-only comparison diagnostics; no envelope, identity, or token data is retained. */
export class ChannelsShadowMonitor {
  private renderCount = 0;
  private failureCount = 0;
  private budgetFailures = 0;
  private actionCountMismatches = 0;
  private kindMismatches = 0;
  private statusMismatches = 0;
  private orderedSectionTypeMismatches = 0;
  private deliveredCardMismatches = 0;
  private lastNativeBytes: number | null = null;
  private lastShadowBytes: number | null = null;
  private lastWithinBudget: boolean | null = null;
  private lastKindMatch: boolean | null = null;
  private lastStatusMatch: boolean | null = null;
  private lastOrderedSectionTypesMatch: boolean | null = null;
  private lastDeliveredCardMatch: boolean | null = null;

  recordFailure(): void {
    this.renderCount += 1;
    this.failureCount += 1;
  }

  record(comparison: ChannelsShadowComparison): void {
    this.renderCount += 1;
    this.lastNativeBytes = comparison.nativeBytes;
    this.lastShadowBytes = comparison.shadowBytes;

    const kindMatch = comparison.nativeSignature.kind === comparison.shadowSignature.kind;
    const statusMatch = comparison.nativeSignature.status === comparison.shadowSignature.status;
    const orderedSectionTypesMatch = comparison.nativeSignature.sectionTypes.length
      === comparison.shadowSignature.sectionTypes.length
      && comparison.nativeSignature.sectionTypes.every(
        (type, index) => type === comparison.shadowSignature.sectionTypes[index],
      );

    this.lastKindMatch = kindMatch;
    this.lastStatusMatch = statusMatch;
    this.lastOrderedSectionTypesMatch = orderedSectionTypesMatch;
    this.lastDeliveredCardMatch = comparison.deliveredCardMatchesNative;

    if (!kindMatch) this.kindMismatches += 1;
    if (!statusMatch) this.statusMismatches += 1;
    if (!orderedSectionTypesMatch) this.orderedSectionTypeMismatches += 1;
    if (!comparison.deliveredCardMatchesNative) this.deliveredCardMismatches += 1;

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
      kindMismatches: this.kindMismatches,
      statusMismatches: this.statusMismatches,
      orderedSectionTypeMismatches: this.orderedSectionTypeMismatches,
      deliveredCardMismatches: this.deliveredCardMismatches,
      lastNativeBytes: this.lastNativeBytes,
      lastShadowBytes: this.lastShadowBytes,
      lastWithinBudget: this.lastWithinBudget,
      lastKindMatch: this.lastKindMatch,
      lastStatusMatch: this.lastStatusMatch,
      lastOrderedSectionTypesMatch: this.lastOrderedSectionTypesMatch,
      lastDeliveredCardMatch: this.lastDeliveredCardMatch,
    };
  }
}
