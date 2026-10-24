import { screen } from '@testing-library/react';
import EntityRow from 'datocms-react-ui/EntityRow';
import RowList from 'datocms-react-ui/RowList';
import { describe, expect, it } from 'vitest';
import { renderWithCanvas } from '../test/renderWithCanvas';
import { InsetRowList } from './InsetRowList';

describe('InsetRowList', () => {
  it('caps its margin with the side paddings of the frame', () => {
    renderWithCanvas(
      <InsetRowList bodyPadding={[0, 20, 20, 10]} className="scroll">
        <RowList.Item>
          <EntityRow layout="row" title="Alpine Trail" />
        </RowList.Item>
      </InsetRowList>,
    );

    const box = screen.getByText('Alpine Trail').closest('.scroll');
    expect(box).not.toBeNull();
    const style = (box as HTMLElement).style;
    expect(style.getPropertyValue('--InsetRowList-frame-left')).toBe('10px');
    expect(style.getPropertyValue('--InsetRowList-frame-right')).toBe('20px');
    expect(screen.getByRole('list')).toBeInTheDocument();
  });
});
