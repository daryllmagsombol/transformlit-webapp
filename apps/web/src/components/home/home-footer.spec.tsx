import { render, screen } from '@testing-library/react';

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className as string}>{children}</a>;
  };
});

import { HomeFooter } from './home-footer';

describe('HomeFooter', () => {
  it('renders brand, tagline, copyright and contact', () => {
    render(<HomeFooter />);
    expect(screen.getByText('Turning Pages, Turning Hearts.')).toBeInTheDocument();
    expect(screen.getByText(/© 2026 Transform Lit/)).toBeInTheDocument();
    expect(screen.getByText('0927-412-2292')).toBeInTheDocument();
  });

  it('renders all four social links', () => {
    render(<HomeFooter />);
    expect(screen.getByText('Facebook')).toHaveAttribute('href', 'https://facebook.com/transformlit');
    expect(screen.getByText('Instagram')).toHaveAttribute('href', 'https://instagram.com/transformlit');
    expect(screen.getByText('Google Play')).toHaveAttribute(
      'href',
      'https://play.google.com/store/apps/details?id=com.transformlit.app',
    );
    expect(screen.getByText('Shopee')).toHaveAttribute('href', 'https://shopee.ph/transformlit');
  });
});