import { render, screen } from '@testing-library/react';
import { Footer } from './footer';

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className}>{children}</a>;
  };
});

describe('Footer', () => {
  describe('brand', () => {
    it('renders the Transformlit brand name', () => {
      render(<Footer />);
      expect(screen.getByText('Transformlit')).toBeInTheDocument();
    });
  });

  describe('copyright', () => {
    it('renders copyright text', () => {
      render(<Footer />);
      expect(screen.getByText(/2024 Transformlit. All rights reserved./)).toBeInTheDocument();
    });
  });

  describe('links', () => {
    it('renders Privacy Policy link', () => {
      render(<Footer />);
      const link = screen.getByText('Privacy Policy');
      expect(link).toBeInTheDocument();
      expect(link.closest('a')).toHaveAttribute('href', '/privacy');
    });

    it('renders Terms of Service link', () => {
      render(<Footer />);
      const link = screen.getByText('Terms of Service');
      expect(link).toBeInTheDocument();
      expect(link.closest('a')).toHaveAttribute('href', '/terms');
    });

    it('renders Contact Support link', () => {
      render(<Footer />);
      const link = screen.getByText('Contact Support');
      expect(link).toBeInTheDocument();
      expect(link.closest('a')).toHaveAttribute('href', '/contact');
    });
  });

  describe('structure', () => {
    it('renders a footer element', () => {
      render(<Footer />);
      expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    });

    it('renders a nav with aria-label Legal', () => {
      render(<Footer />);
      expect(screen.getByRole('navigation', { name: 'Legal' })).toBeInTheDocument();
    });
  });
});
