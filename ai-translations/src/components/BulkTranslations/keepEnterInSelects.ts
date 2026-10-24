/**
 * keepEnterInSelects.ts
 * ---------------------
 * The bulk page and the records picker are forms made of selects, whose
 * submit starts a run, and the config screen is a form whose submit saves the
 * plugin settings. A select picks its focused option with Enter while its
 * menu is open, and then prevents the default of the key itself. With the
 * menu closed it lets Enter through, and the browser would submit the form:
 * a keyboard user who presses Enter to open a select would start finding the
 * records, close the picker, or save the settings. A native select never
 * submits its form on Enter, so these selects don't either: only the submit
 * button (or Enter in a text field) does.
 */
import type { KeyboardEvent } from 'react';

/**
 * `onKeyDown` of a form: stops Enter in a select (a combobox) from submitting
 * the form. It runs after the select handled the key, so the Enter that picks
 * an option is untouched.
 *
 * @param event - The keydown event, bubbled up to the form.
 */
export function keepEnterInSelects(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key !== 'Enter' || event.defaultPrevented) return;
  const { target } = event;
  if (
    target instanceof HTMLElement &&
    target.getAttribute('role') === 'combobox'
  ) {
    event.preventDefault();
  }
}
