import { useEffect, useState } from 'react';
import {
  User,
  Phone,
  ShieldCheck,
  SlidersHorizontal,
  AudioLines,
  Brain,
  Lock,
  Download,
  Trash2,
  ArrowUpRight,
  KeyRound,
  Check,
  Wallet,
  Sun,
} from 'lucide-react';
import type { Settings, Owner } from '../../shared/schemas';
import { useApp } from '../context';
import { api, exportData, refresh } from '../api';
import { useResource } from '../hooks/useResource';
import {
  Badge,
  Button,
  ErrorState,
  Field,
  FormError,
  Loading,
  Modal,
  PageHeading,
  SectionHeading,
  Toggle,
} from '../components/common';
interface SettingsData {
  settings: Settings;
  owner: Owner;
  models: { text: string; realtime: string };
  assistant_number: string | null;
}
export default function SettingsPage() {
  const { notify, navigate } = useApp(),
    r = useResource<SettingsData>('/settings'),
    [form, setForm] = useState<Settings | null>(null),
    [tab, setTab] = useState('general'),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [dialog, setDialog] = useState<'pin' | 'password' | 'erase' | null>(null),
    [password, setPassword] = useState(''),
    [pin, setPin] = useState(''),
    [newPassword, setNewPassword] = useState(''),
    [confirm, setConfirm] = useState('');
  useEffect(() => {
    if (r.data) setForm(r.data.settings);
  }, [r.data]);
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError('');
    try {
      const saved = await api<Settings>('/settings', {
        method: 'PATCH',
        body: { ...form, consent_to_outbound: consent },
      });
      setForm(saved);
      setConsent(false);
      refresh();
      notify('Your preferences are saved.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function openDialog(type: 'pin' | 'password' | 'erase') {
    setError('');
    setDialog(type);
    setPassword('');
    setPin('');
    setNewPassword('');
    setConfirm('');
  }
  async function security(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (dialog === 'pin') {
        await api('/auth/phone-pin', { method: 'POST', body: { password, pin } });
        notify('Phone PIN saved securely.');
        refresh();
      }
      if (dialog === 'password') {
        if (newPassword !== confirm) throw new Error('The new passwords do not match.');
        await api('/auth/password', {
          method: 'POST',
          body: { current_password: password, new_password: newPassword },
        });
        notify('Password changed. All sessions are revoked.');
        window.dispatchEvent(new Event('krona:auth-expired'));
      }
      if (dialog === 'erase') {
        await api('/data/erase', { method: 'POST', body: { password, confirmation: confirm } });
        window.dispatchEvent(new Event('krona:auth-expired'));
      }
      setDialog(null);
      setPassword('');
      setPin('');
      setNewPassword('');
      setConfirm('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (r.error) return <ErrorState message={r.error} retry={r.reload} />;
  if (!form || !r.data) return <Loading rows={5} />;
  const tabs = [
    ['general', 'Your companion', SlidersHorizontal],
    ['calls', 'Calls & check-ins', Phone],
    ['privacy', 'Privacy & memory', ShieldCheck],
    ['limits', 'Usage & limits', Wallet],
    ['account', 'Account security', Lock],
  ] as const;
  return (
    <>
      <PageHeading
        eyebrow="ALWAYS YOURS TO SHAPE"
        title="Settings"
        description="Your pace, your preferences, your boundaries."
      />
      <div className="settings-layout">
        <nav className="settings-tabs" aria-label="Settings sections">
          {tabs.map(([v, l, Icon]) => (
            <button
              key={v}
              className={tab === v ? 'selected' : ''}
              onClick={() => {
                setTab(v);
                setError('');
              }}
            >
              <Icon size={17} />
              {l}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <form onSubmit={save}>
            {tab === 'general' && (
              <>
                <SettingsCard
                  icon={AudioLines}
                  title="The way we talk"
                  description="Calm, useful, and a little more like you."
                >
                  <Field label="Communication preferences">
                    <textarea
                      rows={4}
                      maxLength={2000}
                      value={form.communication_style}
                      onChange={(e) => update('communication_style', e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Voice"
                    help="Applies to your next real-time session. Voices are served by the configured AI provider."
                  >
                    <select
                      value={form.voice}
                      onChange={(e) => update('voice', e.target.value as Settings['voice'])}
                    >
                      {[
                        'marin',
                        'cedar',
                        'alloy',
                        'ash',
                        'ballad',
                        'coral',
                        'echo',
                        'sage',
                        'shimmer',
                        'verse',
                      ].map((v) => (
                        <option key={v} value={v}>
                          {v.charAt(0).toUpperCase() + v.slice(1)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="read-only-models">
                    <span>
                      <strong>Text model</strong>
                      <code>{r.data.models.text}</code>
                    </span>
                    <span>
                      <strong>Real-time model</strong>
                      <code>{r.data.models.realtime}</code>
                    </span>
                  </div>
                  <p className="field-help">
                    Model selection and API credentials are operator-managed environment
                    configuration. They are never stored in frontend code.
                  </p>
                  <Button type="button" variant="ghost" onClick={() => navigate('status')}>
                    AI provider setup
                    <ArrowUpRight size={14} />
                  </Button>
                </SettingsCard>
                <SettingsCard
                  icon={Sun}
                  title="Your space"
                  description="Comfortable on any screen."
                >
                  <Field
                    label="Timezone"
                    help="IANA timezone; used for relative dates, limits and quiet hours."
                  >
                    <input
                      required
                      value={form.timezone}
                      onChange={(e) => update('timezone', e.target.value)}
                    />
                  </Field>
                  <Field label="Appearance">
                    <select
                      value={form.theme}
                      onChange={(e) => update('theme', e.target.value as Settings['theme'])}
                    >
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                      <option value="system">Follow device</option>
                    </select>
                  </Field>
                </SettingsCard>
              </>
            )}
            {tab === 'calls' && (
              <>
                <SettingsCard
                  icon={Phone}
                  title="A phone call, not a notification"
                  description="Ordinary phone access with stronger authentication."
                >
                  <Field
                    label="Your phone number"
                    help="International E.164 format. Changing it resets verification and disables outgoing calls."
                  >
                    <input
                      type="tel"
                      value={form.phone_number || ''}
                      placeholder="+12125551234"
                      onChange={(e) => update('phone_number', e.target.value || null)}
                    />
                  </Field>
                  <div className="phone-verification">
                    <Badge tone={r.data.owner.phone_verified ? 'green' : 'amber'}>
                      {r.data.owner.phone_verified ? 'Phone verified' : 'Phone not verified'}
                    </Badge>
                    <Badge tone={r.data.owner.has_phone_pin ? 'sage' : 'neutral'}>
                      {r.data.owner.has_phone_pin ? 'PIN configured' : 'PIN required'}
                    </Badge>
                  </div>
                  <p className="field-help">
                    Save your number, set a PIN, then call your provisioned Twilio number and
                    authenticate. Caller ID alone never grants private access.
                  </p>
                  <div className="toolbar-actions">
                    <Button type="button" variant="secondary" onClick={() => openDialog('pin')}>
                      <KeyRound size={15} />
                      {r.data.owner.has_phone_pin ? 'Change phone PIN' : 'Set phone PIN'}
                    </Button>
                    {r.data.assistant_number ? (
                      <a className="button secondary" href={'tel:' + r.data.assistant_number}>
                        <Phone size={15} />
                        Call {r.data.assistant_number}
                      </a>
                    ) : (
                      <Button type="button" variant="ghost" onClick={() => navigate('status')}>
                        Configure Twilio
                        <ArrowUpRight size={15} />
                      </Button>
                    )}
                  </div>
                </SettingsCard>
                <SettingsCard
                  icon={ShieldCheck}
                  title="Permission to reach out"
                  description="You choose whether proactive calls are welcome."
                >
                  <Toggle
                    label="Enable outgoing check-in calls"
                    checked={form.outbound_enabled}
                    onChange={(v) => {
                      update('outbound_enabled', v);
                      setConsent(false);
                    }}
                    description="Requires a verified phone, PIN, live operator configuration and explicit consent."
                  />
                  {form.outbound_enabled && !r.data.settings.outbound_enabled && (
                    <label className="check-label consent-label">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      <span>
                        I explicitly authorize automated AI check-in calls to my verified owner
                        number, subject to my schedules and limits.
                      </span>
                    </label>
                  )}
                  <div className="field-grid">
                    <Field label="Quiet hours start">
                      <input
                        type="time"
                        value={form.quiet_start}
                        onChange={(e) => update('quiet_start', e.target.value)}
                      />
                    </Field>
                    <Field label="Quiet hours end">
                      <input
                        type="time"
                        value={form.quiet_end}
                        onChange={(e) => update('quiet_end', e.target.value)}
                      />
                    </Field>
                  </div>
                  <p className="field-help">
                    Quiet hours use {form.timezone}. Equal start and end means quiet hours are
                    disabled. Temporary pauses are managed on the scheduling page.
                  </p>
                  <Field label="Maximum outbound calls per day">
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={form.daily_call_limit}
                      onChange={(e) => update('daily_call_limit', Number(e.target.value))}
                    />
                  </Field>
                  <div className="notice">
                    Third-party calling, recordings and automatic missed-call redial are disabled.
                    Enabling owner check-ins does not authorize calls to anyone else.
                  </div>
                </SettingsCard>
              </>
            )}
            {tab === 'privacy' && (
              <>
                <SettingsCard
                  icon={Brain}
                  title="What carries forward"
                  description="Useful context, not unnecessary personal data."
                >
                  <div className="category-controls">
                    {['preferences', 'knowledge', 'projects', 'routines'].map((c) => (
                      <Toggle
                        key={c}
                        label={c.charAt(0).toUpperCase() + c.slice(1) + ' memory'}
                        checked={!form.disabled_memory_categories.includes(c as any)}
                        onChange={(v) =>
                          update(
                            'disabled_memory_categories',
                            v
                              ? form.disabled_memory_categories.filter((x) => x !== c)
                              : [...form.disabled_memory_categories, c as any],
                          )
                        }
                        description="Disabling stops retrieval and new storage in this category. Existing records remain editable and deletable."
                      />
                    ))}
                  </div>
                </SettingsCard>
                <SettingsCard
                  icon={FilePrivacyIcon}
                  title="Conversation privacy"
                  description="No audio recording, ever, in this application."
                >
                  <Toggle
                    label="Retain text transcripts"
                    checked={form.retain_transcripts}
                    onChange={(v) => update('retain_transcripts', v)}
                    description="Off by default. Turning this off and saving deletes existing retained message transcripts from application storage. Provider retention policies remain separate."
                  />
                  <Toggle
                    label="Save conversation summaries"
                    checked={form.summarize_conversations}
                    onChange={(v) => update('summarize_conversations', v)}
                    description="Short assistant interpretations for continuity. Disabling stops new summaries; existing summaries can be deleted in conversation history."
                  />
                  <Field
                    label="Conversation retention (days)"
                    help="Backend cleanup runs hourly. Long-term memories are managed separately."
                  >
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={form.conversation_retention_days}
                      onChange={(e) =>
                        update('conversation_retention_days', Number(e.target.value))
                      }
                    />
                  </Field>
                  <div className="notice">
                    Audio may still be processed transiently by Twilio and OpenAI. Managed database
                    backups and provider logs have independent retention windows. Review those
                    policies before live use.
                  </div>
                </SettingsCard>
                <SettingsCard
                  icon={Download}
                  title="Your data belongs to you"
                  description="Export records or remove them from actual persistent storage."
                >
                  <div className="data-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        void exportData()
                          .then(() => notify('Personal-data export downloaded.'))
                          .catch((e) => notify(e.message, true))
                      }
                    >
                      <Download size={15} />
                      Export personal data
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="danger-text"
                      onClick={() => openDialog('erase')}
                    >
                      <Trash2 size={15} />
                      Delete all personal data
                    </Button>
                  </div>
                </SettingsCard>
              </>
            )}
            {tab === 'limits' && (
              <SettingsCard
                icon={Wallet}
                title="Boundaries for cost and time"
                description="Conservative estimates, finite sessions, no automatic upgrades."
              >
                <div className="field-grid">
                  <Field label="Maximum call duration (minutes)">
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={form.max_call_minutes}
                      onChange={(e) => update('max_call_minutes', Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Concurrent voice sessions">
                    <input
                      type="number"
                      min={1}
                      max={3}
                      value={form.concurrent_call_limit}
                      onChange={(e) => update('concurrent_call_limit', Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Estimated daily spending limit (USD)">
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      step="0.01"
                      value={form.daily_spend_limit_usd}
                      onChange={(e) => update('daily_spend_limit_usd', Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Daily AI request limit">
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={form.daily_ai_request_limit}
                      onChange={(e) => update('daily_ai_request_limit', Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Daily AI token limit">
                    <input
                      type="number"
                      min={100}
                      max={10000000}
                      value={form.daily_ai_token_limit}
                      onChange={(e) => update('daily_ai_token_limit', Number(e.target.value))}
                    />
                  </Field>
                </div>
                <p className="field-help">
                  Voice calls reserve the full maximum-duration cost envelope before dialing. Limits
                  depend on operator-supplied pricing estimates and cannot guarantee the final
                  provider invoice. Set provider billing alerts and hard caps too.
                </p>
                <Button type="button" variant="ghost" onClick={() => navigate('status')}>
                  Review usage and pricing configuration
                  <ArrowUpRight size={15} />
                </Button>
              </SettingsCard>
            )}
            {tab === 'account' && (
              <SettingsCard
                icon={Lock}
                title="A private, single-owner account"
                description="Session security and credential management."
              >
                <div className="account-identity">
                  <span className="avatar">
                    {r.data.owner.display_name.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{r.data.owner.display_name}</strong>
                    <p>{r.data.owner.email}</p>
                  </div>
                  <Badge tone="sage">Owner</Badge>
                </div>
                <div className="toolbar-actions">
                  <Button type="button" variant="secondary" onClick={() => openDialog('password')}>
                    <KeyRound size={15} />
                    Change password
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => openDialog('pin')}>
                    <Phone size={15} />
                    Manage phone PIN
                  </Button>
                </div>
                <div className="notice">
                  Passwords and phone PINs are salted and scrypt-hashed. Dashboard sessions use
                  HttpOnly cookies with CSRF protection. Changing your password revokes every active
                  dashboard session.
                </div>
              </SettingsCard>
            )}
            {tab !== 'account' && (
              <div className="settings-save">
                <FormError message={error} />
                <Button type="submit" busy={busy}>
                  <Check size={16} />
                  Save preferences
                </Button>
                <span>Changes are applied only after a successful save.</span>
              </div>
            )}
          </form>
        </div>
      </div>
      {dialog && (
        <Modal
          title={
            dialog === 'pin'
              ? 'Secure your telephone access'
              : dialog === 'password'
                ? 'Change your password'
                : 'Delete all personal data'
          }
          description={
            dialog === 'erase'
              ? 'This deletes your owner account and cascades through its actual application records. It cannot remove independent provider records or managed backups.'
              : 'Sensitive changes require your current account password.'
          }
          onClose={() => {
            if (!busy) {
              setDialog(null);
              setPassword('');
              setPin('');
              setError('');
            }
          }}
        >
          <form onSubmit={security}>
            <div className="form-body">
              <Field label="Current account password">
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              {dialog === 'pin' && (
                <Field
                  label="Phone PIN"
                  help="6–12 digits. Avoid repeating or sequential numbers. Use the telephone keypad, not voice, to enter this PIN."
                >
                  <input
                    required
                    type="password"
                    inputMode="numeric"
                    pattern="\d{6,12}"
                    minLength={6}
                    maxLength={12}
                    autoComplete="off"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                  />
                </Field>
              )}
              {dialog === 'password' && (
                <>
                  <Field label="New password">
                    <input
                      required
                      minLength={12}
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </Field>
                  <Field label="Confirm new password">
                    <input
                      required
                      type="password"
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                  </Field>
                </>
              )}
              {dialog === 'erase' && (
                <Field
                  label="Type DELETE ALL PERSONAL DATA"
                  help="Active or unresolved voice calls must be ended or reconciled first. Account recreation requires a fresh operator-generated setup token."
                >
                  <input required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </Field>
              )}
              <FormError message={error} />
            </div>
            <div className="form-footer">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDialog(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant={dialog === 'erase' ? 'danger' : 'primary'}
                busy={busy}
                disabled={dialog === 'erase' && confirm !== 'DELETE ALL PERSONAL DATA'}
              >
                {dialog === 'erase' ? 'Delete permanently' : 'Save securely'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function FilePrivacyIcon(props: any) {
  return <ShieldCheck {...props} />;
}
function SettingsCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: any;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card settings-card">
      <div className="settings-card-heading">
        <span>
          <Icon size={20} />
        </span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <div className="settings-card-body">{children}</div>
    </section>
  );
}
