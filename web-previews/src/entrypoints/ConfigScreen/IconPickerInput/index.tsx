import { findIconDefinition } from '@fortawesome/fontawesome-svg-core';
import { type IconName, fas } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Dropdown, DropdownMenu, DropdownOption } from 'datocms-react-ui';
import { snakeCase } from 'lodash-es';
import type { FieldInputProps } from 'react-final-form';
import s from './styles.module.css';

type Props = FieldInputProps<IconName>;

export function IconPickerInput({ value, onChange, error }: Props) {
  return (
    <Dropdown
      renderTrigger={({ onClick }) => (
        <button
          type="button"
          onClick={onClick}
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
      )}
    >
      <DropdownMenu>
        {Object.keys(fas)
          .map((iconName) =>
            snakeCase(iconName.replace(/^fa/, '')).replace(/_/g, '-'),
          )
          .map((iconName) => {
            return (
              <DropdownOption
                key={iconName}
                onClick={() => onChange(iconName)}
                active={value === iconName}
              >
                <FontAwesomeIcon
                  icon={findIconDefinition({
                    prefix: 'fas',
                    iconName: iconName as IconName,
                  })}
                  style={{ marginRight: '8px' }}
                />
                <span className={s.iconName}>{iconName}</span>
              </DropdownOption>
            );
          })}
      </DropdownMenu>
    </Dropdown>
  );
}
