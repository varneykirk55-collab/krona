import { useState } from 'react';
import {
  Check,
  CheckCheck,
  Circle,
  Calendar,
  Folder,
  MoreHorizontal,
  Plus,
  ChevronLeft,
  ChevronRight,
  Filter,
} from 'lucide-react';
import type { Task, Project } from '../../shared/schemas';
import { useApp } from '../context';
import { api, refresh } from '../api';
import { useResource } from '../hooks/useResource';
import {
  AddButton,
  Badge,
  Button,
  dateLabel,
  Empty,
  ErrorState,
  Loading,
  PageHeading,
  SearchField,
  statusLabel,
} from '../components/common';
export function TaskRow({
  task,
  compact = false,
  projectName,
}: {
  task: Task;
  compact?: boolean;
  projectName?: string;
}) {
  const { openTask, notify, settings } = useApp(),
    [busy, setBusy] = useState(false),
    done = task.status === 'completed';
  async function complete() {
    setBusy(true);
    try {
      await api('/tasks/' + task.id, {
        method: 'PATCH',
        body: { status: done ? 'not_started' : 'completed' },
      });
      refresh();
      notify(done ? 'Task reopened.' : 'Task marked complete.');
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const overdue = task.due_at && new Date(task.due_at) < new Date() && !done;
  return (
    <div className={`task-row ${done ? 'completed' : ''} ${compact ? 'compact' : ''}`}>
      <button
        className={`task-check ${done ? 'checked' : ''}`}
        aria-label={(done ? 'Reopen ' : 'Complete ') + task.title}
        disabled={busy || task.status === 'canceled'}
        onClick={complete}
      >
        {done && <Check size={13} />}
      </button>
      <button className="task-content" onClick={() => openTask(task)}>
        <strong>{task.title}</strong>
        <div className="task-meta">
          {task.due_at && (
            <span className={overdue ? 'overdue' : ''}>
              <Calendar size={12} />
              {dateLabel(task.due_at, settings.timezone)}
            </span>
          )}
          {projectName && (
            <span>
              <Folder size={12} />
              {projectName}
            </span>
          )}
          {task.status !== 'not_started' && <span>{statusLabel(task.status)}</span>}
          {!!task.dependencies.length && (
            <span>
              {task.dependencies.length}{' '}
              {task.dependencies.length === 1 ? 'dependency' : 'dependencies'}
            </span>
          )}
        </div>
      </button>
      {task.priority !== 'normal' && (
        <Badge
          tone={task.priority === 'urgent' ? 'red' : task.priority === 'high' ? 'amber' : 'neutral'}
        >
          {statusLabel(task.priority)}
        </Badge>
      )}
      <button
        className="icon-button task-more"
        aria-label={'Edit ' + task.title}
        onClick={() => openTask(task)}
      >
        <MoreHorizontal size={18} />
      </button>
    </div>
  );
}
export default function Tasks() {
  const { openTask } = useApp(),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState(''),
    [priority, setPriority] = useState(''),
    [page, setPage] = useState(0);
  const r = useResource<Task[]>(
      `/tasks?limit=50&offset=${page * 50}${query ? '&q=' + encodeURIComponent(query) : ''}${status ? '&status=' + status : ''}${priority ? '&priority=' + priority : ''}`,
    ),
    projects = useResource<Project[]>('/projects'),
    items = r.data || [];
  return (
    <>
      <PageHeading
        eyebrow="A LITTLE MOMENTUM"
        title="Tasks"
        description="Less mental juggling. More manageable next steps."
        action={<AddButton onClick={() => openTask()}>New task</AddButton>}
      />
      <section className="card">
        <div className="collection-toolbar">
          <div className="tabs">
            {[
              ['', 'All tasks'],
              ['in_progress', 'In progress'],
              ['blocked', 'Blocked'],
              ['completed', 'Completed'],
            ].map(([v, l]) => (
              <button
                key={v}
                className={status === v ? 'selected' : ''}
                onClick={() => {
                  setStatus(v);
                  setPage(0);
                }}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="toolbar-actions">
            <SearchField
              value={query}
              onChange={(v) => {
                setQuery(v);
                setPage(0);
              }}
              placeholder="Find a task"
            />
            <select
              aria-label="Filter by priority"
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All priorities</option>
              {['urgent', 'high', 'normal', 'low'].map((v) => (
                <option key={v} value={v}>
                  {statusLabel(v)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {r.error ? (
          <ErrorState message={r.error} retry={r.reload} />
        ) : r.loading && !r.data ? (
          <Loading rows={5} />
        ) : items.length ? (
          <div className="task-list large">
            {items.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                projectName={projects.data?.find((p) => p.id === t.project_id)?.name}
              />
            ))}
          </div>
        ) : (
          <Empty
            icon={CheckCheck}
            title={
              query || status || priority
                ? 'Nothing matching that view'
                : 'Start smaller than you think'
            }
            description={
              query || status || priority
                ? 'Try another search or filter. Your records have not been removed.'
                : 'Add one task you can actually begin. The bigger picture can come later.'
            }
            action={
              <Button variant="secondary" onClick={() => openTask()}>
                <Plus size={16} />
                Add a task
              </Button>
            }
          />
        )}
        <div className="collection-footer">
          <span>{items.length} tasks in this view · saved in PostgreSQL</span>
          <div>
            <Button variant="ghost" disabled={!page} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft size={15} />
              Previous
            </Button>
            <Button
              variant="ghost"
              disabled={(r.data?.length || 0) < 50}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight size={15} />
            </Button>
          </div>
        </div>
      </section>
      <div className="below-note">
        <Circle size={14} />A task is an invitation to act, not a judgment on your day.
      </div>
    </>
  );
}
