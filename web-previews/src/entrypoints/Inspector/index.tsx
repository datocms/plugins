import type { RenderInspectorCtx } from 'datocms-plugin-sdk';
import BlankSlate, {
  type BlankSlateDocsLink,
} from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Heading from 'datocms-react-ui/Heading';
import Main from 'datocms-react-ui/Main';
import { useEffect } from 'react';
import { GlobeIcon } from '../../icons';
import {
  getVisualEditingFrontends,
  normalizeParameters,
  type Parameters,
} from '../../types';
import {
  inspectorUrl,
  pluginSettingsUrl,
  SETUP_GUIDE_URL,
} from '../../utils/urls';
import { ContentLinkContextProvider } from './ContentLinkContext';
import styles from './styles.module.css';
import UI from './UI';

type PropTypes = {
  ctx: RenderInspectorCtx;
};

const DOCS: BlankSlateDocsLink[] = [
  { label: 'Setup guide', href: SETUP_GUIDE_URL },
];

/**
 * The Visual tab opened from its URL while no frontend has visual editing
 * (the tab itself shows only when one has it). The roles that can change the
 * settings get the way to them and the guide; the others, whom to ask.
 */
function NoVisualEditingFrontend({ ctx }: PropTypes) {
  const canEditSchema = ctx.currentRole.meta.final_permissions.can_edit_schema;

  return (
    <BlankSlate
      placement="area"
      titleLevel={1}
      icon={<GlobeIcon />}
      title="Visual editing isn't set up yet"
      description={
        canEditSchema
          ? 'Turn on visual editing for a frontend in the plugin settings.'
          : 'Ask a developer or an administrator to turn it on.'
      }
      docs={canEditSchema ? DOCS : undefined}
      actions={
        canEditSchema ? (
          <Button
            tone="primary"
            label="Open plugin settings"
            to={pluginSettingsUrl(ctx)}
          />
        ) : undefined
      }
    />
  );
}

/**
 * The Visual tab: the website of a frontend in draft mode, with the overlays
 * that open the records of the page in the inspector panel.
 */
const Inspector = ({ ctx }: PropTypes) => {
  const params = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters,
  );
  const visualEditingFrontends = getVisualEditingFrontends(params);

  const urlParams = new URLSearchParams(ctx.location.search);
  const frontendName = urlParams.get('frontend');
  const selectedFrontend = frontendName
    ? visualEditingFrontends.find((f) => f.name === frontendName)
    : visualEditingFrontends[0];

  // If frontend param was provided but no match found, redirect to first available frontend
  useEffect(() => {
    if (
      frontendName &&
      !selectedFrontend &&
      visualEditingFrontends.length > 0
    ) {
      const firstFrontend = visualEditingFrontends[0];
      const path = firstFrontend.visualEditing?.initialPath || '/';

      ctx.navigateTo(
        inspectorUrl(ctx, {
          path,
          frontend: firstFrontend.name,
        }),
      );
    }
  }, [frontendName, selectedFrontend, visualEditingFrontends, ctx]);

  if (visualEditingFrontends.length === 0) {
    return (
      <Main className={styles.screen}>
        <NoVisualEditingFrontend ctx={ctx} />
      </Main>
    );
  }

  if (!selectedFrontend) {
    // The redirect to the first frontend runs: nothing shows meanwhile
    return null;
  }

  return (
    <Main className={styles.screen}>
      {/* The toolbar has no title: the heading names the page for the
          readers that move from heading to heading */}
      <Heading level={1} className="visually-hidden">
        Visual editing
      </Heading>
      {/* The URL gives the first frontend only: the provider keeps the
          frontend of the preview from then on */}
      <ContentLinkContextProvider
        frontends={visualEditingFrontends}
        initialFrontend={selectedFrontend}
      >
        <UI />
      </ContentLinkContextProvider>
    </Main>
  );
};

export default Inspector;
