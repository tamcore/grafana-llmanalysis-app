import { AppPlugin, AppRootProps, PluginExtensionPanelContext } from '@grafana/data';
import React from 'react';
import { AppConfig } from './components/AppConfig';
import { AnalyzePage, DashboardChatPage, ChatPage } from './pages';
import { PanelAnalysisModal, ExploreAnalysisModal } from './extensions/AnalysisModal';
import { PLUGIN_ID } from './constants';

// Hardcode extension point IDs to avoid runtime enum resolution issues
const PANEL_MENU_TARGET = 'grafana/dashboard/panel/menu';
const EXPLORE_TOOLBAR_TARGET = 'grafana/explore/toolbar/action';
const COMMAND_PALETTE_TARGET = 'grafana/commandpalette/action';

function AppRoot(props: AppRootProps) {
  const path = props.path || window.location.pathname;
  if (path.includes('chat') && !path.includes('dashboard-chat')) {
    return <ChatPage />;
  }
  if (path.includes('dashboard-chat')) {
    return <DashboardChatPage />;
  }
  return <AnalyzePage />;
}

export const plugin = new AppPlugin<{}>()
  .setRootPage(AppRoot)
  .addConfigPage({
    title: 'Configuration',
    icon: 'cog',
    body: AppConfig,
    id: 'configuration',
  })
  .addLink<PluginExtensionPanelContext>({
    title: 'Analyze with LLM',
    description: 'Send this panel to AI for analysis',
    targets: [PANEL_MENU_TARGET],
    category: 'Extensions',
    onClick: (event, helpers) => {
      const panelContext = helpers?.context;
      if (helpers?.openModal) {
        helpers.openModal({
          title: '🤖 Analyze Panel with LLM',
          body: ({ onDismiss }) =>
            React.createElement(PanelAnalysisModal, { context: panelContext, onDismiss }),
          width: '60%',
          height: '80vh',
        });
      }
    },
  })
  .addLink({
    title: 'Analyze with LLM',
    description: 'Analyze current query results with AI',
    targets: [EXPLORE_TOOLBAR_TARGET],
    onClick: (_event, helpers) => {
      if (helpers?.openModal) {
        helpers.openModal({
          title: '🤖 Analyze with LLM',
          body: ({ onDismiss }) => React.createElement(ExploreAnalysisModal, { onDismiss }),
          width: '60%',
          height: '80vh',
        });
      }
    },
  })
  .addLink({
    title: 'LLM Analysis',
    description: 'Open LLM Analysis page',
    targets: [COMMAND_PALETTE_TARGET],
    path: `/a/${PLUGIN_ID}`,
  });
