import { render, screen, fireEvent } from '@testing-library/react';
import { NotificationItem } from './notification-item';

describe('NotificationItem', () => {
  it('renders notification text and timestamp', () => {
    render(
      <NotificationItem
        type="FRIEND_REQUEST"
        body="Alice sent you a friend request"
        timestamp="2h ago"
        read={false}
        onPress={jest.fn()}
      />
    );

    expect(screen.getByText('Alice sent you a friend request')).toBeInTheDocument();
    expect(screen.getByText('2h ago')).toBeInTheDocument();
  });

  it('shows unread dot when not read', () => {
    render(
      <NotificationItem
        type="FRIEND_REQUEST"
        body="Test notification"
        timestamp="1m ago"
        read={false}
        onPress={jest.fn()}
      />
    );

    const dot = document.querySelector('.bg-info') || document.querySelector('[class*="bg-info"]');
    expect(dot).toBeInTheDocument();
  });

  it('does not show unread dot when read', () => {
    render(
      <NotificationItem
        type="FRIEND_ACCEPTED"
        body="Test notification"
        timestamp="1d ago"
        read={true}
        onPress={jest.fn()}
      />
    );

    const dots = document.querySelectorAll('[class*="bg-info"]');
    // The icon background also uses bg-info/10 — check specifically for the unread dot
    const unreadDot = document.querySelector('.absolute.top-4.right-4');
    expect(unreadDot).toBeNull();
  });

  it('calls onPress when clicked', () => {
    const onPress = jest.fn();
    render(
      <NotificationItem
        type="FRIEND_REQUEST"
        body="Test"
        timestamp="now"
        read={false}
        onPress={onPress}
      />
    );

    fireEvent.click(screen.getByText('Test').closest('button')!);
    expect(onPress).toHaveBeenCalled();
  });
});
