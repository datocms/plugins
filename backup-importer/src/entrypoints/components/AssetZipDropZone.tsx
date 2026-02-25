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
  onFilesSelected: (files: File[]) => void;
  onReadError: (message: string) => void;
};

function getZipFiles(list: FileList | null): File[] {
  if (!list) {
    return [];
  }

  return Array.from(list).filter((file) =>
    file.name.toLowerCase().endsWith('.zip'),
  );
}

export default function AssetZipDropZone({
  disabled,
  onFilesSelected,
  onReadError,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = useCallback(
    (files: File[]) => {
      if (!files.length) {
        onReadError('Please select one or more ZIP files.');
        return;
      }

      onFilesSelected(files);
    },
    [onFilesSelected, onReadError],
  );

  const handleDrop: DragEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);

      const files = getZipFiles(event.dataTransfer.files);
      handleFiles(files);
    },
    [handleFiles],
  );

  const handleDragOver: DragEventHandler<HTMLDivElement> = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleDragEnter: DragEventHandler<HTMLDivElement> = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave: DragEventHandler<HTMLDivElement> = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleOpenDialog = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFileInputChange: ChangeEventHandler<HTMLInputElement> =
    useCallback(
      (event) => {
        const files = getZipFiles(event.target.files);
        handleFiles(files);
        event.currentTarget.value = '';
      },
      [handleFiles],
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
        accept=".zip,application/zip"
        multiple
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      <div className={s.dropZoneTitle}>Optional: drop asset ZIP files here</div>
      <p className={s.dropZoneDescription}>
        Add the asset ZIP chunks exported by Project Exporter to resolve file/gallery references.
      </p>

      <Button buttonSize="m" fullWidth onClick={handleOpenDialog} disabled={disabled}>
        Select ZIP files
      </Button>
    </div>
  );
}
