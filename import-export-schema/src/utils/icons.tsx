import DiamondIcon from '@/icons/diamond.svg?react';
import GridIcon from '@/icons/grid-2.svg?react';
import PuzzlePieceIcon from '@/icons/puzzle-piece.svg?react';

/** Central place to expose schema-related icons for node renderers. */
const BlockIcon = () => {
  return <GridIcon style={{ transform: 'rotate(45deg)' }} />;
};

export const Schema = {
  ModelsIcon: DiamondIcon,
  BlocksIcon: BlockIcon,
  PluginsIcon: PuzzlePieceIcon,
};
