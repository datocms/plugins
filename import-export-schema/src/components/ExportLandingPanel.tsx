import { Button } from 'datocms-react-ui';

interface Props {
  onSelectModels: () => void;
  onExportAll: () => void | Promise<void>;
  exportAllDisabled: boolean;
  title?: string;
  description?: string;
  selectLabel?: string;
  exportAllLabel?: string;
}

/**
 * First step of the export flow that offers the quick actions without surfacing
 * the detailed selection UI.
 */
export function ExportLandingPanel({
  onSelectModels,
  onExportAll,
  exportAllDisabled,
  title = 'Start a new export',
  description = 'Choose how you want to start the export process.',
  selectLabel = 'Export select models',
  exportAllLabel = 'Export entire schema',
}: Props) {
  return (
    <div className="blank-slate__body">
      <div className="blank-slate__body__title">{title}</div>
      <div className="blank-slate__body__content">
        <p>{description}</p>
        <div className="export-landing__actions">
          <Button buttonType="muted" buttonSize="l" onClick={onSelectModels}>
            {selectLabel}
          </Button>
          <Button
            buttonType="primary"
            buttonSize="l"
            disabled={exportAllDisabled}
            onClick={() => {
              void onExportAll();
            }}
          >
            {exportAllLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
