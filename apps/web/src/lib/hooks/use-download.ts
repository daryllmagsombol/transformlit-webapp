'use client';

import { DownloadManager } from '../offline/download-manager';
import { OfflineDatabase } from '../offline/database';
import { accountLifecycle } from '../offline/account-activation';

let sharedManager: DownloadManager | null = null;

/** Shared client manager backed by Task 4 IndexedDB and the Task 13A permit. */
export function offlineDownloadManager(): DownloadManager {
  sharedManager ??= new DownloadManager({
    database: new OfflineDatabase(),
    lifecycle: {
      writePermit: () => accountLifecycle().writePermit(),
    },
  });
  return sharedManager;
}

/** Test seam: reset the lazy singleton without touching persisted records. */
export function resetOfflineDownloadManagerForTests(): void {
  sharedManager = null;
}
