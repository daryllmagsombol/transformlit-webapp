'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { useAuthStore } from '../../store';
import { UserProfileSheet } from './user-profile-sheet';

interface ProfileSheetContextType {
  openProfile: (userId: string) => void;
  closeProfile: () => void;
}

const ProfileSheetContext = createContext<ProfileSheetContextType | null>(null);

export function useProfileSheet() {
  const ctx = useContext(ProfileSheetContext);
  if (!ctx) throw new Error('useProfileSheet must be used within ProfileSheetProvider');
  return ctx;
}

export function ProfileSheetProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const currentUserId = useAuthStore((s) => s.user?.id);

  const openProfile = useCallback((id: string) => setUserId(id), []);
  const closeProfile = useCallback(() => setUserId(null), []);

  return (
    <ProfileSheetContext.Provider value={{ openProfile, closeProfile }}>
      {children}
      {userId && (
        <UserProfileSheet
          userId={userId}
          open={!!userId}
          onClose={closeProfile}
          currentUserId={currentUserId ?? ''}
        />
      )}
    </ProfileSheetContext.Provider>
  );
}
