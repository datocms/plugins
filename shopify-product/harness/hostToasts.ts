import { type HostToast, toastTimeout } from './bridge';
import { button, el } from './dom';

/**
 * A stand-in for the dashboard's toasts: `ctx.notice`, `ctx.alert` and
 * `ctx.customToast` land here, plus small `log` toasts for mocked calls that
 * otherwise do nothing visible (navigateTo, openConfirm answers, …). A toast
 * closes when `toastTimeout` says (notice 6s, alert never), on ✕ or on its
 * CTA, and only then settles its promise, as in the dashboard.
 */

export function createToastStrip(): {
  element: HTMLElement;
  show: (toast: HostToast) => Promise<unknown>;
} {
  const strip = el('div', {
    className: 'hx-toasts',
    attributes: { 'aria-live': 'polite' },
  });

  const show = (toast: HostToast) =>
    new Promise<unknown>((resolve) => {
      const node = el('div', {
        className: `hx-toast hx-toast--${toast.type}`,
        attributes: { role: toast.type === 'alert' ? 'alert' : 'status' },
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const close = (value: unknown) => {
        clearTimeout(timer);
        node.remove();
        resolve(value);
      };
      node.append(
        el('p', { className: 'hx-toast__message', text: toast.message }),
      );
      const { cta } = toast;
      if (cta) {
        node.append(button(cta.label, () => close(cta.value), 'hx-toast__cta'));
      }
      const dismiss = button('×', () => close(null), 'hx-toast__close');
      dismiss.setAttribute('aria-label', 'Dismiss');
      node.append(dismiss);
      strip.append(node);

      const timeout = toastTimeout(toast);
      if (timeout !== null) {
        timer = setTimeout(() => close(null), timeout);
      }
    });

  return { element: strip, show };
}
