import { useState } from 'react';
import { DateTime } from 'luxon';
import { Plus, Trash2, X, Check } from 'lucide-react';
import type { Task, Project, Memory, Schedule } from '../../shared/schemas';
import { useApp } from '../context';
import { api, refresh } from '../api';
import { useResource } from '../hooks/useResource';
import { Badge, Button, Field, FormError, Modal, statusLabel } from './common';
export type Editor =
  | { kind: 'task'; record?: Task }
  | { kind: 'project'; record?: Project }
  | { kind: 'memory'; record?: Memory }
  | { kind: 'schedule'; record?: Schedule };
const localInput = (value: string | null | undefined, zone: string) =>
  value ? DateTime.fromISO(value, { zone }).toFormat("yyyy-MM-dd'T'HH:mm") : '';
export function RecordEditor({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  switch (editor.kind) {
    case 'task':
      return <TaskEditor record={editor.record} onClose={onClose} />;
    case 'project':
      return <ProjectEditor record={editor.record} onClose={onClose} />;
    case 'memory':
      return <MemoryEditor record={editor.record} onClose={onClose} />;
    case 'schedule':
      return <ScheduleEditor record={editor.record} onClose={onClose} />;
  }
}
function useSave(path: string, onClose: () => void, record?: { id: string }) {
  const { notify } = useApp(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirmDelete, setConfirmDelete] = useState(false);
  return {
    busy,
    error,
    confirmDelete,
    setConfirmDelete,
    async save(body: unknown) {
      setBusy(true);
      setError('');
      try {
        await api(record ? `${path}/${record.id}` : path, {
          method: record ? 'PATCH' : 'POST',
          body,
        });
        notify(record ? 'Changes saved.' : 'Saved to your private space.');
        refresh();
        onClose();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    async remove() {
      if (!record) return;
      setBusy(true);
      try {
        await api(`${path}/${record.id}`, { method: 'DELETE' });
        refresh();
        notify('Record deleted from persistent storage.');
        onClose();
      } catch (e) {
        setError((e as Error).message);
        setBusy(false);
      }
    },
  };
}
function Footer({
  save,
  onClose,
  hasRecord,
}: {
  save: ReturnType<typeof useSave>;
  onClose: () => void;
  hasRecord: boolean;
}) {
  return (
    <>
      <FormError message={save.error} />
      {save.confirmDelete ? (
        <div className="delete-confirm">
          <p>This deletes the actual record. Are you sure?</p>
          <Button type="button" variant="danger" busy={save.busy} onClick={save.remove}>
            Delete permanently
          </Button>
          <Button type="button" variant="ghost" onClick={() => save.setConfirmDelete(false)}>
            Keep it
          </Button>
        </div>
      ) : (
        <div className="form-footer">
          {hasRecord && (
            <Button
              type="button"
              variant="ghost"
              className="danger-text"
              onClick={() => save.setConfirmDelete(true)}
            >
              <Trash2 size={15} />
              Delete
            </Button>
          )}
          <span className="spacer" />
          <Button type="button" variant="secondary" onClick={onClose} disabled={save.busy}>
            Cancel
          </Button>
          <Button type="submit" busy={save.busy}>
            {hasRecord ? 'Save changes' : 'Create'}
            <Check size={15} />
          </Button>
        </div>
      )}
    </>
  );
}
function TaskEditor({ record, onClose }: { record?: Task; onClose: () => void }) {
  const { settings } = useApp(),
    projects = useResource<Project[]>('/projects'),
    tasks = useResource<Task[]>('/tasks'),
    save = useSave('/tasks', onClose, record);
  const [title, setTitle] = useState(record?.title || ''),
    [description, setDescription] = useState(record?.description || ''),
    [status, setStatus] = useState(record?.status || 'not_started'),
    [priority, setPriority] = useState(record?.priority || 'normal'),
    [project, setProject] = useState(record?.project_id || ''),
    [due, setDue] = useState(localInput(record?.due_at, settings.timezone)),
    [notes, setNotes] = useState(record?.notes || ''),
    [dependencies, setDependencies] = useState<string[]>(record?.dependencies || []),
    [recurrence, setRecurrence] = useState(record?.recurrence?.frequency || '');
  return (
    <Modal
      title={record ? 'Task details' : 'A small step forward'}
      description="Make it specific enough to start. You can adjust it any time."
      onClose={() => {
        if (!save.busy) onClose();
      }}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save.save({
            title,
            description,
            status,
            priority,
            project_id: project || null,
            due_at: due ? DateTime.fromISO(due, { zone: settings.timezone }).toUTC().toISO() : null,
            notes,
            dependencies,
            recurrence: recurrence
              ? {
                  frequency: recurrence,
                  interval: record?.recurrence?.interval || 1,
                  timezone: settings.timezone,
                }
              : null,
          });
        }}
      >
        <div className="form-body">
          <Field label="Task title">
            <input
              required
              autoFocus
              placeholder="e.g. Test the website checkout"
              maxLength={240}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Description">
            <textarea
              rows={2}
              placeholder="What does done look like?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div className="field-grid">
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value as Task['status'])}>
                {['not_started', 'in_progress', 'blocked', 'waiting', 'completed', 'canceled'].map(
                  (v) => (
                    <option key={v} value={v}>
                      {statusLabel(v)}
                    </option>
                  ),
                )}
              </select>
            </Field>
            <Field label="Priority">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Task['priority'])}
              >
                {['urgent', 'high', 'normal', 'low'].map((v) => (
                  <option key={v} value={v}>
                    {statusLabel(v)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Project">
              <select value={project} onChange={(e) => setProject(e.target.value)}>
                <option value="">No project</option>
                {projects.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Due date" help={`Local time in ${settings.timezone}`}>
              <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
          </div>
          <Field
            label="Repeat after completion"
            help="Completing the task creates one new instance. It does not schedule or authorize calls."
          >
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as any)}>
              <option value="">Does not repeat</option>
              {['daily', 'weekdays', 'weekly', 'monthly'].map((v) => (
                <option key={v} value={v}>
                  {statusLabel(v)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Useful context for next time"
            />
          </Field>
          {(tasks.data?.filter((t) => t.id !== record?.id).length || 0) > 0 && (
            <div className="field">
              <span className="field-label">Depends on</span>
              <div className="dependency-list">
                {tasks.data
                  ?.filter((t) => t.id !== record?.id && t.status !== 'canceled')
                  .map((t) => (
                    <label key={t.id} className="check-label">
                      <input
                        type="checkbox"
                        checked={dependencies.includes(t.id)}
                        onChange={(e) =>
                          setDependencies(
                            e.target.checked
                              ? [...dependencies, t.id]
                              : dependencies.filter((id) => id !== t.id),
                          )
                        }
                      />
                      <span>{t.title}</span>
                    </label>
                  ))}
              </div>
            </div>
          )}
        </div>
        <Footer save={save} onClose={onClose} hasRecord={!!record} />
      </form>
    </Modal>
  );
}
function ProjectEditor({ record, onClose }: { record?: Project; onClose: () => void }) {
  const continuity = useResource<{
    conversations: { id: string; channel: string; started_at: string; summary: string }[];
  }>(record ? '/projects/' + record.id + '/context' : null);
  const save = useSave('/projects', onClose, record),
    [name, setName] = useState(record?.name || ''),
    [description, setDescription] = useState(record?.description || ''),
    [status, setStatus] = useState(record?.status || 'active'),
    [objectives, setObjectives] = useState(record?.objectives.join('\n') || ''),
    [blockers, setBlockers] = useState(record?.blockers.join('\n') || ''),
    [next, setNext] = useState(record?.next_action || ''),
    [progress, setProgress] = useState(record?.progress || 0),
    [milestones, setMilestones] = useState(record?.milestones || []),
    [decision, setDecision] = useState('');
  return (
    <Modal
      title={record ? 'Project details' : 'Give an idea a home'}
      description="Keep the context, the blockers, and the next step together."
      onClose={() => {
        if (!save.busy) onClose();
      }}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save.save({
            name,
            description,
            status,
            objectives: objectives.split('\n').filter(Boolean),
            blockers: blockers.split('\n').filter(Boolean),
            next_action: next,
            progress,
            milestones,
            decisions: [
              ...(record?.decisions || []),
              ...(decision.trim() ? [{ text: decision.trim(), at: new Date().toISOString() }] : []),
            ],
          });
        }}
      >
        <div className="form-body">
          <Field label="Project name">
            <input
              required
              maxLength={240}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My business website"
            />
          </Field>
          <Field label="Description">
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="The idea and why it matters"
            />
          </Field>
          <div className="field-grid">
            <Field label="Status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Project['status'])}
              >
                {['active', 'paused', 'completed', 'archived'].map((v) => (
                  <option key={v} value={v}>
                    {statusLabel(v)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Progress (%)"
              help="Milestones calculate progress automatically when present."
            >
              <input
                type="number"
                min={0}
                max={100}
                value={progress}
                onChange={(e) => setProgress(Number(e.target.value))}
              />
            </Field>
          </div>
          <Field label="Objectives" help="One objective per line">
            <textarea
              rows={2}
              value={objectives}
              onChange={(e) => setObjectives(e.target.value)}
              placeholder="What are you working toward?"
            />
          </Field>
          <div className="field">
            <div className="inline-heading">
              <span className="field-label">Milestones</span>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setMilestones([
                    ...milestones,
                    { id: crypto.randomUUID(), title: '', completed: false },
                  ])
                }
              >
                <Plus size={14} />
                Add milestone
              </Button>
            </div>
            <div className="milestone-editor">
              {milestones.map((m) => (
                <div key={m.id}>
                  <input
                    type="checkbox"
                    aria-label={'Complete ' + m.title}
                    checked={m.completed}
                    onChange={(e) =>
                      setMilestones(
                        milestones.map((x) =>
                          x.id === m.id ? { ...x, completed: e.target.checked } : x,
                        ),
                      )
                    }
                  />
                  <input
                    required
                    value={m.title}
                    aria-label="Milestone title"
                    placeholder="A concrete milestone"
                    onChange={(e) =>
                      setMilestones(
                        milestones.map((x) =>
                          x.id === m.id ? { ...x, title: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Remove milestone"
                    onClick={() => setMilestones(milestones.filter((x) => x.id !== m.id))}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <Field label="Blockers" help="One blocker per line">
            <textarea
              rows={2}
              value={blockers}
              onChange={(e) => setBlockers(e.target.value)}
              placeholder="What's getting in the way?"
            />
          </Field>
          <Field label="Next action">
            <input
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="The smallest useful thing to do next"
            />
          </Field>
          {!!record?.decisions.length && (
            <div className="decision-history">
              <strong>Previous decisions</strong>
              {record.decisions.slice(-5).map((d, i) => (
                <p key={i}>{d.text}</p>
              ))}
            </div>
          )}
          <Field label="Record a decision">
            <textarea
              rows={2}
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
              placeholder="Only decisions actually made"
            />
          </Field>
          {record && (
            <section className="decision-history">
              <strong>Related conversations</strong>
              {continuity.error ? (
                <p>{continuity.error}</p>
              ) : continuity.loading ? (
                <p>Loading retained context…</p>
              ) : continuity.data?.conversations.length ? (
                continuity.data.conversations.map((c) => (
                  <p key={c.id}>
                    <Badge>{c.channel}</Badge>{' '}
                    {c.summary || 'No retained summary for this linked conversation.'}
                  </p>
                ))
              ) : (
                <p>
                  No conversations are linked yet. Updates made through voice or text tools retain
                  their source references.
                </p>
              )}
            </section>
          )}
        </div>
        <Footer save={save} onClose={onClose} hasRecord={!!record} />
      </form>
    </Modal>
  );
}
function MemoryEditor({ record, onClose }: { record?: Memory; onClose: () => void }) {
  const save = useSave('/memories', onClose, record),
    [content, setContent] = useState(record?.content || ''),
    [category, setCategory] = useState(record?.category || 'knowledge'),
    [confidence, setConfidence] = useState(record?.confidence || 'user_provided'),
    [subject, setSubject] = useState(record?.subject || ''),
    [sensitive, setSensitive] = useState(record?.sensitive || false);
  return (
    <Modal
      title={record ? 'Review this memory' : 'Something worth remembering'}
      description="Save only what you want your companion to carry forward."
      onClose={() => {
        if (!save.busy) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save.save({
            content,
            category,
            confidence,
            subject,
            sensitive,
            ...(!record ? { project_id: null } : {}),
          });
        }}
      >
        <div className="form-body">
          <Field label="Memory">
            <textarea
              required
              rows={4}
              maxLength={6000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="e.g. I prefer direct, concise answers"
            />
          </Field>
          <div className="field-grid">
            <Field label="Category">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as Memory['category'])}
              >
                {['preferences', 'knowledge', 'projects', 'routines'].map((v) => (
                  <option key={v} value={v}>
                    {statusLabel(v)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Confidence">
              <select
                value={confidence}
                onChange={(e) => setConfidence(e.target.value as Memory['confidence'])}
              >
                {[
                  'user_provided',
                  'confirmed',
                  'interpretation',
                  'unverified',
                  'outdated',
                  'conflicted',
                ].map((v) => (
                  <option key={v} value={v}>
                    {statusLabel(v)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            label="Fact key (optional)"
            help="A specific fact such as preferred-contact-time. Different values with the same key are flagged as a conflict."
          >
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Leave blank for an ordinary note"
              maxLength={240}
            />
          </Field>
          <label className="check-label">
            <input
              type="checkbox"
              checked={sensitive}
              onChange={(e) => setSensitive(e.target.checked)}
            />
            <span>Contains sensitive personal information</span>
          </label>
          <p className="field-help">
            Sensitive memories are only available after dashboard sign-in or telephone PIN
            authentication. Avoid storing credentials or financial account details.
          </p>
          {record?.conflict_group && (
            <div className="notice warning">
              Marking this version confirmed makes the other conflicting versions outdated.
            </div>
          )}
        </div>
        <Footer save={save} onClose={onClose} hasRecord={!!record} />
      </form>
    </Modal>
  );
}
function ScheduleEditor({ record, onClose }: { record?: Schedule; onClose: () => void }) {
  const { settings } = useApp(),
    save = useSave('/schedules', onClose, record),
    projects = useResource<Project[]>('/projects'),
    tasks = useResource<Task[]>('/tasks');
  const [title, setTitle] = useState(record?.title || ''),
    [purpose, setPurpose] = useState(record?.purpose || ''),
    [zone, setZone] = useState(record?.timezone || settings.timezone),
    [at, setAt] = useState(
      localInput(record?.next_run_at, record?.timezone || settings.timezone) ||
        DateTime.now()
          .setZone(settings.timezone)
          .plus({ days: 1 })
          .set({ hour: 9, minute: 0 })
          .toFormat("yyyy-MM-dd'T'HH:mm"),
    ),
    [frequency, setFrequency] = useState(record?.recurrence || 'once'),
    [day, setDay] = useState(record?.day_of_week || 1),
    [task, setTask] = useState(record?.task_id || ''),
    [project, setProject] = useState(record?.project_id || ''),
    [enabled, setEnabled] = useState(record?.enabled ?? true);
  return (
    <Modal
      title={record ? 'Check-in details' : 'A conversation, when it helps'}
      description="Calls only happen with your explicit consent, verified phone, and live provider configuration."
      onClose={() => {
        if (!save.busy) onClose();
      }}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const date = DateTime.fromISO(at, { zone });
          void save.save({
            title,
            purpose,
            timezone: zone,
            next_run_at: date.toUTC().toISO(),
            local_time: date.toFormat('HH:mm'),
            recurrence: frequency,
            day_of_week: day,
            task_id: task || null,
            project_id: project || null,
            enabled,
          });
        }}
      >
        <div className="form-body">
          <Field label="Check-in title">
            <input
              required
              value={title}
              maxLength={240}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Morning planning"
            />
          </Field>
          <Field label="What should we discuss?">
            <textarea
              rows={2}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="A task, a project, or a little room to think"
            />
          </Field>
          <div className="field-grid">
            <Field label="First call" help={`Local time in ${zone}`}>
              <input
                required
                type="datetime-local"
                value={at}
                onChange={(e) => setAt(e.target.value)}
              />
            </Field>
            <Field
              label="Timezone"
              help="Use an IANA timezone. Daylight saving is handled automatically."
            >
              <input
                required
                list="timezones"
                value={zone}
                onChange={(e) => setZone(e.target.value)}
              />
              <datalist id="timezones">
                {[
                  'America/New_York',
                  'America/Chicago',
                  'America/Denver',
                  'America/Los_Angeles',
                  'Europe/London',
                  'Europe/Paris',
                  'Asia/Tokyo',
                  'Australia/Sydney',
                  'UTC',
                ].map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </Field>
            <Field label="Repeat">
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Schedule['recurrence'])}
              >
                {['once', 'daily', 'weekdays', 'weekly'].map((v) => (
                  <option key={v} value={v}>
                    {statusLabel(v)}
                  </option>
                ))}
              </select>
            </Field>
            {frequency === 'weekly' && (
              <Field label="Recurring day">
                <select value={day} onChange={(e) => setDay(Number(e.target.value))}>
                  {[
                    'Monday',
                    'Tuesday',
                    'Wednesday',
                    'Thursday',
                    'Friday',
                    'Saturday',
                    'Sunday',
                  ].map((v, i) => (
                    <option key={v} value={i + 1}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Related task">
              <select value={task} onChange={(e) => setTask(e.target.value)}>
                <option value="">No task</option>
                {tasks.data
                  ?.filter((t) => !['completed', 'canceled'].includes(t.status))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Related project">
              <select value={project} onChange={(e) => setProject(e.target.value)}>
                <option value="">No project</option>
                {projects.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Keep this schedule enabled</span>
          </label>
          <div className="notice">
            <strong>No surprise calls.</strong> Quiet hours, pauses and daily limits always apply.
            Unanswered calls are not automatically retried. Saving this schedule does not enable
            calling.
          </div>
        </div>
        <Footer save={save} onClose={onClose} hasRecord={!!record} />
      </form>
    </Modal>
  );
}
