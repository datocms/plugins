import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import { useRovingKeyDown } from 'datocms-react-ui/hooks/useRovingKeyDown';
import RawButton from 'datocms-react-ui/RawButton';
import get from 'lodash-es/get';
import { type CSSProperties, useState } from 'react';
import { useFieldSettings } from '../utils/fieldParams';
import s from './StarRatingEditor.module.css';

type PropTypes = {
  ctx: RenderFieldExtensionCtx;
};

// A five-point star: the round joins of its stroke round its points
const STAR =
  'M12 3.41L14.57 9.37L21.04 9.97L16.16 14.26L17.58 20.59L12 17.28L6.42 20.59L7.84 14.26L2.96 9.97L9.43 9.37Z';

const StarRatingEditor = ({ ctx }: PropTypes) => {
  const value = Number(get(ctx.formValues, ctx.fieldPath)) || 0;
  const [maxRating, starsColor] = useFieldSettings(ctx);
  // The star under the pointer previews the rating that a click gives
  const [hovered, setHovered] = useState<number | null>(null);
  const onKeyDown = useRovingKeyDown('[role="radio"]');
  const shown = ctx.disabled ? value : (hovered ?? value);

  return (
    <Canvas ctx={ctx}>
      <div
        role="radiogroup"
        aria-label={ctx.field.attributes.label}
        className={s.stars}
        // The stars color is the admin's choice, not a role of the interface
        style={{ '--stars-color': starsColor } as CSSProperties}
        onKeyDown={ctx.disabled ? undefined : onKeyDown}
        onMouseLeave={() => setHovered(null)}
      >
        {Array.from({ length: maxRating }, (_, index) => {
          const rating = index + 1;

          return (
            <RawButton
              key={rating}
              className={s.star}
              ariaLabel={rating === 1 ? '1 star' : `${rating} stars`}
              radio={{ checked: rating === value }}
              disabled={ctx.disabled}
              // Tab goes to the current rating, or to the first star
              tabIndex={rating === (value || 1) ? 0 : -1}
              data-on={rating <= shown || undefined}
              onMouseEnter={() => setHovered(rating)}
              onClick={() => ctx.setFieldValue(ctx.fieldPath, rating)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={STAR} />
              </svg>
            </RawButton>
          );
        })}
      </div>
    </Canvas>
  );
};

export default StarRatingEditor;
