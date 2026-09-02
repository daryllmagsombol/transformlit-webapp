import { render, screen, fireEvent } from '@testing-library/react';
import { FriendRequestItem } from '../friend-request-item';

describe('FriendRequestItem', () => {
  it('renders name, bio, and accept/decline buttons', () => {
    render(
      <FriendRequestItem
        name="Bob"
        bio="Sci-fi fan"
        avatarUrl={null}
        onAccept={jest.fn()}
        onDecline={jest.fn()}
      />
    );

    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Sci-fi fan')).toBeInTheDocument();
    expect(screen.getByText('Accept')).toBeInTheDocument();
    expect(screen.getByText('Decline')).toBeInTheDocument();
  });

  it('calls onAccept when accept is clicked', () => {
    const onAccept = jest.fn();
    render(
      <FriendRequestItem
        name="Bob"
        avatarUrl={null}
        onAccept={onAccept}
        onDecline={jest.fn()}
      />
    );

    fireEvent.click(screen.getByText('Accept'));
    expect(onAccept).toHaveBeenCalled();
  });

  it('calls onDecline when decline is clicked', () => {
    const onDecline = jest.fn();
    render(
      <FriendRequestItem
        name="Bob"
        avatarUrl={null}
        onAccept={jest.fn()}
        onDecline={onDecline}
      />
    );

    fireEvent.click(screen.getByText('Decline'));
    expect(onDecline).toHaveBeenCalled();
  });
});
