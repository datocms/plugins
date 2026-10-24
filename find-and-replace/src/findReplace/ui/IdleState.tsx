import BlankSlate from 'datocms-react-ui/BlankSlate';
import { FileMagnifyingGlassIcon } from '../../icons';
import { STRINGS } from './copy';

/**
 * Before the first search: what shows here, and that nothing changes before
 * the review. The icon is the one of the page's navigation tab.
 */
export function IdleState({ enterToSearch }: { enterToSearch: boolean }) {
  return (
    <BlankSlate
      placement="area"
      icon={<FileMagnifyingGlassIcon />}
      title={STRINGS.idleTitle}
      description={enterToSearch ? STRINGS.idleLineEnter : STRINGS.idleLine}
    />
  );
}
