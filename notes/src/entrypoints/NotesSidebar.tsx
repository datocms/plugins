import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import SidebarPanel from 'datocms-react-ui/SidebarPanel';
import { type CSSProperties, useEffect, useState } from 'react';
import { PlusIcon } from '../icons';
import Note from './Note';
import styles from './note.module.css';

type PropTypes = {
  ctx: RenderFieldExtensionCtx;
};

export type NoteType = {
  comment: string;
  timestamp: string;
};

const Notes = ({ ctx }: PropTypes) => {
  const initialState = ctx.formValues[ctx.field.attributes.api_key]
    ? (JSON.parse(
        ctx.formValues[ctx.field.attributes.api_key] as string,
      ) as NoteType[])
    : [];

  const [savedNotes, setSavedNotes] = useState<NoteType[]>(initialState);

  const createNoteHandler = () => {
    const noteDate = new Date().toISOString();
    const note = { comment: '', timestamp: noteDate };

    setSavedNotes((oldNotes: NoteType[]) => {
      const newNotes = [...oldNotes];
      newNotes.push(note);
      return newNotes;
    });
  };

  const deleteNoteHandler = (timestamp: string) => {
    setSavedNotes((oldNotes: NoteType[]) => {
      let newNotes = [...oldNotes];
      newNotes = newNotes.filter((note) => note.timestamp !== timestamp);
      return newNotes;
    });
  };

  const editNoteHandler = (timestamp: string, newValue: string) => {
    setSavedNotes((oldNotes: NoteType[]) => {
      return oldNotes.map((note) => {
        if (note.timestamp === timestamp) {
          return { ...note, comment: newValue };
        }
        return note;
      });
    });
  };

  // to avoid unecessary field value updates:
  useEffect(() => {
    const arrayIsEmpty = !savedNotes.length;
    if (arrayIsEmpty) {
      ctx.setFieldValue(ctx.field.attributes.api_key, null);
    } else {
      const formatedNotes = JSON.stringify(savedNotes, null, 2);
      const stateIsEqualToStorage =
        formatedNotes ===
        (ctx.formValues[ctx.field.attributes.api_key] as string);
      if (!stateIsEqualToStorage) {
        ctx.setFieldValue(ctx.field.attributes.api_key, formatedNotes);
      }
    }
  }, [savedNotes, ctx]);

  return (
    <Canvas ctx={ctx}>
      {savedNotes.length === 0 && <SidebarPanel.Blank message="No notes yet" />}
      {savedNotes?.map((note) => {
        return (
          <Note
            key={note.timestamp}
            deleteNotes={deleteNoteHandler}
            editNotes={editNoteHandler}
            value={note.comment}
            date={note.timestamp}
          />
        );
      })}
      <div
        className={styles.action}
        style={
          { '--frame-inset-left': `${ctx.bodyPadding[3]}px` } as CSSProperties
        }
      >
        <SidebarPanel.Action
          icon={PlusIcon}
          label="Add note"
          onClick={createNoteHandler}
        />
      </div>
    </Canvas>
  );
};

export default Notes;
