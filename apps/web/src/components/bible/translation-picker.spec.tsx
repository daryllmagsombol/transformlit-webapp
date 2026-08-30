import { render, screen, fireEvent } from '@testing-library/react';
import { TranslationPicker } from './translation-picker';
import { useBibleStore } from '../../store/bible-store';

describe('TranslationPicker', () => {
  it('renders grouped translations and selects on click', () => {
    render(<TranslationPicker open onClose={() => {}} />);

    expect(screen.getByText('Berean Standard Bible')).toBeInTheDocument();
    expect(screen.getByText('Banal na Bibliya')).toBeInTheDocument();
    expect(screen.getByText('ENGWEBP')).toBeInTheDocument();

    fireEvent.click(screen.getByText('King James Version'));
    expect(useBibleStore.getState().translation).toBe('eng_kjv');
  });
});
