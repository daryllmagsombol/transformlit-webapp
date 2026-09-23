import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserMenu } from './user-menu';

var mockPush: jest.Mock;
var mockClearAuthStore: jest.Mock;
var mockClearAuthStorage: jest.Mock;
var mockResetApolloState: jest.Mock;
var mockFetch: jest.Mock;

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/feed',
}));

jest.mock('../../store', () => ({
  useAuthStore: Object.assign(
    (selector: (s: { user: unknown; clearAuth: jest.Mock }) => unknown) =>
      selector({ user: null, clearAuth: mockClearAuthStore }),
    {
      getState: () => ({ user: null, clearAuth: mockClearAuthStore }),
    }
  ),
}));

jest.mock('../../lib/auth', () => ({
  clearAuth: () => mockClearAuthStorage(),
}));

jest.mock('../../lib/apollo-client', () => ({
  resetApolloState: () => mockResetApolloState(),
}));

jest.mock('../../lib/constants', () => ({
  API_BASE: 'http://localhost:3005',
}));

const mockUser = {
  id: 'user-1',
  email: 'jane@example.com',
  displayName: 'Jane Doe',
  avatarUrl: null,
  role: 'READER',
  createdAt: '2024-01-01T00:00:00Z',
};

describe('UserMenu', () => {
  beforeEach(() => {
    mockPush = jest.fn();
    mockClearAuthStore = jest.fn();
    mockClearAuthStorage = jest.fn();
    mockResetApolloState = jest.fn();
    mockFetch = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  describe('trigger', () => {
    it('renders the avatar as a menu button', () => {
      render(<UserMenu user={mockUser} />);

      const trigger = screen.getByRole('button', { expanded: false });
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
      expect(trigger).toContainElement(screen.getByText('J'));
    });

    it('shows the fallback initial when no display name is provided', () => {
      render(<UserMenu user={null} />);
      expect(screen.getByText('U')).toBeInTheDocument();
    });
  });

  describe('dropdown', () => {
    it('opens the menu when the avatar is clicked', () => {
      render(<UserMenu user={mockUser} />);

      fireEvent.click(screen.getByRole('button', { expanded: false }));

      expect(screen.getByRole('menu')).toBeInTheDocument();
      expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText('jane@example.com')).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /log out/i })).toBeInTheDocument();
    });

    it('closes the menu when the avatar is clicked again', () => {
      render(<UserMenu user={mockUser} />);

      const trigger = screen.getByRole('button', { expanded: false });
      fireEvent.click(trigger);
      expect(screen.getByRole('menu')).toBeInTheDocument();

      fireEvent.click(trigger);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('closes the menu when clicking outside', () => {
      render(
        <div>
          <UserMenu user={mockUser} />
          <div data-testid="outside">Outside</div>
        </div>
      );

      fireEvent.click(screen.getByRole('button', { expanded: false }));
      expect(screen.getByRole('menu')).toBeInTheDocument();

      fireEvent.mouseDown(screen.getByTestId('outside'));
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('closes the menu on Escape and returns focus to the trigger', async () => {
      render(<UserMenu user={mockUser} />);

      const trigger = screen.getByRole('button', { expanded: false });
      fireEvent.click(trigger);
      expect(screen.getByRole('menu')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      });
      expect(document.activeElement).toBe(trigger);
    });
  });

  describe('logout', () => {
    it('clears auth and navigates to login when Log out is clicked', async () => {
      render(<UserMenu user={mockUser} />);

      fireEvent.click(screen.getByRole('button', { expanded: false }));
      fireEvent.click(screen.getByRole('menuitem', { name: /log out/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3005/auth/logout',
          expect.objectContaining({
            method: 'POST',
            credentials: 'include',
          }),
        );
      });

      expect(mockClearAuthStorage).toHaveBeenCalledTimes(1);
      expect(mockClearAuthStore).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith('/login');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('still clears local auth when the logout endpoint fails', async () => {
      mockFetch.mockRejectedValue(new Error('network down'));

      render(<UserMenu user={mockUser} />);

      fireEvent.click(screen.getByRole('button', { expanded: false }));
      fireEvent.click(screen.getByRole('menuitem', { name: /log out/i }));

      await waitFor(() => {
        expect(mockClearAuthStorage).toHaveBeenCalledTimes(1);
      });
      expect(mockClearAuthStore).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith('/login');
    });

    it('resets the Apollo cache on logout to prevent cross-user data leaks', async () => {
      render(<UserMenu user={mockUser} />);

      fireEvent.click(screen.getByRole('button', { expanded: false }));
      fireEvent.click(screen.getByRole('menuitem', { name: /log out/i }));

      await waitFor(() => {
        expect(mockResetApolloState).toHaveBeenCalledTimes(1);
      });
    });
  });
});
