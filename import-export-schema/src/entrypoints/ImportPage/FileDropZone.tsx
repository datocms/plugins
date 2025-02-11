import type React from 'react';
import { type ReactNode, useCallback, useState } from 'react';
import type { ExportDoc } from '../ExportModal/buildExportDoc';

type Props = {
  onJsonDrop: (exportDoc: ExportDoc) => void;
  children: ReactNode;
};

export default function FileDropZone({ onJsonDrop, children }: Props) {
  const [pendingDrop, setPendingDrop] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setPendingDrop(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setPendingDrop(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      setPendingDrop(false);

      const file = e.dataTransfer.files[0];
      if (!file) {
        return;
      }

      if (!file.type.includes('json') && !file.name.endsWith('.json')) {
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => {
        console.error('Error reading file');
      };
      reader.onload = (event: ProgressEvent<FileReader>) => {
        try {
          const result = event.target?.result;
          if (typeof result !== 'string') {
            console.error('Invalid file content');
            return;
          }

          const json = JSON.parse(result) as ExportDoc;
          onJsonDrop(json);
        } catch (err) {
          console.error('Invalid JSON format');
        }
      };
      reader.readAsText(file);
    },
    [onJsonDrop],
  );

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      className={`dropzone ${pendingDrop ? 'dropzone--pending' : ''}`}
    >
      {children}
    </div>
  );
}
