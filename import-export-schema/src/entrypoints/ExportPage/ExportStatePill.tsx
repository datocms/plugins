import Pill from 'datocms-react-ui/Pill';
import { CheckIcon } from '@/icons';
import { type ExportState, exportStateLabels } from './exportState';

/**
 * The word of an export state, on a node of the graph and in the overview.
 * Each state in the file has a check: the word, the check and the look of
 * the node tell it together, never the color alone.
 */
export function ExportStatePill({ state }: { state: ExportState }) {
  return (
    <Pill icon={state === 'excluded' ? undefined : <CheckIcon />}>
      {exportStateLabels[state]}
    </Pill>
  );
}
