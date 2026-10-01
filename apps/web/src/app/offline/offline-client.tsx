'use client';

import { useEffect, useState } from 'react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function isInstallPromptEvent(event: Event): event is InstallPromptEvent {
  return 'prompt' in event && typeof event.prompt === 'function' && 'userChoice' in event;
}

function connectionLabel(isOnline: boolean | null): string {
  if (isOnline === null) return 'Checking connection';
  if (isOnline) return 'You’re online';
  return 'You’re offline';
}

export default function OfflineClient() {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installMessage, setInstallMessage] = useState('Use your browser menu to add this page to your home screen.');

  useEffect(() => {
    const browser = globalThis.window;
    setIsOnline(browser.navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleInstallAvailable = (event: Event) => {
      if (!isInstallPromptEvent(event)) return;
      event.preventDefault();
      setInstallPrompt(event);
    };

    browser.addEventListener('online', handleOnline);
    browser.addEventListener('offline', handleOffline);
    browser.addEventListener('beforeinstallprompt', handleInstallAvailable);

    return () => {
      browser.removeEventListener('online', handleOnline);
      browser.removeEventListener('offline', handleOffline);
      browser.removeEventListener('beforeinstallprompt', handleInstallAvailable);
    };
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallMessage(choice.outcome === 'accepted'
      ? 'Transform Lit was added to your home screen.'
      : 'No problem. You can install Transform Lit later from your browser menu.');
    setInstallPrompt(null);
  };

  const statusLabel = connectionLabel(isOnline);

  return (
    <main className="min-h-dvh px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-5xl flex-col">
        <header className="flex items-center justify-between gap-4">
          <a href="/" className="inline-flex min-h-11 items-center gap-3 rounded-lg text-on-surface focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
            <span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-primary text-on-primary shadow-sm">
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 6.5c-2.2-1.7-5-2-8-1.2v12.2c3-.8 5.8-.5 8 1.2 2.2-1.7 5-2 8-1.2V5.3c-3-.8-5.8-.5-8 1.2Z" />
                <path d="M12 6.5v12.2" />
              </svg>
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">Transform Lit</span>
          </a>
          <span aria-live="polite" role="status" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-4 font-small text-sm font-medium text-on-surface">
            <span aria-hidden="true" className={`size-2 rounded-full ${isOnline === false ? 'bg-outline' : 'bg-secondary'}`} />
            {statusLabel}
          </span>
        </header>

        <section className="grid flex-1 items-center gap-12 py-16 md:grid-cols-[1.05fr_0.95fr] md:gap-16 md:py-20">
          <div className="max-w-xl">
            <p className="mb-5 font-small text-xs font-semibold uppercase tracking-[0.2em] text-on-surface-variant">A quieter place to return to</p>
            <h1 className="max-w-lg font-display text-4xl font-semibold leading-[1.08] tracking-[-0.045em] text-on-surface sm:text-5xl md:text-6xl">
              A little room to read offline
            </h1>
            <p className="mt-6 max-w-prose font-body text-xl leading-relaxed text-on-surface-variant sm:text-2xl">
              Take a breath. Your reading can travel with you when offline reading becomes available.
            </p>
            <div className="mt-9 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              {installPrompt ? (
                <button type="button" onClick={handleInstall} className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-6 py-3 font-small text-sm font-semibold text-on-primary shadow-sm transition-colors hover:bg-primary-container hover:text-on-primary-container focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary motion-reduce:transition-none">
                  Install Transform Lit
                </button>
              ) : (
                <p className="max-w-sm rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 font-small text-sm leading-relaxed text-on-surface-variant">
                  {installMessage}
                </p>
              )}
              <a href="/" className="inline-flex min-h-11 items-center justify-center rounded-full px-5 py-3 font-small text-sm font-semibold text-primary underline decoration-primary/50 underline-offset-4 transition-colors hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary motion-reduce:transition-none">
                Return to Transform Lit
              </a>
            </div>
          </div>

          <aside aria-label="About offline reading" className="relative mx-auto w-full max-w-md md:justify-self-end">
            <div aria-hidden="true" className="absolute -right-4 -top-5 size-24 rounded-full bg-primary-fixed/70 blur-2xl sm:-right-8 sm:-top-8 sm:size-40" />
            <div className="relative overflow-hidden rounded-[2rem] border border-outline-variant/80 bg-surface-container-low p-6 shadow-[0_24px_70px_-36px_rgba(56,38,19,0.42)] sm:p-8">
              <div className="flex items-start justify-between">
                <span className="font-small text-xs font-semibold uppercase tracking-[0.18em] text-on-surface-variant">Reading, at your pace</span>
                <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-primary-fixed text-on-primary-fixed">
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 4.5h10a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3v-12Z" />
                    <path d="M8 19.5a3 3 0 0 1 0-6h10M9 8h5M9 11h3" />
                  </svg>
                </span>
              </div>
              <div className="my-8 h-px bg-outline-variant" />
              <h2 className="font-body text-2xl leading-snug text-on-surface sm:text-3xl">
                A page for the words worth returning to.
              </h2>
              <p className="mt-5 font-small text-sm leading-relaxed text-on-surface-variant">
                Save reading for offline use once that capability is available. This page is a simple starting point, not a list of saved books.
              </p>
              <div className="mt-8 flex items-center gap-3 border-t border-outline-variant pt-5">
                <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-secondary-container text-on-secondary-container">
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v2m0 14v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M3 12h2m14 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
                    <circle cx="12" cy="12" r="4" />
                  </svg>
                </span>
                <p className="font-small text-sm text-on-surface-variant">Your reading journey, without the rush.</p>
              </div>
            </div>
          </aside>
        </section>

        <footer className="flex flex-col gap-2 border-t border-outline-variant/70 py-5 font-small text-xs text-on-surface-variant sm:flex-row sm:items-center sm:justify-between">
          <span>Transform Lit · Read with purpose.</span>
          <span>Offline reading features are still on the way.</span>
        </footer>
      </div>
    </main>
  );
}
