import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', resolvedTheme: 'light', setTheme: jest.fn() }),
}));

jest.mock('next/link', () => {
  return function MockLink({ children, href, className, onClick }: Record<string, unknown>) {
    return (
      <a href={href as string} className={className as string} onClick={onClick}>
        {children}
      </a>
    );
  };
});

import { HomeNav } from './home-nav';

describe('HomeNav', () => {
  it('renders nav links and the Login CTA', () => {
    render(<HomeNav />);
    expect(screen.getByText('About')).toBeInTheDocument();
    expect(screen.getByText('MOVE System')).toBeInTheDocument();
    const login = screen.getByText('Login');
    expect(login).toHaveAttribute('href', '/login');
  });

  it('opens the mobile menu on toggle', () => {
    render(<HomeNav />);
    const toggle = screen.getByRole('button', { name: /toggle menu/i });
    fireEvent.click(toggle);
    expect(screen.getAllByText('About').length).toBeGreaterThanOrEqual(1);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});