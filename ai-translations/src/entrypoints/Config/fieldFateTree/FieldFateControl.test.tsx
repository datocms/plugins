import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import FieldFateControl from './FieldFateControl';

describe('FieldFateControl', () => {
  it('checks the segment for the current fate', () => {
    render(<FieldFateControl legend="Title" value="copy" onChange={() => {}} />);
    expect(
      (screen.getByRole('radio', { name: /copy/i }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByRole('radio', { name: /translate/i }) as HTMLInputElement)
        .checked,
    ).toBe(false);
  });

  it('disables the Skip segment when skipDisabled', () => {
    render(
      <FieldFateControl
        legend="Title"
        value="translate"
        skipDisabled
        onChange={() => {}}
      />,
    );
    expect(
      (screen.getByRole('radio', { name: /skip/i }) as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it('emits the new fate on change', () => {
    const onChange = vi.fn();
    render(
      <FieldFateControl legend="Title" value="translate" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /copy/i }));
    expect(onChange).toHaveBeenCalledWith('copy');
  });

  it('leaves every segment unchecked when the value is mixed', () => {
    render(<FieldFateControl legend="Body" value="mixed" onChange={() => {}} />);
    for (const name of [/translate/i, /copy/i, /skip/i]) {
      expect(
        (screen.getByRole('radio', { name }) as HTMLInputElement).checked,
      ).toBe(false);
    }
  });

  it('exposes the field label as the group legend', () => {
    render(<FieldFateControl legend="Author name" value="skip" onChange={() => {}} />);
    expect(screen.getByRole('group', { name: /author name/i })).toBeTruthy();
  });
});
