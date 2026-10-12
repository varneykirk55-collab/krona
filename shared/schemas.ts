import { z } from 'zod';

// Zod 4 defaults apply inside optional fields; strip them for PATCH so omitted
// fields never silently reset existing data.
type OptionalShape<T extends z.ZodRawShape> = { [K in keyof T]: z.ZodOptional<T[K] extends z.ZodDefault<infer U> ? U : T[K]> };
function patchSchema<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape = Object.fromEntries(Object.entries(schema.shape).map(([k,v]) => [k, ((v instanceof z.ZodDefault ? v.removeDefault() : v) as z.ZodType).optional()]));
  return z.object(shape as unknown as OptionalShape<T>).strict();
}

export const uuid = z.string().uuid();
export const isoDate = z.string().datetime({ offset: true });
export const timezone = z.string().max(80).refine(v => {
  try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; }
}, 'Use an IANA timezone, for example America/New_York');
export const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm in 24-hour time');
export const phoneNumber = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use an international E.164 number, e.g. +12125551234');
export const taskStatus = z.enum(['not_started', 'in_progress', 'blocked', 'waiting', 'completed', 'canceled']);
export const priority = z.enum(['urgent', 'high', 'normal', 'low']);
export const recurrence = z.object({ frequency: z.enum(['daily', 'weekdays', 'weekly', 'monthly']), interval: z.number().int().min(1).max(365).default(1), timezone: timezone.default('America/New_York') }).strict();
export const taskInput = z.object({
  title: z.string().trim().min(1).max(240), description: z.string().max(10000).default(''),
  project_id: uuid.nullable().default(null), priority: priority.default('normal'),
  status: taskStatus.default('not_started'), due_at: isoDate.nullable().default(null),
  notes: z.string().max(10000).default(''), dependencies: z.array(uuid).max(100).default([]),
  recurrence: recurrence.nullable().default(null)
}).strict();
export const taskPatch = patchSchema(taskInput);
export const milestone = z.object({ id: uuid, title: z.string().trim().min(1).max(400), completed: z.boolean() });
export const projectInput = z.object({
  name: z.string().trim().min(1).max(240), description: z.string().max(10000).default(''),
  objectives: z.array(z.string().max(1000)).max(50).default([]),
  status: z.enum(['active', 'paused', 'completed', 'archived']).default('active'),
  progress: z.number().int().min(0).max(100).default(0),
  milestones: z.array(milestone).max(100).default([]), blockers: z.array(z.string().max(1000)).max(50).default([]),
  decisions: z.array(z.object({ text: z.string().max(2000), at: isoDate })).max(100).default([]),
  next_action: z.string().max(2000).default('')
}).strict();
export const projectPatch = patchSchema(projectInput);
export const memoryCategory = z.enum(['preferences', 'knowledge', 'projects', 'routines']);
export const memoryConfidence = z.enum(['confirmed', 'user_provided', 'interpretation', 'unverified', 'outdated', 'conflicted']);
export const memoryInput = z.object({
  content: z.string().trim().min(1).max(6000), category: memoryCategory.default('knowledge'),
  confidence: memoryConfidence.default('user_provided'), subject: z.string().trim().max(240).default(''),
  project_id: uuid.nullable().default(null), sensitive: z.boolean().default(false),
  source: z.string().max(200).default('owner')
}).strict();
export const memoryPatch = patchSchema(memoryInput.omit({ source: true }));
export const scheduleInput = z.object({
  title: z.string().trim().min(1).max(240), purpose: z.string().max(4000).default(''),
  task_id: uuid.nullable().default(null), project_id: uuid.nullable().default(null),
  recurrence: z.enum(['once', 'daily', 'weekdays', 'weekly']).default('once'),
  timezone: timezone.default('America/New_York'), local_time: clock.default('09:00'),
  day_of_week: z.number().int().min(1).max(7).default(1),
  next_run_at: isoDate, enabled: z.boolean().default(true)
}).strict();
export const schedulePatch = patchSchema(scheduleInput);
export const settingsSchema = z.object({
  timezone: timezone.default('America/New_York'), phone_number: phoneNumber.nullable().default(null),
  outbound_enabled: z.boolean().default(false), daily_call_limit: z.number().int().min(1).max(10).default(1),
  max_call_minutes: z.number().int().min(1).max(30).default(10), concurrent_call_limit: z.number().int().min(1).max(3).default(1),
  quiet_start: clock.default('21:00'), quiet_end: clock.default('08:00'),
  paused_until: isoDate.nullable().default(null),
  daily_spend_limit_usd: z.number().min(0).max(1000).default(5),
  daily_ai_request_limit: z.number().int().min(1).max(10000).default(200),
  daily_ai_token_limit: z.number().int().min(100).max(10000000).default(100000),
  disabled_memory_categories: z.array(memoryCategory).max(4).default([]),
  retain_transcripts: z.boolean().default(false), summarize_conversations: z.boolean().default(true),
  conversation_retention_days: z.number().int().min(1).max(365).default(90),
  voice: z.enum(['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse']).default('marin'),
  communication_style: z.string().max(2000).default('Calm, direct, conversational. Help me find a manageable next step without nagging.'),
  theme: z.enum(['light', 'dark', 'system']).default('light')
}).strict();
export const settingsPatch = patchSchema(settingsSchema).extend({ consent_to_outbound: z.boolean().optional() });
export type Settings = z.infer<typeof settingsSchema>;
export type TaskInput = z.infer<typeof taskInput>;
export type ProjectInput = z.infer<typeof projectInput>;
export type MemoryInput = z.infer<typeof memoryInput>;
export type ScheduleInput = z.infer<typeof scheduleInput>;
export type Task = TaskInput & { id: string; owner_id: string; created_at: string; updated_at: string; completed_at: string | null; conversation_id: string | null; next_instance_id: string | null };
export type Project = ProjectInput & { id: string; created_at: string; updated_at: string; task_count?: number; completed_task_count?: number };
export type Memory = MemoryInput & { id: string; created_at: string; updated_at: string; conflict_group: string | null; conversation_id: string | null };
export type Schedule = ScheduleInput & { id: string; version: number; created_at: string; updated_at: string };
export interface Owner { id: string; display_name: string; email: string; phone_verified: boolean; has_phone_pin: boolean }
export interface CallRecord { id: string; direction: string; status: string; started_at: string | null; ended_at: string | null; duration_seconds: number | null; outcome: string | null; created_at: string; summary?: string; estimated_cost_usd: number | null }
export interface Conversation { id: string; channel: string; started_at: string; ended_at: string | null; summary: string; status: string; messages?: { role: string; content: string; created_at: string }[] }
export interface Activity { id: string; action: string; entity_type: string | null; created_at: string; detail: Record<string, unknown> }
export interface ServiceStatus { state: 'healthy' | 'configured' | 'unconfigured' | 'disabled' | 'degraded'; detail: string; last_verified_at?: string | null }
export interface SystemStatus { database: ServiceStatus; ai: ServiceStatus; telephony: ServiceStatus; scheduler: ServiceStatus; mode: string; live_calling_enabled: boolean; live_ai_enabled: boolean }
