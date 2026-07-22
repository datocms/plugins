import '@testing-library/jest-dom';
import React from 'react';
import { vi } from 'vitest';

// Mock datocms-react-ui primitives to simple pass-through components (no JSX here).
// datocms-react-ui-specific props (buttonType, selectInputProps, …) are stripped
// before forwarding so they don't leak onto native DOM nodes and trigger React's
// "unknown prop" / non-scalar-value warnings during tests.
vi.mock('datocms-react-ui', () => {
  return {
    Canvas: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'canvas' }, children),
    Button: ({
      children,
      onClick,
      buttonType: _buttonType,
      buttonSize: _buttonSize,
      fullWidth: _fullWidth,
      leftIcon: _leftIcon,
      rightIcon: _rightIcon,
      ...rest
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      children?: React.ReactNode;
      buttonType?: string;
      buttonSize?: string;
      fullWidth?: boolean;
      leftIcon?: React.ReactNode;
      rightIcon?: React.ReactNode;
    }) => React.createElement('button', { onClick, ...rest }, children),
    SelectField: ({
      children,
      // `value`/`onChange` are dropped because the real SelectField receives an
      // option object, not a scalar — forwarding it to a native <select> warns.
      value: _value,
      onChange: _onChange,
      selectInputProps: _selectInputProps,
      fullWidth: _fullWidth,
      formLabelProps: _formLabelProps,
      ...rest
    }: React.SelectHTMLAttributes<HTMLSelectElement> & {
      children?: React.ReactNode;
      selectInputProps?: unknown;
      fullWidth?: boolean;
      formLabelProps?: unknown;
    }) => React.createElement('select', { ...rest }, children),
    Spinner: () => React.createElement('div', { 'data-testid': 'spinner' }),
    CaretDownIcon: () =>
      React.createElement('span', { 'data-testid': 'caret-down' }),
    CaretUpIcon: () =>
      React.createElement('span', { 'data-testid': 'caret-up' }),
    // Dropdown renders its trigger + menu inline (menu always "open" in tests) so
    // option clicks are directly assertable.
    Dropdown: ({
      renderTrigger,
      children,
    }: {
      renderTrigger: (ctx: { open: boolean; onClick: () => void }) => React.ReactNode;
      children?: React.ReactNode;
    }) =>
      React.createElement(
        'div',
        {},
        renderTrigger({ open: false, onClick: () => {} }),
        children,
      ),
    DropdownMenu: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { role: 'menu' }, children),
    DropdownOption: ({
      children,
      onClick,
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
    }) => React.createElement('button', { type: 'button', onClick }, children),
    SwitchField: ({
      label,
      value,
      onChange,
      id,
      name,
    }: {
      label?: React.ReactNode;
      value?: boolean;
      onChange?: (value: boolean) => void;
      id?: string;
      name?: string;
    }) =>
      React.createElement(
        'label',
        {},
        React.createElement('input', {
          type: 'checkbox',
          id,
          name,
          checked: !!value,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
            onChange?.(event.target.checked),
        }),
        label,
      ),
    Section: ({
      title,
      children,
      collapsible,
    }: {
      title?: React.ReactNode;
      children?: React.ReactNode;
      collapsible?: { isOpen: boolean; onToggle: () => void };
    }) =>
      React.createElement(
        'div',
        { 'data-testid': 'section' },
        React.createElement(
          'div',
          { onClick: collapsible ? collapsible.onToggle : undefined },
          title,
        ),
        children,
      ),
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
