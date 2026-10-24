import type { RenderInspectorPanelCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import { WarningIcon } from '../../icons';
import styles from './styles.module.css';

/** How the Visual tab names the primary environment in the parameters */
const PRIMARY_ENVIRONMENT = '__PRIMARY__';
const PRIMARY_NAME = 'the primary environment';

type Props = {
  ctx: RenderInspectorPanelCtx;
};

type Parameters = {
  environments: string[];
};

function sandboxName(environment: string) {
  return `the sandbox environment “${environment}”`;
}

function environmentName(environment: string) {
  return environment === PRIMARY_ENVIRONMENT
    ? PRIMARY_NAME
    : sandboxName(environment);
}

/** “a”, “a and b”, “a, b and c” */
function joinNames(names: string[]) {
  return names
    .map((name, index) => {
      if (index === 0) {
        return name;
      }
      return `${index === names.length - 1 ? ' and ' : ', '}${name}`;
    })
    .join('');
}

/**
 * The inspector panel of a page whose records belong to other environments
 * than the one of the editor: click-to-edit finds them, but they are not the
 * records that the editor changes.
 */
export default function WrongEnvironmentPanel({ ctx }: Props) {
  const { environments } = ctx.parameters as Parameters;

  const pageEnvironments = joinNames(
    (Array.isArray(environments) ? environments : []).map(environmentName),
  );

  const currentEnvironment = ctx.isEnvironmentPrimary
    ? PRIMARY_NAME
    : sandboxName(ctx.environment);

  return (
    <div className={styles.box}>
      <BlankSlate
        placement="area"
        small
        error
        icon={<WarningIcon />}
        title="Records from another environment"
        description={`Click-to-edit works, but the page shows records from ${pageEnvironments}, and you're working in ${currentEnvironment}. Set the draft mode of the website to load content from ${currentEnvironment}.`}
      />
    </div>
  );
}
