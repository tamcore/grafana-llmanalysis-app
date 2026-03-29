import { useState, useCallback, useEffect, FormEvent } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, Field, Input, Select, Button, Alert } from '@grafana/ui';
import { getBackendSrv } from '@grafana/runtime';
import { ChatView, ChatMessage } from '../components/ChatView';
import { streamChat, sendChat, ChatHistory } from '../api';
import { AnalysisContext, DashboardContext, DashboardPanelSummary } from '../context';

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

  // Fetch dashboard list
  useEffect(() => {
    getBackendSrv()
      .get('/api/search?type=dash-db&limit=50')
      .then((results: DashboardSearchResult[]) => setDashboards(results))
      .catch(() => setError('Failed to load dashboards'));
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

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!prompt.trim() || isStreaming || !dashboardContext) {
        return;
      }

      setError(null);
      const userMessage: ChatMessage = { role: 'user', content: prompt };
      setMessages((prev) => [...prev, userMessage]);
      setPrompt('');
      setIsStreaming(true);
      setStreamContent('');
      setActiveToolCalls([]);

      const history: ChatHistory[] = messages.map((m) => ({ role: m.role, content: m.content }));

      let fullContent = '';
      try {
        for await (const chunk of streamChat('summarize_dashboard', userMessage.content, dashboardContext, history)) {
          if (chunk.done) {
            if (chunk.contextTokens) {
              setContextTokens(chunk.contextTokens);
            }
            if (chunk.maxTokens) {
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
      } catch {
        if (!fullContent.trim()) {
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
        if (fullContent.trim()) {
          setMessages((prev) => [...prev, { role: 'assistant', content: fullContent }]);
        }
        setIsStreaming(false);
        setStreamContent('');
        setActiveToolCalls([]);
      }
    },
    [prompt, dashboardContext, isStreaming, messages]
  );

  const dashboardOptions = dashboards.map((d) => ({ label: d.title, value: d.uid }));

  return (
    <div data-testid="dashboard-chat-page" className={styles.container}>
      <h2>💬 Chat with Dashboard</h2>
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
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      padding: theme.spacing(2),
      maxWidth: '1000px',
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
