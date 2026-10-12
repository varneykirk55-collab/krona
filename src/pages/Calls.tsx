import { useState } from 'react';
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  ArrowUpRight,
  FileText,
  ShieldCheck,
  PhoneOff,
} from 'lucide-react';
import type { CallRecord } from '../../shared/schemas';
import { useApp } from '../context';
import { api, refresh } from '../api';
import { useResource } from '../hooks/useResource';
import {
  Badge,
  Button,
  dateLabel,
  Empty,
  ErrorState,
  Field,
  FormError,
  Loading,
  Modal,
  PageHeading,
  statusLabel,
} from '../components/common';
export default function Calls() {
  const { settings, notify, navigate } = useApp(),
    r = useResource<CallRecord[]>('/calls'),
    [detail, setDetail] = useState<CallRecord | null>(null),
    [password, setPassword] = useState(''),
    [sid, setSid] = useState(''),
    [notPlaced, setNotPlaced] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function reconcile() {
    if (!detail) return;
    setBusy(true);
    setError('');
    try {
      await api('/calls/' + detail.id + '/reconcile', {
        method: 'POST',
        body: { password, ...(sid ? { sid } : { confirm_not_placed: notPlaced }) },
      });
      refresh();
      setDetail(null);
      setPassword('');
      notify('Call outcome reconciled. No retry was placed.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="CONVERSATIONS WITH CONTINUITY"
        title="Call history"
        description="Actual call outcomes and retained summaries. No invented conversations."
        action={
          <Button variant="secondary" onClick={() => navigate('status')}>
            <Phone size={15} />
            Telephony status
          </Button>
        }
      />
      <section className="card">
        {r.error ? (
          <ErrorState message={r.error} retry={r.reload} />
        ) : r.loading && !r.data ? (
          <Loading rows={4} />
        ) : r.data?.length ? (
          <div className="table-wrap">
            <table className="calls-table">
              <thead>
                <tr>
                  <th>Call</th>
                  <th>Date & time</th>
                  <th>Duration</th>
                  <th>Outcome</th>
                  <th>Estimate</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {r.data.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <span className="table-call-icon">
                        {c.direction === 'inbound' ? (
                          <PhoneIncoming size={17} />
                        ) : (
                          <PhoneOutgoing size={17} />
                        )}
                      </span>
                      {c.direction === 'inbound' ? 'Incoming call' : 'Owner check-in'}
                    </td>
                    <td>{dateLabel(c.created_at, settings.timezone, true)}</td>
                    <td>
                      {c.duration_seconds === null
                        ? '—'
                        : `${Math.floor(c.duration_seconds / 60)}m ${c.duration_seconds % 60}s`}
                    </td>
                    <td>
                      <Badge
                        tone={
                          c.status === 'unknown'
                            ? 'red'
                            : c.status === 'completed'
                              ? 'green'
                              : ['failed', 'busy', 'no-answer'].includes(c.status)
                                ? 'amber'
                                : 'neutral'
                        }
                      >
                        {statusLabel(c.status)}
                      </Badge>
                    </td>
                    <td>
                      {c.estimated_cost_usd === null
                        ? '—'
                        : `$${Number(c.estimated_cost_usd).toFixed(3)}`}
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label="Review call details"
                        onClick={() => {
                          setDetail(c);
                          setError('');
                        }}
                      >
                        <ArrowUpRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={Phone}
            title="Your conversations will have a home"
            description="Once Twilio and live AI are configured, real incoming and authorized check-in calls appear here. Nothing is simulated."
            action={
              <Button variant="secondary" onClick={() => navigate('status')}>
                Review integration setup
                <ArrowUpRight size={15} />
              </Button>
            }
          />
        )}
      </section>
      <div className="below-note">
        <ShieldCheck size={14} />
        No audio recordings. Transcript retention is optional and off by default.
      </div>
      {detail && (
        <Modal
          title="Call details"
          description={dateLabel(detail.created_at, settings.timezone, true)}
          onClose={() => {
            if (!busy) {
              setDetail(null);
              setPassword('');
            }
          }}
        >
          <div className="form-body">
            <div className="call-detail-meta">
              <Badge tone={detail.status === 'unknown' ? 'red' : 'neutral'}>
                {statusLabel(detail.status)}
              </Badge>
              <span>{statusLabel(detail.direction)}</span>
            </div>
            <h3 className="small-heading">Outcome</h3>
            <p>{detail.outcome || 'No final outcome has been reported yet.'}</p>
            <h3 className="small-heading">Conversation summary</h3>
            <p className="summary-content">
              {detail.summary || 'No summary was retained for this call.'}
            </p>
            {detail.summary && (
              <p className="field-help">Assistant interpretation, not verified facts.</p>
            )}
            {['queued', 'ringing', 'in-progress'].includes(detail.status) && (
              <Button
                variant="danger"
                onClick={() =>
                  void api('/calls/' + detail.id + '/end', { method: 'POST' })
                    .then(() => {
                      notify('Termination requested from Twilio.');
                      refresh();
                      setDetail(null);
                    })
                    .catch((e) => notify(e.message, true))
                }
              >
                <PhoneOff size={15} />
                End this call
              </Button>
            )}
            {detail.status === 'unknown' && (
              <div className="reconcile-form">
                <h3>Reconcile before retrying</h3>
                <p className="field-help">
                  An uncertain creation request might have reached Twilio. Check the actual provider
                  console; the scheduler will not redial automatically.
                </p>
                <Field label="Actual Twilio call SID (if a call exists)">
                  <input value={sid} placeholder="CA…" onChange={(e) => setSid(e.target.value)} />
                </Field>
                {!sid && (
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={notPlaced}
                      onChange={(e) => setNotPlaced(e.target.checked)}
                    />
                    <span>I checked Twilio and verified that no call was placed.</span>
                  </label>
                )}
                <Field label="Your account password">
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                <FormError message={error} />
                <Button
                  busy={busy}
                  disabled={!password || (!sid && !notPlaced)}
                  onClick={reconcile}
                >
                  Save verified outcome
                </Button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
