import { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  AudioLines,
  Brain,
  Folder,
  CheckCircle2,
  Phone,
  CalendarClock,
  Settings as SettingsIcon,
  Activity,
  Search,
  Bell,
  ChevronDown,
  Sun,
  Moon,
  Menu,
  X,
  LogOut,
  ArrowRight,
  ShieldCheck,
  Command,
  Plus,
  Check,
  HelpCircle,
  ArrowUpRight,
  Loader2,
} from 'lucide-react';
import type {
  Owner,
  Task,
  Project,
  Memory,
  Schedule,
  SystemStatus,
  Activity as ActivityRecord,
} from '../shared/schemas';
import { settingsSchema } from '../shared/schemas';
import { api, setCsrf } from './api';
import { AppContext, type Page } from './context';
import { useResource } from './hooks/useResource';
import AuthScreen from './components/AuthScreen';
import { RecordEditor, type Editor } from './components/Forms';
import {
  Badge,
  Brand,
  Button,
  dateLabel,
  ErrorState,
  IconButton,
  Modal,
  PrivacyNote,
  SearchField,
} from './components/common';
import { Overview, activityLabel, type OverviewData } from './pages/Overview';
import Tasks from './pages/Tasks';
import Projects from './pages/Projects';
import MemoryPage from './pages/Memory';
import ConversationPage from './pages/Conversation';
import Calls from './pages/Calls';
import Scheduling from './pages/Scheduling';
import SettingsPage from './pages/Settings';
import Approvals from './pages/Approvals';
import SystemStatusPage from './pages/SystemStatus';
const mainNav: { id: Page; label: string; icon: any }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'conversation', label: 'Conversation', icon: AudioLines },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'projects', label: 'Projects', icon: Folder },
  { id: 'tasks', label: 'Tasks', icon: CheckCircle2 },
  { id: 'calls', label: 'Call history', icon: Phone },
  { id: 'scheduling', label: 'Scheduling', icon: CalendarClock },
  { id: 'approvals', label: 'Approvals', icon: ShieldCheck },
];
const allPages = [
  ...mainNav,
  { id: 'settings' as Page, label: 'Settings', icon: SettingsIcon },
  { id: 'status' as Page, label: 'System status', icon: Activity },
];
function initialPage(): Page {
  const path = window.location.pathname.slice(1);
  return allPages.some((p) => p.id === path) ? (path as Page) : 'overview';
}
export default function App() {
  const [owner, setOwner] = useState<Owner | null>(null),
    [checking, setChecking] = useState(true),
    [connectionError, setConnectionError] = useState(''),
    [authStatus, setAuthStatus] = useState({ initialized: false, setup_available: false }),
    [page, setPage] = useState<Page>(initialPage),
    [editor, setEditor] = useState<Editor | null>(null),
    [sidebar, setSidebar] = useState(false),
    [search, setSearch] = useState(false),
    [help, setHelp] = useState(false),
    [activity, setActivity] = useState(false),
    [accountMenu, setAccountMenu] = useState(false),
    [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [theme, setTheme] = useState(localStorage.getItem('krona-theme') || 'light');
  const overview = useResource<OverviewData>(owner ? '/overview' : null),
    status = useResource<SystemStatus>(owner ? '/status' : null),
    pending = useResource<{ status: string }[]>(owner ? '/actions' : null);
  const settings = overview.data?.settings || settingsSchema.parse({});
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const notify = useCallback((text: string, error = false) => setToast({ text, error }), []);
  const checkAuth = useCallback(async () => {
    setChecking(true);
    setConnectionError('');
    try {
      const state = await api<{ initialized: boolean; setup_available: boolean }>('/auth/status');
      setAuthStatus(state);
      try {
        const me = await api<{ owner: Owner; csrf: string }>('/auth/me');
        setCsrf(me.csrf);
        setOwner(me.owner);
      } catch (e) {
        if ((e as any).status !== 401) throw e;
      }
    } catch (e) {
      setConnectionError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    void checkAuth();
    const expired = () => {
      setOwner(null);
      setCsrf('');
      setEditor(null);
      setSearch(false);
      void api<typeof authStatus>('/auth/status')
        .then(setAuthStatus)
        .catch(() => {});
    };
    window.addEventListener('krona:auth-expired', expired);
    return () => window.removeEventListener('krona:auth-expired', expired);
  }, [checkAuth]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('krona-theme', theme);
  }, [dark, theme]);
  useEffect(() => {
    if (overview.data) setTheme(overview.data.settings.theme);
  }, [overview.data]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 7000 : 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const navigate = useCallback((next: Page) => {
    setPage(next);
    window.history.pushState(null, '', '/' + next);
    setSidebar(false);
    setAccountMenu(false);
    setActivity(false);
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const pop = () => setPage(initialPage()),
      keys = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k' && owner) {
          e.preventDefault();
          setSearch((s) => !s);
        }
        if (e.key === 'Escape') {
          setSidebar(false);
          setAccountMenu(false);
          setActivity(false);
        }
      };
    window.addEventListener('popstate', pop);
    window.addEventListener('keydown', keys);
    return () => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('keydown', keys);
    };
  }, [owner]);
  async function signOut() {
    try {
      await api('/auth/logout', { method: 'POST' });
      setOwner(null);
      setCsrf('');
      setAccountMenu(false);
      setEditor(null);
      setAuthStatus((s) => ({ ...s, initialized: true }));
    } catch (e) {
      notify((e as Error).message, true);
    }
  }
  async function toggleTheme() {
    const next = dark ? 'light' : 'dark';
    if (owner) {
      try {
        await api('/settings', { method: 'PATCH', body: { theme: next } });
        setTheme(next);
      } catch (e) {
        notify((e as Error).message, true);
      }
    } else setTheme(next);
  }
  const openTask = useCallback((record?: Task) => setEditor({ kind: 'task', record }), []),
    openProject = useCallback((record?: Project) => setEditor({ kind: 'project', record }), []),
    openMemory = useCallback((record?: Memory) => setEditor({ kind: 'memory', record }), []),
    openSchedule = useCallback((record?: Schedule) => setEditor({ kind: 'schedule', record }), []);
  if (checking)
    return (
      <div className="startup-screen">
        <Brand />
        <Loader2 className="spin" size={24} />
        <p>Opening your private space…</p>
      </div>
    );
  if (connectionError)
    return (
      <div className="startup-screen">
        <Brand />
        <ErrorState
          message={connectionError + ' Make sure the Node backend is running.'}
          retry={() => void checkAuth()}
        />
      </div>
    );
  if (!owner)
    return (
      <AuthScreen
        initialized={authStatus.initialized}
        setupAvailable={authStatus.setup_available}
        onSignedIn={(o) => {
          setOwner(o);
          navigate('overview');
        }}
        onTheme={() => void toggleTheme()}
        dark={dark}
      />
    );
  const selected = allPages.find((n) => n.id === page)!;
  const approvalCount = pending.data?.filter((a) => a.status === 'proposed').length || 0;
  const renderPage = () => {
    switch (page) {
      case 'overview':
        return <Overview />;
      case 'conversation':
        return <ConversationPage />;
      case 'tasks':
        return <Tasks />;
      case 'projects':
        return <Projects />;
      case 'memory':
        return <MemoryPage />;
      case 'calls':
        return <Calls />;
      case 'scheduling':
        return <Scheduling />;
      case 'approvals':
        return <Approvals />;
      case 'settings':
        return <SettingsPage />;
      case 'status':
        return <SystemStatusPage />;
    }
  };
  return (
    <AppContext.Provider
      value={{
        owner,
        settings,
        status: status.data,
        page,
        navigate,
        notify,
        signOut,
        openTask,
        openProject,
        openMemory,
        openSchedule,
      }}
    >
      <div className="app-shell">
        {sidebar && (
          <button
            className="sidebar-scrim"
            aria-label="Close navigation"
            onClick={() => setSidebar(false)}
          />
        )}
        <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
          <div className="sidebar-brand">
            <button aria-label="Krona overview" onClick={() => navigate('overview')}>
              <Brand />
            </button>
            <button
              className="icon-button mobile-close"
              aria-label="Close navigation"
              onClick={() => setSidebar(false)}
            >
              <X size={19} />
            </button>
          </div>
          <span className="sidebar-tagline">A LITTLE MORE CLARITY.</span>
          <div className="nav-section-label">YOUR SPACE</div>
          <nav className="main-nav" aria-label="Main navigation">
            {mainNav.map((n) => (
              <button
                key={n.id}
                className={page === n.id ? 'active' : ''}
                aria-current={page === n.id ? 'page' : undefined}
                onClick={() => navigate(n.id)}
              >
                <n.icon size={19} strokeWidth={page === n.id ? 2 : 1.65} />
                <span>{n.label}</span>
                {n.id === 'approvals' && approvalCount > 0 && (
                  <span className="nav-count">{approvalCount}</span>
                )}
                {page === n.id && <span className="nav-active-dot" />}
              </button>
            ))}
          </nav>
          <div className="sidebar-spacer" />
          <div className="sidebar-connection">
            <div className="connection-label">
              <span className="small-dot neutral" />
              {status.data?.ai.state === 'configured' ? 'AI configured' : 'Connect your companion'}
            </div>
            <p>
              {status.data?.ai.state === 'configured'
                ? 'Live testing is the next step.'
                : 'A few connections bring voice and calls to life.'}
            </p>
            <button onClick={() => navigate('status')}>
              {status.data?.ai.state === 'configured' ? 'Review system status' : 'Review setup'}
              <ArrowUpRight size={14} />
            </button>
          </div>
          <nav className="utility-nav" aria-label="Account navigation">
            <button
              className={page === 'settings' ? 'active' : ''}
              onClick={() => navigate('settings')}
            >
              <SettingsIcon size={18} strokeWidth={1.7} />
              <span>Settings</span>
            </button>
            <button
              className={page === 'status' ? 'active' : ''}
              onClick={() => navigate('status')}
            >
              <Activity size={18} strokeWidth={1.7} />
              <span>System status</span>
              <span
                className={`status-dot ${status.data?.database.state === 'healthy' ? 'healthy' : ''}`}
              />
            </button>
            <button onClick={() => setHelp(true)}>
              <HelpCircle size={18} strokeWidth={1.7} />
              <span>Help & setup</span>
            </button>
          </nav>
          <div className="sidebar-user">
            <span className="avatar">{owner.display_name.slice(0, 1).toUpperCase()}</span>
            <button className="user-menu-trigger" onClick={() => setAccountMenu(!accountMenu)}>
              <strong>{owner.display_name}</strong>
              <span>Your private space</span>
            </button>
            <IconButton label="Account menu" onClick={() => setAccountMenu(!accountMenu)}>
              <ChevronDown size={15} />
            </IconButton>
            {accountMenu && (
              <div className="account-menu">
                <p>{owner.email}</p>
                <button onClick={() => navigate('settings')}>
                  <SettingsIcon size={15} />
                  Account settings
                </button>
                <button onClick={() => void signOut()}>
                  <LogOut size={15} />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </aside>
        <div className="app-main">
          <header className="topbar">
            <div className="breadcrumb">
              <IconButton
                label="Open navigation"
                className="mobile-menu"
                onClick={() => setSidebar(true)}
              >
                <Menu size={20} />
              </IconButton>
              <span className="breadcrumb-home">Your space</span>
              <span className="breadcrumb-divider">/</span>
              <strong>{selected.label}</strong>
            </div>
            <div className="topbar-actions">
              <button
                className="global-search"
                aria-label="Find anything"
                onClick={() => setSearch(true)}
              >
                <Search size={16} />
                <span>Find anything</span>
                <kbd>⌘ K</kbd>
              </button>
              <IconButton
                label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
                onClick={() => void toggleTheme()}
              >
                {dark ? <Sun size={19} /> : <Moon size={18} />}
              </IconButton>
              <div className="activity-menu-wrap">
                <IconButton label="Recent activity" onClick={() => setActivity(!activity)}>
                  <Bell size={18} />
                </IconButton>
                {activity && (
                  <div className="activity-popover">
                    <h3>Recent activity</h3>
                    {overview.data?.activity.length ? (
                      overview.data.activity.map((a) => (
                        <div key={a.id}>
                          <span className="small-dot" />
                          <p>
                            {activityLabel(a.action)}
                            <time>{dateLabel(a.created_at, settings.timezone, true)}</time>
                          </p>
                        </div>
                      ))
                    ) : (
                      <p>No recent activity recorded.</p>
                    )}
                    {approvalCount > 0 && (
                      <Button variant="ghost" onClick={() => navigate('approvals')}>
                        {approvalCount} proposals to review
                        <ArrowRight size={14} />
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <span className="topbar-avatar avatar" title={owner.display_name}>
                {owner.display_name.slice(0, 1).toUpperCase()}
              </span>
            </div>
          </header>
          <main className="page-content" id="main-content" key={page}>
            {renderPage()}
          </main>
        </div>
        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
          {mainNav
            .filter((n) => ['overview', 'conversation', 'tasks'].includes(n.id))
            .map((n) => (
              <button
                key={n.id}
                className={page === n.id ? 'active' : ''}
                onClick={() => navigate(n.id)}
              >
                <n.icon size={20} />
                <span>{n.label}</span>
              </button>
            ))}
          <button className={sidebar ? 'active' : ''} onClick={() => setSidebar(true)}>
            <Menu size={20} />
            <span>More</span>
          </button>
        </nav>
        {editor && <RecordEditor editor={editor} onClose={() => setEditor(null)} />}{' '}
        {search && (
          <GlobalSearch
            onClose={() => setSearch(false)}
            navigate={navigate}
            openTask={openTask}
            openMemory={openMemory}
            openProject={openProject}
          />
        )}{' '}
        {help && (
          <Help
            onClose={() => setHelp(false)}
            onStatus={() => {
              setHelp(false);
              navigate('status');
            }}
          />
        )}{' '}
        {toast && (
          <div
            className={`toast ${toast.error ? 'error' : ''}`}
            role={toast.error ? 'alert' : 'status'}
          >
            {toast.error ? <ShieldCheck size={18} /> : <Check size={18} />}
            <span>{toast.text}</span>
            <IconButton label="Dismiss notification" onClick={() => setToast(null)}>
              <X size={16} />
            </IconButton>
          </div>
        )}
      </div>
    </AppContext.Provider>
  );
}
function GlobalSearch({
  onClose,
  navigate,
  openTask,
  openMemory,
  openProject,
}: {
  onClose: () => void;
  navigate: (page: Page) => void;
  openTask: (t: Task) => void;
  openMemory: (m: Memory) => void;
  openProject: (p: Project) => void;
}) {
  const [query, setQuery] = useState(''),
    r = useResource<{ tasks: Task[]; memories: Memory[]; projects: Project[] }>(
      query.trim().length > 1 ? '/search?q=' + encodeURIComponent(query) : null,
    );
  function choose(kind: 'task' | 'memory' | 'project', record: any) {
    onClose();
    navigate(kind === 'task' ? 'tasks' : kind === 'project' ? 'projects' : 'memory');
    (kind === 'task' ? openTask : kind === 'project' ? openProject : openMemory)(record);
  }
  return (
    <Modal
      title="Find a thread"
      description="Search your actual tasks, projects, and memories."
      onClose={onClose}
    >
      <div className="global-search-body">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="An idea, a project, something you remember…"
        />
        {r.error ? (
          <ErrorState message={r.error} retry={r.reload} />
        ) : query.trim().length < 2 ? (
          <div className="search-tip">
            <Search size={22} />
            <p>Start typing to retrieve relevant records.</p>
            <span>Only your authenticated account is searched.</span>
          </div>
        ) : r.loading ? (
          <div className="search-tip">
            <Loader2 className="spin" size={23} />
            <p>Searching persistent records…</p>
          </div>
        ) : (
          <div className="global-search-results">
            {r.data?.tasks.map((t) => (
              <button key={t.id} onClick={() => choose('task', t)}>
                <CheckCircle2 size={18} />
                <div>
                  <strong>{t.title}</strong>
                  <span>Task · {t.status.replaceAll('_', ' ')}</span>
                </div>
                <ArrowUpRight size={15} />
              </button>
            ))}
            {r.data?.projects.map((p) => (
              <button key={p.id} onClick={() => choose('project', p)}>
                <Folder size={18} />
                <div>
                  <strong>{p.name}</strong>
                  <span>Project · {p.status}</span>
                </div>
                <ArrowUpRight size={15} />
              </button>
            ))}
            {r.data?.memories.map((m) => (
              <button key={m.id} onClick={() => choose('memory', m)}>
                <Brain size={18} />
                <div>
                  <strong>{m.content}</strong>
                  <span>Memory · {m.confidence.replaceAll('_', ' ')}</span>
                </div>
                <ArrowUpRight size={15} />
              </button>
            ))}
            {r.data &&
              !r.data.tasks.length &&
              !r.data.projects.length &&
              !r.data.memories.length && (
                <p className="search-tip">No matching records. Try a different term.</p>
              )}
          </div>
        )}
      </div>
    </Modal>
  );
}
function Help({ onClose, onStatus }: { onClose: () => void; onStatus: () => void }) {
  return (
    <Modal
      title="A little help getting connected"
      description="Your companion is real software. Live providers need your configuration and authorization."
      onClose={onClose}
    >
      <div className="form-body help-body">
        <h3>Your private space works independently</h3>
        <p>
          Tasks, projects, memory, schedules, approvals, export and deletion are backed by
          PostgreSQL. AI or telephone credentials are not needed for these management features.
        </p>
        <h3>To add real conversations</h3>
        <p>
          Configure OpenAI on the server, supply pricing estimates and enable the live AI switch.
          Browser voice uses a real microphone and WebRTC; telephone conversations use Twilio and
          native μ-law streaming.
        </p>
        <h3>To receive check-in calls</h3>
        <p>
          Deploy with HTTPS and production PostgreSQL, provision a Twilio number, configure signed
          webhooks, save your number and set a phone PIN. Verify an incoming call, then explicitly
          consent to outbound calls in Settings.
        </p>
        <h3>Where to find the complete guide</h3>
        <p>
          The repository contains <code>README.md</code>, <code>docs/DEPLOYMENT.md</code>,{' '}
          <code>docs/SECURITY.md</code>, and <code>docs/VERIFICATION.md</code>. No live integrations
          are claimed before they are tested.
        </p>
        <p className="help-links">
          {['README.md', 'DEPLOYMENT.md', 'SECURITY.md', 'VERIFICATION.md'].map((name) => (
            <a key={name} href={'/docs/' + name} target="_blank" rel="noopener noreferrer">
              {name}
              <ArrowUpRight size={12} />
            </a>
          ))}
        </p>
        <PrivacyNote>
          No audio recordings. No third-party calling. No automatic spending.
        </PrivacyNote>
      </div>
      <div className="form-footer">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button onClick={onStatus}>
          Review system status
          <ArrowRight size={15} />
        </Button>
      </div>
    </Modal>
  );
}
