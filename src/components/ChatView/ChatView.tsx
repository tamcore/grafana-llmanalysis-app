import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamContent: string;
}

export function ChatView({ messages, isStreaming, streamContent }: Props) {
  const styles = useStyles2(getStyles);

  return (
    <div data-testid="chat-view" className={styles.container}>
      {messages.map((msg, i) => (
        <div key={i} className={msg.role === 'user' ? styles.userMessage : styles.assistantMessage}>
          <div className={styles.role}>{msg.role === 'user' ? 'You' : 'Assistant'}</div>
          <div className={styles.content}>{msg.content}</div>
        </div>
      ))}
      {isStreaming && (
        <div className={styles.assistantMessage}>
          <div className={styles.role}>Assistant</div>
          <div className={styles.content}>
            {streamContent}
            <span className={styles.cursor}>▌</span>
          </div>
        </div>
      )}
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
      maxHeight: '600px',
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
      maxWidth: '80%',
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
    cursor: css({
      animation: 'blink 1s step-end infinite',
      '@keyframes blink': {
        '50%': { opacity: 0 },
      },
    }),
  };
}

export type { ChatMessage };
