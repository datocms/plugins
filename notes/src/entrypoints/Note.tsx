import React, { useState } from "react";
import styles from "./note.module.css";
import Textarea from "react-textarea-autosize";
import ReactTimeAgo from "react-time-ago";

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
    <div
      className={styles["notes__item"]}
      onBlur={props.editNotes.bind(null, noteDate, textAreaValue)}
    >
      <Textarea
        onChange={(event) => setTextAreaValue(event.target.value)}
        value={textAreaValue}
      />
      <div
        className={`${styles["note__footer"]} ${styles["notes__item__timestamp"]}`}
      >
        <ReactTimeAgo date={new Date(noteDate)} />
        <div className={styles["note__buttons"]}>
          <button
            className={styles["note__button"]}
            onClick={props.deleteNotes.bind(null, noteDate)}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

export default Note;
