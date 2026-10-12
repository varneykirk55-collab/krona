import { useState } from 'react';
import { DateTime } from 'luxon';
import {
  CalendarClock,
  Plus,
  Pause,
  Play,
  Phone,
  ShieldCheck,
  Clock,
  MoreHorizontal,
  AlertCircle,
} from 'lucide-react';
import type { Schedule } from '../../shared/schemas';
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
  SectionHeading,
  statusLabel,
  TextLink,
} from '../components/common';
export default function Scheduling() {
  const { settings, openSchedule, notify, navigate } = useApp(),
    r = useResource<Schedule[]>('/schedules'),
    jobs = useResource<any[]>('/jobs'),
    [busy, setBusy] = useState(false);
  const paused = settings.paused_until && new Date(settings.paused_until) > new Date();
  async function pause(mode: 'today' | 'week' | 'resume') {
    setBusy(true);
    try {
      const now = DateTime.now().setZone(settings.timezone),
        until =
          mode === 'resume'
            ? null
            : mode === 'today'
              ? now.plus({ days: 1 }).startOf('day').toUTC().toISO()
              : now.plus({ weeks: 1 }).toUTC().toISO();
      await api('/settings', { method: 'PATCH', body: { paused_until: until } });
      refresh();
      notify(
        mode === 'resume'
          ? 'Check-in pause removed. Calling still requires consent.'
          : 'Check-ins paused.',
      );
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="ON YOUR TERMS"
        title="Check-ins & scheduling"
        description="A useful conversation at the right time. Never an intrusive supervisor."
        action={<AddButton onClick={() => openSchedule()}>Schedule a check-in</AddButton>}
      />
      <div className="schedule-policy">
        <span className="policy-icon">
          <ShieldCheck size={25} />
        </span>
        <div>
          <h2>
            {paused
              ? 'A little breathing room.'
              : settings.outbound_enabled
                ? 'Permission to check in.'
                : 'No calls without your say-so.'}
          </h2>
          <p>
            {paused
              ? `Check-ins paused until ${dateLabel(settings.paused_until, settings.timezone, true)}.`
              : settings.outbound_enabled
                ? 'Owner consent is enabled. Provider configuration, quiet hours, and limits still apply.'
                : 'Outgoing calls are disabled. Verify your phone and explicitly opt in when you’re ready.'}
          </p>
        </div>
        <Badge tone={paused ? 'amber' : settings.outbound_enabled ? 'green' : 'neutral'}>
          {paused ? 'Paused' : settings.outbound_enabled ? 'Opted in' : 'Calls off'}
        </Badge>
        <Button variant="secondary" onClick={() => navigate('settings')}>
          Call preferences
        </Button>
      </div>
      <div className="scheduling-columns">
        <section className="card schedules-card">
          <SectionHeading
            title="Your schedules"
            subtitle={`Times shown in each schedule's timezone.`}
          />
          {r.error ? (
            <ErrorState message={r.error} retry={r.reload} />
          ) : r.loading && !r.data ? (
            <Loading />
          ) : r.data?.length ? (
            <div className="schedule-list">
              {r.data.map((s) => (
                <button key={s.id} className="schedule-row" onClick={() => openSchedule(s)}>
                  <span className="schedule-row-icon">
                    <CalendarClock size={21} />
                  </span>
                  <div>
                    <strong>{s.title}</strong>
                    <p>
                      {dateLabel(s.next_run_at, s.timezone, true)}
                      <span>·</span>
                      {s.timezone}
                    </p>
                    <div>
                      <Badge tone={s.enabled ? 'sage' : 'neutral'}>
                        {s.enabled ? 'Enabled' : 'Off'}
                      </Badge>
                      <span className="schedule-recurrence">
                        {s.recurrence === 'once' ? 'One-time' : statusLabel(s.recurrence)}
                      </span>
                    </div>
                  </div>
                  <MoreHorizontal size={19} />
                </button>
              ))}
            </div>
          ) : (
            <Empty
              icon={CalendarClock}
              title="Choose a moment that helps"
              description="A morning routine, a project follow-up, or one conversation tomorrow. These are durable backend jobs, not browser timers."
              action={
                <Button variant="secondary" onClick={() => openSchedule()}>
                  <Plus size={15} />
                  Create a check-in
                </Button>
              }
            />
          )}
        </section>
        <aside>
          <section className="card pause-card">
            <SectionHeading title="Make some space" action={<Pause size={18} />} />
            <p>Busy day? Taking a break? Your companion can wait.</p>
            <Button variant="secondary" disabled={busy} onClick={() => pause('today')}>
              <Pause size={15} />
              Don't call again today
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => pause('week')}>
              <CalendarClock size={15} />
              Pause for a week
            </Button>
            {paused && (
              <Button variant="ghost" disabled={busy} onClick={() => pause('resume')}>
                <Play size={15} />
                Resume check-ins
              </Button>
            )}
          </section>
          <section className="card quiet-card">
            <span className="quiet-icon">
              <Clock size={20} />
            </span>
            <h3>Quiet hours</h3>
            <strong>
              {settings.quiet_start} — {settings.quiet_end}
            </strong>
            <p>{settings.timezone}</p>
            <TextLink onClick={() => navigate('settings')}>Change quiet hours</TextLink>
            <div className="quiet-limit">
              <Phone size={14} />
              At most {settings.daily_call_limit} outbound{' '}
              {settings.daily_call_limit === 1 ? 'call' : 'calls'} per day
            </div>
          </section>
        </aside>
      </div>
      <section className="card jobs-card">
        <SectionHeading
          title="Scheduler activity"
          subtitle="Actual persistent job records. A completed dispatch does not mean a task was completed."
        />
        {jobs.error ? (
          <ErrorState message={jobs.error} retry={jobs.reload} />
        ) : jobs.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Check-in</th>
                  <th>Effective run time</th>
                  <th>Job state</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {jobs.data.slice(0, 12).map((j) => (
                  <tr key={j.id}>
                    <td>{j.title}</td>
                    <td>{dateLabel(j.run_at, settings.timezone, true)}</td>
                    <td>
                      <Badge
                        tone={
                          j.status === 'unknown'
                            ? 'red'
                            : j.status === 'blocked'
                              ? 'amber'
                              : j.status === 'completed'
                                ? 'green'
                                : 'neutral'
                        }
                      >
                        {statusLabel(j.status)}
                      </Badge>
                    </td>
                    <td className="job-note">{j.last_error ? statusLabel(j.last_error) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="subtle-empty padded">
            No jobs yet. Creating a schedule writes a persistent job automatically.
          </p>
        )}
      </section>
    </>
  );
}
