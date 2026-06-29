import { render, screen } from '@testing-library/react';
import { UserAvatar } from './user-avatar';

describe('UserAvatar', () => {
  describe('avatarUrl prop', () => {
    it('renders an img element when avatarUrl is provided', () => {
      render(<UserAvatar avatarUrl="https://example.com/avatar.jpg" displayName="Alice" />);
      const img = screen.getByRole('img', { name: 'Alice' });
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', 'https://example.com/avatar.jpg');
    });

    it('does not render an img element when avatarUrl is null', () => {
      const { container } = render(<UserAvatar avatarUrl={null} displayName="Bob" />);
      expect(container.querySelector('img')).not.toBeInTheDocument();
    });

    it('does not render an img element when avatarUrl is undefined', () => {
      const { container } = render(<UserAvatar displayName="Charlie" />);
      expect(container.querySelector('img')).not.toBeInTheDocument();
    });
  });

  describe('fallback', () => {
    it('shows first character of displayName (uppercased) when no avatarUrl', () => {
      render(<UserAvatar displayName="alice" />);
      expect(screen.getByText('A')).toBeInTheDocument();
    });

    it('shows "U" when no displayName and no avatarUrl', () => {
      render(<UserAvatar />);
      expect(screen.getByText('U')).toBeInTheDocument();
    });

    it('shows "U" when displayName is undefined', () => {
      render(<UserAvatar avatarUrl={null} />);
      expect(screen.getByText('U')).toBeInTheDocument();
    });
  });

  describe('size prop', () => {
    it('applies sm size classes (w-8 h-8, text-[10px])', () => {
      const { container } = render(<UserAvatar size="sm" displayName="A" />);
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.className).toContain('w-8');
      expect(wrapper.className).toContain('h-8');
      const text = screen.getByText('A');
      expect(text.className).toContain('text-[10px]');
    });

    it('applies md size classes by default (w-9 h-9, text-xs)', () => {
      const { container } = render(<UserAvatar displayName="B" />);
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.className).toContain('w-9');
      expect(wrapper.className).toContain('h-9');
      const text = screen.getByText('B');
      expect(text.className).toContain('text-xs');
    });
  });
});
