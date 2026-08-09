import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { apiFetch } from './auth.js';
import {
  DEFAULT_RESPONSE_MODE,
  RESPONSE_MODES,
  ResponseModeSchema,
  responseModeLabel,
  type ResponseMode,
} from '../shared/response-mode.js';

export type ResponseModeApiFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ResponseModeOption = {
  mode: ResponseMode;
  label: string;
  configured: boolean;
  requiresServerConfiguration: boolean;
};

export type ResponseModeSelectorState = {
  status: 'loading' | 'ready' | 'saving' | 'error';
  mode: ResponseMode;
  availability: readonly ResponseModeOption[];
  error: string;
};

export type PublicResponseMode = {
  mode: ResponseMode;
  label: string;
  configured: boolean;
};

export type ResponseModeRetryHandler = () => void | Promise<void>;

export type ResponseModeSelectionHandler = ((mode: ResponseMode) => void | Promise<void>) & {
  retry?: ResponseModeRetryHandler;
};

const GENERIC_RESPONSE_MODE_ERROR = '응답 모드 상태를 확인하지 못했습니다. 잠시 후 다시 시도하세요.';
const RESPONSE_MODE_SAVE_ERROR = '응답 모드를 저장하지 못했습니다. 잠시 후 다시 시도하세요.';
const RESPONSE_MODE_AUTH_ERROR = 'Teams 인증을 확인한 뒤 응답 모드를 다시 시도하세요.';
const RESPONSE_MODE_SETUP_ERROR = (mode: ResponseMode): string =>
  `${responseModeLabel(mode)} 응답 모드는 서버 설정이 필요합니다. 결정형 또는 사용 가능한 모드를 선택하세요.`;

function createDefaultAvailability(): ResponseModeOption[] {
  return RESPONSE_MODES.map((mode) => ({
    mode,
    label: responseModeLabel(mode),
    configured: mode === DEFAULT_RESPONSE_MODE,
    requiresServerConfiguration: mode !== DEFAULT_RESPONSE_MODE,
  }));
}

export const DEFAULT_RESPONSE_MODE_STATE: ResponseModeSelectorState = {
  status: 'loading',
  mode: DEFAULT_RESPONSE_MODE,
  availability: createDefaultAvailability(),
  error: '',
};

class ResponseModeRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code?: 'response-mode-not-configured',
  ) {
    super('Response mode request failed');
    this.name = 'ResponseModeRequestError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function responseModeRequestError(status: number, code?: unknown): ResponseModeRequestError {
  return new ResponseModeRequestError(
    status,
    code === 'response-mode-not-configured' ? code : undefined,
  );
}

async function readPublicErrorCode(response: Response): Promise<'response-mode-not-configured' | undefined> {
  try {
    const value: unknown = await response.json();
    return isRecord(value) && value.code === 'response-mode-not-configured'
      ? 'response-mode-not-configured'
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeAvailability(value: unknown): ResponseModeOption[] {
  if (!Array.isArray(value)) throw new Error('Invalid response mode availability');

  const records = new Map<ResponseMode, Record<string, unknown>>();
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const parsedMode = ResponseModeSchema.safeParse(entry.mode);
    if (parsedMode.success && !records.has(parsedMode.data)) records.set(parsedMode.data, entry);
  }

  return RESPONSE_MODES.map((mode) => {
    const record = records.get(mode);
    if (!record || typeof record.configured !== 'boolean') {
      throw new Error('Invalid response mode availability');
    }

    return {
      mode,
      label: responseModeLabel(mode),
      configured: mode === DEFAULT_RESPONSE_MODE || record.configured,
      requiresServerConfiguration: mode !== DEFAULT_RESPONSE_MODE,
    };
  });
}

export function normalizeResponseModePayload(value: unknown): ResponseModeSelectorState {
  if (!isRecord(value)) throw new Error('Invalid response mode response');
  const parsedMode = ResponseModeSchema.safeParse(value.mode);
  if (!parsedMode.success) throw new Error('Invalid response mode response');

  return {
    status: 'ready',
    mode: parsedMode.data,
    availability: normalizeAvailability(value.availability),
    error: '',
  };
}

export async function fetchResponseMode(
  fetcher: ResponseModeApiFetcher = apiFetch,
): Promise<ResponseModeSelectorState> {
  const response = await fetcher('/api/response-mode');
  if (!response.ok) {
    throw responseModeRequestError(response.status, await readPublicErrorCode(response));
  }

  try {
    return normalizeResponseModePayload(await response.json());
  } catch (error) {
    if (error instanceof ResponseModeRequestError) throw error;
    throw new Error('Invalid response mode response');
  }
}

export async function saveResponseMode(
  mode: ResponseMode,
  fetcher: ResponseModeApiFetcher = apiFetch,
): Promise<ResponseModeSelectorState> {
  const parsedMode = ResponseModeSchema.safeParse(mode);
  if (!parsedMode.success) throw new Error('Invalid response mode selection');

  const response = await fetcher('/api/response-mode', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: parsedMode.data }),
  });
  if (!response.ok) {
    throw responseModeRequestError(response.status, await readPublicErrorCode(response));
  }

  try {
    return normalizeResponseModePayload(await response.json());
  } catch {
    throw new Error('Invalid response mode response');
  }
}

export function responseModeErrorMessage(error: unknown, attemptedMode?: ResponseMode): string {
  if (error instanceof ResponseModeRequestError) {
    if (error.code === 'response-mode-not-configured' || error.status === 409) {
      return attemptedMode ? RESPONSE_MODE_SETUP_ERROR(attemptedMode) : GENERIC_RESPONSE_MODE_ERROR;
    }
    if (error.status === 401) return RESPONSE_MODE_AUTH_ERROR;
  }
  return error instanceof Error && error.message === 'Invalid response mode response'
    ? GENERIC_RESPONSE_MODE_ERROR
    : attemptedMode
      ? RESPONSE_MODE_SAVE_ERROR
      : GENERIC_RESPONSE_MODE_ERROR;
}

export function getPublicResponseMode(state: ResponseModeSelectorState): PublicResponseMode {
  const selected = state.availability.find((entry) => entry.mode === state.mode);
  return {
    mode: state.mode,
    label: responseModeLabel(state.mode),
    configured: selected?.configured ?? state.mode === DEFAULT_RESPONSE_MODE,
  };
}

export function createResponseModeRetryGate(): {
  run: (operation: () => void | Promise<void>) => Promise<void>;
} {
  let active: Promise<void> | null = null;

  return {
    run(operation): Promise<void> {
      if (active) return active;
      const current = Promise.resolve().then(operation);
      const settled = current.finally(() => {
        if (active === settled) active = null;
      });
      active = settled;
      return settled;
    },
  };
}

export function useResponseMode(): {
  state: ResponseModeSelectorState;
  selectMode: ResponseModeSelectionHandler;
  retry: ResponseModeRetryHandler;
} {
  const [state, setState] = useState<ResponseModeSelectorState>(DEFAULT_RESPONSE_MODE_STATE);
  const stateRef = useRef(state);
  const mountedRef = useRef(true);
  const saveRequestRef = useRef<Promise<void> | null>(null);
  const requestGenerationRef = useRef(0);
  const retryOperationRef = useRef<ResponseModeRetryHandler | null>(null);
  stateRef.current = state;

  const load = useCallback(async (): Promise<void> => {
    const generation = ++requestGenerationRef.current;
    setState((previous) => ({ ...previous, status: 'loading', error: '' }));

    try {
      const nextState = await fetchResponseMode();
      if (!mountedRef.current || generation !== requestGenerationRef.current) return;
      retryOperationRef.current = null;
      setState(nextState);
    } catch (error: unknown) {
      if (!mountedRef.current || generation !== requestGenerationRef.current) return;
      retryOperationRef.current = load;
      setState((current) => ({
        ...current,
        status: 'error',
        error: responseModeErrorMessage(error),
      }));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();

    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, [load]);

  const runSave = useCallback(async (mode: ResponseMode): Promise<void> => {
    const generation = ++requestGenerationRef.current;
    setState((previous) => ({ ...previous, status: 'saving', error: '' }));
    try {
      const nextState = await saveResponseMode(mode);
      if (!mountedRef.current || generation !== requestGenerationRef.current) return;
      retryOperationRef.current = null;
      setState(nextState);
    } catch (error: unknown) {
      if (!mountedRef.current || generation !== requestGenerationRef.current) return;
      retryOperationRef.current = () => runSave(mode);
      setState((previous) => ({
        ...previous,
        status: 'error',
        error: responseModeErrorMessage(error, mode),
      }));
    }
  }, []);

  const selectMode = useCallback(async (mode: ResponseMode): Promise<void> => {
    const current = stateRef.current;
    const selected = current.availability.find((entry) => entry.mode === mode);
    if (
      saveRequestRef.current
      || current.status === 'loading'
      || current.status === 'saving'
      || !selected?.configured
      || mode === current.mode
    ) {
      return;
    }

    const request = runSave(mode);

    saveRequestRef.current = request;
    try {
      await request;
    } finally {
      if (saveRequestRef.current === request) saveRequestRef.current = null;
    }
  }, [runSave]);

  const retry = useCallback(async (): Promise<void> => {
    const operation = retryOperationRef.current;
    if (!operation || saveRequestRef.current) return;

    const request = Promise.resolve(operation());
    saveRequestRef.current = request;
    try {
      await request;
    } finally {
      if (saveRequestRef.current === request) saveRequestRef.current = null;
    }
  }, []);

  const selectionHandler = useMemo<ResponseModeSelectionHandler>(() => {
    const handler = selectMode as ResponseModeSelectionHandler;
    handler.retry = retry;
    return handler;
  }, [retry, selectMode]);

  return { state, selectMode: selectionHandler, retry };
}

export type ResponseModeSelectorProps = {
  state: ResponseModeSelectorState;
  onSelectMode: ResponseModeSelectionHandler;
  onRetry?: ResponseModeRetryHandler;
};

function safeDisplayError(error: string): string {
  const trimmed = error.trim();
  if (!trimmed || trimmed.length > 240 || /https?:\/\/|OPENAI_API_KEY|LOCAL_MODEL|Bearer\s/i.test(trimmed)) {
    return GENERIC_RESPONSE_MODE_ERROR;
  }
  return trimmed;
}

export function ResponseModeSelector({ state, onSelectMode, onRetry }: ResponseModeSelectorProps) {
  const busy = state.status === 'loading' || state.status === 'saving';
  const current = getPublicResponseMode(state);
  const currentAvailability = state.availability.find((entry) => entry.mode === current.mode);
  const retry = onRetry ?? onSelectMode.retry;

  function handleChange(value: string): void {
    const parsedMode = ResponseModeSchema.safeParse(value);
    if (!parsedMode.success) return;
    const option = state.availability.find((entry) => entry.mode === parsedMode.data);
    if (!option?.configured || busy) return;
    void onSelectMode(parsedMode.data);
  }

  return (
    <section
      aria-busy={busy}
      aria-labelledby="response-mode-heading"
      className="response-mode-panel"
    >
      <div className="response-mode-heading">
        <div>
          <p className="eyebrow">RESPONSE MODE</p>
          <h2 id="response-mode-heading">응답 모드</h2>
          <p>Teams 모바일에서 사용할 응답 방식을 선택하세요. 비밀키나 모델 주소는 입력하지 않습니다.</p>
        </div>
        <span className="response-mode-current" aria-live="polite">
          현재: {current.label} · {currentAvailability?.configured ? '사용 가능' : '서버 설정 필요'}
        </span>
      </div>

      {state.status === 'loading' ? (
        <p className="response-mode-status" role="status">응답 모드 상태를 불러오는 중…</p>
      ) : (
        <fieldset className="response-mode-fieldset" disabled={busy}>
          <legend>사용할 응답 방식</legend>
          <div aria-label="응답 방식" className="response-mode-options" role="radiogroup">
            {state.availability.map((option) => {
              const checked = option.mode === state.mode;
              const descriptionId = `response-mode-${option.mode}-description`;
              return (
                <label
                  className={`response-mode-option${checked ? ' response-mode-option--selected' : ''}${option.configured ? '' : ' response-mode-option--disabled'}`}
                  key={option.mode}
                >
                  <input
                    aria-describedby={descriptionId}
                    checked={checked}
                    disabled={busy || !option.configured}
                    name="response-mode"
                    onChange={(event) => handleChange(event.currentTarget.value)}
                    type="radio"
                    value={option.mode}
                  />
                  <span className="response-mode-option-copy">
                    <strong>{option.label}</strong>
                    <small id={descriptionId}>
                      {option.configured ? '사용 가능' : '서버 설정 필요'}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {state.status === 'saving' && (
        <p className="response-mode-status" role="status">응답 모드를 저장하는 중…</p>
      )}
      {state.error && (
        <div className="response-mode-error-group">
          <p aria-live="assertive" className="response-mode-error" role="alert">
            {safeDisplayError(state.error)}
          </p>
          {retry && (
            <button className="secondary" disabled={busy} onClick={() => void retry()} type="button">
              응답 모드 다시 시도
            </button>
          )}
        </div>
      )}
    </section>
  );
}
