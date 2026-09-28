import { faArrowsRotate } from '@fortawesome/free-solid-svg-icons';
import { Spinner } from 'datocms-react-ui';
import type { ReactNode } from 'react';
import { formatDateTime } from '../report/format';
import { hasFragment, resultExplanation } from '../report/view';
import type { LinkGroup } from '../types';
import { Button } from '../ui/Button';
import { ExternalLink } from '../ui/ExternalLink';
import { Icon } from '../ui/Icon';
import { LogStatus } from '../ui/LogStatus';
import { DisabledReason } from '../ui/WithTooltip';

type LinkPanelProps = {
  group?: LinkGroup;
  scanning: boolean;
  rechecking: boolean;
  /** This group is the one being rechecked. */
  rechecked: boolean;
  uiLocale: string;
  onRecheck: (group: LinkGroup) => void;
};

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="dl-info-row">
      <span className="dl-info-row__label">{label}</span>
      <span className="dl-info-row__value">{children}</span>
    </div>
  );
}

function LinkUrl({ group }: { group: LinkGroup }) {
  return (
    <p className="blc-link-url">
      <ExternalLink url={group.prepared.url} />
    </p>
  );
}

function LinkNotes({ group }: { group: LinkGroup }) {
  // Other results are explained by their word, the HTTP status row or the summary's callout.
  const reason = resultExplanation(group.result);
  const fragment = hasFragment(group);
  if (!reason && !fragment && !group.stale) return null;
  return (
    <div className="blc-link-notes">
      {reason && <p className="blc-note">{reason}</p>}
      {fragment && (
        <p className="blc-note">
          Some records link to a #fragment of this page. The page is checked
          without it, so the anchor itself is not verified.
        </p>
      )}
      {group.stale && (
        <p className="blc-note">
          A record using this URL changed after the scan. Scan again to refresh
          where it's used; "Recheck URL" only refreshes its status.
        </p>
      )}
    </div>
  );
}

function RecheckButton({
  group,
  scanning,
  rechecking,
  rechecked,
  onRecheck,
}: Omit<LinkPanelProps, 'group' | 'uiLocale'> & { group: LinkGroup }) {
  const disabled = scanning || rechecking;
  const pending = rechecking && rechecked;
  const reason =
    scanning || (rechecking && !rechecked)
      ? 'You cannot recheck a URL while links are being checked'
      : null;
  return (
    <div className="blc-sidebar-action">
      <DisabledReason block reason={reason}>
        <Button
          buttonSize="xs"
          fullWidth
          leftIcon={pending ? undefined : <Icon icon={faArrowsRotate} />}
          disabled={disabled}
          style={disabled ? { pointerEvents: 'none' } : undefined}
          onClick={() => onRecheck(group)}
        >
          {/* An async action keeps its label and adds a spinner while pending */}
          {pending ? (
            <>
              Recheck URL&nbsp;
              <Spinner size={20} />
            </>
          ) : (
            'Recheck URL'
          )}
        </Button>
      </DisabledReason>
    </div>
  );
}

/** The selected URL: where it points, its latest result, and "Recheck URL". */
export function LinkPanel({
  group,
  scanning,
  rechecking,
  rechecked,
  uiLocale,
  onRecheck,
}: LinkPanelProps) {
  if (!group)
    return (
      <p className="dl-sidebar-panel__empty">
        Select a URL to see its details and where it's used.
      </p>
    );
  const { result } = group;
  return (
    <>
      <LinkUrl group={group} />
      <div>
        <InfoRow label="Status">
          <LogStatus status={result.status} />
        </InfoRow>
        {result.httpStatus !== undefined && (
          <InfoRow label="HTTP status">{result.httpStatus}</InfoRow>
        )}
        {result.checkedAt && (
          <InfoRow label="Checked at">
            {formatDateTime(result.checkedAt, uiLocale)}
          </InfoRow>
        )}
      </div>
      <LinkNotes group={group} />
      {group.prepared.status === 'queued' && (
        <RecheckButton
          group={group}
          scanning={scanning}
          rechecking={rechecking}
          rechecked={rechecked}
          onRecheck={onRecheck}
        />
      )}
    </>
  );
}
