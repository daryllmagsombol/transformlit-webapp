import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OfflineClient from './offline-client';

type InstallPromptEvent = Event & {
  prompt: jest.Mock<Promise<void>, []>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function createInstallPrompt(): InstallPromptEvent {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as InstallPromptEvent;
  event.prompt = jest.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
  return event;
}

describe('OfflineClient', () => {
  it('shows a generic offline status and honest saving guidance without account content', () => {
    render(<OfflineClient />);

    expect(screen.getByRole('heading', { name: 'A little room to read offline' })).toBeInTheDocument();
    expect(screen.getByText(/save reading for offline use once that capability is available/i)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/saved for you|hello,|your bookshelf/i);
    expect(screen.getByText('A quieter place to return to')).toHaveClass('text-on-surface-variant');
    expect(screen.getByRole('link', { name: 'Return to Transform Lit' })).toHaveClass(
      'text-primary',
      'hover:bg-surface-container-high',
    );
    expect(screen.getByRole('status')).toHaveClass('bg-surface-container', 'text-on-surface');
  });

  it('reports online and offline changes accessibly', async () => {
    render(<OfflineClient />);

    fireEvent(globalThis.window, new Event('online'));
    expect(screen.getByRole('status')).toHaveTextContent(/online/i);
    expect(screen.getByRole('status')).toHaveClass('bg-surface-container', 'text-on-surface');
    fireEvent(globalThis.window, new Event('offline'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/offline/i));
    expect(screen.getByRole('status')).toHaveClass('bg-surface-container', 'text-on-surface');
  });

  it('offers the native install prompt when the browser provides it', async () => {
    const event = createInstallPrompt();
    render(<OfflineClient />);
    fireEvent(globalThis.window, event);

    const installButton = await screen.findByRole('button', { name: /install transform lit/i });
    fireEvent.click(installButton);

    await waitFor(() => expect(event.prompt).toHaveBeenCalledTimes(1));
  });

  it('provides honest install guidance when native prompting is unavailable', () => {
    render(<OfflineClient />);

    expect(screen.getByText(/use your browser menu to add this page to your home screen/i)).toBeVisible();
  });
});
