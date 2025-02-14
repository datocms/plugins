import type { ExportDoc } from '@/utils/types';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { useCtx } from 'datocms-react-ui';
import type React from 'react';
import { type ReactNode, useCallback, useState } from 'react';

type Props = {
  onJsonDrop: (filename: string, exportDoc: ExportDoc) => void;
  children: ReactNode;
};

export default function FileDropZone({ onJsonDrop, children }: Props) {
  const ctx = useCtx<RenderPageCtx>();

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
        ctx.alert('Error reading file');
      };
      reader.onload = (event: ProgressEvent<FileReader>) => {
        try {
          const result = event.target?.result;
          if (typeof result !== 'string') {
            ctx.alert('Invalid file content');
            return;
          }

          const json = JSON.parse(result) as ExportDoc;
          onJsonDrop(file.name, json);
        } catch (err) {
          ctx.alert('Invalid JSON format');
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
