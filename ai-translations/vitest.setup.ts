import '@testing-library/jest-dom';
import React from 'react';
import { vi } from 'vitest';

// Mock datocms-react-ui primitives to simple pass-through components (no JSX here)
vi.mock('datocms-react-ui', () => {
  return {
    Canvas: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'canvas' }, children),
    Button: ({
      children,
      onClick,
      ...rest
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      children?: React.ReactNode;
    }) => React.createElement('button', { onClick, ...rest }, children),
    SelectField: ({
      children,
      ...rest
    }: React.HTMLAttributes<HTMLSelectElement> & {
      children?: React.ReactNode;
    }) => React.createElement('select', { ...rest }, children),
    Spinner: () => React.createElement('div', { 'data-testid': 'spinner' }),
  };
});

// Basic mock for datocms-plugin-sdk types used by components (only what tests need)
vi.mock('datocms-plugin-sdk', async (orig) => {
  type OrigFactory = {
    importActual?: (id: string) => Promise<unknown>;
  };
  const actual = await (orig as OrigFactory).importActual?.(
    'datocms-plugin-sdk',
  );
  return {
    ...actual,
  };
});
