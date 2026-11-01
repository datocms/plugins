import s from '../../lib/styles.module.css';
import type { ImageOption } from '../../lib/types';

// The name of the option shows next to the image: the image needs no text
const Image = ({ url }: Pick<ImageOption, 'url'>) => (
  <div className={s.image}>
    <img src={url || undefined} alt="" loading="lazy" />
  </div>
);

export default Image;
