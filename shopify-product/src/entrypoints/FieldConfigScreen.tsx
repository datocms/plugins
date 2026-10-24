import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import FieldSettings from '../components/fieldConfig/FieldSettings';
import type { FieldType } from '../types';

type Props = {
  ctx: RenderManualFieldExtensionConfigScreenCtx;
};

function toFieldType(value: unknown): FieldType | null {
  return value === 'string' || value === 'json' ? value : null;
}

/**
 * The per-field settings (renderManualFieldExtensionConfigScreen). The host
 * draws the box, its title and the field modal's Save: this screen draws the
 * fields only, as flow content, and pushes every change with
 * `ctx.setParameters`.
 */
export default function FieldConfigScreen({ ctx }: Props) {
  const fieldType = toFieldType(ctx.pendingField.attributes.field_type);
  return (
    <Canvas ctx={ctx}>
      {fieldType ? (
        <FieldSettings ctx={ctx} fieldType={fieldType} />
      ) : (
        <Callout>
          The Shopify plugin works on Single-line string and JSON fields.
        </Callout>
      )}
    </Canvas>
  );
}
