import type {
  Field,
  ItemType,
  RenderConfigScreenCtx,
  RenderItemFormSidebarPanelCtx,
  RenderModalCtx,
  RenderPageCtx,
} from 'datocms-plugin-sdk';
import {
  type ChangeEvent,
  type CSSProperties,
  createContext,
  createElement,
  type FormEvent,
  Fragment,
  type MouseEvent,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
  useContext,
  useState,
} from 'react';
import { vi } from 'vitest';

type Option = { label: string; value: string };
type SelectProps = {
  id: string;
  label: string;
  value: Option | readonly Option[] | null;
  onChange: (value: Option | Option[] | null) => void;
  error?: ReactNode;
  selectInputProps: {
    options: Option[];
    isMulti?: boolean;
    isDisabled?: boolean;
    inputId?: string;
    'aria-label'?: string;
  };
};

type ButtonProps = {
  children?: ReactNode;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
  disabled?: boolean;
  onClick?: MouseEventHandler;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  style?: CSSProperties;
};

type LayoutProps = {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
};

/** Media queries the mocked `useMediaQuery` reports as matching. Reset it in `beforeEach`. */
export const mediaState = { queries: {} as Record<string, boolean> };

export function resetMediaState() {
  mediaState.queries = {};
}

const DropdownClose = createContext<() => void>(() => undefined);

function Dropdown({
  renderTrigger,
  children,
}: {
  renderTrigger: (ctx: { open: boolean; onClick: () => void }) => ReactElement;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return createElement(
    DropdownClose.Provider,
    { value: () => setOpen(false) },
    createElement(
      'div',
      null,
      renderTrigger({ open, onClick: () => setOpen((value) => !value) }),
      open ? children : null,
    ),
  );
}

function DropdownOption({
  children,
  onClick,
  active,
  disabled,
  closeMenuOnClick,
}: {
  children?: ReactNode;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  disabled?: boolean;
  closeMenuOnClick?: boolean;
}) {
  const close = useContext(DropdownClose);
  return createElement(
    'button',
    {
      type: 'button',
      role: 'menuitem',
      'aria-current': active ? 'true' : undefined,
      disabled,
      onClick: (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (closeMenuOnClick ?? true) close();
      },
    },
    children,
  );
}

/** Keep UI tests on controlled public field contracts, without react-select portals. */
export const reactUi = {
  Canvas: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children),
  Button: ({
    children,
    type,
    className,
    disabled,
    onClick,
    leftIcon,
    rightIcon,
    style,
  }: ButtonProps) =>
    createElement(
      'button',
      { type: type ?? 'button', disabled, className, style, onClick },
      leftIcon,
      children,
      rightIcon,
    ),
  ButtonLink: ({
    children,
    className,
    onClick,
    leftIcon,
    rightIcon,
    style,
    href,
    target,
  }: Omit<ButtonProps, 'type' | 'disabled'> & {
    href: string;
    target?: string;
  }) =>
    createElement(
      'a',
      { href, target: target ?? '_blank', className, style, onClick },
      leftIcon,
      children,
      rightIcon,
    ),
  Toolbar: ({ children, className, style }: LayoutProps) =>
    createElement('div', { className, style }, children),
  ToolbarStack: ({ children, className, style }: LayoutProps) =>
    createElement('div', { className, style }, children),
  ToolbarTitle: ({ children, className, style }: LayoutProps) =>
    createElement('div', { className, style }, children),
  Spinner: ({ size }: { size?: number }) =>
    createElement('span', { 'data-testid': 'spinner', 'data-size': size }),
  Dropdown,
  DropdownMenu: ({ children }: { children?: ReactNode }) =>
    createElement('div', { role: 'menu' }, children),
  DropdownOption,
  DropdownSeparator: () => createElement('hr'),
  Tooltip: ({ children }: { children?: ReactNode }) =>
    createElement(Fragment, null, children),
  TooltipTrigger: ({ children }: { children?: ReactNode }) =>
    createElement(Fragment, null, children),
  // Stays in the DOM, hidden, so a reason can be asserted without duplicating visible text.
  TooltipContent: ({ children }: { children?: ReactNode }) =>
    createElement('span', { role: 'tooltip', hidden: true }, children),
  VerticalSplit: ({
    children,
    isSecondaryCollapsed,
    onSecondaryToggle,
    mode,
  }: {
    children: [ReactNode, ReactNode];
    isSecondaryCollapsed?: boolean;
    onSecondaryToggle?: (value: boolean) => void;
    mode?: 'overlay' | 'split';
  }) =>
    createElement(
      'div',
      { 'data-mode': mode },
      children[0],
      isSecondaryCollapsed
        ? createElement('button', {
            type: 'button',
            'aria-label': 'Show sidebar',
            onClick: () => onSecondaryToggle?.(false),
          })
        : children[1],
    ),
  SidebarPanel: ({
    title,
    children,
  }: {
    title?: ReactNode;
    children?: ReactNode;
  }) =>
    createElement(
      'section',
      { 'aria-label': typeof title === 'string' ? title : undefined },
      createElement('h3', null, title),
      children,
    ),
  SwitchField: ({
    id,
    name,
    label,
    hint,
    value,
    onChange,
    switchInputProps,
  }: {
    id: string;
    name?: string;
    label: ReactNode;
    hint?: ReactNode;
    value: boolean;
    onChange?: (value: boolean) => void;
    switchInputProps?: { disabled?: boolean };
  }) =>
    createElement(
      Fragment,
      null,
      createElement(
        'label',
        { htmlFor: id },
        label,
        createElement('input', {
          id,
          name,
          type: 'checkbox',
          role: 'switch',
          checked: value,
          disabled: switchInputProps?.disabled,
          onChange: (event: ChangeEvent<HTMLInputElement>) =>
            onChange?.(event.currentTarget.checked),
        }),
      ),
      hint ? createElement('span', null, hint) : null,
    ),
  Form: ({
    onSubmit,
    children,
    className,
  }: {
    onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
    children?: ReactNode;
    className?: string;
  }) =>
    createElement(
      'form',
      {
        className,
        onSubmit: (event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          onSubmit?.(event);
        },
      },
      children,
    ),
  TextInput: ({
    id,
    name,
    type,
    value,
    onChange,
    labelText,
    placeholder,
    disabled,
  }: {
    id?: string;
    name?: string;
    type?: string;
    value?: string;
    onChange?: (value: string, event: ChangeEvent<HTMLInputElement>) => void;
    labelText?: string;
    placeholder?: string;
    disabled?: boolean;
  }) =>
    createElement('input', {
      id,
      name,
      type,
      value,
      placeholder,
      disabled,
      'aria-label': labelText,
      onChange: (event: ChangeEvent<HTMLInputElement>) =>
        onChange?.(event.currentTarget.value, event),
    }),
  CaretDownIcon: () => null,
  CaretUpIcon: () => null,
  ChevronsRightIcon: () => null,
  useMediaQuery: (query: string) => ({
    matches: mediaState.queries[query] ?? false,
    media: query,
  }),
  // Like the kit, the label points at react-select's container `id`, which can't be
  // labelled: the control takes `inputId` and is named only by its `aria-label`.
  // The error follows it like FieldError.
  SelectField: ({
    id,
    label,
    value,
    onChange,
    error,
    selectInputProps,
  }: SelectProps) => {
    const options = selectInputProps.options;
    const multi = selectInputProps.isMulti;
    const selected = Array.isArray(value)
      ? value.map((option: Option) => option.value)
      : ((value as Option | null)?.value ?? '');
    const field = createElement(
      Fragment,
      null,
      createElement('label', { htmlFor: id }, label),
      createElement(
        'div',
        { id },
        createElement(
          'select',
          {
            id: selectInputProps.inputId,
            'aria-label': selectInputProps['aria-label'],
            multiple: multi,
            disabled: selectInputProps.isDisabled,
            value: selected,
            onChange: (event: ChangeEvent<HTMLSelectElement>) => {
              const values = Array.from(
                event.currentTarget.selectedOptions,
              ).map((option) => option.value);
              onChange(
                multi
                  ? options.filter((option) => values.includes(option.value))
                  : (options.find(
                      (option) => option.value === event.currentTarget.value,
                    ) ?? null),
              );
            },
          },
          options.map((option) =>
            createElement(
              'option',
              { key: option.value, value: option.value },
              option.label,
            ),
          ),
        ),
      ),
    );
    return createElement(
      Fragment,
      null,
      field,
      error ? createElement('span', null, error) : null,
    );
  },
  TextField: ({
    id,
    label,
    value,
    onChange,
  }: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
  }) =>
    createElement(
      'label',
      { htmlFor: id },
      label,
      createElement('input', {
        id,
        value,
        onChange: (event: ChangeEvent<HTMLInputElement>) =>
          onChange(event.currentTarget.value),
      }),
    ),
};

export function sdkModel(id = 'page', name = 'Page'): ItemType {
  return {
    id,
    type: 'item_type',
    attributes: { name, modular_block: false },
    relationships: {
      presentation_title_field: { data: { id: 'title', type: 'field' } },
      workflow: { data: null },
    },
  } as unknown as ItemType;
}

export function sdkField(apiKey: string, localized = false): Field {
  return {
    id: apiKey,
    type: 'field',
    attributes: {
      api_key: apiKey,
      label: apiKey === 'url' ? 'Website' : 'Title',
      field_type: 'string',
      localized,
      validators: {},
      appearance: { editor: 'single_line', parameters: {} },
    },
  } as unknown as Field;
}

export function rawRecord(
  id = 'record-1',
  url: unknown = {
    en: 'https://broken.example/page',
    it: 'https://italian.example/page',
  },
) {
  return {
    id,
    type: 'item',
    attributes: { title: 'Example page', url },
    relationships: { item_type: { data: { type: 'item_type', id: 'page' } } },
  };
}

export function pageContext(
  overrides: Partial<RenderPageCtx> = {},
): RenderPageCtx {
  return {
    site: { id: 'site-1', attributes: { locales: ['en', 'it'] } },
    environment: 'main',
    isEnvironmentPrimary: true,
    currentUser: { id: 'user-1' },
    currentRole: {
      id: 'reader',
      attributes: {
        positive_item_type_permissions: [
          { action: 'read', environment: 'main', item_type: null },
        ],
        negative_item_type_permissions: [],
      },
      meta: { final_permissions: { can_edit_schema: false } },
    },
    currentUserAccessToken: 'test-user-token',
    cmaBaseUrl: 'https://cma.example',
    ui: { locale: 'en' },
    plugin: {
      id: 'plugin-1',
      type: 'plugin',
      attributes: {
        permissions: ['currentUserAccessToken'],
        parameters: {},
      },
    },
    itemTypes: { page: sdkModel(), news: sdkModel('news', 'News') },
    loadItemTypeFields: vi
      .fn()
      .mockResolvedValue([sdkField('title'), sdkField('url', true)]),
    editItem: vi.fn().mockResolvedValue(null),
    navigateTo: vi.fn(),
    openModal: vi.fn().mockResolvedValue(undefined),
    alert: vi.fn(),
    notice: vi.fn(),
    ...overrides,
  } as unknown as RenderPageCtx;
}

export function panelContext(
  overrides: Partial<RenderItemFormSidebarPanelCtx> = {},
): RenderItemFormSidebarPanelCtx {
  return {
    ...pageContext(),
    itemType: sdkModel(),
    item: null,
    locale: 'en',
    itemStatus: 'new',
    isSubmitting: false,
    isFormDirty: true,
    formValues: {
      title: 'New page',
      url: {
        en: 'https://broken.example/page',
        it: 'https://italian.example/page',
      },
      internalLocales: ['en', 'it'],
    },
    formValuesToItem: vi.fn().mockResolvedValue(rawRecord()),
    scrollToField: vi.fn().mockResolvedValue(undefined),
    saveCurrentItem: vi.fn().mockResolvedValue(undefined),
    setFieldValue: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as RenderItemFormSidebarPanelCtx;
}

export function modalContext(
  parameters: Record<string, unknown> = {},
  overrides: Partial<Record<keyof RenderModalCtx, unknown>> = {},
): RenderModalCtx {
  return {
    ...pageContext(),
    modalId: 'scan-scope',
    parameters,
    resolve: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as RenderModalCtx;
}

export function configContext(
  overrides: Partial<Record<keyof RenderConfigScreenCtx, unknown>> = {},
): RenderConfigScreenCtx {
  return {
    ...pageContext(),
    ...overrides,
  } as unknown as RenderConfigScreenCtx;
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
