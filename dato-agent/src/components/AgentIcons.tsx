import type { ReactNode } from 'react';

type IconProps = {
  className?: string;
};

function Icon({
  children,
  className,
}: IconProps & { children: ReactNode }): ReactNode {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <g
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      >
        {children}
      </g>
    </svg>
  );
}

function FilledIcon({
  children,
  className,
  viewBox,
}: IconProps & { children: ReactNode; viewBox: string }): ReactNode {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox={viewBox}
    >
      {children}
    </svg>
  );
}

export function ConnectionIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M9 8V3M15 8V3M18 8v4a6 6 0 0 1-12 0V8h12ZM12 18v3" />
    </Icon>
  );
}

export function CircleCheckIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.4 12.1 2.3 2.3 4.9-5" />
    </Icon>
  );
}

export function HistoryIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M3 5v5h5" />
      <path d="M4.7 8.2A8.5 8.5 0 1 1 3.6 15" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  );
}

export function ChatIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M5 5h14v11H9l-4 3V5Z" />
      <path d="M8.5 9.5h7M8.5 12.5H13" />
    </Icon>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function SendIcon({ className }: IconProps) {
  return (
    <FilledIcon className={className} viewBox="0 0 512 512">
      <path d="M133.9 232 65.8 95.9 383.4 232H133.9Zm0 48H383.4L65.8 416.1l68-136.1ZM44.6 34.6C32.3 29.3 17.9 32.3 8.7 42S-2.6 66.3 3.4 78.3L92.2 256 3.4 433.7c-6 12-3.9 26.5 5.3 36.3s23.5 12.7 35.9 7.5l448-192c11.8-5 19.4-16.6 19.4-29.4s-7.6-24.4-19.4-29.4l-448-192Z" />
    </FilledIcon>
  );
}

export function StopIcon({ className }: IconProps) {
  return (
    <FilledIcon className={className} viewBox="0 0 384 512">
      <path d="M0 128C0 92.7 28.7 64 64 64h256c35.3 0 64 28.7 64 64v256c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V128Z" />
    </FilledIcon>
  );
}

export function DisconnectIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9" />
    </Icon>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="m6.5 12.5 3.2 3.2 7.8-8" />
    </Icon>
  );
}

export function WarningIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M10.4 4.2 2.8 18a2 2 0 0 0 1.8 3h14.8a2 2 0 0 0 1.8-3L13.6 4.2a1.8 1.8 0 0 0-3.2 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </Icon>
  );
}

export function BoltIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M13.4 2 5.5 13h6l-.9 9L18.5 11h-6l.9-9Z" />
    </Icon>
  );
}

export function RetryIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M4 8V4m0 0h4M4.6 7.1A8 8 0 1 1 4 15" />
    </Icon>
  );
}

export function CopyIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect height="11" rx="1.5" width="11" x="8" y="8" />
      <path d="M16 8V6.5A1.5 1.5 0 0 0 14.5 5h-8A1.5 1.5 0 0 0 5 6.5v8A1.5 1.5 0 0 0 6.5 16H8" />
    </Icon>
  );
}
