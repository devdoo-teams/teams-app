import { z } from 'zod';

import {
  RESPONSE_MODES,
  ResponseModeAvailabilitySchema,
  ResponseModeSchema,
  type ResponseMode,
} from './response-mode.js';

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

export const GENUI_STATUSES = [
  'loading',
  'ready',
  'empty',
  'error',
  'approval',
  'complete',
] as const;

export const GENUI_SECTION_TYPES = [
  'text',
  'facts',
  'stats',
  'weather',
  'list',
  'progress',
  'status',
] as const;

export const GENUI_ACTIONS = [
  'approve',
  'cancel',
  'refresh',
  'retry',
  'open-tab',
  'feedback',
] as const;

/** Commands exposed as safe, payload-free quick actions on the help card. */
export const GENUI_COMMANDS = ['help', 'weather', 'status', 'list', 'work', 'collaboration'] as const;

export const GENUI_ACTION_PAYLOAD_KEYS = [
  'schemaVersion',
  'action',
  'entityId',
  'correlationId',
  'actionToken',
] as const;

export const GenUiKindSchema = z.enum(GENUI_KINDS);
export const GenUiStateSchema = z.enum(GENUI_STATUSES);
export const GenUiSectionTypeSchema = z.enum(GENUI_SECTION_TYPES);
const GENUI_ACTION_NAMES = [...GENUI_ACTIONS, 'command'] as const;
export const GenUiActionNameSchema = z.enum(GENUI_ACTION_NAMES);
export const GenUiToneSchema = z.enum(['neutral', 'info', 'success', 'warning', 'danger']);
export const GenUiActionStyleSchema = z.enum(['default', 'positive', 'destructive']);

/**
 * Public, provider-neutral response mode state. This is optional because a
 * generic MCP host has no Teams identity and must not call the Teams-only
 * response-mode API to discover it.
 */
export const GenUiResponseModeSchema = z.object({
  mode: ResponseModeSchema,
  label: z.string().min(1).max(80),
  configured: z.boolean(),
  availability: z.array(ResponseModeAvailabilitySchema).max(RESPONSE_MODES.length),
}).strict();

export const GenUiScalarSchema = z.union([
  z.string().max(2_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const SectionBaseSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  label: z.string().min(1).max(200).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2_000).optional(),
  status: z.string().min(1).max(120).optional(),
  tone: GenUiToneSchema.optional(),
}).strict();

export const GenUiItemSchema = z.object({
  id: z.union([z.string().min(1).max(120), z.number().int()]).optional(),
  label: z.string().min(1).max(400),
  value: GenUiScalarSchema.optional(),
  description: z.string().max(2_000).optional(),
  status: z.string().min(1).max(120).optional(),
  tone: GenUiToneSchema.optional(),
}).strict();

export const GenUiFactSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  label: z.string().min(1).max(200),
  value: GenUiScalarSchema,
  unit: z.string().max(40).optional(),
  description: z.string().max(500).optional(),
}).strict();

export const GenUiImageSchema = z.object({
  url: z.string().url().max(2_048).refine((value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'image URL must use https'),
  altText: z.string().min(1).max(400).optional(),
}).strict();

const GenUiTextSectionSchema = SectionBaseSchema.extend({
  type: z.literal('text'),
  text: z.string().max(4_000).optional(),
  content: z.string().max(4_000).optional(),
  value: GenUiScalarSchema.optional(),
}).strict();

const GenUiFactsSectionSchema = SectionBaseSchema.extend({
  type: z.literal('facts'),
  facts: z.array(GenUiFactSchema).max(24).optional(),
  value: GenUiScalarSchema.optional(),
}).strict();

const GenUiStatsSectionSchema = SectionBaseSchema.extend({
  type: z.literal('stats'),
  stats: z.array(GenUiFactSchema).max(24),
}).strict();

const GenUiWeatherSectionSchema = SectionBaseSchema.extend({
  type: z.literal('weather'),
  location: z.string().max(200).optional(),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
  timezone: z.string().max(120).optional(),
  temperature: z.number().finite().optional(),
  apparentTemperature: z.number().finite().optional(),
  humidity: z.number().finite().min(0).max(100).optional(),
  windSpeed: z.number().finite().min(0).optional(),
  precipitation: z.number().finite().min(0).optional(),
  condition: z.string().max(120).optional(),
  icon: z.string().max(40).optional(),
  source: z.string().max(120).optional(),
  observedAt: z.string().max(120).optional(),
}).strict();

const GenUiListSectionSchema = SectionBaseSchema.extend({
  type: z.literal('list'),
  items: z.array(GenUiItemSchema).max(24),
}).strict();

const GenUiProgressSectionSchema = SectionBaseSchema.extend({
  type: z.literal('progress'),
  progress: z.number().finite().min(0).max(100),
}).strict();

const GenUiStatusSectionSchema = SectionBaseSchema.extend({
  type: z.literal('status'),
  status: z.string().min(1).max(120),
}).strict();

export const GenUiSectionSchema = z.union([
  GenUiTextSectionSchema,
  GenUiFactsSectionSchema,
  GenUiStatsSectionSchema,
  GenUiWeatherSectionSchema,
  GenUiListSectionSchema,
  GenUiProgressSectionSchema,
  GenUiStatusSectionSchema,
]);

export const GenUiCitationSchema = z.object({
  title: z.string().min(1).max(200),
  url: z.string().url().max(2_048).refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }, 'citation URL must use http or https'),
  snippet: z.string().max(500).optional(),
}).strict();

export const GenUiActionSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  action: GenUiActionNameSchema,
  label: z.string().min(1).max(80),
  entityId: z.string().min(1).max(200),
  correlationId: z.string().min(1).max(200),
  actionToken: z.string().min(1).max(512),
  style: GenUiActionStyleSchema.default('default'),
}).strict();

export const GenUiMetadataSchema = z.record(
  z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/),
  GenUiScalarSchema,
).refine((value) => Object.keys(value).length <= 16, {
  message: 'metadata supports at most 16 keys',
});

export const GenUiEnvelopeV1BaseSchema = z.object({
  schemaVersion: z.literal(GENUI_SCHEMA_VERSION),
  kind: GenUiKindSchema,
  status: GenUiStateSchema.default('ready'),
  id: z.string().min(1).max(200),
  correlationId: z.string().min(1).max(200),
  title: z.string().max(240).optional(),
  summary: z.string().max(2_000).optional(),
  prompt: z.string().max(2_000).optional(),
  sections: z.array(GenUiSectionSchema).max(32).default([]),
  actions: z.array(GenUiActionSchema).max(8).default([]),
  citations: z.array(GenUiCitationSchema).max(8).default([]),
  images: z.array(GenUiImageSchema).max(6).default([]),
  aiGenerated: z.boolean().default(false),
  fallbackText: z.string().min(1).max(4_000).optional(),
  metadata: GenUiMetadataSchema.default({}),
  responseMode: GenUiResponseModeSchema.optional(),
}).strict();

export const GenUiEnvelopeV1Schema = GenUiEnvelopeV1BaseSchema.superRefine((value, context) => {
  if (!value.aiGenerated && value.citations.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['citations'],
      message: 'citations require aiGenerated=true',
    });
  }
  if (!value.aiGenerated && value.actions.some((action) => action.action === 'feedback')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['actions'],
      message: 'feedback actions require aiGenerated=true',
    });
  }
});

// Keep the MCP tool output schema as a plain ZodObject. Semantic and
// cross-field validation remains in GenUiEnvelopeV1Schema.parse/safeParse;
// MCP's tool registration only needs the object shape for JSON Schema export.

export type GenUiKind = z.infer<typeof GenUiKindSchema>;
export type GenUiState = z.infer<typeof GenUiStateSchema>;
export type GenUiSectionType = z.infer<typeof GenUiSectionTypeSchema>;
export type GenUiTone = z.infer<typeof GenUiToneSchema>;
export type GenUiActionStyle = z.infer<typeof GenUiActionStyleSchema>;
export type GenUiActionName = z.infer<typeof GenUiActionNameSchema>;
export type GenUiResponseMode = z.infer<typeof GenUiResponseModeSchema>;
export type GenUiScalar = z.infer<typeof GenUiScalarSchema>;
export type GenUiItem = z.infer<typeof GenUiItemSchema>;
export type GenUiFact = z.infer<typeof GenUiFactSchema>;
export type GenUiImage = z.infer<typeof GenUiImageSchema>;
export type GenUiSection = z.infer<typeof GenUiSectionSchema>;
export type GenUiCitation = z.infer<typeof GenUiCitationSchema>;
export type GenUiAction = z.infer<typeof GenUiActionSchema>;
export type GenUiMetadata = z.infer<typeof GenUiMetadataSchema>;
export type GenUiEnvelopeV1 = z.infer<typeof GenUiEnvelopeV1Schema>;

export type GenUiResponseModeName = ResponseMode;

export function parseGenUiEnvelope(value: unknown): GenUiEnvelopeV1 {
  return GenUiEnvelopeV1Schema.parse(value);
}

export function isSafeGenUiUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
