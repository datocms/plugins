import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { useFileDropTarget, useFilePicker } from 'datocms-react-ui/dnd';
import {
  cloneElement,
  type InputHTMLAttributes,
  type ReactElement,
  useCallback,
  useMemo,
} from 'react';
import type { ExportDoc } from '@/utils/types';

type Options = {
  ctx: RenderPageCtx;
  /** Gets the name of the file and its parsed content */
  onJsonDrop: (filename: string, exportDoc: ExportDoc) => void | Promise<void>;
  /** Stops the page from taking files, for example while the import runs */
  disabled?: boolean;
};

/** The alert of a file that the import can't read: the reason goes to the console */
export const notAnExportMessage =
  'This file is not a schema export. Choose a JSON file exported with this plugin.';

function isJsonFile(file: File) {
  return file.type.includes('json') || file.name.endsWith('.json');
}

/**
 * The two ways to give the page an export file: a drop anywhere on the
 * target, or the dialog of the browser. Both read the first file as text and
 * parse it as JSON before handing it on; every failure is an alert.
 */
export function useJsonFileInput({ ctx, onJsonDrop, disabled }: Options) {
  const readFile = useCallback(
    (file: File) => {
      if (!isJsonFile(file)) {
        ctx.alert(
          'This is not a JSON file. Choose the file that the export downloaded.',
        );
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => {
        ctx.alert('The file could not be read.');
      };
      reader.onload = (event: ProgressEvent<FileReader>) => {
        const result = event.target?.result;
        if (typeof result !== 'string') {
          ctx.alert(notAnExportMessage);
          return;
        }

        let json: ExportDoc;
        try {
          json = JSON.parse(result) as ExportDoc;
        } catch (error) {
          console.error(error);
          ctx.alert(notAnExportMessage);
          return;
        }

        void onJsonDrop(file.name, json);
      };
      reader.readAsText(file);
    },
    [ctx, onJsonDrop],
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      const [file] = files;
      if (file) readFile(file);
    },
    [readFile],
  );

  const { ref, isOver } = useFileDropTarget({
    onDrop: handleFiles,
    multiple: false,
    disabled,
  });
  const { open, input: pickerInput } = useFilePicker({
    onPick: handleFiles,
    multiple: false,
  });

  // The picker has no filter of its own: the dialog of the browser offers
  // only JSON files, and the checks above still run on every file
  const input = useMemo(
    () =>
      cloneElement(
        pickerInput as ReactElement<InputHTMLAttributes<HTMLInputElement>>,
        { accept: '.json,application/json' },
      ),
    [pickerInput],
  );

  return { ref, isOver, open, input };
}
