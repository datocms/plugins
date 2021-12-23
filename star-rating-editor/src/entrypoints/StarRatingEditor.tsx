import { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import ReactStars from 'react-rating-stars-component';
import get from 'lodash-es/get';
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
        size={32}
        isHalf={false}
        edit={!ctx.disabled}
        value={currentValue || 0}
        onChange={handleChange}
      />
    </Canvas>
  );
};

export default StarRatingEditor;
