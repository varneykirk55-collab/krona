import { useState } from 'react';
import {
  ArrowRight,
  Brain,
  AudioLines,
  Check,
  ShieldCheck,
  Loader2,
  Sun,
  Moon,
} from 'lucide-react';
import { api, setCsrf } from '../api';
import type { Owner } from '../../shared/schemas';
import { Brand, Button, Field, FormError, PrivacyNote } from './common';
import { Orb } from './Orb';
export default function AuthScreen({
  initialized,
  setupAvailable,
  onSignedIn,
  onTheme,
  dark,
}: {
  initialized: boolean;
  setupAvailable: boolean;
  onSignedIn: (owner: Owner) => void;
  onTheme: () => void;
  dark: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState(''),
    [token, setToken] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ owner: Owner; csrf: string }>(
        initialized ? '/auth/login' : '/auth/setup',
        {
          method: 'POST',
          body: initialized
            ? { email, password }
            : { email, password, display_name: name, setup_token: token },
        },
      );
      setCsrf(result.csrf);
      onSignedIn(result.owner);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <header className="auth-header">
        <Brand />
        <button className="icon-button" aria-label="Toggle color theme" onClick={onTheme}>
          {dark ? <Sun size={19} /> : <Moon size={19} />}
        </button>
      </header>
      <div className="auth-layout">
        <section className="auth-story">
          <div className="eyebrow">
            <span className="small-dot" /> A PRIVATE PERSONAL COMPANION
          </div>
          <h1>
            Less on your mind.
            <br />
            <span>More room to live.</span>
          </h1>
          <p className="auth-description">
            A thoughtful companion for your projects, your plans, and the little things in between.
            Always on your terms.
          </p>
          <div className="auth-orb-scene">
            <Orb />
            <div className="floating-note note-one">
              <Brain size={19} />
              <div>
                <strong>Continuity, not repetition</strong>
                <span>Keep what matters in one place</span>
              </div>
            </div>
            <div className="floating-note note-two">
              <Check size={17} />
              <div>
                <strong>One manageable next step</strong>
                <span>Turn intentions into momentum</span>
              </div>
            </div>
          </div>
          <div className="auth-principles">
            <span>
              <ShieldCheck size={17} />
              Private by design
            </span>
            <span>
              <AudioLines size={17} />
              Built for conversation
            </span>
            <span>
              <Check size={17} />
              You stay in control
            </span>
          </div>
        </section>
        <section className="auth-card">
          <div className="auth-card-top">
            <span className="auth-mini-icon">
              <AudioLines size={25} strokeWidth={1.5} />
            </span>
            <BadgeLabel />
            {!initialized && <span className="step-label">FIRST-TIME SETUP</span>}
          </div>
          <h2>{initialized ? 'Welcome back.' : 'Make yourself at home.'}</h2>
          <p>
            {initialized
              ? 'Sign in to your private space. Your thoughts and plans will be right where you left them.'
              : 'Create your single-owner account. No shared workspace, no public profile. Just your space.'}
          </p>
          <form onSubmit={submit}>
            {!initialized && (
              <>
                <Field label="Your name">
                  <input
                    required
                    autoComplete="name"
                    placeholder="What should we call you?"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={80}
                  />
                </Field>
                <Field
                  label="One-time setup token"
                  help="Find this private token in .data/setup-token on the server. It prevents anyone else from claiming your account."
                >
                  <input
                    required
                    autoComplete="off"
                    type="password"
                    placeholder="Paste your setup token"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </Field>
              </>
            )}
            <Field label="Email address">
              <input
                required
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field
              label="Password"
              help={
                !initialized
                  ? 'Use at least 12 characters. A memorable passphrase works well.'
                  : undefined
              }
            >
              <input
                required
                type="password"
                minLength={initialized ? 1 : 12}
                autoComplete={initialized ? 'current-password' : 'new-password'}
                placeholder={initialized ? 'Your password' : 'Create a private passphrase'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <FormError message={error} />
            <Button
              type="submit"
              busy={busy}
              className="full-width"
              disabled={!initialized && !setupAvailable}
            >
              {initialized ? 'Enter your space' : 'Create my private space'}
              <ArrowRight size={17} />
            </Button>
          </form>
          <PrivacyNote>
            Encrypted transport when served over HTTPS. No audio recordings.
          </PrivacyNote>
          {!initialized && !setupAvailable && (
            <FormError message="Account setup requires an operator-generated token. Run npm run setup:token on the server, then refresh." />
          )}
          <div className="activation-note">
            <span className="small-dot neutral" />
            <p>
              Live AI and telephone services require separate configuration. Creating an account
              does not activate paid services or calls.
            </p>
          </div>
        </section>
      </div>
      <footer className="auth-footer">
        <span>krona · A little more clarity.</span>
        <span>Your decisions. Your pace. Your companion.</span>
      </footer>
    </div>
  );
}
function BadgeLabel() {
  return (
    <span className="auth-secure">
      <ShieldCheck size={12} />
      SINGLE-OWNER ACCESS
    </span>
  );
}
