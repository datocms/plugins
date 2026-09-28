import { faBan } from '@fortawesome/free-solid-svg-icons';
import { BlankSlate } from '../ui/BlankSlate';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { LinkButton } from '../ui/LinkButton';

/** Without the current-user API permission the page can't read records, so it offers no scan controls. */
export function NoAccessState() {
  return (
    <div className="dl-pane-state">
      <div className="dl-pane-state__icon">
        <Icon icon={faBan} />
      </div>
      <h2 className="dl-pane-state__title">API access needed</h2>
      <p>
        This plugin needs permission to make API calls on behalf of the
        logged-in user to read your saved records. Ask a project admin to grant
        it, then reload this page.
      </p>
      <p>
        You can still check the record you're editing from its "Broken links"
        sidebar panel.
      </p>
    </div>
  );
}

/**
 * `hasModels` tells an empty environment apart from a role that can't read any
 * model. `onOpenSchema` is passed only to roles that can edit the schema.
 */
export function NoModelsState({
  hasModels,
  onOpenSchema,
}: {
  hasModels: boolean;
  onOpenSchema?: () => void;
}) {
  if (hasModels)
    return (
      <BlankSlate title="No models to scan">
        <p>
          Your role cannot read the records of any model in this environment.
          Ask a project admin for read access to the models you want to check.
        </p>
      </BlankSlate>
    );
  return (
    <BlankSlate title="No models to scan">
      <p>This environment doesn't have any models yet.</p>
      <p>
        {onOpenSchema ? (
          <LinkButton onClick={onOpenSchema}>
            Create a model in Schema
          </LinkButton>
        ) : (
          'Models are created in Schema.'
        )}
      </p>
    </BlankSlate>
  );
}

/** Before the first scan: one sentence and the pane's one primary, "Scan links". "Choose what to scan…" sits in the toolbar. */
export function FirstRunSlate({ onScan }: { onScan: () => void }) {
  return (
    <BlankSlate
      title="No links checked yet"
      action={
        <Button buttonType="primary" buttonSize="l" onClick={onScan}>
          Scan links
        </Button>
      }
    >
      <p>Scan your saved records to find broken links.</p>
    </BlankSlate>
  );
}
