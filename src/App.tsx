import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Command,
  ExternalLink,
  FileText,
  LayoutDashboard,
  Leaf,
  Loader2,
  LogOut,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  Users,
  X,
  AlertCircle,
  Inbox,
  PanelLeftClose,
  RefreshCw,
} from 'lucide-react';
import { api, setAuth, type Config } from './api';
import { stages } from '../shared/constants';
import type { Bootstrap, Lead, Run, Task } from '../shared/types';

const money = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
const compactMoney = (value: number) =>
  value >= 100000 ? `₹${(value / 100000).toFixed(1)}L` : money(value);
const date = (value: string) =>
  new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const initials = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('');
type Page = 'Overview' | 'Leads' | 'Reviews' | 'Tasks';
const pageCopy: Record<Page, string> = {
  Overview: 'A little clarity for every opportunity.',
  Leads: 'Good relationships start with the next conversation.',
  Reviews: 'Your agent does the groundwork. You make the call.',
  Tasks: 'Small next steps. Meaningful progress.',
};

function Status({ stage }: { stage: string }) {
  return (
    <span className={`status status-${stage.toLowerCase()}`}>
      <span />
      {stage}
    </span>
  );
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <Inbox size={27} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusables = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,textarea,a[href]',
        ) || [],
      );
    focusables()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key === 'Tab') {
        const nodes = focusables();
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className={`modal-backdrop ${wide ? 'drawer-backdrop' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? 'drawer' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function App() {
  const [config, setConfig] = useState<Config>();
  const [client, setClient] = useState<SupabaseClient>();
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Config>('/config')
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!config || config.mode === 'demo') return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    import('@supabase/supabase-js')
      .then(({ createClient }) => {
        if (disposed) return;
        const supabase = createClient(config.supabaseUrl, config.supabaseKey);
        setAuth(supabase);
        setClient(supabase);
        supabase.auth.getSession().then(({ data }) => {
          if (!disposed) setSignedIn(Boolean(data.session));
        });
        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
          if (!disposed) setSignedIn(Boolean(session));
        });
        unsubscribe = () => data.subscription.unsubscribe();
      })
      .catch(() => {
        if (!disposed) setError('Could not load sign-in. Please refresh the page.');
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [config]);
  if (error)
    return (
      <div className="startup">
        <AlertCircle />
        <h2>Couldn’t reach LeadDesk</h2>
        <p>{error}</p>
        <button className="button primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  if (!config)
    return (
      <div className="startup">
        <Loader2 className="spin" />
        <p>Opening your workspace…</p>
      </div>
    );
  if (config.mode === 'supabase' && !signedIn) return <Login client={client} />;
  return (
    <Workspace
      onLogout={
        client
          ? () => {
              void client.auth.signOut();
            }
          : undefined
      }
    />
  );
}

function Login({ client }: { client?: SupabaseClient }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!client) return;
    setBusy(true);
    setError('');
    const values = new FormData(e.currentTarget);
    try {
      const { error } = await client.auth.signInWithPassword({
        email: String(values.get('email')),
        password: String(values.get('password')),
      });
      if (error) setError(error.message);
    } catch {
      setError('Could not sign in. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-story">
        <div className="brand">
          <span className="brand-mark">
            <Leaf />
          </span>
          LeadDesk<span className="brand-dot">.</span>
        </div>
        <div>
          <p className="eyebrow">LESS BUSYWORK. MORE MOMENTUM.</p>
          <h1>
            Every lead,
            <br />a next step.
          </h1>
          <p>
            A thoughtful workspace for relationships,
            <br />
            opportunities, and a little help from AI.
          </p>
        </div>
        <small>Built for teams that care about the details.</small>
      </div>
      <main className="login-form">
        <div>
          <span className="eyebrow">YOUR WORKSPACE AWAITS</span>
          <h2>Welcome back.</h2>
          <p className="muted">Sign in to pick up where you left off.</p>
          <form onSubmit={submit}>
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@studio.com"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                minLength={6}
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button disabled={busy || !client} className="button primary">
              {busy ? <Loader2 className="spin" size={16} /> : null}Sign in <ArrowRight size={16} />
            </button>
          </form>
          <p className="login-note">Workspace access is managed by your administrator.</p>
        </div>
      </main>
    </div>
  );
}

function Workspace({ onLogout }: { onLogout?: () => void }) {
  const [data, setData] = useState<Bootstrap>();
  const [page, setPage] = useState<Page>('Overview');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All leads');
  const [newLead, setNewLead] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const next = await api<Bootstrap>('/workspace');
    setData(next);
  }, []);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [refresh]);
  const hasRunning = data?.runs.some((r) => r.status === 'running');
  useEffect(() => {
    if (!hasRunning) return;
    const timer = setInterval(() => {
      refresh().catch((e) => setError(e.message));
    }, 4000);
    return () => clearInterval(timer);
  }, [hasRunning, refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  async function mutate(path: string, body: unknown, message: string, method = 'POST') {
    setBusy(true);
    setError('');
    try {
      await api(path, body, method);
      await refresh();
      setToast(message);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function navigate(next: Page) {
    setPage(next);
    setQuery('');
    setFilter('All leads');
  }
  const leads =
    data?.leads.filter(
      (l) =>
        (filter === 'All leads' || l.stage === filter) &&
        `${l.company} ${l.contact} ${l.email}`.toLowerCase().includes(query.toLowerCase()),
    ) || [];
  const selected = data?.leads.find((l) => l.id === selectedId);
  const pending = data?.runs.filter((r) => r.status === 'awaiting_review') || [];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('Overview');
          }}
        >
          <span className="brand-mark">
            <Leaf size={21} />
          </span>
          LeadDesk<span className="brand-dot">.</span>
        </a>
        <div className="workspace-switch">
          <span className="studio-mark">
            {initials(data?.context.workspaceName || 'Studio North')}
          </span>
          <div>
            <strong>{data?.context.workspaceName || 'Your workspace'}</strong>
            <small>Agency workspace</small>
          </div>
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {(
            [
              { name: 'Overview', icon: LayoutDashboard },
              { name: 'Leads', icon: Users },
              { name: 'Reviews', icon: Sparkles },
              { name: 'Tasks', icon: CheckCheck },
            ] as const
          ).map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={`nav-item ${page === name ? 'active' : ''}`}
              onClick={() => navigate(name)}
            >
              <Icon size={18} />
              <span>{name}</span>
              {name === 'Reviews' && pending.length > 0 && (
                <span className="nav-count">{pending.length}</span>
              )}
              {name === 'Tasks' && Boolean(data?.dashboard.overdue) && (
                <span className="overdue-dot" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="agent-note">
            <span className="agent-symbol">
              <Sparkles size={17} />
            </span>
            <strong>A thoughtful second look.</strong>
            <p>
              Turn an inquiry into a clear,
              <br />
              reviewable next step.
            </p>
            <button onClick={() => navigate('Leads')}>
              Explore your leads <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="profile">
            <span className="avatar">{initials(data?.context.name || 'You')}</span>
            <div>
              <strong>{data?.context.name || 'Your account'}</strong>
              <small>{data?.context.role === 'sales' ? 'Salesperson' : 'Workspace admin'}</small>
            </div>
            {onLogout && (
              <button className="icon-button" aria-label="Sign out" onClick={onLogout}>
                <LogOut size={17} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <PanelLeftClose size={17} />
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-right">
            <span className={`environment-pill ${data?.mode === 'demo' ? 'demo' : ''}`}>
              <span />
              {data?.mode === 'demo' ? 'Local demo' : 'Connected workspace'}
            </span>
            <span className="avatar small">{initials(data?.context.name || 'You')}</span>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === 'Overview' ? 'YOUR PIPELINE, IN PERSPECTIVE' : 'MAKE THE NEXT STEP COUNT'}
              </div>
              <h1>
                {page === 'Overview'
                  ? 'A clearer view. A better next step.'
                  : page === 'Reviews'
                    ? 'A second look, before the next step.'
                    : page === 'Tasks'
                      ? 'Make room for what’s next.'
                      : 'Relationships in the making.'}
              </h1>
              <p>{pageCopy[page]}</p>
            </div>
            <button className="button primary" onClick={() => setNewLead(true)}>
              <Plus size={17} />
              New lead
            </button>
          </div>
          {data?.mode === 'demo' && (
            <div className="demo-strip">
              <span>
                <span className="demo-dot" />
                Demo workspace · Changes are saved locally. Agent results are simulated.
              </span>
              <span>
                Explore the flow <ArrowDownLeft size={13} />
              </span>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={17} />
              <span>{error}</span>
              <button
                className="icon-button"
                onClick={() => setError('')}
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!data ? (
            <div className="loading-panel">
              {error ? (
                <button
                  className="button"
                  onClick={() =>
                    refresh()
                      .then(() => setError(''))
                      .catch((e) => setError(e.message))
                  }
                >
                  <RefreshCw size={16} />
                  Retry
                </button>
              ) : (
                <>
                  <Loader2 className="spin" />
                  <span>Loading your workspace…</span>
                </>
              )}
            </div>
          ) : (
            <>
              {page === 'Overview' && (
                <Overview
                  data={data}
                  onLead={setSelectedId}
                  onPage={navigate}
                  onStage={(stage) => {
                    navigate('Leads');
                    setFilter(stage);
                  }}
                />
              )}
              {page === 'Leads' && (
                <section className="panel leads-panel">
                  <div className="list-toolbar">
                    <div className="tabs">
                      {['All leads', 'New', 'Qualified', 'Proposal'].map((value) => (
                        <button
                          key={value}
                          className={filter === value ? 'selected' : ''}
                          onClick={() => setFilter(value)}
                        >
                          {value}
                          {value === 'All leads' && <span>{data.leads.length}</span>}
                        </button>
                      ))}
                    </div>
                    <div className="list-controls">
                      <label className="search-input">
                        <Search size={16} />
                        <input
                          aria-label="Search leads"
                          placeholder="Search leads…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                      <select
                        aria-label="Filter by stage"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option>All leads</option>
                        {stages.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <LeadTable leads={leads} onLead={setSelectedId} />
                  <div className="table-footer">
                    {leads.length} {leads.length === 1 ? 'relationship' : 'relationships'} · Sorted
                    by newest first<span>One conversation at a time.</span>
                  </div>
                </section>
              )}
              {page === 'Reviews' && (
                <>
                  <div className="review-summary">
                    <span className="agent-symbol">
                      <Sparkles size={20} />
                    </span>
                    <div>
                      <h3>
                        {pending.length
                          ? `${pending.length} suggestion${pending.length > 1 ? 's' : ''} ready for your review`
                          : 'You’re all caught up'}
                      </h3>
                      <p>
                        Check the evidence, edit the draft, and approve a follow-up. Nothing is sent
                        automatically.
                      </p>
                    </div>
                  </div>
                  <div className="review-grid">
                    {pending.map((run) => {
                      const lead = data.leads.find((l) => l.id === run.lead_id)!;
                      return (
                        <button
                          className="review-card panel"
                          key={run.id}
                          onClick={() => setSelectedId(lead.id)}
                        >
                          <div className="review-card-top">
                            <span className="company-avatar">{initials(lead.company)}</span>
                            <span className="mini-tag">
                              {run.mode === 'demo' ? 'SIMULATED' : 'QUALIFICATION'}
                            </span>
                          </div>
                          <h3>{lead.company}</h3>
                          <p>{run.recommendation?.summary}</p>
                          <div className="review-card-bottom">
                            <span>
                              <FileText size={14} />
                              {run.recommendation?.evidence.length} sources
                            </span>
                            <span>
                              Review suggestion <ArrowRight size={15} />
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {!pending.length && (
                    <div className="panel">
                      <Empty title="A little space to breathe.">
                        Run qualification from a lead to see its suggested next step here.
                      </Empty>
                    </div>
                  )}
                  <AgentStats data={data} />
                  <RunHistory data={data} onLead={setSelectedId} />
                </>
              )}
              {page === 'Tasks' && (
                <Tasks
                  data={data}
                  busy={busy}
                  onToggle={(task, complete) =>
                    mutate(
                      `/tasks/${task.id}`,
                      { complete },
                      complete ? 'Task completed. Nice work.' : 'Task reopened.',
                      'PATCH',
                    )
                  }
                  onLead={setSelectedId}
                />
              )}
              <footer className="page-footer">
                <span>
                  <Leaf size={13} />A little structure. A lot more possibility.
                </span>
                <span>LeadDesk / Your next step starts here</span>
              </footer>
            </>
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {newLead && (
        <NewLead
          busy={busy}
          error={error}
          onClose={() => !busy && setNewLead(false)}
          onSubmit={async (input) => {
            if (await mutate('/leads', input, 'A new relationship, ready to grow.')) {
              setNewLead(false);
              navigate('Leads');
            }
          }}
        />
      )}
      {selected && data && (
        <LeadDrawer
          lead={selected}
          data={data}
          busy={busy}
          error={error}
          onClose={() => !busy && setSelectedId(undefined)}
          mutate={mutate}
        />
      )}
    </div>
  );
}

function Overview({
  data,
  onLead,
  onPage,
  onStage,
}: {
  data: Bootstrap;
  onLead: (id: string) => void;
  onPage: (page: Page) => void;
  onStage: (stage: string) => void;
}) {
  const d = data.dashboard;
  const open = data.leads.filter((l) => !['Won', 'Lost'].includes(l.stage));
  const max = Math.max(...d.stageCounts.map((s) => s.count), 1);
  const pending = data.runs.filter((r) => r.status === 'awaiting_review');
  const tasks = data.tasks.filter((t) => !t.completed_at).slice(0, 3);
  return (
    <>
      <div className="section-kicker">
        <span>
          <span className="live-dot" />
          Workspace at a glance
        </span>
        <span>
          Current snapshot <ChevronDown size={13} />
        </span>
      </div>
      <div className="stats-grid">
        <Metric
          label="Open pipeline"
          value={compactMoney(d.openValue)}
          icon={<BarChart3 size={17} />}
          foot={`${open.length} opportunities in motion`}
        />
        <Metric
          label="Won deal value"
          value={compactMoney(d.wonValue)}
          icon={<ArrowUpRight size={18} />}
          foot={`${data.leads.filter((l) => l.stage === 'Won').length} relationships turned into projects`}
        />
        <Metric
          label="Closed win rate"
          value={d.winRate === null ? '—' : `${d.winRate}%`}
          icon={<CheckCircle2 size={17} />}
          foot="Won ÷ all closed opportunities"
        />
        <Metric
          label="Needs your attention"
          value={String(d.pending + d.overdue).padStart(2, '0')}
          icon={<Clock3 size={17} />}
          foot={`${d.pending} reviews · ${d.overdue} overdue tasks`}
          attention={Boolean(d.pending + d.overdue)}
        />
      </div>
      <div className="overview-grid">
        <section className="panel pipeline-panel">
          <div className="panel-heading">
            <div>
              <h2>Room to grow</h2>
              <p>Your opportunities, from hello to handoff.</p>
            </div>
            <span className="subtle-pill">{data.leads.length} leads</span>
          </div>
          <div className="pipeline-chart">
            {d.stageCounts.map((s, i) => (
              <button
                key={s.stage}
                className="chart-column"
                onClick={() => onStage(s.stage)}
                aria-label={`${s.stage}: ${s.count} leads, ${money(s.value)}`}
              >
                <span className="bar-value">{s.count}</span>
                <div className="bar-track">
                  <div
                    className={`bar bar-${i}`}
                    style={{ height: `${Math.max((s.count / max) * 100, 3)}%` }}
                  />
                </div>
                <span className="bar-label">{s.stage}</span>
              </button>
            ))}
          </div>
          <div className="chart-footer">
            <span>
              <span className="live-dot" />
              Current stage distribution
            </span>
            <button className="text-button" onClick={() => onPage('Leads')}>
              Explore pipeline <ArrowRight size={14} />
            </button>
          </div>
        </section>
        <section className="panel next-panel">
          <div className="panel-heading">
            <div>
              <h2>Your next moves</h2>
              <p>A short list. A clear direction.</p>
            </div>
            <span className="sun-symbol">✳</span>
          </div>
          <div className="next-list">
            {pending.length > 0 && (
              <button className="next-item agent-next" onClick={() => onPage('Reviews')}>
                <span className="next-icon">
                  <Sparkles size={18} />
                </span>
                <div>
                  <strong>Give your agent’s work a look</strong>
                  <small>
                    {pending.length} suggestion{pending.length > 1 ? 's' : ''} awaiting your review
                  </small>
                </div>
                <ChevronRight size={16} />
              </button>
            )}
            {tasks.map((task) => (
              <button className="next-item" key={task.id} onClick={() => onPage('Tasks')}>
                <span className="next-icon">
                  <Clock3 size={17} />
                </span>
                <div>
                  <strong>{task.title}</strong>
                  <small className={Date.parse(task.due_at) < Date.now() ? 'overdue-text' : ''}>
                    {data.leads.find((l) => l.id === task.lead_id)?.company} ·{' '}
                    {Date.parse(task.due_at) < Date.now() ? 'Overdue' : `Due ${date(task.due_at)}`}
                  </small>
                </div>
                <ChevronRight size={16} />
              </button>
            ))}
            {!tasks.length && !pending.length && (
              <Empty title="All clear for now">Your next steps will appear here.</Empty>
            )}
          </div>
          <button className="next-footer" onClick={() => onPage('Tasks')}>
            View all tasks <ArrowRight size={15} />
          </button>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Fresh conversations</h2>
            <p>A few relationships worth keeping close.</p>
          </div>
          <button className="text-button" onClick={() => onPage('Leads')}>
            All leads <ArrowUpRight size={16} />
          </button>
        </div>
        <LeadTable leads={data.leads.slice(0, 5)} onLead={onLead} />
      </section>
    </>
  );
}
function Metric({
  label,
  value,
  icon,
  foot,
  attention = false,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  foot: string;
  attention?: boolean;
}) {
  return (
    <div className={`metric panel ${attention ? 'metric-attention' : ''}`}>
      <div className="metric-label">
        {label}
        <span>{icon}</span>
      </div>
      <strong className="metric-value">{value}</strong>
      <p>{foot}</p>
    </div>
  );
}
function LeadTable({ leads, onLead }: { leads: Lead[]; onLead: (id: string) => void }) {
  return leads.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Company & contact</th>
            <th>Stage</th>
            <th>Potential value</th>
            <th>Source</th>
            <th>Added</th>
            <th>
              <span className="sr-only">Open lead</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead, i) => (
            <tr key={lead.id}>
              <td>
                <button className="company-cell" onClick={() => onLead(lead.id)}>
                  <span className={`company-avatar tone-${i % 4}`}>{initials(lead.company)}</span>
                  <span>
                    <strong>{lead.company}</strong>
                    <small>{lead.contact}</small>
                  </span>
                </button>
              </td>
              <td>
                <Status stage={lead.stage} />
              </td>
              <td className="value-cell">{lead.value ? money(lead.value) : 'Not set'}</td>
              <td>
                <span className="source">{lead.source}</span>
              </td>
              <td className="muted">{date(lead.created_at)}</td>
              <td>
                <button
                  className="icon-button"
                  aria-label={`Open ${lead.company}`}
                  onClick={() => onLead(lead.id)}
                >
                  <ArrowUpRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="No leads here yet">Add an inquiry or try a different search.</Empty>
  );
}

function AgentStats({ data }: { data: Bootstrap }) {
  const completed = data.runs.filter((r) => r.completed_at);
  const duration = completed.length
    ? Math.round(
        completed.reduce((s, r) => s + Date.parse(r.completed_at!) - Date.parse(r.created_at), 0) /
          completed.length /
          1000,
      )
    : null;
  return (
    <div className="agent-stats">
      <Metric
        label="Qualifications"
        value={String(data.runs.length)}
        icon={<Sparkles size={17} />}
        foot="All recorded runs"
      />
      <Metric
        label="Accepted suggestions"
        value={
          data.dashboard.reviewed
            ? `${Math.round((data.dashboard.approved / data.dashboard.reviewed) * 100)}%`
            : '—'
        }
        icon={<CheckCircle2 size={17} />}
        foot={`${data.dashboard.reviewed} reviewed · pending excluded`}
      />
      <Metric
        label="Average run time"
        value={duration === null ? '—' : `${duration}s`}
        icon={<Clock3 size={17} />}
        foot={
          data.mode === 'demo'
            ? 'Simulated runs · not model performance'
            : `${completed.length} finished runs`
        }
      />
    </div>
  );
}
function RunHistory({ data, onLead }: { data: Bootstrap; onLead: (id: string) => void }) {
  const history = data.runs.filter((r) => r.status !== 'awaiting_review');
  return history.length ? (
    <section className="panel history-panel">
      <div className="panel-heading">
        <h2>Qualification history</h2>
      </div>
      {history.map((run) => (
        <button className="history-row" key={run.id} onClick={() => onLead(run.lead_id)}>
          <span>
            <strong>{data.leads.find((l) => l.id === run.lead_id)?.company}</strong>
            <small>
              {run.error ||
                `${date(run.created_at)} · ${run.mode === 'demo' ? 'Simulated' : 'n8n agent'}`}
            </small>
          </span>
          <span className={`run-status ${run.status}`}>{run.status.replace('_', ' ')}</span>
          <ChevronRight size={15} />
        </button>
      ))}
    </section>
  ) : null;
}

function Tasks({
  data,
  busy,
  onToggle,
  onLead,
}: {
  data: Bootstrap;
  busy: boolean;
  onToggle: (task: Task, complete: boolean) => Promise<boolean>;
  onLead: (id: string) => void;
}) {
  const [view, setView] = useState('Open');
  const [expanded, setExpanded] = useState<string>();
  const [copyStatus, setCopyStatus] = useState('');
  const tasks = data.tasks
    .filter((t) => (view === 'Completed' ? t.completed_at : !t.completed_at))
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus('Draft copied.');
    } catch {
      setCopyStatus('Could not copy automatically. Select and copy the draft below.');
    }
  }
  return (
    <section className="panel">
      <div className="list-toolbar">
        <div className="tabs">
          {['Open', 'Completed'].map((v) => (
            <button key={v} className={view === v ? 'selected' : ''} onClick={() => setView(v)}>
              {v}
              <span>
                {
                  data.tasks.filter((t) => (v === 'Completed' ? t.completed_at : !t.completed_at))
                    .length
                }
              </span>
            </button>
          ))}
        </div>
        <span className="muted small-text">A task at a time.</span>
      </div>
      {tasks.length ? (
        tasks.map((task) => (
          <div key={task.id} className="task-wrapper">
            <div className="task-row">
              <button
                disabled={busy}
                className={`task-check ${task.completed_at ? 'checked' : ''}`}
                onClick={() => onToggle(task, !task.completed_at)}
                aria-label={`${task.completed_at ? 'Reopen' : 'Complete'} ${task.title}`}
              >
                {task.completed_at && <Check size={14} />}
              </button>
              <div className="task-main">
                <strong>{task.title}</strong>
                <button onClick={() => onLead(task.lead_id)}>
                  {data.leads.find((l) => l.id === task.lead_id)?.company}
                  <ArrowUpRight size={12} />
                </button>
              </div>
              <span
                className={`task-date ${!task.completed_at && Date.parse(task.due_at) < Date.now() ? 'overdue-text' : ''}`}
              >
                <Clock3 size={13} />
                {task.completed_at ? 'Completed' : `Due ${date(task.due_at)}`}
              </span>
              {task.draft && (
                <button
                  className="text-button"
                  onClick={() => {
                    setExpanded(expanded === task.id ? undefined : task.id);
                    setCopyStatus('');
                  }}
                >
                  Draft <ChevronDown size={14} />
                </button>
              )}
            </div>
            {expanded === task.id && (
              <div className="task-draft">
                <p>{task.draft}</p>
                <button className="button small-button" onClick={() => copy(task.draft)}>
                  Copy draft
                </button>
                <small role="status">
                  {copyStatus || 'Send this manually, then record a note on the lead.'}
                </small>
              </div>
            )}
          </div>
        ))
      ) : (
        <Empty title={view === 'Open' ? 'Nothing on your list.' : 'Progress will live here.'}>
          {view === 'Open'
            ? 'Approve an agent suggestion to create a follow-up task.'
            : 'Completed follow-ups will appear here.'}
        </Empty>
      )}
    </section>
  );
}

function NewLead({
  busy,
  error,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: unknown) => Promise<void>;
}) {
  return (
    <Modal title="Start a new conversation" onClose={onClose}>
      <p className="modal-description">
        Capture the essentials. You can work out the details together.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          void onSubmit({
            company: form.get('company'),
            contact: form.get('contact'),
            email: form.get('email'),
            value: Number(form.get('value')),
            source: form.get('source'),
            inquiry: form.get('inquiry'),
          });
        }}
      >
        <div className="form-grid">
          <label>
            Company
            <input
              name="company"
              placeholder="e.g. Forma Studio"
              minLength={2}
              maxLength={100}
              required
            />
          </label>
          <label>
            Contact name
            <input
              name="contact"
              placeholder="e.g. Maya Patel"
              minLength={2}
              maxLength={100}
              required
            />
          </label>
          <label>
            Email address
            <input name="email" type="email" placeholder="maya@studio.com" required />
          </label>
          <label>
            Potential value (₹)
            <input
              name="value"
              type="number"
              min={0}
              max={100000000}
              step={1}
              defaultValue={0}
              required
            />
          </label>
        </div>
        <label>
          Where did they find you?
          <select name="source">
            <option>Website</option>
            <option>Referral</option>
            <option>LinkedIn</option>
            <option>Other</option>
          </select>
        </label>
        <label>
          Project inquiry
          <textarea
            name="inquiry"
            rows={5}
            placeholder="What are they hoping to build? Paste the original inquiry here…"
            required
            minLength={15}
            maxLength={6000}
          />
        </label>
        <p className="field-hint">
          The qualification agent uses this inquiry as its starting point.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}Create lead
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Mutate = (path: string, body: unknown, message: string, method?: string) => Promise<boolean>;
function LeadDrawer({
  lead,
  data,
  busy,
  error,
  onClose,
  mutate,
}: {
  lead: Lead;
  data: Bootstrap;
  busy: boolean;
  error: string;
  onClose: () => void;
  mutate: Mutate;
}) {
  const [note, setNote] = useState('');
  const runs = data.runs.filter((r) => r.lead_id === lead.id);
  const pending =
    runs.find((r) => r.status === 'awaiting_review' && r.lead_revision === lead.revision) ||
    runs.find((r) => r.status === 'awaiting_review');
  const running = runs.some((r) => r.status === 'running');
  const failed = runs.find((r) => r.status === 'failed');
  const currentPending = pending?.lead_revision === lead.revision;
  return (
    <Modal title="Lead details" onClose={onClose} wide>
      <div className="lead-hero">
        <span className="company-avatar large">{initials(lead.company)}</span>
        <div>
          <h2>{lead.company}</h2>
          <p>
            {lead.contact} · <a href={`mailto:${lead.email}`}>{lead.email}</a>
          </p>
        </div>
      </div>
      <div className="lead-facts">
        <div>
          <span>Potential value</span>
          <strong>{lead.value ? money(lead.value) : 'Not set'}</strong>
        </div>
        <div>
          <span>Source</span>
          <strong>{lead.source}</strong>
        </div>
        <div>
          <label htmlFor="stage">Pipeline stage</label>
          <select
            id="stage"
            value={lead.stage}
            disabled={busy}
            onChange={(e) =>
              mutate(
                `/leads/${lead.id}/stage`,
                { stage: e.target.value, revision: lead.revision },
                'Pipeline updated.',
                'PATCH',
              )
            }
          >
            {stages.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <section className="drawer-section">
        <h3>In their words</h3>
        <p className="inquiry">{lead.inquiry}</p>
      </section>
      <section className="drawer-section agent-section">
        <div className="agent-section-title">
          <span>
            <Sparkles size={18} />
            <h3>Qualification assistant</h3>
          </span>
          <span className="mini-tag">{data.mode === 'demo' ? 'SIMULATED DEMO' : 'N8N AGENT'}</span>
        </div>
        <p className="muted">A grounded assessment and a suggested next step, for you to review.</p>
        {!pending && (
          <button
            className="button primary"
            disabled={busy || running || !data.agentEnabled || ['Won', 'Lost'].includes(lead.stage)}
            onClick={() =>
              mutate(
                `/leads/${lead.id}/qualify`,
                {},
                data.mode === 'demo'
                  ? 'Simulated suggestion is ready to review.'
                  : 'Qualification started. You can keep working.',
              )
            }
          >
            {running ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
            {running ? 'Reading the context…' : 'Qualify this lead'}
          </button>
        )}
        {!data.agentEnabled && (
          <p className="field-hint">
            Connect your n8n workflow to enable qualification. The setup steps are in README.md.
          </p>
        )}
        {failed && !pending && !running && <p className="form-error">{failed.error}</p>}
        {pending && (
          <ReviewForm
            key={pending.id}
            run={pending}
            stale={!currentPending}
            data={data}
            busy={busy}
            mutate={mutate}
          />
        )}
      </section>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <section className="drawer-section">
        <h3>Activity & notes</h3>
        <form
          className="note-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await mutate(`/leads/${lead.id}/notes`, { message: note }, 'Note added.'))
              setNote('');
          }}
        >
          <textarea
            aria-label="Add a note"
            placeholder="A conversation, an update, a detail worth remembering…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required
            maxLength={2000}
            rows={3}
          />
          <button className="button small-button" disabled={busy || !note.trim()}>
            <Plus size={14} />
            Add note
          </button>
        </form>
        <div className="timeline">
          {data.activities
            .filter((a) => a.lead_id === lead.id)
            .map((a) => (
              <div className="timeline-item" key={a.id}>
                <span className="timeline-dot" />
                <div>
                  <p>{a.message}</p>
                  <small>
                    {date(a.created_at)} ·{' '}
                    {new Date(a.created_at).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </small>
                </div>
              </div>
            ))}
        </div>
      </section>
    </Modal>
  );
}

function ReviewForm({
  run,
  stale,
  data,
  busy,
  mutate,
}: {
  run: Run;
  stale: boolean;
  data: Bootstrap;
  busy: boolean;
  mutate: Mutate;
}) {
  const result = run.recommendation!;
  const [title, setTitle] = useState(result.task_title);
  const [draft, setDraft] = useState(result.draft);
  return (
    <div className="review-detail">
      <span className={`fit-badge ${result.fit}`}>{result.fit.replaceAll('_', ' ')}</span>
      <p>{result.summary}</p>
      {result.missing.length > 0 && (
        <div className="missing">
          <strong>Worth clarifying</strong>
          <ul>
            {result.missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      <details className="evidence">
        <summary>
          <FileText size={14} />
          View supporting evidence <span>{result.evidence.length} sources</span>
        </summary>
        {result.evidence.map((item, i) => (
          <blockquote key={i}>
            <strong>
              {item.source_id === 'inquiry'
                ? 'Original inquiry'
                : data.knowledge.find((k) => k.id === item.source_id)?.title || 'Knowledge source'}
            </strong>
            <p>“{item.quote}”</p>
          </blockquote>
        ))}
      </details>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void mutate(
            `/reviews/${run.id}/decision`,
            { decision: 'approve', task_title: title, draft },
            'Approved. Your follow-up task is ready.',
          );
        }}
      >
        <label>
          Suggested follow-up
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            minLength={5}
            maxLength={160}
            required
          />
        </label>
        <label>
          Message draft <span className="optional">Make it your own</span>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            minLength={10}
            maxLength={3000}
            required
          />
        </label>
        {stale && (
          <p className="form-error">
            This lead changed after qualification. Dismiss this suggestion, then run qualification
            again.
          </p>
        )}
        <div className="review-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() =>
              mutate(`/reviews/${run.id}/decision`, { decision: 'reject' }, 'Suggestion dismissed.')
            }
          >
            Dismiss
          </button>
          <button className="button primary" disabled={busy || stale}>
            <Check size={16} />
            Approve & create task
          </button>
        </div>
        <p className="field-hint">Creates one task due tomorrow. No message is sent.</p>
      </form>
    </div>
  );
}
