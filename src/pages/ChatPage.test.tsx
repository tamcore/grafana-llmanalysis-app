import { render, screen } from '@testing-library/react';
import { ChatPage } from './ChatPage';

const mockTheme = {
  colors: {
    background: { primary: '#111', secondary: '#222', canvas: '#000' },
    text: { primary: '#fff', secondary: '#ccc', disabled: '#999' },
    primary: { main: '#3274D9' },
    success: { main: '#1a7c4f' },
    warning: { main: '#f0b400' },
    error: { main: '#e02f44' },
  },
  spacing: () => '8px',
};

jest.mock('@grafana/ui', () => ({
  useStyles2: () =>
    new Proxy(
      {},
      {
        get: () => '',
      }
    ),
  useTheme2: () => mockTheme,
  Field: ({ children, label }: any) => (
    <div>
      <label>{label}</label>
      {children}
    </div>
  ),
  Input: (props: any) => (
    <input
      value={props.value}
      onChange={props.onChange}
      placeholder={props.placeholder}
      disabled={props.disabled}
      data-testid="prompt-input"
    />
  ),
  MultiSelect: ({ placeholder }: any) => (
    <div data-testid="multi-select">{placeholder}</div>
  ),
  Switch: ({ value }: any) => (
    <input type="checkbox" checked={value} readOnly data-testid="auto-discovery-switch" />
  ),
  InlineField: ({ children, label }: any) => (
    <div>
      <label>{label}</label>
      {children}
    </div>
  ),
  Button: (props: any) => (
    <button type={props.type} disabled={props.disabled}>
      {props.children}
    </button>
  ),
  Alert: ({ children, title }: any) => (
    <div role="alert">
      <strong>{title}</strong>
      {children}
    </div>
  ),
  IconButton: ({ 'aria-label': label, onClick }: any) => (
    <button aria-label={label} onClick={onClick} />
  ),
  Tooltip: ({ children }: any) => <>{children}</>,
}));

const mockStorage: Record<string, string> = {};
jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({
    get: jest.fn().mockImplementation((url: string) => {
      if (url === '/api/datasources') {
        return Promise.resolve([
          { name: 'Prometheus', type: 'prometheus', uid: 'prom-1' },
          { name: 'Loki', type: 'loki', uid: 'loki-1' },
        ]);
      }
      if (url.includes('/api/search')) {
        return Promise.resolve([
          { uid: 'dash-1', title: 'Kubernetes Overview', tags: ['kubernetes'] },
        ]);
      }
      return Promise.resolve({});
    }),
    post: jest.fn().mockResolvedValue({ content: 'Test response', done: true }),
  }),
  usePluginUserStorage: () => ({
    getItem: jest.fn(async (key: string) => mockStorage[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage[key] = value;
    }),
  }),
}));

describe('ChatPage', () => {
  it('renders the page with chat heading', () => {
    render(<ChatPage />);
    expect(screen.getByTestId('chat-page')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();
  });

  it('shows session sidebar', () => {
    render(<ChatPage />);
    expect(screen.getByTestId('session-sidebar')).toBeInTheDocument();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
  });

  it('shows new chat button', () => {
    render(<ChatPage />);
    expect(screen.getByLabelText('New chat')).toBeInTheDocument();
  });

  it('shows auto-discovery switch enabled by default', () => {
    render(<ChatPage />);
    const toggle = screen.getByTestId('auto-discovery-switch');
    expect(toggle).toBeChecked();
  });

  it('has a prompt input', () => {
    render(<ChatPage />);
    const input = screen.getByPlaceholderText('Are there any problems in the cluster?');
    expect(input).toBeInTheDocument();
  });

  it('has a send button that is disabled when input is empty', () => {
    render(<ChatPage />);
    const button = screen.getByText('Send');
    expect(button).toBeDisabled();
  });

  it('does not show datasource/dashboard selectors when auto-discovery is on', () => {
    render(<ChatPage />);
    expect(screen.queryByText('Datasources')).not.toBeInTheDocument();
    expect(screen.queryByText('Dashboards')).not.toBeInTheDocument();
  });

  it('shows quick action buttons when no messages', () => {
    render(<ChatPage />);
    expect(screen.getByText('Find Anomalies')).toBeInTheDocument();
    expect(screen.getByText('Cluster Health')).toBeInTheDocument();
    expect(screen.getByText('Alert Investigation')).toBeInTheDocument();
  });
});
