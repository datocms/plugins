import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderInCanvas } from '../test/canvas';
import type { LinkOccurrence } from '../types';
import { LogStatus } from './LogStatus';
import { PlaceLabel } from './PlaceLabel';

const occurrence: LinkOccurrence = {
  id: 'occurrence-1',
  recordId: 'record-1',
  recordTitle: 'Pricing',
  modelId: 'page',
  modelName: 'Page',
  fieldPath: 'sections.it.0.url',
  fieldLabel: 'Button URL',
  locale: 'it',
  blockPath: ['Sections', 'Hero 1'],
  url: 'https://example.com/',
};

describe('PlaceLabel', () => {
  it('names the field, its locale, and the fields and blocks around it', () => {
    const { container } = renderInCanvas(
      <PlaceLabel occurrence={occurrence} uiLocale="en" showLocale />,
    );
    expect(screen.getByText('Italian')).toBeInTheDocument();
    // The field reads first, then its locale, then where it sits.
    expect(container.textContent).toBe('Button URLItalianin Sections > Hero 1');
    // The path is the row's details line, under the field.
    const path = screen.getByText('in Sections > Hero 1');
    expect(path).toHaveClass('EntityRow__details');
    expect(path.closest('.EntityRow__title')).not.toBeInTheDocument();
  });

  it('leaves out the locale on single-locale sites and the path at the top level', () => {
    renderInCanvas(
      <PlaceLabel
        occurrence={{ ...occurrence, blockPath: [] }}
        uiLocale="en"
        showLocale={false}
      />,
    );
    expect(screen.getByText('Button URL')).toBeInTheDocument();
    expect(screen.queryByText('Italian')).not.toBeInTheDocument();
    expect(screen.queryByText(/^in /)).not.toBeInTheDocument();
  });
});

describe('LogStatus', () => {
  it('writes the status as a word next to its dot', () => {
    renderInCanvas(<LogStatus status="cancelled" />);
    expect(screen.getByText('Not checked')).toBeInTheDocument();
  });
});
