import type { SchemaTypes } from '@datocms/cma-client';
import ApiKey from 'datocms-react-ui/ApiKey';
import CardList from 'datocms-react-ui/CardList';
import EntityRow from 'datocms-react-ui/EntityRow';
import {
  type FunctionComponent,
  type ReactNode,
  type SVGProps,
  useContext,
  useEffect,
  useRef,
} from 'react';
import { BlockIcon, ModelIcon, PluginIcon } from '@/icons';
import { SelectedEntityContext } from './SelectedEntityContext';

export type OverviewEntity = SchemaTypes.ItemType | SchemaTypes.Plugin;

export type OverviewKind = 'model' | 'block' | 'plugin';

export const overviewKindIcons: Record<
  OverviewKind,
  FunctionComponent<SVGProps<SVGSVGElement>>
> = {
  model: ModelIcon,
  block: BlockIcon,
  plugin: PluginIcon,
};

type Props = {
  entity: OverviewEntity;
  /**
   * The name and the API key that the row shows in place of those of the
   * entity, for example the new ones of a rename
   */
  name?: string;
  apiKey?: string;
  /** The state of the entity at the end of the row, for example a Pill */
  status?: ReactNode;
  /** The body of the open item. It mounts only while the item is open. */
  children: ReactNode;
};

/**
 * An expandable item of an overview group. The open item is the entity
 * focused in SelectedEntityContext: opening it focuses the entity (and zooms
 * the graph on it), opening it again releases the focus.
 */
export function OverviewItem({
  entity,
  name,
  apiKey,
  status,
  children,
}: Props) {
  const selection = useContext(SelectedEntityContext);
  const open = selection.entity === entity;

  const itemRef = useRef<HTMLLIElement>(null);
  const openedHere = useRef(false);

  // When the item opens from elsewhere (a click on its node), bring it into
  // view inside the scroll area of the pane.
  useEffect(() => {
    if (!open) {
      openedHere.current = false;
      return;
    }
    if (openedHere.current) {
      openedHere.current = false;
      return;
    }
    if (itemRef.current) {
      scrollIntoScrollParent(itemRef.current);
    }
  }, [open]);

  function handleToggle() {
    if (open) {
      selection.set(undefined, true);
    } else {
      openedHere.current = true;
      selection.set(entity, true);
    }
  }

  // No kind icon: the header of the group shows it
  return (
    <CardList.Item
      ref={itemRef}
      row={{
        summary: (
          <EntityRow layout="row" title={name || entity.attributes.name}>
            {entityDetails(entity, apiKey)}
          </EntityRow>
        ),
        trailing: status,
      }}
      expandable={{
        open,
        onToggle: handleToggle,
        body: open ? children : null,
      }}
    />
  );
}

/** The line under the name: the API key, or the version of a plugin */
function entityDetails(entity: OverviewEntity, apiKey?: string): ReactNode {
  if (entity.type === 'plugin') {
    const version = entity.attributes.package_version;
    return version ? `v${version}` : null;
  }

  return <ApiKey>{apiKey || entity.attributes.api_key}</ApiKey>;
}

/**
 * Scrolls the nearest scrollable ancestor (the content of the pane) so the
 * element shows, centered when it fits. It never calls scrollIntoView, which
 * would also scroll the CMS page around the frame.
 */
function scrollIntoScrollParent(element: HTMLElement) {
  const container = findScrollParent(element);
  if (!container) return;

  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const freeSpace = Math.max(0, container.clientHeight - elementRect.height);
  const top =
    container.scrollTop + (elementRect.top - containerRect.top) - freeSpace / 2;

  const reducedMotion = window.matchMedia?.(
    '(prefers-reduced-motion: reduce)',
  ).matches;

  container.scrollTo({
    top: Math.max(0, top),
    behavior: reducedMotion ? 'auto' : 'smooth',
  });
}

/**
 * Overflows that never scroll. Any other value scrolls: 'auto', 'scroll',
 * and 'overlay', which the content of a Pane declares and which some
 * engines report as it is instead of as 'auto'.
 */
const NON_SCROLLING_OVERFLOWS = new Set(['visible', 'hidden', 'clip']);

function findScrollParent(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node && node !== document.body) {
    const { overflowY } = window.getComputedStyle(node);
    if (
      !NON_SCROLLING_OVERFLOWS.has(overflowY) &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}
