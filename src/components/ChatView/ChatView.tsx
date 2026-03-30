import { css } from '@emotion/css';
import { useStyles2, IconButton } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { useRef, useEffect, useCallback } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
}

interface ToolCallStatus {
  name: string;
  arguments: string;
}

interface Props {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamContent: string;
  activeToolCalls?: ToolCallStatus[];
}

function MarkdownContent({ content }: { content: string }) {
  const styles = useStyles2(getStyles);
  return (
    <div className={styles.markdown}>
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{content}</Markdown>
    </div>
  );
}

const toolNameLabels: Record<string, string> = {
  query_prometheus: '📊 Querying Prometheus',
  query_loki: '📋 Querying Loki',
  list_datasources: '🔍 Listing datasources',
  list_dashboards: '📋 Listing dashboards',
  get_dashboard: '📊 Inspecting dashboard',
  list_alerts: '🚨 Checking alerts',
  list_alert_rules: '📏 Loading alert rules',
};

function extractToolDetail(name: string, args: string): string {
  try {
    const parsed = JSON.parse(args);
    if (name === 'query_prometheus' || name === 'query_loki') {
      return parsed.query || '';
    }
    if (name === 'get_dashboard') {
      return parsed.uid || '';
    }
    if (name === 'list_dashboards') {
      return parsed.query || '';
    }
    if (name === 'list_alerts') {
      const parts = [];
      if (parsed.state) {parts.push(`state=${parsed.state}`);}
      if (parsed.filter) {parts.push(parsed.filter);}
      return parts.join(' ');
    }
    return '';
  } catch {
    return '';
  }
}

function ToolCallBadge({ name, arguments: args }: ToolCallStatus) {
  const styles = useStyles2(getStyles);
  const label = toolNameLabels[name] || `🔧 ${name}`;
  const detail = extractToolDetail(name, args);

  const handleCopy = useCallback(() => {
    if (detail) {
      navigator.clipboard.writeText(detail);
    }
  }, [detail]);

  return (
    <div data-testid="tool-call" className={styles.toolCall}>
      <span className={styles.toolCallLabel}>{label}</span>
      {detail && (
        <>
          <code className={styles.toolCallQuery}>{detail}</code>
          <IconButton name="copy" size="sm" tooltip="Copy query" onClick={handleCopy} aria-label="Copy query" />
        </>
      )}
    </div>
  );
}

export function ChatView({ messages, isStreaming, streamContent, activeToolCalls }: Props) {
  const styles = useStyles2(getStyles);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamContent]);

  return (
    <div data-testid="chat-view" className={styles.container}>
      {messages.map((msg, i) => (
        <div
          key={`msg-${i}-${msg.role}`}
          data-testid="chat-message"
          data-role={msg.role}
          className={msg.role === 'user' ? styles.userMessage : styles.assistantMessage}
        >
          <div className={styles.role}>{msg.role === 'user' ? 'You' : 'Assistant'}</div>
          {msg.role === 'assistant' ? (
            <MarkdownContent content={msg.content} />
          ) : (
            <div className={styles.content}>{msg.content}</div>
          )}
        </div>
      ))}
      {isStreaming && (
        <div className={styles.assistantMessage}>
          <div className={styles.role}>Assistant</div>
          <div className={styles.content}>
            {activeToolCalls && activeToolCalls.length > 0 && (
              <div className={styles.toolCallsContainer}>
                {activeToolCalls.map((tc, i) => (
                  <ToolCallBadge key={`tc-${i}-${tc.name}`} name={tc.name} arguments={tc.arguments} />
                ))}
              </div>
            )}
            {streamContent && <MarkdownContent content={streamContent} />}
            <span className={styles.cursor}>▌</span>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
      padding: theme.spacing(2),
      maxHeight: '70vh',
      overflowY: 'auto',
    }),
    userMessage: css({
      padding: theme.spacing(1.5),
      borderRadius: theme.shape.radius.default,
      backgroundColor: theme.colors.background.secondary,
      alignSelf: 'flex-end',
      maxWidth: '80%',
    }),
    assistantMessage: css({
      padding: theme.spacing(1.5),
      borderRadius: theme.shape.radius.default,
      backgroundColor: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.border.weak}`,
      alignSelf: 'flex-start',
      maxWidth: '100%',
      width: '100%',
    }),
    role: css({
      fontWeight: theme.typography.fontWeightBold,
      fontSize: theme.typography.bodySmall.fontSize,
      marginBottom: theme.spacing(0.5),
      color: theme.colors.text.secondary,
    }),
    content: css({
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }),
    markdown: css({
      wordBreak: 'break-word',
      '& p': { margin: `${theme.spacing(0.5)} 0` },
      '& p:first-child': { marginTop: 0 },
      '& p:last-child': { marginBottom: 0 },
      '& ul, & ol': { paddingLeft: theme.spacing(2.5), margin: `${theme.spacing(0.5)} 0` },
      '& code': {
        padding: `${theme.spacing(0.25)} ${theme.spacing(0.5)}`,
        borderRadius: theme.shape.radius.default,
        backgroundColor: theme.colors.background.secondary,
        fontFamily: theme.typography.fontFamilyMonospace,
        fontSize: '0.85em',
      },
      '& pre': {
        padding: theme.spacing(1.5),
        borderRadius: theme.shape.radius.default,
        backgroundColor: theme.colors.background.secondary,
        overflowX: 'auto',
        margin: `${theme.spacing(1)} 0`,
      },
      '& pre code': {
        padding: 0,
        backgroundColor: 'transparent',
        fontSize: '0.85em',
      },
      '& table': {
        borderCollapse: 'collapse',
        margin: `${theme.spacing(1)} 0`,
        display: 'block',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
      },
      '& th, & td': {
        border: `1px solid ${theme.colors.border.weak}`,
        padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
        textAlign: 'left',
        whiteSpace: 'normal',
        minWidth: '80px',
      },
      '& th': {
        backgroundColor: theme.colors.background.secondary,
        fontWeight: theme.typography.fontWeightBold,
      },
      '& h1, & h2, & h3, & h4': {
        margin: `${theme.spacing(1)} 0 ${theme.spacing(0.5)}`,
      },
      '& blockquote': {
        borderLeft: `3px solid ${theme.colors.border.medium}`,
        paddingLeft: theme.spacing(1.5),
        margin: `${theme.spacing(0.5)} 0`,
        color: theme.colors.text.secondary,
      },
      '& hr': {
        border: 'none',
        borderTop: `1px solid ${theme.colors.border.weak}`,
        margin: `${theme.spacing(1)} 0`,
      },
    }),
    cursor: css({
      animation: 'blink 1s step-end infinite',
      '@keyframes blink': {
        '50%': { opacity: 0 },
      },
    }),
    toolCall: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
      borderRadius: theme.shape.radius.default,
      backgroundColor: theme.colors.background.secondary,
      border: `1px solid ${theme.colors.border.medium}`,
      marginBottom: theme.spacing(0.5),
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    toolCallLabel: css({
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
    }),
    toolCallQuery: css({
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: '0.85em',
      color: theme.colors.text.secondary,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      maxWidth: '500px',
    }),
    toolCallsContainer: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
      marginBottom: theme.spacing(1),
    }),
  };
}

export type { ChatMessage };
