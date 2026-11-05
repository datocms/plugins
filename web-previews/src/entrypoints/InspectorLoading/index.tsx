import type { RenderInspectorPanelCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import {
  getVisualEditingFrontends,
  normalizeParameters,
  type Parameters,
} from '../../types';
import styles from './styles.module.css';

type Props = {
  ctx: RenderInspectorPanelCtx;
};

/**
 * The inspector panel while the Visual tab has nothing else to show in it:
 * the page reports its records once it connects. With no frontend that has
 * visual editing, no page ever connects: the Visual tab tells why.
 */
export default function InspectorLoading({ ctx }: Props) {
  const noPage =
    getVisualEditingFrontends(
      normalizeParameters(ctx.plugin.attributes.parameters as Parameters),
    ).length === 0;

  return (
    <div className={styles.box}>
      {noPage ? (
        <BlankSlate placement="area" small title="No records to show" />
      ) : (
        <BlankSlate
          placement="area"
          small
          loading
          title="Loading the records on this page"
        />
      )}
    </div>
  );
}
