import type { MutableRefObject, ReactNode, Ref } from 'react';
import type { BlockInfo } from '@ctypes/mentions';
import styles from '@styles/comment.module.css';

type BlockPickerViewProps = {
  blocks: BlockInfo[];
  selectedIndex: number;
  isLoading: boolean;
  onSelectEntireField: () => void;
  onSelectBlock: (block: BlockInfo) => void;
  onHover: (index: number) => void;
  selectedRef: Ref<HTMLButtonElement>;
  justClickedInsideRef: MutableRefObject<boolean>;
};

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
    return (
      <div className={styles.mentionList}>
        <div className={styles.mentionEmpty}>Loading blocks...</div>
      </div>
    );
  }

  return (
    <div className={styles.mentionList} role="listbox" aria-label="Select block">
      {/* Select entire field option */}
      <button
        ref={selectedIndex === 0 ? selectedRef : null}
        type="button"
        role="option"
        aria-selected={selectedIndex === 0}
        className={`${styles.mentionOption} ${styles.mentionOptionEntireField} ${selectedIndex === 0 ? styles.mentionOptionSelected : ''}`}
        onMouseDown={(e) => {
          e.preventDefault();
          justClickedInsideRef.current = true;
          onSelectEntireField();
        }}
        onMouseEnter={() => onHover(0)}
      >
        <span className={styles.mentionFieldLabel}>Select entire field</span>
        <span className={styles.mentionFieldMeta}>
          <span className={styles.mentionBlockCount}>
            {blocks.length} block{blocks.length !== 1 ? 's' : ''}
          </span>
        </span>
      </button>

      {/* Block list */}
      {blocks.length === 0 ? (
        <div className={styles.mentionEmpty}>No blocks in this field</div>
      ) : (
        blocks.map((block, index) => {
          const itemIndex = index + 1; // +1 for "Select entire field"
          return (
            <button
              key={`${block.modelId}-${block.index}`}
              ref={itemIndex === selectedIndex ? selectedRef : null}
              type="button"
              role="option"
              aria-selected={itemIndex === selectedIndex}
              className={`${styles.mentionOption} ${itemIndex === selectedIndex ? styles.mentionOptionSelected : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                justClickedInsideRef.current = true;
                onSelectBlock(block);
              }}
              onMouseEnter={() => onHover(itemIndex)}
            >
              <span className={styles.mentionFieldLabel}>
                {block.modelName} #{block.index + 1}
              </span>
              <span className={styles.mentionFieldMeta}>
                <span className={styles.mentionBlockBadge}>{block.modelName}</span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

export default BlockPickerView;
