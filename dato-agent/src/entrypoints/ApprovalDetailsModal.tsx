import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import type { UnsafeApprovalDetail } from '../components/AgentSurface';
import styles from './ApprovalDetailsModal.module.css';

type Props = {
  ctx: RenderModalCtx;
};

function isApprovalDetail(value: unknown): value is UnsafeApprovalDetail {
  return (
    typeof value === 'object' &&
    value !== null &&
    'label' in value &&
    typeof value.label === 'string' &&
    'value' in value &&
    typeof value.value === 'string'
  );
}

function isCodeDetail(label: string): boolean {
  const normalizedLabel = label.toLowerCase();
  return (
    normalizedLabel.includes('generated typescript') ||
    normalizedLabel.includes('script patch')
  );
}

export default function ApprovalDetailsModal({ ctx }: Props) {
  const details = Array.isArray(ctx.parameters.details)
    ? ctx.parameters.details.filter(isApprovalDetail)
    : [];
  const metadata = details.filter((detail) => !isCodeDetail(detail.label));
  const code = details.filter((detail) => isCodeDetail(detail.label));

  return (
    <Canvas ctx={ctx}>
      <div className={styles.root}>
        {metadata.length > 0 && (
          <dl className={styles.metadata}>
            {metadata.map((detail) => (
              <div key={detail.label}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {code.map((detail) => (
          <section className={styles.codeSection} key={detail.label}>
            <h2>{detail.label}</h2>
            <pre>
              <code>{detail.value}</code>
            </pre>
          </section>
        ))}
      </div>
    </Canvas>
  );
}
