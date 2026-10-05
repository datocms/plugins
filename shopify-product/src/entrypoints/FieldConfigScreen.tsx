import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import FieldSettings from '../components/fieldConfig/FieldSettings';
import Callout from '../components/shared/Callout';
import type { FieldType } from '../types';
import styles from './FieldConfigScreen.module.css';

type Props = {
  ctx: RenderManualFieldExtensionConfigScreenCtx;
};

function toFieldType(value: unknown): FieldType | null {
  return value === 'string' || value === 'json' ? value : null;
}

/**
 * The per-field settings (renderManualFieldExtensionConfigScreen). The host
 * draws the box, its title and the field modal's Save: this screen draws the
 * controls only and pushes every change with `ctx.setParameters`.
 */
export default function FieldConfigScreen({ ctx }: Props) {
  const fieldType = toFieldType(ctx.pendingField.attributes.field_type);
  return (
    <Canvas ctx={ctx}>
      <div className={`dl-kit-form-parity ${styles.root}`}>
        {fieldType ? (
          <FieldSettings ctx={ctx} fieldType={fieldType} />
        ) : (
          <Callout tone="neutral">
            The Shopify plugin works on Single-line string and JSON fields.
          </Callout>
        )}
      </div>
    </Canvas>
  );
}
