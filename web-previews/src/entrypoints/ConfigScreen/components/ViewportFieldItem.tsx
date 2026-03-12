import { faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, FieldGroup, FieldWrapper, TextField } from 'datocms-react-ui';
import { Field } from 'react-final-form';
import { IconPickerInput } from '../IconPickerInput';
import s from '../styles.module.css';

type Props = {
  name: string;
  index: number;
  onRemove: () => void;
};

export function ViewportFieldItem({ name, index, onRemove }: Props) {
  return (
    <div className={s.group}>
      <div className={s.deletableItem}>
        <FieldGroup>
          <div className={s.viewportGrid}>
            <div>
              <Field name={`${name}.name`}>
                {({ input, meta: { error } }) => (
                  <TextField
                    id={`custom-viewport-${index}-name`}
                    label="Viewport name"
                    placeholder="Tablet"
                    required
                    error={error}
                    {...input}
                  />
                )}
              </Field>
            </div>
            <div>
              <Field name={`${name}.icon`}>
                {({ input, meta: { error } }) => (
                  <FieldWrapper
                    id={`custom-viewport-${index}-icon`}
                    label="Icon"
                    required
                    error={error}
                  >
                    <IconPickerInput {...input} error={error} />
                  </FieldWrapper>
                )}
              </Field>
            </div>
            <div>
              <Field name={`${name}.width`}>
                {({ input, meta: { error } }) => (
                  <TextField
                    id={`custom-viewport-${index}-width`}
                    required
                    label="Viewport width (px)"
                    error={error}
                    {...input}
                  />
                )}
              </Field>
            </div>
            <div>
              <Field name={`${name}.height`}>
                {({ input, meta: { error } }) => (
                  <TextField
                    id={`custom-viewport-${index}-height`}
                    required
                    label="Viewport Height (px)"
                    error={error}
                    {...input}
                  />
                )}
              </Field>
            </div>
          </div>
        </FieldGroup>
        <div className={s.deletableItemAction}>
          <Button
            type="button"
            buttonType="negative"
            buttonSize="xs"
            leftIcon={<FontAwesomeIcon icon={faTrash} />}
            onClick={onRemove}
          >
            Remove viewport
          </Button>
        </div>
      </div>
    </div>
  );
}
