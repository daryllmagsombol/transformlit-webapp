import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccountRecoveryPrompt } from './account-recovery-prompt';

const mockActivationEligible = jest.fn();
const mockAbandon = jest.fn();

jest.mock('../../lib/offline/account-exit', () => ({
  EMPTY_EXIT_WORK: {
    pending: 0,
    inFlightOrUncertain: 0,
    blockedSuccessors: 0,
    conflicts: 0,
    localOnly: 0,
    fullyDrained: true,
  },
  accountActivationEligible: () => mockActivationEligible(),
  abandonDeferredLogout: () => mockAbandon(),
}));

describe('AccountRecoveryPrompt', () => {
  beforeEach(() => {
    mockActivationEligible.mockReset();
    mockAbandon.mockReset();
  });

  it('renders nothing when activation is eligible', async () => {
    mockActivationEligible.mockResolvedValue(true);
    const { container } = render(<AccountRecoveryPrompt />);
    await waitFor(() => expect(mockActivationEligible).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('offers an informed recovery when a durable barrier blocks activation', async () => {
    mockActivationEligible.mockResolvedValue(false);
    render(<AccountRecoveryPrompt />);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/could not be confirmed/i);
    const reset = screen.getByRole('button', { name: /reset this device/i });
    expect(reset).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/permanently discards/i));
    expect(reset).toBeEnabled();
  });

  it('resets the device on confirmation and re-checks eligibility', async () => {
    mockActivationEligible.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockAbandon.mockResolvedValue(undefined);
    render(<AccountRecoveryPrompt />);

    fireEvent.click(await screen.findByLabelText(/permanently discards/i));
    fireEvent.click(screen.getByRole('button', { name: /reset this device/i }));

    await waitFor(() => expect(mockAbandon).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('surfaces an error when the reset fails', async () => {
    mockActivationEligible.mockResolvedValue(false);
    mockAbandon.mockRejectedValue(new Error('nope'));
    render(<AccountRecoveryPrompt />);

    fireEvent.click(await screen.findByLabelText(/permanently discards/i));
    fireEvent.click(screen.getByRole('button', { name: /reset this device/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reset this device/i);
  });

  it('fails closed (shows recovery) when the eligibility read rejects (M-5)', async () => {
    mockActivationEligible.mockRejectedValue(new Error('read failed'));
    render(<AccountRecoveryPrompt />);

    // A failed eligibility read must not be swallowed into "eligible": surface
    // the recovery escape instead of leaving a possibly-blocked session stuck.
    expect(await screen.findByRole('dialog')).toHaveTextContent(/could not be confirmed/i);
  });
});
