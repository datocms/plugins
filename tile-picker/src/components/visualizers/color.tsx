import type {ColorOption} from '../../lib/types';
import s from '../../lib/styles.module.css';

const Color = ({color}: Pick<ColorOption, 'color'>): JSX.Element => (
	<div className={s['color-preview']} style={{backgroundColor: color}} />
);

export default Color;
