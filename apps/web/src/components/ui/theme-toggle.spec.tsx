import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from './theme-toggle';

// Mock next-themes useTheme
const mockSetTheme = jest.fn();
let mockTheme = 'light';

jest.mock('next-themes', () => ({
  useTheme: () => ({
    theme: mockTheme,
    setTheme: mockSetTheme,
    resolvedTheme: mockTheme,
  }),
}));

describe('ThemeToggle', () => {
  beforeEach(() => {
    mockTheme = 'light';
    mockSetTheme.mockClear();
  });

  it('renders a toggle button', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('shows moon icon (dark_mode) when in light mode', () => {
    render(<ThemeToggle />);
    expect(screen.getByText('dark_mode')).toBeInTheDocument();
  });

  it('shows sun icon (light_mode) when in dark mode', () => {
    mockTheme = 'dark';
    render(<ThemeToggle />);
    expect(screen.getByText('light_mode')).toBeInTheDocument();
  });

  it('toggles to dark when clicked in light mode', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button'));
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('toggles to light when clicked in dark mode', () => {
    mockTheme = 'dark';
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button'));
    expect(mockSetTheme).toHaveBeenCalledWith('light');
  });
});
