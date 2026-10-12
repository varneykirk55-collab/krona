import { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  ArrowUp,
  ArrowUpRight,
  Brain,
  MessageSquare,
  Plus,
  Mic,
  MicOff,
  History,
  FileText,
  Loader2,
  Check,
  AlertCircle,
  Trash2,
} from 'lucide-react';
import type { Conversation } from '../../shared/schemas';
import { useApp } from '../context';
import { api, refresh } from '../api';
import { useResource } from '../hooks/useResource';
import { useBrowserVoice } from '../hooks/useBrowserVoice';
import {
  Badge,
  Button,
  dateLabel,
  ErrorState,
  FormError,
  IconButton,
  PageHeading,
  PrivacyNote,
} from '../components/common';
import { Orb } from '../components/Orb';
interface Message {
  role: 'user' | 'assistant';
  text: string;
  failed?: boolean;
  tools?: string[];
}
export default function ConversationPage() {
  const { settings, status, navigate, notify } = useApp(),
    history = useResource<Conversation[]>('/conversations'),
    [messages, setMessages] = useState<Message[]>([]),
    [draft, setDraft] = useState(''),
    [id, setId] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [summary, setSummary] = useState(''),
    [showHistory, setShowHistory] = useState(false),
    [mode, setMode] = useState<'voice' | 'text'>('voice'),
    bottom = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null);
  const voice = useBrowserVoice((role, text) => {
      setMessages((m) => [...m, { role, text }]);
    }),
    ready =
      status?.live_ai_enabled &&
      status.ai.state !== 'unconfigured' &&
      status.ai.state !== 'disabled';
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, busy]);
  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!draft.trim() || busy) return;
    const message = draft.trim();
    setDraft('');
    setError('');
    setBusy(true);
    setMessages((m) => [...m, { role: 'user', text: message }]);
    try {
      const r = await api<{
        conversation_id: string;
        text: string;
        tools: { name: string; result: { ok: boolean } }[];
        provider_failure: boolean;
      }>('/conversations/message', { method: 'POST', body: { message, conversation_id: id } });
      setId(r.conversation_id);
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: r.text,
          failed: r.provider_failure,
          tools: r.tools.filter((t) => t.result.ok).map((t) => t.name),
        },
      ]);
      refresh();
    } catch (e) {
      setError((e as Error).message);
      setMessages((m) => m.map((v, i) => (i === m.length - 1 ? { ...v, failed: true } : v)));
      setDraft(message);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }
  async function load(c: Conversation) {
    if (busy) return;
    await voice.stop();
    try {
      const actual = await api<Conversation>('/conversations/' + c.id);
      setId(c.channel === 'text' ? c.id : null);
      setMode('text');
      setMessages(
        (actual.messages || []).map((m) => ({ role: m.role as Message['role'], text: m.content })),
      );
      setSummary(actual.summary);
      setShowHistory(false);
      setError('');
    } catch (e) {
      notify((e as Error).message, true);
    }
  }
  async function newConversation() {
    if (busy) return;
    if (id) void api(`/conversations/${id}/end`, { method: 'POST' }).catch(() => {});
    await voice.stop();
    setMessages([]);
    setSummary('');
    setId(null);
    setError('');
    setDraft('');
  }
  return (
    <div className="conversation-page">
      <PageHeading
        eyebrow="ROOM TO THINK"
        title="Conversation"
        description="Pick up a thread. Untangle an idea. Take the next small step."
        action={
          <div className="toolbar-actions">
            <Button variant="secondary" onClick={() => setShowHistory(!showHistory)}>
              <History size={16} />
              History
            </Button>
            <Button variant="secondary" disabled={busy} onClick={newConversation}>
              <Plus size={16} />
              New conversation
            </Button>
          </div>
        }
      />
      <div className="conversation-layout">
        <section className="card conversation-card">
          <div className="conversation-mode-bar">
            <div className="tabs">
              <button
                className={mode === 'voice' ? 'selected' : ''}
                onClick={() => setMode('voice')}
              >
                <AudioLines size={15} />
                Voice
              </button>
              <button
                className={mode === 'text' ? 'selected' : ''}
                onClick={() => {
                  void voice.stop();
                  setMode('text');
                }}
              >
                <MessageSquare size={15} />
                Text
              </button>
            </div>
            <Badge tone={ready ? 'sage' : 'neutral'}>
              {ready ? 'Live provider configured' : 'Awaiting AI configuration'}
            </Badge>
          </div>
          {mode === 'voice' && (
            <div className={`voice-stage ${voice.active ? 'live' : ''}`}>
              <Orb active={voice.active} />
              <div className="voice-stage-copy">
                <span className="eyebrow">
                  {voice.active ? 'LIVE VOICE SESSION' : 'A CONVERSATION, NOT A COMMAND LINE'}
                </span>
                <h2>
                  {voice.state === 'listening'
                    ? 'I’m listening.'
                    : voice.state === 'responding'
                      ? 'Thinking it through.'
                      : voice.state === 'microphone'
                        ? 'Allow your microphone.'
                        : voice.state === 'connecting'
                          ? 'Making the connection.'
                          : 'What’s on your mind?'}
                </h2>
                <p>
                  {voice.active
                    ? `${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, '0')} · You can interrupt naturally.`
                    : ready
                      ? 'Talk naturally. Your private context stays connected.'
                      : 'Native voice and telephone integrations are implemented. Configure the live provider to begin—no audio is simulated.'}
                </p>
                {voice.active ? (
                  <Button variant="danger" onClick={() => voice.stop()}>
                    <MicOff size={17} />
                    End voice session
                  </Button>
                ) : ready ? (
                  <Button onClick={() => voice.start()}>
                    <Mic size={18} />
                    Start a voice conversation
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => navigate('status')}>
                    Review voice setup
                    <ArrowUpRight size={16} />
                  </Button>
                )}
                <FormError message={voice.error} />
                {voice.audioBlocked && (
                  <Button variant="secondary" onClick={() => void voice.enableAudio()}>
                    Enable sound
                  </Button>
                )}
              </div>
            </div>
          )}
          <div
            className={`chat-scroll ${mode === 'voice' && !messages.length ? 'empty-voice-chat' : ''}`}
          >
            {summary && (
              <div className="saved-summary">
                <FileText size={17} />
                <div>
                  <strong>Previously retained summary</strong>
                  <p>{summary}</p>
                  <span>
                    Assistant interpretation · raw messages{' '}
                    {settings.retain_transcripts ? 'may be retained' : 'are off'}
                  </span>
                </div>
              </div>
            )}
            {!messages.length && mode === 'text' && !summary && (
              <div className="chat-welcome">
                <span className="chat-welcome-icon">
                  <AudioLines size={28} />
                </span>
                <h2>No need to have it all figured out.</h2>
                <p>Start with a thought. We can find the useful part together.</p>
                <div className="suggestion-grid">
                  {[
                    'Where did we leave off on my projects?',
                    'What should I focus on first?',
                    'Help me turn an idea into a next step.',
                  ].map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setDraft(s);
                        input.current?.focus();
                      }}
                    >
                      {s}
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`message ${m.role} ${m.failed ? 'failed' : ''}`}>
                <span className="message-avatar">
                  {m.role === 'assistant' ? <AudioLines size={16} /> : null}
                </span>
                <div>
                  <span className="message-speaker">
                    {m.role === 'user' ? 'You' : 'Krona'}
                    {m.failed && <span> · interrupted / not fully sent</span>}
                  </span>
                  <p>{m.text}</p>
                  {!!m.tools?.length && (
                    <div className="tool-confirmations">
                      <Check size={13} />
                      Successful database operations:{' '}
                      {m.tools.map((t) => t.replaceAll('_', ' ')).join(', ')}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="thinking-state">
                <Loader2 size={16} className="spin" />
                Waiting for the actual provider response…
              </div>
            )}
            <div ref={bottom} />
          </div>
          {mode === 'text' && (
            <div className="composer-area">
              {!ready && (
                <div className="composer-notice">
                  <AlertCircle size={14} />
                  AI is not activated. Tasks, projects and memory can still be managed directly.
                  <button onClick={() => navigate('status')}>Setup</button>
                </div>
              )}
              <FormError message={error} />
              <form className="composer" onSubmit={send}>
                <textarea
                  ref={input}
                  value={draft}
                  maxLength={8000}
                  rows={1}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="A thought, a question, somewhere to start…"
                  aria-label="Message Krona"
                />
                <button
                  type="submit"
                  className="send-button"
                  disabled={busy || !draft.trim()}
                  aria-label="Send message"
                >
                  {busy ? <Loader2 size={18} className="spin" /> : <ArrowUp size={20} />}
                </button>
              </form>
              <PrivacyNote>
                Transcripts {settings.retain_transcripts ? 'retained with your opt-in' : 'off'} ·
                summaries {settings.summarize_conversations ? 'enabled' : 'off'} · no audio
                recording
              </PrivacyNote>
            </div>
          )}
        </section>
        <aside className={`conversation-aside ${showHistory ? 'show-mobile' : ''}`}>
          <section className="card">
            <div className="section-heading">
              <h2>
                {showHistory ? 'Your conversation history' : 'A little context goes a long way'}
              </h2>
              <Brain size={18} />
            </div>
            {showHistory ? (
              <div className="conversation-history">
                {history.error ? (
                  <ErrorState message={history.error} retry={history.reload} />
                ) : history.data?.length ? (
                  history.data.map((c) => (
                    <div key={c.id} className="conversation-history-row">
                      <button onClick={() => load(c)}>
                        <Badge>{c.channel}</Badge>
                        <time>{dateLabel(c.started_at, settings.timezone, true)}</time>
                        <p>{c.summary || 'No summary retained'}</p>
                      </button>
                      <IconButton
                        label="Delete conversation"
                        onClick={() => {
                          if (
                            window.confirm(
                              'Delete this conversation and any retained transcript from persistent storage?',
                            )
                          )
                            void api('/conversations/' + c.id, { method: 'DELETE' })
                              .then(() => {
                                refresh();
                                if (id === c.id) {
                                  setId(null);
                                  setMessages([]);
                                  setSummary('');
                                }
                                notify('Conversation deleted.');
                              })
                              .catch((e) => notify(e.message, true));
                        }}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  ))
                ) : (
                  <p className="subtle-empty">
                    Your real conversations will appear here. No example history is seeded.
                  </p>
                )}
              </div>
            ) : (
              <div className="conversation-context">
                <p>
                  Relevant memories and project context are retrieved as needed. Your entire history
                  isn't sent with every turn.
                </p>
                <button onClick={() => navigate('memory')}>
                  <Brain size={17} />
                  <div>
                    <strong>Long-term memory</strong>
                    <span>Review what carries forward</span>
                  </div>
                  <ArrowUpRight size={15} />
                </button>
                <button onClick={() => navigate('projects')}>
                  <FileText size={17} />
                  <div>
                    <strong>Ongoing projects</strong>
                    <span>Verified progress, not guesses</span>
                  </div>
                  <ArrowUpRight size={15} />
                </button>
                <div className="conversation-principle">
                  “Never agree merely to please.
                  <br />
                  Never disagree merely to challenge.
                  <br />
                  <strong>Follow the evidence.</strong>”
                </div>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
