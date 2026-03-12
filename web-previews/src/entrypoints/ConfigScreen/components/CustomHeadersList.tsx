import { faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, FieldGroup, FormLabel, TextField } from 'datocms-react-ui';
import { Field } from 'react-final-form';
import { FieldArray } from 'react-final-form-arrays';
import s from '../styles.module.css';

type Props = {
  name: string;
  frontendIndex: number;
};

export function CustomHeadersList({ name, frontendIndex }: Props) {
  return (
    <div>
      <FormLabel htmlFor="">Custom Headers</FormLabel>
      <FieldArray name={`${name}.customHeaders`}>
        {({ fields }) => (
          <FieldGroup>
            {fields.map((header, headerIndex) => (
              <div key={header} className={s.deletableItem}>
                <div className={s.headerGrid}>
                  <div>
                    <Field name={`${header}.name`}>
                      {({ input, meta: { error } }) => (
                        <TextField
                          id={`frontend-${frontendIndex}-headers-${headerIndex}-name`}
                          label="Header"
                          placeholder="Header"
                          required
                          error={error}
                          {...input}
                        />
                      )}
                    </Field>
                  </div>
                  <div>
                    <Field name={`${header}.value`}>
                      {({ input, meta: { error } }) => (
                        <TextField
                          id={`frontend-${frontendIndex}-headers-${headerIndex}-value`}
                          label="Value"
                          placeholder="Value"
                          required
                          error={error}
                          {...input}
                        />
                      )}
                    </Field>
                  </div>
                </div>
                <div className={s.deletableItemAction}>
                  <Button
                    type="button"
                    buttonType="negative"
                    buttonSize="s"
                    leftIcon={<FontAwesomeIcon icon={faTrash} />}
                    onClick={() => fields.remove(headerIndex)}
                  >
                    Remove header
                  </Button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              buttonSize="s"
              leftIcon={<FontAwesomeIcon icon={faPlus} />}
              onClick={() =>
                fields.push({
                  name: '',
                  value: '',
                })
              }
            >
              Add header
            </Button>
          </FieldGroup>
        )}
      </FieldArray>
    </div>
  );
}
