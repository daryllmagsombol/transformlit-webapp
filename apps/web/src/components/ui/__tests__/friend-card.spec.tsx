import { render, screen, fireEvent } from '@testing-library/react';
import { FriendCard } from '../friend-card';

describe('FriendCard', () => {
  it('renders name and bio', () => {
    render(
      <FriendCard
        name="Alice"
        bio="Book lover"
        avatarUrl={null}
        mutualGroups={3}
        onPress={jest.fn()}
      />
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Book lover')).toBeInTheDocument();
    expect(screen.getByText('3 mutual groups')).toBeInTheDocument();
  });

  it('calls onPress when clicked', () => {
    const onPress = jest.fn();
    render(
      <FriendCard
        name="Alice"
        bio="Book lover"
        avatarUrl={null}
        mutualGroups={0}
        onPress={onPress}
      />
    );

    fireEvent.click(screen.getByText('Alice').closest('div')!);
    expect(onPress).toHaveBeenCalled();
  });

  it('renders avatar with initial when no avatarUrl', () => {
    render(
      <FriendCard
        name="Alice"
        bio="Book lover"
        avatarUrl={null}
        mutualGroups={1}
        onPress={jest.fn()}
      />
    );

    expect(screen.getByText('A')).toBeInTheDocument();
  });
});
