import { CURATED_TRANSLATIONS } from './config';
import { RightsBlockedError } from '../offline/contracts';

/**
 * Offline redistribution rights for a Bible translation.
 *
 * Policy (see `docs/superpowers/specs/2026-10-01-bible-offline-rights.md`):
 * storing a translation for offline use is a redistribution-plus-format act,
 * not mere quotation. A translation may only be downloaded when a
 * repository-held or supplied license record explicitly grants ALL of:
 * redistribution to end users, offline storage, and format conversion.
 *
 * UNKNOWN is the default for every translation. Unknown rights are DISABLED.
 * A provider's marketing claim of "free use" is never sufficient evidence and
 * must not be recorded here as a grant.
 */
export type RightsEvidenceState = 'DOCUMENTED' | 'UNKNOWN';

/** The three permissions that must all be granted for an offline download. */
export interface OfflineRightsGrant {
  readonly redistribution: boolean;
  readonly offlineStorage: boolean;
  readonly formatConversion: boolean;
}

export interface TranslationOfflineRights {
  readonly translationId: string;
  readonly evidence: RightsEvidenceState;
  /** Repository-held evidence reference (license file/URL); null when unknown. */
  readonly evidenceSource: string | null;
  readonly grant: OfflineRightsGrant;
  /** Required user-facing attribution; empty string means none recorded. */
  readonly attribution: string;
}

const NO_GRANT: OfflineRightsGrant = {
  redistribution: false,
  offlineStorage: false,
  formatConversion: false,
};

/**
 * Repository-held evidence registry. Deliberately empty of grants: no license
 * record currently in this repository covers offline redistribution for any
 * curated translation, so every entry is UNKNOWN and therefore disabled.
 *
 * Adding a grant requires citing a real evidence source; never infer a grant
 * from a provider's "free use" claim.
 */
const DOCUMENTED_EVIDENCE: Record<string, { source: string; grant: OfflineRightsGrant; attribution: string }> = {};

function baseRights(translationId: string): TranslationOfflineRights {
  const evidence = DOCUMENTED_EVIDENCE[translationId];
  if (!evidence) {
    return {
      translationId,
      evidence: 'UNKNOWN',
      evidenceSource: null,
      grant: NO_GRANT,
      attribution: '',
    };
  }
  return {
    translationId,
    evidence: 'DOCUMENTED',
    evidenceSource: evidence.source,
    grant: evidence.grant,
    attribution: evidence.attribution,
  };
}

/** Resolves rights by curated translation id, case-insensitively; unknown ids stay disabled. */
export function resolveOfflineRights(translationId: string): TranslationOfflineRights {
  const curated = CURATED_TRANSLATIONS.find(
    (translation) => translation.id.toLowerCase() === translationId.toLowerCase(),
  );
  if (!curated) {
    return {
      translationId,
      evidence: 'UNKNOWN',
      evidenceSource: null,
      grant: NO_GRANT,
      attribution: '',
    };
  }
  const resolved = baseRights(curated.id);
  return { ...resolved, attribution: resolved.attribution || (curated.attribution ?? '') };
}

/** True only when evidence is documented AND every required grant is present. */
export function isOfflineDownloadAllowed(rights: TranslationOfflineRights): boolean {
  return (
    rights.evidence === 'DOCUMENTED' &&
    rights.grant.redistribution &&
    rights.grant.offlineStorage &&
    rights.grant.formatConversion
  );
}

/**
 * Pure decision used by both the registry lookup and tests. Unknown evidence
 * always disables; documented evidence requires all three grants.
 */
export function evaluateOfflineRights(
  evidence: RightsEvidenceState,
  grant: OfflineRightsGrant,
): boolean {
  if (evidence !== 'DOCUMENTED') return false;
  return grant.redistribution && grant.offlineStorage && grant.formatConversion;
}

/** Convenience gate for a translation id; defaults to disabled on any doubt. */
export function canDownloadTranslationOffline(translationId: string): boolean {
  return isOfflineDownloadAllowed(resolveOfflineRights(translationId));
}

/** Throws a typed error when offline storage is not permitted for a translation. */
export function assertOfflineDownloadAllowed(translationId: string): TranslationOfflineRights {
  const rights = resolveOfflineRights(translationId);
  if (!isOfflineDownloadAllowed(rights)) {
    throw new RightsBlockedError(
      `Offline download is disabled for translation ${translationId}: redistribution/offline-storage rights are not documented`,
    );
  }
  return rights;
}

/** Required attribution text, or a generic fallback when none is recorded. */
export function requiredAttribution(translationId: string): string {
  const rights = resolveOfflineRights(translationId);
  return rights.attribution;
}
