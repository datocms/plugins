import type { Option } from '../../lib/types';
import Color from './color';
import Image from './image';

const Visualizer = ({ option }: { option: Option }) => {
  if (option.type === 'color') return <Color color={option.color} />;
  return <Image url={option.url} />;
};

export default Visualizer;
