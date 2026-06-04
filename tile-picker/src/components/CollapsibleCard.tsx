import type {ReactNode} from 'react';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faChevronRight, faChevronDown} from '@fortawesome/free-solid-svg-icons';
import s from '../lib/styles.module.css';

type CollapsibleCardProps = {
	header: ReactNode;
	isOpen: boolean;
	onToggle: () => void;
	children: ReactNode;
	hasError?: boolean;
};

export default function CollapsibleCard({header, isOpen, onToggle, children, hasError}: CollapsibleCardProps): JSX.Element {
	return (
		<div className={`${s['card']}${hasError ? ` ${s['card--error']}` : ''}`}>
			<div
				role="button"
				tabIndex={0}
				className={s['card-header']}
				onClick={onToggle}
				onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
			>
				<FontAwesomeIcon icon={isOpen ? faChevronDown : faChevronRight} className={s['card-chevron']} fixedWidth />
				{header}
			</div>
			<div className={s['card-body']} style={isOpen ? undefined : {display: 'none'}}>{children}</div>
		</div>
	);
}
