import type { AccountOwner } from '../offline/contracts';
import { OfflineStorageError, type BibleChapterRecord } from '../offline/contracts';
import type { OfflineDatabase } from '../offline/database';
import type { BibleChapter, ChapterContent, ChapterFootnote, TranslationBook } from './types';

/**
 * Network-only Bible features. Local chapters render the saved text and local
 * navigation; audio, remote search, enrichment, and realtime require the
 * network and are reported unavailable offline.
 */
export interface BibleCapabilities {
  readonly audio: boolean;
  readonly remoteSearch: boolean;
  readonly enrichment: boolean;
  readonly realtime: boolean;
  /** Local chapter bounds are enough to step prev/next without a network call. */
  readonly navigation: boolean;
}

/** The subset of a saved chapter the reader UI renders. */
export interface OpenedChapterContent {
  readonly translation: { id: string; name: string; shortName: string };
  readonly book: TranslationBook;
  readonly number: number;
  readonly content: ChapterContent[];
  readonly footnotes: ChapterFootnote[];
}

export interface OpenedChapter {
  readonly source: 'local';
  readonly translation: string;
  readonly book: string;
  readonly chapter: number;
  readonly contentVersion: number;
  readonly translationMeta: OpenedChapterContent['translation'];
  readonly bookMeta: TranslationBook;
  readonly chapterContent: OpenedChapterContent;
  /** Chapter bounds for client-local prev/next navigation. */
  readonly navigation: { firstChapter: number; lastChapter: number };
  /** Required translation attribution text, or an empty string. */
  readonly attribution: string;
  readonly capabilities: BibleCapabilities;
}

export interface BibleRepositoryDeps {
  readonly database: OfflineDatabase;
  /** The locally established account owner; null means no private reads. */
  readonly getOwner: () => AccountOwner | null;
}

export class BibleChapterNotDownloadedError extends OfflineStorageError {
  constructor(message = 'This Bible chapter has not been downloaded for offline reading') {
    super(message);
    this.name = 'BibleChapterNotDownloadedError';
  }
}

const LOCAL_BIBLE_CAPABILITIES: BibleCapabilities = {
  audio: false,
  remoteSearch: false,
  enrichment: false,
  realtime: false,
  navigation: true,
};

function fallbackBook(record: BibleChapterRecord): TranslationBook {
  const meta = record.bookMeta;
  return {
    id: meta?.id ?? record.book,
    name: meta?.commonName ?? record.book,
    commonName: meta?.commonName ?? record.book,
    title: null,
    order: 0,
    numberOfChapters: Math.max(
      (meta?.lastChapterNumber ?? record.chapterBounds.lastChapter) -
        (meta?.firstChapterNumber ?? record.chapterBounds.firstChapter) +
        1,
      1,
    ),
    firstChapterNumber: meta?.firstChapterNumber ?? record.chapterBounds.firstChapter,
    lastChapterNumber: meta?.lastChapterNumber ?? record.chapterBounds.lastChapter,
    totalNumberOfVerses: 0,
  };
}

/**
 * Application-level Bible reader. It resolves a saved chapter from the Task 6
 * stored records (text + provider payload + navigation metadata) without any
 * network request, so a downloaded chapter opens after a cold offline restart.
 */
export class BibleRepository {
  private readonly database: OfflineDatabase;
  private readonly getOwner: () => AccountOwner | null;

  constructor(deps: BibleRepositoryDeps) {
    this.database = deps.database;
    this.getOwner = deps.getOwner;
  }

  async openChapter(translation: string, book: string, chapter: number): Promise<OpenedChapter> {
    const owner = this.getOwner();
    if (!owner) throw new BibleChapterNotDownloadedError('No local account owns this chapter');

    const record = await this.database.getBibleChapter(owner.subject, translation, book, chapter);
    if (!record) throw new BibleChapterNotDownloadedError(`Chapter ${translation}/${book}/${chapter} is not saved`);

    const payload = record.payload as BibleChapter | null;
    if (!payload?.chapter || !Array.isArray(payload.chapter.content)) {
      throw new BibleChapterNotDownloadedError('Stored chapter payload is incomplete');
    }

    const translationMeta = record.translationMeta ?? payload.translation;
    const bookMeta = payload.book ?? fallbackBook(record);
    const navigation = {
      firstChapter: record.chapterBounds.firstChapter,
      lastChapter: record.chapterBounds.lastChapter,
    };

    return {
      source: 'local',
      translation,
      book,
      chapter,
      contentVersion: record.contentVersion,
      translationMeta,
      bookMeta,
      chapterContent: {
        translation: translationMeta,
        book: bookMeta,
        number: payload.chapter.number,
        content: payload.chapter.content,
        footnotes: payload.chapter.footnotes ?? [],
      },
      navigation,
      attribution: record.attribution,
      capabilities: LOCAL_BIBLE_CAPABILITIES,
    };
  }
}
