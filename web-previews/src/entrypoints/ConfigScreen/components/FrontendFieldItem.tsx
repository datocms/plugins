import { faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, FieldGroup, SwitchField, TextField } from 'datocms-react-ui';
import { Field } from 'react-final-form';
import type { RawFrontend } from '../../../types';
import s from '../styles.module.css';
import { PreviewLinksSection } from './PreviewLinksSection';
import { VisualEditingSection } from './VisualEditingSection';

type Props = {
  name: string;
  index: number;
  frontend: RawFrontend;
  onRemove: () => void;
};

export function FrontendFieldItem({ name, index, frontend, onRemove }: Props) {
  return (
    <div className={s.group}>
      <div className={s.deletableItem}>
        <FieldGroup>
          <Field name={`${name}.name`}>
            {({ input, meta: { error } }) => (
              <TextField
                id={`frontend-${index}-name`}
                label="Frontend name"
                placeholder="Staging"
                required
                error={error}
                {...input}
              />
            )}
          </Field>

          <PreviewLinksSection name={name} index={index} frontend={frontend} />
          <VisualEditingSection name={name} index={index} frontend={frontend} />

          <Field name={`${name}.disabled`}>
            {({ input, meta: { error } }) => (
              <SwitchField
                id={`frontend-${index}-disabled`}
                label="Temporarily disable this frontend"
                hint="Disabled frontends remain configured but won't be visible to editors."
                error={error}
                {...input}
              />
            )}
          </Field>
        </FieldGroup>
        <div className={s.deletableItemAction}>
          <Button
            type="button"
            buttonType="negative"
            buttonSize="xs"
            leftIcon={<FontAwesomeIcon icon={faTrash} />}
            onClick={onRemove}
          >
            Remove frontend
          </Button>
        </div>
      </div>
    </div>
  );
}
