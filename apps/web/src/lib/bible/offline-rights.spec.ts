import {
  assertOfflineDownloadAllowed,
  canDownloadTranslationOffline,
  evaluateOfflineRights,
  isOfflineDownloadAllowed,
  requiredAttribution,
  resolveOfflineRights,
} from './offline-rights';
import { RightsBlockedError } from '../offline/contracts';

describe('bible offline rights', () => {
  it('defaults every curated translation to unknown and therefore disabled', () => {
    for (const id of ['BSB', 'ENGWEBP', 'eng_kjv', 'eng_asv', 'eng_web', 'tgl_ulb']) {
      const rights = resolveOfflineRights(id);
      expect(rights.evidence).toBe('UNKNOWN');
      expect(rights.evidenceSource).toBeNull();
      expect(isOfflineDownloadAllowed(rights)).toBe(false);
      expect(canDownloadTranslationOffline(id)).toBe(false);
    }
  });

  it('treats an unrecognized translation as disabled', () => {
    expect(canDownloadTranslationOffline('does-not-exist')).toBe(false);
    expect(resolveOfflineRights('does-not-exist').evidence).toBe('UNKNOWN');
  });

  it('never enables a translation merely because a provider claims free use', () => {
    // No grant is recorded for any curated translation; a "free use" claim is
    // not evidence and cannot flip the gate.
    expect(resolveOfflineRights('BSB').grant.redistribution).toBe(false);
    expect(canDownloadTranslationOffline('BSB')).toBe(false);
  });

  it('resolves case-insensitively to the curated id', () => {
    expect(resolveOfflineRights('eng_kjv').translationId).toBe('eng_kjv');
    expect(resolveOfflineRights('ENG_KJV').translationId).toBe('eng_kjv');
  });

  it('requires documented evidence AND all three grants', () => {
    const full = { redistribution: true, offlineStorage: true, formatConversion: true };
    expect(evaluateOfflineRights('DOCUMENTED', full)).toBe(true);
    expect(evaluateOfflineRights('UNKNOWN', full)).toBe(false);
    expect(evaluateOfflineRights('DOCUMENTED', { ...full, redistribution: false })).toBe(false);
    expect(evaluateOfflineRights('DOCUMENTED', { ...full, offlineStorage: false })).toBe(false);
    expect(evaluateOfflineRights('DOCUMENTED', { ...full, formatConversion: false })).toBe(false);
  });

  it('throws a typed rights error for a blocked translation', () => {
    expect(() => assertOfflineDownloadAllowed('BSB')).toThrow(RightsBlockedError);
  });

  it('reports required attribution per translation (empty when none is recorded)', () => {
    expect(requiredAttribution('BSB')).toBe('');
  });
});
