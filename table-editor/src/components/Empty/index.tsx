import EmptySlot from 'datocms-react-ui/EmptySlot';
import type { Value } from '../../types';

type Props = {
  onChange: (newValue: Value | null) => void;
  disabled?: boolean;
};

export const Empty = ({ onChange, disabled }: Props) => {
  // A disabled field can't get a table: the slot shows only its message
  if (disabled) {
    return <EmptySlot message="No table yet" />;
  }

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
