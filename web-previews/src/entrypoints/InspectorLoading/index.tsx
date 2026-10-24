import BlankSlate from 'datocms-react-ui/BlankSlate';
import styles from './styles.module.css';

/**
 * The inspector panel while the Visual tab has nothing else to show in it:
 * the page reports its records once it connects
 */
export default function InspectorLoading() {
  return (
    <div className={styles.box}>
      <BlankSlate
        placement="area"
        small
        loading
        title="Loading the records of the page"
      />
    </div>
  );
}
