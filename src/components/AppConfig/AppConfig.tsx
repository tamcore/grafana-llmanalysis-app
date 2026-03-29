import { AppPluginMeta, PluginConfigPageProps } from '@grafana/data';

export function AppConfig({ plugin }: PluginConfigPageProps<AppPluginMeta>) {
  return (
    <div data-testid="app-config">
      <h3>LLM Analysis Configuration</h3>
      <p>Configuration will be implemented in Phase 3.</p>
    </div>
  );
}
