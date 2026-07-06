import { render, screen, fireEvent } from '@testing-library/react';
import { SuggestedFriendCard } from '../suggested-friend-card';

describe('SuggestedFriendCard', () => {
  it('renders name, tag, and add button', () => {
    render(
      <SuggestedFriendCard
        name="Charlie"
        tag="Poetry Lover"
        avatarUrl={null}
        onAdd={jest.fn()}
      />
    );

    expect(screen.getByText('Charlie')).toBeInTheDocument();
    expect(screen.getByText('Poetry Lover')).toBeInTheDocument();
    expect(screen.getByText('Add Friend')).toBeInTheDocument();
  });

  it('calls onAdd when button is clicked', () => {
    const onAdd = jest.fn();
    render(
      <SuggestedFriendCard
        name="Charlie"
        tag="Poetry Lover"
        avatarUrl={null}
        onAdd={onAdd}
      />
    );

    fireEvent.click(screen.getByText('Add Friend'));
    expect(onAdd).toHaveBeenCalled();
  });
});
