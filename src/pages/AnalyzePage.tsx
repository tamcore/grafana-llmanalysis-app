import { useState, useCallback, FormEvent } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, Field, Input, Select, Button, TextArea, Alert } from '@grafana/ui';
import { ChatView, ChatMessage } from '../components/ChatView';
import { streamChat, sendChat } from '../api';
import { AnalysisMode, AnalysisContext } from '../context';

const modeOptions = [
  { label: 'Explain Panel', value: 'explain_panel' as AnalysisMode },
  { label: 'Summarize Dashboard', value: 'summarize_dashboard' as AnalysisMode },
  { label: 'Analyze Logs', value: 'analyze_logs' as AnalysisMode },
  { label: 'Analyze Metrics', value: 'analyze_metrics' as AnalysisMode },
];

export function AnalyzePage() {
  const styles = useStyles2(getStyles);

  const [mode, setMode] = useState<AnalysisMode>('explain_panel');
  const [prompt, setPrompt] = useState('');
  const [contextJson, setContextJson] = useState('{}');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [error, setError] = useState<string | null>(null);

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

      let context: AnalysisContext;
      try {
        context = JSON.parse(contextJson);
      } catch {
        setError('Invalid context JSON');
        return;
      }

      setIsStreaming(true);
      setStreamContent('');

      try {
        let fullContent = '';
        for await (const chunk of streamChat(mode, userMessage.content, context)) {
          if (chunk.done) {
            break;
          }
          fullContent += chunk.content;
          setStreamContent(fullContent);
        }
        setMessages((prev) => [...prev, { role: 'assistant', content: fullContent }]);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);

        // Fallback to non-streaming
        try {
          const resp = await sendChat(mode, userMessage.content, context);
          setMessages((prev) => [...prev, { role: 'assistant', content: resp.content }]);
          setError(null);
        } catch (fallbackErr: unknown) {
          const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : 'Request failed';
          setError(fbMsg);
        }
      } finally {
        setIsStreaming(false);
        setStreamContent('');
      }
    },
    [prompt, contextJson, mode, isStreaming]
  );

  return (
    <div data-testid="analyze-page" className={styles.container}>
      <h2>LLM Analysis</h2>

      {error && (
        <Alert severity="error" title="Error">
          {error}
        </Alert>
      )}

      <ChatView messages={messages} isStreaming={isStreaming} streamContent={streamContent} />

      <form onSubmit={onSubmit} className={styles.form}>
        <Field label="Analysis Mode">
          <Select
            options={modeOptions}
            value={modeOptions.find((o) => o.value === mode)}
            onChange={(v) => v.value && setMode(v.value)}
            width={30}
          />
        </Field>

        <Field label="Context (JSON)" description="Panel, dashboard, log, or metric context">
          <TextArea
            value={contextJson}
            onChange={(e) => setContextJson(e.currentTarget.value)}
            rows={4}
            placeholder='{"panel": {"title": "CPU Usage"}}'
          />
        </Field>

        <Field label="Prompt">
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.currentTarget.value)}
            placeholder="What does this panel show?"
            width={60}
          />
        </Field>

        <Button type="submit" disabled={isStreaming || !prompt.trim()}>
          {isStreaming ? 'Analyzing...' : 'Analyze'}
        </Button>
      </form>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      padding: theme.spacing(2),
      maxWidth: '900px',
    }),
    form: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
      marginTop: theme.spacing(2),
      padding: theme.spacing(2),
      background: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
    }),
  };
}
