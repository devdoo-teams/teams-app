import { z } from 'zod';

export const GENUI_SCHEMA_VERSION = '1' as const;

export const GENUI_KINDS = [
  'answer',
  'weather',
  'task-list',
  'job-status',
  'approval',
  'result',
  'error',
] as const;

export const GENUI_ACTIONS = [
  'approve',
  'cancel',
  'refresh',
  'retry',
  'open-tab',
  'feedback',
] as const;

export const GENUI_ACTION_PAYLOAD_KEYS = [
  'schemaVersion',
  'action',
  'entityId',
  'correlationId',
  'actionToken',
] as const;

export const GenUiKindSchema = z.enum(GENUI_KINDS);
export const GenUiActionNameSchema = z.enum(GENUI_ACTIONS);

const GenUiScalarSchema = z.union([
  z.string().max(2_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const GenUiListItemSchema = z.object({
  label: z.string().min(1).max(200),
  value: GenUiScalarSchema.optional(),
  status: z.string().min(1).max(120).optional(),
}).strict();

export const GenUiSectionSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  type: z.enum(['text', 'facts', 'list', 'progress', 'status']).default('text'),
  label: z.string().min(1).max(200).optional(),
  value: GenUiScalarSchema.optional(),
  description: z.string().max(2_000).optional(),
  status: z.string().min(1).max(120).optional(),
  progress: z.number().min(0).max(1).optional(),
  items: z.array(GenUiListItemSchema).max(24).optional(),
}).strict();

export const GenUiCitationSchema = z.object({
  title: z.string().min(1).max(200),
  url: z.string().url().max(2_048),
  snippet: z.string().max(500).optional(),
}).strict();

export const GenUiActionSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  action: GenUiActionNameSchema,
  label: z.string().min(1).max(80),
  entityId: z.string().min(1).max(200),
  correlationId: z.string().min(1).max(200),
  actionToken: z.string().min(1).max(512),
  style: z.enum(['default', 'positive', 'destructive']).default('default'),
}).strict();

const GenUiMetadataSchema = z.record(
  z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/),
  GenUiScalarSchema,
).refine((value) => Object.keys(value).length <= 16, {
  message: 'metadata supports at most 16 keys',
});

export const GenUiEnvelopeV1Schema = z.object({
  schemaVersion: z.literal(GENUI_SCHEMA_VERSION),
  kind: GenUiKindSchema,
  id: z.string().min(1).max(200),
  correlationId: z.string().min(1).max(200),
  title: z.string().max(240).optional(),
  summary: z.string().max(2_000).optional(),
  sections: z.array(GenUiSectionSchema).max(32).default([]),
  actions: z.array(GenUiActionSchema).max(8).default([]),
  citations: z.array(GenUiCitationSchema).max(8).default([]),
  aiGenerated: z.boolean().default(false),
  fallbackText: z.string().min(1).max(4_000).optional(),
  metadata: GenUiMetadataSchema.default({}),
}).strict().superRefine((value, context) => {
  if (value.citations.length > 0 && !value.aiGenerated) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['citations'],
      message: 'citations require aiGenerated=true',
    });
  }
});

export type GenUiKind = z.infer<typeof GenUiKindSchema>;
export type GenUiActionName = z.infer<typeof GenUiActionNameSchema>;
export type GenUiScalar = z.infer<typeof GenUiScalarSchema>;
export type GenUiSection = z.infer<typeof GenUiSectionSchema>;
export type GenUiCitation = z.infer<typeof GenUiCitationSchema>;
export type GenUiAction = z.infer<typeof GenUiActionSchema>;
export type GenUiMetadata = z.infer<typeof GenUiMetadataSchema>;
export type GenUiEnvelopeV1 = z.infer<typeof GenUiEnvelopeV1Schema>;

export function parseGenUiEnvelope(value: unknown): GenUiEnvelopeV1 {
  return GenUiEnvelopeV1Schema.parse(value);
}
