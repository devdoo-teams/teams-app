import { z } from 'zod';

export const RESPONSE_MODES = ['deterministic', 'openai', 'local', 'grok'] as const;
export const DEFAULT_RESPONSE_MODE = 'deterministic' satisfies ResponseMode;
export const MAX_RESPONSE_MODE_SCOPE_LENGTH = 256;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

export const ResponseModeSchema = z.enum(RESPONSE_MODES);
export type ResponseMode = z.infer<typeof ResponseModeSchema>;

const boundedScopeValueSchema = z.string()
  .max(MAX_RESPONSE_MODE_SCOPE_LENGTH)
  .refine((value) => value.trim().length > 0, 'value must not be blank')
  .refine((value) => !CONTROL_CHARACTERS.test(value), 'value contains unsupported control characters');

export const ResponseModeScopeSchema = z.object({
  tenantId: boundedScopeValueSchema,
  requesterId: boundedScopeValueSchema,
}).strict();
export type ResponseModeScope = z.infer<typeof ResponseModeScopeSchema>;

export const ResponseModeSelectionSchema = z.object({
  mode: ResponseModeSchema,
}).strict();
export type ResponseModeSelection = z.infer<typeof ResponseModeSelectionSchema>;

export const ResponseModeAvailabilitySchema = z.object({
  mode: ResponseModeSchema,
  label: z.string().min(1),
  configured: z.boolean(),
  requiresServerConfiguration: z.boolean(),
}).strict();
export type ResponseModeAvailability = z.infer<typeof ResponseModeAvailabilitySchema>;

const RESPONSE_MODE_LABELS: Record<ResponseMode, string> = {
  deterministic: '결정형',
  openai: 'OpenAI',
  local: '로컬/사내 모델',
  grok: 'Grok (xAI)',
};

export function responseModeLabel(mode: ResponseMode): string {
  const parsed = ResponseModeSchema.safeParse(mode);
  if (!parsed.success) throw new RangeError('Unknown response mode');
  return RESPONSE_MODE_LABELS[parsed.data];
}
