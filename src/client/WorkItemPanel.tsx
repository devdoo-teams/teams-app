import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { apiFetch, isApiAuthError, runApiOperation, type ApiOperationRequest } from './auth.js';
import type { WorkItemPresentation } from '../shared/work-item.js';

type WorkItemStatus = 'backlog' | 'todo' | 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
type WorkView = 'search' | 'recent' | 'assigned' | 'calendar';

export type WorkItem = WorkItemPresentation;

const WORK_CONVERSATION_ID = 'personal-tab';
const statuses: Array<[WorkItemStatus, string]> = [
  ['backlog', '백로그'],
  ['todo', '할 일'],
  ['open', '열림'],
  ['in_progress', '진행 중'],
  ['blocked', '차단됨'],
  ['done', '완료'],
  ['cancelled', '취소'],
];
const statusLabel = new Map(statuses);

function nextMutationKey(prefix: string): string {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

type PendingMutation = { fingerprint: string; key: string };

function mutationFingerprint(path: string, init: RequestInit): string {
  const body = typeof init.body === 'string' ? init.body : '';
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      const { mutationKey: _mutationKey, ...payload } = parsed;
      return path + '|' + JSON.stringify(payload);
    }
  } catch {
    // A non-JSON body is still safe to fingerprint as its literal value.
  }
  return path + '|' + body;
}

export function applyStableMutationKey(
  path: string,
  init: RequestInit,
  busyKey: string,
  pending: Map<string, PendingMutation>,
): { path: string; init: RequestInit; key: string } {
  const fingerprint = mutationFingerprint(path, init);
  const existing = pending.get(busyKey);
  const key = existing?.fingerprint === fingerprint ? existing.key : nextMutationKey(busyKey);
  pending.set(busyKey, { fingerprint, key });
  const nextInit = { ...init };
  if (typeof init.body === 'string') {
    try {
      const parsed = JSON.parse(init.body) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        nextInit.body = JSON.stringify({ ...parsed, mutationKey: key });
        return { path, init: nextInit, key };
      }
    } catch {
      // Fall through to the query-string form used by DELETE watch.
    }
  }
  const url = new URL(path, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  url.searchParams.set('mutationKey', key);
  const nextPath = url.origin === 'http://localhost' && !/^https?:\/\//.test(path)
    ? url.pathname + url.search
    : url.toString();
  return { path: nextPath, init: nextInit, key };
}

export type WorkItemMutationOperationOptions = {
  path: string;
  init: RequestInit;
  busyKey: string;
  pending: Map<string, PendingMutation>;
  request: (path: string, init: RequestInit) => Promise<Response>;
  begin: () => void;
  setBusy: (busy: boolean) => void;
  onFailure: (caught: unknown, retry: () => Promise<void>) => void;
  onSuccess: () => void | Promise<void>;
  reload: () => Promise<void>;
  fallback: string;
};

/**
 * Creates the exact mutation lifecycle used by WorkItemPanel UI handlers.
 * Each confirmed phase advances an in-memory checkpoint before the next phase
 * starts. A retry can therefore resume an interrupted cleanup or reload
 * without replaying a server mutation that already returned success.
 */
export function createWorkItemMutationOperation(
  options: WorkItemMutationOperationOptions,
): () => Promise<boolean> {
  type MutationPhase = 'request' | 'success-callback' | 'reload' | 'complete';
  let phase: MutationPhase = 'request';
  let stable: ReturnType<typeof applyStableMutationKey> | undefined;

  const run = async (): Promise<boolean> => {
    if (phase === 'complete') return true;
    options.begin();
    options.setBusy(true);
    try {
      if (phase === 'request') {
        stable ??= applyStableMutationKey(
          options.path,
          options.init,
          options.busyKey,
          options.pending,
        );
        const response = await options.request(stable.path, stable.init);
        if (!response.ok) {
          let serverError = '';
          try {
            serverError = ((await response.json()) as { error?: string }).error ?? '';
          } catch {
            // Error rendering is sanitized by classifyWorkItemRequestError.
          }
          throw createWorkItemResponseError(response, serverError || options.fallback);
        }
        phase = 'success-callback';
      }

      if (phase === 'success-callback') {
        // Mark before invoking: React state cleanup is not safely replayable if
        // a callback throws after applying part of its visible side effects.
        phase = 'reload';
        await options.onSuccess();
      }

      if (phase === 'reload') {
        await options.reload();
        phase = 'complete';
      }
      options.pending.delete(options.busyKey);
      return true;
    } catch (caught) {
      options.onFailure(caught, async () => {
        await run();
      });
      return false;
    } finally {
      options.setBusy(false);
    }
  };

  return run;
}

export function parseWorkItemDeepLinkId(search: string | undefined): string | null {
  if (!search) return null;
  const itemId = new URLSearchParams(search).get('workItemId')?.trim();
  return itemId || null;
}

export function mergeDeepLinkedWorkItem(
  items: WorkItem[],
  selectedId: string | null,
  linkedItem: WorkItem | null,
): WorkItem[] {
  if (!selectedId || items.some((item) => item.id === selectedId) || linkedItem?.id !== selectedId) return items;
  return [linkedItem, ...items];
}

export type LatestWorkItemLoad = {
  signal: AbortSignal;
  commit: (callback: () => void) => boolean;
};

export function createLatestWorkItemLoadController(): {
  begin: () => LatestWorkItemLoad;
  dispose: () => void;
} {
  let active: { controller: AbortController; request: LatestWorkItemLoad } | null = null;

  return {
    begin() {
      active?.controller.abort();
      const controller = new AbortController();
      const request: LatestWorkItemLoad = {
        signal: controller.signal,
        commit(callback) {
          if (active?.request !== request || controller.signal.aborted) return false;
          callback();
          return true;
        },
      };
      active = { controller, request };
      return request;
    },
    dispose() {
      active?.controller.abort();
      active = null;
    },
  };
}

export type WorkItemPanelLoadOptions = {
  view: WorkView;
  query: string;
  status: WorkItemStatus | '';
  selectedId: string | null;
  signal: AbortSignal;
  request?: (path: string, init: RequestInit) => Promise<Response>;
};

export type WorkItemPanelLoadResult = {
  items: WorkItem[];
  selectedId: string | null;
  deepLinkNotice: string;
};

export async function loadWorkItemsForPanel(
  options: WorkItemPanelLoadOptions,
): Promise<WorkItemPanelLoadResult> {
  if (!options.request) {
    return runApiOperation(
      (request, signal) => loadWorkItemsForPanel({
        ...options,
        signal,
        request: (path, init) => workFetch(path, init, request),
      }),
      options.signal,
    );
  }

  const params = new URLSearchParams({ view: options.view });
  if (options.query.trim()) params.set('q', options.query.trim());
  if (options.status) params.set('status', options.status);

  const response = await options.request('/api/work-items?' + params.toString(), {
    signal: options.signal,
  });
  const body = (await response.json()) as { items?: WorkItem[]; error?: string };
  if (!response.ok) {
    throw createWorkItemResponseError(response, body.error || '업무 항목을 불러오지 못했습니다.');
  }

  const loadedItems = body.items ?? [];
  let linkedItem: WorkItem | null = null;
  let linkedItemMissing = false;
  if (options.selectedId && !loadedItems.some((item) => item.id === options.selectedId)) {
    const detailResponse = await options.request(
      '/api/work-items/' + encodeURIComponent(options.selectedId),
      { signal: options.signal },
    );
    if (detailResponse.ok) {
      const detailBody = (await detailResponse.json()) as { item?: WorkItem; error?: string };
      linkedItem = detailBody.item ?? null;
    } else if (detailResponse.status !== 404) {
      const detailBody = (await detailResponse.json()) as { error?: string };
      throw createWorkItemResponseError(detailResponse, detailBody.error || '딥링크 업무를 불러오지 못했습니다.');
    } else {
      linkedItemMissing = true;
    }
  }

  const items = mergeDeepLinkedWorkItem(loadedItems, options.selectedId, linkedItem);
  return {
    items,
    selectedId: options.selectedId && items.some((item) => item.id === options.selectedId)
      ? options.selectedId
      : null,
    deepLinkNotice: linkedItemMissing
      ? '요청한 업무를 찾을 수 없거나 현재 계정에서 볼 수 없습니다. 목록을 새로고침해 다시 확인하세요.'
      : '',
  };
}

/** Keep failed comment input available for a retry; only a confirmed mutation clears it. */
export function shouldClearWorkItemComment(mutationSucceeded: boolean): boolean {
  return mutationSucceeded;
}

export function validateWorkItemComment(value: string): string | undefined {
  return value.trim() ? undefined : '댓글 내용을 입력하세요.';
}

export function getWorkItemAssigneeButtonState(assignedToRequester: boolean): {
  label: string;
  disabled: boolean;
} {
  return assignedToRequester
    ? { label: '나에게서 해제', disabled: false }
    : { label: '나에게 할당', disabled: false };
}

export function validateEditableWorkItemTitle(value: string): string | undefined {
  return value.trim() ? undefined : '업무 제목을 입력하세요.';
}

export type WorkItemRequestProblem = {
  kind: 'auth-expired' | 'forbidden' | 'transient' | 'generic';
  message: string;
  canRetry: boolean;
};

type WorkItemResponseError = Error & { status?: number };

function createWorkItemResponseError(response: Response, message: string): WorkItemResponseError {
  const error = new Error(message) as WorkItemResponseError;
  error.status = response.status;
  return error;
}

function isTransientWorkItemRequestError(caught: unknown): boolean {
  if (!caught || typeof caught !== 'object') return false;
  const status = (caught as { status?: unknown }).status;
  if (typeof status === 'number') {
    return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
  }
  const name = (caught as { name?: unknown }).name;
  return name === 'TypeError' || name === 'NetworkError' || name === 'TimeoutError';
}

export function classifyWorkItemRequestError(
  caught: unknown,
  fallback: string,
): WorkItemRequestProblem {
  if (isApiAuthError(caught)) {
    return caught.kind === 'auth-expired'
      ? {
          kind: 'auth-expired',
          message: 'Teams 인증이 만료되었습니다. 다시 인증해 계속하세요.',
          canRetry: true,
        }
      : {
          kind: 'forbidden',
          message: '현재 계정에는 이 업무를 수행할 권한이 없습니다.',
          canRetry: false,
        };
  }
  if (isTransientWorkItemRequestError(caught)) {
    return {
      kind: 'transient',
      message: fallback,
      canRetry: true,
    };
  }
  return {
    kind: 'generic',
    // Server and thrown Error text can contain implementation details, tokens,
    // or upstream payloads. Only render the operation-specific safe copy.
    message: fallback,
    canRetry: false,
  };
}

export type UserDrivenAuthRetryController = {
  set: {
    (operation: () => Promise<void>): void;
    (operationId: string, operation: () => Promise<void>): void;
  };
  clear: (operationId?: string) => void;
  clearAll: () => void;
  retry: (operationId?: string) => Promise<boolean>;
  hasPending: (operationId?: string) => boolean;
};

export function createUserDrivenAuthRetryController(): UserDrivenAuthRetryController {
  const defaultOperationId = 'default';
  const pending = new Map<string, () => Promise<void>>();
  const retrying = new Set<string>();

  return {
    set(operationIdOrOperation: string | (() => Promise<void>), operation?: () => Promise<void>) {
      const operationId = typeof operationIdOrOperation === 'string'
        ? operationIdOrOperation
        : defaultOperationId;
      const retryOperation = typeof operationIdOrOperation === 'function'
        ? operationIdOrOperation
        : operation;
      if (!retryOperation) throw new TypeError('An auth retry operation is required');
      pending.set(operationId, retryOperation);
    },
    clear(operationId = defaultOperationId) {
      pending.delete(operationId);
    },
    clearAll() {
      pending.clear();
    },
    async retry(operationId = defaultOperationId) {
      if (retrying.has(operationId)) return false;
      const operation = pending.get(operationId);
      if (!operation) return false;
      pending.delete(operationId);
      retrying.add(operationId);
      try {
        await operation();
        return true;
      } finally {
        retrying.delete(operationId);
      }
    },
    hasPending(operationId = defaultOperationId) {
      return pending.has(operationId);
    },
  };
}

export function captureWorkItemRequestFailure(
  controller: UserDrivenAuthRetryController,
  caught: unknown,
  fallback: string,
  retry: () => Promise<void>,
): WorkItemRequestProblem;
export function captureWorkItemRequestFailure(
  controller: UserDrivenAuthRetryController,
  operationId: string,
  caught: unknown,
  fallback: string,
  retry: () => Promise<void>,
): WorkItemRequestProblem;
export function captureWorkItemRequestFailure(
  controller: UserDrivenAuthRetryController,
  operationIdOrCaught: string | unknown,
  caughtOrFallback: unknown,
  fallbackOrRetry: string | (() => Promise<void>),
  maybeRetry?: () => Promise<void>,
): WorkItemRequestProblem {
  const operationScoped = maybeRetry !== undefined;
  const operationId = operationScoped ? String(operationIdOrCaught) : undefined;
  const caught = operationScoped ? caughtOrFallback : operationIdOrCaught;
  const fallback = operationScoped ? String(fallbackOrRetry) : String(caughtOrFallback);
  const retry = maybeRetry ?? (fallbackOrRetry as () => Promise<void>);
  const problem = classifyWorkItemRequestError(caught, fallback);
  if (problem.canRetry) {
    if (operationId) controller.set(operationId, retry);
    else controller.set(retry);
  } else if (operationId) {
    controller.clear(operationId);
  } else {
    controller.clear();
  }
  return problem;
}

export function WorkItemAuthRecoveryNotice({
  operationId,
  problem,
  retrying,
  focusOnMount = false,
  onRetry,
}: {
  operationId: string;
  problem: WorkItemRequestProblem;
  retrying: boolean;
  focusOnMount?: boolean;
  onRetry: () => void;
}) {
  const [operationKind, operationTarget] = operationId.split(':', 2);
  const operationLabel = operationKind === 'load'
    ? '업무 목록'
    : operationKind === 'create'
      ? '새 업무 항목'
      : operationKind === 'comment'
        ? `업무 댓글 추가${operationTarget ? ` (${operationTarget})` : ''}`
        : operationKind === 'status'
          ? `업무 상태 변경${operationTarget ? ` (${operationTarget})` : ''}`
          : operationKind === 'assign'
            ? `업무 할당 변경${operationTarget ? ` (${operationTarget})` : ''}`
            : operationKind === 'watch'
              ? `업무 watch 변경${operationTarget ? ` (${operationTarget})` : ''}`
        : operationKind === 'edit'
          ? `업무 저장${operationTarget ? ` (${operationTarget})` : ''}`
          : operationKind === 'delete'
            ? `업무 삭제${operationTarget ? ` (${operationTarget})` : ''}`
            : `업무 작업 (${operationId})`;
  const encodedOperationId = encodeURIComponent(operationId).replaceAll('%', '_');
  const descriptionId = `work-item-auth-${encodedOperationId}-description`;
  const retryVerb = problem.kind === 'auth-expired' ? '다시 인증' : '다시 시도';
  const retryLabel = `${operationLabel} ${retryVerb}`;

  return (
    <div className="error auth-recovery" role="alert">
      <p><strong>{operationLabel}</strong></p>
      <p id={descriptionId}>{problem.message}</p>
      {problem.canRetry && (
        <button
          aria-describedby={descriptionId}
          autoFocus={focusOnMount && !retrying}
          className="secondary"
          disabled={retrying}
          onClick={onRetry}
          type="button"
        >
          {retrying ? `${operationLabel} ${retryVerb} 중…` : retryLabel}
        </button>
      )}
    </div>
  );
}

export type WorkItemAuthRecoveryEntry = {
  operationId: string;
  problem: WorkItemRequestProblem;
};

export function WorkItemAuthRecoveryNotices({
  problems,
  retrying,
  onRetry,
}: {
  problems: WorkItemAuthRecoveryEntry[];
  retrying: ReadonlySet<string>;
  onRetry: (operationId: string) => void;
}) {
  let focusAssigned = false;
  return (
    <>
      {[...problems]
        .sort((left, right) => (
          left.operationId < right.operationId ? -1 : left.operationId > right.operationId ? 1 : 0
        ))
        .map(({ operationId, problem }) => {
          const isRetrying = retrying.has(operationId);
          const focusOnMount = !focusAssigned && problem.canRetry && !isRetrying;
          if (focusOnMount) focusAssigned = true;
          return (
            <div data-auth-operation={operationId} key={operationId}>
              <WorkItemAuthRecoveryNotice
                focusOnMount={focusOnMount}
                onRetry={() => onRetry(operationId)}
                operationId={operationId}
                problem={problem}
                retrying={isRetrying}
              />
            </div>
          );
        })}
    </>
  );
}

export function WorkItemPanelResults({
  loading,
  hasItems,
  hasLoadError,
  children,
}: {
  loading: boolean;
  hasItems: boolean;
  hasLoadError: boolean;
  children: ReactNode;
}) {
  const statusMessage = loading
    ? '업무 항목을 불러오는 중입니다…'
    : hasLoadError
      ? ''
      : !hasItems
        ? '표시할 업무 항목이 없습니다. 첫 항목을 추가해 보세요.'
        : '';
  return (
    <>
      {statusMessage && (
        <div aria-atomic="true" aria-busy={loading} aria-live="polite" className="work-item-status" role="status">
          <p className="empty">{statusMessage}</p>
        </div>
      )}
      {!loading && (hasItems ? children : null)}
    </>
  );
}

export function WorkItemPanelError({ message }: { message: string }) {
  return <p className="error" role="alert">{message}</p>;
}

async function workFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  request: ApiOperationRequest = apiFetch,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-conversation-id', WORK_CONVERSATION_ID);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return request(input, { ...init, headers });
}

export function WorkItemPanel() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [view, setView] = useState<WorkView>('search');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<WorkItemStatus | ''>('');
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(() => (
    typeof window === 'undefined' ? null : parseWorkItemDeepLinkId(window.location.search)
  ));
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [requestProblems, setRequestProblems] = useState<Record<string, WorkItemRequestProblem>>({});
  const [authRetrying, setAuthRetrying] = useState<ReadonlySet<string>>(() => new Set());
  const [deepLinkNotice, setDeepLinkNotice] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const pendingMutationsRef = useRef(new Map<string, PendingMutation>());
  const authRetryControllerRef = useRef(createUserDrivenAuthRetryController());
  const selectedIdRef = useRef(selectedId);
  const queryRef = useRef(query);
  const loadControllerRef = useRef(createLatestWorkItemLoadController());
  selectedIdRef.current = selectedId;
  queryRef.current = query;

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  const clearRequestProblem = useCallback((operationId: string) => {
    setRequestProblems((current) => {
      if (!(operationId in current)) return current;
      const next = { ...current };
      delete next[operationId];
      return next;
    });
  }, []);

  const beginRequest = useCallback((operationId: string) => {
    authRetryControllerRef.current.clear(operationId);
    setError('');
    clearRequestProblem(operationId);
  }, [clearRequestProblem]);

  const handleRequestFailure = useCallback((
    operationId: string,
    caught: unknown,
    fallback: string,
    retry: () => Promise<void>,
  ) => {
    const problem = captureWorkItemRequestFailure(
      authRetryControllerRef.current,
      operationId,
      caught,
      fallback,
      retry,
    );
    setError('');
    setRequestProblems((current) => ({ ...current, [operationId]: problem }));
  }, []);

  const retryAuthOperation = useCallback(async (operationId: string) => {
    if (!authRetryControllerRef.current.hasPending(operationId)) return;
    setAuthRetrying((current) => new Set(current).add(operationId));
    setError('');
    clearRequestProblem(operationId);
    try {
      await authRetryControllerRef.current.retry(operationId);
    } finally {
      setAuthRetrying((current) => {
        const next = new Set(current);
        next.delete(operationId);
        return next;
      });
    }
  }, [clearRequestProblem]);

  const loadItems = useCallback(async (): Promise<void> => {
    const operationId = 'load';
    const request = loadControllerRef.current.begin();
    setLoading(true);
    beginRequest(operationId);
    setDeepLinkNotice('');
    try {
      const result = await loadWorkItemsForPanel({
        view,
        query: queryRef.current,
        status,
        selectedId: selectedIdRef.current,
        signal: request.signal,
      });
      request.commit(() => {
        setItems(result.items);
        setDeepLinkNotice(result.deepLinkNotice);
        if (selectedIdRef.current !== result.selectedId) setSelectedId(result.selectedId);
      });
    } catch (caught) {
      request.commit(() => handleRequestFailure(
        operationId,
        caught,
        '업무 항목을 불러오지 못했습니다.',
        loadItems,
      ));
    } finally {
      request.commit(() => setLoading(false));
    }
  }, [beginRequest, handleRequestFailure, status, view]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => () => {
    loadControllerRef.current.dispose();
    authRetryControllerRef.current.clearAll();
  }, []);

  useEffect(() => {
    if (!selected) return;
    setEditTitle(selected.title);
    setEditDescription(selected.description);
    setCommentError('');
  }, [selected]);

  async function createItem(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!title.trim()) {
      setError('업무 제목을 입력하세요.');
      return;
    }
    const createInit: RequestInit = {
      method: 'POST',
      body: JSON.stringify({
        title: title.trim(),
        dueDate: dueDate || undefined,
        labels: ['teams'],
        priority: 'medium',
      }),
    };
    await submitCreateItem(createInit);
  }

  async function submitCreateItem(createInit: RequestInit): Promise<void> {
    const operation = createWorkItemMutationOperation({
      path: '/api/work-items',
      init: createInit,
      busyKey: 'create',
      pending: pendingMutationsRef.current,
      request: workFetch,
      begin: () => beginRequest('create'),
      setBusy: (isBusy) => setBusy(isBusy ? 'create' : ''),
      onFailure: (caught, retry) => {
        handleRequestFailure(
          'create',
          caught,
          '업무 항목을 만들지 못했습니다.',
          retry,
        );
      },
      onSuccess: () => {
        setTitle('');
        setDueDate('');
      },
      reload: loadItems,
      fallback: '업무 항목을 만들지 못했습니다.',
    });
    await operation();
  }

  async function mutate(
    path: string,
    init: RequestInit,
    busyKey: string,
    onSuccess: () => void | Promise<void> = () => undefined,
  ): Promise<boolean> {
    const operation = createWorkItemMutationOperation({
      path,
      init,
      busyKey,
      pending: pendingMutationsRef.current,
      request: workFetch,
      begin: () => beginRequest(busyKey),
      setBusy: (isBusy) => setBusy(isBusy ? busyKey : ''),
      onFailure: (caught, retry) => {
        handleRequestFailure(
          busyKey,
          caught,
          '업무 항목을 변경하지 못했습니다.',
          retry,
        );
      },
      onSuccess,
      reload: loadItems,
      fallback: '업무 항목을 변경하지 못했습니다.',
    });
    return operation();
  }

  async function saveSelected(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected) return;
    const titleError = validateEditableWorkItemTitle(editTitle);
    if (titleError) {
      setError(titleError);
      return;
    }
    await mutate('/api/work-items/' + encodeURIComponent(selected.id), {
      method: 'PUT',
      body: JSON.stringify({
        patch: { title: editTitle.trim(), description: editDescription },
      }),
    }, 'edit:' + selected.id);
  }

  async function addComment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected) return;
    const commentValidationError = validateWorkItemComment(comment);
    if (commentValidationError) {
      setCommentError(commentValidationError);
      return;
    }
    setCommentError('');
    await mutate('/api/work-items/' + encodeURIComponent(selected.id) + '/comments', {
      method: 'POST',
      body: JSON.stringify({ body: comment.trim() }),
    }, 'comment:' + selected.id, () => {
      if (shouldClearWorkItemComment(true)) setComment('');
    });
  }

  async function deleteItem(itemId: string): Promise<void> {
    await mutate('/api/work-items/' + encodeURIComponent(itemId), {
      method: 'DELETE',
      body: JSON.stringify({}),
    }, 'delete:' + itemId, () => {
      setPendingDeleteId(null);
      if (selectedIdRef.current === itemId) setSelectedId(null);
    });
  }

  function requestDelete(itemId: string): void {
    if (pendingDeleteId === itemId) {
      void deleteItem(itemId);
      return;
    }
    setPendingDeleteId(itemId);
  }

  return (
    <section className="panel work-item-panel" aria-label="Atlassian parity 업무 항목">
      <div className="section-heading">
        <div>
          <p className="eyebrow">JIRA · TRELLO · ATLASSIAN HOME PARITY</p>
          <h2>업무 항목</h2>
          <p className="panel-description">검색·할당·상태·댓글·watch·캘린더를 한 탭에서 처리합니다.</p>
        </div>
        <button className="secondary" disabled={Boolean(busy)} onClick={() => void loadItems()} type="button">새로고침</button>
      </div>

      <div className="work-item-toolbar" aria-label="업무 항목 보기">
        {([
          ['search', '전체'],
          ['assigned', '내 할당'],
          ['recent', '최근'],
          ['calendar', '캘린더'],
        ] as const).map(([value, label]) => (
          <button
            aria-pressed={view === value}
            className={view === value ? 'filter active' : 'filter'}
            key={value}
            onClick={() => setView(value)}
            type="button"
          >{label}</button>
        ))}
        <input
          aria-label="업무 항목 검색"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void loadItems(); }}
          placeholder="제목·내용 검색"
          value={query}
        />
        <select aria-label="업무 상태 필터" disabled={Boolean(busy)} onChange={(event) => setStatus(event.target.value as WorkItemStatus | '')} value={status}>
          <option value="">모든 상태</option>
          {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <form className="work-item-create" onSubmit={(event) => void createItem(event)}>
        <input aria-label="새 업무 항목 제목" onChange={(event) => setTitle(event.target.value)} placeholder="새 업무 제목" value={title} />
        <input aria-label="업무 마감일" onChange={(event) => setDueDate(event.target.value)} type="date" value={dueDate} />
        <button className="primary" disabled={busy === 'create'} type="submit">{busy === 'create' ? '추가 중…' : '추가'}</button>
      </form>

      <WorkItemAuthRecoveryNotices
        onRetry={(operationId) => void retryAuthOperation(operationId)}
        problems={Object.entries(requestProblems).map(([operationId, problem]) => ({ operationId, problem }))}
        retrying={authRetrying}
      />
      {error && <WorkItemPanelError message={error} />}
      {deepLinkNotice && <WorkItemPanelError message={deepLinkNotice} />}
      <WorkItemPanelResults
        hasItems={items.length > 0}
        hasLoadError={Boolean(requestProblems.load || deepLinkNotice)}
        loading={loading}
      >
        <div className="work-item-list">
          {items.map((item) => {
            const selectedItem = item.id === selectedId;
            const itemPath = '/api/work-items/' + encodeURIComponent(item.id);
            const assigneeButton = getWorkItemAssigneeButtonState(item.assignedToRequester);
            return (
              <article className={selectedItem ? 'work-item-card selected' : 'work-item-card'} key={item.id}>
                <div className="work-item-card-heading">
                  <button className="work-item-title" onClick={() => setSelectedId(selectedItem ? null : item.id)} type="button">{item.title}</button>
                  <span className={'work-item-priority priority-' + item.priority}>{item.priority}</span>
                </div>
                <div className="work-item-meta">
                  <span>{statusLabel.get(item.status)}</span>
                  {item.dueDate && <span>기한 {item.dueDate}</span>}
                  {item.assigneeId && <span>담당 {item.assigneeId}</span>}
                  {item.labels.map((label) => <span key={label}>#{label}</span>)}
                </div>
                <div className="work-item-actions" aria-label={item.title + ' 작업'}>
                  <select aria-label={item.title + ' 상태'} disabled={Boolean(busy)} onChange={(event) => void mutate(itemPath + '/status', { method: 'PATCH', body: JSON.stringify({ status: event.target.value }) }, 'status:' + item.id)} value={item.status}>
                    {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <button
                    className="toggle"
                    disabled={Boolean(busy)}
                    onClick={() => void mutate(
                      itemPath + '/assignee',
                      { method: 'PATCH', body: JSON.stringify({ assigneeId: item.assignedToRequester ? null : 'self' }) },
                      'assign:' + item.id,
                    )}
                    type="button"
                  >{assigneeButton.label}</button>
                  <button className="toggle" disabled={Boolean(busy)} onClick={() => void mutate(itemPath + '/watch', { method: item.watching ? 'DELETE' : 'POST', body: item.watching ? undefined : JSON.stringify({}) }, 'watch:' + item.id)} type="button">{item.watching ? 'watch 해제' : 'watch'}</button>
                  {pendingDeleteId === item.id ? (
                    <span aria-label={item.title + ' 삭제 확인'} className="delete-confirmation">
                      <span>삭제할까요?</span>
                      <button
                        className="toggle danger"
                        disabled={Boolean(busy)}
                        onClick={() => void requestDelete(item.id)}
                        type="button"
                      >삭제 확인</button>
                      <button
                        className="toggle"
                        disabled={Boolean(busy)}
                        onClick={() => setPendingDeleteId(null)}
                        type="button"
                      >취소</button>
                    </span>
                  ) : (
                    <button className="toggle danger" disabled={Boolean(busy)} onClick={() => requestDelete(item.id)} type="button">삭제</button>
                  )}
                  <a className="work-item-link" href={item.deepLink.href}>탭에서 열기</a>
                </div>
                {selectedItem && (
                  <div className="work-item-detail">
                    <form onSubmit={(event) => void saveSelected(event)}>
                      <label>제목<input aria-label="선택한 업무 제목" onChange={(event) => setEditTitle(event.target.value)} value={editTitle} /></label>
                      <label>설명<textarea aria-label="선택한 업무 설명" onChange={(event) => setEditDescription(event.target.value)} value={editDescription} /></label>
                      <button className="secondary" disabled={busy === 'edit:' + item.id} type="submit">저장</button>
                    </form>
                    <div className="work-item-comments">
                      <strong>댓글 {item.comments.length}</strong>
                      {item.comments.map((entry) => <p key={entry.id}><b>{entry.authorId}</b> {entry.body}</p>)}
                      <form onSubmit={(event) => void addComment(event)}>
                        <input
                          aria-describedby={commentError ? 'work-item-comment-error-' + item.id : undefined}
                          aria-invalid={commentError ? true : undefined}
                          aria-label="업무 댓글"
                          onChange={(event) => {
                            setComment(event.target.value);
                            if (commentError) setCommentError('');
                          }}
                          placeholder="댓글 추가"
                          value={comment}
                        />
                        <button className="secondary" disabled={busy === 'comment:' + item.id} type="submit">댓글</button>
                      </form>
                      {commentError && (
                        <p className="error" id={'work-item-comment-error-' + item.id} role="alert">{commentError}</p>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </WorkItemPanelResults>
    </section>
  );
}
