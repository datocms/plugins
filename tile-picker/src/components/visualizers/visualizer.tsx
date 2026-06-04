import {useMemo} from 'react';
import type {VisualizationType} from '../../lib/types';
import Color from './color';
import Image from './image';
import type {VisualizerProps} from './types';

const availableVisualizers: Record<VisualizationType, React.ElementType> = {
	color: Color,
	image: Image,
};

const Visualizer = ({type, name, display}: VisualizerProps): JSX.Element => {
	const Component = useMemo<React.ElementType>(() => availableVisualizers[type], [type]);

	return (
		<Component name={name} display={display}/>
	);
};

export default Visualizer;
