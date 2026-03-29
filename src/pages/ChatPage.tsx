import { useState, useCallback, useEffect, FormEvent } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { useStyles2, Field, Input, Button, Alert, MultiSelect, Switch, InlineField } from '@grafana/ui';
import { ChatView, ChatMessage } from '../components/ChatView';
import { streamChat, sendChat, ChatHistory } from '../api';
import { AnalysisContext } from '../context';

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

  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [activeToolCalls, setActiveToolCalls] = useState<Array<{ name: string; arguments: string }>>([]);

  // Token tracking
  const [contextTokens, setContextTokens] = useState(0);
  const [maxTokens, setMaxTokens] = useState(0);

  // Context selectors
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [dashboards, setDashboards] = useState<DashboardEntry[]>([]);
  const [selectedDatasources, setSelectedDatasources] = useState<Array<SelectableValue<string>>>([]);
  const [selectedDashboards, setSelectedDashboards] = useState<Array<SelectableValue<string>>>([]);
  const [autoDiscovery, setAutoDiscovery] = useState(true);

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

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!prompt.trim() || isStreaming) {
        return;
      }

      setError(null);
      const userMessage: ChatMessage = { role: 'user', content: prompt };
      setMessages((prev) => [...prev, userMessage]);
      setPrompt('');

      const context = buildContext();

      // Build conversation history from existing messages for multi-turn context.
      const history: ChatHistory[] = messages.map((m) => ({ role: m.role, content: m.content }));

      setIsStreaming(true);
      setStreamContent('');
      setActiveToolCalls([]);

      let fullContent = '';
      try {
        for await (const chunk of streamChat('chat', userMessage.content, context, history)) {
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
      } catch (err: unknown) {
        // If we have no streamed content, try a non-streaming fallback
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
        if (fullContent.trim()) {
          setMessages((prev) => [...prev, { role: 'assistant', content: fullContent }]);
        }
        setIsStreaming(false);
        setStreamContent('');
        setActiveToolCalls([]);
      }
    },
    [prompt, isStreaming, buildContext, messages]
  );

  return (
    <div data-testid="chat-page" className={styles.container}>
      <h2>Chat</h2>
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
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      padding: theme.spacing(2),
      maxWidth: '1100px',
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
