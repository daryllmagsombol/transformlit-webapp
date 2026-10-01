import { fireEvent, render, screen } from '@testing-library/react';
import { AccountExitDialog } from './account-exit-dialog';
import type { ExitWorkSummary } from '../../lib/offline/account-exit';

const EMPTY: ExitWorkSummary = {
  pending: 0,
  inFlightOrUncertain: 0,
  blockedSuccessors: 0,
  conflicts: 0,
  localOnly: 0,
  fullyDrained: true,
};

const PENDING: ExitWorkSummary = {
  pending: 2,
  inFlightOrUncertain: 1,
  blockedSuccessors: 1,
  conflicts: 1,
  localOnly: 3,
  fullyDrained: false,
};

function renderDialog(overrides: Partial<Parameters<typeof AccountExitDialog>[0]> = {}) {
  return render(
    <AccountExitDialog
      open
      work={PENDING}
      onSync={jest.fn()}
      onConfirmDiscard={jest.fn()}
      onCancel={jest.fn()}
      {...overrides}
    />,
  );
}

describe('AccountExitDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = renderDialog({ open: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('names the exact unresolved work in the discard explanation', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/2 waiting to sync/i);
    expect(dialog).toHaveTextContent(/1 in flight/i);
    expect(dialog).toHaveTextContent(/1 blocked/i);
    expect(dialog).toHaveTextContent(/1 conflict/i);
    expect(dialog).toHaveTextContent(/3 saved only on this device/i);
  });

  it('requires an informed confirmation before discarding', () => {
    const onConfirmDiscard = jest.fn();
    renderDialog({ onConfirmDiscard });

    const discard = screen.getByRole('button', { name: /discard and sign out/i });
    expect(discard).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/permanently discard/i));
    expect(discard).toBeEnabled();
    fireEvent.click(discard);
    expect(onConfirmDiscard).toHaveBeenCalledTimes(1);
  });

  it('offers a sync-first action and a cancel action', () => {
    const onSync = jest.fn();
    const onCancel = jest.fn();
    renderDialog({ onSync, onCancel });

    fireEvent.click(screen.getByRole('button', { name: /sync now/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('is labelled by its heading and announces busy state', () => {
    renderDialog({ busy: true });
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('heading', { name: /sign out/i })).toBeInTheDocument();
  });

  it('uses a native <dialog> element and closes on Escape', () => {
    const onCancel = jest.fn();
    renderDialog({ onCancel });
    const dialog = screen.getByRole('dialog');
    expect(dialog.tagName).toBe('DIALOG');

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
