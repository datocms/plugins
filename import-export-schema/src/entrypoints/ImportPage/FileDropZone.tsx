import { faFolderOpen } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button, useCtx } from 'datocms-react-ui';
import type React from 'react';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import type { ExportDoc } from '@/utils/types';

type Props = {
  onJsonDrop: (filename: string, exportDoc: ExportDoc) => void;
  children: (button: ReactNode) => ReactNode;
};

export default function FileDropZone({ onJsonDrop, children }: Props) {
  const ctx = useCtx<RenderPageCtx>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Track nested dragenter/leaves so moving over children does not cancel pending state
  const dragDepthRef = useRef(0);

  const [pendingDrop, setPendingDrop] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // Increment depth on every dragenter (including children)
    dragDepthRef.current += 1;
    // Only show pending if a file is being dragged
    const hasFiles = Array.from(e.dataTransfer?.types ?? []).includes('Files');
    if (hasFiles) {
      setPendingDrop(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // Decrement depth; only clear pending when leaving root entirely
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setPendingDrop(false);
    }
  }, []);

  const handleFileSelection = useCallback(
    (file: File) => {
      if (!file.type.includes('json') && !file.name.endsWith('.json')) {
        ctx.alert('Please select a JSON file');
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
        } catch (_err) {
          ctx.alert('Invalid JSON format');
        }
      };
      reader.readAsText(file);
    },
    [onJsonDrop, ctx],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();

      // Reset depth and pending state on drop
      dragDepthRef.current = 0;
      setPendingDrop(false);

      const file = e.dataTransfer.files[0];
      if (!file) {
        return;
      }

      handleFileSelection(file);
    },
    [handleFileSelection],
  );

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFileSelection(file);
      }
    },
    [handleFileSelection],
  );

  return (
    <section
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      className={`dropzone ${pendingDrop ? 'dropzone--pending' : ''}`}
      aria-label="File drop area"
    >
      {children(
        <>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileInputChange}
            accept=".json"
            style={{ display: 'none' }}
          />
          <Button
            buttonSize="l"
            fullWidth
            onClick={handleUploadClick}
            leftIcon={<FontAwesomeIcon icon={faFolderOpen} />}
          >
            Select a JSON export file...
          </Button>
        </>,
      )}
    </section>
  );
}
