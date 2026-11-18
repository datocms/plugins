import Pane from 'datocms-react-ui/Pane';
import Toolbar from 'datocms-react-ui/Toolbar';
import type { ComponentProps, ReactNode } from 'react';

type Props = {
  /** The count of the list, after the title */
  subtitle?: string;
  /** The filter of the list: the header shows its button and its row */
  filter?: ComponentProps<typeof Pane.Header>['filter'];
  footer?: ReactNode;
  /** The selection bar, at the bottom of the page */
  slideUpToolbar?: ReactNode;
  children: ReactNode;
};

/**
 * The pane of the page: the title bar of the unused assets, whatever the
 * page shows under it (the scan, the list, the deletion)
 */
export default function PagePane({
  subtitle,
  filter,
  footer,
  slideUpToolbar,
  children,
}: Props) {
  return (
    <Pane
      ariaLabel="Unused assets"
      header={
        <Pane.Header filter={filter}>
          <Pane.Header.Title
            level={1}
            help={
              <Toolbar.Help>
                Lists the assets that no record of this environment uses. Review
                them, then delete the ones you don't need.
              </Toolbar.Help>
            }
          >
            Unused assets
          </Pane.Header.Title>
          {subtitle && <Pane.Header.Subtitle>{subtitle}</Pane.Header.Subtitle>}
        </Pane.Header>
      }
      footer={footer}
      slideUpToolbar={slideUpToolbar}
    >
      {children}
    </Pane>
  );
}
