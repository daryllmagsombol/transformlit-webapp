import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from './confirm-dialog';

const baseProps = {
  open: true,
  onClose: jest.fn(),
  onConfirm: jest.fn(),
  title: 'Send friend request?',
  message: 'Send a friend request to Ada Lovelace?',
};

function renderDialog(overrides: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  return render(<ConfirmDialog {...baseProps} {...overrides} />);
}

describe('ConfirmDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the title and message', () => {
    renderDialog();
    expect(screen.getByText('Send friend request?')).toBeInTheDocument();
    expect(screen.getByText('Send a friend request to Ada Lovelace?')).toBeInTheDocument();
  });

  it('exposes an accessible name and description on the dialog', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.getAttribute('aria-labelledby')).toBe(dialog.querySelector('h2')?.id);
    const descriptionId = dialog.getAttribute('aria-describedby');
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)).toHaveTextContent(
      'Send a friend request to Ada Lovelace?',
    );
  });

  it('calls onClose and not onConfirm when Cancel is clicked', () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn();
    renderDialog({ onClose, onConfirm });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('calls onConfirm when the confirm button is clicked', () => {
    const onConfirm = jest.fn();
    renderDialog({ confirmLabel: 'Send Request', onConfirm });

    fireEvent.click(screen.getByRole('button', { name: 'Send Request' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while pending and shows a busy label', () => {
    renderDialog({ confirmLabel: 'Send Request', pending: true });

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send Request…' })).toBeDisabled();
  });

  it('does not call onClose on backdrop click while pending', () => {
    const onClose = jest.fn();
    const { container } = renderDialog({ pending: true, onClose });

    const backdrop = container.querySelector('.absolute.inset-0');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose on backdrop click when not pending', () => {
    const onClose = jest.fn();
    const { container } = renderDialog({ onClose });

    const backdrop = container.querySelector('.absolute.inset-0');
    fireEvent.click(backdrop!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('applies the error button class for the danger tone', () => {
    renderDialog({ tone: 'danger', confirmLabel: 'Decline' });

    const confirmButton = screen.getByRole('button', { name: 'Decline' });
    expect(confirmButton.className).toContain('bg-error');
    expect(confirmButton.className).toContain('text-on-error');
  });

  it('applies the primary button class for the default tone', () => {
    renderDialog({ confirmLabel: 'Confirm' });

    expect(screen.getByRole('button', { name: 'Confirm' }).className).toContain('bg-primary');
  });

  it('renders nothing when open is false', () => {
    const { container } = renderDialog({ open: false });
    expect(container.firstChild).toBeNull();
  });
});
