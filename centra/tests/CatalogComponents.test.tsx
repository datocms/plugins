import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CatalogItemRow from '../src/components/CatalogItemRow';
import CatalogProductCard from '../src/components/CatalogProductCard';
import SelectedReferenceRow from '../src/components/SelectedReferenceRow';

vi.mock('datocms-react-ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

afterEach(cleanup);

describe('catalog picker components', () => {
  it('shows product fallbacks and exposes SKU actions as disclosures', () => {
    const onAction = vi.fn();

    render(
      <CatalogProductCard
        title="Product 54321"
        identity="Product 54321 · DisplayItem 2752"
        available
        hasStock={false}
        actionLabel="Choose SKU"
        actionExpanded={false}
        actionControls="sku-items"
        onAction={onAction}
      >
        <span>SKU items</span>
      </CatalogProductCard>,
    );

    expect(screen.getByText('Product 54321')).toBeInTheDocument();
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
    const action = screen.getByRole('button', { name: 'Choose SKU' });
    expect(action).toHaveAttribute('aria-expanded', 'false');
    expect(action).toHaveAttribute('aria-controls', 'sku-items');
    expect(action).not.toHaveAttribute('aria-pressed');
    expect(document.getElementById('sku-items')).toHaveAttribute('hidden');
    fireEvent.click(action);
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('exposes product selection actions as toggle buttons', () => {
    render(
      <CatalogProductCard
        title="Dog Toy"
        identity="DisplayItem 2752"
        selected
        actionLabel="Remove"
        onAction={() => undefined}
      />,
    );

    const action = screen.getByRole('button', { name: 'Remove' });
    expect(action).toHaveAttribute('aria-pressed', 'true');
    expect(action).not.toHaveAttribute('aria-expanded');
    expect(action).not.toHaveAttribute('aria-controls');
  });

  it('keeps duplicate SKU rows distinguishable by immutable item ID', () => {
    const first = vi.fn();
    const second = vi.fn();

    render(
      <>
        <CatalogItemRow
          title="Small"
          itemId="item-1"
          sku="SHARED-SKU"
          onSelect={first}
        />
        <CatalogItemRow
          title="Medium"
          itemId="item-2"
          sku="SHARED-SKU"
          onSelect={second}
        />
      </>,
    );

    expect(screen.getByText('Item item-1')).toBeInTheDocument();
    expect(screen.getByText('Item item-2')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button')[1]);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('disables every mutation control for locked fields', () => {
    render(
      <SelectedReferenceRow
        title="Dog Toy"
        identity="DisplayItem 2752"
        disabled
        canMoveUp
        canMoveDown
        onMoveUp={() => undefined}
        onMoveDown={() => undefined}
        onReplace={() => undefined}
        onRemove={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'Move up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  });
});
