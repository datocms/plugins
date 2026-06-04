import type {ImageOption} from '../../lib/types';
import s from '../../lib/styles.module.css';

const Image = ({url, name}: Pick<ImageOption, 'url' | 'name'>): JSX.Element => (
	<div className={s['image-preview-container']}>
		<img src={url} alt={name} className={s['image-preview']} />
	</div>
);

export default Image;
