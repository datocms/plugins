import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import { ListDetail } from 'datocms-react-ui/ListDetail';
import Main from 'datocms-react-ui/Main';
import SplitButton from 'datocms-react-ui/SplitButton';
import { README_URL } from '../constants';
import { CircleExclamationIcon, LinkIcon } from '../icons';
import styles from './Notices.module.css';

/**
 * Without the current-user API permission the page can't read records, so it
 * explains what's missing and offers no scan controls.
 */
export function NoAccessState() {
  return (
    <Main className={styles.screen}>
      <BlankSlate
        placement="area"
        titleLevel={1}
        error
        icon={<CircleExclamationIcon />}
        title="Link checker can't read your records"
        description="Ask a project admin to give this plugin access to your records, then reload this page. Meanwhile, you can check a record from its “Broken links” panel."
      />
    </Main>
  );
}

type NoModelsStateProps = {
  /** The environment has models, but the role can't read any of them. */
  hasModels: boolean;
  /** The Schema page, given only to roles that can edit the schema. */
  schemaPath?: string;
};

/**
 * Nothing the role can scan: an empty environment, or a role that can't read
 * any model. Only an empty environment leads to Schema.
 */
export function NoModelsState({ hasModels, schemaPath }: NoModelsStateProps) {
  return (
    <Main className={styles.screen}>
      <BlankSlate
        placement="area"
        titleLevel={1}
        icon={<LinkIcon />}
        title="No models to scan"
        description={
          hasModels
            ? "Your role can't read the records of any model in this environment. Ask a project admin for read access to the models you want to check."
            : "This environment doesn't have any models yet."
        }
        actions={
          !hasModels &&
          schemaPath !== undefined && (
            <Button label="Open Schema" to={schemaPath} />
          )
        }
      />
    </Main>
  );
}

type FirstRunOverviewProps = {
  /** Scans the current scope. */
  onScan: () => void;
  onChooseScope: () => void;
};

/**
 * Before the first scan: what the page does, and the scan with its variant.
 * The split's overview area holds it, so it sits in the center of the same
 * area as the list and the detail that replace it.
 */
export function FirstRunOverview({
  onScan,
  onChooseScope,
}: FirstRunOverviewProps) {
  return (
    <Main className={styles.screen}>
      <ListDetail.Overview>
        <BlankSlate
          placement="area"
          titleLevel={1}
          icon={<LinkIcon />}
          title="Link checker"
          description="Scan your saved records to find broken website links."
          docs={[{ href: README_URL }]}
          actions={
            <SplitButton
              tone="primary"
              label="Scan links"
              onClick={onScan}
              menu={{ ariaLabel: 'More scan options' }}
            >
              <Dropdown.Option onPick={onChooseScope}>
                Choose what to scan…
              </Dropdown.Option>
            </SplitButton>
          }
        />
      </ListDetail.Overview>
    </Main>
  );
}
