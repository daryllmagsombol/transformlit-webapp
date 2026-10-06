'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MyProgressDocument,
  type MyProgressQuery,
  type MyProgressQueryVariables,
} from '@transformlit/graphql';
import { useUIStore } from '../../store';
import { useChatStore } from '../../store/chat-store';
import { apolloClient } from '../../lib/apollo-client';
import { NavItem } from '../ui/nav-item';
import { SIDEBAR_NAV_ITEMS } from '../../lib/constants';
import { ThemeToggle } from '../ui/theme-toggle';

type ProgressData = MyProgressQuery['myProgress'];

type ProgressState =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly progress: ProgressData };

interface ProgressCta {
  readonly label: string;
  readonly icon: string;
}

/**
 * The card's single footer action doubles as the empty-state call to action:
 * it prompts "Set a yearly goal" only once the query has confirmed there is
 * none, and otherwise reads "Track Progress". One link avoids two buttons
 * pointing at the same page, and a failed/unloaded query never falsely claims
 * the reader has no goal.
 */
function progressCta(state: ProgressState): ProgressCta {
  const hasNoGoal = state.status === 'ready' && state.progress.goal === null;
  if (hasNoGoal) {
    return { label: 'Set a yearly goal', icon: 'flag' };
  }
  return { label: 'Track Progress', icon: 'auto_stories' };
}

/**
 * Picks the rollup counter that matches the configured goal kind. Kept as a
 * module-level helper (rather than an inline nested ternary) so the read stays
 * simple and the selection can be reasoned about on its own.
 */
function selectProgressValue(progress: ProgressData): number {
  if (progress.goal?.targetKind === 'PAGES') {
    return progress.pagesRead;
  }
  return progress.daysRead;
}

/** Percentage of the yearly goal completed, capped at 100 for the bar width. */
function progressPercent(value: number, target: number): number {
  if (target <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((value / target) * 100));
}

/**
 * Loads the signed-in reader's yearly progress through the shared Apollo
 * client. A failure resolves to a neutral empty state so the query can never
 * gate or break the surrounding shell.
 */
function useYearlyProgress(): ProgressState {
  const [year] = useState(() => new Date().getFullYear());
  const [state, setState] = useState<ProgressState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    apolloClient
      .query<MyProgressQuery, MyProgressQueryVariables>({
        query: MyProgressDocument,
        variables: { year },
      })
      .then((result) => {
        if (cancelled) return;
        const progress = result.data?.myProgress;
        setState(progress ? { status: 'ready', progress } : { status: 'unavailable' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'unavailable' });
      });

    return () => {
      cancelled = true;
    };
  }, [year]);

  return state;
}

/** Placeholder that holds the card's shape while progress loads. */
function ProgressSkeleton() {
  return (
    <div aria-hidden="true" className="animate-pulse">
      <div className="flex justify-between items-end mb-2">
        <span className="font-small text-small text-on-surface-variant">Yearly Goal</span>
        <span className="h-5 w-12 rounded bg-surface-container-highest" />
      </div>
      <div className="w-full bg-surface-container-highest h-2 rounded-full" />
      <div className="mt-3 mx-auto h-6 w-24 rounded-full bg-surface-container-highest" />
    </div>
  );
}

/** Accessible goal track; width is the completion ratio. */
function ProgressBar({ percent }: { readonly percent: number }) {
  return (
    <div
      role="progressbar"
      aria-label="Yearly reading goal progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden"
    >
      <div
        className="bg-brand-orange-dark h-full rounded-full transition-all"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** Current reading streak, flame icon + readable day count. */
function StreakChip({ days }: { readonly days: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container-highest/70 px-2.5 py-1">
      <span
        className="material-symbols-outlined text-[16px] leading-none text-brand-orange-dark"
        aria-hidden="true"
      >
        local_fire_department
      </span>
      <span className="font-micro text-micro uppercase tracking-wider text-on-surface-variant">
        {days} day streak
      </span>
    </span>
  );
}

/** Shown when no goal is configured yet. */
function ProgressEmpty() {
  return (
    <div className="flex flex-col items-center gap-2 py-2 text-center">
      <span className="material-symbols-outlined text-3xl text-brand-orange-dark" aria-hidden="true">
        flag
      </span>
      <p className="font-small text-small text-on-surface-variant">
        No yearly goal set yet.
      </p>
    </div>
  );
}

/**
 * Neutral fallback when progress could not be loaded. Deliberately does NOT
 * claim the reader has no goal (that would be false); it just states the
 * status softly. The card's persistent footer link remains the recovery path,
 * so the shell is never blocked.
 */
function ProgressUnavailable() {
  return (
    <p className="font-small text-small text-on-surface-variant/80 py-2 text-center">
      Progress unavailable right now.
    </p>
  );
}

/** Goal progress block: value vs. target plus the completion bar. */
function GoalProgress({ progress }: { readonly progress: ProgressData }) {
  const goal = progress.goal;
  if (!goal) {
    return <ProgressEmpty />;
  }

  const value = selectProgressValue(progress);

  return (
    <>
      <div className="flex justify-between items-end mb-2">
        <span className="font-small text-small text-on-surface-variant">Yearly Goal</span>
        <span className="font-headline-h4 text-headline-h4 text-primary">
          {value}/{goal.targetValue}
        </span>
      </div>
      <ProgressBar percent={progressPercent(value, goal.targetValue)} />
    </>
  );
}

/** Real progress: goal block, current streak, and a closing quote. */
function ProgressReady({ progress }: { readonly progress: ProgressData }) {
  return (
    <>
      <GoalProgress progress={progress} />
      <div className="mt-3 flex justify-center">
        <StreakChip days={progress.currentStreak} />
      </div>
      <p className="font-micro text-micro text-on-surface-variant mt-3 italic text-center">
        &ldquo;Steady steps lead to deep wisdom.&rdquo;
      </p>
    </>
  );
}

function renderProgressBody(state: ProgressState) {
  if (state.status === 'ready') {
    return <ProgressReady progress={state.progress} />;
  }
  if (state.status === 'unavailable') {
    return <ProgressUnavailable />;
  }
  return <ProgressSkeleton />;
}

/** Sidebar progress card wired to the MyProgress query. */
function ProgressWidget() {
  const state = useYearlyProgress();
  const { label, icon } = progressCta(state);

  return (
    <div className="px-4 pb-4">
      <div className="bg-paper-warm/50 rounded-lg p-4 border border-outline-variant shadow-sm">
        <h3 className="font-micro text-micro uppercase tracking-widest text-on-surface-variant mb-3">
          Your Progress
        </h3>
        {renderProgressBody(state)}
        <Link
          href="/progress"
          className="mt-4 w-full min-h-11 py-2 bg-primary text-on-primary rounded-md font-display text-small font-bold flex items-center justify-center gap-2 hover:bg-brand-orange-dark transition-colors active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{icon}</span>{' '}
          {label}
        </Link>
      </div>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const totalUnread = useChatStore((s) => s.totalUnread);

  // Open sidebar on desktop, close on mobile — respond to resize across breakpoint
  useEffect(() => {
    const mq = globalThis.window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      setSidebarOpen(e.matches);
    };
    handler(mq); // set initial state
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [setSidebarOpen]);

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 bg-black/30 z-40 md:hidden cursor-default"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      )}

      <aside
        className={`fixed left-0 top-16 bottom-0 z-40 bg-surface-container-low dark:bg-surface-container-lowest
          border-r border-outline-variant
          transition-transform duration-200 ease-out
          w-[240px] flex flex-col
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          ${sidebarOpen ? 'md:translate-x-0' : 'md:-translate-x-full'}
        `}
      >
        {/* Main nav */}
        <nav className="flex flex-col gap-1 p-4 flex-1">
          {SIDEBAR_NAV_ITEMS.map((item) => (
            <NavItem
              key={item.href}
              {...item}
              active={pathname.startsWith(item.href)}
              variant="sidebar"
              badge={item.href === '/chat' ? totalUnread : undefined}
            />
          ))}
        </nav>

        {/* Progress widget */}
        <ProgressWidget />

        {/* Bottom nav */}
        <div className="border-t border-outline-variant p-4 flex flex-col gap-1">
          <Link
            href="/settings"
            className="flex items-center gap-3 px-4 py-2 text-on-surface-variant hover:bg-surface-container-highest transition-all text-micro uppercase tracking-wider"
          >
            <span className="material-symbols-outlined text-lg">settings</span>{' '}
            Settings
          </Link>
          <Link
            href="/help"
            className="flex items-center gap-3 px-4 py-2 text-on-surface-variant hover:bg-surface-container-highest transition-all text-micro uppercase tracking-wider"
          >
            <span className="material-symbols-outlined text-lg">help</span>{' '}
            Help
          </Link>
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}
