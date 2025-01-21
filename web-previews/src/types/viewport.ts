import {
  faMobileScreen,
  faTablet,
  faDesktop,
  faPencil,
  faArrowLeft,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';

export interface Viewport {
  name: string;
  width: number;
  height: number;
  icon: IconDefinition;
  isCustom?: boolean;
  isFitToSidebar?: boolean;
}

export const DEFAULT_VIEWPORTS: readonly Viewport[] = [
  { name: 'Fit to Sidebar', width: 0, height: 0, icon: faArrowLeft, isFitToSidebar: true },
  { name: 'Mobile', width: 375, height: 667, icon: faMobileScreen },
  { name: 'Tablet', width: 768, height: 1024, icon: faTablet },
  { name: 'Desktop', width: 1280, height: 800, icon: faDesktop },
  { name: 'Custom', width: 1024, height: 768, icon: faPencil, isCustom: true },
] as const;

export const MIN_VIEWPORT_DIMENSION = 200;
export const MAX_VIEWPORT_DIMENSION = 3840; 