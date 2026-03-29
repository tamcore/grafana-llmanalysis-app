import { AppPlugin } from '@grafana/data';

import { AppConfig } from './components/AppConfig';

export const plugin = new AppPlugin<{}>().addConfigPage({
  title: 'Configuration',
  icon: 'cog',
  body: AppConfig,
  id: 'configuration',
});
