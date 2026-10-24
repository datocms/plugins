import Callout from 'datocms-react-ui/Callout';
import InfoList from 'datocms-react-ui/InfoList';
import SidebarPanel, {
  type SidebarPanelCollapse,
} from 'datocms-react-ui/SidebarPanel';
import SmartDate from 'datocms-react-ui/SmartDate';
import { hasFragment, resultExplanation } from '../report/view';
import type { LinkGroup } from '../types';
import { ExternalLink } from '../ui/ExternalLink';
import { LogStatus } from '../ui/LogStatus';
import styles from './Detail.module.css';

type LinkPanelProps = {
  group: LinkGroup;
  /** The open state of the section, kept by the report across rows. */
  collapse: SidebarPanelCollapse;
};

/**
 * The open URL: where it points and its latest result. When its records
 * changed after the scan, a note says so above the facts; it sits in the
 * section, so the panel holds only sections and they give it its inset.
 */
export function LinkPanel({ group, collapse }: LinkPanelProps) {
  const { prepared, result } = group;
  // Other results are explained by their word or the HTTP status row.
  const explanation = resultExplanation(result);
  return (
    <SidebarPanel title="Link" collapse={collapse}>
      {group.stale && (
        <Callout title="Content changed after the scan">
          A record using this URL changed after the scan. Scan again to refresh
          where it's used; “Recheck URL” only refreshes its status.
        </Callout>
      )}
      <InfoList>
        <InfoList.Row title="URL">
          <ExternalLink url={prepared.url} />
          {hasFragment(group) && (
            <div className={styles.note}>
              Some records link to a #fragment of this page. The anchor itself
              isn't verified.
            </div>
          )}
        </InfoList.Row>
        <InfoList.Row title="Status">
          <LogStatus status={result.status} />
          {explanation && <div className={styles.note}>{explanation}</div>}
        </InfoList.Row>
        {result.httpStatus !== undefined && (
          <InfoList.Row title="HTTP status">{result.httpStatus}</InfoList.Row>
        )}
        {result.checkedAt && (
          <InfoList.Row title="Checked">
            <SmartDate value={result.checkedAt} />
          </InfoList.Row>
        )}
      </InfoList>
    </SidebarPanel>
  );
}
