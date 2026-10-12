import {
  ArrowUpRight,
  AudioLines,
  CalendarClock,
  Check,
  CheckCheck,
  CheckCircle2,
  Folder,
  Plus,
  Phone,
  Sun,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import type { Task, Project, Schedule, Activity, Settings } from '../../shared/schemas';
import { useApp } from '../context';
import { api, refresh } from '../api';
import { useResource } from '../hooks/useResource';
import {
  Badge,
  Button,
  dateLabel,
  Empty,
  ErrorState,
  Loading,
  SectionHeading,
  TextLink,
} from '../components/common';
import { Orb } from '../components/Orb';
import { TaskRow } from './Tasks';
export interface OverviewData {
  counts: {
    open_tasks: number;
    completed_today: number;
    active_projects: number;
    scheduled_checkins: number;
    memories: number;
  };
  tasks: Task[];
  projects: Project[];
  schedules: Schedule[];
  activity: Activity[];
  settings: Settings;
  usage: any;
}
export function Overview() {
  const { owner, settings, navigate, openTask, openProject, openSchedule } = useApp(),
    r = useResource<OverviewData>('/overview');
  if (r.error) return <ErrorState message={r.error} retry={r.reload} />;
  const counts = r.data?.counts,
    open = r.data?.tasks.filter((t) => !['completed', 'canceled'].includes(t.status)) || [],
    projects = r.data?.projects.filter((p) => p.status === 'active') || [];
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: settings.timezone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date()),
  );
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <div className="overview-page">
      <div className="overview-heading">
        <div>
          <div className="eyebrow">YOUR DAILY OVERVIEW</div>
          <h1>
            {greeting}, {owner.display_name.split(' ')[0]}
            <span className="greeting-dot">.</span>
          </h1>
          <p>A little perspective on what matters. One step at a time.</p>
        </div>
        <span className="today-label">
          <CalendarClock size={15} />
          {new Intl.DateTimeFormat('en-US', {
            timeZone: settings.timezone,
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          }).format(new Date())}
        </span>
      </div>
      <section className="companion-hero">
        <div className="hero-copy">
          <span className="hero-kicker">
            <AudioLines size={14} />
            YOUR COMPANION, NOT A SUPERVISOR
          </span>
          <h2>
            Think out loud.
            <br />
            Find your next step.
          </h2>
          <p>
            Space to untangle an idea, pick up a project,
            <br className="desktop-break" /> or just have a conversation.
          </p>
          <div className="hero-actions">
            <Button onClick={() => navigate('conversation')}>
              <AudioLines size={18} />
              Talk to Krona
              <ArrowUpRight size={16} />
            </Button>
            <button className="hero-text-link" onClick={() => navigate('memory')}>
              A space that remembers
              <ArrowRight size={14} />
            </button>
          </div>
          <div className="hero-privacy">
            <ShieldCheck size={13} />
            Private memory. No audio recordings. Always your call.
          </div>
        </div>
        <div className="hero-art">
          <Orb />
          <div className="hero-orbit-label">
            <span className="small-dot" />
            HERE WHEN YOU NEED IT
          </div>
        </div>
      </section>
      <div className="stats-grid">
        <Metric
          icon={CheckCircle2}
          label="Open tasks"
          value={counts?.open_tasks}
          detail={`${counts?.completed_today ?? 0} completed today`}
          onClick={() => navigate('tasks')}
        />
        <Metric
          icon={Folder}
          label="Active projects"
          value={counts?.active_projects}
          detail="Keep the bigger picture in view"
          onClick={() => navigate('projects')}
        />
        <Metric
          icon={CalendarClock}
          label="Scheduled check-ins"
          value={counts?.scheduled_checkins}
          detail={
            settings.paused_until && new Date(settings.paused_until) > new Date()
              ? 'Check-ins paused'
              : settings.outbound_enabled
                ? 'Subject to quiet hours and limits'
                : 'Outgoing calls are off'
          }
          onClick={() => navigate('scheduling')}
        />
      </div>
      <div className="overview-columns">
        <div className="overview-main">
          <section className="card focus-card">
            <SectionHeading
              title="Your focus"
              subtitle="A few things to keep in view."
              action={<TextLink onClick={() => navigate('tasks')}>All tasks</TextLink>}
            />
            {r.loading && !r.data ? (
              <Loading />
            ) : open.length ? (
              <div className="task-list">
                {open.slice(0, 4).map((t) => (
                  <TaskRow key={t.id} task={t} compact />
                ))}
              </div>
            ) : (
              <Empty
                icon={CheckCheck}
                title="A little room to begin"
                description="Add one manageable task. You don't need to figure out everything at once."
                action={
                  <Button variant="secondary" onClick={() => openTask()}>
                    <Plus size={15} />
                    Add your first task
                  </Button>
                }
              />
            )}
            <button className="card-bottom-action" onClick={() => openTask()}>
              <Plus size={15} />
              Add a task<span className="shortcut-label">ONE SMALL STEP</span>
            </button>
          </section>
          <section className="card projects-preview">
            <SectionHeading
              title="Ongoing projects"
              action={<TextLink onClick={() => navigate('projects')}>View projects</TextLink>}
            />
            {projects.length ? (
              <div>
                {projects.slice(0, 3).map((p, i) => (
                  <button key={p.id} className="project-preview-row" onClick={() => openProject(p)}>
                    <span className={`project-icon color-${i % 3}`}>
                      <Folder size={20} />
                    </span>
                    <div>
                      <strong>{p.name}</strong>
                      <p>{p.next_action || 'Add a next action when you’re ready'}</p>
                    </div>
                    <div className="mini-progress">
                      <span>{p.progress}%</span>
                      <div>
                        <i style={{ width: p.progress + '%' }} />
                      </div>
                    </div>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
              </div>
            ) : (
              <Empty
                compact
                icon={Folder}
                title="An idea deserves a home"
                description="Bring the context, milestones, and next steps together."
                action={<TextLink onClick={() => openProject()}>Start a project</TextLink>}
              />
            )}
          </section>
        </div>
        <aside className="overview-aside">
          <section className="card next-checkin-card">
            <SectionHeading
              title="Next conversation"
              action={<CalendarClock size={18} className="muted" />}
            />
            {r.data?.schedules.length ? (
              <div className="next-schedule">
                <span className="checkin-icon">
                  <Phone size={23} />
                </span>
                <h3>{r.data.schedules[0].title}</h3>
                <p>
                  {dateLabel(r.data.schedules[0].next_run_at, r.data.schedules[0].timezone, true)}
                </p>
                <Badge tone={settings.outbound_enabled ? 'green' : 'neutral'}>
                  {settings.outbound_enabled
                    ? 'Scheduled · subject to limits'
                    : 'Saved · calling is off'}
                </Badge>
                <Button variant="secondary" onClick={() => openSchedule(r.data!.schedules[0])}>
                  Review check-in
                  <ArrowRight size={14} />
                </Button>
              </div>
            ) : (
              <div className="next-schedule empty-schedule">
                <span className="checkin-icon">
                  <Phone size={23} strokeWidth={1.6} />
                </span>
                <h3>A check-in, on your terms.</h3>
                <p>
                  Choose when a conversation would help. Calling stays off until you explicitly opt
                  in.
                </p>
                <Button variant="secondary" onClick={() => navigate('scheduling')}>
                  Set up check-ins
                  <ArrowRight size={14} />
                </Button>
              </div>
            )}
            <div className="quiet-hours-note">
              <span className="small-dot neutral" />
              Quiet hours {settings.quiet_start}–{settings.quiet_end}
            </div>
          </section>
          <section className="card activity-card">
            <SectionHeading
              title="A little continuity"
              action={<TextLink onClick={() => navigate('calls')}>History</TextLink>}
            />
            {r.data?.activity.length ? (
              <div className="activity-list">
                {r.data.activity.slice(0, 4).map((a) => (
                  <div key={a.id} className="activity-item">
                    <span className="activity-point" />
                    <div>
                      <p>{activityLabel(a.action)}</p>
                      <time>{dateLabel(a.created_at, settings.timezone, true)}</time>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="subtle-empty">Your saved changes will appear here.</p>
            )}
          </section>
          <div className="gentle-note">
            <Sun size={18} strokeWidth={1.4} />
            <p>
              You set the pace.
              <br />
              Krona helps you find the path.
            </p>
          </div>
        </aside>
      </div>
      <footer className="page-footer">
        <span>
          <ShieldCheck size={13} />
          Your space. Your decisions.
        </span>
        <span>Less to carry. More room to think.</span>
      </footer>
    </div>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
  detail,
  onClick,
}: {
  icon: any;
  label: string;
  value?: number;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button className="metric-card" onClick={onClick}>
      <div className="metric-label">
        <span>{label}</span>
        <Icon size={18} strokeWidth={1.7} />
      </div>
      <div className="metric-value">
        {value === undefined ? (
          <span className="metric-skeleton" />
        ) : (
          String(value).padStart(2, '0')
        )}
        <ArrowUpRight size={18} />
      </div>
      <p>{detail}</p>
    </button>
  );
}
export function activityLabel(action: string) {
  const labels: Record<string, string> = {
    'account.signed_in': 'You signed in',
    'task.created': 'A task was added',
    'task.updated': 'A task was updated',
    'task.deleted': 'A task was deleted',
    'project.created': 'A project was started',
    'project.updated': 'Project details were updated',
    'project.deleted': 'A project was deleted',
    'memory.created': 'A memory was saved',
    'memory.corrected': 'A memory was corrected',
    'memory.deleted': 'A memory was deleted',
    'memory.conflict_detected': 'A memory needs your review',
    'schedule.created': 'A check-in was scheduled',
    'schedule.updated': 'A check-in was changed',
    'settings.updated': 'Your preferences were saved',
    'call.received': 'An incoming call was received',
    'call.ended': 'A phone call ended',
    'action.proposed': 'An action is awaiting review',
    'action.approved': 'An action was authorized',
  };
  return labels[action] || action.replaceAll('.', ' · ').replaceAll('_', ' ');
}
