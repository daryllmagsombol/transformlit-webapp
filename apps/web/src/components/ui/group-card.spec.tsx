import { render, screen } from '@testing-library/react';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { GroupCard } from './group-card';

describe('GroupCard', () => {
  const defaultProps = {
    name: 'Test Group',
    memberCount: 42,
  };

  it('renders group name', () => {
    render(<GroupCard {...defaultProps} />);
    expect(screen.getByText('Test Group')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<GroupCard {...defaultProps} description="A test description" />);
    expect(screen.getByText('A test description')).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    render(<GroupCard {...defaultProps} />);
    expect(screen.queryByText('A test description')).not.toBeInTheDocument();
  });

  it('renders member count with plural form', () => {
    render(<GroupCard {...defaultProps} memberCount={42} />);
    expect(screen.getByText('42 Members')).toBeInTheDocument();
  });

  it('renders member count with singular form', () => {
    render(<GroupCard {...defaultProps} memberCount={1} />);
    expect(screen.getByText('1 Member')).toBeInTheDocument();
  });

  it('renders cover image when provided', () => {
    render(<GroupCard {...defaultProps} coverImageUrl="/test-image.jpg" />);
    const img = screen.getByRole('img', { name: 'Test Group' });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', '/test-image.jpg');
  });

  it('renders placeholder icon when cover image not provided', () => {
    const { container } = render(<GroupCard {...defaultProps} />);
    const icon = container.querySelector('.material-symbols-outlined');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveTextContent('diversity_3');
  });

  it('renders Open Circle button', () => {
    render(<GroupCard {...defaultProps} />);
    expect(screen.getByRole('button', { name: /open circle/i })).toBeInTheDocument();
  });
});
