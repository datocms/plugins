import type { ConfirmChoice, ConfirmOptions, Toast } from 'datocms-plugin-sdk';
import { STATE_IDS } from '../../findReplace/ui/testing/fixtures';
import {
  getScenario,
  readScenarioName,
  SCENARIO_NAMES,
} from './fakeCma/scenarios';

/**
 * The harness "host" (harness.html): the dashboard's surface around one
 * iframe sized like the real page frame, a toast strip and a confirm dialog
 * standing in for the host's overlays, a "New ctx" button, and plain links to
 * switch the scheme, scenario, width and view. The frame gets the same query
 * string.
 */

const WIDTHS = ['1400', '1024', '768', '580'];
const DEFAULT_TOAST_TIMEOUT_MS = 5000;

const params = new URLSearchParams(window.location.search);

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string } = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  node.append(...children);
  return node;
}

function hrefWith(changes: Record<string, string | null>): string {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  return `?${next.toString()}`;
}

function linkGroup(
  label: string,
  current: string,
  options: ReadonlyArray<{ value: string; label: string; href: string }>,
): HTMLElement {
  const links = options.map((option) => {
    const link = element('a', { className: 'hx-link', text: option.label });
    link.href = option.href;
    if (option.value === current) link.setAttribute('aria-current', 'true');
    return link;
  });
  return element('div', { className: 'hx-group' }, [
    element('span', { className: 'hx-group__label', text: label }),
    ...links,
  ]);
}

// ── Toast strip ─────────────────────────────────────────────────────────────

function toastTimeout(toast: Toast): number | null {
  if (toast.dismissAfterTimeout === true) return DEFAULT_TOAST_TIMEOUT_MS;
  return typeof toast.dismissAfterTimeout === 'number'
    ? toast.dismissAfterTimeout
    : null;
}

function installToastStrip(strip: HTMLElement): void {
  window.__harnessToast = (toast: Toast) =>
    new Promise((resolve) => {
      const node = element('div', {
        className: `hx-toast hx-toast--${toast.type}`,
      });
      node.setAttribute('role', toast.type === 'alert' ? 'alert' : 'status');

      const close = (value: unknown) => {
        node.remove();
        resolve(value);
      };

      node.append(
        element('p', { className: 'hx-toast__message', text: toast.message }),
      );
      if (toast.cta) {
        const { label, value } = toast.cta;
        const cta = element('button', {
          className: 'hx-toast__cta',
          text: label,
        });
        cta.type = 'button';
        cta.addEventListener('click', () => close(value));
        node.append(cta);
      }
      const dismiss = element('button', {
        className: 'hx-toast__close',
        text: '×',
      });
      dismiss.type = 'button';
      dismiss.setAttribute('aria-label', 'Dismiss');
      dismiss.addEventListener('click', () => close(null));
      node.append(dismiss);

      strip.append(node);
      const timeout = toastTimeout(toast);
      if (timeout !== null) setTimeout(() => close(null), timeout);
    });
}

// ── Confirm dialog ──────────────────────────────────────────────────────────

function choiceButton(
  choice: ConfirmChoice,
  close: (value: unknown) => void,
): HTMLButtonElement {
  const intent = choice.intent ? ` hx-confirm__button--${choice.intent}` : '';
  const button = element('button', {
    className: `hx-button hx-confirm__button${intent}`,
    text: choice.label,
  });
  button.type = 'button';
  button.addEventListener('click', () => close(choice.value));
  return button;
}

/** Like the host's confirm: the whole dashboard (and the frame) dims behind it. */
function installConfirm(): void {
  window.__harnessConfirm = (options: ConfirmOptions) =>
    new Promise((resolve) => {
      const previousFocus = document.activeElement;
      const backdrop = element('div', { className: 'hx-backdrop' });
      const close = (value: unknown) => {
        backdrop.remove();
        if (previousFocus instanceof HTMLElement) previousFocus.focus();
        resolve(value);
      };

      const title = element('h2', {
        className: 'hx-confirm__title',
        text: options.title,
      });
      title.id = 'hx-confirm-title';
      const choices = options.choices.map((choice) =>
        choiceButton(choice, close),
      );
      const dialog = element('div', { className: 'hx-confirm' }, [
        title,
        element('p', {
          className: 'hx-confirm__content',
          text: options.content,
        }),
        element('div', { className: 'hx-confirm__actions' }, [
          choiceButton(options.cancel, close),
          ...choices,
        ]),
      ]);
      dialog.setAttribute('role', 'alertdialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', title.id);
      dialog.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') close(options.cancel.value);
      });

      backdrop.append(dialog);
      document.body.append(backdrop);
      (choices[0] ?? dialog).focus();
    });
}

// ── Page ────────────────────────────────────────────────────────────────────

function buildToolbar(frame: HTMLIFrameElement): HTMLElement {
  const scheme = params.get('scheme') === 'dark' ? 'dark' : 'light';
  const scenario = getScenario(readScenarioName(params.get('scenario')));
  const width = params.get('w') ?? '1400';
  const view = params.get('view') === 'states' ? 'states' : 'page';

  const newCtx = element('button', { className: 'hx-button', text: 'New ctx' });
  newCtx.type = 'button';
  newCtx.title =
    'Re-render the page with a fresh ctx object (same values): nothing should reload';
  newCtx.addEventListener('click', () => {
    frame.contentWindow?.__harnessNewCtx?.();
  });

  const groups = [
    linkGroup(
      'Scheme',
      scheme,
      ['light', 'dark'].map((value) => ({
        value,
        label: value,
        href: hrefWith({ scheme: value }),
      })),
    ),
    linkGroup(
      'Width',
      width,
      WIDTHS.map((value) => ({
        value,
        label: value,
        href: hrefWith({ w: value }),
      })),
    ),
    linkGroup('View', view, [
      {
        value: 'page',
        label: 'page',
        href: hrefWith({ view: null, state: null }),
      },
      { value: 'states', label: 'states', href: hrefWith({ view: 'states' }) },
    ]),
    view === 'states'
      ? linkGroup(
          'State',
          params.get('state') ?? 'S2',
          STATE_IDS.map((value) => ({
            value,
            label: value,
            href: hrefWith({ view: 'states', state: value }),
          })),
        )
      : linkGroup(
          'Scenario',
          scenario.name,
          SCENARIO_NAMES.map((value) => ({
            value,
            label: value,
            href: hrefWith({ scenario: value }),
          })),
        ),
  ];

  const description =
    view === 'states'
      ? 'The real UI rendered from snapshot fixtures (no backend).'
      : `${scenario.description} Try ?q=Acme&r=Globex, ?confirm=yes, ?latency=0.`;

  return element('header', { className: 'hx-toolbar' }, [
    element('div', { className: 'hx-toolbar__row' }, [
      element('strong', {
        className: 'hx-title',
        text: 'Find and Replace · harness',
      }),
      ...groups,
      newCtx,
    ]),
    element('p', { className: 'hx-description', text: description }),
  ]);
}

function mount(): void {
  const scheme = params.get('scheme') === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.colorScheme = scheme;
  document.documentElement.style.colorScheme = scheme;

  const frame = element('iframe', { className: 'hx-frame' });
  frame.title = 'Plugin page';
  frame.src = `/frame.html${window.location.search}`;
  frame.width = params.get('w') ?? '1400';
  frame.height = params.get('h') ?? '900';

  const strip = element('div', { className: 'hx-toasts' });
  strip.setAttribute('aria-live', 'polite');
  installToastStrip(strip);
  installConfirm();

  document.body.append(
    buildToolbar(frame),
    element('main', { className: 'hx-stage' }, [frame]),
    strip,
  );
}

mount();
