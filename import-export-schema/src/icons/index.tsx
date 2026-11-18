import {
  Check,
  CircleAlert,
  Diamond,
  FileInput,
  FileOutput,
  FolderOpen,
  Grid2x2,
  type LucideProps,
  Puzzle,
  RefreshCw,
} from 'lucide-react';

// The icons of the plugin, all from Lucide. They are drawn at 1em, the size of
// the text around them (see the LucideProvider in utils/render.tsx), in the
// color of the text: the place that shows them sets their size.

/** A model */
export const ModelIcon = Diamond;

/** A block model: the grid turned into a diamond, scaled to stay in its box */
export function BlockIcon({ style, ...props }: LucideProps) {
  return (
    <Grid2x2
      style={{ transform: 'rotate(45deg) scale(0.8)', ...style }}
      {...props}
    />
  );
}

/** A plugin */
export const PluginIcon = Puzzle;

/** Export as JSON */
export const ExportIcon = FileOutput;

/** Import a file */
export const ImportIcon = FileInput;

/** Choose a file */
export const FolderOpenIcon = FolderOpen;

/** The status of an error */
export const CircleExclamationIcon = CircleAlert;

/** Try again */
export const RefreshIcon = RefreshCw;

/** In the export */
export const CheckIcon = Check;
