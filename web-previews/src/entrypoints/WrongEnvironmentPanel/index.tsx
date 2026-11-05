import type { RenderInspectorPanelCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import { WarningIcon } from '../../icons';
import styles from './styles.module.css';

/** How the Visual tab names the primary environment in the parameters */
const PRIMARY_ENVIRONMENT = '__PRIMARY__';

type Props = {
  ctx: RenderInspectorPanelCtx;
};

type Parameters = {
  environments: string[];
};

/** One environment, in a sentence */
function environmentName(environment: string) {
  return environment === PRIMARY_ENVIRONMENT
    ? 'the primary environment'
    : `the sandbox “${environment}”`;
}

/** An environment in a short list */
function shortName(environment: string) {
  return environment === PRIMARY_ENVIRONMENT ? 'primary' : `“${environment}”`;
}

/**
 * The inspector panel of a page whose records belong to other environments
 * than the one of the editor: they are not the records that the editor
 * changes, and a click on the page opens none of them.
 */
export default function WrongEnvironmentPanel({ ctx }: Props) {
  const { environments: raw } = ctx.parameters as Parameters;
  const environments = Array.isArray(raw) ? raw : [];

  // What the other environments mean for the editor, then the next step,
  // which names the environment of the editor
  const effectAndNextStep = `so clicking it doesn't open records and your changes won't show here. Ask a developer to point the website's preview to ${environmentName(
    ctx.isEnvironmentPrimary ? PRIMARY_ENVIRONMENT : ctx.environment,
  )}.`;

  const description =
    environments.length > 1
      ? `This page shows content from other environments (${environments
          .map(shortName)
          .join(', ')}), ${effectAndNextStep}`
      : `This page shows content from ${environmentName(
          environments[0] ?? '',
        )}, ${effectAndNextStep}`;

  return (
    <div className={styles.box}>
      <BlankSlate
        placement="area"
        small
        icon={<WarningIcon />}
        title={
          environments.length > 1
            ? 'Content from other environments'
            : 'Content from another environment'
        }
        description={description}
      />
    </div>
  );
}
