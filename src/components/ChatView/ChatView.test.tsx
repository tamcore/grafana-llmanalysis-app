jest.mock('@grafana/ui', () => ({
  useStyles2: (fn: any) =>
    fn({
      spacing: (n: number) => `${n * 8}px`,
      colors: {
        background: { secondary: '#f0f0f0', canvas: '#fff' },
        border: { weak: '#ccc' },
        text: { secondary: '#666' },
      },
      shape: { radius: { default: '4px' } },
      typography: { fontWeightBold: 700, bodySmall: { fontSize: '12px' } },
    }),
}));

import { render, screen } from '@testing-library/react';
import { ChatView, ChatMessage } from './ChatView';

describe('ChatView', () => {
  it('renders the container', () => {
    render(<ChatView messages={[]} isStreaming={false} streamContent="" />);
    expect(screen.getByTestId('chat-view')).toBeInTheDocument();
  });

  it('renders user messages', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }];
    render(<ChatView messages={messages} isStreaming={false} streamContent="" />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('renders assistant messages', () => {
    const messages: ChatMessage[] = [{ role: 'assistant', content: 'Hi there' }];
    render(<ChatView messages={messages} isStreaming={false} streamContent="" />);
    expect(screen.getByText('Hi there')).toBeInTheDocument();
    expect(screen.getByText('Assistant')).toBeInTheDocument();
  });

  it('shows streaming content with cursor', () => {
    render(<ChatView messages={[]} isStreaming={true} streamContent="Loading..." />);
    expect(screen.getByText(/Loading\.\.\./)).toBeInTheDocument();
    expect(screen.getByText('▌')).toBeInTheDocument();
  });

  it('hides streaming when not active', () => {
    render(<ChatView messages={[]} isStreaming={false} streamContent="" />);
    expect(screen.queryByText('▌')).not.toBeInTheDocument();
  });

  it('renders multiple messages in order', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Second' },
      { role: 'user', content: 'Third' },
    ];
    render(<ChatView messages={messages} isStreaming={false} streamContent="" />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.getByText('Third')).toBeInTheDocument();
  });
});
