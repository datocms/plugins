import {
  SidebarPanel,
  Toolbar,
  ToolbarStack,
  ToolbarTitle,
} from 'datocms-react-ui';
import { useEffect, useRef } from 'react';
import { countLabel } from '../report/format';
import { groupFacts } from '../report/view';
import type { LinkGroup } from '../types';
import { LinkPanel } from './LinkPanel';
import { UsedInPanel } from './UsedInPanel';

type InfoSidebarProps = {
  group?: LinkGroup;
  scanning: boolean;
  rechecking: boolean;
  /** `recheckKey === group.key` */
  rechecked: boolean;
  changedRecordIds: ReadonlySet<string>;
  /** On a multi-locale site each place names its locale. */
  showLocale: boolean;
  uiLocale: string;
  /** In the overlay, which mounts on open: focus starts here. */
  isOverlay: boolean;
  onRecheck: (group: LinkGroup) => void;
  onOpenRecord: (recordId: string) => void;
};

/** Secondary information about the selected URL, in stacked panels. */
export function InfoSidebar({
  group,
  scanning,
  rechecking,
  rechecked,
  changedRecordIds,
  showLocale,
  uiLocale,
  isOverlay,
  onRecheck,
  onOpenRecord,
}: InfoSidebarProps) {
  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (isOverlay) asideRef.current?.focus({ preventScroll: true });
  }, [isOverlay]);

  return (
    <aside
      ref={asideRef}
      className="dl-pane dl-pane--last blc-info"
      aria-label="Link details"
      tabIndex={isOverlay ? -1 : undefined}
    >
      <Toolbar style={{ flex: 'none', minHeight: 60 }}>
        <ToolbarStack
          stackSize="s"
          style={{ gap: 'var(--spacing-m)', minWidth: 0 }}
        >
          <ToolbarTitle className="dl-toolbar__title">
            <h2 className="blc-heading">Info</h2>
          </ToolbarTitle>
          <div style={{ flex: 1 }} />
        </ToolbarStack>
      </Toolbar>
      {/* The panels keep their open state across selections. */}
      <div className="dl-pane__body dl-kit-panels">
        <SidebarPanel title="Link" startOpen>
          <LinkPanel
            group={group}
            scanning={scanning}
            rechecking={rechecking}
            rechecked={rechecked}
            uiLocale={uiLocale}
            onRecheck={onRecheck}
          />
        </SidebarPanel>
        {group && (
          <SidebarPanel
            title={countLabel(
              groupFacts(group).recordCount,
              'Used in 1 record',
              'Used in {n} records',
              uiLocale,
            )}
            startOpen
            noPadding
          >
            <UsedInPanel
              key={group.key}
              group={group}
              changedRecordIds={changedRecordIds}
              showLocale={showLocale}
              uiLocale={uiLocale}
              onOpenRecord={onOpenRecord}
            />
          </SidebarPanel>
        )}
      </div>
    </aside>
  );
}
