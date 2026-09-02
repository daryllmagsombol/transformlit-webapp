import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserSearchInput } from '../user-search-input';

jest.mock('../../../lib/apollo-client', () => ({
  apolloClient: {
    query: jest.fn(),
  },
}));

import { apolloClient } from '../../../lib/apollo-client';

describe('UserSearchInput', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders search input', () => {
    render(<UserSearchInput onSelectUser={jest.fn()} currentUserId="u1" />);
    expect(screen.getByPlaceholderText('Search users...')).toBeInTheDocument();
  });

  it('shows "No users found" when search returns empty', async () => {
    (apolloClient.query as jest.Mock).mockResolvedValue({
      data: { searchUsers: [] },
    });

    render(<UserSearchInput onSelectUser={jest.fn()} currentUserId="u1" />);
    const input = screen.getByPlaceholderText('Search users...');
    fireEvent.change(input, { target: { value: 'xyz' } });

    await waitFor(() => {
      expect(screen.getByText(/No users found/)).toBeInTheDocument();
    });
  });

  it('renders search results and calls onSelectUser when result is clicked', async () => {
    const onSelectUser = jest.fn();
    (apolloClient.query as jest.Mock).mockResolvedValue({
      data: {
        searchUsers: [
          { id: 'u2', displayName: 'Diana', avatarUrl: null, bio: 'Reader' },
        ],
      },
    });

    render(<UserSearchInput onSelectUser={onSelectUser} currentUserId="u1" />);
    const input = screen.getByPlaceholderText('Search users...');
    fireEvent.change(input, { target: { value: 'diana' } });

    await waitFor(() => {
      expect(screen.getByText('Diana')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Diana'));
    expect(onSelectUser).toHaveBeenCalledWith('u2');
  });
});
