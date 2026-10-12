import { useEffect, useState } from 'react';
import {
  Database,
  AudioLines,
  Phone,
  CalendarClock,
  RefreshCw,
  Check,
  ArrowRight,
  AlertCircle,
  ShieldCheck,
  Wallet,
  ExternalLink,
} from 'lucide-react';
import type { SystemStatus, ServiceStatus } from '../../shared/schemas';
import { api, refresh } from '../api';
import { useApp } from '../context';
import { useResource } from '../hooks/useResource';
import {
  Badge,
  Button,
  dateLabel,
  ErrorState,
  Loading,
  PageHeading,
  SectionHeading,
  Modal,
  Field,
  FormError,
} from '../components/common';
export default function SystemStatusPage() {
  const { settings, navigate, notify } = useApp(),
    r = useResource<SystemStatus>('/status'),
    usage = useResource<any>('/usage'),
    voices = useResource<any[]>('/voice/sessions'),
    [reconcile, setReconcile] = useState<string | null>(null),
    [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const timer = setInterval(r.reload, 30000);
    return () => clearInterval(timer);
  }, [r.reload]);
  return (
    <>
      <PageHeading
        eyebrow="NO FICTIONAL GREEN LIGHTS"
        title="System status"
        description="Measured local health, configuration state, and honest activation requirements."
        action={
          <Button
            variant="secondary"
            busy={r.loading}
            onClick={() => {
              r.reload();
              usage.reload();
              voices.reload();
            }}
          >
            <RefreshCw size={15} />
            Refresh status
          </Button>
        }
      />
      {r.error ? (
        <ErrorState message={r.error} retry={r.reload} />
      ) : !r.data ? (
        <Loading rows={4} />
      ) : (
        <>
          <div className="system-mode-note">
            <span className="small-dot" />
            <strong>
              {r.data.mode === 'production' ? 'Production runtime' : 'Local development runtime'}
            </strong>
            <span>·</span>
            <span>
              {r.data.live_calling_enabled
                ? 'Operator live-call switch on'
                : 'Live telephone calls disabled'}
            </span>
            <span>·</span>
            <span>{r.data.live_ai_enabled ? 'Live AI switch on' : 'Live AI disabled'}</span>
          </div>
          <div className="service-grid">
            <Service
              icon={Database}
              title="Database & memory"
              value={r.data.database}
              zone={settings.timezone}
            />
            <Service
              icon={AudioLines}
              title="Conversational AI"
              value={r.data.ai}
              zone={settings.timezone}
            />
            <Service
              icon={Phone}
              title="Telephony"
              value={r.data.telephony}
              zone={settings.timezone}
            />
            <Service
              icon={CalendarClock}
              title="Durable scheduler"
              value={r.data.scheduler}
              zone={settings.timezone}
            />
          </div>
          <div className="notice">
            <AlertCircle size={20} />
            <div>
              <strong>Implementation is not live verification.</strong>
              <p>
                Provider configuration does not prove a successful telephone conversation. Live
                incoming, outbound and interruption tests require credentials, billing
                authorization, HTTPS deployment and explicit owner consent.
              </p>
            </div>
          </div>
        </>
      )}
      <section className="card usage-card">
        <SectionHeading
          title="Today's actual usage records"
          subtitle="Estimates use your configured rates; they are not provider invoices."
          action={<Wallet size={18} />}
        />
        {usage.error ? (
          <ErrorState message={usage.error} retry={usage.reload} />
        ) : usage.data ? (
          <>
            <div className="usage-metrics">
              <UsageMetric
                label="AI requests"
                value={usage.data.daily.ai_requests}
                limit={settings.daily_ai_request_limit}
              />
              <UsageMetric
                label="AI tokens"
                value={usage.data.daily.ai_tokens}
                limit={settings.daily_ai_token_limit}
              />
              <UsageMetric
                label="Outbound calls"
                value={usage.data.daily.outbound_calls}
                limit={settings.daily_call_limit}
              />
              <div>
                <span>Estimated spending</span>
                <strong>${usage.data.daily.estimated_cost_usd.toFixed(3)}</strong>
                <p>Limit ${settings.daily_spend_limit_usd.toFixed(2)} / day</p>
              </div>
            </div>
            <div className="pricing-status">
              <Badge tone={usage.data.daily.pricing_configured ? 'sage' : 'amber'}>
                {usage.data.daily.pricing_configured
                  ? 'Operator estimates configured'
                  : 'Pricing estimates not fully configured'}
              </Badge>
              <span>
                {usage.data.daily.telephone_minutes.toFixed(1)} telephone minutes ·{' '}
                {usage.data.daily.voice_minutes.toFixed(1)} voice connection minutes ·{' '}
                {usage.data.daily.active_calls} active / unresolved voice sessions
              </span>
            </div>
            <div className="rate-grid">
              {[
                ['Telephone / minute', 'telephone_per_minute'],
                ['AI voice / minute', 'ai_voice_per_minute'],
                ['AI input / 1M tokens', 'ai_input_per_million'],
                ['AI output / 1M tokens', 'ai_output_per_million'],
              ].map(([l, k]) => (
                <div key={k}>
                  <span>{l}</span>
                  <strong>
                    {usage.data.rates[k] === null ? 'Not configured' : '$' + usage.data.rates[k]}
                  </strong>
                </div>
              ))}
            </div>
          </>
        ) : (
          <Loading rows={2} />
        )}
      </section>
      <section className="card voice-recovery-card">
        <SectionHeading
          title="Browser voice & recovery"
          subtitle="Real session records. Unknown outcomes keep their concurrency and cost reservation."
        />
        {voices.error ? (
          <ErrorState message={voices.error} retry={voices.reload} />
        ) : voices.data?.length ? (
          <div className="voice-session-list">
            {voices.data.map((v) => (
              <div key={v.id}>
                <div>
                  <Badge
                    tone={
                      v.status === 'unknown' ? 'amber' : v.status === 'active' ? 'green' : 'neutral'
                    }
                  >
                    {v.status}
                  </Badge>
                  <span>{dateLabel(v.created_at, settings.timezone, true)}</span>
                  {v.last_error && <small>{v.last_error.replaceAll('_', ' ')}</small>}
                </div>
                {v.status === 'unknown' ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setReconcile(v.id);
                      setPassword('');
                      setConfirmation('');
                      setError('');
                    }}
                  >
                    Review uncertainty
                  </Button>
                ) : (
                  ['starting', 'active'].includes(v.status) && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void api('/voice/session/' + v.id + '/end', { method: 'POST' })
                          .then(() => {
                            refresh();
                            notify('Provider termination confirmed.');
                          })
                          .catch((e) => {
                            refresh();
                            notify(e.message, true);
                          })
                      }
                    >
                      End session
                    </Button>
                  )
                )}
              </div>
            ))}
          </div>
        ) : voices.loading ? (
          <Loading rows={2} />
        ) : (
          <p className="muted">No browser voice sessions have been created in this account.</p>
        )}
      </section>
      <section className="card activation-card">
        <SectionHeading
          title="The shortest path to a live companion"
          subtitle="No accounts are created and no paid services are activated automatically."
        />
        <ol className="activation-steps">
          <li>
            <span>1</span>
            <div>
              <h3>Provision persistent, HTTPS infrastructure</h3>
              <p>
                Deploy the Node backend on a long-lived container service. Configure PostgreSQL or
                Supabase, a public HTTPS URL and a strong session secret. Serverless request-only
                hosting is not enough for the audio WebSocket.
              </p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <h3>Configure the real providers and cost estimates</h3>
              <p>
                Set <code>OPENAI_API_KEY</code>, Twilio account credentials, a provisioned voice
                number and conservative pricing variables. Verify billing and country/model-specific
                pricing yourself.
              </p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <h3>Activate and verify incoming access</h3>
              <p>
                Configure the signed incoming webhook, enable live AI and calls, save your owner
                number and phone PIN, then make a real incoming call. Confirm private access
                requires the PIN.
              </p>
            </div>
          </li>
          <li>
            <span>4</span>
            <div>
              <h3>Opt in to a single live check-in</h3>
              <p>
                Explicitly enable outbound owner calls, create one schedule, and verify the actual
                phone rings, interruption works and no missed-call redial occurs. Run the deployment
                checklist before relying on it daily.
              </p>
            </div>
          </li>
        </ol>
        <div className="activation-footer">
          <ShieldCheck size={17} />
          <span>Third-party actions remain disabled until separately reviewed and configured.</span>
          <Button variant="secondary" onClick={() => navigate('settings')}>
            Open preferences
            <ArrowRight size={15} />
          </Button>
        </div>
      </section>
      {reconcile && (
        <Modal
          title="Resolve an uncertain voice session"
          description="Manual verification is not an automated provider check."
          onClose={() => {
            if (!busy) setReconcile(null);
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await api('/voice/session/' + reconcile + '/reconcile', {
                  method: 'POST',
                  body: { password, confirmation },
                });
                setReconcile(null);
                refresh();
                notify('Manual reconciliation saved; conservative cost estimate retained.');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-body">
              <p>
                Stop your microphone and verify in your provider console that no voice session
                remains active. Only then clear this uncertainty. This does not start another call
                and does not erase the conservative daily cost reservation.
              </p>
              <Field label="Account password">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </Field>
              <Field label="Verification phrase" help="Type I VERIFIED NO ACTIVE VOICE SESSION">
                <input
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  required
                />
              </Field>
              <FormError message={error} />
            </div>
            <div className="form-footer">
              <Button variant="secondary" onClick={() => setReconcile(null)} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="submit"
                busy={busy}
                disabled={confirmation !== 'I VERIFIED NO ACTIVE VOICE SESSION'}
              >
                Save verified reconciliation
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function Service({
  icon: Icon,
  title,
  value,
  zone,
}: {
  icon: any;
  title: string;
  value: ServiceStatus;
  zone: string;
}) {
  return (
    <section className="card service-card">
      <div className="service-card-heading">
        <span className="service-icon">
          <Icon size={23} strokeWidth={1.6} />
        </span>
        <Badge
          tone={
            value.state === 'healthy'
              ? 'green'
              : value.state === 'configured'
                ? 'sage'
                : value.state === 'degraded'
                  ? 'red'
                  : 'neutral'
          }
        >
          {value.state === 'unconfigured'
            ? 'Not configured'
            : value.state.charAt(0).toUpperCase() + value.state.slice(1)}
        </Badge>
      </div>
      <h2>{title}</h2>
      <p>{value.detail}</p>
      <div className="service-verified">
        {value.last_verified_at
          ? 'Last verified ' + dateLabel(value.last_verified_at, zone, true)
          : value.state === 'healthy'
            ? 'Verified by this request'
            : 'Live verification not recorded'}
      </div>
    </section>
  );
}
function UsageMetric({ label, value, limit }: { label: string; value: number; limit: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
      <p>Limit {limit.toLocaleString()} / day</p>
      <div className="usage-bar">
        <i style={{ width: Math.min(100, (value / limit) * 100) + '%' }} />
      </div>
    </div>
  );
}
