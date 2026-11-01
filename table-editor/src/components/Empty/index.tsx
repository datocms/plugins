import EmptySlot from 'datocms-react-ui/EmptySlot';
import type { Value } from '../../types';

type Props = {
  onChange: (newValue: Value | null) => void;
};

export const Empty = ({ onChange }: Props) => {
  return (
    <EmptySlot
      message="No table yet"
      action={{
        label: 'Add table',
        onClick: () => {
          onChange({
            columns: ['Column A', 'Column B'],
            data: [{ 'Column A': '', 'Column B': '' }],
          });
        },
      }}
    />
  );
};
