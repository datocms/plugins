import BlankSlate from 'datocms-react-ui/BlankSlate';
import { WarningIcon } from '../../icons';
import styles from './styles.module.css';

/**
 * The inspector panel of a website that didn't connect to the Visual tab:
 * it has no Content Link, thus it reports no records and click-to-edit is
 * off.
 */
export default function NotConnectedPanel() {
  return (
    <div className={styles.box}>
      <BlankSlate
        placement="area"
        small
        icon={<WarningIcon />}
        title="Visual editing isn't available on this website"
        description="Ask a developer to add DatoCMS Content Link to the website."
      />
    </div>
  );
}
