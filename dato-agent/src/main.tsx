import { connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import './recordComments/entrypoints/styles/tokens.css';
import { lazy, Suspense } from 'react';
import AgentUnavailableFrame from './entrypoints/AgentUnavailableFrame';
import ApprovalDetailsModal from './entrypoints/ApprovalDetailsModal';
import ConfigScreen from './entrypoints/ConfigScreen';
import FileDetailsModal from './entrypoints/FileDetailsModal';
import InspectorEmptyPanel from './entrypoints/InspectorEmptyPanel';
import LoadingFrame from './entrypoints/LoadingFrame';
import OAuthCallbackPage from './entrypoints/OAuthCallbackPage';
import { APPROVAL_DETAILS_MODAL_ID } from './lib/approvalDetailsModal';
import { normalizeConfig } from './lib/config';
import { FILE_DETAILS_MODAL_ID } from './lib/fileDetailsModal';
import { inspectorRecordPaneWidth } from './lib/inspectorLayout';
import { handleOAuthCallbackIfPresent } from './lib/oauth';
import { canRoleUseDatoAgent } from './lib/permissions';
import { DEFAULT_SIDEBAR_WIDTH, readSidebarWidth } from './lib/persistedWidth';
import { render } from './utils/render';

const AgentInspector = lazy(() => import('./entrypoints/AgentInspector'));
const AgentSidebar = lazy(() => import('./entrypoints/AgentSidebar'));

function renderOAuthCallbackPage(message: string, error = false): void {
  render(<OAuthCallbackPage error={error} message={message} />);
}

let handledOAuthCallback = false;

try {
  handledOAuthCallback = handleOAuthCallbackIfPresent();
  if (handledOAuthCallback) {
    renderOAuthCallbackPage(
      'Completing sign-in. This window will close when your connection is ready.',
    );
  }
} catch (error) {
  handledOAuthCallback = true;
  renderOAuthCallbackPage(
    error instanceof Error ? error.message : 'The OAuth callback was invalid.',
    true,
  );
}

if (!handledOAuthCallback) {
  connect({
    mainNavigationTabs(ctx) {
      const config = normalizeConfig(ctx.plugin.attributes.parameters);
      if (!canRoleUseDatoAgent(config, ctx.currentRole?.id)) {
        return [];
      }

      return [
        {
          label: 'Agent (Beta)',
          icon: 'message-bot',
          placement: ['before', 'content'],
          pointsTo: {
            inspectorId: 'dato-agent',
            // The inspector always shows a right-hand pane and only reads this
            // width once. Start with a balanced split so the chat is usable
            // before a record is opened; the editor can drag the divider.
            preferredWidth: inspectorRecordPaneWidth(window.outerWidth),
            initialInspectorPanel: {
              panelId: 'dato-agent-empty',
            },
          },
        },
      ];
    },

    renderConfigScreen(ctx) {
      render(<ConfigScreen ctx={ctx} />);
    },

    itemFormSidebars(_itemType, ctx) {
      const config = normalizeConfig(ctx.plugin.attributes.parameters);
      if (
        !config.enableRecordSidebar ||
        !canRoleUseDatoAgent(config, ctx.currentRole?.id)
      ) {
        return [];
      }

      return [
        {
          id: 'dato-agent',
          label: 'Dato Agent (Beta)',
          preferredWidth:
            readSidebarWidth(ctx.site.id) ?? DEFAULT_SIDEBAR_WIDTH,
        },
      ];
    },

    renderItemFormSidebar(sidebarId, ctx) {
      if (sidebarId !== 'dato-agent') {
        return;
      }

      const config = normalizeConfig(ctx.plugin.attributes.parameters);
      if (!canRoleUseDatoAgent(config, ctx.currentRole?.id)) {
        render(<AgentUnavailableFrame ctx={ctx} />);
        return;
      }

      render(
        <Suspense fallback={<LoadingFrame ctx={ctx} />}>
          <AgentSidebar ctx={ctx} />
        </Suspense>,
      );
    },

    renderInspector(inspectorId, ctx) {
      if (inspectorId !== 'dato-agent') {
        return;
      }

      const config = normalizeConfig(ctx.plugin.attributes.parameters);
      if (!canRoleUseDatoAgent(config, ctx.currentRole?.id)) {
        render(<AgentUnavailableFrame ctx={ctx} />);
        return;
      }

      render(
        <Suspense fallback={<LoadingFrame ctx={ctx} />}>
          <AgentInspector ctx={ctx} />
        </Suspense>,
      );
    },

    renderInspectorPanel(panelId, ctx) {
      if (panelId === 'dato-agent-empty') {
        const config = normalizeConfig(ctx.plugin.attributes.parameters);
        render(
          canRoleUseDatoAgent(config, ctx.currentRole?.id) ? (
            <InspectorEmptyPanel ctx={ctx} />
          ) : (
            <AgentUnavailableFrame ctx={ctx} />
          ),
        );
      }
    },

    renderModal(modalId, ctx) {
      switch (modalId) {
        case APPROVAL_DETAILS_MODAL_ID:
          render(<ApprovalDetailsModal ctx={ctx} />);
          break;
        case FILE_DETAILS_MODAL_ID:
          render(<FileDetailsModal ctx={ctx} />);
          break;
      }
    },
  });
}
