import { render, screen, fireEvent } from '@testing-library/react';
import { CompactGroupCard } from './compact-group-card';

describe('CompactGroupCard', () => {
  const defaultProps = {
    name: 'Compact Group',
    icon: 'group',
    iconBg: 'bg-blue-500',
  };

  it('renders group name', () => {
    render(<CompactGroupCard {...defaultProps} />);
    expect(screen.getByText('Compact Group')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<CompactGroupCard {...defaultProps} description="A compact description" />);
    expect(screen.getByText('A compact description')).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    render(<CompactGroupCard {...defaultProps} />);
    expect(screen.queryByText('A compact description')).not.toBeInTheDocument();
  });

  it('renders icon', () => {
    const { container } = render(<CompactGroupCard {...defaultProps} />);
    const icon = container.querySelector('.material-symbols-outlined');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveTextContent('group');
  });

  it('applies iconBg class', () => {
    const { container } = render(<CompactGroupCard {...defaultProps} />);
    const iconContainer = container.querySelector('.bg-blue-500');
    expect(iconContainer).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const handleClick = jest.fn();
    render(<CompactGroupCard {...defaultProps} onClick={handleClick} />);
    fireEvent.click(screen.getByText('Compact Group'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('has cursor-pointer class', () => {
    const { container } = render(<CompactGroupCard {...defaultProps} />);
    expect(container.firstChild).toHaveClass('cursor-pointer');
  });
});
