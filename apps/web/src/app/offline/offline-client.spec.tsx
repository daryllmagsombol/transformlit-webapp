import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OfflineClient from './offline-client';
import { hydrateAccountLifecycle } from '../../lib/offline/account-activation';
import { OfflineDatabase } from '../../lib/offline/database';
import { BookRepository } from '../../lib/reader/repository';
import { BibleRepository } from '../../lib/bible/repository';
import type { AccountOwner, BookVersionRecord, BookPageRecord } from '../../lib/offline/contracts';

let mockOwner: AccountOwner | null = null;

jest.mock('../../lib/offline/account-activation', () => ({
  hydrateAccountLifecycle: jest.fn().mockResolvedValue(undefined),
  accountLifecycle: () => ({ getOwner: () => mockOwner }),
}));

jest.mock('../../components/reader/book-reader-view', () => ({
  BookReaderView: ({ title, page }: { readonly title: string; readonly page: number }) => (
    <h1>{title} · Page {page}</h1>
  ),
}));

const OWNER: AccountOwner = { subject: 'subject-a', epoch: 1 };
const VERSION: BookVersionRecord = {
  id: 'version-1', subject: OWNER.subject, bookId: 'book-1', contentVersion: 1,
  status: 'READY', active: true, title: 'Stored Book', author: null, description: null,
  coverAssetId: null, totalPages: 2, toc: [], provenance: 'offline-manifest', createdAt: 1,
};
const PAGES: BookPageRecord[] = [1, 2].map((pageNumber) => ({
  id: `page-${pageNumber}`, subject: OWNER.subject, bookId: 'book-1', contentVersion: 1,
  pageNumber, imageAssetId: `image-${pageNumber}`, textLayerAssetId: `text-${pageNumber}`,
  image: new Blob(['frame'], { type: 'image/png' }), text: null, textItems: null, verified: true,
}));

function deferHydration() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  jest.mocked(hydrateAccountLifecycle).mockReturnValue(promise);
  return async (owner: AccountOwner | null) => {
    await act(async () => {
      mockOwner = owner;
      resolve();
      await promise;
    });
  };
}

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
    globalThis.window.history.replaceState(null, '', '/offline');
    mockOwner = null;
    jest.mocked(hydrateAccountLifecycle).mockReset().mockResolvedValue(undefined);
    jest.spyOn(OfflineDatabase.prototype, 'listDownloadManifests').mockResolvedValue([]);
    jest.spyOn(OfflineDatabase.prototype, 'getActiveBookVersion').mockResolvedValue(VERSION);
    jest.spyOn(OfflineDatabase.prototype, 'getBookPages').mockResolvedValue(PAGES);
    jest.spyOn(OfflineDatabase.prototype, 'getBibleChapter').mockResolvedValue(null);
    globalThis.URL.createObjectURL = jest.fn().mockReturnValue('blob:saved-page');
    globalThis.URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  it.each(['initial hash', 'immediate hashchange'])('waits for restored ownership before opening a book from %s', async (navigation) => {
    const completeHydration = deferHydration();
    const open = jest.spyOn(BookRepository.prototype, 'open');
    if (navigation === 'initial hash') {
      globalThis.window.history.replaceState(null, '', '/offline#book/book-1/2');
    }
    render(<OfflineClient />);
    if (navigation === 'immediate hashchange') {
      globalThis.window.history.replaceState(null, '', '/offline#book/book-1/2');
      fireEvent(globalThis.window, new Event('hashchange'));
    }

    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await completeHydration(OWNER);

    expect(await screen.findByRole('heading', { name: 'Stored Book · Page 2' })).toBeVisible();
    expect(open).toHaveBeenCalledWith('book-1', undefined, { localOnly: true });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Return to Transform Lit' })).not.toBeInTheDocument();
  });

  it('waits for hydration before opening a Bible chapter', async () => {
    const completeHydration = deferHydration();
    const open = jest.spyOn(BibleRepository.prototype, 'openChapter');
    globalThis.window.history.replaceState(null, '', '/offline#bible/WEB/GEN/1');
    render(<OfflineClient />);

    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await completeHydration(OWNER);

    expect(await screen.findByRole('alert')).toHaveTextContent('This chapter has not been saved for offline reading.');
    expect(open).toHaveBeenCalledWith('WEB', 'GEN', 1);
  });

  it.each(['#book/book-1/2', '#bible/WEB/GEN/1'])('fails closed after signed-out restoration for %s', async (hash) => {
    const completeHydration = deferHydration();
    const openBook = jest.spyOn(BookRepository.prototype, 'open');
    const openBible = jest.spyOn(BibleRepository.prototype, 'openChapter');
    globalThis.window.history.replaceState(null, '', `/offline${hash}`);
    render(<OfflineClient />);
    await completeHydration(null);

    expect(await screen.findByText('Sign in while online to save reading for offline use.')).toBeVisible();
    expect(openBook).not.toHaveBeenCalled();
    expect(openBible).not.toHaveBeenCalled();
  });

  it('fails closed when hydration rejects even if an in-memory owner exists', async () => {
    mockOwner = OWNER;
    jest.mocked(hydrateAccountLifecycle).mockRejectedValue(new Error('Restoration failed'));
    const open = jest.spyOn(BookRepository.prototype, 'open');
    globalThis.window.history.replaceState(null, '', '/offline#book/book-1/2');
    render(<OfflineClient />);

    expect(await screen.findByText('Sign in while online to save reading for offline use.')).toBeVisible();
    expect(open).not.toHaveBeenCalled();
  });

  it('still reports a genuinely incomplete download after ownership is restored', async () => {
    const completeHydration = deferHydration();
    jest.spyOn(OfflineDatabase.prototype, 'getBookPages').mockResolvedValue([PAGES[0]]);
    globalThis.window.history.replaceState(null, '', '/offline#book/book-1/2');
    render(<OfflineClient />);
    await completeHydration(OWNER);

    expect(await screen.findByRole('alert')).toHaveTextContent('This download is incomplete or no longer available.');
    expect(screen.queryByRole('heading', { name: /Stored Book/ })).not.toBeInTheDocument();
  });
});
