import { findIconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { IconName } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCtx } from 'datocms-react-ui';
import type { FieldInputProps } from 'react-final-form';
import s from './styles.module.css';

type Props = FieldInputProps<IconName>;

export function IconPickerInput({ value, onChange, error }: Props) {
  const ctx = useCtx();
  const handleOpenModal = async () => {
    const result = await ctx.openModal({
      id: 'iconPicker',
      title: 'Select an icon',
      width: 'l',
      parameters: { currentValue: value },
    });

    if (result) {
      onChange(result as IconName);
    }
  };

  return (
    <button
      type="button"
      onClick={handleOpenModal}
      title="Change icon"
      className={[s.button, error && s.error].filter(Boolean).join(' ')}
    >
      {value ? (
        <>
          <FontAwesomeIcon
            icon={findIconDefinition({
              prefix: 'fas',
              iconName: value,
            })}
          />{' '}
          {value}
        </>
      ) : (
        'No icon'
      )}
    </button>
  );
}
