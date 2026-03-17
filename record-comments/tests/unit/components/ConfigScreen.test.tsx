// @vitest-environment jsdom
import { StrictMode, type ReactNode } from 'react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import ConfigScreen from '@/entrypoints/ConfigScreen';
import { buildPluginParams } from '@utils/pluginParams';
import { flushPromises, render } from '../testUtils/react';

vi.mock('datocms-react-ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void | Promise<void>;
  }) => (
    <button
      disabled={disabled}
      onClick={() => {
        void onClick?.();
      }}
      type="button"
    >
      {children}
    </button>
  ),
  Canvas: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Section: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  Spinner: () => <span>Loading</span>,
  SwitchField: ({
    disabled,
    label,
    onChange,
    value,
  }: {
    disabled?: boolean;
    label: string;
    onChange: (value: boolean) => void;
    value: boolean;
  }) => (
    <label>
      <span>{label}</span>
      <input
        aria-label={label}
        checked={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
    </label>
  ),
  TextField: ({
    disabled,
    label,
    onChange,
    value,
  }: {
    disabled?: boolean;
    label: string;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <label>
      <span>{label}</span>
      <input
        aria-label={label}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        type="text"
        value={value}
      />
    </label>
  ),
}));

function createCtx(overrides: Record<string, unknown> = {}) {
  return {
    alert: vi.fn().mockResolvedValue(undefined),
    currentRole: {
      meta: {
        final_permissions: {
          can_edit_schema: true,
        },
      },
    },
    currentUserAccessToken: 'token',
    itemTypes: {},
    loadItemTypeFields: vi.fn().mockResolvedValue([]),
    notice: vi.fn().mockResolvedValue(undefined),
    plugin: {
      attributes: {
        parameters: {},
      },
    },
    updatePluginParameters: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as never;
}

function setTextInputValue(input: HTMLInputElement, value: string) {
  act(() => {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    );
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function click(button: HTMLButtonElement) {
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('ConfigScreen', () => {
  it('clears the saving state after save completes in StrictMode', async () => {
    let resolveSave: (() => void) | undefined;
    const updatePluginParameters = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        })
    );
    const notice = vi.fn().mockResolvedValue(undefined);
    const ctx = createCtx({ notice, updatePluginParameters });

    const view = render(
      <StrictMode>
        <ConfigScreen ctx={ctx} />
      </StrictMode>
    );

    const tokenInput = view.container.querySelector(
      'input[aria-label="Content Delivery API Token"]'
    ) as HTMLInputElement | null;

    expect(tokenInput).not.toBeNull();
    setTextInputValue(tokenInput as HTMLInputElement, '  demo-token  ');

    const saveButton = Array.from(view.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save Settings'
    ) as HTMLButtonElement | undefined;

    expect(saveButton).toBeDefined();
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);

    click(saveButton as HTMLButtonElement);

    expect(updatePluginParameters).toHaveBeenCalledWith(
      buildPluginParams({
        cdaToken: 'demo-token',
        debugLoggingEnabled: false,
        migrationCompleted: false,
        realTimeUpdatesEnabled: true,
      })
    );
    expect((saveButton as HTMLButtonElement).textContent).toBe('Saving...');

    resolveSave?.();
    await flushPromises();

    expect((saveButton as HTMLButtonElement).textContent).toBe('Save Settings');
    expect(notice).toHaveBeenCalledWith('Settings saved successfully!');

    view.unmount();
  });
});
