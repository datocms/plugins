import { Page } from 'datocms-react-ui/Page';
import TableList, { type TableListColumn } from 'datocms-react-ui/TableList';
import { useId } from 'react';
import type { RawViewport } from '../../types';
import { IconCell } from './IconPickerInput/IconCell';
import type { SettingsForm } from './useSettingsForm';

const COLUMNS: TableListColumn<RawViewport>[] = [
  { id: 'name', field: 'name', label: 'Name', grow: 3 },
  {
    id: 'icon',
    field: 'icon',
    label: 'Icon',
    grow: 3,
    render: (cell) => <IconCell cell={cell} />,
  },
  { id: 'width', field: 'width', label: 'Width', grow: 2 },
  { id: 'height', field: 'height', label: 'Height', grow: 2 },
];

const newViewport = (): RawViewport => ({
  name: '',
  icon: '',
  width: '',
  height: '',
});

type Props = {
  form: SettingsForm;
};

/** The viewport presets of the preview, closed at first */
export function ViewportsSection({ form }: Props) {
  const titleId = useId();
  // A section that shows an error can't close until the error is fixed
  const locked = form.submitAttempted && form.viewportsInvalid;
  const open = form.viewportsOpen || locked;

  return (
    <Page.Section>
      <Page.SectionTitle
        id={titleId}
        collapse={{
          open,
          onToggle: locked
            ? undefined
            : () => form.setViewportsOpen((current) => !current),
        }}
      >
        Viewports
      </Page.SectionTitle>
      {open && (
        <>
          <Page.SectionDescription>
            The sizes that editors can pick for the preview. They can always fit
            it to the space or type a custom size.
          </Page.SectionDescription>
          <TableList<RawViewport>
            aria-labelledby={titleId}
            value={form.draft.defaultViewports ?? []}
            onChange={form.updateViewports}
            errors={form.errors.viewports}
            touched={form.submitAttempted || form.touchedViewports}
            onCellBlur={form.touchViewportCell}
            columns={COLUMNS}
            emptyMessage="No viewports: editors can still fit the preview or type a size."
            add={{ label: 'Add viewport', newItem: newViewport }}
          />
        </>
      )}
    </Page.Section>
  );
}
