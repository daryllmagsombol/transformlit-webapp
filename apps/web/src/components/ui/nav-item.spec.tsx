import { render, screen } from '@testing-library/react';
import { NavItem } from './nav-item';

jest.mock('next/link', () => {
  return function MockLink({ children, href, className, ...rest }: Record<string, unknown>) {
    return (
      <a href={href as string} className={className} data-testid="nav-link">
        {children}
      </a>
    );
  };
});

describe('NavItem', () => {
  const defaultProps = {
    label: 'Dashboard',
    href: '/dashboard',
    icon: 'dashboard',
  };

  describe('label prop', () => {
    it('renders label text', () => {
      render(<NavItem {...defaultProps} />);
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });

  describe('href prop', () => {
    it('renders a link with the correct href', () => {
      render(<NavItem {...defaultProps} />);
      const link = screen.getByTestId('nav-link');
      expect(link).toHaveAttribute('href', '/dashboard');
    });
  });

  describe('icon prop', () => {
    it('renders a Material Symbols icon span with the icon text', () => {
      render(<NavItem {...defaultProps} />);
      const iconSpan = screen.getByText('dashboard');
      expect(iconSpan).toBeInTheDocument();
      expect(iconSpan).toHaveClass('material-symbols-outlined');
    });
  });

  describe('active prop', () => {
    it('adds "filled" class to icon when active', () => {
      render(<NavItem {...defaultProps} active />);
      const iconSpan = screen.getByText('dashboard');
      expect(iconSpan).toHaveClass('filled');
    });

    it('does not add "filled" class to icon when inactive', () => {
      render(<NavItem {...defaultProps} />);
      const iconSpan = screen.getByText('dashboard');
      expect(iconSpan).not.toHaveClass('filled');
    });

    it('applies active sidebar styling (border-l-4) when active and sidebar variant', () => {
      render(<NavItem {...defaultProps} active />);
      const link = screen.getByTestId('nav-link');
      expect(link.className).toContain('border-l-4');
      expect(link.className).toContain('border-primary');
    });

    it('applies inactive sidebar styling when not active', () => {
      render(<NavItem {...defaultProps} />);
      const link = screen.getByTestId('nav-link');
      expect(link.className).toContain('text-on-surface-variant');
    });
  });

  describe('variant prop', () => {
    it('defaults to sidebar variant with horizontal layout classes', () => {
      render(<NavItem {...defaultProps} />);
      const link = screen.getByTestId('nav-link');
      expect(link.className).toContain('px-4');
      expect(link.className).toContain('py-3');
      expect(link.className).toContain('items-center');
    });

    it('applies bottom variant with vertical layout classes', () => {
      render(<NavItem {...defaultProps} variant="bottom" />);
      const link = screen.getByTestId('nav-link');
      expect(link.className).toContain('flex-col');
      expect(link.className).toContain('py-2');
    });

    it('applies rounded-full active styling for bottom variant', () => {
      render(<NavItem {...defaultProps} active variant="bottom" />);
      const link = screen.getByTestId('nav-link');
      expect(link.className).toContain('rounded-full');
      expect(link.className).not.toContain('border-l-4');
    });

    it('applies sidebar label styling (uppercase) by default', () => {
      render(<NavItem {...defaultProps} />);
      const label = screen.getByText('Dashboard');
      expect(label.className).toContain('uppercase');
    });

    it('applies bottom label styling (text-[10px])', () => {
      render(<NavItem {...defaultProps} variant="bottom" />);
      const label = screen.getByText('Dashboard');
      expect(label.className).toContain('text-[10px]');
    });
  });

  describe('badge prop', () => {
    it('renders a badge when provided', () => {
      render(<NavItem label="Chat" href="/chat" icon="chat_bubble" badge={3} />);
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('caps the badge at 9+', () => {
      render(<NavItem label="Chat" href="/chat" icon="chat_bubble" badge={12} />);
      expect(screen.getByText('9+')).toBeInTheDocument();
    });

    it('renders no badge when zero', () => {
      render(<NavItem label="Chat" href="/chat" icon="chat_bubble" badge={0} />);
      expect(screen.queryByText('0')).not.toBeInTheDocument();
    });
  });
});
