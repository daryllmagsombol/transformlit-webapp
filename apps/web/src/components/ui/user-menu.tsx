'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { GraphQLUser } from '@transformlit/shared';
import { UserAvatar } from './user-avatar';
import { useAuthStore } from '../../store';
import { clearAuth } from '../../lib/auth';
import { resetApolloState } from '../../lib/apollo-client';
import { API_BASE } from '../../lib/constants';

interface UserMenuProps {
  user: GraphQLUser | null;
}

export function UserMenu({ user }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(() => setOpen(false), []);

  const handleLogout = useCallback(() => {
    handleClose();
    // Best-effort server-side session invalidation (clears the httpOnly
    // refresh cookie). Failure must not block the client-side logout.
    void (async () => {
      try {
        await fetch(`${API_BASE}/auth/logout`, {
          method: 'POST',
          credentials: 'include',
        });
      } catch {
        // Ignore: client state is cleared regardless.
      }
    })();
    clearAuth();
    useAuthStore.getState().clearAuth();
    // Reset the Apollo cache so data from this session cannot leak into the
    // next login. Best-effort: resetApolloState swallows errors and the
    // navigation below is not gated on it.
    void resetApolloState();
    router.push('/login');
  }, [handleClose, router]);

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
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
    } else if (event.key === 'ArrowUp') {
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

          <div className="my-1 border-t border-outline-variant" role="separator" />

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
    </div>
  );
}
