/**
 * Icons Component Library
 * 
 * Centralized SVG icon components used throughout the plugin UI.
 * Each icon is a React functional component that renders an SVG element.
 * 
 * @module components/Icons
 */

import type { FC } from 'react';

// =============================================================================
// Icon Component Types
// =============================================================================

/** Base props shared by all icon components */
interface IconProps {
  /** Optional CSS class name */
  className?: string;
}

// =============================================================================
// Icon Components
// =============================================================================

/**
 * Block icon - represents a modular block/content block
 */
export const BlockIcon: FC<IconProps> = ({ className }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </svg>
);

/**
 * Database icon - represents records/data storage
 */
export const DatabaseIcon: FC<IconProps> = ({ className }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </svg>
);

/**
 * Field icon - represents a content field
 */
export const FieldIcon: FC<IconProps> = ({ className }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M4 17l6-6" />
    <path d="M4 7l6 6" />
    <path d="M20 7h-6" />
    <path d="M20 17h-6" />
  </svg>
);

/**
 * Check icon - represents success/completion state
 * Larger size (48x48) for prominent success displays
 */
export const CheckIcon: FC<IconProps> = ({ className }) => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

/**
 * Warning icon - represents caution/alert state
 * Uses orange color for visibility
 */
export const WarningIcon: FC<IconProps> = ({ className }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#ff9800"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

/**
 * Code icon - represents API keys or code-related content
 */
export const CodeIcon: FC<IconProps> = ({ className }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

/**
 * Info icon - represents informational tooltips/help
 */
export const InfoIcon: FC<IconProps> = ({ className }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <title>Info</title>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

// =============================================================================
// Icons Object (for backwards compatibility)
// =============================================================================

/**
 * Icons object containing all icon components.
 * Provides a convenient namespace for icon access.
 * 
 * @example
 * import { Icons } from '../components/Icons';
 * <Icons.Block />
 */
export const Icons = {
  Block: BlockIcon,
  Database: DatabaseIcon,
  Field: FieldIcon,
  Check: CheckIcon,
  Warning: WarningIcon,
  Code: CodeIcon,
  Info: InfoIcon,
} as const;
