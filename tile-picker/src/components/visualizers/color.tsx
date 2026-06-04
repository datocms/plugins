import type {VisualizerProps} from './types';
import s from '../../lib/styles.module.css';

const Color = ({display}: VisualizerProps): JSX.Element => (
	<div className={s['color-preview']} style={{backgroundColor: display}}/>
);

export default Color;
