import { useState, useCallback, useEffect, useRef, FormEvent } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, Field, Input, Select, Button, Alert, IconButton, Tooltip } from '@grafana/ui';
import { getBackendSrv } from '@grafana/runtime';
import { ChatView, ChatMessage } from '../components/ChatView';
import { streamChat, sendChat, ChatHistory } from '../api';
import { AnalysisContext, DashboardContext, DashboardPanelSummary } from '../context';
import { useChatSessions } from '../hooks/useChatSessions';
import { ChatSession, ChatSessionContext, generateSessionId, generateTitle } from '../utils/chatStorage';

interface DashboardSearchResult {
  uid: string;
  title: string;
  type: string;
  url: string;
}

interface GrafanaDashboard {
  dashboard: {
    uid: string;
    title: string;
    description?: string;
    tags?: string[];
    templating?: { list?: Array<{ name: string; current?: { text?: string; value?: string } }> };
    panels?: GrafanaPanel[];
    time?: { from: string; to: string };
  };
}

interface GrafanaPanel {
  id: number;
  title: string;
  type: string;
  targets?: Array<{ expr?: string; refId?: string }>;
  fieldConfig?: { defaults?: { thresholds?: unknown } };
  panels?: GrafanaPanel[]; // row panels contain nested panels
}

function flattenPanels(panels: GrafanaPanel[]): GrafanaPanel[] {
  const result: GrafanaPanel[] = [];
  for (const p of panels) {
    if (p.type === 'row' && p.panels) {
      result.push(...flattenPanels(p.panels));
    } else {
      result.push(p);
    }
  }
  return result;
}

function buildDashboardChatContext(data: GrafanaDashboard): AnalysisContext {
  const db = data.dashboard;
  const allPanels = flattenPanels(db.panels || []);

  const panelSummaries: DashboardPanelSummary[] = allPanels.map((p) => ({
    title: p.title,
    type: p.type,
    queries: p.targets?.map((t) => t.expr || t.refId || '').filter(Boolean),
  }));

  const variables = db.templating?.list?.map((v) => ({
    name: v.name,
    current: v.current?.text || v.current?.value || '',
  }));

  const dashCtx: DashboardContext = {
    title: db.title,
    description: db.description,
    tags: db.tags,
    variables,
    panels: panelSummaries,
    timeRange: db.time ? { from: db.time.from, to: db.time.to } : undefined,
  };

  return { dashboard: dashCtx };
}

export function DashboardChatPage() {
  const styles = useStyles2(getStyles);
  const { sessions, loading: sessionsLoading, loadSession, saveSession, deleteSession, exportSession } = useChatSessions();

  const [dashboards, setDashboards] = useState<DashboardSearchResult[]>([]);
  const [selectedUid, setSelectedUid] = useState<string>('');
  const [dashboardContext, setDashboardContext] = useState<AnalysisContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [activeToolCalls, setActiveToolCalls] = useState<Array<{ name: string; arguments: string }>>([]);
  const [contextTokens, setContextTokens] = useState(0);
  const [maxTokens, setMaxTokens] = useState(0);

  // Session management
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(true);

  const sessionIdRef = useRef(currentSessionId);
  sessionIdRef.current = currentSessionId;
  const abortRef = useRef<AbortController | null>(null);
  const createdAtRef = useRef(new Date().toISOString());

  // Fetch dashboard list
  useEffect(() => {
    getBackendSrv()
      .get('/api/search?type=dash-db&limit=50')
      .then((results: DashboardSearchResult[]) => setDashboards(results))
      .catch(() => setError('Failed to load dashboards'));

    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Load selected dashboard
  const loadDashboard = useCallback(
    async (uid: string) => {
      setLoading(true);
      setError(null);
      setMessages([]);
      setDashboardContext(null);

      try {
        const data: GrafanaDashboard = await getBackendSrv().get(`/api/dashboards/uid/${uid}`);
        const ctx = buildDashboardChatContext(data);
        setDashboardContext(ctx);

        const panelCount = ctx.dashboard?.panels?.length || 0;
        const queryCount = ctx.dashboard?.panels?.reduce((s, p) => s + (p.queries?.length || 0), 0) || 0;
        setMessages([
          {
            role: 'assistant',
            content: `📊 Loaded **${ctx.dashboard?.title}** — ${panelCount} panels, ${queryCount} queries.\n\nAsk me anything about this dashboard!`,
          },
        ]);
      } catch {
        setError('Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const autoSave = useCallback(
    async (updatedMessages: ChatMessage[], tokens?: number, maxTok?: number) => {
      if (updatedMessages.length === 0) {
        return;
      }

      const id = sessionIdRef.current || generateSessionId();
      if (!sessionIdRef.current) {
        setCurrentSessionId(id);
        sessionIdRef.current = id;
      }

      const ctx: ChatSessionContext = { dashboardUid: selectedUid };

      const session: ChatSession = {
        id,
        title: generateTitle(updatedMessages),
        mode: 'dashboard-chat',
        messages: updatedMessages,
        context: ctx,
        contextTokens: tokens ?? contextTokens,
        maxTokens: maxTok ?? maxTokens,
        createdAt: createdAtRef.current,
        updatedAt: new Date().toISOString(),
      };

      await saveSession(session);
    },
    [selectedUid, contextTokens, maxTokens, saveSession]
  );

  const startNewChat = useCallback(() => {
    abortRef.current?.abort();
    setCurrentSessionId(null);
    sessionIdRef.current = null;
    createdAtRef.current = new Date().toISOString();
    setMessages([]);
    setContextTokens(0);
    setMaxTokens(0);
    setError(null);
    setStreamContent('');
    setActiveToolCalls([]);
    setDashboardContext(null);
    setSelectedUid('');
  }, []);

  const handleLoadSession = useCallback(
    async (id: string) => {
      const session = await loadSession(id);
      if (!session) {
        return;
      }
      setCurrentSessionId(session.id);
      sessionIdRef.current = session.id;
      setMessages(session.messages);
      setContextTokens(session.contextTokens);
      setMaxTokens(session.maxTokens);
      setError(null);

      if (session.context.dashboardUid) {
        setSelectedUid(session.context.dashboardUid);
        // Load dashboard context directly without resetting messages
        try {
          const data: GrafanaDashboard = await getBackendSrv().get(`/api/dashboards/uid/${session.context.dashboardUid}`);
          setDashboardContext(buildDashboardChatContext(data));
        } catch {
          setError('Failed to load dashboard');
        }
      }
    },
    [loadSession]
  );

  const handleExportSession = useCallback(
    async (id: string) => {
      const json = await exportSession(id);
      if (!json) {
        return;
      }
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dashboard-chat-${id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [exportSession]
  );

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!prompt.trim() || isStreaming || !dashboardContext) {
        return;
      }

      setError(null);
      const userMessage: ChatMessage = { role: 'user', content: prompt };
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setPrompt('');
      setIsStreaming(true);
      setStreamContent('');
      setActiveToolCalls([]);

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const history: ChatHistory[] = messages.map((m) => ({ role: m.role, content: m.content }));

      let fullContent = '';
      let newContextTokens = contextTokens;
      let newMaxTokens = maxTokens;
      try {
        for await (const chunk of streamChat('summarize_dashboard', userMessage.content, dashboardContext, history, abortRef.current.signal)) {
          if (chunk.done) {
            if (chunk.contextTokens) {
              newContextTokens = chunk.contextTokens;
              setContextTokens(chunk.contextTokens);
            }
            if (chunk.maxTokens) {
              newMaxTokens = chunk.maxTokens;
              setMaxTokens(chunk.maxTokens);
            }
            break;
          }
          if (chunk.toolCall) {
            setActiveToolCalls((prev) => [...prev, chunk.toolCall!]);
            continue;
          }
          fullContent += chunk.content;
          setStreamContent(fullContent);
        }
      } catch (err: unknown) {
        if (!fullContent.trim()) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          setError(message);
          try {
            const resp = await sendChat('summarize_dashboard', userMessage.content, dashboardContext, history);
            if (resp.content?.trim()) {
              fullContent = resp.content;
            }
          } catch (fallbackErr: unknown) {
            const msg = fallbackErr instanceof Error ? fallbackErr.message : 'Request failed';
            setError(msg);
          }
        }
      } finally {
        const finalMessages = fullContent.trim()
          ? [...updatedMessages, { role: 'assistant' as const, content: fullContent }]
          : updatedMessages;
        setMessages(finalMessages);
        setIsStreaming(false);
        setStreamContent('');
        setActiveToolCalls([]);

        await autoSave(finalMessages, newContextTokens, newMaxTokens);
      }
    },
    [prompt, dashboardContext, isStreaming, messages, contextTokens, maxTokens, autoSave]
  );

  const dashboardOptions = dashboards.map((d) => ({ label: d.title, value: d.uid }));
  const dashSessions = sessions.filter((s) => s.mode === 'dashboard-chat');

  return (
    <div data-testid="dashboard-chat-page" className={styles.layout}>
      {/* Session sidebar */}
      {showSessions && (
        <div data-testid="session-sidebar" className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <h4 className={styles.sidebarTitle}>Sessions</h4>
            <Tooltip content="New chat">
              <IconButton name="plus" aria-label="New chat" onClick={startNewChat} size="md" />
            </Tooltip>
          </div>

          {sessionsLoading && <p className={styles.sidebarHint}>Loading...</p>}

          {!sessionsLoading && dashSessions.length === 0 && (
            <p className={styles.sidebarHint}>No saved sessions yet</p>
          )}

          <div className={styles.sessionList}>
            {dashSessions.map((s) => (
              <div
                key={s.id}
                data-testid="session-item"
                className={`${styles.sessionItem} ${s.id === currentSessionId ? styles.sessionActive : ''}`}
                onClick={() => handleLoadSession(s.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleLoadSession(s.id)}
              >
                <div className={styles.sessionTitle}>{s.title}</div>
                <div className={styles.sessionMeta}>
                  {s.messageCount} msgs · {new Date(s.updatedAt).toLocaleDateString()}
                </div>
                <div className={styles.sessionActions}>
                  <Tooltip content="Export">
                    <IconButton
                      name="download-alt"
                      aria-label="Export session"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExportSession(s.id);
                      }}
                    />
                  </Tooltip>
                  <Tooltip content="Delete">
                    <IconButton
                      name="trash-alt"
                      aria-label="Delete session"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSession(s.id);
                        if (currentSessionId === s.id) {
                          startNewChat();
                        }
                      }}
                    />
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main chat area */}
      <div className={styles.main}>
        <div className={styles.header}>
          <Tooltip content={showSessions ? 'Hide sessions' : 'Show sessions'}>
            <IconButton
              name={showSessions ? 'angle-double-left' : 'angle-double-right'}
              aria-label="Toggle sessions"
              onClick={() => setShowSessions(!showSessions)}
              size="lg"
            />
          </Tooltip>
          <h2 className={styles.heading}>💬 Chat with Dashboard</h2>
        </div>

        <p className={styles.subtitle}>Select a dashboard and ask questions about its panels, queries, and data.</p>

        {error && (
          <Alert severity="error" title="Error">
            {error}
          </Alert>
        )}

        <Field label="Dashboard">
          <Select
            options={dashboardOptions}
            value={dashboardOptions.find((o) => o.value === selectedUid)}
            onChange={(v) => {
              if (v.value) {
                setSelectedUid(v.value);
                loadDashboard(v.value);
              }
            }}
            placeholder="Select a dashboard..."
            width={50}
            isLoading={dashboards.length === 0}
          />
        </Field>

        {dashboardContext && !isStreaming && (
          <div className={styles.quickActions}>
            <Button
              variant="secondary"
              size="sm"
              icon="document-info"
              onClick={() => {
                setPrompt('Explain this dashboard in detail: what each panel shows, key metrics to watch, and how they relate to each other.');
              }}
            >
              Explain Dashboard
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon="bolt"
              onClick={() => {
                setPrompt('What looks unusual or concerning on this dashboard right now? Query the actual metrics and check for anomalies.');
              }}
            >
              Find Anomalies
            </Button>
          </div>
        )}

        {loading && <p>Loading dashboard...</p>}

        <ChatView messages={messages} isStreaming={isStreaming} streamContent={streamContent} activeToolCalls={activeToolCalls} />

        {maxTokens > 0 && (
          <div className={styles.tokenBar}>
            <span className={styles.tokenLabel}>
              Context: {contextTokens.toLocaleString()} / {maxTokens.toLocaleString()} tokens
              ({Math.round((contextTokens / maxTokens) * 100)}%)
            </span>
            <div className={styles.tokenTrack}>
              <div
                className={styles.tokenFill}
                style={{
                  width: `${Math.min((contextTokens / maxTokens) * 100, 100)}%`,
                  backgroundColor:
                    contextTokens / maxTokens > 0.9
                      ? '#ff4d4f'
                      : contextTokens / maxTokens > 0.7
                        ? '#faad14'
                        : '#52c41a',
                }}
              />
            </div>
          </div>
        )}

        <form onSubmit={onSubmit} className={styles.form}>
          <div className={styles.inputRow}>
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.currentTarget.value)}
              placeholder={dashboardContext ? 'Ask about this dashboard...' : 'Select a dashboard first'}
              disabled={!dashboardContext || isStreaming}
              width={60}
            />
            <Button type="submit" disabled={isStreaming || !prompt.trim() || !dashboardContext}>
              {isStreaming ? 'Thinking...' : 'Send'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    layout: css({
      display: 'flex',
      gap: theme.spacing(2),
      padding: theme.spacing(2),
      height: 'calc(100vh - 80px)',
      overflow: 'hidden',
    }),
    sidebar: css({
      width: '280px',
      minWidth: '280px',
      display: 'flex',
      flexDirection: 'column',
      background: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      padding: theme.spacing(1.5),
      overflowY: 'auto',
    }),
    sidebarHeader: css({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing(1),
    }),
    sidebarTitle: css({
      margin: 0,
      fontSize: theme.typography.h5.fontSize,
    }),
    sidebarHint: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      padding: theme.spacing(1),
    }),
    sessionList: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
    }),
    sessionItem: css({
      padding: theme.spacing(1),
      borderRadius: theme.shape.radius.default,
      cursor: 'pointer',
      border: `1px solid transparent`,
      '&:hover': {
        background: theme.colors.background.canvas,
        borderColor: theme.colors.border.weak,
      },
    }),
    sessionActive: css({
      background: theme.colors.background.canvas,
      borderColor: theme.colors.primary.border,
    }),
    sessionTitle: css({
      fontWeight: theme.typography.fontWeightMedium,
      fontSize: theme.typography.bodySmall.fontSize,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }),
    sessionMeta: css({
      fontSize: '11px',
      color: theme.colors.text.secondary,
      marginTop: '2px',
    }),
    sessionActions: css({
      display: 'flex',
      gap: theme.spacing(0.5),
      marginTop: theme.spacing(0.5),
    }),
    main: css({
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      maxWidth: '1000px',
      overflow: 'hidden',
    }),
    header: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      marginBottom: theme.spacing(0.5),
    }),
    heading: css({
      margin: 0,
    }),
    subtitle: css({
      color: theme.colors.text.secondary,
      marginBottom: theme.spacing(2),
    }),
    form: css({
      marginTop: theme.spacing(1),
      padding: theme.spacing(1.5),
      background: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
    }),
    quickActions: css({
      display: 'flex',
      gap: theme.spacing(1),
      marginBottom: theme.spacing(1),
    }),
    inputRow: css({
      display: 'flex',
      gap: theme.spacing(1),
      alignItems: 'flex-start',
    }),
    tokenBar: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1.5),
      marginTop: theme.spacing(1),
      padding: `${theme.spacing(0.5)} ${theme.spacing(1.5)}`,
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
    tokenLabel: css({
      whiteSpace: 'nowrap',
    }),
    tokenTrack: css({
      flex: 1,
      height: '6px',
      borderRadius: '3px',
      background: theme.colors.background.canvas,
      overflow: 'hidden',
      maxWidth: '200px',
    }),
    tokenFill: css({
      height: '100%',
      borderRadius: '3px',
      transition: 'width 0.3s ease',
    }),
  };
}
