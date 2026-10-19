import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { get } from 'lodash-es';
import {
  analyzeSeoValue,
  type LengthLimit,
  type LengthStatus,
  type SeoPartResult,
} from '../lib/analyzeSeo';
import s from './styles.module.css';

type Props = {
  ctx: RenderFieldExtensionCtx;
};

/** Formats a limit as `60`, `min 30` or `30–60`; empty when unbounded. */
const formatLimit = ({ min, max }: LengthLimit): string => {
  if (min !== undefined && max !== undefined) {
    return `${min.toLocaleString()}–${max.toLocaleString()}`;
  }

  if (max !== undefined) {
    return max.toLocaleString();
  }

  if (min !== undefined) {
    return `min ${min.toLocaleString()}`;
  }

  return '';
};

const STATUS_HINTS: Record<LengthStatus, string | undefined> = {
  ok: undefined,
  over: 'Too long',
  under: 'Too short',
};

/** One `Label count/limit` metric for an SEO title or description. */
const SeoMetric = ({
  label,
  result,
}: {
  label: string;
  result: SeoPartResult;
}) => {
  const limit = formatLimit(result.limit);
  const isInvalid = result.status !== 'ok';

  return (
    <span className={s.summaryMetric} title={STATUS_HINTS[result.status]}>
      <span className={s.summaryLabel}>{label}</span>{' '}
      <span className={isInvalid ? s.summaryValueInvalid : s.summaryValue}>
        {result.count.toLocaleString()}
      </span>
      {limit && <span className={s.summaryLabel}> / {limit}</span>}
      <span className={s.summaryLabel}> chars</span>
    </span>
  );
};

/** Live character counts for an SEO field's title and description. */
export default function SeoFieldExtension({ ctx }: Props) {
  const analysis = analyzeSeoValue(
    get(ctx.formValues, ctx.fieldPath),
    ctx.field.attributes.validators,
  );

  return (
    <Canvas ctx={ctx}>
      <div className={s.wrapper}>
        <div className={s.summaryBar}>
          <div className={s.summaryMetrics}>
            <SeoMetric label="Title" result={analysis.title} />
            <SeoMetric label="Description" result={analysis.description} />
          </div>
        </div>
      </div>
    </Canvas>
  );
}
