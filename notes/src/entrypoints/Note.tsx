import Button from 'datocms-react-ui/Button';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import SmartDate from 'datocms-react-ui/SmartDate';
import TextareaInput from 'datocms-react-ui/TextareaInput';
import type React from 'react';
import { useState } from 'react';
import { TrashIcon } from '../icons';
import styles from './note.module.css';

type noteProps = {
  deleteNotes: (timestamp: string) => void;
  editNotes: (timestamp: string, newValue: string) => void;
  value: string;
  date: string;
};

const Note: React.FC<noteProps> = (props) => {
  const [textAreaValue, setTextAreaValue] = useState(props.value);
  const noteDate = props.date;

  return (
    <FieldWrapper
      label="Note"
      labelExtras={{ hidden: true }}
      container={{
        trailing: (
          <div className={styles.footer}>
            <SmartDate value={noteDate} />
            <Button
              tone="ghost-alert"
              size="micro"
              iconOnly
              icon={TrashIcon}
              label="Delete note"
              onClick={() => props.deleteNotes(noteDate)}
            />
          </div>
        ),
      }}
    >
      <TextareaInput
        placeholder="Check the image credits"
        value={textAreaValue}
        onChange={(value) => setTextAreaValue(value ?? '')}
        onBlur={() => props.editNotes(noteDate, textAreaValue)}
      />
    </FieldWrapper>
  );
};

export default Note;
