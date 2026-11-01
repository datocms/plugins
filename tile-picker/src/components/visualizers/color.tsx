import s from '../../lib/styles.module.css';
import type { ColorOption } from '../../lib/types';

const Color = ({ color }: Pick<ColorOption, 'color'>) => (
  <div className={s.color} style={{ backgroundColor: color }} />
);

export default Color;
