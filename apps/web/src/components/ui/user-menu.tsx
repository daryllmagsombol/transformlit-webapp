'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { GraphQLUser } from '@transformlit/shared';
import { UserAvatar } from './user-avatar';
import { AccountExitDialog } from '../offline/account-exit-dialog';
import {
  EMPTY_EXIT_WORK,
  beginAccountExit,
  completeAccountExit,
  readExitWork,
  type ExitWorkSummary,
} from '../../lib/offline/account-exit';

interface UserMenuProps {
  readonly user: GraphQLUser | null;
}

export function UserMenu({ user }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [exitWork, setExitWork] = useState<ExitWorkSummary>(EMPTY_EXIT_WORK);
  const [exitBusy, setExitBusy] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(() => setOpen(false), []);

  /**
   * Runs the account exit through the lifecycle gate. A controlled drain gates
   * un-synced sign-out; undrained work opens the informed dialog instead.
   */
  const runExit = useCallback(
    async (discard: boolean) => {
      setExitBusy(true);
      setExitError(null);
      try {
        const decision = await completeAccountExit(discard);
        if (decision.status === 'SYNC_REQUIRED') {
          setExitWork(await readExitWork());
          setExitError('Some changes still need to sync.');
          return;
        }
        // PROCEED, or BLOCKED/DEFERRED_LOGOUT (local UI stays signed out while
        // remote invalidation is retried) — both end at the login screen.
        router.push('/login');
      } catch {
        setExitError('Could not sign out. Please try again.');
      } finally {
        setExitBusy(false);
      }
    },
    [router],
  );

  const handleLogout = useCallback(() => {
    handleClose();
    void (async () => {
      const decision = await beginAccountExit();
      const work = await readExitWork();
      if (decision.status === 'PROCEED' || work.fullyDrained) {
        await runExit(false);
        return;
      }
      setExitWork(work);
      setExitOpen(true);
    })();
  }, [handleClose, runExit]);

  const handleSync = useCallback(() => void runExit(false), [runExit]);
  const handleConfirmDiscard = useCallback(() => void runExit(true), [runExit]);
  const handleCancelExit = useCallback(() => {
    setExitOpen(false);
    setExitError(null);
  }, []);

  // Close when the route changes so the menu doesn't persist across pages.
  useEffect(() => {
    handleClose();
  }, [pathname, handleClose]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      const clickedTrigger = triggerRef.current?.contains(target) ?? false;
      const clickedMenu = menuRef.current?.contains(target) ?? false;

      if (!clickedTrigger && !clickedMenu) {
        handleClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [open, handleClose]);

  // Close on Escape and return focus to the trigger.
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, handleClose]);

  // Move focus into the menu when opened via keyboard.
  useEffect(() => {
    if (open) {
      itemRef.current?.focus();
    }
  }, [open]);

  const handleTriggerClick = () => setOpen((prev) => !prev);

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  const handleItemKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      // Single-item menu: keep focus on the logout item.
      itemRef.current?.focus();
    }
  };

  const displayName = user?.displayName || 'User';
  const email = user?.email ?? '';

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        aria-label="User menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'user-menu' : undefined}
        className="min-w-11 min-h-11 flex items-center justify-center rounded-full hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <UserAvatar avatarUrl={user?.avatarUrl} displayName={user?.displayName} size="md" />
      </button>

      {open && (
        <div
          id="user-menu"
          ref={menuRef}
          role="menu"
          aria-label="User menu"
          className="absolute right-0 top-full mt-2 w-64 bg-surface dark:bg-surface-dark rounded-lg border border-outline-variant shadow-lg z-50 py-2"
        >
          <div className="px-3 py-2 flex items-center gap-3" role="none">
            <UserAvatar avatarUrl={user?.avatarUrl} displayName={user?.displayName} size="md" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-body font-semibold text-primary truncate">
                {displayName}
              </p>
              {email && (
                <p className="text-small text-on-surface-variant truncate">{email}</p>
              )}
            </div>
          </div>

          <hr className="my-1 border-t border-outline-variant" />

          <button
            ref={itemRef}
            type="button"
            role="menuitem"
            onClick={handleLogout}
            onKeyDown={handleItemKeyDown}
            className="w-full px-3 py-2 flex items-center gap-3 text-left text-on-surface-variant hover:bg-surface-container-high transition-colors focus:outline-none focus-visible:bg-surface-container-high cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">logout</span>
            <span className="font-body text-body">Log out</span>
          </button>
        </div>
      )}

      <AccountExitDialog
        open={exitOpen}
        work={exitWork}
        busy={exitBusy}
        error={exitError}
        onSync={handleSync}
        onConfirmDiscard={handleConfirmDiscard}
        onCancel={handleCancelExit}
      />
    </div>
  );
}
