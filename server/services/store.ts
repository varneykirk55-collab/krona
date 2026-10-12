import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type { Database } from '../db/database.js';
import { assert } from '../errors.js';
import { sha256 } from '../security.js';
import { iso } from './time.js';
import { rejectCredentials, redactCredentials } from './privacy.js';
import {
  memoryInput,
  memoryPatch,
  projectInput,
  projectPatch,
  scheduleInput,
  schedulePatch,
  settingsSchema,
  taskInput,
  taskPatch,
  type Settings,
  type Task,
  type Memory,
  type Schedule,
} from '../../shared/schemas.js';
const jsonColumns = new Set(['objectives', 'milestones', 'blockers', 'decisions', 'recurrence']);
const isJson = (table: string, key: string) =>
  jsonColumns.has(key) && !(table === 'schedules' && key === 'recurrence');
function pick(row: Record<string, any>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, row[k]]));
}
function normalize(row: any): any {
  if (row instanceof Date) return row.toISOString();
  if (Array.isArray(row)) return row.map(normalize);
  if (row && typeof row === 'object')
    return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, normalize(v)]));
  return row;
}
const escapeLike = (q: string) => q.replace(/[\\%_]/g, '\\$&');
const taskFields = Object.keys(taskInput.shape).filter((k) => k !== 'dependencies');
const projectFields = Object.keys(projectInput.shape);
const scheduleFields = Object.keys(scheduleInput.shape);
export class Store {
  constructor(public db: Database) {}
  async settings(ownerId: string): Promise<Settings> {
    const row = (await this.db.query('SELECT settings FROM owners WHERE id=$1', [ownerId])).rows[0];
    assert(row, 404, 'OWNER_NOT_FOUND', 'Owner account not found.');
    return settingsSchema.parse(row.settings);
  }
  async audit(
    ownerId: string,
    action: string,
    entityType: string | null = null,
    entityId: string | null = null,
    detail: Record<string, unknown> = {},
  ) {
    // Only operation metadata; never conversation content, PINs, tokens or memory text.
    await this.db.query(
      'INSERT INTO audit_logs(id,owner_id,action,entity_type,entity_id,detail) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
      [randomUUID(), ownerId, action, entityType, entityId, JSON.stringify(detail)],
    );
  }
  async owned(
    table: 'tasks' | 'projects' | 'memories' | 'schedules' | 'conversations' | 'calls' | 'actions',
    ownerId: string,
    id: string,
    lock = false,
  ) {
    const row = (
      await this.db.query(
        `SELECT * FROM ${table} WHERE id=$1 AND owner_id=$2 ${lock ? 'FOR UPDATE' : ''}`,
        [id, ownerId],
      )
    ).rows[0];
    assert(row, 404, 'NOT_FOUND', 'The requested record was not found.');
    return normalize(row);
  }
  async insert(
    table: string,
    ownerId: string,
    values: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) {
    const id = randomUUID(),
      record = { id, owner_id: ownerId, ...values, ...extra };
    const keys = Object.keys(record),
      params = Object.entries(record).map(([k, v]) =>
        isJson(table, k) && v !== null ? JSON.stringify(v) : v,
      );
    const sql = `INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((k, i) => '$' + (i + 1) + (isJson(table, k) ? '::jsonb' : '')).join(',')}) RETURNING *`;
    return normalize((await this.db.query(sql, params)).rows[0]);
  }
  async update(table: string, ownerId: string, id: string, values: Record<string, unknown>) {
    const keys = Object.keys(values);
    assert(keys.length, 400, 'EMPTY_UPDATE', 'There are no changes to save.');
    const params = Object.entries(values).map(([k, v]) =>
      isJson(table, k) && v !== null ? JSON.stringify(v) : v,
    );
    params.push(id, ownerId);
    const row = (
      await this.db.query(
        `UPDATE ${table} SET ${keys.map((k, i) => `${k}=$${i + 1}${isJson(table, k) ? '::jsonb' : ''}`).join(',')},updated_at=now() WHERE id=$${keys.length + 1} AND owner_id=$${keys.length + 2} RETURNING *`,
        params,
      )
    ).rows[0];
    assert(row, 404, 'NOT_FOUND', 'The requested record was not found.');
    return normalize(row);
  }
  async listTasks(
    ownerId: string,
    options: {
      q?: string;
      status?: string;
      priority?: string;
      project_id?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<Task[]> {
    const r = await this.db.query(
      `SELECT t.*, ARRAY(SELECT depends_on FROM task_dependencies d WHERE d.task_id=t.id AND d.owner_id=t.owner_id) AS dependencies FROM tasks t
      WHERE t.owner_id=$1 AND ($2::text IS NULL OR t.title ILIKE $2 OR t.description ILIKE $2)
      AND ($3::text IS NULL OR t.status=$3) AND ($4::uuid IS NULL OR t.project_id=$4) AND ($7::text IS NULL OR t.priority=$7)
      ORDER BY CASE t.status WHEN 'completed' THEN 1 WHEN 'canceled' THEN 2 ELSE 0 END,
      CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.due_at NULLS LAST,t.created_at DESC LIMIT $5 OFFSET $6`,
      [
        ownerId,
        options.q ? `%${escapeLike(options.q)}%` : null,
        options.status || null,
        options.project_id || null,
        options.limit || 200,
        options.offset || 0,
        options.priority || null,
      ],
    );
    return normalize(r.rows);
  }
  async getTask(ownerId: string, id: string): Promise<Task> {
    const row = await this.owned('tasks', ownerId, id);
    row.dependencies = (
      await this.db.query(
        'SELECT depends_on FROM task_dependencies WHERE task_id=$1 AND owner_id=$2',
        [id, ownerId],
      )
    ).rows.map((r) => r.depends_on);
    return row;
  }
  async setDependencies(ownerId: string, taskId: string, deps: string[]) {
    assert(!deps.includes(taskId), 400, 'DEPENDENCY_CYCLE', 'A task cannot depend on itself.');
    for (const dep of [...new Set(deps)]) {
      await this.owned('tasks', ownerId, dep);
      const cycle = await this.db.query(
        `WITH RECURSIVE ancestors(id) AS (SELECT depends_on FROM task_dependencies WHERE task_id=$1 AND owner_id=$3 UNION SELECT d.depends_on FROM task_dependencies d JOIN ancestors a ON a.id=d.task_id WHERE d.owner_id=$3) SELECT id FROM ancestors WHERE id=$2`,
        [dep, taskId, ownerId],
      );
      assert(!cycle.rows.length, 400, 'DEPENDENCY_CYCLE', 'This dependency would create a cycle.');
    }
    await this.db.query('DELETE FROM task_dependencies WHERE task_id=$1 AND owner_id=$2', [
      taskId,
      ownerId,
    ]);
    for (const dep of [...new Set(deps)])
      await this.db.query(
        'INSERT INTO task_dependencies(task_id,depends_on,owner_id) VALUES($1,$2,$3)',
        [taskId, dep, ownerId],
      );
  }
  async linkConversation(
    ownerId: string,
    conversationId: string,
    taskId: string | null = null,
    projectId: string | null = null,
  ) {
    await this.owned('conversations', ownerId, conversationId);
    if (taskId) {
      await this.owned('tasks', ownerId, taskId);
      await this.db.query(
        'INSERT INTO task_conversations(task_id,conversation_id,owner_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [taskId, conversationId, ownerId],
      );
    }
    if (projectId) {
      await this.owned('projects', ownerId, projectId);
      await this.db.query(
        'INSERT INTO project_conversations(project_id,conversation_id,owner_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [projectId, conversationId, ownerId],
      );
    }
  }
  async projectContext(ownerId: string, id: string) {
    const project = await this.owned('projects', ownerId, id);
    const conversations = normalize(
      (
        await this.db.query(
          'SELECT c.id,c.channel,c.started_at,c.summary,c.summary_confidence FROM conversations c JOIN project_conversations pc ON pc.conversation_id=c.id WHERE pc.project_id=$1 AND pc.owner_id=$2 AND c.owner_id=$2 ORDER BY c.started_at DESC LIMIT 20',
          [id, ownerId],
        )
      ).rows,
    );
    return {
      project,
      tasks: await this.listTasks(ownerId, { project_id: id, limit: 100 }),
      conversations,
    };
  }
  async createTask(
    ownerId: string,
    raw: unknown,
    conversationId: string | null = null,
  ): Promise<Task> {
    const input = taskInput.parse(raw);
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [ownerId]);
      const s = new Store(tx);
      if (input.project_id) await s.owned('projects', ownerId, input.project_id);
      if (conversationId) await s.owned('conversations', ownerId, conversationId);
      const task = await s.insert('tasks', ownerId, pick(input, taskFields), {
        conversation_id: conversationId,
        completed_at: input.status === 'completed' ? new Date().toISOString() : null,
      });
      await s.setDependencies(ownerId, task.id, input.dependencies);
      if (conversationId)
        await s.linkConversation(ownerId, conversationId, task.id, input.project_id);
      await s.audit(ownerId, 'task.created', 'task', task.id);
      return { ...task, dependencies: input.dependencies };
    });
  }
  async updateTask(
    ownerId: string,
    id: string,
    raw: unknown,
    conversationId: string | null = null,
  ): Promise<Task> {
    const patch = taskPatch.parse(raw);
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [ownerId]);
      const s = new Store(tx),
        existing = await s.owned('tasks', ownerId, id, true);
      if (patch.project_id) await s.owned('projects', ownerId, patch.project_id);
      if (patch.dependencies) await s.setDependencies(ownerId, id, patch.dependencies);
      const values: any = { ...patch };
      delete values.dependencies;
      if (patch.status === 'completed') {
        const unmet = await tx.query(
          "SELECT t.id FROM task_dependencies d JOIN tasks t ON t.id=d.depends_on WHERE d.task_id=$1 AND d.owner_id=$2 AND t.status NOT IN ('completed','canceled')",
          [id, ownerId],
        );
        assert(
          !unmet.rows.length,
          409,
          'UNFINISHED_DEPENDENCIES',
          'Complete or remove unfinished dependencies first.',
        );
        values.completed_at = existing.completed_at || new Date().toISOString();
      } else if (patch.status) values.completed_at = null;
      if (Object.keys(values).length) await s.update('tasks', ownerId, id, values);
      if (patch.status === 'completed' || patch.status === 'canceled') {
        await s.cancelLinkedSchedules(ownerId, 'task_id', id);
        const current = await s.owned('tasks', ownerId, id);
        if (
          patch.status === 'completed' &&
          existing.status !== 'completed' &&
          current.recurrence &&
          !current.next_instance_id
        ) {
          const rule = current.recurrence,
            base = DateTime.fromISO(current.due_at || new Date().toISOString(), {
              zone: rule.timezone,
            });
          let next = base.plus(
            rule.frequency === 'weekly'
              ? { weeks: rule.interval }
              : rule.frequency === 'monthly'
                ? { months: rule.interval }
                : { days: rule.interval },
          );
          if (rule.frequency === 'weekdays') while (next.weekday > 5) next = next.plus({ days: 1 });
          const child = await s.createTask(ownerId, {
            ...pick(current, taskFields),
            status: 'not_started',
            due_at: next.toUTC().toISO(),
            dependencies: [],
          });
          await tx.query('UPDATE tasks SET next_instance_id=$1 WHERE id=$2 AND owner_id=$3', [
            child.id,
            id,
            ownerId,
          ]);
        }
      }
      if (conversationId)
        await s.linkConversation(
          ownerId,
          conversationId,
          id,
          (await s.owned('tasks', ownerId, id)).project_id,
        );
      await s.audit(ownerId, 'task.updated', 'task', id, {
        fields: Object.keys(patch),
        ...(patch.status ? { status: patch.status } : {}),
      });
      return s.getTask(ownerId, id);
    });
  }
  async deleteTask(ownerId: string, id: string) {
    await this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [ownerId]);
      const s = new Store(tx);
      await s.owned('tasks', ownerId, id);
      await s.cancelLinkedSchedules(ownerId, 'task_id', id);
      await tx.query('DELETE FROM tasks WHERE id=$1 AND owner_id=$2', [id, ownerId]);
      await s.audit(ownerId, 'task.deleted', 'task', id);
    });
  }
  async listProjects(ownerId: string, q = '') {
    return normalize(
      (
        await this.db.query(
          `SELECT p.*, (SELECT count(*)::int FROM tasks t WHERE t.project_id=p.id AND t.owner_id=p.owner_id) AS task_count,
      (SELECT count(*)::int FROM tasks t WHERE t.project_id=p.id AND t.owner_id=p.owner_id AND t.status='completed') AS completed_task_count
      FROM projects p WHERE p.owner_id=$1 AND ($2::text IS NULL OR p.name ILIKE $2 OR p.description ILIKE $2) ORDER BY p.updated_at DESC LIMIT 500`,
          [ownerId, q ? '%' + escapeLike(q) + '%' : null],
        )
      ).rows,
    );
  }
  async createProject(ownerId: string, raw: unknown, conversationId: string | null = null) {
    const input = projectInput.parse(raw);
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [ownerId]);
      const s = new Store(tx);
      const p = await s.insert('projects', ownerId, input);
      if (conversationId) await s.linkConversation(ownerId, conversationId, null, p.id);
      await s.audit(ownerId, 'project.created', 'project', p.id);
      return p;
    });
  }
  async updateProject(
    ownerId: string,
    id: string,
    raw: unknown,
    conversationId: string | null = null,
  ) {
    const patch = projectPatch.parse(raw);
    if (patch.status === 'completed') patch.progress = 100;
    else if (patch.milestones?.length)
      patch.progress = Math.round(
        (patch.milestones.filter((m) => m.completed).length / patch.milestones.length) * 100,
      );
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [ownerId]);
      const s = new Store(tx),
        p = await s.update('projects', ownerId, id, patch);
      if (patch.status === 'completed' || patch.status === 'archived')
        await s.cancelLinkedSchedules(ownerId, 'project_id', id);
      if (conversationId) await s.linkConversation(ownerId, conversationId, null, id);
      await s.audit(ownerId, 'project.updated', 'project', id, { fields: Object.keys(patch) });
      return p;
    });
  }
  async deleteProject(ownerId: string, id: string) {
    await this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [ownerId]);
      const s = new Store(tx);
      await s.owned('projects', ownerId, id);
      await s.cancelLinkedSchedules(ownerId, 'project_id', id);
      await tx.query('DELETE FROM projects WHERE id=$1 AND owner_id=$2', [id, ownerId]);
      await s.audit(ownerId, 'project.deleted', 'project', id);
    });
  }
  async listMemories(
    ownerId: string,
    q = '',
    limit = 200,
    category = '',
    offset = 0,
  ): Promise<Memory[]> {
    return normalize(
      (
        await this.db.query(
          `SELECT id,owner_id,content,category,confidence,subject,project_id,sensitive,source,conflict_group,conversation_id,created_at,updated_at FROM memories
      WHERE owner_id=$1 AND ($2::text IS NULL OR search_vector @@ plainto_tsquery('english',$2) OR content ILIKE $3 OR subject ILIKE $3)
      AND ($5::text IS NULL OR category=$5) ORDER BY updated_at DESC LIMIT $4 OFFSET $6`,
          [ownerId, q || null, `%${escapeLike(q)}%`, limit, category || null, offset],
        )
      ).rows,
    );
  }
  async retrieveMemory(
    ownerId: string,
    q: string,
    includeSensitive = false,
    limit = 12,
  ): Promise<Memory[]> {
    const settings = await this.settings(ownerId);
    // Natural questions contain words absent from the memory; OR lexical terms and rank
    // matches instead of requiring every word in a question to occur in the stored fact.
    const lexical = (q.match(/[\p{L}\p{N}]+/gu) || ['preferences']).slice(0, 30).join(' OR ');
    return normalize(
      (
        await this.db.query(
          `SELECT id,content,category,confidence,subject,project_id,source,updated_at,conflict_group,sensitive FROM memories
      WHERE owner_id=$1 AND NOT (category=ANY($3::text[])) AND confidence <> 'outdated'
      AND ($4 OR NOT sensitive) AND (search_vector @@ websearch_to_tsquery('english',$2) OR content ILIKE $5 OR category='preferences')
      ORDER BY ts_rank(search_vector,websearch_to_tsquery('english',$2)) DESC, updated_at DESC LIMIT $6`,
          [
            ownerId,
            lexical,
            settings.disabled_memory_categories,
            includeSensitive,
            `%${escapeLike(q || 'preferences')}%`,
            limit,
          ],
        )
      ).rows,
    );
  }
  async createMemory(
    ownerId: string,
    raw: unknown,
    conversationId: string | null = null,
  ): Promise<Memory & { deduplicated?: boolean }> {
    const input = memoryInput.parse(raw);
    rejectCredentials(JSON.stringify(input));
    const hash = sha256(input.content.toLowerCase().replace(/\s+/g, ' ').trim());
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [ownerId]);
      const s = new Store(tx),
        settings = await s.settings(ownerId);
      assert(
        !settings.disabled_memory_categories.includes(input.category),
        409,
        'MEMORY_DISABLED',
        'This memory category is disabled in your privacy settings.',
      );
      if (input.project_id) await s.owned('projects', ownerId, input.project_id);
      if (conversationId) await s.owned('conversations', ownerId, conversationId);
      const duplicate = (
        await tx.query(
          'SELECT * FROM memories WHERE owner_id=$1 AND canonical_hash=$2 AND category=$3',
          [ownerId, hash, input.category],
        )
      ).rows[0];
      if (duplicate) return { ...normalize(duplicate), deduplicated: true };
      // A subject is a specific fact key (e.g. preferred-contact-time), not a broad topic.
      const subject = input.subject.toLowerCase().replace(/\s+/g, ' ').trim();
      let conflictGroup: string | null = null;
      if (subject) {
        const previous = (
          await tx.query(
            "SELECT id,conflict_group FROM memories WHERE owner_id=$1 AND subject=$2 AND category=$3 AND confidence <> 'outdated' FOR UPDATE",
            [ownerId, subject, input.category],
          )
        ).rows;
        if (previous.length) {
          conflictGroup = previous[0].conflict_group || randomUUID();
          await tx.query(
            "UPDATE memories SET confidence='conflicted',conflict_group=$1,updated_at=now() WHERE owner_id=$2 AND subject=$3 AND category=$4 AND confidence <> 'outdated'",
            [conflictGroup, ownerId, subject, input.category],
          );
        }
      }
      const memory = await s.insert('memories', ownerId, {
        ...input,
        subject,
        confidence: conflictGroup ? 'conflicted' : input.confidence,
        canonical_hash: hash,
        conflict_group: conflictGroup,
        conversation_id: conversationId,
      });
      if (conversationId && input.project_id)
        await s.linkConversation(ownerId, conversationId, null, input.project_id);
      await s.audit(
        ownerId,
        conflictGroup ? 'memory.conflict_detected' : 'memory.created',
        'memory',
        memory.id,
      );
      return memory;
    });
  }
  async updateMemory(ownerId: string, id: string, raw: unknown) {
    const patch = memoryPatch.parse(raw);
    rejectCredentials(JSON.stringify(patch));
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [ownerId]);
      const s = new Store(tx),
        existing = await s.owned('memories', ownerId, id, true);
      if (patch.project_id) await s.owned('projects', ownerId, patch.project_id);
      const values: any = { ...patch };
      if (patch.sensitive === true) {
        values.embedding = null;
        values.embedding_model = null;
      }
      if (patch.subject !== undefined)
        values.subject = patch.subject.toLowerCase().replace(/\s+/g, ' ').trim();
      if (patch.content) {
        values.canonical_hash = sha256(patch.content.toLowerCase().replace(/\s+/g, ' ').trim());
        values.embedding = null;
        values.embedding_model = null;
      }
      if (patch.confidence === 'confirmed' && existing.conflict_group) {
        await tx.query(
          "UPDATE memories SET confidence='outdated',updated_at=now() WHERE owner_id=$1 AND conflict_group=$2 AND id<>$3",
          [ownerId, existing.conflict_group, id],
        );
        values.conflict_group = null;
      }
      const result = await s.update('memories', ownerId, id, values);
      await s.audit(ownerId, 'memory.corrected', 'memory', id);
      return result;
    });
  }
  async deleteMemory(ownerId: string, id: string) {
    await this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [ownerId]);
      const s = new Store(tx);
      await s.owned('memories', ownerId, id);
      await tx.query('DELETE FROM memories WHERE id=$1 AND owner_id=$2', [id, ownerId]);
      await s.audit(ownerId, 'memory.deleted', 'memory', id);
    });
  }
  async listSchedules(ownerId: string): Promise<Schedule[]> {
    return normalize(
      (
        await this.db.query(
          'SELECT * FROM schedules WHERE owner_id=$1 ORDER BY enabled DESC,next_run_at LIMIT 500',
          [ownerId],
        )
      ).rows,
    );
  }
  async enqueue(schedule: Schedule) {
    if (!schedule.enabled) return;
    await this.db.query(
      'INSERT INTO scheduled_jobs(id,owner_id,schedule_id,schedule_version,occurrence_at,run_at) VALUES($1,$2,$3,$4,$5,$5) ON CONFLICT(schedule_id,schedule_version,occurrence_at) DO NOTHING',
      [randomUUID(), schedule.owner_id, schedule.id, schedule.version, schedule.next_run_at],
    );
  }
  async createSchedule(ownerId: string, raw: unknown) {
    const input = scheduleInput.parse(raw);
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [ownerId]);
      const s = new Store(tx);
      if (input.task_id) await s.owned('tasks', ownerId, input.task_id);
      if (input.project_id) await s.owned('projects', ownerId, input.project_id);
      const schedule = await s.insert('schedules', ownerId, input);
      await s.enqueue(schedule);
      await s.audit(ownerId, 'schedule.created', 'schedule', schedule.id);
      return schedule;
    });
  }
  async updateSchedule(ownerId: string, id: string, raw: unknown) {
    const patch = schedulePatch.parse(raw);
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [ownerId]);
      const s = new Store(tx),
        existing = await s.owned('schedules', ownerId, id, true);
      if (patch.task_id) await s.owned('tasks', ownerId, patch.task_id);
      if (patch.project_id) await s.owned('projects', ownerId, patch.project_id);
      assert(
        !(
          await tx.query(
            "SELECT id FROM scheduled_jobs WHERE schedule_id=$1 AND status IN ('dispatching','unknown')",
            [id],
          )
        ).rows.length,
        409,
        'DISPATCH_UNRESOLVED',
        'A call is dispatching or its outcome is unknown. Reconcile it before changing this schedule.',
      );
      await tx.query(
        "UPDATE scheduled_jobs SET status='canceled',updated_at=now() WHERE schedule_id=$1 AND owner_id=$2 AND status IN ('pending','claimed','blocked')",
        [id, ownerId],
      );
      const schedule = await s.update('schedules', ownerId, id, {
        ...patch,
        ...(patch.next_run_at && patch.enabled === undefined && existing.recurrence === 'once'
          ? { enabled: true }
          : {}),
        version: existing.version + 1,
      });
      await s.enqueue(schedule);
      await s.audit(ownerId, 'schedule.updated', 'schedule', id, { fields: Object.keys(patch) });
      return schedule;
    });
  }
  async cancelLinkedSchedules(ownerId: string, column: 'task_id' | 'project_id', id: string) {
    await this.db.query(
      `UPDATE schedules SET enabled=false,version=version+1,updated_at=now() WHERE owner_id=$1 AND ${column}=$2`,
      [ownerId, id],
    );
    await this.db.query(
      `UPDATE scheduled_jobs SET status='canceled',updated_at=now() WHERE owner_id=$1 AND schedule_id IN (SELECT id FROM schedules WHERE owner_id=$1 AND ${column}=$2) AND status IN ('pending','claimed','blocked')`,
      [ownerId, id],
    );
  }
  async deleteSchedule(ownerId: string, id: string) {
    await this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [ownerId]);
      const s = new Store(tx);
      await s.owned('schedules', ownerId, id);
      assert(
        !(
          await tx.query(
            "SELECT id FROM scheduled_jobs WHERE schedule_id=$1 AND status IN ('dispatching','unknown')",
            [id],
          )
        ).rows.length,
        409,
        'DISPATCH_UNRESOLVED',
        'Reconcile the unresolved dispatch before deleting its schedule.',
      );
      await tx.query('DELETE FROM schedules WHERE id=$1 AND owner_id=$2', [id, ownerId]);
      await s.audit(ownerId, 'schedule.deleted', 'schedule', id);
    });
  }
  async createConversation(ownerId: string, channel: 'text' | 'phone' | 'browser') {
    return normalize(
      (
        await this.db.query(
          'INSERT INTO conversations(id,owner_id,channel) VALUES($1,$2,$3) RETURNING *',
          [randomUUID(), ownerId, channel],
        )
      ).rows[0],
    );
  }
  async saveMessage(
    ownerId: string,
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
  ) {
    await this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [ownerId]);
      const s = new Store(tx),
        settings = await s.settings(ownerId);
      await s.owned('conversations', ownerId, conversationId);
      if (settings.retain_transcripts)
        await tx.query(
          'INSERT INTO conversation_messages(id,owner_id,conversation_id,role,content) VALUES($1,$2,$3,$4,$5)',
          [randomUUID(), ownerId, conversationId, role, redactCredentials(content)],
        );
      await tx.query(
        'UPDATE conversations SET last_activity_at=now() WHERE id=$1 AND owner_id=$2',
        [conversationId, ownerId],
      );
    });
  }
  async listConversations(ownerId: string) {
    return normalize(
      (
        await this.db.query(
          'SELECT * FROM conversations WHERE owner_id=$1 ORDER BY started_at DESC LIMIT 100',
          [ownerId],
        )
      ).rows,
    );
  }
  async getConversation(ownerId: string, id: string) {
    const conversation = await this.owned('conversations', ownerId, id);
    conversation.messages = normalize(
      (
        await this.db.query(
          'SELECT role,content,created_at FROM conversation_messages WHERE conversation_id=$1 AND owner_id=$2 ORDER BY created_at LIMIT 1000',
          [id, ownerId],
        )
      ).rows,
    );
    return conversation;
  }
  async deleteConversation(ownerId: string, id: string) {
    await this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [ownerId]);
      const s = new Store(tx);
      await s.owned('conversations', ownerId, id);
      const active = (
        await tx.query(
          "SELECT id FROM calls WHERE owner_id=$1 AND conversation_id=$2 AND status IN ('reserved','submitting','queued','ringing','in-progress','unknown') UNION ALL SELECT id FROM browser_voice_sessions WHERE owner_id=$1 AND conversation_id=$2 AND status IN ('starting','active','unknown')",
          [ownerId, id],
        )
      ).rows;
      assert(
        !active.length,
        409,
        'ACTIVE_SESSION',
        'End or reconcile this voice session before deleting its conversation.',
      );
      await tx.query('DELETE FROM conversations WHERE id=$1 AND owner_id=$2', [id, ownerId]);
      await s.audit(ownerId, 'conversation.deleted', 'conversation', id);
    });
  }
  async listCalls(ownerId: string) {
    return normalize(
      (
        await this.db.query(
          'SELECT c.*,co.summary FROM calls c LEFT JOIN conversations co ON co.id=c.conversation_id WHERE c.owner_id=$1 ORDER BY c.created_at DESC LIMIT 200',
          [ownerId],
        )
      ).rows,
    );
  }
  async activity(ownerId: string, limit = 30) {
    return normalize(
      (
        await this.db.query(
          'SELECT id,action,entity_type,detail,created_at FROM audit_logs WHERE owner_id=$1 ORDER BY created_at DESC LIMIT $2',
          [ownerId, limit],
        )
      ).rows,
    );
  }
  async exportData(ownerId: string) {
    const tables = [
      'projects',
      'tasks',
      'task_dependencies',
      'memories',
      'conversations',
      'conversation_messages',
      'schedules',
      'scheduled_jobs',
      'calls',
      'actions',
      'audit_logs',
      'usage_events',
      'project_conversations',
      'task_conversations',
      'browser_voice_sessions',
    ];
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [ownerId]);
      const output: Record<string, unknown> = {
        format: 'krona-personal-data-v1',
        exported_at: new Date().toISOString(),
        settings: await new Store(tx).settings(ownerId),
      };
      const owner = (
        await tx.query('SELECT id,email,display_name,created_at FROM owners WHERE id=$1', [ownerId])
      ).rows[0];
      output.owner = normalize(owner);
      for (const table of tables) {
        const rows = (await tx.query(`SELECT * FROM ${table} WHERE owner_id=$1`, [ownerId])).rows;
        output[table] = normalize(rows).map((r: any) => {
          delete r.search_vector;
          delete r.canonical_hash;
          return r;
        });
      }
      return output;
    });
  }
  async retention() {
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM owners FOR UPDATE');
      await tx.query('DELETE FROM sessions WHERE expires_at<now()');
      await tx.query("DELETE FROM voice_tokens WHERE expires_at<now() - interval '1 hour'");
      await tx.query("DELETE FROM phone_auth_attempts WHERE created_at<now() - interval '2 days'");
      await tx.query("DELETE FROM webhook_events WHERE created_at<now() - interval '30 days'");
      const removed = (
        await tx.query(
          "DELETE FROM conversations c USING owners o WHERE c.owner_id=o.id AND c.last_activity_at < now() - make_interval(days => COALESCE((o.settings->>'conversation_retention_days')::int,90)) AND NOT EXISTS(SELECT 1 FROM calls x WHERE x.conversation_id=c.id AND x.status IN ('reserved','submitting','queued','ringing','in-progress','unknown')) AND NOT EXISTS(SELECT 1 FROM browser_voice_sessions b WHERE b.conversation_id=c.id AND b.status IN ('starting','active','unknown')) RETURNING c.id,c.owner_id",
        )
      ).rows;
      await tx.query("DELETE FROM audit_logs WHERE created_at < now() - interval '90 days'");
      await tx.query("DELETE FROM usage_events WHERE created_at < now() - interval '90 days'");
      await tx.query(
        "UPDATE conversations SET status='interrupted',ended_at=now() WHERE status='active' AND last_activity_at<now()-interval '1 day'",
      );
      return removed;
    });
  }
}
