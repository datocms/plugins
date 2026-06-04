import type {VisualizerProps} from './types';
import s from '../../lib/styles.module.css';

const Image = ({display, name}: VisualizerProps): JSX.Element => (
	<div className={s['image-preview-container']}>
		<img src={display} alt={name} className={s['image-preview']}/>
	</div>
);

export default Image;
