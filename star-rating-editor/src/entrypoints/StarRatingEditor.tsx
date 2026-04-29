import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import get from 'lodash-es/get';
import ReactStars from 'react-rating-stars-component';
import { useFieldSettings } from '../utils/fieldParams';

type PropTypes = {
  ctx: RenderFieldExtensionCtx;
};

const StarRatingEditor = ({ ctx }: PropTypes) => {
  const currentValue = get(ctx.formValues, ctx.fieldPath);

  const handleChange = (newValue: number) => {
    ctx.setFieldValue(ctx.fieldPath, newValue);
  };

  const [maxRating, starsColor] = useFieldSettings(ctx);

  return (
    <Canvas ctx={ctx}>
      <ReactStars
        count={maxRating}
        activeColor={starsColor}
        color={ctx.colorScheme === 'dark' ? 'rgba(255, 255, 255, 0.25)' : '#d9d9d9'}
        char="★"
        size={32}
        isHalf={false}
        edit={!ctx.disabled}
        value={currentValue || 0}
        a11y={true}
        onChange={handleChange}
      />
    </Canvas>
  );
};

export default StarRatingEditor;
