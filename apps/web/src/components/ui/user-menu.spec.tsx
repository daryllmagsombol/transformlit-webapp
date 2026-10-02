import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserMenu } from './user-menu';

var mockPush: jest.Mock;
var mockRequestAccountExit: jest.Mock;
var mockCompleteAccountExit: jest.Mock;
var mockCancelAccountExit: jest.Mock;

const EMPTY_WORK = {
  pending: 0,
  inFlightOrUncertain: 0,
  blockedSuccessors: 0,
  conflicts: 0,
  localOnly: 0,
  fullyDrained: true,
};

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/feed',
}));

jest.mock('../../lib/offline/account-exit', () => ({
  EMPTY_EXIT_WORK: {
    pending: 0,
    inFlightOrUncertain: 0,
    blockedSuccessors: 0,
    conflicts: 0,
    localOnly: 0,
    fullyDrained: true,
  },
  requestAccountExit: () => mockRequestAccountExit(),
  completeAccountExit: (discard: boolean, drained: boolean) => mockCompleteAccountExit(discard, drained),
  cancelAccountExit: () => mockCancelAccountExit(),
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
    mockRequestAccountExit = jest.fn().mockResolvedValue({
      decision: { status: 'SYNC_REQUIRED', reason: 'PENDING_WORK' },
      work: EMPTY_WORK,
    });
    mockCompleteAccountExit = jest.fn().mockResolvedValue({ status: 'PROCEED' });
    mockCancelAccountExit = jest.fn();
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

  describe('logout through the lifecycle gate', () => {
    it('signs out and navigates to login when there is no outstanding work', async () => {
      render(<UserMenu user={mockUser} />);

      fireEvent.click(screen.getByRole('button', { expanded: false }));
      fireEvent.click(screen.getByRole('menuitem', { name: /log out/i }));

      await waitFor(() => expect(mockCompleteAccountExit).toHaveBeenCalledWith(false, true));
      expect(mockPush).toHaveBeenCalledWith('/login');
      expect(screen.queryByTestId('account-exit-dialog')).not.toBeInTheDocument();
    });

    it('opens the informed exit dialog (naming the work) when the drain is not complete', async () => {
      mockRequestAccountExit.mockResolvedValue({
        decision: { status: 'SYNC_REQUIRED', reason: 'PENDING_WORK' },
        work: { ...EMPTY_WORK, fullyDrained: false, pending: 2, conflicts: 1 },
      });

      render(<UserMenu user={mockUser} />);
      fireEvent.click(screen.getByRole('button', { expanded: false }));
      fireEvent.click(screen.getByRole('menuitem', { name: /log out/i }));

      const dialog = await screen.findByTestId('account-exit-dialog');
      expect(dialog).toHaveTextContent(/2 waiting to sync/i);
      expect(dialog).toHaveTextContent(/1 conflict/i);
      // Not signed out yet.
      expect(mockCompleteAccountExit).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('does not discard until the user explicitly confirms, then navigates to login', async () => {
      mockRequestAccountExit.mockResolvedValue({
        decision: { status: 'SYNC_REQUIRED', reason: 'PENDING_WORK' },
        work: { ...EMPTY_WORK, fullyDrained: false, pending: 1 },
      });

      render(<UserMenu user={mockUser} />);
      fireEvent.click(screen.getByRole('button', { expanded: false }));
      fireEvent.click(screen.getByRole('menuitem', { name: /log out/i }));

      const discard = await screen.findByRole('button', { name: /discard and sign out/i });
      expect(discard).toBeDisabled();
      fireEvent.click(screen.getByLabelText(/permanently discard/i));

      mockCompleteAccountExit.mockResolvedValue({ status: 'PROCEED' });
      fireEvent.click(discard);

      await waitFor(() => expect(mockCompleteAccountExit).toHaveBeenCalledWith(true, false));
      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/login'));
    });

    it('leaves the dialog open and surfaces an error when the drain still cannot complete', async () => {
      mockRequestAccountExit.mockResolvedValue({
        decision: { status: 'SYNC_REQUIRED', reason: 'PENDING_WORK' },
        work: { ...EMPTY_WORK, fullyDrained: false, pending: 3 },
      });
      mockCompleteAccountExit.mockResolvedValue({ status: 'SYNC_REQUIRED', reason: 'PENDING_WORK' });

      render(<UserMenu user={mockUser} />);
      fireEvent.click(screen.getByRole('button', { expanded: false }));
      fireEvent.click(screen.getByRole('menuitem', { name: /log out/i }));

      fireEvent.click(await screen.findByRole('button', { name: /sync now/i }));

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/still need to sync/i));
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('unfreezes and surfaces an error when starting the exit rejects (never stuck frozen)', async () => {
      mockRequestAccountExit.mockRejectedValue(new Error('hydrate failed'));

      render(<UserMenu user={mockUser} />);
      fireEvent.click(screen.getByRole('button', { expanded: false }));
      fireEvent.click(screen.getByRole('menuitem', { name: /log out/i }));

      await waitFor(() => expect(mockCancelAccountExit).toHaveBeenCalled());
      expect(screen.getByTestId('account-exit-dialog')).toHaveTextContent(/could not start sign-out/i);
    });

    it('cancels the exit (unfreezing) when the user cancels the dialog', async () => {
      mockRequestAccountExit.mockResolvedValue({
        decision: { status: 'SYNC_REQUIRED', reason: 'PENDING_WORK' },
        work: { ...EMPTY_WORK, fullyDrained: false, pending: 1 },
      });

      render(<UserMenu user={mockUser} />);
      fireEvent.click(screen.getByRole('button', { expanded: false }));
      fireEvent.click(screen.getByRole('menuitem', { name: /log out/i }));

      fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
      expect(mockCancelAccountExit).toHaveBeenCalled();
    });

    it('navigates to login even when remote invalidation is deferred (local UI stays signed out)', async () => {
      mockCompleteAccountExit.mockResolvedValue({ status: 'BLOCKED', reason: 'DEFERRED_LOGOUT' });

      render(<UserMenu user={mockUser} />);
      fireEvent.click(screen.getByRole('button', { expanded: false }));
      fireEvent.click(screen.getByRole('menuitem', { name: /log out/i }));

      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/login'));
    });
  });
});
