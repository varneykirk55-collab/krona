import { useState } from 'react';
import { ShieldCheck, Check, ShieldAlert, ArrowUpRight, X, Lock } from 'lucide-react';
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
interface Action {
  id: string;
  kind: string;
  risk: string;
  title: string;
  payload: unknown;
  scope_hash: string;
  status: string;
  expires_at: string;
  created_at: string;
  result: unknown;
}
export default function Approvals() {
  const { settings, notify } = useApp(),
    r = useResource<Action[]>('/actions'),
    [selected, setSelected] = useState<Action | null>(null),
    [password, setPassword] = useState(''),
    [authorization, setAuthorization] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function approve(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await api(`/actions/${selected.id}/approve`, {
        method: 'POST',
        body: {
          scope_hash: selected.scope_hash,
          ...(selected.risk === 'high' ? { password, authorization } : {}),
        },
      });
      notify('Exact scope authorized. This does not execute an external action.');
      setSelected(null);
      setPassword('');
      setAuthorization('');
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="YOU RETAIN THE FINAL SAY"
        title="Approvals"
        description="Review the exact scope. Nothing consequential happens on an assumption."
      />
      <div className="notice approval-notice">
        <ShieldCheck size={20} />
        <div>
          <strong>Authorization is not execution.</strong>
          <p>
            Third-party calls, messaging, bookings, sharing and spending have no configured
            executor. Approval saves permission only; no external commitments are made.
          </p>
        </div>
      </div>
      {r.error ? (
        <ErrorState message={r.error} retry={r.reload} />
      ) : r.loading && !r.data ? (
        <Loading />
      ) : r.data?.length ? (
        <div className="approvals-list">
          {r.data.map((a) => (
            <section key={a.id} className="card action-card">
              <div className="action-card-heading">
                <span className={'action-icon ' + (a.risk === 'high' ? 'high' : '')}>
                  <ShieldAlert size={21} />
                </span>
                <div>
                  <h2>{a.title}</h2>
                  <p>
                    {a.kind} · {dateLabel(a.created_at, settings.timezone, true)}
                  </p>
                </div>
                <Badge
                  tone={a.risk === 'high' ? 'red' : a.risk === 'confirmation' ? 'amber' : 'sage'}
                >
                  {a.risk === 'high'
                    ? 'High impact'
                    : a.risk === 'confirmation'
                      ? 'Confirmation required'
                      : 'Low risk'}
                </Badge>
                <Badge tone={a.status === 'approved' ? 'green' : 'neutral'}>
                  {statusLabel(a.status)}
                </Badge>
              </div>
              <pre className="action-payload">{JSON.stringify(a.payload, null, 2)}</pre>
              <div className="action-scope">
                <Lock size={13} />
                <span>
                  Scope {a.scope_hash.slice(0, 16)}… · expires{' '}
                  {dateLabel(a.expires_at, settings.timezone, true)}
                </span>
              </div>
              <div className="action-buttons">
                {a.status === 'proposed' && (
                  <>
                    <Button
                      onClick={() => {
                        setSelected(a);
                        setError('');
                        setPassword('');
                        setAuthorization('');
                      }}
                      disabled={new Date(a.expires_at) < new Date()}
                    >
                      <Check size={15} />
                      Review & authorize
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void api(`/actions/${a.id}/reject`, { method: 'POST' })
                          .then(() => {
                            notify('Proposal rejected.');
                            refresh();
                          })
                          .catch((e) => notify(e.message, true))
                      }
                    >
                      <X size={15} />
                      Reject
                    </Button>
                  </>
                )}
                {a.status === 'approved' && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void api(`/actions/${a.id}/reject`, { method: 'POST' })
                        .then(() => {
                          refresh();
                          notify('Authorization withdrawn.');
                        })
                        .catch((e) => notify(e.message, true))
                    }
                  >
                    Withdraw authorization
                  </Button>
                )}
                {a.kind === 'note.create' && ['proposed', 'approved'].includes(a.status) && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void api(`/actions/${a.id}/execute`, { method: 'POST' })
                        .then(() => {
                          notify('Internal note stored.');
                          refresh();
                        })
                        .catch((e) => notify(e.message, true))
                    }
                  >
                    Save internal note
                    <ArrowUpRight size={15} />
                  </Button>
                )}
                {a.kind !== 'note.create' && (
                  <span className="executor-disabled">
                    External executor disabled · no action performed
                  </span>
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <section className="card">
          <Empty
            icon={ShieldCheck}
            title="No decisions waiting on you"
            description="When a conversation proposes an external action, its exact details and risk level will appear here for your review. No fictional approvals are seeded."
          />
        </section>
      )}
      {selected && (
        <Modal
          title="Authorize this exact scope"
          description={selected.title}
          onClose={() => {
            if (!busy) setSelected(null);
          }}
        >
          <form onSubmit={approve}>
            <div className="form-body">
              <Badge tone={selected.risk === 'high' ? 'red' : 'amber'}>
                {selected.risk === 'high' ? 'High-impact action' : 'Confirmation required'}
              </Badge>
              <pre className="action-payload">{JSON.stringify(selected.payload, null, 2)}</pre>
              <p className="field-help">
                Authorization expires at {dateLabel(selected.expires_at, settings.timezone, true)}.
                Altered payloads need new authorization. External execution remains disabled.
              </p>
              {selected.risk === 'high' && (
                <>
                  <Field label="Your account password">
                    <input
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </Field>
                  <Field label="Type AUTHORIZE to confirm this exact action">
                    <input
                      required
                      value={authorization}
                      onChange={(e) => setAuthorization(e.target.value)}
                    />
                  </Field>
                </>
              )}
              <FormError message={error} />
            </div>
            <div className="form-footer">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                busy={busy}
                disabled={selected.risk === 'high' && authorization !== 'AUTHORIZE'}
              >
                Authorize scope
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
