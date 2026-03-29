jest.mock('@grafana/ui', () => ({
  useStyles2: () => ({
    container: '',
    form: '',
    userMessage: '',
    assistantMessage: '',
    role: '',
    content: '',
    cursor: '',
  }),
  Field: ({ children, label }: any) => (
    <div>
      <label>{label}</label>
      {children}
    </div>
  ),
  Input: (props: any) => <input value={props.value} onChange={props.onChange} placeholder={props.placeholder} />,
  Select: ({ options, value, onChange }: any) => (
    <select value={value?.value} onChange={(e: any) => onChange(options.find((o: any) => o.value === e.target.value))}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  Button: ({ children, onClick, disabled, type }: any) => (
    <button onClick={onClick} disabled={disabled} type={type}>
      {children}
    </button>
  ),
  TextArea: (props: any) => <textarea value={props.value} onChange={props.onChange} placeholder={props.placeholder} />,
  Alert: ({ children, title }: any) => (
    <div role="alert">
      {title}: {children}
    </div>
  ),
}));

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({
    post: jest.fn().mockResolvedValue({ content: 'test response', done: true }),
    get: jest.fn().mockResolvedValue({ status: 'ok' }),
  }),
}));

jest.mock('../api', () => ({
  streamChat: jest.fn(),
  sendChat: jest.fn().mockResolvedValue({ content: 'test response', done: true }),
}));

import { render, screen } from '@testing-library/react';
import { AnalyzePage } from './AnalyzePage';

describe('AnalyzePage', () => {
  it('renders the page', () => {
    render(<AnalyzePage />);
    expect(screen.getByTestId('analyze-page')).toBeInTheDocument();
  });

  it('renders the heading', () => {
    render(<AnalyzePage />);
    expect(screen.getByText('LLM Analysis')).toBeInTheDocument();
  });

  it('renders the mode selector', () => {
    render(<AnalyzePage />);
    expect(screen.getByText('Analysis Mode')).toBeInTheDocument();
  });

  it('renders the prompt input', () => {
    render(<AnalyzePage />);
    expect(screen.getByText('Prompt')).toBeInTheDocument();
  });

  it('renders the analyze button', () => {
    render(<AnalyzePage />);
    expect(screen.getByText('Analyze')).toBeInTheDocument();
  });

  it('renders context input', () => {
    render(<AnalyzePage />);
    expect(screen.getByText(/Context/i)).toBeInTheDocument();
  });

  it('disables analyze button when prompt is empty', () => {
    render(<AnalyzePage />);
    const button = screen.getByText('Analyze');
    expect(button).toBeDisabled();
  });
});
