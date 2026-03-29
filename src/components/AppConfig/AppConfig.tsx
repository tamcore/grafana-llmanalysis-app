import { AppPluginMeta, PluginConfigPageProps } from '@grafana/data';
import { Field, Input, SecretInput, Button, FieldSet } from '@grafana/ui';
import { ChangeEvent, useState } from 'react';
import { getBackendSrv } from '@grafana/runtime';

interface JsonData {
  endpointURL?: string;
  model?: string;
  timeoutSeconds?: number;
  maxTokens?: number;
}

interface Props extends PluginConfigPageProps<AppPluginMeta<JsonData>> {}

export function AppConfig({ plugin }: Props) {
  const { meta } = plugin;
  const jsonData = meta.jsonData || {};
  const secureJsonFields = meta.secureJsonFields || {};

  const [state, setState] = useState({
    endpointURL: jsonData.endpointURL || '',
    model: jsonData.model || '',
    timeoutSeconds: jsonData.timeoutSeconds || 60,
    maxTokens: jsonData.maxTokens || 4096,
    apiKey: '',
    apiKeySet: Boolean(secureJsonFields.apiKey),
    grafanaToken: '',
    grafanaTokenSet: Boolean(secureJsonFields.grafanaToken),
  });

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; message: string } | null>(null);

  const onChangeString = (key: keyof typeof state) => (event: ChangeEvent<HTMLInputElement>) => {
    setState({ ...state, [key]: event.target.value });
  };

  const onChangeNumber = (key: keyof typeof state) => (event: ChangeEvent<HTMLInputElement>) => {
    setState({ ...state, [key]: parseInt(event.target.value, 10) || 0 });
  };

  const onResetApiKey = () => {
    setState({ ...state, apiKey: '', apiKeySet: false });
  };

  const onResetGrafanaToken = () => {
    setState({ ...state, grafanaToken: '', grafanaTokenSet: false });
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const secureJsonData: Record<string, string> = {};
      if (state.apiKey) {
        secureJsonData.apiKey = state.apiKey;
      }
      if (state.grafanaToken) {
        secureJsonData.grafanaToken = state.grafanaToken;
      }

      await getBackendSrv().post(`/api/plugins/${meta.id}/settings`, {
        enabled: true,
        pinned: true,
        jsonData: {
          endpointURL: state.endpointURL,
          model: state.model,
          timeoutSeconds: state.timeoutSeconds,
          maxTokens: state.maxTokens,
        },
        secureJsonData,
      });

      setState({ ...state, apiKeySet: true, apiKey: '', grafanaTokenSet: state.grafanaToken ? true : state.grafanaTokenSet, grafanaToken: '' });
    } finally {
      setSaving(false);
    }
  };

  const onTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await getBackendSrv().get(`/api/plugins/${meta.id}/resources/health`);
      setTestResult({ status: result.status, message: result.message });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setTestResult({ status: 'error', message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div data-testid="app-config">
      <FieldSet label="LLM Endpoint Configuration">
        <Field label="Endpoint URL" description="Base URL of the OpenAI-compatible API (e.g. https://api.openai.com/v1)">
          <Input
            aria-label="Endpoint URL"
            value={state.endpointURL}
            onChange={onChangeString('endpointURL')}
            placeholder="https://openai.inference.de-txl.ionos.com/v1"
            width={60}
          />
        </Field>

        <Field label="Model" description="Model name to use for completions">
          <Input
            aria-label="Model"
            value={state.model}
            onChange={onChangeString('model')}
            placeholder="gpt-oss120b"
            width={40}
          />
        </Field>

        <Field label="API Key" description="Bearer token for authentication (stored securely)">
          <SecretInput
            aria-label="API Key"
            isConfigured={state.apiKeySet}
            value={state.apiKey}
            onChange={onChangeString('apiKey')}
            onReset={onResetApiKey}
            width={60}
          />
        </Field>

        <Field label="Timeout (seconds)" description="Request timeout in seconds">
          <Input
            aria-label="Timeout"
            type="number"
            value={state.timeoutSeconds}
            onChange={onChangeNumber('timeoutSeconds')}
            width={20}
          />
        </Field>

        <Field label="Max Tokens" description="Maximum tokens in LLM response">
          <Input
            aria-label="Max Tokens"
            type="number"
            value={state.maxTokens}
            onChange={onChangeNumber('maxTokens')}
            width={20}
          />
        </Field>

        <Field label="Grafana Service Account Token" description="Optional: Allows the LLM to query datasources (Prometheus, Loki) for real-time data. Create a Viewer service account in Grafana and paste its token here.">
          <SecretInput
            aria-label="Grafana Token"
            isConfigured={state.grafanaTokenSet}
            value={state.grafanaToken}
            onChange={onChangeString('grafanaToken')}
            onReset={onResetGrafanaToken}
            width={60}
          />
        </Field>
      </FieldSet>

      <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
        <Button onClick={onSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save settings'}
        </Button>
        <Button variant="secondary" onClick={onTestConnection} disabled={testing}>
          {testing ? 'Testing...' : 'Test connection'}
        </Button>
      </div>

      {testResult && (
        <div
          data-testid="test-result"
          style={{
            marginTop: '12px',
            padding: '8px 12px',
            borderRadius: '4px',
            background: testResult.status === 'ok' ? '#1a7f37' : '#cf222e',
            color: 'white',
          }}
        >
          {testResult.status === 'ok' ? '✓' : '✗'} {testResult.message}
        </div>
      )}
    </div>
  );
}
