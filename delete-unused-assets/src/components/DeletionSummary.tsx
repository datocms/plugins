import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import InfoList from 'datocms-react-ui/InfoList';
import s from '../entrypoints/styles.module.css';
import { type Formatters, formatBytes, useFormatters } from '../utils/format';
import type { DeletionResult } from '../utils/unusedAssets';

export function isComplete(result: DeletionResult) {
  return (
    !result.cancelled &&
    !result.error &&
    result.failed === 0 &&
    result.processed === result.total
  );
}

// The text of the toast that the host shows after a complete deletion.
export function deletedMessage(result: DeletionResult, format: Formatters) {
  return result.deleted === 1
    ? 'The asset was permanently deleted from your project.'
    : `${format.assets(result.deleted)} were permanently deleted from your project.`;
}

// A complete deletion has no callout: the host tells it with a toast. A
// stopped or failed one tells what is left.
function summaryCallout(result: DeletionResult) {
  if (result.cancelled) {
    return {
      tone: 'warning',
      title: 'Deletion stopped',
      body: 'Assets deleted before you stopped stay deleted. The rest were left untouched.',
    } as const;
  }
  return {
    tone: 'danger',
    title: "Deletion didn't complete",
    body:
      result.error ??
      "Some assets couldn't be deleted. Check the details below before starting another deletion.",
  } as const;
}

type Props = {
  result: DeletionResult;
  onClose: () => void;
};

export default function DeletionSummary({ result, onClose }: Props) {
  const format = useFormatters();
  const complete = isComplete(result);
  const callout = complete ? null : summaryCallout(result);
  const details = [
    ['Skipped (in use or already removed)', result.skipped],
    ['Failed', result.failed],
    ['Not processed', result.total - result.processed],
  ] as const;

  return (
    <div className={s.stack}>
      {callout && (
        <Callout tone={callout.tone} title={callout.title}>
          {callout.body}
        </Callout>
      )}
      <InfoList>
        <InfoList.Row title="Assets deleted">
          {format.count(result.deleted)}
        </InfoList.Row>
        <InfoList.Row
          title={
            result.freedBytesEstimated
              ? 'Storage freed (estimated)'
              : 'Storage freed'
          }
        >
          {formatBytes(result.freedBytes)}
        </InfoList.Row>
        {details.map(
          ([title, value]) =>
            value > 0 && (
              <InfoList.Row key={title} title={title}>
                {format.count(value)}
              </InfoList.Row>
            ),
        )}
      </InfoList>
      <div className={s.actions}>
        <Button
          label="Close"
          tone={complete ? 'primary' : 'soft'}
          onClick={onClose}
        />
      </div>
    </div>
  );
}
