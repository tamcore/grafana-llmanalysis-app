import { render, screen, waitFor } from '@testing-library/react';
import { DashboardChatPage } from './DashboardChatPage';

jest.mock('@grafana/ui', () => ({
  useStyles2: () =>
    new Proxy(
      {},
      {
        get: () => '',
      }
    ),
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
  Select: ({ options, onChange, placeholder, isLoading }: any) => (
    <select
      onChange={(e: any) => onChange(options.find((o: any) => o.value === e.target.value))}
      data-testid="dashboard-select"
    >
      <option value="">{isLoading ? 'Loading...' : placeholder || 'Select...'}</option>
      {(options || []).map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
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
      if (url.includes('/api/search')) {
        return Promise.resolve([
          { uid: 'dash-1', title: 'Test Dashboard', type: 'dash-db', url: '/d/dash-1' },
          { uid: 'dash-2', title: 'Another Dashboard', type: 'dash-db', url: '/d/dash-2' },
        ]);
      }
      if (url.includes('/api/dashboards/uid/')) {
        return Promise.resolve({
          dashboard: {
            uid: 'dash-1',
            title: 'Test Dashboard',
            description: 'A test dashboard',
            tags: ['test'],
            panels: [
              { id: 1, title: 'CPU Usage', type: 'timeseries', targets: [{ expr: 'rate(cpu[5m])' }] },
              { id: 2, title: 'Memory', type: 'stat', targets: [{ expr: 'node_memory_total' }] },
            ],
            time: { from: 'now-1h', to: 'now' },
          },
        });
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

describe('DashboardChatPage', () => {
  it('renders the page with dashboard selector', async () => {
    render(<DashboardChatPage />);
    expect(screen.getByTestId('dashboard-chat-page')).toBeInTheDocument();
    expect(screen.getByText('💬 Chat with Dashboard')).toBeInTheDocument();
  });

  it('shows session sidebar', () => {
    render(<DashboardChatPage />);
    expect(screen.getByTestId('session-sidebar')).toBeInTheDocument();
  });

  it('loads dashboard list on mount', async () => {
    render(<DashboardChatPage />);
    await waitFor(() => {
      expect(screen.getByText('Select a dashboard...')).toBeInTheDocument();
    });
  });

  it('has a disabled input before dashboard selection', () => {
    render(<DashboardChatPage />);
    const input = screen.getByPlaceholderText('Select a dashboard first');
    expect(input).toBeDisabled();
  });
});
