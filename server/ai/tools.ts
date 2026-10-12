import { boundToolData } from './bounds.js';
import { z } from 'zod';
import { DateTime } from 'luxon';
import type { Database } from '../db/database.js';
import { assert } from '../errors.js';
import { sha256 } from '../security.js';
import { Store } from '../services/store.js';
import { Actions, actionProposal, canonical } from '../services/actions.js';
import {
  taskInput,
  taskPatch,
  projectInput,
  projectPatch,
  memoryInput,
  scheduleInput,
  schedulePatch,
  uuid,
  isoDate,
} from '../../shared/schemas.js';
export interface ToolContext {
  ownerId: string;
  conversationId: string;
  channel: 'text' | 'phone' | 'browser';
  assurance: 'dashboard' | 'phone_pin' | 'none';
}
interface Tool {
  name: string;
  description: string;
  schema: z.ZodType;
  run: (db: Database, ctx: ToolContext, args: any) => Promise<unknown>;
}
const tools: Tool[] = [
  {
    name: 'list_tasks',
    description:
      'Retrieve actual tasks, statuses, dates and dependencies. Use these IDs; clarify ambiguous references instead of guessing.',
    schema: z
      .object({
        query: z.string().max(240).optional(),
        status: z.string().max(30).optional(),
        project_id: uuid.optional(),
      })
      .strict(),
    run: (db, c, a) =>
      new Store(db).listTasks(c.ownerId, {
        q: a.query,
        status: a.status,
        project_id: a.project_id,
        limit: 40,
      }),
  },
  {
    name: 'create_task',
    description:
      'Create a task only when the owner requests or agrees to it. ISO due dates must use the owner timezone. Success means it is persisted.',
    schema: taskInput,
    run: (db, c, a) => new Store(db).createTask(c.ownerId, a, c.conversationId),
  },
  {
    name: 'update_task',
    description:
      'Update an existing task using its retrieved UUID. Never mark a task complete without owner confirmation.',
    schema: z.object({ id: uuid, changes: taskPatch }).strict(),
    run: (db, c, a) => new Store(db).updateTask(c.ownerId, a.id, a.changes, c.conversationId),
  },
  {
    name: 'list_projects',
    description:
      'Retrieve verified project records including milestones, blockers, decisions and next actions.',
    schema: z.object({ query: z.string().max(240).optional() }).strict(),
    run: (db, c, a) => new Store(db).listProjects(c.ownerId, a.query),
  },
  {
    name: 'project_context',
    description:
      'Retrieve actual project tasks and linked conversation summaries. Summaries are interpretations, not confirmed progress. Use a retrieved project UUID.',
    schema: z.object({ id: uuid }).strict(),
    run: (db, c, a) => new Store(db).projectContext(c.ownerId, a.id),
  },
  {
    name: 'create_project',
    description:
      'Create an explicitly requested project. Do not invent completed milestones or progress.',
    schema: projectInput,
    run: (db, c, a) => new Store(db).createProject(c.ownerId, a, c.conversationId),
  },
  {
    name: 'update_project',
    description:
      'Save project changes the owner actually reports or authorizes. No speculative progress.',
    schema: z.object({ id: uuid, changes: projectPatch }).strict(),
    run: (db, c, a) => new Store(db).updateProject(c.ownerId, a.id, a.changes, c.conversationId),
  },
  {
    name: 'search_memory',
    description:
      'Retrieve relevant persisted memories, preserving confidence labels. Conflicts are not verified facts.',
    schema: z.object({ query: z.string().min(1).max(500) }).strict(),
    run: (db, c, a) => new Store(db).retrieveMemory(c.ownerId, a.query, true, 20),
  },
  {
    name: 'remember',
    description:
      'Save information the owner explicitly wants remembered. Never store secrets or treat interpretations as facts. Subject is a specific fact key, not a broad topic. Contradictions are flagged.',
    schema: memoryInput.omit({ source: true }).extend({
      confidence: z
        .enum(['user_provided', 'interpretation', 'unverified'])
        .default('user_provided'),
    }),
    run: (db, c, a) =>
      new Store(db).createMemory(c.ownerId, { ...a, source: 'conversation' }, c.conversationId),
  },
  {
    name: 'list_checkins',
    description:
      'Retrieve actual scheduled owner check-ins. Outbound enablement requires separate dashboard consent.',
    schema: z.object({}).strict(),
    run: (db, c) => new Store(db).listSchedules(c.ownerId),
  },
  {
    name: 'create_checkin',
    description:
      'Schedule an owner-requested follow-up call. This does NOT enable outbound calling. Use timezone-aware ISO timestamps; ask if the intended time is genuinely ambiguous.',
    schema: scheduleInput,
    run: (db, c, a) => new Store(db).createSchedule(c.ownerId, a),
  },
  {
    name: 'reschedule_checkin',
    description:
      'Change a retrieved check-in, canceling its old durable job. Set enabled=false to stop this check-in.',
    schema: z.object({ id: uuid, changes: schedulePatch }).strict(),
    run: (db, c, a) => new Store(db).updateSchedule(c.ownerId, a.id, a.changes),
  },
  {
    name: 'checkin_control',
    description:
      'Honor explicit commands to stop calls today, pause for a week, pause until a time, resume, reduce the daily call limit, or stop checking on a project. Never enables outgoing calls.',
    schema: z
      .object({
        operation: z.enum([
          'pause_today',
          'pause_week',
          'pause_until',
          'resume',
          'limit_daily',
          'cancel_project',
        ]),
        until: isoDate.optional(),
        daily_limit: z.number().int().min(1).max(10).optional(),
        project_id: uuid.optional(),
      })
      .strict(),
    run: async (db, c, a) => {
      const s = new Store(db),
        settings = await s.settings(c.ownerId),
        now = DateTime.now().setZone(settings.timezone);
      if (a.operation === 'cancel_project') {
        assert(
          a.project_id,
          400,
          'PROJECT_REQUIRED',
          'Which project should stop receiving check-ins?',
        );
        await s.owned('projects', c.ownerId, a.project_id);
        await s.cancelLinkedSchedules(c.ownerId, 'project_id', a.project_id);
      } else {
        if (a.operation === 'pause_today')
          settings.paused_until = now.plus({ days: 1 }).startOf('day').toUTC().toISO();
        if (a.operation === 'pause_week')
          settings.paused_until = now.plus({ weeks: 1 }).toUTC().toISO();
        if (a.operation === 'pause_until') {
          assert(a.until, 400, 'TIME_REQUIRED', 'Specify when check-ins may resume.');
          assert(
            new Date(a.until) > new Date(),
            400,
            'PAST_TIME',
            'The pause must end in the future.',
          );
          settings.paused_until = a.until;
        }
        if (a.operation === 'resume') settings.paused_until = null;
        if (a.operation === 'limit_daily') {
          assert(a.daily_limit, 400, 'LIMIT_REQUIRED', 'Specify the daily call limit.');
          settings.daily_call_limit = Math.min(settings.daily_call_limit, a.daily_limit);
        }
        await db.query('UPDATE owners SET settings=$1::jsonb WHERE id=$2', [
          JSON.stringify(settings),
          c.ownerId,
        ]);
      }
      await s.audit(c.ownerId, 'schedule.preferences_updated', 'settings', null, {
        operation: a.operation,
      });
      return {
        saved: true,
        operation: a.operation,
        paused_until: settings.paused_until,
        daily_call_limit: settings.daily_call_limit,
        outbound_enabled: settings.outbound_enabled,
      };
    },
  },
  {
    name: 'propose_action',
    description:
      'Prepare an external action for explicit dashboard approval. This NEVER sends, calls, books, commits or spends. External executors are disabled until legally reviewed and configured.',
    schema: actionProposal,
    run: (db, c, a) => new Actions(db).propose(c.ownerId, a),
  },
];
export const toolDefinitions = tools.map((t) => ({
  type: 'function' as const,
  name: t.name,
  description: t.description,
  parameters: z.toJSONSchema(t.schema, { target: 'draft-7', io: 'input' }) as Record<
    string,
    unknown
  >,
}));
export async function executeTool(
  db: Database,
  context: ToolContext,
  name: string,
  raw: unknown,
  providerCallId: string,
): Promise<unknown> {
  assert(
    context.assurance === 'dashboard' || context.assurance === 'phone_pin',
    403,
    'CALLER_AUTH_REQUIRED',
    'Authenticate before accessing private information or changing records.',
  );
  assert(
    /^[\w-]{1,200}$/.test(providerCallId),
    400,
    'INVALID_TOOL_CALL',
    'Invalid provider tool call ID.',
  );
  const tool = tools.find((t) => t.name === name);
  assert(tool, 400, 'UNKNOWN_TOOL', 'The requested tool is not available.');
  const args = tool.schema.parse(raw),
    requestHash = sha256(canonical({ name, args }));
  return db.transaction(async (tx) => {
    await tx.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [context.ownerId]);
    const store = new Store(tx);
    await store.owned('conversations', context.ownerId, context.conversationId, true);
    const previous = (
      await tx.query(
        'SELECT * FROM tool_executions WHERE conversation_id=$1 AND call_id=$2 AND owner_id=$3',
        [context.conversationId, providerCallId, context.ownerId],
      )
    ).rows[0];
    if (previous) {
      assert(
        previous.request_hash === requestHash,
        409,
        'IDEMPOTENCY_CONFLICT',
        'A repeated tool ID has different arguments.',
      );
      return previous.result;
    }
    const result = await tool.run(tx, context, args);
    const output = { ok: true, ...boundToolData(result) };
    await tx.query(
      'INSERT INTO tool_executions(conversation_id,call_id,owner_id,request_hash,result) VALUES($1,$2,$3,$4,$5::jsonb)',
      [
        context.conversationId,
        providerCallId,
        context.ownerId,
        requestHash,
        JSON.stringify(output),
      ],
    );
    return output;
  });
}
