import { faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { RenderInspectorPanelCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import styles from './styles.module.css';

type Props = {
  ctx: RenderInspectorPanelCtx;
};

type Parameters = {
  environments: string[];
};

export default function WrongEnvironmentPanel({ ctx }: Props) {
  const { environments } = ctx.parameters as Parameters;

  const formatEnvironmentName = (env: string) => {
    return env === '__PRIMARY__'
      ? 'primary environment'
      : `sandbox environment ${env}`;
  };

  const currentEnvironment = ctx.isEnvironmentPrimary
    ? 'primary environment'
    : `sandbox environment ${ctx.environment}`;

  return (
    <Canvas ctx={ctx}>
      <div className={styles.wrapper}>
        <div className={styles.container}>
          <div className={styles.iconWrapper}>
            <FontAwesomeIcon
              icon={faExclamationTriangle}
              className={styles.icon}
            />
          </div>
          <h3 className={styles.title}>Environment Mismatch Detected</h3>
          <p className={styles.paragraph}>
            <span className={styles.goodNews}>Good news:</span> Visual Editing
            is working! The click-to-edit overlays are detecting records on this
            page.
          </p>
          <p className={styles.paragraph}>
            <span className={styles.however}>However,</span> the records found
            belong to the{' '}
            <span className={styles.environmentList}>
              {environments.map((env, i) => (
                <span key={env}>
                  {i > 0 && (i === environments.length - 1 ? ' and ' : ', ')}
                  <span className={styles.strong}>
                    {formatEnvironmentName(env)}
                  </span>
                </span>
              ))}
            </span>
            , but you're currently viewing from the{' '}
            <span className={styles.strong}>{currentEnvironment}</span>.
          </p>
          <p className={styles.paragraph}>
            This usually happens when your website is displaying content from
            one environment while you're editing in another. To fix this, make
            sure your website's draft mode is loading content from the{' '}
            <span className={styles.strong}>{currentEnvironment}</span>.
          </p>
        </div>
      </div>
    </Canvas>
  );
}
