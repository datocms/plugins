import { Button } from 'datocms-react-ui';
import {
  type ChangeEventHandler,
  type DragEventHandler,
  useCallback,
  useRef,
  useState,
} from 'react';
import s from '../styles.module.css';

type Props = {
  disabled?: boolean;
  onJsonFileSelected: (file: File, parsed: unknown) => void;
  onReadError: (message: string) => void;
};

export default function JsonDropZone({
  disabled,
  onJsonFileSelected,
  onReadError,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.toLowerCase().endsWith('.json')) {
        onReadError('Please select a JSON file.');
        return;
      }

      const reader = new FileReader();

      reader.onerror = () => {
        onReadError('Could not read the selected file.');
      };

      reader.onload = (event) => {
        const raw = event.target?.result;

        if (typeof raw !== 'string') {
          onReadError('Invalid file content.');
          return;
        }

        try {
          const parsed = JSON.parse(raw);
          onJsonFileSelected(file, parsed);
        } catch (_error) {
          onReadError('Invalid JSON format.');
        }
      };

      reader.readAsText(file);
    },
    [onJsonFileSelected, onReadError],
  );

  const handleDrop: DragEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);

      const [file] = event.dataTransfer.files;
      if (!file) {
        return;
      }

      handleFile(file);
    },
    [handleFile],
  );

  const handleDragOver: DragEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  const handleDragEnter: DragEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(true);
    },
    [],
  );

  const handleDragLeave: DragEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);
    },
    [],
  );

  const handleOpenFileDialog = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFileInputChange: ChangeEventHandler<HTMLInputElement> =
    useCallback(
      (event) => {
        const file = event.target.files?.[0];
        if (!file) {
          return;
        }

        handleFile(file);
        event.currentTarget.value = '';
      },
      [handleFile],
    );

  return (
    <div
      className={`${s.dropZone} ${isDragging ? s.dropZonePending : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      <div className={s.dropZoneTitle}>Drop export JSON file here</div>
      <p className={s.dropZoneDescription}>
        Drag and drop the record export JSON from Project Exporter, or select it manually.
      </p>

      <Button buttonSize="l" fullWidth onClick={handleOpenFileDialog} disabled={disabled}>
        Select JSON file
      </Button>
    </div>
  );
}
