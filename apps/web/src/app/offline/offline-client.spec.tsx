import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OfflineClient from './offline-client';

jest.mock('../../lib/offline/account-activation', () => ({
  hydrateAccountLifecycle: jest.fn().mockResolvedValue(undefined),
  accountLifecycle: () => ({ getOwner: () => null }),
}));

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

describe('OfflineClient hub', () => {
  beforeEach(() => {
    globalThis.window.location.hash = '';
  });

  it('renders the non-personalized hub without account content', async () => {
    render(<OfflineClient />);

    expect(screen.getByRole('heading', { name: 'A little room to read offline' })).toBeInTheDocument();
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
    fireEvent(globalThis.window, new Event('offline'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/offline/i));
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

  it('opens a saved book client-locally from the URL hash without an RSC transition', async () => {
    globalThis.window.location.hash = '#book/book-1/2';
    render(<OfflineClient />);

    // The hub switches to the reader surface on the client from the hash alone;
    // the library landing content is replaced without any route/RSC navigation.
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'A little room to read offline' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('link', { name: 'Return to Transform Lit' })).not.toBeInTheDocument();
  });
});
