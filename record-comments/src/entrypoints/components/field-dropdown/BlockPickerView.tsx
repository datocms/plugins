import type { BlockInfo } from '@ctypes/mentions';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import type { MutableRefObject, ReactNode, Ref } from 'react';
import { MentionMenuItem, MentionPanelLoading } from '../shared/MentionPanel';

type BlockPickerViewProps = {
  blocks: BlockInfo[];
  selectedIndex: number;
  isLoading: boolean;
  onSelectEntireField: () => void;
  onSelectBlock: (block: BlockInfo) => void;
  onHover: (index: number) => void;
  selectedRef: Ref<HTMLDivElement>;
  justClickedInsideRef: MutableRefObject<boolean>;
};

/** The whole field first, then each of its blocks (the index 0 is the field) */
export function BlockPickerView({
  blocks,
  selectedIndex,
  isLoading,
  onSelectEntireField,
  onSelectBlock,
  onHover,
  selectedRef,
  justClickedInsideRef,
}: BlockPickerViewProps): ReactNode {
  if (isLoading) {
    return <MentionPanelLoading>Loading blocks…</MentionPanelLoading>;
  }

  const markClick = () => {
    justClickedInsideRef.current = true;
  };

  return (
    <>
      <MentionMenuItem
        selected={selectedIndex === 0}
        highlightRef={selectedRef}
        onPress={markClick}
        onPick={onSelectEntireField}
        onHighlight={() => onHover(0)}
      >
        Entire field
      </MentionMenuItem>

      {blocks.length === 0 ? (
        <Dropdown.MenuEmpty>No blocks in this field</Dropdown.MenuEmpty>
      ) : (
        blocks.map((block, index) => {
          const itemIndex = index + 1;
          return (
            <MentionMenuItem
              key={`${block.modelId}-${block.index}`}
              selected={itemIndex === selectedIndex}
              highlightRef={selectedRef}
              onPress={markClick}
              onPick={() => onSelectBlock(block)}
              onHighlight={() => onHover(itemIndex)}
            >
              {`${block.modelName} #${block.index + 1}`}
            </MentionMenuItem>
          );
        })
      )}
    </>
  );
}
