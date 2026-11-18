import {
  CircleAlert,
  Crosshair,
  Download,
  Network,
  Scan,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

// The plugin's icons, from Lucide. They are drawn at 1em, the size of the
// text around them (see the LucideProvider in utils/render.tsx).
export const CircleAlertIcon = CircleAlert;
export const CrosshairIcon = Crosshair;
/** The schema diagram */
export const DiagramIcon = Network;
export const DownloadIcon = Download;
/** Zooms and centers the diagram so that all of it shows */
export const FitToScreenIcon = Scan;
export const ZoomInIcon = ZoomIn;
export const ZoomOutIcon = ZoomOut;
