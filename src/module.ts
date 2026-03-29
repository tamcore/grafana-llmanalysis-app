import { AppPlugin } from '@grafana/data';
import { AppConfig } from './components/AppConfig';
import { AnalyzePage } from './pages';

export const plugin = new AppPlugin<{}>()
  .setRootPage(AnalyzePage)
  .addConfigPage({
    title: 'Configuration',
    icon: 'cog',
    body: AppConfig,
    id: 'configuration',
  });
