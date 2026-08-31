// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { floorplanStore } from '../state/floorplanStore';
import { Palette } from './Palette';

beforeEach(() => {
  floorplanStore.setState({ templateId: 'two-bed', templateChosen: false });
  floorplanStore.getState().reset();
});

afterEach(() => cleanup());

describe('palette', () => {
  it('folds items under categories, first one open', () => {
    render(<Palette />);

    expect(screen.getByText('Sofa')).toBeDefined();
    // Bedroom is folded until opened.
    expect(screen.queryByText('Queen bed')).toBeNull();

    fireEvent.click(screen.getByText('Bedroom'));
    expect(screen.getByText('Queen bed')).toBeDefined();
  });

  it('arms an item on click and disarms on a second click', () => {
    render(<Palette />);

    fireEvent.click(screen.getByText('Sofa'));
    expect(floorplanStore.getState().armed).toEqual({ catalogId: 'sofa' });

    fireEvent.click(screen.getByText('Sofa'));
    expect(floorplanStore.getState().armed).toBeNull();
  });

  it('carries a chosen finish into the armed item, defaulting when unset', () => {
    render(<Palette />);

    fireEvent.click(screen.getByLabelText('Configure Sofa'));
    fireEvent.click(screen.getByTitle('Navy'));
    fireEvent.click(screen.getByText('Sofa'));

    expect(floorplanStore.getState().armed).toEqual({ catalogId: 'sofa', color: '#46536b' });

    // Back to default: the colour rides off again.
    fireEvent.click(screen.getByText('Default'));
    expect(floorplanStore.getState().armed).toEqual({ catalogId: 'sofa' });
  });

  it('offers no finish on porcelain pieces', () => {
    render(<Palette />);

    fireEvent.click(screen.getByText('Bath & Utility'));
    expect(screen.queryByLabelText('Configure Toilet')).toBeNull();
    expect(screen.getByLabelText('Configure Washer')).toBeDefined();
  });
});
