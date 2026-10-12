import { useState } from 'react';
import {
  ArrowUpRight,
  Folder,
  Plus,
  Flag,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';
import type { Project } from '../../shared/schemas';
import { useApp } from '../context';
import { useResource } from '../hooks/useResource';
import {
  AddButton,
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  PageHeading,
  SearchField,
  statusLabel,
} from '../components/common';
export default function Projects() {
  const { openProject } = useApp(),
    r = useResource<Project[]>('/projects'),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState('active');
  const projects =
    r.data?.filter(
      (p) =>
        (!status || p.status === status) &&
        `${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase()),
    ) || [];
  return (
    <>
      <PageHeading
        eyebrow="KEEP THE BIGGER PICTURE"
        title="Projects"
        description="Pick up where you left off, without reconstructing the whole story."
        action={<AddButton onClick={() => openProject()}>New project</AddButton>}
      />
      <div className="standalone-toolbar">
        <div className="tabs">
          {[
            ['active', 'Active'],
            ['paused', 'Paused'],
            ['completed', 'Completed'],
            ['archived', 'Archived'],
            ['', 'All'],
          ].map(([v, l]) => (
            <button key={v} className={status === v ? 'selected' : ''} onClick={() => setStatus(v)}>
              {l}
            </button>
          ))}
        </div>
        <SearchField value={query} onChange={setQuery} placeholder="Find a project" />
      </div>
      {r.error ? (
        <ErrorState message={r.error} retry={r.reload} />
      ) : r.loading && !r.data ? (
        <Loading />
      ) : projects.length ? (
        <div className="project-grid">
          {projects.map((p, i) => (
            <button className="card project-card" key={p.id} onClick={() => openProject(p)}>
              <div className="project-card-top">
                <span className={`project-icon color-${i % 3}`}>
                  <Folder size={22} />
                </span>
                <Badge
                  tone={
                    p.status === 'active' ? 'green' : p.status === 'completed' ? 'green' : 'neutral'
                  }
                >
                  {statusLabel(p.status)}
                </Badge>
                <ArrowUpRight size={17} />
              </div>
              <h2>{p.name}</h2>
              <p className="project-description">
                {p.description ||
                  'A little context goes a long way. Add a description when you’re ready.'}
              </p>
              <div className="project-progress-label">
                <span>Progress</span>
                <strong>{p.progress}%</strong>
              </div>
              <div className="progress-track">
                <i style={{ width: p.progress + '%' }} />
              </div>
              <div className="project-counts">
                <span>
                  <CheckCircle2 size={14} />
                  {p.completed_task_count || 0}/{p.task_count || 0} tasks complete
                </span>
                {p.milestones.length > 0 && (
                  <span>
                    <Flag size={14} />
                    {p.milestones.filter((m) => m.completed).length}/{p.milestones.length}{' '}
                    milestones
                  </span>
                )}
              </div>
              {p.blockers.length > 0 && (
                <div className="project-blocker">
                  <AlertCircle size={14} />
                  {p.blockers[0]}
                </div>
              )}
              <div className="project-next">
                <span>NEXT SMALL STEP</span>
                <p>
                  {p.next_action || 'Choose one manageable next action'}
                  <ArrowRight size={15} />
                </p>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <section className="card">
          <Empty
            icon={Folder}
            title={
              query
                ? 'No projects match your search'
                : status === 'active'
                  ? 'Give that idea a little structure'
                  : 'Nothing in this view yet'
            }
            description="Keep objectives, milestones, blockers, and decisions in one place. No invented progress—only what you actually save."
            action={
              <Button variant="secondary" onClick={() => openProject()}>
                <Plus size={16} />
                Start a project
              </Button>
            }
          />
        </section>
      )}
    </>
  );
}
