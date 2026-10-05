import { Dropdown, DropdownMenu } from 'datocms-react-ui';
import { type ReactNode, useId } from 'react';
import {
  MENU_ACTION_ATTRIBUTE,
  type MenuSelection,
  type MenuTriggerProps,
  menuIds,
  useMenuKeyboard,
} from './useMenuKeyboard';

export type { MenuSelection, MenuTriggerProps };

type TriggerState = { open: boolean; triggerProps: MenuTriggerProps };

type Props = {
  /** Spread `triggerProps` on the trigger `<button>`, and add its name. */
  renderTrigger: (state: TriggerState) => ReactNode;
  alignment?: 'left' | 'right';
  /** How the options read to assistive tech (see `MenuSelection`). */
  selection?: MenuSelection;
  /** `DropdownOption`s, `DropdownGroup`s, `DropdownSeparator`s, … */
  children: ReactNode;
};

/** Hosts the hook inside the kit's `renderTrigger`, where it can see `open`. */
function MenuTrigger({
  open,
  toggle,
  menuId,
  selection,
  renderTrigger,
}: {
  open: boolean;
  toggle: () => void;
  menuId: string;
  selection: MenuSelection;
  renderTrigger: Props['renderTrigger'];
}) {
  const triggerProps = useMenuKeyboard({ open, toggle, menuId, selection });
  return <>{renderTrigger({ open, triggerProps })}</>;
}

/**
 * The kit `Dropdown` + `DropdownMenu` with keyboard support and menu
 * semantics (see ui/useMenuKeyboard.ts). Use it for every dropdown menu, so
 * all triggers behave and announce the same way.
 */
export function Menu({
  renderTrigger,
  alignment = 'left',
  selection = 'none',
  children,
}: Props) {
  const menuId = useId();
  return (
    <Dropdown
      renderTrigger={({ open, onClick }) => (
        <MenuTrigger
          open={open}
          toggle={onClick}
          menuId={menuId}
          selection={selection}
          renderTrigger={renderTrigger}
        />
      )}
    >
      <DropdownMenu alignment={alignment}>
        {/* Finds the portaled menu; never shown. */}
        <span id={menuIds(menuId).anchor} hidden />
        {children}
      </DropdownMenu>
    </Dropdown>
  );
}

/**
 * Put inside a `DropdownOption` of a selection menu whose option is a plain
 * action ("Any tag", "Load more"), so it reads as a menu item, not a choice.
 */
export function MenuAction() {
  return <span {...{ [MENU_ACTION_ATTRIBUTE]: '' }} hidden />;
}
