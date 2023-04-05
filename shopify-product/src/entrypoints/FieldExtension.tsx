import { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import Value from '../components/Value';
import Empty from '../components/Empty';
import { Product } from '../utils/ShopifyClient';
import get from 'lodash-es/get';

type PropTypes = {
  ctx: RenderFieldExtensionCtx;
};

export default function FieldExtension({ ctx }: PropTypes) {
  const fieldType = ctx.field.attributes.field_type;

  const rawValue = get(ctx.formValues, ctx.fieldPath) as string;

  let shopifyHandle;

  switch (fieldType) {
    case 'json':
      shopifyHandle = rawValue && JSON.parse(rawValue).handle;
      break;
    case 'string':
      shopifyHandle = rawValue;
      break;

    default:
      break;
  }

  const handleSelect = (product: Product) => {
    ctx.setFieldValue(
      ctx.fieldPath,
      fieldType === 'json' ? JSON.stringify(product) : product.handle,
    );
  };

  const handleReset = () => {
    ctx.setFieldValue(ctx.fieldPath, null);
  };

  return (
    <Canvas ctx={ctx}>
      {shopifyHandle ? (
        <Value value={shopifyHandle} onReset={handleReset} />
      ) : (
        <Empty onSelect={handleSelect} />
      )}
    </Canvas>
  );
}
