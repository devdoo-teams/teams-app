# Portable HTTP / Mac Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Implement inline, then prepare one Astra review.

**Goal:** Add a tested, provider-independent handoff composition and prepare a coherent local release candidate.
**Architecture:** The cloud AgentService uses a durable pull dispatcher. An authenticated Mac connector claims work over outbound HTTP and reuses the existing local AgentService. Deployment composition remains explicitly pending review.
**Tech Stack:** TypeScript, Express, existing atomic JSON storage, Node fetch and existing Core contracts; no dependencies.
**Spec:** docs/superpowers/specs/2026-10-17-portable-http-mac-design.md

## Global Constraints

- Original main 50fedfc6, public server 152/8dcc and frozen 154/ea17384 evidence remain intact.
- No credentials, model/config, new account, payment, deployment or persistent access changes.
- Read-only first slice; existing mutation approval and isolation remain authoritative.
- Synthetic loopback evidence is not live Teams/provider evidence.

## Review Focus

- Lost claim/begin/completion responses must not cause another execution.
- A different owner/worker must not read prompts or publish receipts.
- Lease expiry after begin must quarantine rather than reassign.
- Cancellation/disconnect must stop owned execution before terminal acknowledgement.
- Mutable model/prompt/provider fields and unapproved writes must fail closed.

### Task 1: Durable handoff and authenticated HTTP

**Files:** create src/server/pull-worker.ts, src/server/pull-worker-http.ts, scripts/portable-worker-test.ts.
**Interfaces:** createPullWorkerHost returns dispatcher, claim/begin/heartbeat/finish operations and lifecycle close; createPullWorkerRouter consumes injected authentication and verified worker identity.

- [ ] Write failing tests for replay/conflict, immutable scope/model, lease expiry, restart, cancellation and unauthorized HTTP.
- [ ] Run focused tests and retain RED output.
- [ ] Implement bounded validation, durable transitions and HTTP routes; no production index mount.
- [ ] Run focused tests and strict typecheck; commit the task.

### Task 2: Mac connector and existing policy adapter

**Files:** create src/server/mac-pull-worker.ts; extend portable-worker-test.ts and AgentExecutionDispatcher kind.
**Interfaces:** MacPullWorker.step consumes an authenticated transport and a trusted executor; createAgentServiceMacExecutor reuses submit/get/cancelStrict and existing policy.

- [ ] Write failing tests for repeated delivery, lost replies, disconnect cleanup and local isolation/approval rejection.
- [ ] Implement bounded outbound transport and connector, preserving task identity/model and idempotency.
- [ ] Run focused tests and existing execution-policy regressions; commit the task.

### Task 3: Candidate and review packet

**Files:** package.json, package-lock.json, appPackage/manifest.json, Core test inventory/contract, docs/portable-http-mac.md.

- [ ] Register focused tests in Core, set candidate 1.0.156 consistently and document opt-in composition/remaining host gates.
- [ ] Commit, then run exact-commit strict typecheck, Core tests/build, manifest, bundle determinism and ZIP read-back with bounded logs.
- [ ] Record source/build/package identities, preserved original server/ledger and exact-SHA CI pending status.
- [ ] Prepare diff and evidence for Astra; keep final operational promotion pending review.
