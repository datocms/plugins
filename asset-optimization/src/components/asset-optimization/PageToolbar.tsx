import { Dropdown } from 'datocms-react-ui/Dropdown';
import Toolbar from 'datocms-react-ui/Toolbar';

export type PagePhase = 'settings' | 'running' | 'results';

const NO_TOKEN_REASON =
  "This plugin can't use your API token. Ask an admin to allow it in the plugin settings.";

type PageToolbarProps = {
  phase: PagePhase;
  isPreview: boolean;
  isCancelling: boolean;
  hasAccessToken: boolean;
  onRestoreDefaults: () => void;
  onPreview: () => unknown;
  onStart: () => unknown;
  onCancel: () => void;
  onBackToSettings: () => void;
};

function subtitleOf(phase: PagePhase, isPreview: boolean) {
  if (phase === 'running') return isPreview ? 'Previewing' : 'Optimizing';
  if (phase === 'results') return isPreview ? 'Preview results' : 'Results';
  return '';
}

/** The buttons at the right end of the bar, for the phase of the page */
function PhaseButtons({
  phase,
  isCancelling,
  hasAccessToken,
  onPreview,
  onStart,
  onCancel,
  onBackToSettings,
}: PageToolbarProps) {
  if (phase === 'running')
    return (
      <Toolbar.Button
        tone="soft"
        label="Cancel"
        busy={isCancelling}
        onClick={onCancel}
      />
    );

  if (phase === 'results')
    return (
      <Toolbar.Button
        tone="primary"
        label="Back to settings"
        onClick={onBackToSettings}
      />
    );

  const disabled = hasAccessToken ? undefined : { reason: NO_TOKEN_REASON };
  return (
    <Toolbar.Group gap="s">
      <Toolbar.Button
        tone="soft"
        label="Preview optimization"
        disabled={disabled}
        onClick={onPreview}
      />
      <Toolbar.Button
        tone="primary"
        label="Start optimization"
        disabled={disabled}
        onClick={onStart}
      />
    </Toolbar.Group>
  );
}

/** The title bar of the page: the title, the state of the run and its buttons */
export default function PageToolbar(props: PageToolbarProps) {
  const { phase, isPreview, onRestoreDefaults } = props;

  return (
    <Toolbar>
      <Toolbar.Title
        level={1}
        help={
          <Toolbar.Help docsUrl="https://github.com/datocms/plugins/tree/master/asset-optimization#readme">
            Replaces the large images of this environment with smaller versions
            made by Imgix. Run a preview first: it shows the savings without
            changing any image.
          </Toolbar.Help>
        }
      >
        Asset optimization
      </Toolbar.Title>
      <Toolbar.Subtitle hidden={phase === 'settings'}>
        {subtitleOf(phase, isPreview)}
      </Toolbar.Subtitle>
      <Toolbar.DotsDropdown
        hidden={phase !== 'settings'}
        label="Actions for the settings"
      >
        <Dropdown.Option onPick={onRestoreDefaults}>
          Restore default settings
        </Dropdown.Option>
      </Toolbar.DotsDropdown>
      <Toolbar.Space />
      <PhaseButtons {...props} />
    </Toolbar>
  );
}
