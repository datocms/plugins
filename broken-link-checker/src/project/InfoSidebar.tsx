import { ListDetail } from 'datocms-react-ui/ListDetail';
import type { SidebarPanelCollapse } from 'datocms-react-ui/SidebarPanel';
import Toolbar from 'datocms-react-ui/Toolbar';
import { RecheckIcon } from '../icons';
import type { LinkGroup } from '../types';
import { LinkPanel } from './LinkPanel';
import { UsedInPanel } from './UsedInPanel';

const RECHECK_BLOCKED =
  "You can't recheck a URL while links are being checked.";

export type LinkDetailProps = {
  /** The open URL, with its live result: a rechecked URL reads "Checking". */
  group: LinkGroup;
  scanning: boolean;
  rechecking: boolean;
  /** This URL is the one being rechecked (`recheckKey === group.key`). */
  rechecked: boolean;
  changedRecordIds: ReadonlySet<string>;
  /** On a multi-locale site each place names its locale. */
  showLocale: boolean;
  uiLocale: string;
  /** The open state of the "Link" section, kept across rows. */
  linkPanel: SidebarPanelCollapse;
  /** The open state of the "Records" section, kept across rows. */
  recordsPanel: SidebarPanelCollapse;
  onRecheck: (group: LinkGroup) => void;
  onOpenRecord: (recordId: string) => void;
};

/**
 * The detail of the open row: the URL, its result and the records that use
 * it. The parent keys it by `group.key`, so each URL starts again (its record
 * pages, its steps). "Recheck URL" exists only for a URL that can be checked.
 */
export function LinkDetail({
  group,
  scanning,
  rechecking,
  rechecked,
  changedRecordIds,
  showLocale,
  uiLocale,
  linkPanel,
  recordsPanel,
  onRecheck,
  onOpenRecord,
}: LinkDetailProps) {
  const { prepared } = group;
  const pending = rechecking && rechecked;
  // A scan, or the recheck of another URL, holds the checker.
  const blocked = scanning || (rechecking && !rechecked);
  return (
    <ListDetail.Panel
      title="URL"
      entity={{ title: prepared.hostname ?? prepared.url }}
      toolbarAction={
        prepared.status === 'queued' && (
          <Toolbar.Button
            tone="primary"
            icon={RecheckIcon}
            label="Recheck URL"
            busy={pending}
            disabled={blocked ? { reason: RECHECK_BLOCKED } : undefined}
            onClick={() => {
              onRecheck(group);
            }}
          />
        )
      }
    >
      <LinkPanel group={group} collapse={linkPanel} />
      <UsedInPanel
        group={group}
        changedRecordIds={changedRecordIds}
        showLocale={showLocale}
        uiLocale={uiLocale}
        collapse={recordsPanel}
        onOpenRecord={onOpenRecord}
      />
    </ListDetail.Panel>
  );
}
