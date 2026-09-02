import { render, screen } from '@testing-library/react';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { FeaturedGroupCard } from './featured-group-card';

describe('FeaturedGroupCard', () => {
  const defaultProps = {
    name: 'Featured Group',
    memberCount: 150,
  };

  it('renders group name', () => {
    render(<FeaturedGroupCard {...defaultProps} />);
    expect(screen.getByText('Featured Group')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<FeaturedGroupCard {...defaultProps} description="A featured description" />);
    expect(screen.getByText('A featured description')).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    render(<FeaturedGroupCard {...defaultProps} />);
    expect(screen.queryByText('A featured description')).not.toBeInTheDocument();
  });

  it('renders member count with Active Today text', () => {
    render(<FeaturedGroupCard {...defaultProps} memberCount={150} />);
    expect(screen.getByText('150 Active Today')).toBeInTheDocument();
  });

  it('renders Editor\'s Choice badge', () => {
    render(<FeaturedGroupCard {...defaultProps} />);
    expect(screen.getByText(/editor's choice/i)).toBeInTheDocument();
  });

  it('renders cover image when provided', () => {
    render(<FeaturedGroupCard {...defaultProps} coverImageUrl="/featured-image.jpg" />);
    const img = screen.getByRole('img', { name: 'Featured Group' });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', '/featured-image.jpg');
  });

  it('renders placeholder icon when cover image not provided', () => {
    const { container } = render(<FeaturedGroupCard {...defaultProps} />);
    const icon = container.querySelector('.material-symbols-outlined');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveTextContent('star');
  });

  it('renders Join Group button', () => {
    render(<FeaturedGroupCard {...defaultProps} />);
    expect(screen.getByRole('button', { name: /join group/i })).toBeInTheDocument();
  });
});
