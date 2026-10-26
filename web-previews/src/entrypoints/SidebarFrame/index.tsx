import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import type { ReactNode } from 'react';
import { useViewport } from '../../components/Browser/viewport';
import { PreviewSetupGuide } from '../../components/PreviewSetupGuide';
import { ErrorIcon, GlobeIcon } from '../../icons';
import type { Frontend } from '../../types';
import { useStatusByFrontend } from '../../utils/common';
import {
  errorMessage,
  failedLinksNextStep,
  type StatusByFrontend,
  useLogFailures,
} from '../../utils/failures';
import { usePersistedSidebarWidth } from '../../utils/persistedWidth';
import styles from './styles.module.css';
import { usePreviewLinkSelection } from './usePreviewLinkSelection';
import { WebsitePreview } from './WebsitePreview';

type PropTypes = {
  ctx: RenderItemFormSidebarCtx;
};

/**
 * A state with no toolbar: it fills the frame. The frame is a sidebar (300px
 * wide at least), so its blank slates have the small size at every width.
 */
function State({ children }: { children: ReactNode }) {
  return <div className={styles.state}>{children}</div>;
}

/** The frontends whose request failed, with their error */
function failuresOf(frontends: Frontend[], statusByFrontend: StatusByFrontend) {
  return frontends.flatMap((frontend) => {
    const status = statusByFrontend[frontend.name];

    return status && 'error' in status
      ? [{ frontend: frontend.name, error: status.error }]
      : [];
  });
}

/**
 * The frontends returned no link: they failed, or the record has no page. A
 * record that isn't saved yet asks no frontend.
 */
function NoPreviewLinks({
  frontends,
  statusByFrontend,
  saved,
}: {
  frontends: Frontend[];
  statusByFrontend: StatusByFrontend;
  saved: boolean;
}) {
  const failures = failuresOf(frontends, statusByFrontend);

  if (failures.length > 0) {
    return (
      <BlankSlate
        placement="area"
        small
        error
        icon={<ErrorIcon />}
        title="The preview links didn't load"
        // One line for each frontend that failed
        code={
          <div>
            {failures.map(({ frontend, error }) => (
              <div key={frontend}>{`${frontend}: ${errorMessage(error)}`}</div>
            ))}
          </div>
        }
        description={failedLinksNextStep(failures.length)}
      />
    );
  }

  return (
    <BlankSlate
      placement="area"
      small
      icon={<GlobeIcon />}
      title="No preview links for this record"
      description={
        !saved
          ? 'Save the record to load its preview links.'
          : frontends.length === 1
            ? 'The frontend returned no pages for this record.'
            : 'The frontends returned no pages for this record.'
      }
    />
  );
}

/**
 * The “Website preview” sidebar of the record: the page of the record on the
 * website, next to the form.
 */
const SidebarFrame = ({ ctx }: PropTypes) => {
  usePersistedSidebarWidth(ctx.site);

  const [frontends, statusByFrontend] = useStatusByFrontend(ctx);
  useLogFailures(statusByFrontend);

  // The viewport stays while the response changes
  const viewport = useViewport();

  const { selectedPreviewLink, selectPreviewLink } = usePreviewLinkSelection({
    statusByFrontend,
  });

  if (frontends.length === 0) {
    return (
      <State>
        <PreviewSetupGuide placement="area" small />
      </State>
    );
  }

  // The spinner shows only before the first response: a refresh keeps the
  // preview on screen
  if (!statusByFrontend) {
    return (
      <State>
        <BlankSlate
          placement="area"
          small
          loading
          title="Loading the preview links"
        />
      </State>
    );
  }

  if (!selectedPreviewLink) {
    return (
      <State>
        <NoPreviewLinks
          frontends={frontends}
          statusByFrontend={statusByFrontend}
          saved={Boolean(ctx.item)}
        />
      </State>
    );
  }

  return (
    <WebsitePreview
      ctx={ctx}
      frontends={frontends}
      statusByFrontend={statusByFrontend}
      selectedPreviewLink={selectedPreviewLink}
      onSelectPreviewLink={selectPreviewLink}
      viewport={viewport}
    />
  );
};

export default SidebarFrame;
