import { useState, useCallback, useEffect, useRef, FormEvent } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { useStyles2, Field, Input, Button, Alert, MultiSelect, Switch, InlineField, IconButton, Tooltip, useTheme2 } from '@grafana/ui';
import { ChatView, ChatMessage } from '../components/ChatView';
import { streamChat, sendChat, ChatHistory } from '../api';
import { AnalysisContext } from '../context';
import { useChatSessions } from '../hooks/useChatSessions';
import { ChatSession, ChatSessionContext, generateSessionId, generateTitle } from '../utils/chatStorage';

interface Datasource {
  name: string;
  type: string;
  uid: string;
}

interface DashboardEntry {
  title: string;
  uid: string;
  tags?: string[];
}

export function ChatPage() {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const { sessions, loading: sessionsLoading, loadSession, saveSession, deleteSession, exportSession } = useChatSessions();

  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [activeToolCalls, setActiveToolCalls] = useState<Array<{ name: string; arguments: string }>>([]);

  // Token tracking
  const [contextTokens, setContextTokens] = useState(0);
  const [maxTokens, setMaxTokens] = useState(0);

  // Session management
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(true);

  // Context selectors
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [dashboards, setDashboards] = useState<DashboardEntry[]>([]);
  const [selectedDatasources, setSelectedDatasources] = useState<Array<SelectableValue<string>>>([]);
  const [selectedDashboards, setSelectedDashboards] = useState<Array<SelectableValue<string>>>([]);
  const [autoDiscovery, setAutoDiscovery] = useState(true);

  // Ref to track messages for auto-save without stale closures
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const sessionIdRef = useRef(currentSessionId);
  sessionIdRef.current = currentSessionId;
  const abortRef = useRef<AbortController | null>(null);
  const createdAtRef = useRef(new Date().toISOString());

  // Fetch datasources and dashboards on mount
  useEffect(() => {
    getBackendSrv()
      .get('/api/datasources')
      .then((ds: Datasource[]) => setDatasources(ds))
      .catch(() => {});

    getBackendSrv()
      .get('/api/search?type=dash-db&limit=100')
      .then((d: DashboardEntry[]) => setDashboards(d))
      .catch(() => {});

    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const datasourceOptions: Array<SelectableValue<string>> = datasources.map((ds) => ({
    label: `${ds.name} (${ds.type})`,
    value: ds.uid,
    description: ds.type,
  }));

  const dashboardOptions: Array<SelectableValue<string>> = dashboards.map((d) => ({
    label: d.title,
    value: d.uid,
    description: d.tags?.join(', '),
  }));

  const buildContext = useCallback((): AnalysisContext => {
    const ctx: AnalysisContext = {};

    if (autoDiscovery) {
      ctx.autoDiscovery = true;
    }

    if (selectedDatasources.length > 0) {
      ctx.datasources = selectedDatasources
        .map((s) => {
          const ds = datasources.find((d) => d.uid === s.value);
          return ds ? { name: ds.name, type: ds.type, uid: ds.uid } : null;
        })
        .filter((d): d is Datasource => d !== null);
    }

    if (selectedDashboards.length > 0) {
      ctx.dashboards = selectedDashboards
        .map((s) => {
          const d = dashboards.find((db) => db.uid === s.value);
          return d ? { title: d.title, uid: d.uid } : null;
        })
        .filter((d): d is { title: string; uid: string } => d !== null);
    }

    return ctx;
  }, [autoDiscovery, selectedDatasources, selectedDashboards, datasources, dashboards]);

  const buildSessionContext = useCallback((): ChatSessionContext => {
    const ctx: ChatSessionContext = { autoDiscovery };
    if (selectedDatasources.length > 0) {
      ctx.datasources = selectedDatasources
        .map((s) => {
          const ds = datasources.find((d) => d.uid === s.value);
          return ds ? { name: ds.name, type: ds.type, uid: ds.uid } : null;
        })
        .filter((d): d is Datasource => d !== null);
    }
    if (selectedDashboards.length > 0) {
      ctx.dashboards = selectedDashboards
        .map((s) => {
          const d = dashboards.find((db) => db.uid === s.value);
          return d ? { title: d.title, uid: d.uid } : null;
        })
        .filter((d): d is { title: string; uid: string } => d !== null);
    }
    return ctx;
  }, [autoDiscovery, selectedDatasources, selectedDashboards, datasources, dashboards]);

  /** Auto-save the current session after messages change. */
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

      const session: ChatSession = {
        id,
        title: generateTitle(updatedMessages),
        mode: 'chat',
        messages: updatedMessages,
        context: buildSessionContext(),
        contextTokens: tokens ?? contextTokens,
        maxTokens: maxTok ?? maxTokens,
        createdAt: createdAtRef.current,
        updatedAt: new Date().toISOString(),
      };

      await saveSession(session);
    },
    [buildSessionContext, contextTokens, maxTokens, saveSession]
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
      setAutoDiscovery(session.context.autoDiscovery ?? true);
      setError(null);

      if (session.context.datasources?.length) {
        setSelectedDatasources(
          session.context.datasources.map((ds) => ({ label: `${ds.name} (${ds.type})`, value: ds.uid }))
        );
      } else {
        setSelectedDatasources([]);
      }
      if (session.context.dashboards?.length) {
        setSelectedDashboards(session.context.dashboards.map((d) => ({ label: d.title, value: d.uid })));
      } else {
        setSelectedDashboards([]);
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
      a.download = `chat-session-${id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [exportSession]
  );

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!prompt.trim() || isStreaming) {
        return;
      }

      setError(null);
      const userMessage: ChatMessage = { role: 'user', content: prompt };
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setPrompt('');

      const context = buildContext();
      const history: ChatHistory[] = messages.map((m) => ({ role: m.role, content: m.content }));

      setIsStreaming(true);
      setStreamContent('');
      setActiveToolCalls([]);

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      let fullContent = '';
      let newContextTokens = contextTokens;
      let newMaxTokens = maxTokens;
      try {
        for await (const chunk of streamChat('chat', userMessage.content, context, history, abortRef.current.signal)) {
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
            const resp = await sendChat('chat', userMessage.content, buildContext(), history);
            if (resp.content?.trim()) {
              fullContent = resp.content;
              setError(null);
            }
          } catch (fallbackErr: unknown) {
            const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : 'Request failed';
            setError(fbMsg);
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

        // Auto-save after each exchange
        await autoSave(finalMessages, newContextTokens, newMaxTokens);
      }
    },
    [prompt, isStreaming, buildContext, messages, contextTokens, maxTokens, autoSave]
  );

  return (
    <div data-testid="chat-page" className={styles.layout}>
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

          {!sessionsLoading && sessions.length === 0 && (
            <p className={styles.sidebarHint}>No saved sessions yet</p>
          )}

          <div className={styles.sessionList}>
            {sessions
              .filter((s) => s.mode === 'chat')
              .map((s) => (
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
          <h2 className={styles.heading}>Chat</h2>
          {currentSessionId && (
            <span className={styles.sessionBadge}>
              {sessions.find((s) => s.id === currentSessionId)?.title || 'Current session'}
            </span>
          )}
        </div>

        <p className={styles.subtitle}>
          Ask questions about your infrastructure. The LLM can query Prometheus, Loki, and inspect dashboards in
          real-time.
        </p>

        {error && (
          <Alert severity="error" title="Error">
            {error}
          </Alert>
        )}

        <div className={styles.contextBar}>
          <InlineField label="Auto-discovery" tooltip="Let the LLM discover datasources and dashboards automatically">
            <Switch value={autoDiscovery} onChange={() => setAutoDiscovery(!autoDiscovery)} />
          </InlineField>

          {!autoDiscovery && (
            <>
              <Field label="Datasources" description="Select datasources the LLM can query">
                <MultiSelect
                  options={datasourceOptions}
                  value={selectedDatasources}
                  onChange={setSelectedDatasources}
                  placeholder="Select datasources..."
                  isClearable
                  width={50}
                />
              </Field>
              <Field label="Dashboards" description="Select dashboards for context">
                <MultiSelect
                  options={dashboardOptions}
                  value={selectedDashboards}
                  onChange={setSelectedDashboards}
                  placeholder="Select dashboards..."
                  isClearable
                  width={50}
                />
              </Field>
            </>
          )}
        </div>

        <ChatView messages={messages} isStreaming={isStreaming} streamContent={streamContent} activeToolCalls={activeToolCalls} />

        {!isStreaming && messages.length === 0 && (
          <div className={styles.quickActions}>
            <Button
              variant="secondary"
              size="sm"
              icon="bolt"
              onClick={() => setPrompt('What looks unusual or concerning right now? Check metrics, alerts, and logs for any anomalies or problems.')}
            >
              Find Anomalies
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon="heart"
              onClick={() => setPrompt('Give me a health check of the cluster: CPU, memory, disk usage, pod status, and any firing alerts.')}
            >
              Cluster Health
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon="fire"
              onClick={() => setPrompt('List all firing alerts and for each one, investigate the root cause by correlating metrics and logs.')}
            >
              Alert Investigation
            </Button>
          </div>
        )}

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
                      ? theme.colors.error.main
                      : contextTokens / maxTokens > 0.7
                        ? theme.colors.warning.main
                        : theme.colors.success.main,
                }}
              />
            </div>
          </div>
        )}

        <form onSubmit={onSubmit} className={styles.form}>
          <Field label="Message">
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.currentTarget.value)}
              placeholder="Are there any problems in the cluster?"
              width={80}
            />
          </Field>

          <Button type="submit" disabled={isStreaming || !prompt.trim()}>
            {isStreaming ? 'Thinking...' : 'Send'}
          </Button>
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
      maxWidth: '1100px',
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
    sessionBadge: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      background: theme.colors.background.secondary,
      padding: `${theme.spacing(0.25)} ${theme.spacing(1)}`,
      borderRadius: theme.shape.radius.pill,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      maxWidth: '300px',
    }),
    subtitle: css({
      color: theme.colors.text.secondary,
      marginBottom: theme.spacing(2),
    }),
    contextBar: css({
      display: 'flex',
      flexWrap: 'wrap',
      gap: theme.spacing(2),
      alignItems: 'flex-start',
      marginBottom: theme.spacing(2),
      padding: theme.spacing(1.5),
      background: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
    }),
    form: css({
      display: 'flex',
      gap: theme.spacing(1),
      alignItems: 'flex-end',
      marginTop: theme.spacing(2),
      padding: theme.spacing(2),
      background: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
    }),
    quickActions: css({
      display: 'flex',
      gap: theme.spacing(1),
      marginTop: theme.spacing(1),
      marginBottom: theme.spacing(1),
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
