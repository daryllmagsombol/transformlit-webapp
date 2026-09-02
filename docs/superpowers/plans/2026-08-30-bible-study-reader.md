# Bible Study Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full study Bible reader to Transformlit — translation picker, chapter reader, footnotes, cross-references, Strong's word study (ENGWEBP), audio, and client-side full-text search — as a new top-level "Bible" nav item.

**Architecture:** Client-side data layer over the key-less Free Use Bible API (`https://bible.helloao.org/api`, ETag-cacheable, CORS-friendly). Plain `fetch` wrapper + hand-written TS types (no SDK dependency), L1 in-memory ETag cache + IndexedDB persistence. Search builds a compact corpus from `complete.json` lazily in a Web Worker, stored in IndexedDB, substring-scanned. Two routes: `/bible` (library + search modes, one screen) and `/bible/[translation]/[book]/[chapter]` (reader). Study features consolidate into one per-verse Study Sheet (bottom sheet mobile / right drawer desktop).

**API facts (live-verified during plan review):** chapter/books responses carry `ETag` headers; `If-None-Match` revalidation returns **304**; CORS is `access-control-allow-origin: *`; `cache-control: max-age=86400`. Translation ids are **mixed-case** (`BSB`, `ENGWEBP` uppercase; `eng_kjv`, `eng_asv`, `eng_web`, `tgl_ulb` lowercase) — always canonicalize via case-insensitive lookup, never `.toUpperCase()` a translation id. Book ids are uppercase USFM (`GEN`, `ROM`).

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, Tailwind CSS v4 (CSS-first tokens), Zustand 5 (persist), motion v13 (Sheet primitive), Jest + Testing Library (colocated `*.spec.tsx`), Playwright (e2e). No new runtime dependencies.

**Spec:** Design specs in Stitch ("TransformLit Community Hub" project — Bible Library, Chapter Reader v2, Verse Study Sheet, Translation Picker, Book & Chapter Picker, Bible Search States, each with light + dark variants) validated by senior architecture review. API reference: https://bible.helloao.org/docs/reference/

## Global Constraints

- **No new dependencies.** Repo policy: don't add deps unless asked. Use `fetch`, hand-rolled IndexedDB kv, motion (already a dep).
- **Follow page conventions:** server `page.tsx` thin wrapper (exports `metadata`) → `'use client'` component; `useRequireAuth()` → `isReady` gate; `addToast` for errors; `SkeletonCard`/`LoadingSpinner` for loading (see `apps/web/src/app/(app)/feed/feed-client.tsx`).
- **Dark mode ready:** use existing tokens (`bg-surface`, `dark:bg-surface-raised`, etc.). Add the two semantic token pairs from the validation (`--color-verse-number`, `--color-footnote-marker`) in `globals.css` first — no per-component `dark:` color sprinkles for these.
- **44px touch-target rule** (`globals.css:223-225`) applies to all `button/a/input/select/textarea`. Inline verse numbers and footnote markers MUST use the `.inline-target { min-height: 0 }` opt-out (Task 1) as real `<button>` elements, never `onClick` spans.
- **Jest coverage thresholds:** lines 70 / branches 60 / functions 70 / statements 70 (`apps/web/jest.config.ts`). Pure logic (refs, words, search matcher, api) gets real unit tests; components get render tests.
- **`ignoreBuildErrors: true`** in next config — jest specs are the only behavior gate for worker/build code. Write them.
- **TypeScript strict** — no `any` leaks in the new `lib/bible` layer.
- **Bible API standard format only** (not `.simple.json`) — `words.json` offsets align with the standard content array.
- **Naming:** translation IDs are uppercase API ids (`BSB`, `ENGWEBP`, `eng_kjv`, `tgl_ulb`); book ids are USFM (`GEN`, `ROM`); canonical URL casing uppercase — normalize in the server wrapper.
- **Copy:** user-facing strings in plain English (or Tagalog names as-is: "Banal na Bibliya"). No marketing fluff.

---

## File Structure

```
apps/web/src/
├── app/(app)/bible/
│   ├── page.tsx                          # /bible — metadata + <Suspense><BibleClient/></Suspense>
│   ├── bible-client.tsx                  # library: translation chip, continue-reading, quick tracks, browse + search modes
│   ├── [translation]/page.tsx            # redirect → /bible?translation=X
│   └── [translation]/[book]/[chapter]/
│       ├── page.tsx                      # await params, normalize, generateMetadata
│       └── bible-reader-client.tsx       # reader orchestration
├── components/bible/
│   ├── index.ts                          # barrel
│   ├── translation-picker.tsx            # Modal: curated EN + Tagalog list, badges
│   ├── book-grid.tsx                     # OT/NT sections + book cards
│   ├── book-chapter-picker.tsx           # Modal: book list → chapter grid
│   ├── verse-list.tsx                    # renders ChapterContent[] (headings, poetry, wordsOfJesus, markers)
│   ├── study-sheet.tsx                   # Sheet: footnotes + cross-refs + word study + actions
│   ├── cross-ref-list.tsx                # reference chips → reader links
│   ├── word-study-popover.tsx            # lemma/strongs/morph card
│   ├── audio-player.tsx                  # standalone mini player
│   ├── search-panel.tsx                  # input + index progress + results
│   ├── search-result-item.tsx            # ref + highlighted snippet
│   └── chapter-nav.tsx                   # prev/next footer
├── components/ui/
│   └── sheet.tsx                         # NEW: motion bottom-sheet / right-drawer primitive
├── lib/bible/
│   ├── types.ts                          # hand-written API subset types
│   ├── config.ts                         # BIBLE_API_BASE, curated translations, book-name map
│   ├── api.ts                            # fetchBible<T> + ETag L1 cache + typed getters
│   ├── storage.ts                        # KVStore interface + IndexedDB impl + prefs (DI/mockable)
│   ├── refs.ts                           # next/prev chapter, formatRef, refToHref (pure)
│   ├── words.ts                          # words.json offset mapping (pure, tests-first)
│   └── search/
│       ├── build-index.ts                # pure: complete.json → compact corpus
│       ├── matcher.ts                    # pure: corpus + query → results
│       ├── search-worker.ts              # worker transport (build/search messages)
│       └── client.ts                     # SearchClient: worker lifecycle + fallback
├── lib/hooks/
│   ├── use-bible-books.ts
│   ├── use-chapter.ts
│   ├── use-cross-references.ts
│   └── use-bible-search.ts
└── store/bible-store.ts                  # zustand persist: translation, last position, index status
```

---

### Task 1: Dark-safe token pairs + `.inline-target` opt-out (globals.css)

**Files:**
- Modify: `apps/web/src/styles/globals.css` (@theme block ~line 95, `.dark` block ~line 198, utilities ~line 235)

**Interfaces:**
- Produces: CSS custom properties `--color-verse-number`, `--color-footnote-marker` (light + `.dark` values); utility class `.inline-target`.

- [ ] **Step 1: Add the two token pairs to `@theme`**

In `globals.css` inside the `@theme { }` block, right after the `--color-accent-teal-dark` line (~line 88):

```css
  /* ── Bible reader semantic tokens ─────────────────────── */
  --color-verse-number: #165E55;      /* accent-teal-dark: ≥4.5:1 on paper */
  --color-footnote-marker: #A05B00;   /* dark orange: ≥4.5:1 on paper */
```

- [ ] **Step 2: Add `.dark` overrides**

In the `.dark { }` block, after the `--color-border` line (~line 204):

```css
  --color-verse-number: #3AAD99;      /* accent-teal-light: bright on dark */
  --color-footnote-marker: #ffb95c;   /* primary-fixed-dim: bright on dark */
```

- [ ] **Step 3: Add `.inline-target` utility**

In the Utilities section (~line 235), after `.text-balance`:

```css
/* Opt out of the 44px touch-target min-height for inline elements
   (superscript verse numbers, footnote markers inside text) */
.inline-target { min-height: 0; }
```

- [ ] **Step 4: Verify build**

Run: `pnpm --filter @transformlit/web build`
Expected: build succeeds; no Tailwind errors for the new tokens.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/styles/globals.css
git commit -m "feat(bible): add dark-safe verse/footnote tokens and inline-target utility"
```

---

### Task 2: Nav wiring — "Bible" item after Feed (3 files, one change)

**Files:**
- Modify: `apps/web/src/lib/constants.ts:79-86` (SIDEBAR_NAV_ITEMS)
- Modify: `apps/web/src/components/layout/topbar.tsx:10-15` (NAV_LINKS)
- Modify: `apps/web/src/lib/constants.spec.ts:14,23-26` (assertions)

**Interfaces:**
- Consumes: nothing.
- Produces: `SIDEBAR_NAV_ITEMS` with `{ label: 'Bible', href: '/bible', icon: 'auto_stories' }` second; `BOTTOM_NAV_ITEMS` inherits automatically.

- [ ] **Step 1: Update the failing spec first**

In `apps/web/src/lib/constants.spec.ts`:

```ts
  it('has the expected number of items', () => {
    expect(SIDEBAR_NAV_ITEMS).toHaveLength(5);
  });

  it('contains Feed, Bible, Friends, Groups, and Books', () => {
    const labels = SIDEBAR_NAV_ITEMS.map((i) => i.label);
    expect(labels).toEqual(['Feed', 'Bible', 'Friends', 'Groups', 'Books']);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @transformlit/web test -- lib/constants.spec.ts`
Expected: FAIL (length 4 ≠ 5; labels mismatch).

- [ ] **Step 3: Update constants.ts**

```ts
export const SIDEBAR_NAV_ITEMS = [
  { label: 'Feed', href: '/feed', icon: 'dynamic_feed' },
  { label: 'Bible', href: '/bible', icon: 'auto_stories' },
  { label: 'Friends', href: '/friends', icon: 'group' },
  { label: 'Groups', href: '/groups', icon: 'diversity_3' },
  { label: 'Books', href: '/books', icon: 'menu_book' },
] as const;
```

- [ ] **Step 4: Update topbar.tsx NAV_LINKS**

```ts
const NAV_LINKS = [
  { label: 'Feed', href: '/feed' },
  { label: 'Bible', href: '/bible' },
  { label: 'Friends', href: '/friends' },
  { label: 'Library', href: '/books' },
  { label: 'Community', href: '/groups' },
] as const;
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @transformlit/web test`
Expected: PASS (all specs, including updated constants.spec.ts).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/constants.ts apps/web/src/lib/constants.spec.ts apps/web/src/components/layout/topbar.tsx
git commit -m "feat(bible): add Bible nav item to sidebar, bottom nav, and topbar"
```

---

### Task 3: `lib/bible/types.ts` — API subset types

**Files:**
- Create: `apps/web/src/lib/bible/types.ts`
- Test: `apps/web/src/lib/bible/types.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TranslationBook`, `BibleChapter`, `ChapterContent` (discriminated union), `FormattedText`, `InlineHeading`, `InlineLineBreak`, `VerseFootnoteReference`, `ChapterFootnote`, `ChapterWords`, `ChapterWord`, `CrossRefChapter`, `CrossRefVerse`, `CrossRefReference`, `CompleteTranslation`, `CompleteBook`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/bible/types.spec.ts`:

```ts
import type {
  ChapterContent,
  FormattedText,
  VerseFootnoteReference,
} from './types';

describe('bible types', () => {
  it('discriminates chapter content by type', () => {
    const heading: ChapterContent = { type: 'heading', content: ['The Creation'] };
    const verse: ChapterContent = { type: 'verse', number: 1, content: ['In the beginning…'] };
    expect(heading.type).toBe('heading');
    expect(verse.type).toBe('verse');
  });

  it('typed-formatted text and footnote reference members exist', () => {
    const formatted: FormattedText = { text: 'God said', wordsOfJesus: true };
    const ref: VerseFootnoteReference = { noteId: 0 };
    expect(formatted.wordsOfJesus).toBe(true);
    expect(ref.noteId).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @transformlit/web test -- lib/bible/types.spec.ts`
Expected: FAIL — cannot find module './types'.

- [ ] **Step 3: Write the types**

Create `apps/web/src/lib/bible/types.ts`:

```ts
/** Subset types for the Free Use Bible API (bible.helloao.org). Standard format only. */

export interface TranslationBook {
  id: string;
  name: string;
  commonName: string;
  title: string | null;
  order: number;
  numberOfChapters: number;
  firstChapterNumber: number;
  lastChapterNumber: number;
  totalNumberOfVerses: number;
  isApocryphal?: boolean;
}

export interface FormattedText {
  text: string;
  poem?: number;
  wordsOfJesus?: boolean;
}

export interface InlineHeading {
  heading: string;
}

export interface InlineLineBreak {
  lineBreak: true;
}

export interface VerseFootnoteReference {
  noteId: number;
}

export type ChapterContent =
  | { type: 'heading'; content: string[] }
  | { type: 'line_break' }
  | { type: 'hebrew_subtitle'; content: (string | FormattedText | VerseFootnoteReference)[] }
  | {
      type: 'verse';
      number: number;
      content: (string | FormattedText | InlineHeading | InlineLineBreak | VerseFootnoteReference)[];
    };

export interface ChapterFootnote {
  noteId: number;
  text: string;
  caller: '+' | string | null;
  reference?: { chapter: number; verse: number };
}

export interface BibleChapter {
  translation: { id: string; name: string; shortName: string };
  book: TranslationBook;
  thisChapterLink: string;
  nextChapterApiLink: string | null;
  previousChapterApiLink: string | null;
  thisChapterAudioLinks?: Record<string, string>;
  thisChapterWordsLink?: string;
  numberOfVerses: number;
  chapter: { number: number; content: ChapterContent[]; footnotes: ChapterFootnote[] };
}

export interface ChapterWord {
  contentIndex: number;
  start: number;
  end: number;
  strongs?: string[];
  lemma?: string;
  morph?: string;
  srcloc?: string;
}

export interface ChapterWords {
  verses: Record<string, ChapterWord[]>;
}

export interface CrossRefReference {
  book: string;
  chapter: number;
  verse: number;
  endVerse?: number;
  score?: number;
}

export interface CrossRefVerse {
  verse: number;
  references: CrossRefReference[];
}

export interface CrossRefChapter {
  chapter: { number: number; content: CrossRefVerse[] };
}

export interface CompleteBook {
  id: string;
  commonName: string;
  order: number;
  numberOfChapters: number;
  totalNumberOfVerses: number;
  chapters: { chapter: { number: number; content: ChapterContent[] } }[];
}

export interface CompleteTranslation {
  translation: { id: string; name: string; shortName: string };
  books: CompleteBook[];
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @transformlit/web test -- lib/bible/types.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/bible/types.ts apps/web/src/lib/bible/types.spec.ts
git commit -m "feat(bible): add Free Use Bible API subset types"
```

---

### Task 4: `lib/bible/config.ts` — curated translations + book metadata

**Files:**
- Create: `apps/web/src/lib/bible/config.ts`
- Test: `apps/web/src/lib/bible/config.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BIBLE_API_BASE`, `DEFAULT_TRANSLATION = 'BSB'`, `CURATED_TRANSLATIONS` (array of `{ id, label, language: 'English' | 'Tagalog', hasWords, hasAudio }`), `BOOK_NAMES` (USFM id → common name for metadata before fetch), `OT_BOOK_COUNT = 39`, `QUICK_TRACKS` (array of `{ label, book, chapter }` for Romans 12 / Proverbs 12 / Matthew 5).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/bible/config.spec.ts`:

```ts
import { CURATED_TRANSLATIONS, DEFAULT_TRANSLATION, OT_BOOK_COUNT, QUICK_TRACKS, BOOK_NAMES } from './config';

describe('bible config', () => {
  it('defaults to BSB', () => {
    expect(DEFAULT_TRANSLATION).toBe('BSB');
  });

  it('curates the expected translations', () => {
    const ids = CURATED_TRANSLATIONS.map((t) => t.id);
    expect(ids).toEqual(['BSB', 'ENGWEBP', 'eng_kjv', 'eng_asv', 'eng_web', 'tgl_ulb']);
  });

  it('flags ENGWEBP as the word-studies translation', () => {
    const webp = CURATED_TRANSLATIONS.find((t) => t.id === 'ENGWEBP');
    expect(webp?.hasWords).toBe(true);
  });

  it('groups the Tagalog translation', () => {
    expect(CURATED_TRANSLATIONS.find((t) => t.id === 'tgl_ulb')?.language).toBe('Tagalog');
  });

  it('knows the OT/NT boundary', () => {
    expect(OT_BOOK_COUNT).toBe(39);
  });

  it('has quick tracks for Romans 12, Proverbs 12, Matthew 5', () => {
    expect(QUICK_TRACKS).toEqual([
      { label: 'Romans 12', book: 'ROM', chapter: 12 },
      { label: 'Proverbs 12', book: 'PRO', chapter: 12 },
      { label: 'Matthew 5', book: 'MAT', chapter: 5 },
    ]);
  });

  it('maps Genesis and Romans in BOOK_NAMES', () => {
    expect(BOOK_NAMES.GEN).toBe('Genesis');
    expect(BOOK_NAMES.ROM).toBe('Romans');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @transformlit/web test -- lib/bible/config.spec.ts`
Expected: FAIL — cannot find module './config'.

- [ ] **Step 3: Write the config**

Create `apps/web/src/lib/bible/config.ts`:

```ts
export const BIBLE_API_BASE = 'https://bible.helloao.org/api';

export const DEFAULT_TRANSLATION = 'BSB';

export interface CuratedTranslation {
  id: string;
  label: string;
  language: 'English' | 'Tagalog';
  hasWords: boolean;
  hasAudio: boolean;
}

export const CURATED_TRANSLATIONS: CuratedTranslation[] = [
  { id: 'BSB', label: 'Berean Standard Bible', language: 'English', hasWords: false, hasAudio: true },
  { id: 'ENGWEBP', label: 'World English Bible', language: 'English', hasWords: true, hasAudio: false },
  { id: 'eng_kjv', label: 'King James Version', language: 'English', hasWords: false, hasAudio: false },
  { id: 'eng_asv', label: 'American Standard Version (1901)', language: 'English', hasWords: false, hasAudio: false },
  { id: 'eng_web', label: 'World English Bible Classic', language: 'English', hasWords: false, hasAudio: false },
  { id: 'tgl_ulb', label: 'Banal na Bibliya', language: 'Tagalog', hasWords: false, hasAudio: false },
];

export function getCuratedTranslation(id: string): CuratedTranslation | undefined {
  return CURATED_TRANSLATIONS.find((t) => t.id === id);
}

/** Case-insensitive curated lookup — API ids are mixed-case (BSB, eng_kjv, tgl_ulb). */
export function findCuratedTranslation(id: string): CuratedTranslation | undefined {
  const lower = id.toLowerCase();
  return CURATED_TRANSLATIONS.find((t) => t.id.toLowerCase() === lower);
}

/** USFM book id → common name (static; used for metadata before books.json loads). */
export const BOOK_NAMES: Record<string, string> = {
  GEN: 'Genesis', EXO: 'Exodus', LEV: 'Leviticus', NUM: 'Numbers', DEU: 'Deuteronomy',
  JOS: 'Joshua', JDG: 'Judges', RUT: 'Ruth', '1SA': '1 Samuel', '2SA': '2 Samuel',
  '1KI': '1 Kings', '2KI': '2 Kings', '1CH': '1 Chronicles', '2CH': '2 Chronicles',
  EZR: 'Ezra', NEH: 'Nehemiah', EST: 'Esther', JOB: 'Job', PSA: 'Psalms',
  PRO: 'Proverbs', ECC: 'Ecclesiastes', SNG: 'Song of Solomon', ISA: 'Isaiah',
  JER: 'Jeremiah', LAM: 'Lamentations', EZK: 'Ezekiel', DAN: 'Daniel', HOS: 'Hosea',
  JOL: 'Joel', AMO: 'Amos', OBA: 'Obadiah', JON: 'Jonah', MIC: 'Micah',
  NAM: 'Nahum', HAB: 'Habakkuk', ZEP: 'Zephaniah', HAG: 'Haggai', ZEC: 'Zechariah',
  MAL: 'Malachi', MAT: 'Matthew', MRK: 'Mark', LUK: 'Luke', JHN: 'John',
  ACT: 'Acts', ROM: 'Romans', '1CO': '1 Corinthians', '2CO': '2 Corinthians',
  GAL: 'Galatians', EPH: 'Ephesians', PHP: 'Philippians', COL: 'Colossians',
  '1TH': '1 Thessalonians', '2TH': '2 Thessalonians', '1TI': '1 Timothy',
  '2TI': '2 Timothy', TIT: 'Titus', PHM: 'Philemon', HEB: 'Hebrews', JAS: 'James',
  '1PE': '1 Peter', '2PE': '2 Peter', '1JN': '1 John', '2JN': '2 John',
  '3JN': '3 John', JUD: 'Jude', REV: 'Revelation',
};

export function getBookName(id: string): string {
  return BOOK_NAMES[id] ?? id;
}

/** Books in the canonical order are split at Matthew (order index 39). */
export const OT_BOOK_COUNT = 39;

export const QUICK_TRACKS = [
  { label: 'Romans 12', book: 'ROM', chapter: 12 },
  { label: 'Proverbs 12', book: 'PRO', chapter: 12 },
  { label: 'Matthew 5', book: 'MAT', chapter: 5 },
] as const;
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @transformlit/web test -- lib/bible/config.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/bible/config.ts apps/web/src/lib/bible/config.spec.ts
git commit -m "feat(bible): add curated translations, book map, and quick tracks config"
```

---

### Task 5: `lib/bible/api.ts` — fetch wrapper with ETag L1 cache

**Files:**
- Create: `apps/web/src/lib/bible/api.ts`
- Test: `apps/web/src/lib/bible/api.spec.ts`

**Interfaces:**
- Consumes: `BIBLE_API_BASE` (config), types.
- Produces: `fetchBible<T>(path: string): Promise<T>` (L1 Map cache keyed by URL; stores `{ etag, data }`; sends `If-None-Match`, treats 304 as cache hit; `useCache?: boolean` param), and typed getters: `getBooks(translation)`, `getChapter(translation, book, chapter)`, `getWords(translation, book, chapter)`, `getCrossReferences(book, chapter)`, `getCompleteTranslation(translation)` (bypasses L1 via `useCache: false`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/bible/api.spec.ts`:

```ts
import { fetchBible, getBooks, getChapter, getCrossReferences, clearBibleCache } from './api';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function jsonResponse(body: unknown, status = 200, etag?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(etag ? { etag } : {}),
  } as Response;
}

describe('fetchBible', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    clearBibleCache();
  });

  it('fetches and caches by URL with etag', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }, 200, 'W/"abc"'));
    const first = await fetchBible<{ ok: boolean }>('/api/BSB/books.json');
    expect(first.ok).toBe(true);

    // second call uses cache, revalidates with If-None-Match
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 304));
    const second = await fetchBible<{ ok: boolean }>('/api/BSB/books.json');
    expect(second.ok).toBe(true);
    expect(mockFetch.mock.calls[1][1]?.headers).toEqual({ 'If-None-Match': 'W/"abc"' });
  });

  it('dedupes concurrent requests for the same url', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }, 200, 'W/"x"'));
    const [a, b] = await Promise.all([
      fetchBible('/api/BSB/books.json'),
      fetchBible('/api/BSB/books.json'),
    ]);
    expect(a).toEqual(b);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('typed getters', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('getBooks hits /api/{t}/books.json', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ books: [{ id: 'GEN' }] }));
    const result = await getBooks('BSB');
    expect(result.books[0].id).toBe('GEN');
    expect(mockFetch.mock.calls[0][0]).toBe('https://bible.helloao.org/api/BSB/books.json');
  });

  it('getChapter hits /api/{t}/{b}/{c}.json', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ chapter: { number: 1 } }));
    const result = await getChapter('BSB', 'GEN', 1);
    expect(result.chapter.number).toBe(1);
  });

  it('getCrossReferences hits the dataset route', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ chapter: { number: 12, content: [] } }));
    const result = await getCrossReferences('ROM', 12);
    expect(result.chapter.number).toBe(12);
    expect(mockFetch.mock.calls[0][0]).toBe('https://bible.helloao.org/api/d/open-cross-ref/ROM/12.json');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @transformlit/web test -- lib/bible/api.spec.ts`
Expected: FAIL — cannot find module './api'.

- [ ] **Step 3: Write the api module**

Create `apps/web/src/lib/bible/api.ts`:

```ts
import { BIBLE_API_BASE } from './config';
import type {
  BibleChapter,
  ChapterWords,
  CompleteTranslation,
  CrossRefChapter,
  TranslationBook,
} from './types';

interface CacheEntry<T> {
  etag: string | null;
  data: T;
  inflight?: Promise<T>;
}

const cache = new Map<string, CacheEntry<unknown>>();

export async function fetchBible<T>(path: string, useCache = true): Promise<T> {
  const url = `${BIBLE_API_BASE}${path}`;
  const existing = cache.get(url) as CacheEntry<T> | undefined;

  if (useCache && existing?.inflight) return existing.inflight;
  if (useCache && existing && !existing.etag) return existing.data;

  const doFetch = async (): Promise<T> => {
    const headers: Record<string, string> = {};
    if (existing?.etag) headers['If-None-Match'] = existing.etag;

    const res = await fetch(url, { headers });
    if (res.status === 304 && existing) {
      cache.set(url, { etag: existing.etag, data: existing.data });
      return existing.data;
    }
    if (!res.ok) {
      throw new Error(`Bible API ${res.status} for ${path}`);
    }
    const data = (await res.json()) as T;
    const etag = res.headers.get('etag');
    if (useCache) {
      cache.set(url, { etag, data });
    }
    return data;
  };

  const promise = doFetch();
  if (useCache) {
    const prev = cache.get(url) as CacheEntry<T> | undefined;
    cache.set(url, { etag: prev?.etag ?? null, data: prev?.data as T, inflight: promise });
    try {
      return await promise;
    } finally {
      const entry = cache.get(url) as CacheEntry<T> | undefined;
      if (entry) delete entry.inflight;
    }
  }
  return promise;
}

export async function getBooks(translation: string): Promise<{ translation: { id: string }; books: TranslationBook[] }> {
  return fetchBible(`/${translation}/books.json`);
}

export async function getChapter(translation: string, book: string, chapter: number): Promise<BibleChapter> {
  return fetchBible(`/${translation}/${book}/${chapter}.json`);
}

export async function getWords(translation: string, book: string, chapter: number): Promise<ChapterWords> {
  return fetchBible(`/${translation}/${book}/${chapter}.words.json`);
}

export async function getCrossReferences(book: string, chapter: number): Promise<CrossRefChapter> {
  return fetchBible(`/d/open-cross-ref/${book}/${chapter}.json`);
}

export async function getCompleteTranslation(translation: string): Promise<CompleteTranslation> {
  return fetchBible(`/${translation}/complete.json`, false);
}

/** Test/edge helper: clear the module-level L1 cache (use in spec beforeEach). */
export function clearBibleCache(): void {
  cache.clear();
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @transformlit/web test -- lib/bible/api.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/bible/api.ts apps/web/src/lib/bible/api.spec.ts
git commit -m "feat(bible): add ETag-cached fetch wrapper and typed api getters"
```

---

### Task 6: `lib/bible/storage.ts` — IndexedDB kv (DI/mockable) + prefs

**Files:**
- Create: `apps/web/src/lib/bible/storage.ts`
- Test: `apps/web/src/lib/bible/storage.spec.ts`

**Interfaces:**
- Consumes: nothing (jsdom has no IndexedDB — the default impl is lazily created only in the browser).
- Produces: `interface KVStore { get<T>(key): Promise<T | null>; set<T>(key, value): Promise<void>; del(key): Promise<void> }`, `setKVStore(store)`, `getKVStore(): KVStore` (lazy `IndexedDBKV` when `typeof indexedDB !== 'undefined'`, else in-memory fallback), plus `loadPrefs/savePrefs` over localStorage.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/bible/storage.spec.ts`:

```ts
import { getKVStore, setKVStore, KVStore, loadPrefs, savePrefs } from './storage';

class MemoryKV implements KVStore {
  private map = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> {
    return (this.map.get(key) as T | undefined) ?? null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }
  async del(key: string): Promise<void> {
    this.map.delete(key);
  }
}

describe('bible storage', () => {
  const store = new MemoryKV();

  beforeEach(() => setKVStore(store));

  it('round-trips values through the injected store', async () => {
    await getKVStore().set('chapter', { book: 'ROM', chapter: 12 });
    expect(await getKVStore().get<{ book: string; chapter: number }>('chapter')).toEqual({
      book: 'ROM',
      chapter: 12,
    });
  });

  it('deletes values', async () => {
    await getKVStore().set('temp', 1);
    await getKVStore().del('temp');
    expect(await getKVStore().get<number>('temp')).toBeNull();
  });

  it('persists prefs to localStorage', () => {
    savePrefs({ translation: 'BSB' });
    expect(loadPrefs()).toEqual({ translation: 'BSB' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @transformlit/web test -- lib/bible/storage.spec.ts`
Expected: FAIL — cannot find module './storage'.

- [ ] **Step 3: Write the storage module**

Create `apps/web/src/lib/bible/storage.ts`:

```ts
export interface KVStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
}

class IndexedDBKV implements KVStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('transformlit-bible', 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('kv')) {
            req.result.createObjectStore('kv');
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  private tx<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return this.db().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction('kv', mode);
          const req = op(tx.objectStore('kv'));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        }),
    );
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.tx('readonly', (s) => s.get(key) as IDBRequest<T>);
    return value ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.tx('readwrite', (s) => s.put(value, key));
  }

  async del(key: string): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(key));
  }
}

class MemoryKV implements KVStore {
  private map = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> {
    return (this.map.get(key) as T | undefined) ?? null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }
  async del(key: string): Promise<void> {
    this.map.delete(key);
  }
}

let kvStore: KVStore | null = null;

export function setKVStore(store: KVStore): void {
  kvStore = store;
}

export function getKVStore(): KVStore {
  if (!kvStore) {
    kvStore = typeof indexedDB !== 'undefined' ? new IndexedDBKV() : new MemoryKV();
  }
  return kvStore;
}

// ── Prefs (localStorage) ─────────────────────────────────────────────

const PREFS_KEY = 'bible-prefs';

export interface BiblePrefs {
  translation?: string;
}

export function loadPrefs(): BiblePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as BiblePrefs) : {};
  } catch {
    return {};
  }
}

export function savePrefs(prefs: BiblePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota/private-mode errors
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @transformlit/web test -- lib/bible/storage.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/bible/storage.ts apps/web/src/lib/bible/storage.spec.ts
git commit -m "feat(bible): add injectable IndexedDB kv store and prefs helpers"
```

---

### Task 7: `lib/bible/refs.ts` — chapter navigation math (pure, tests-first)

**Files:**
- Create: `apps/web/src/lib/bible/refs.ts`
- Test: `apps/web/src/lib/bible/refs.spec.ts`

**Interfaces:**
- Consumes: `TranslationBook`, `OT_BOOK_COUNT`.
- Produces: `nextChapter(books, bookId, chapter): { book, chapter } | null`, `prevChapter(books, bookId, chapter): { book, chapter } | null`, `formatRef(book, chapter): string`, `refToHref(translation, bookId, chapter, verse?): string`, `isOldTestament(book): boolean`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/bible/refs.spec.ts`:

```ts
import { nextChapter, prevChapter, formatRef, refToHref, isOldTestament } from './refs';
import type { TranslationBook } from './types';

const books: TranslationBook[] = [
  { id: 'GEN', name: 'Genesis', commonName: 'Genesis', title: null, order: 1, numberOfChapters: 50, firstChapterNumber: 1, lastChapterNumber: 50, totalNumberOfVerses: 1533 },
  { id: 'EXO', name: 'Exodus', commonName: 'Exodus', title: null, order: 2, numberOfChapters: 40, firstChapterNumber: 1, lastChapterNumber: 40, totalNumberOfVerses: 1213 },
  { id: 'MAT', name: 'Matthew', commonName: 'Matthew', title: null, order: 40, numberOfChapters: 28, firstChapterNumber: 1, lastChapterNumber: 28, totalNumberOfVerses: 1071 },
  { id: 'REV', name: 'Revelation', commonName: 'Revelation', title: null, order: 66, numberOfChapters: 22, firstChapterNumber: 1, lastChapterNumber: 22, totalNumberOfVerses: 404 },
];

describe('nextChapter', () => {
  it('moves to the next chapter within a book', () => {
    expect(nextChapter(books, 'GEN', 1)).toEqual({ book: books[0], chapter: 2 });
  });

  it('wraps to the first chapter of the next book at a book boundary', () => {
    expect(nextChapter(books, 'GEN', 50)).toEqual({ book: books[1], chapter: 1 });
  });

  it('returns null after the last chapter of the last book', () => {
    expect(nextChapter(books, 'REV', 22)).toBeNull();
  });
});

describe('prevChapter', () => {
  it('moves to the previous chapter within a book', () => {
    expect(prevChapter(books, 'GEN', 2)).toEqual({ book: books[0], chapter: 1 });
  });

  it('wraps to the last chapter of the previous book', () => {
    expect(prevChapter(books, 'EXO', 1)).toEqual({ book: books[0], chapter: 50 });
  });

  it('returns null before the first chapter of the first book', () => {
    expect(prevChapter(books, 'GEN', 1)).toBeNull();
  });
});

describe('formatRef / refToHref / isOldTestament', () => {
  it('formats a reference', () => {
    expect(formatRef(books[2], 5)).toBe('Matthew 5');
  });

  it('builds a reader href with optional verse', () => {
    expect(refToHref('BSB', 'ROM', 12)).toBe('/bible/BSB/ROM/12');
    expect(refToHref('BSB', 'ROM', 12, 2)).toBe('/bible/BSB/ROM/12#v2');
  });

  it('splits OT vs NT by canonical order', () => {
    expect(isOldTestament(books[0])).toBe(true);
    expect(isOldTestament(books[2])).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @transformlit/web test -- lib/bible/refs.spec.ts`
Expected: FAIL — cannot find module './refs'.

- [ ] **Step 3: Write the refs module**

Create `apps/web/src/lib/bible/refs.ts`:

```ts
import { OT_BOOK_COUNT, getBookName } from './config';
import type { TranslationBook } from './types';

export interface ChapterRef {
  book: TranslationBook;
  chapter: number;
}

export function nextChapter(books: TranslationBook[], bookId: string, chapter: number): ChapterRef | null {
  const idx = books.findIndex((b) => b.id === bookId);
  if (idx === -1) return null;
  const book = books[idx];
  if (chapter < book.lastChapterNumber) {
    return { book, chapter: chapter + 1 };
  }
  const nextBook = books[idx + 1];
  return nextBook ? { book: nextBook, chapter: nextBook.firstChapterNumber } : null;
}

export function prevChapter(books: TranslationBook[], bookId: string, chapter: number): ChapterRef | null {
  const idx = books.findIndex((b) => b.id === bookId);
  if (idx === -1) return null;
  const book = books[idx];
  if (chapter > book.firstChapterNumber) {
    return { book, chapter: chapter - 1 };
  }
  const prevBook = books[idx - 1];
  return prevBook ? { book: prevBook, chapter: prevBook.lastChapterNumber } : null;
}

export function formatRef(book: TranslationBook, chapter: number): string {
  return `${getBookName(book.id)} ${chapter}`;
}

export function refToHref(translation: string, bookId: string, chapter: number, verse?: number): string {
  return `/bible/${translation}/${bookId}/${chapter}${verse ? `#v${verse}` : ''}`;
}

export function isOldTestament(book: TranslationBook): boolean {
  return !book.isApocryphal && book.order <= OT_BOOK_COUNT;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @transformlit/web test -- lib/bible/refs.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/bible/refs.ts apps/web/src/lib/bible/refs.spec.ts
git commit -m "feat(bible): add chapter navigation and reference helpers"
```

---

### Task 8: `lib/bible/words.ts` — Strong's offset mapping (tests-first, fragile piece)

**Files:**
- Create: `apps/web/src/lib/bible/words.ts`
- Test: `apps/web/src/lib/bible/words.spec.ts`

**Interfaces:**
- Consumes: `ChapterContent`, `ChapterWord`.
- Produces: `flattenVerseText(content: (string | FormattedText | InlineHeading | InlineLineBreak | VerseFootnoteReference)[]): string` (concatenated plain text, skipping footnote refs/line breaks), `mapWordSpans(content, words): WordSpan[]` where `WordSpan = { start, end, word: ChapterWord }` (character offsets into the flattened string), `hasWordAnnotations(chapter: BibleChapter): boolean`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/bible/words.spec.ts`:

```ts
import { flattenVerseText, mapWordSpans, hasWordAnnotations } from './words';
import type { BibleChapter, ChapterWord } from './types';

const verseContent = [
  'In the beginning was the Word, and the Word was with God, and the Word was God.',
];

describe('flattenVerseText', () => {
  it('joins strings and formatted text, skipping footnote refs and line breaks', () => {
    const content = [
      'Hello ',
      { text: 'world', wordsOfJesus: true },
      { noteId: 0 },
      { lineBreak: true },
      '!',
    ];
    expect(flattenVerseText(content as never[])).toBe('Hello world!');
  });
});

describe('mapWordSpans', () => {
  it('maps contentIndex/start/end offsets onto the flattened verse text', () => {
    const words: ChapterWord[] = [
      { contentIndex: 0, start: 0, end: 2, strongs: ['G1722'], lemma: 'ἐν' },
      { contentIndex: 0, start: 3, end: 6, strongs: ['G0746'], lemma: 'ἀρχή' },
    ];
    const spans = mapWordSpans(verseContent as never[], words);
    expect(spans).toHaveLength(2);
    expect(flattenVerseText(verseContent as never[]).slice(spans[0].start, spans[0].end)).toBe('In');
    expect(spans[0].word.strongs).toEqual(['G1722']);
    expect(flattenVerseText(verseContent as never[]).slice(spans[1].start, spans[1].end)).toBe('the');
  });

  it('ignores words whose contentIndex is out of range', () => {
    const words: ChapterWord[] = [{ contentIndex: 5, start: 0, end: 2 }];
    expect(mapWordSpans(verseContent as never[], words)).toEqual([]);
  });
});

describe('hasWordAnnotations', () => {
  it('detects support via thisChapterWordsLink', () => {
    const chapter = { thisChapterWordsLink: '/api/ENGWEBP/JHN/1.words.json' } as BibleChapter;
    expect(hasWordAnnotations(chapter)).toBe(true);
    expect(hasWordAnnotations({} as BibleChapter)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @transformlit/web test -- lib/bible/words.spec.ts`
Expected: FAIL — cannot find module './words'.

- [ ] **Step 3: Write the words module**

Create `apps/web/src/lib/bible/words.ts`:

```ts
import type { BibleChapter, ChapterWord, FormattedText, InlineHeading, InlineLineBreak, VerseFootnoteReference } from './types';

export type VerseContentItem = string | FormattedText | InlineHeading | InlineLineBreak | VerseFootnoteReference;

export function flattenVerseText(content: VerseContentItem[]): string {
  let text = '';
  for (const item of content) {
    if (typeof item === 'string') {
      text += item;
    } else if ('text' in item && typeof item.text === 'string') {
      text += item.text;
    } else if ('heading' in item && typeof item.heading === 'string') {
      text += item.heading;
    }
    // footnote refs ({noteId}) and line breaks contribute no text
  }
  return text;
}

export interface WordSpan {
  start: number;
  end: number;
  word: ChapterWord;
}

/** Offsets into the flattened verse text are cumulative per content item. */
export function mapWordSpans(content: VerseContentItem[], words: ChapterWord[]): WordSpan[] {
  const offsets = content.map((item) =>
    typeof item === 'string'
      ? item.length
      : 'text' in item && typeof item.text === 'string'
        ? item.text.length
        : 'heading' in item && typeof item.heading === 'string'
          ? item.heading.length
          : 0,
  );
  const baseAt = (index: number) => offsets.slice(0, index).reduce((a, b) => a + b, 0);

  const spans: WordSpan[] = [];
  for (const word of words) {
    if (word.contentIndex < 0 || word.contentIndex >= content.length) continue;
    spans.push({
      start: baseAt(word.contentIndex) + word.start,
      end: baseAt(word.contentIndex) + word.end,
      word,
    });
  }
  spans.sort((a, b) => a.start - b.start);
  return spans;
}

export function hasWordAnnotations(chapter: BibleChapter): boolean {
  return Boolean(chapter.thisChapterWordsLink);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @transformlit/web test -- lib/bible/words.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/bible/words.ts apps/web/src/lib/bible/words.spec.ts
git commit -m "feat(bible): add Strong's word offset mapping with tests"
```

---

### Task 9: `store/bible-store.ts` — persisted reader state

**Files:**
- Create: `apps/web/src/store/bible-store.ts`
- Test: `apps/web/src/store/bible-store.spec.ts`

**Interfaces:**
- Consumes: zustand persist pattern from `store/auth.ts`.
- Produces: `useBibleStore` with `{ translation: string; lastPosition: Record<string, { book: string; chapter: number }>; indexStatus: Record<string, 'none' | 'building' | 'ready'>; isHydrated: boolean; setTranslation(id); setLastPosition(translation, pos); setIndexStatus(translation, status) }`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/store/bible-store.spec.ts`:

```ts
import { useBibleStore } from './bible-store';

describe('useBibleStore', () => {
  beforeEach(() => {
    useBibleStore.setState({
      translation: 'BSB',
      lastPosition: {},
      indexStatus: {},
      isHydrated: true,
    });
  });

  it('defaults translation to BSB', () => {
    expect(useBibleStore.getState().translation).toBe('BSB');
  });

  it('sets translation', () => {
    useBibleStore.getState().setTranslation('ENGWEBP');
    expect(useBibleStore.getState().translation).toBe('ENGWEBP');
  });

  it('tracks last position per translation', () => {
    useBibleStore.getState().setLastPosition('BSB', { book: 'ROM', chapter: 8 });
    expect(useBibleStore.getState().lastPosition['BSB']).toEqual({ book: 'ROM', chapter: 8 });
  });

  it('tracks search index status', () => {
    useBibleStore.getState().setIndexStatus('BSB', 'ready');
    expect(useBibleStore.getState().indexStatus['BSB']).toBe('ready');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @transformlit/web test -- store/bible-store.spec.ts`
Expected: FAIL — cannot find module './bible-store'.

- [ ] **Step 3: Write the store**

Create `apps/web/src/store/bible-store.ts`:

```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_TRANSLATION } from '../lib/bible/config';

export type IndexStatus = 'none' | 'building' | 'ready';

interface BibleStore {
  translation: string;
  lastPosition: Record<string, { book: string; chapter: number }>;
  indexStatus: Record<string, IndexStatus>;
  isHydrated: boolean;
  setTranslation: (id: string) => void;
  setLastPosition: (translation: string, pos: { book: string; chapter: number }) => void;
  setIndexStatus: (translation: string, status: IndexStatus) => void;
}

export const useBibleStore = create<BibleStore>()(
  persist(
    (set) => ({
      translation: DEFAULT_TRANSLATION,
      lastPosition: {},
      indexStatus: {},
      isHydrated: false,
      setTranslation: (id) => set({ translation: id }),
      setLastPosition: (translation, pos) =>
        set((s) => ({ lastPosition: { ...s.lastPosition, [translation]: pos } })),
      setIndexStatus: (translation, status) =>
        set((s) => ({ indexStatus: { ...s.indexStatus, [translation]: status } })),
    }),
    {
      name: 'bible-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        translation: state.translation,
        lastPosition: state.lastPosition,
        indexStatus: state.indexStatus,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<BibleStore> | undefined;
        return { ...currentState, ...persisted, isHydrated: true };
      },
      onRehydrateStorage: () => (state, error) => {
        if (error) console.error('Failed to rehydrate bible store:', error);
      },
    },
  ),
);
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @transformlit/web test -- store/bible-store.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/store/bible-store.ts apps/web/src/store/bible-store.spec.ts
git commit -m "feat(bible): add persisted bible store for translation, position, index status"
```

---

### Task 10: Search — pure `build-index.ts` + `matcher.ts` (no worker)

**Files:**
- Create: `apps/web/src/lib/bible/search/build-index.ts`
- Create: `apps/web/src/lib/bible/search/matcher.ts`
- Test: `apps/web/src/lib/bible/search/build-index.spec.ts`
- Test: `apps/web/src/lib/bible/search/matcher.spec.ts`

**Interfaces:**
- Consumes: `CompleteTranslation`, `ChapterContent`, `flattenVerseText`.
- Produces: `interface SearchCorpus { verses: string[]; refs: { b: string; c: number; v: number }[] }`, `buildIndex(complete: CompleteTranslation): SearchCorpus`, `interface SearchResult { b, c, v, snippet, matchStart, matchEnd }`, `searchCorpus(corpus, query, limit = 50): SearchResult[]` (case/diacritic-insensitive substring; snippet ±40 chars around first match).

- [ ] **Step 1: Worker-emission spike (before building the transport)**

This must be done BEFORE Task 11 (the worker transport) so the fallback decision is made first. Create a throwaway probe `apps/web/src/lib/bible/search/spike.ts`:

```ts
// Throwaway spike — delete after verifying.
export function spikeWorker(): boolean {
  try {
    const w = new Worker(new URL('./spike-worker.ts', import.meta.url));
    w.terminate();
    return true;
  } catch {
    return false;
  }
}
```

with `spike-worker.ts` containing `self.onmessage = () => {};` and a temporary call site in `bible-client.tsx` (rendered nowhere, e.g. `void spikeWorker()` in an effect). Then:

Run: `pnpm --filter @transformlit/web build && pnpm --filter @transformlit/web dev`
Expected: build emits a worker chunk without error; dev console shows no "Worker" error. If Turbopack rejects `new Worker(new URL(...))`, record the exact error, keep the `client.ts` main-thread fallback as the DEFAULT (already designed), and note it in the Task 11 commit. Either way, delete `spike.ts`/`spike-worker.ts` and the call site before Task 11.

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/lib/bible/search/build-index.spec.ts`:

```ts
import { buildIndex } from './build-index';
import type { CompleteTranslation } from '../types';

const complete: CompleteTranslation = {
  translation: { id: 'BSB', name: 'Berean Standard Bible', shortName: 'BSB' },
  books: [
    {
      id: 'JHN',
      commonName: 'John',
      order: 43,
      numberOfChapters: 1,
      totalNumberOfVerses: 1,
      chapters: [
        {
          chapter: {
            number: 1,
            content: [
              { type: 'verse', number: 1, content: ['In the beginning was the Word, and the Word was God.'] },
              { type: 'verse', number: 2, content: ['The same was in the beginning with God.'] },
            ],
          },
        },
      ],
    },
  ],
};

describe('buildIndex', () => {
  it('flattens verses into a searchable corpus with parallel refs', () => {
    const corpus = buildIndex(complete);
    expect(corpus.verses).toEqual([
      'In the beginning was the Word, and the Word was God.',
      'The same was in the beginning with God.',
    ]);
    expect(corpus.refs).toEqual([
      { b: 'JHN', c: 1, v: 1 },
      { b: 'JHN', c: 1, v: 2 },
    ]);
  });

  it('skips headings and line breaks', () => {
    const withHeading: CompleteTranslation = {
      ...complete,
      books: [
        {
          ...complete.books[0],
          chapters: [
            { chapter: { number: 1, content: [{ type: 'heading', content: ['Prologue'] }, { type: 'line_break' }, { type: 'verse', number: 1, content: ['Verse one.'] }] } },
          ],
        },
      ],
    };
    const corpus = buildIndex(withHeading);
    expect(corpus.verses).toEqual(['Verse one.']);
  });
});
```

Create `apps/web/src/lib/bible/search/matcher.spec.ts`:

```ts
import { searchCorpus } from './matcher';
import type { SearchCorpus } from './build-index';

const corpus: SearchCorpus = {
  verses: [
    'In the beginning was the Word, and the Word was with God.',
    'For God so loved the world, that he gave his only Son.',
    'Love is patient, love is kind.',
  ],
  refs: [
    { b: 'JHN', c: 1, v: 1 },
    { b: 'JHN', c: 3, v: 16 },
    { b: '1CO', c: 13, v: 4 },
  ],
};

describe('searchCorpus', () => {
  it('matches case-insensitively', () => {
    const results = searchCorpus(corpus, 'GOD');
    expect(results.map((r) => r.b)).toEqual(['JHN', 'JHN']);
  });

  it('returns refs with snippet and match offsets', () => {
    const results = searchCorpus(corpus, 'loved');
    expect(results).toHaveLength(1);
    expect(results[0].b).toBe('JHN');
    expect(results[0].c).toBe(3);
    expect(results[0].v).toBe(16);
    // offsets are relative to the SNIPPET (which may carry ellipses), not the raw verse
    expect(results[0].snippet.slice(results[0].matchStart, results[0].matchEnd)).toBe('loved');
    expect(results[0].snippet).toContain('loved');
  });

  it('returns empty for no matches', () => {
    expect(searchCorpus(corpus, 'zzz')).toEqual([]);
  });

  it('limits results', () => {
    expect(searchCorpus(corpus, 'a', 2)).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm --filter @transformlit/web test -- lib/bible/search`
Expected: FAIL — cannot find modules.

- [ ] **Step 4: Write build-index.ts**

Create `apps/web/src/lib/bible/search/build-index.ts`:

```ts
import { flattenVerseText } from '../words';
import type { CompleteTranslation, ChapterContent, VerseContentItem } from '../types';

export interface SearchCorpus {
  verses: string[];
  refs: { b: string; c: number; v: number }[];
}

export function buildIndex(complete: CompleteTranslation): SearchCorpus {
  const verses: string[] = [];
  const refs: { b: string; c: number; v: number }[] = [];

  for (const book of complete.books) {
    for (const ch of book.chapters) {
      for (const item of ch.chapter.content) {
        if (item.type !== 'verse') continue;
        const text = flattenVerseText(item.content as VerseContentItem[]);
        if (!text) continue;
        verses.push(text);
        refs.push({ b: book.id, c: ch.chapter.number, v: item.number });
      }
    }
  }

  return { verses, refs };
}
```

- [ ] **Step 5: Write matcher.ts**

Create `apps/web/src/lib/bible/search/matcher.ts`:

```ts
import type { SearchCorpus } from './build-index';

export interface SearchResult {
  b: string;
  c: number;
  v: number;
  snippet: string;
  matchStart: number;
  matchEnd: number;
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const SNIPPET_RADIUS = 40;

export function searchCorpus(corpus: SearchCorpus, query: string, limit = 50): SearchResult[] {
  const needle = normalize(query.trim());
  if (!needle) return [];

  const results: SearchResult[] = [];
  for (let i = 0; i < corpus.verses.length && results.length < limit; i++) {
    const text = corpus.verses[i];
    const index = normalize(text).indexOf(needle);
    if (index === -1) continue;

    const start = Math.max(0, index - SNIPPET_RADIUS);
    const end = Math.min(text.length, index + needle.length + SNIPPET_RADIUS);
    const snippet = `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;

    results.push({
      b: corpus.refs[i].b,
      c: corpus.refs[i].c,
      v: corpus.refs[i].v,
      snippet,
      matchStart: index - start + (start > 0 ? 1 : 0),
      matchEnd: index - start + needle.length + (start > 0 ? 1 : 0),
    });
  }
  return results;
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @transformlit/web test -- lib/bible/search`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/bible/search/
git commit -m "feat(bible): add pure search index builder and substring matcher"
```

---

### Task 11: Search — worker transport + `client.ts`

**Files:**
- Create: `apps/web/src/lib/bible/search/search-worker.ts`
- Create: `apps/web/src/lib/bible/search/client.ts`
- Test: `apps/web/src/lib/bible/search/client.spec.ts`

**Interfaces:**
- Consumes: `buildIndex`, `searchCorpus`.
- Produces: `SearchClient` class: `ensureIndex(translation): Promise<void>` (downloads complete.json, builds corpus, stores in KV under `bible:{t}:index`), `search(translation, query, limit): Promise<SearchResult[]>` (loads corpus, falls back to main-thread search when workers unavailable), `onProgress(cb)`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/bible/search/client.spec.ts`:

```ts
import { SearchClient } from './client';
import { getKVStore, setKVStore } from '../storage';
import type { KVStore } from '../storage';

class MemoryKV implements KVStore {
  private map = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> {
    return (this.map.get(key) as T | undefined) ?? null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }
  async del(key: string): Promise<void> {
    this.map.delete(key);
  }
}

const corpus = {
  verses: ['For God so loved the world.'],
  refs: [{ b: 'JHN', c: 3, v: 16 }],
};

describe('SearchClient (main-thread fallback)', () => {
  let client: SearchClient;

  beforeEach(() => {
    setKVStore(new MemoryKV());
    client = new SearchClient();
  });

  it('stores the built index in the KV store', async () => {
    await client.persistCorpus('BSB', corpus);
    const stored = await getKVStore().get('bible:BSB:index');
    expect(stored).toEqual(corpus);
  });

  it('searches a stored corpus', async () => {
    await client.persistCorpus('BSB', corpus);
    const results = await client.search('BSB', 'loved');
    expect(results).toHaveLength(1);
    expect(results[0].b).toBe('JHN');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @transformlit/web test -- lib/bible/search/client.spec.ts`
Expected: FAIL — cannot find module './client'.

- [ ] **Step 3: Write search-worker.ts**

Create `apps/web/src/lib/bible/search/search-worker.ts`:

```ts
import { buildIndex, type SearchCorpus } from './build-index';
import { searchCorpus, type SearchResult } from './matcher';
import type { CompleteTranslation } from '../types';

interface BuildMessage {
  kind: 'build';
  id: number;
  payload: CompleteTranslation;
}
interface SearchMessage {
  kind: 'search';
  id: number;
  payload: { corpus: SearchCorpus; query: string; limit: number };
}

self.onmessage = (event: MessageEvent<BuildMessage | SearchMessage>) => {
  const msg = event.data;
  if (msg.kind === 'build') {
    const corpus = buildIndex(msg.payload);
    (self as unknown as Worker).postMessage({ id: msg.id, kind: 'built', corpus });
  } else if (msg.kind === 'search') {
    const results = searchCorpus(msg.payload.corpus, msg.payload.query, msg.payload.limit);
    (self as unknown as Worker).postMessage({ id: msg.id, kind: 'results', results });
  }
};

export type { BuildMessage, SearchMessage, SearchResult };
```

- [ ] **Step 4: Write client.ts**

Create `apps/web/src/lib/bible/search/client.ts`:

```ts
import { getCompleteTranslation } from '../api';
import { getKVStore } from '../storage';
import { buildIndex, type SearchCorpus } from './build-index';
import { searchCorpus, type SearchResult } from './matcher';

export class SearchClient {
  private worker: Worker | null = null;
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private onProgressCb: ((phase: 'downloading' | 'building', pct: number) => void) | null = null;

  onProgress(cb: (phase: 'downloading' | 'building', pct: number) => void): void {
    this.onProgressCb = cb;
  }

  private getWorker(): Worker | null {
    if (typeof Worker === 'undefined') return null;
    if (!this.worker) {
      try {
        this.worker = new Worker(new URL('./search-worker.ts', import.meta.url));
        this.worker.onmessage = (event) => {
          const msg = event.data as { id?: number; kind: string; [k: string]: unknown };
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            if (msg.kind === 'built') resolve(msg.corpus);
            else if (msg.kind === 'results') resolve(msg.results);
            else reject(new Error('worker error'));
          }
        };
        this.worker.onerror = () => {
          const pending = Array.from(this.pending.values());
          this.pending.clear();
          for (const { reject } of pending) reject(new Error('worker failed'));
        };
      } catch {
        this.worker = null;
      }
    }
    return this.worker;
  }

  private post<T>(msg: Record<string, unknown>): Promise<T> {
    const worker = this.getWorker();
    if (!worker) return Promise.reject(new Error('no-worker'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, ...msg });
    });
  }

  async persistCorpus(translation: string, corpus: SearchCorpus): Promise<void> {
    await getKVStore().set(`bible:${translation}:index`, corpus);
  }

  private async getCorpus(translation: string): Promise<SearchCorpus | null> {
    return getKVStore().get<SearchCorpus>(`bible:${translation}:index`);
  }

  async ensureIndex(translation: string): Promise<void> {
    const existing = await this.getCorpus(translation);
    if (existing) return;

    this.onProgressCb?.('downloading', 0);
    const complete = await getCompleteTranslation(translation);
    this.onProgressCb?.('downloading', 100);

    let corpus: SearchCorpus;
    const worker = this.getWorker();
    if (worker) {
      this.onProgressCb?.('building', 0);
      corpus = await this.post<SearchCorpus>({ kind: 'build', payload: complete });
    } else {
      corpus = buildIndex(complete);
    }
    this.onProgressCb?.('building', 100);
    await this.persistCorpus(translation, corpus);
  }

  async search(translation: string, query: string, limit = 50): Promise<SearchResult[]> {
    const corpus = await this.getCorpus(translation);
    if (!corpus) return [];

    const worker = this.getWorker();
    if (worker) {
      try {
        return await this.post<SearchResult[]>({ kind: 'search', payload: { corpus, query, limit } });
      } catch {
        // fall through to main thread
      }
    }
    return searchCorpus(corpus, query, limit);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @transformlit/web test -- lib/bible/search/client.spec.ts`
Expected: PASS (jsdom: no Worker → fallback path + persist round-trip).

- [ ] **Step 6: Verify the worker builds (spike)**

Run: `pnpm --filter @transformlit/web build`
Expected: build succeeds (worker chunk emitted; if Turbopack errors on `new Worker(new URL(...))`, the fallback in `client.ts` keeps search functional — document any workaround needed in the commit).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/bible/search/
git commit -m "feat(bible): add search worker transport and client with main-thread fallback"
```

---

### Task 12: Hooks — `use-bible-books`, `use-chapter`, `use-cross-references`

**Files:**
- Create: `apps/web/src/lib/hooks/use-bible-books.ts`
- Create: `apps/web/src/lib/hooks/use-chapter.ts`
- Create: `apps/web/src/lib/hooks/use-cross-references.ts`
- Test: `apps/web/src/lib/hooks/use-bible-books.spec.tsx`
- Test: `apps/web/src/lib/hooks/use-chapter.spec.tsx`
- Test: `apps/web/src/lib/hooks/use-cross-references.spec.tsx`

**Interfaces:**
- Consumes: `getBooks`, `getChapter`, `getWords`, `getCrossReferences`, `hasWordAnnotations`, `useBibleStore`.
- Produces: `useBibleBooks(translation): { books, loading, error, reload }`; `useChapter(translation, book, chapter): { chapter, words, loading, error }` (fetches words only when `hasWordAnnotations`); `useCrossReferences(book, chapter): { refs, loading }` (fetched on demand; treats 404 as empty).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/hooks/use-bible-books.spec.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { useBibleBooks } from './use-bible-books';
import * as api from '../../lib/bible/api';

jest.mock('../../lib/bible/api');

function Probe({ translation }: { translation: string }) {
  const { books, loading } = useBibleBooks(translation);
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="count">{books.length}</span>
    </div>
  );
}

describe('useBibleBooks', () => {
  it('loads books for the translation', async () => {
    (api.getBooks as jest.Mock).mockResolvedValue({ books: [{ id: 'GEN', commonName: 'Genesis' }] });
    render(<Probe translation="BSB" />);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
  });
});
```

Create `apps/web/src/lib/hooks/use-chapter.spec.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { useChapter } from './use-chapter';
import * as api from '../../lib/bible/api';

jest.mock('../../lib/bible/api');

function Probe({ translation, book, chapter }: { translation: string; book: string; chapter: number }) {
  const { chapter: ch, words, loading } = useChapter(translation, book, chapter);
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="verses">{ch?.chapter.content.filter((c) => c.type === 'verse').length ?? 0}</span>
      <span data-testid="words">{words ? 'yes' : 'no'}</span>
    </div>
  );
}

describe('useChapter', () => {
  it('loads a chapter and its word annotations when supported', async () => {
    (api.getChapter as jest.Mock).mockResolvedValue({
      thisChapterWordsLink: '/api/ENGWEBP/JHN/1.words.json',
      chapter: { number: 1, content: [{ type: 'verse', number: 1, content: ['x'] }], footnotes: [] },
    });
    (api.getWords as jest.Mock).mockResolvedValue({ verses: { '1': [] } });

    render(<Probe translation="ENGWEBP" book="JHN" chapter={1} />);
    await waitFor(() => expect(screen.getByTestId('verses').textContent).toBe('1'));
    await waitFor(() => expect(screen.getByTestId('words').textContent).toBe('yes'));
    expect(api.getWords).toHaveBeenCalledWith('ENGWEBP', 'JHN', 1);
  });

  it('skips words when the translation lacks annotations', async () => {
    (api.getChapter as jest.Mock).mockResolvedValue({
      chapter: { number: 1, content: [{ type: 'verse', number: 1, content: ['x'] }], footnotes: [] },
    });
    render(<Probe translation="BSB" book="JHN" chapter={1} />);
    await waitFor(() => expect(screen.getByTestId('words').textContent).toBe('no'));
    expect(api.getWords).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @transformlit/web test -- lib/hooks/use-bible-books.spec.tsx lib/hooks/use-chapter.spec.tsx`
Expected: FAIL — cannot find modules.

- [ ] **Step 3: Write the hooks**

Create `apps/web/src/lib/hooks/use-bible-books.ts`:

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { getBooks } from '../bible/api';
import type { TranslationBook } from '../bible/types';

export function useBibleBooks(translation: string) {
  const [books, setBooks] = useState<TranslationBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getBooks(translation);
      setBooks(result.books);
    } catch {
      setError('Failed to load books.');
    } finally {
      setLoading(false);
    }
  }, [translation]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { books, loading, error, reload };
}
```

Create `apps/web/src/lib/hooks/use-chapter.ts`:

```ts
'use client';

import { useEffect, useState } from 'react';
import { getChapter, getWords } from '../bible/api';
import { hasWordAnnotations } from '../bible/words';
import type { BibleChapter, ChapterWords } from '../bible/types';

export function useChapter(translation: string, book: string, chapter: number) {
  const [chapterData, setChapterData] = useState<BibleChapter | null>(null);
  const [words, setWords] = useState<ChapterWords | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setChapterData(null);
    setWords(null);

    (async () => {
      try {
        const ch = await getChapter(translation, book, chapter);
        if (cancelled) return;
        setChapterData(ch);
        if (hasWordAnnotations(ch)) {
          const w = await getWords(translation, book, chapter);
          if (!cancelled) setWords(w);
        }
      } catch {
        if (!cancelled) setError('Failed to load chapter.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [translation, book, chapter]);

  return { chapter: chapterData, words, loading, error };
}
```

Create `apps/web/src/lib/hooks/use-cross-references.ts`:

```ts
'use client';

import { useCallback, useState } from 'react';
import { getCrossReferences } from '../bible/api';
import type { CrossRefReference } from '../bible/types';

export function useCrossReferences(book: string, chapter: number) {
  const [byVerse, setByVerse] = useState<Record<number, CrossRefReference[]>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getCrossReferences(book, chapter);
      const map: Record<number, CrossRefReference[]> = {};
      for (const item of result.chapter.content) {
        map[item.verse] = item.references;
      }
      setByVerse(map);
    } catch {
      // dataset 404 / sparse coverage → treat as empty
      setByVerse({});
    } finally {
      setLoading(false);
    }
  }, [book, chapter]);

  return { byVerse, loading, load };
}
```

- [ ] **Step 4: Add the missing cross-references spec (coverage)**

Create `apps/web/src/lib/hooks/use-cross-references.spec.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useCrossReferences } from './use-cross-references';
import * as api from '../../lib/bible/api';

jest.mock('../../lib/bible/api');

function Probe({ book, chapter }: { book: string; chapter: number }) {
  const { byVerse, loading, load } = useCrossReferences(book, chapter);
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="count">{Object.keys(byVerse).length}</span>
      <button onClick={() => void load()}>load</button>
    </div>
  );
}

describe('useCrossReferences', () => {
  it('loads references grouped by verse', async () => {
    (api.getCrossReferences as jest.Mock).mockResolvedValue({
      chapter: { number: 12, content: [{ verse: 1, references: [{ book: 'ROM', chapter: 6, verse: 13 }] }] },
    });
    render(<Probe book="ROM" chapter={12} />);
    fireEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
  });

  it('treats a fetch failure as empty (dataset 404s are expected)', async () => {
    (api.getCrossReferences as jest.Mock).mockRejectedValue(new Error('404'));
    render(<Probe book="ROM" chapter={12} />);
    fireEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));
  });
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @transformlit/web test -- lib/hooks`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/hooks/use-bible-books.ts apps/web/src/lib/hooks/use-bible-books.spec.tsx apps/web/src/lib/hooks/use-chapter.ts apps/web/src/lib/hooks/use-chapter.spec.tsx apps/web/src/lib/hooks/use-cross-references.ts apps/web/src/lib/hooks/use-cross-references.spec.tsx
git commit -m "feat(bible): add books, chapter, and cross-reference hooks"
```

---

### Task 13: `components/ui/sheet.tsx` — bottom-sheet / right-drawer primitive

**Files:**
- Create: `apps/web/src/components/ui/sheet.tsx`
- Create: `apps/web/src/components/ui/sheet.spec.tsx`
- Modify: `apps/web/src/components/ui/index.ts` (export)

**Interfaces:**
- Consumes: motion v13 (`motion/react`).
- Produces: `Sheet({ open, onClose, side?: 'bottom' | 'right', title?, children })` — mobile: full-width bottom sheet (slide-up, pull indicator); desktop (`md:`): right drawer (~420px). `z-[80]`, escape + backdrop close, `AnimatePresence`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/ui/sheet.spec.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { Sheet } from './sheet';

describe('Sheet', () => {
  it('renders children when open', () => {
    render(
      <Sheet open onClose={() => {}} title="Study">
        <p>Footnotes</p>
      </Sheet>,
    );
    expect(screen.getByText('Study')).toBeInTheDocument();
    expect(screen.getByText('Footnotes')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(
      <Sheet open={false} onClose={() => {}}>
        <p>Hidden</p>
      </Sheet>,
    );
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('calls onClose on backdrop click', () => {
    const onClose = jest.fn();
    render(
      <Sheet open onClose={onClose}>
        <p>Body</p>
      </Sheet>,
    );
    fireEvent.click(screen.getByTestId('sheet-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @transformlit/web test -- components/ui/sheet.spec.tsx`
Expected: FAIL — cannot find module './sheet'.

- [ ] **Step 3: Write the Sheet**

Create `apps/web/src/components/ui/sheet.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  side?: 'bottom' | 'right';
  title?: string;
  children: React.ReactNode;
}

export function Sheet({ open, onClose, side = 'bottom', title, children }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label={title}>
          <motion.div
            data-testid="sheet-backdrop"
            className="absolute inset-0 bg-black/50 dark:bg-black/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className={`absolute bg-surface dark:bg-surface-raised border border-outline-variant shadow-lift flex flex-col ${
              side === 'right'
                ? 'inset-y-0 right-0 w-full max-w-[420px] rounded-l-2xl'
                : 'inset-x-0 bottom-0 rounded-t-2xl max-h-[85dvh]'
            }`}
            initial={side === 'right' ? { x: '100%' } : { y: '100%' }}
            animate={side === 'right' ? { x: 0 } : { y: 0 }}
            exit={side === 'right' ? { x: '100%' } : { y: '100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
          >
            {side === 'bottom' && (
              <div className="w-10 h-1 rounded-full bg-outline-variant mx-auto mt-3 shrink-0" aria-hidden />
            )}
            {title && (
              <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
                <h2 className="font-display text-headline-h3 text-on-surface">{title}</h2>
                <button
                  onClick={onClose}
                  className="text-ink-soft hover:text-ink p-2 -mr-2"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="overflow-y-auto px-5 pb-6">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 4: Export from the barrel**

In `apps/web/src/components/ui/index.ts`, add after the Modal export:

```ts
export { Sheet } from './sheet';
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @transformlit/web test -- components/ui/sheet.spec.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/sheet.tsx apps/web/src/components/ui/sheet.spec.tsx apps/web/src/components/ui/index.ts
git commit -m "feat(bible): add motion-based Sheet primitive (bottom sheet / right drawer)"
```

---

### Task 14: `components/bible/translation-picker.tsx`

**Files:**
- Create: `apps/web/src/components/bible/translation-picker.tsx`
- Test: `apps/web/src/components/bible/translation-picker.spec.tsx`
- Create: `apps/web/src/components/bible/index.ts` (barrel)

**Interfaces:**
- Consumes: `Modal`, `CURATED_TRANSLATIONS`, `useBibleStore`.
- Produces: `TranslationPicker({ open, onClose })` — grouped ENGLISH / TAGALOG lists, selected state (check + container), badges (`Audio`, `Word studies`), 44px rows.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/bible/translation-picker.spec.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { TranslationPicker } from './translation-picker';
import { useBibleStore } from '../../store/bible-store';

describe('TranslationPicker', () => {
  it('renders grouped translations and selects on click', () => {
    render(<TranslationPicker open onClose={() => {}} />);

    expect(screen.getByText('Berean Standard Bible')).toBeInTheDocument();
    expect(screen.getByText('Banal na Bibliya')).toBeInTheDocument();
    expect(screen.getByText('ENGWEBP')).toBeInTheDocument();

    fireEvent.click(screen.getByText('King James Version'));
    expect(useBibleStore.getState().translation).toBe('eng_kjv');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @transformlit/web test -- components/bible/translation-picker.spec.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the picker**

Create `apps/web/src/components/bible/translation-picker.tsx`:

```tsx
'use client';

import { Modal } from '../ui/modal';
import { CURATED_TRANSLATIONS } from '../../lib/bible/config';
import { useBibleStore } from '../../store/bible-store';

interface TranslationPickerProps {
  open: boolean;
  onClose: () => void;
}

const GROUPS = [
  { label: 'English', ids: CURATED_TRANSLATIONS.filter((t) => t.language === 'English').map((t) => t.id) },
  { label: 'Tagalog', ids: CURATED_TRANSLATIONS.filter((t) => t.language === 'Tagalog').map((t) => t.id) },
];

export function TranslationPicker({ open, onClose }: TranslationPickerProps) {
  const translation = useBibleStore((s) => s.translation);
  const setTranslation = useBibleStore((s) => s.setTranslation);

  return (
    <Modal open={open} onClose={onClose} title="Choose Translation">
      <div className="flex flex-col gap-5">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <p className="font-micro text-micro uppercase tracking-[0.2em] text-on-surface-variant mb-2">
              {group.label}
            </p>
            <div className="flex flex-col gap-1">
              {group.ids.map((id) => {
                const t = CURATED_TRANSLATIONS.find((x) => x.id === id)!;
                const selected = translation === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setTranslation(id);
                      onClose();
                    }}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                      selected
                        ? 'bg-primary-container/25 dark:bg-primary-container/40 border border-primary/40'
                        : 'hover:bg-surface-container-high'
                    }`}
                  >
                    <span className="font-display text-small font-semibold text-on-surface flex-1">
                      {t.label}
                    </span>
                    <span className="font-micro text-micro text-on-surface-variant">{t.id}</span>
                    {t.hasWords && (
                      <span className="px-2 py-0.5 rounded-full bg-accent-teal-light/15 text-accent-teal-light text-micro font-bold">
                        Word studies
                      </span>
                    )}
                    {t.hasAudio && (
                      <span className="px-2 py-0.5 rounded-full bg-accent-teal-light/15 text-accent-teal-light text-micro font-bold">
                        Audio
                      </span>
                    )}
                    {selected && (
                      <span className="material-symbols-outlined text-primary" aria-label="Selected">
                        check
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <p className="font-micro text-micro text-outline">
          1,250+ translations available — public domain, no copyright restrictions.
        </p>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Create the barrel**

Create `apps/web/src/components/bible/index.ts`:

```ts
export { TranslationPicker } from './translation-picker';
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @transformlit/web test -- components/bible/translation-picker.spec.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/bible/
git commit -m "feat(bible): add translation picker modal"
```

---

### Task 15: `components/bible/book-grid.tsx` + `book-chapter-picker.tsx`

**Files:**
- Create: `apps/web/src/components/bible/book-grid.tsx`
- Create: `apps/web/src/components/bible/book-chapter-picker.tsx`
- Test: `apps/web/src/components/bible/book-grid.spec.tsx`

**Interfaces:**
- Consumes: `TranslationBook`, `useBibleStore`, `Modal`, `refToHref`, `isOldTestament`.
- Produces: `BookGrid({ books, translation, loading })` — OT/NT sections, 2-col mobile / 5-col desktop cards; `BookChapterPicker({ open, onClose, books, bookId, chapter })` — book list (auto-scroll active) + chapter grid.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/bible/book-grid.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { BookGrid } from './book-grid';
import type { TranslationBook } from '../../lib/bible/types';

const books: TranslationBook[] = [
  { id: 'GEN', name: 'Genesis', commonName: 'Genesis', title: null, order: 1, numberOfChapters: 50, firstChapterNumber: 1, lastChapterNumber: 50, totalNumberOfVerses: 1533 },
  { id: 'MAT', name: 'Matthew', commonName: 'Matthew', title: null, order: 40, numberOfChapters: 28, firstChapterNumber: 1, lastChapterNumber: 28, totalNumberOfVerses: 1071 },
];

describe('BookGrid', () => {
  it('renders OT and NT sections and links to the reader', () => {
    render(<BookGrid books={books} translation="BSB" loading={false} />);
    expect(screen.getByText('Old Testament')).toBeInTheDocument();
    expect(screen.getByText('New Testament')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Genesis/ });
    expect(link).toHaveAttribute('href', '/bible/BSB/GEN/1');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @transformlit/web test -- components/bible/book-grid.spec.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write BookGrid**

Create `apps/web/src/components/bible/book-grid.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { isOldTestament } from '../../lib/bible/refs';
import type { TranslationBook } from '../../lib/bible/types';

interface BookGridProps {
  books: TranslationBook[];
  translation: string;
  loading: boolean;
}

function BookCard({ book, translation }: { book: TranslationBook; translation: string }) {
  return (
    <Link
      href={`/bible/${translation}/${book.id}/1`}
      className="bg-surface-container-lowest dark:bg-surface-raised border border-outline-variant rounded-lg p-3 text-center hover:border-primary hover:shadow-soft transition-all"
    >
      <span className="font-display text-small font-medium text-on-surface">{book.commonName}</span>
    </Link>
  );
}

export function BookGrid({ books, translation, loading }: BookGridProps) {
  const ot = books.filter((b) => isOldTestament(b));
  const nt = books.filter((b) => !isOldTestament(b));

  if (loading) {
    return <p className="text-on-surface-variant py-8 text-center">Loading books…</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      {[
        { label: 'Old Testament', list: ot },
        { label: 'New Testament', list: nt },
      ].map(({ label, list }) => (
        <section key={label}>
          <h2 className="font-display text-headline-h4 text-on-surface mb-3">{label}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {list.map((book) => (
              <BookCard key={book.id} book={book} translation={translation} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Write BookChapterPicker**

Create `apps/web/src/components/bible/book-chapter-picker.tsx`:

```tsx
'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Modal } from '../ui/modal';
import { isOldTestament } from '../../lib/bible/refs';
import type { TranslationBook } from '../../lib/bible/types';

interface BookChapterPickerProps {
  open: boolean;
  onClose: () => void;
  books: TranslationBook[];
  translation: string;
  bookId: string;
  chapter: number;
}

export function BookChapterPicker({ open, onClose, books, translation, bookId, chapter }: BookChapterPickerProps) {
  const bookRefs = useRef(new Map<string, HTMLButtonElement | null>());

  useEffect(() => {
    if (open) {
      const el = bookRefs.current.get(bookId);
      el?.scrollIntoView({ block: 'center' });
    }
  }, [open, bookId]);

  const current = books.find((b) => b.id === bookId);

  return (
    <Modal open={open} onClose={onClose} title="Choose a Chapter">
      <div className="grid grid-cols-[2fr_3fr] gap-4">
        <div className="max-h-[50dvh] overflow-y-auto custom-scrollbar flex flex-col">
          {(['Old Testament', 'New Testament'] as const).map((label) => {
            const list = books.filter((b) => (label === 'Old Testament' ? isOldTestament(b) : !isOldTestament(b)));
            return (
              <div key={label}>
                <p className="font-micro text-micro uppercase tracking-[0.2em] text-on-surface-variant sticky top-0 bg-surface py-1">
                  {label}
                </p>
                {list.map((b) => (
                  <button
                    key={b.id}
                    ref={(el) => {
                      bookRefs.current.set(b.id, el);
                    }}
                    type="button"
                    className={`w-full text-left px-3 py-2 rounded text-small font-display ${
                      b.id === bookId
                        ? 'bg-primary-container/25 border-l-[3px] border-primary text-on-surface font-bold'
                        : 'text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    {b.commonName}
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        <div>
          <p className="font-display text-headline-h4 text-on-surface mb-3">
            {current?.commonName ?? bookId}
          </p>
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: current?.numberOfChapters ?? 0 }, (_, i) => i + 1).map((c) => (
              <Link
                key={c}
                href={`/bible/${translation}/${bookId}/${c}`}
                onClick={onClose}
                className={`inline-flex items-center justify-center h-11 rounded text-small font-display border transition-colors ${
                  c === chapter
                    ? 'bg-brand-orange-dark text-on-primary border-brand-orange-dark'
                    : 'border-outline-variant text-on-surface-variant hover:border-primary'
                }`}
              >
                {c}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 5: Update barrel and run tests**

Add to `apps/web/src/components/bible/index.ts`:

```ts
export { BookGrid } from './book-grid';
export { BookChapterPicker } from './book-chapter-picker';
```

Run: `pnpm --filter @transformlit/web test -- components/bible`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/bible/
git commit -m "feat(bible): add book grid and book-chapter picker"
```

---

### Task 16: `components/bible/verse-list.tsx` — the chapter renderer

**Files:**
- Create: `apps/web/src/components/bible/verse-list.tsx`
- Test: `apps/web/src/components/bible/verse-list.spec.tsx`

**Interfaces:**
- Consumes: `ChapterContent`, `ChapterFootnote`, `ChapterWords`, `mapWordSpans`, `flattenVerseText`.
- Produces: `VerseList({ content, footnotes, words, selectedVerse, highlightedVerse, onVerseClick, onFootnoteClick, onWordClick })` — renders headings (Space Grotesk), line breaks, hebrew subtitles, poetry (indent by `poem`), wordsOfJesus (distinct tone), verse numbers as `.inline-target` buttons, footnote markers as `.inline-target` buttons, tappable word spans when `words` present; `id="v{n}"` + `scroll-mt-24` on verses.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/bible/verse-list.spec.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { VerseList } from './verse-list';
import type { ChapterContent, ChapterFootnote, ChapterWords } from '../../lib/bible/types';

const content: ChapterContent[] = [
  { type: 'heading', content: ['Living Sacrifices'] },
  { type: 'line_break' },
  {
    type: 'verse',
    number: 1,
    content: ['Therefore I urge you, brothers', { noteId: 0 }, ', by the mercies of God.'],
  },
];

const footnotes: ChapterFootnote[] = [
  { noteId: 0, text: 'Cited in Romans 6:13', caller: '+' },
];

describe('VerseList', () => {
  it('renders headings and verses with inline footnote markers', () => {
    render(
      <VerseList
        content={content}
        footnotes={footnotes}
        words={undefined}
        onVerseClick={() => {}}
        onFootnoteClick={() => {}}
      />,
    );
    expect(screen.getByText('Living Sacrifices')).toBeInTheDocument();
    expect(screen.getByText(/Therefore I urge you/)).toBeInTheDocument();
    expect(screen.getByLabelText('Footnote 0')).toBeInTheDocument();
  });

  it('calls onVerseClick when a verse number is tapped', () => {
    const onVerseClick = jest.fn();
    render(
      <VerseList
        content={content}
        footnotes={footnotes}
        words={undefined}
        onVerseClick={onVerseClick}
        onFootnoteClick={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText('Verse 1'));
    expect(onVerseClick).toHaveBeenCalledWith(1);
  });

  it('renders tappable word spans when words are provided', () => {
    const words: ChapterWords = {
      verses: {
        '1': [{ contentIndex: 0, start: 13, end: 18, strongs: ['G3870'], lemma: 'παρακαλέω' }],
      },
    };
    const onWordClick = jest.fn();
    render(
      <VerseList
        content={content}
        footnotes={footnotes}
        words={words}
        onVerseClick={() => {}}
        onFootnoteClick={() => {}}
        onWordClick={onWordClick}
      />,
    );
    fireEvent.click(screen.getByText('urge'));
    expect(onWordClick).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @transformlit/web test -- components/bible/verse-list.spec.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write VerseList**

Create `apps/web/src/components/bible/verse-list.tsx`:

```tsx
'use client';

import { Fragment } from 'react';
import type {
  ChapterContent,
  ChapterFootnote,
  ChapterWords,
  FormattedText,
  InlineHeading,
  InlineLineBreak,
  VerseFootnoteReference,
} from '../../lib/bible/types';
import { flattenVerseText, mapWordSpans } from '../../lib/bible/words';

interface VerseListProps {
  content: ChapterContent[];
  footnotes: ChapterFootnote[];
  words?: ChapterWords;
  selectedVerse?: number | null;
  highlightedVerse?: number | null;
  onVerseClick?: (verse: number) => void;
  onFootnoteClick?: (note: ChapterFootnote) => void;
  onWordClick?: (verse: number, word: ChapterWord) => void;
}

const POEM_INDENTS = ['pl-0', 'pl-2', 'pl-4', 'pl-6', 'pl-8'];

/** Cumulative text length of content items before `index` (matches words.ts baseAt math). */
function baseAt(content: VerseListProps['content'][number]['content'], index: number): number {
  let total = 0;
  for (let i = 0; i < index; i++) {
    const item = content[i];
    if (typeof item === 'string') total += item.length;
    else if (item && 'text' in item && typeof (item as FormattedText).text === 'string')
      total += (item as FormattedText).text.length;
    else if (item && 'heading' in item && typeof (item as InlineHeading).heading === 'string')
      total += (item as InlineHeading).heading.length;
  }
  return total;
}

function renderInline(
  item: string | FormattedText | InlineHeading | InlineLineBreak | VerseFootnoteReference,
  footnoteCaller: (noteId: number) => string,
  onFootnoteClick?: (note: ChapterFootnote) => void,
  key: number,
) {
  if (typeof item === 'string') return <Fragment key={key}>{item}</Fragment>;
  if ('lineBreak' in item && item.lineBreak) return <br key={key} />;
  if ('noteId' in item) {
    return (
      <sup key={key}>
        <button
          type="button"
          className="inline-target text-footnote-marker font-bold"
          aria-label={`Footnote ${item.noteId}`}
          onClick={() => onFootnoteClick?.({ noteId: item.noteId, text: '', caller: null })}
        >
          {footnoteCaller(item.noteId)}
        </button>
      </sup>
    );
  }
  if ('heading' in item) {
    return <span key={key} className="font-display font-bold">{item.heading}</span>;
  }
  const formatted = item as FormattedText;
  const className = [
    formatted.poem ? `block ${'pl-' + Math.min(formatted.poem, 4)}` : '',
    formatted.wordsOfJesus ? 'text-brand-orange-dark dark:text-primary-fixed' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span key={key} className={className}>
      {formatted.text}
    </span>
  );
}

export function VerseList({
  content,
  footnotes,
  words,
  selectedVerse,
  highlightedVerse,
  onVerseClick,
  onFootnoteClick,
  onWordClick,
}: VerseListProps) {
  const callerFor = (noteId: number): string => {
    const note = footnotes.find((f) => f.noteId === noteId);
    if (!note) return '';
    if (note.caller === '+' || note.caller === null) return String.fromCharCode(97 + noteId);
    return note.caller;
  };

  return (
    <div className="font-body text-body leading-relaxed text-on-surface space-y-4">
      {content.map((item, i) => {
        if (item.type === 'heading') {
          return (
            <h2 key={i} className="font-display text-headline-h3 font-bold text-on-surface pt-4 text-center">
              {item.content.join(' ')}
            </h2>
          );
        }
        if (item.type === 'line_break') return <div key={i} className="h-3" />;
        if (item.type === 'hebrew_subtitle') {
          return (
            <p key={i} className="italic text-on-surface-variant text-center text-small">
              {item.content
                .map((piece) =>
                  typeof piece === 'string' ? piece : 'text' in piece ? piece.text : '',
                )
                .join(' ')}
            </p>
          );
        }

        const verseWords = words?.verses?.[String(item.number)];
        const spans = verseWords ? mapWordSpans(item.content, verseWords) : [];

        const isSelected = selectedVerse === item.number;
        const isHighlighted = highlightedVerse === item.number;

        return (
          <div
            key={i}
            id={`v${item.number}`}
            className={`flex gap-3 scroll-mt-24 rounded-lg px-3 py-2 ${
              isSelected || isHighlighted
                ? 'bg-paper-warm dark:bg-surface-raised border-l-[3px] border-primary'
                : ''
            }`}
          >
            <button
              type="button"
              className="inline-target shrink-0 text-verse-number font-body text-body font-bold select-none"
              aria-label={`Verse ${item.number}`}
              onClick={() => onVerseClick?.(item.number)}
            >
              {item.number}
            </button>
            <p className="flex-1">
              {item.content.map((piece, j) => {
                // typeof guard FIRST — `in` on a string primitive throws TypeError
                if (typeof piece === 'string') {
                  const text = piece;
                  const pieceStart = baseAt(item.content, j);
                  const pieceSpans = spans.filter(
                    (s) => s.start >= pieceStart && s.end <= pieceStart + text.length,
                  );
                  if (pieceSpans.length === 0) return text;
                  let cursor = 0;
                  return (
                    <Fragment key={j}>
                      {pieceSpans.map((span, k) => {
                        const el = (
                          <Fragment key={k}>
                            {text.slice(cursor, span.start - pieceStart)}
                            <button
                              type="button"
                              className="inline-target underline decoration-dotted underline-offset-2 text-primary"
                              onClick={() => onWordClick?.(item.number, span.word)}
                            >
                              {text.slice(span.start - pieceStart, span.end - pieceStart)}
                            </button>
                          </Fragment>
                        );
                        cursor = span.end - pieceStart;
                        return el;
                      })}
                      {text.slice(cursor)}
                    </Fragment>
                  );
                }
                if ('lineBreak' in piece) return <br key={j} />;
                if ('noteId' in piece) {
                  return renderInline(piece, callerFor, onFootnoteClick, j);
                }
                if ('heading' in piece) {
                  return renderInline(piece, callerFor, onFootnoteClick, j);
                }
                // FormattedText: wrap word spans, keep wordsOfJesus/poem styling on the wrapper
                const formatted = piece as FormattedText;
                const text = formatted.text;
                const pieceStart = baseAt(item.content, j);
                const pieceSpans = spans.filter(
                  (s) => s.start >= pieceStart && s.end <= pieceStart + text.length,
                );
                const className = [
                  formatted.poem ? POEM_INDENTS[Math.min(formatted.poem, POEM_INDENTS.length - 1)] : '',
                  formatted.wordsOfJesus ? 'text-brand-orange-dark dark:text-primary-fixed' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                let cursor = 0;
                return (
                  <span key={j} className={className}>
                    {pieceSpans.length === 0
                      ? text
                      : pieceSpans.map((span, k) => {
                          const el = (
                            <Fragment key={k}>
                              {text.slice(cursor, span.start - pieceStart)}
                              <button
                                type="button"
                                className="inline-target underline decoration-dotted underline-offset-2 text-primary"
                                onClick={() => onWordClick?.(item.number, span.word)}
                              >
                                {text.slice(span.start - pieceStart, span.end - pieceStart)}
                              </button>
                            </Fragment>
                          );
                          cursor = span.end - pieceStart;
                          return el;
                        }).concat(text.slice(cursor) as unknown as React.ReactNode)}
                  </span>
                );
              })}
            </p>
          </div>
        );
      })}
    </div>
  );
}
```

Note: `onFootnoteClick` receives a resolved footnote — resolve `noteId → ChapterFootnote` inside the caller (see Task 19's StudySheet); the renderer passes a stub and StudySheet looks up the real note.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @transformlit/web test -- components/bible/verse-list.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/bible/verse-list.tsx apps/web/src/components/bible/verse-list.spec.tsx
git commit -m "feat(bible): add verse list renderer with study interactions"
```

---

### Task 17: `components/bible/audio-player.tsx` + `chapter-nav.tsx`

**Files:**
- Create: `apps/web/src/components/bible/audio-player.tsx`
- Create: `apps/web/src/components/bible/chapter-nav.tsx`
- Test: `apps/web/src/components/bible/audio-player.spec.tsx`

**Interfaces:**
- Consumes: none (presentational).
- Produces: `AudioPlayer({ links, onEnded })` — reader `<select>`, play/pause, progress, speed (1×/1.5×/2×), hidden when no links; `ChapterNav({ prev, next })` where `prev/next: { href, label } | null`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/bible/audio-player.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { AudioPlayer } from './audio-player';
import { ChapterNav } from './chapter-nav';

describe('AudioPlayer', () => {
  it('renders nothing when there are no links', () => {
    const { container } = render(<AudioPlayer links={{}} onEnded={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a reader select with the available readers', () => {
    render(<AudioPlayer links={{ gilbert: 'https://x/g.mp3', souer: 'https://x/s.mp3' }} onEnded={() => {}} />);
    expect(screen.getByLabelText('Reader')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });
});

describe('ChapterNav', () => {
  it('renders prev and next links', () => {
    render(
      <ChapterNav
        prev={{ href: '/bible/BSB/ROM/11', label: 'Romans 11' }}
        next={{ href: '/bible/BSB/ROM/13', label: 'Romans 13' }}
      />,
    );
    expect(screen.getByText('‹ Romans 11')).toBeInTheDocument();
    expect(screen.getByText('Romans 13 ›')).toBeInTheDocument();
  });

  it('renders a single disabled state when links are missing', () => {
    render(<ChapterNav prev={null} next={null} />);
    expect(screen.getByText('Start of the Bible')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @transformlit/web test -- components/bible/audio-player.spec.tsx`
Expected: FAIL — cannot find modules.

- [ ] **Step 3: Write AudioPlayer**

Create `apps/web/src/components/bible/audio-player.tsx`:

```tsx
'use client';

import { useRef, useState } from 'react';

interface AudioPlayerProps {
  links: Record<string, string>;
  onEnded: () => void;
}

const SPEEDS = [1, 1.5, 2];

export function AudioPlayer({ links, onEnded }: AudioPlayerProps) {
  const readers = Object.entries(links);
  const [reader, setReader] = useState(readers[0]?.[0] ?? '');
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  if (readers.length === 0) return null;

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      void audio.play();
      setPlaying(true);
    }
  };

  return (
    <div className="bg-surface-container-low dark:bg-surface-raised border border-outline-variant rounded-xl p-4 shadow-soft flex items-center gap-4">
      <audio
        ref={audioRef}
        src={links[reader]}
        onEnded={onEnded}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onDurationChange={(e) => setProgress(0)}
        hidden
      />
      <button
        type="button"
        onClick={toggle}
        className="w-11 h-11 rounded-full bg-brand-orange-dark text-on-primary flex items-center justify-center shrink-0"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        <span className="material-symbols-outlined">{playing ? 'pause' : 'play_arrow'}</span>
      </button>
      <div className="flex-1 flex flex-col gap-1">
        <div className="h-1.5 rounded-full bg-outline-variant overflow-hidden">
          <div
            className="h-full bg-primary transition-[width] duration-200"
            style={{ width: `${audioRef.current?.duration ? (progress / audioRef.current.duration) * 100 : 0}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1 text-micro text-on-surface-variant">
            Reader
            <select
              className="bg-transparent text-on-surface font-small text-small"
              value={reader}
              onChange={(e) => {
                setReader(e.target.value);
                setPlaying(false);
                if (audioRef.current) audioRef.current.currentTime = 0;
              }}
            >
              {readers.map(([key]) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-1">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className={`inline-target px-2 rounded text-micro font-bold ${
                  speed === s ? 'text-primary' : 'text-on-surface-variant'
                }`}
                onClick={() => {
                  setSpeed(s);
                  if (audioRef.current) audioRef.current.playbackRate = s;
                }}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write ChapterNav**

Create `apps/web/src/components/bible/chapter-nav.tsx`:

```tsx
'use client';

import Link from 'next/link';

export interface NavLink {
  href: string;
  label: string;
}

interface ChapterNavProps {
  prev: NavLink | null;
  next: NavLink | null;
}

export function ChapterNav({ prev, next }: ChapterNavProps) {
  if (!prev && !next) {
    return <p className="text-center text-on-surface-variant text-small py-6">Start of the Bible</p>;
  }
  return (
    <div className="flex items-center justify-between gap-4 py-6">
      {prev ? (
        <Link
          href={prev.href}
          className="flex-1 text-center px-4 py-3 rounded-lg border-2 border-brand text-brand dark:text-primary dark:border-primary font-display text-small font-bold hover:bg-brand hover:text-ink-black dark:hover:bg-primary dark:hover:text-on-primary transition-colors"
        >
          ‹ {prev.label}
        </Link>
      ) : (
        <span className="flex-1" />
      )}
      {next ? (
        <Link
          href={next.href}
          className="flex-1 text-center px-4 py-3 rounded-lg bg-brand-orange-dark text-on-primary font-display text-small font-bold hover:bg-brand-orange-dark/90 transition-colors"
        >
          {next.label} ›
        </Link>
      ) : (
        <span className="flex-1" />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Update barrel and run tests**

Add to `apps/web/src/components/bible/index.ts`:

```ts
export { AudioPlayer } from './audio-player';
export { ChapterNav } from './chapter-nav';
```

Run: `pnpm --filter @transformlit/web test -- components/bible`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/bible/
git commit -m "feat(bible): add audio player and chapter navigation"
```

---

### Task 18: `components/bible/study-sheet.tsx` (+ cross-ref list + word study)

**Files:**
- Create: `apps/web/src/components/bible/study-sheet.tsx`
- Create: `apps/web/src/components/bible/cross-ref-list.tsx`
- Create: `apps/web/src/components/bible/word-study-popover.tsx`
- Test: `apps/web/src/components/bible/study-sheet.spec.tsx`

**Interfaces:**
- Consumes: `Sheet`, `useCrossReferences`, `ChapterFootnote`, `CrossRefReference`, `ChapterWord`, `useBibleStore`, `refToHref`, `getBookName`.
- Produces: `StudySheet({ open, onClose, verse, verseText, footnotes, translation, book, chapter, onNavigate })` — header (reference), verse text, Copy action (navigator.clipboard + toast), Footnotes list, Cross-references chips (link into reader, `endVerse` ranges), Word study section (only when `wordsForVerse: ChapterWord[]` provided).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/bible/study-sheet.spec.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StudySheet } from './study-sheet';

jest.mock('../../lib/hooks/use-cross-references', () => ({
  useCrossReferences: () => ({ byVerse: {}, loading: false, load: jest.fn() }),
}));

const footnotes = [{ noteId: 0, text: 'Cited in Romans 6:13', caller: 'a' }];

describe('StudySheet', () => {
  it('shows verse, footnotes, and the empty cross-reference state', async () => {
    render(
      <StudySheet
        open
        onClose={() => {}}
        verse={1}
        verseText="Therefore I urge you, brothers…"
        footnotes={footnotes}
        wordsForVerse={[]}
        translation="BSB"
        book="ROM"
        chapter={12}
        bookName="Romans"
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByText('Romans 12:1')).toBeInTheDocument();
    expect(screen.getByText('Cited in Romans 6:13')).toBeInTheDocument();
    expect(screen.getByText('No cross-references for this verse.')).toBeInTheDocument();
  });

  it('navigates when a cross-reference chip is tapped', () => {
    const onNavigate = jest.fn();
    jest.spyOn(require('../../lib/hooks/use-cross-references'), 'useCrossReferences').mockReturnValue({
      byVerse: {
        1: [
          { book: 'ROM', chapter: 6, verse: 13, score: 1 },
          { book: 'HEB', chapter: 13, verse: 15, endVerse: 16, score: 0.5 },
        ],
      },
      loading: false,
      load: jest.fn(),
    });
    render(
      <StudySheet
        open
        onClose={() => {}}
        verse={1}
        verseText="text"
        footnotes={footnotes}
        wordsForVerse={[]}
        translation="BSB"
        book="ROM"
        chapter={12}
        bookName="Romans"
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByText('Romans 6:13'));
    expect(onNavigate).toHaveBeenCalledWith('/bible/BSB/ROM/6#v13');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @transformlit/web test -- components/bible/study-sheet.spec.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write cross-ref-list.tsx**

Create `apps/web/src/components/bible/cross-ref-list.tsx`:

```tsx
'use client';

import { getBookName } from '../../lib/bible/config';
import { refToHref } from '../../lib/bible/refs';
import type { CrossRefReference } from '../../lib/bible/types';

interface CrossRefListProps {
  refs: CrossRefReference[];
  translation: string;
  onNavigate: (href: string) => void;
}

export function CrossRefList({ refs, translation, onNavigate }: CrossRefListProps) {
  if (refs.length === 0) {
    return <p className="text-on-surface-variant text-small">No cross-references for this verse.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {refs.map((r, i) => {
        const label = `${getBookName(r.book)} ${r.chapter}:${r.verse}${r.endVerse ? `–${r.endVerse}` : ''}`;
        return (
          <button
            key={`${r.book}-${r.chapter}-${r.verse}-${i}`}
            type="button"
            onClick={() => onNavigate(refToHref(translation, r.book, r.chapter, r.verse))}
            className="px-3 py-1.5 rounded-full border border-outline-variant text-small font-display text-on-surface-variant hover:text-accent-teal-light hover:border-accent-teal-light transition-colors"
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Write word-study-popover.tsx**

Create `apps/web/src/components/bible/word-study-popover.tsx`:

```tsx
'use client';

import type { ChapterWord } from '../../lib/bible/types';

interface WordStudyPopoverProps {
  word: ChapterWord;
  text: string;
}

export function WordStudyPopover({ word, text }: WordStudyPopoverProps) {
  return (
    <div className="bg-surface-container-lowest dark:bg-surface-high border border-outline-variant rounded-lg shadow-lift p-4 max-w-xs">
      <p className="font-display text-small font-bold text-on-surface">{text}</p>
      <dl className="mt-2 flex flex-col gap-1 font-micro text-micro">
        {word.lemma && (
          <div className="flex justify-between">
            <dt className="text-on-surface-variant">Lemma</dt>
            <dd className="text-on-surface">{word.lemma}</dd>
          </div>
        )}
        {word.strongs && (
          <div className="flex justify-between">
            <dt className="text-on-surface-variant">Strong&apos;s</dt>
            <dd className="text-on-surface">{word.strongs.join(', ')}</dd>
          </div>
        )}
        {word.morph && (
          <div className="flex justify-between">
            <dt className="text-on-surface-variant">Morph</dt>
            <dd className="text-on-surface">{word.morph}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
```

- [ ] **Step 5: Write study-sheet.tsx**

Create `apps/web/src/components/bible/study-sheet.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Sheet } from '../ui/sheet';
import { useToast } from '../ui/toast';
import { CrossRefList } from './cross-ref-list';
import { WordStudyPopover } from './word-study-popover';
import { useCrossReferences } from '../../lib/hooks/use-cross-references';
import type { ChapterFootnote, ChapterWord, CrossRefReference } from '../../lib/bible/types';

interface StudySheetProps {
  open: boolean;
  onClose: () => void;
  verse: number | null;
  verseText: string;
  footnotes: ChapterFootnote[];
  wordsForVerse: ChapterWord[];
  translation: string;
  book: string;
  chapter: number;
  bookName: string;
  onNavigate: (href: string) => void;
}

export function StudySheet({
  open,
  onClose,
  verse,
  verseText,
  footnotes,
  wordsForVerse,
  translation,
  book,
  chapter,
  bookName,
  onNavigate,
}: StudySheetProps) {
  const { addToast } = useToast();
  const { byVerse, load } = useCrossReferences(book, chapter);
  const [activeWord, setActiveWord] = useState<ChapterWord | null>(null);
  const [activeWordText, setActiveWordText] = useState('');

  useEffect(() => {
    if (open && verse !== null) load();
  }, [open, verse, load]);

  useEffect(() => {
    setActiveWord(null);
  }, [verse]);

  const crossRefs: CrossRefReference[] = verse !== null ? (byVerse[verse] ?? []) : [];

  const reference = verse !== null ? `${bookName} ${chapter}:${verse}` : bookName;

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${verseText} (${reference})`);
      addToast('Copied.', 'success');
    } catch {
      addToast('Copy failed.', 'error');
    }
  }, [verseText, reference, addToast]);

  return (
    <Sheet open={open} onClose={onClose} title="Study" side="right">
      <div className="flex flex-col gap-5">
        <p className="font-display text-headline-h4 text-on-surface">{reference}</p>

        <blockquote className="font-body text-body text-on-surface border-l-[3px] border-primary pl-4 italic">
          {verseText}
        </blockquote>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={copy}
            className="flex-1 py-2.5 rounded-lg border-2 border-brand text-brand dark:text-primary dark:border-primary font-display text-small font-bold hover:bg-brand hover:text-ink-black dark:hover:bg-primary dark:hover:text-on-primary transition-colors"
          >
            Copy
          </button>
        </div>

        {footnotes.length > 0 && (
          <section>
            <h3 className="font-display text-headline-h4 text-on-surface mb-2">Footnotes</h3>
            <ul className="flex flex-col gap-2">
              {footnotes.map((note) => (
                <li key={note.noteId} className="font-body text-small text-on-surface-variant">
                  <span className="font-bold text-footnote-marker">{note.caller ?? ''}</span>{' '}
                  {note.text}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="font-display text-headline-h4 text-on-surface mb-2">Cross-references</h3>
          <CrossRefList refs={crossRefs} translation={translation} onNavigate={onNavigate} />
        </section>

        {wordsForVerse.length > 0 && (
          <section>
            <h3 className="font-display text-headline-h4 text-on-surface mb-2">Word study</h3>
            {activeWord ? (
              <WordStudyPopover word={activeWord} text={activeWordText} />
            ) : (
              <p className="text-on-surface-variant text-small">
                Tap a highlighted word in the verse to see its lemma, Strong&apos;s number, and morphology.
              </p>
            )}
          </section>
        )}
      </div>
    </Sheet>
  );
}
```

- [ ] **Step 6: Update barrel and run tests**

Add to `apps/web/src/components/bible/index.ts`:

```ts
export { StudySheet } from './study-sheet';
export { CrossRefList } from './cross-ref-list';
export { WordStudyPopover } from './word-study-popover';
```

Run: `pnpm --filter @transformlit/web test -- components/bible`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/bible/
git commit -m "feat(bible): add verse study sheet with footnotes, cross-refs, and word study"
```

---

### Task 19: Search UI — `search-panel.tsx` + `search-result-item.tsx`

**Files:**
- Create: `apps/web/src/components/bible/search-panel.tsx`
- Create: `apps/web/src/components/bible/search-result-item.tsx`
- Create: `apps/web/src/lib/hooks/use-bible-search.ts`
- Test: `apps/web/src/components/bible/search-panel.spec.tsx`

**Interfaces:**
- Consumes: `SearchClient`, `useBibleStore`, `refToHref`.
- Produces: `useBibleSearch(translation)` → `{ query, setQuery, results, indexing, progress, error, ensureIndex, search }` (debounced 200ms; kicks `ensureIndex` on first query); `SearchPanel({ translation, onResult })` renders input, index progress bar, results list via `SearchResultItem`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/bible/search-panel.spec.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SearchPanel } from './search-panel';
import { SearchClient } from '../../lib/bible/search/client';
import { getKVStore, setKVStore } from '../../lib/bible/storage';
import type { KVStore } from '../../lib/bible/storage';

class MemoryKV implements KVStore {
  private map = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> {
    return (this.map.get(key) as T | undefined) ?? null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }
  async del(key: string): Promise<void> {
    this.map.delete(key);
  }
}

jest.mock('../../lib/bible/search/client', () => {
  const actual = jest.requireActual('../../lib/bible/search/client');
  return { ...actual, SearchClient: jest.fn() };
});

const mockSearch = jest.fn();
(SearchClient as unknown as jest.Mock).mockImplementation(() => ({
  persistCorpus: jest.fn(),
  ensureIndex: jest.fn().mockResolvedValue(undefined),
  search: mockSearch,
  onProgress: jest.fn(),
  dispose: jest.fn(),
}));

describe('SearchPanel', () => {
  beforeEach(() => {
    setKVStore(new MemoryKV());
    mockSearch.mockReset();
    mockSearch.mockResolvedValue([
      { b: 'JHN', c: 3, v: 16, snippet: 'For God so …loved… the world', matchStart: 11, matchEnd: 16 },
    ]);
  });

  it('searches and renders results after typing', async () => {
    render(<SearchPanel translation="BSB" onResult={() => {}} />);
    fireEvent.change(screen.getByLabelText('Search the Bible'), { target: { value: 'loved' } });
    await waitFor(() => expect(screen.getByText(/John 3:16/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @transformlit/web test -- components/bible/search-panel.spec.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the hook**

Create `apps/web/src/lib/hooks/use-bible-search.ts`:

```ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SearchClient, type SearchClient as SearchClientType } from '../bible/search/client';
import type { SearchResult } from '../bible/search/matcher';
import { useBibleStore } from '../../store/bible-store';

export function useBibleSearch(translation: string) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [indexing, setIndexing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<SearchClientType | null>(null);
  const setIndexStatus = useBibleStore((s) => s.setIndexStatus);

  const getClient = useCallback(() => {
    if (!clientRef.current) clientRef.current = new SearchClient();
    return clientRef.current;
  }, []);

  const ensureIndex = useCallback(async () => {
    setIndexing(true);
    setProgress(0);
    const client = getClient();
    client.onProgress((phase, pct) => {
      setProgress(phase === 'downloading' ? pct / 2 : 50 + pct / 2);
    });
    try {
      await client.ensureIndex(translation);
      setIndexStatus(translation, 'ready');
    } catch {
      setError('Could not prepare this translation for search.');
    } finally {
      setIndexing(false);
    }
  }, [translation, getClient, setIndexStatus]);

  const search = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      const client = getClient();
      const found = await client.search(translation, q);
      setResults(found);
    },
    [translation, getClient],
  );

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      void search(query);
    }, 200);
    return () => clearTimeout(t);
  }, [query, search]);

  useEffect(() => () => clientRef.current?.dispose(), []);

  return { query, setQuery, results, indexing, progress, error, ensureIndex };
}
```

- [ ] **Step 4: Write the components**

Create `apps/web/src/components/bible/search-result-item.tsx`:

```tsx
'use client';

import { getBookName } from '../../lib/bible/config';
import { refToHref } from '../../lib/bible/refs';
import type { SearchResult } from '../../lib/bible/search/matcher';

interface SearchResultItemProps {
  result: SearchResult;
  translation: string;
  onNavigate: (href: string) => void;
}

export function SearchResultItem({ result, translation, onNavigate }: SearchResultItemProps) {
  const reference = `${getBookName(result.b)} ${result.c}:${result.v}`;
  const before = result.snippet.slice(0, result.matchStart);
  const match = result.snippet.slice(result.matchStart, result.matchEnd);
  const after = result.snippet.slice(result.matchEnd);

  return (
    <button
      type="button"
      onClick={() => onNavigate(refToHref(translation, result.b, result.c, result.v))}
      className="w-full text-left bg-surface-container-lowest dark:bg-surface-raised border border-outline-variant rounded-lg p-4 hover:border-primary transition-colors"
    >
      <span className="font-display text-small font-bold text-on-surface">{reference}</span>
      <p className="font-body text-body text-on-surface-variant mt-1">
        {before}
        <mark className="bg-transparent text-primary font-bold">{match}</mark>
        {after}
      </p>
    </button>
  );
}
```

Create `apps/web/src/components/bible/search-panel.tsx`:

```tsx
'use client';

import { useBibleSearch } from '../../lib/hooks/use-bible-search';
import { SearchResultItem } from './search-result-item';

interface SearchPanelProps {
  translation: string;
  onResult: (href: string) => void;
}

export function SearchPanel({ translation, onResult }: SearchPanelProps) {
  const { query, setQuery, results, indexing, progress, error, ensureIndex } = useBibleSearch(translation);

  return (
    <div className="flex flex-col gap-4">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          void ensureIndex();
        }}
        className="input"
        placeholder="Search the Bible…"
        aria-label="Search the Bible"
      />

      {indexing && (
        <div className="bg-surface-container-low dark:bg-surface-raised rounded-lg p-4">
          <p className="font-display text-small font-semibold text-on-surface">
            Preparing {translation} for search…
          </p>
          <div className="mt-2 h-2 rounded-full bg-outline-variant overflow-hidden">
            <div
              className="h-full bg-primary transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="font-micro text-micro text-on-surface-variant mt-1">
            One-time setup — stored locally on your device.
          </p>
        </div>
      )}

      {error && <p className="text-error text-small">{error}</p>}

      {!indexing && query.trim() && results.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="font-micro text-micro text-on-surface-variant">
            {results.length} match{results.length !== 1 ? 'es' : ''} in {translation}
          </p>
          {results.map((r) => (
            <SearchResultItem key={`${r.b}-${r.c}-${r.v}`} result={r} translation={translation} onNavigate={onResult} />
          ))}
        </div>
      )}

      {!indexing && query.trim() && results.length === 0 && !error && (
        <p className="text-on-surface-variant text-small">No matches.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Update barrel and run tests**

Add to `apps/web/src/components/bible/index.ts`:

```ts
export { SearchPanel } from './search-panel';
export { SearchResultItem } from './search-result-item';
```

Run: `pnpm --filter @transformlit/web test -- components/bible lib/hooks/use-bible-search.spec.tsx 2>/dev/null || pnpm --filter @transformlit/web test -- components/bible`
Expected: PASS (search-panel.spec.tsx exercises the mocked client; add `lib/hooks/use-bible-search.spec.tsx` if coverage dips below threshold).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/bible/ apps/web/src/lib/hooks/use-bible-search.ts
git commit -m "feat(bible): add search panel with index progress and results"
```

---

### Task 20: `/bible` route — library page + client

**Files:**
- Create: `apps/web/src/app/(app)/bible/page.tsx`
- Create: `apps/web/src/app/(app)/bible/bible-client.tsx`
- Test: `apps/web/src/app/(app)/bible/bible-client.spec.tsx`

**Interfaces:**
- Consumes: `useRequireAuth`, `useBibleBooks`, `useBibleStore`, `BookGrid`, `TranslationPicker`, `SearchPanel`, `QUICK_TRACKS`, `getCuratedTranslation`, `refToHref`.
- Produces: `/bible` page (`metadata` + `<Suspense><BibleClient /></Suspense>`), `BibleClient` — reads `?view=search&q=` via `useSearchParams`; header + translation chip (opens picker), Continue Reading card (from store `lastPosition[translation]`, hidden when empty), quick-track chips, search bar → search mode, Browse (OT/NT filter chips + BookGrid).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/(app)/bible/bible-client.spec.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BibleClient from './bible-client';
import * as booksHook from '../../../lib/hooks/use-bible-books';
import { useBibleStore } from '../../../store/bible-store';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/bible',
}));

jest.mock('../../../lib/hooks/use-require-auth', () => ({
  useRequireAuth: () => ({ isReady: true }),
}));

jest.mock('../../../lib/hooks/use-bible-books', () => ({
  useBibleBooks: jest.fn(),
}));

describe('BibleClient', () => {
  beforeEach(() => {
    (booksHook.useBibleBooks as jest.Mock).mockReturnValue({
      books: [],
      loading: false,
      error: null,
      reload: jest.fn(),
    });
    useBibleStore.setState({
      translation: 'BSB',
      lastPosition: { BSB: { book: 'ROM', chapter: 8 } },
      indexStatus: {},
      isHydrated: true,
    });
  });

  it('renders the header, continue reading, quick tracks, and browse', async () => {
    render(<BibleClient />);
    await waitFor(() => expect(screen.getByText('Bible')).toBeInTheDocument());
    expect(screen.getByText('Continue reading')).toBeInTheDocument();
    expect(screen.getByText('Romans 12')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @transformlit/web test -- app/\(app\)/bible/bible-client.spec.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the page**

Create `apps/web/src/app/(app)/bible/page.tsx`:

```tsx
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LoadingSpinner } from '../../../components/ui';
import BibleClient from './bible-client';

export const metadata: Metadata = {
  title: 'Bible — Transformlit',
};

export default function BibleRoute() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <BibleClient />
    </Suspense>
  );
}
```

- [ ] **Step 4: Write the client**

Create `apps/web/src/app/(app)/bible/bible-client.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useRequireAuth } from '../../../lib/hooks/use-require-auth';
import { useBibleBooks } from '../../../lib/hooks/use-bible-books';
import { useBibleStore } from '../../../store/bible-store';
import { BookGrid, TranslationPicker, SearchPanel } from '../../../components/bible';
import { LoadingSpinner } from '../../../components/ui';
import { QUICK_TRACKS, getCuratedTranslation, findCuratedTranslation } from '../../../lib/bible/config';
import { refToHref } from '../../../lib/bible/refs';

export default function BibleClient() {
  const { isReady } = useRequireAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get('view');
  const translationParam = searchParams.get('translation');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mode, setMode] = useState<'browse' | 'search'>(view === 'search' ? 'search' : 'browse');

  const translation = useBibleStore((s) => s.translation);
  const setTranslation = useBibleStore((s) => s.setTranslation);
  const lastPosition = useBibleStore((s) => s.lastPosition[translation]);
  const { books, loading } = useBibleBooks(translation);

  // Consume the ?translation= redirect param (canonicalized, case-insensitive)
  useEffect(() => {
    if (translationParam) {
      const curated = findCuratedTranslation(translationParam);
      if (curated) setTranslation(curated.id);
    }
  }, [translationParam, setTranslation]);

  const curated = getCuratedTranslation(translation);

  if (!isReady) return <LoadingSpinner />;

  const continueHref = lastPosition
    ? refToHref(translation, lastPosition.book, lastPosition.chapter)
    : null;

  return (
    <>
      <div className="max-w-[1200px] mx-auto px-4 md:px-5 flex flex-col gap-8">
        {/* Header */}
        <div className="flex items-center justify-between pt-2">
          <h1 className="font-display text-headline-h1 font-bold text-on-surface">Bible</h1>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-outline-variant bg-surface-container-low dark:bg-surface-raised text-small font-display font-semibold text-on-surface hover:border-primary transition-colors"
          >
            {curated?.id ?? translation} · {curated?.label ?? ''}
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">expand_more</span>
          </button>
        </div>

        {/* Continue reading */}
        {continueHref && (
          <Link
            href={continueHref}
            className="bg-paper-warm dark:bg-surface-raised border border-outline-variant rounded-xl p-6 shadow-soft flex items-center justify-between hover:border-primary transition-colors"
          >
            <div>
              <p className="font-micro text-micro uppercase tracking-[0.2em] text-brand-orange-dark mb-1">
                Continue reading
              </p>
              <p className="font-display text-headline-h3 font-bold text-on-surface">
                {getBookName(lastPosition.book)} {lastPosition.chapter}
              </p>
              <p className="font-micro text-micro text-on-surface-variant">{curated?.label}</p>
            </div>
            <span className="px-5 py-2.5 rounded-lg bg-brand-orange-dark text-on-primary font-display text-small font-bold">
              Resume
            </span>
          </Link>
        )}

        {/* Quick tracks */}
        <div className="flex flex-wrap gap-2">
          {QUICK_TRACKS.map((track) => (
            <Link
              key={track.label}
              href={refToHref(translation, track.book, track.chapter)}
              className="px-4 py-1.5 rounded-full border border-outline-variant text-small font-display text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
            >
              {track.label}
            </Link>
          ))}
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('browse')}
            className={`px-4 py-2 rounded-lg font-display text-small font-bold transition-colors ${
              mode === 'browse'
                ? 'bg-primary-container/25 text-on-primary-container border border-primary/40'
                : 'border border-outline-variant text-on-surface-variant'
            }`}
          >
            Browse
          </button>
          <button
            type="button"
            onClick={() => setMode('search')}
            className={`px-4 py-2 rounded-lg font-display text-small font-bold transition-colors ${
              mode === 'search'
                ? 'bg-primary-container/25 text-on-primary-container border border-primary/40'
                : 'border border-outline-variant text-on-surface-variant'
            }`}
          >
            Search
          </button>
        </div>

        {mode === 'search' ? (
          <SearchPanel
            translation={translation}
            onResult={(href) => {
              // router push preserves SPA state + the api module cache; hash scroll runs post-load in the reader
              void router.push(href);
            }}
          />
        ) : (
          <BookGrid books={books} translation={translation} loading={loading} />
        )}
      </div>

      <TranslationPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </>
  );
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @transformlit/web test -- app/\(app\)/bible`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\(app\)/bible/
git commit -m "feat(bible): add /bible library page with browse and search modes"
```

---

### Task 21: Reader route — redirect, reader page + client

**Files:**
- Create: `apps/web/src/app/(app)/bible/[translation]/page.tsx`
- Create: `apps/web/src/app/(app)/bible/[translation]/[book]/[chapter]/page.tsx`
- Create: `apps/web/src/app/(app)/bible/[translation]/[book]/[chapter]/bible-reader-client.tsx`
- Test: `apps/web/src/app/(app)/bible/[translation]/[book]/[chapter]/bible-reader-client.spec.tsx`

**Interfaces:**
- Consumes: `useChapter`, `useBibleBooks`, `useBibleStore`, `VerseList`, `StudySheet`, `AudioPlayer`, `ChapterNav`, `BookChapterPicker`, `refs`, `hasWordAnnotations`.
- Produces: `/bible/[translation]` → `redirect('/bible?translation=X')`; reader page (awaits `params`, uppercases book/chapter normalization, `generateMetadata` via `BOOK_NAMES`); `BibleReaderClient({ translation, book, chapter })` — chapter fetch, sticky toolbar (`sticky top-16`), verse tap → StudySheet, footnote tap → StudySheet (footnotes list), word tap → StudySheet word study, `#v{n}` hash highlight on mount, audio (auto-advance via `nextChapter`), prev/next nav, picker.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/(app)/bible/[translation]/[book]/[chapter]/bible-reader-client.spec.tsx`:

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import BibleReaderClient from './bible-reader-client';
import * as chapterHook from '../../../../../../lib/hooks/use-chapter';
import * as booksHook from '../../../../../../lib/hooks/use-bible-books';
import type { BibleChapter, TranslationBook } from '../../../../../../lib/bible/types';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/bible/BSB/ROM/12',
}));

jest.mock('../../../../../../lib/hooks/use-require-auth', () => ({
  useRequireAuth: () => ({ isReady: true }),
}));

jest.mock('../../../../../../lib/hooks/use-chapter', () => ({ useChapter: jest.fn() }));
jest.mock('../../../../../../lib/hooks/use-bible-books', () => ({ useBibleBooks: jest.fn() }));

const books: TranslationBook[] = [
  { id: 'ROM', name: 'Romans', commonName: 'Romans', title: null, order: 45, numberOfChapters: 16, firstChapterNumber: 1, lastChapterNumber: 16, totalNumberOfVerses: 433 },
];

const chapter: BibleChapter = {
  translation: { id: 'BSB', name: 'Berean Standard Bible', shortName: 'BSB' },
  book: books[0],
  thisChapterLink: '/api/BSB/ROM/12.json',
  nextChapterApiLink: '/api/BSB/ROM/13.json',
  previousChapterApiLink: '/api/BSB/ROM/11.json',
  numberOfVerses: 21,
  chapter: {
    number: 12,
    content: [
      { type: 'verse', number: 1, content: ['Therefore I urge you, brothers, by the mercies of God.'] },
    ],
    footnotes: [],
  },
};

describe('BibleReaderClient', () => {
  beforeEach(() => {
    (chapterHook.useChapter as jest.Mock).mockReturnValue({
      chapter,
      words: null,
      loading: false,
      error: null,
    });
    (booksHook.useBibleBooks as jest.Mock).mockReturnValue({
      books,
      loading: false,
      error: null,
      reload: jest.fn(),
    });
  });

  it('renders the toolbar and verse text', async () => {
    render(<BibleReaderClient translation="BSB" book="ROM" chapter={12} />);
    await waitFor(() => expect(screen.getByText('Romans 12')).toBeInTheDocument());
    expect(screen.getByText(/Therefore I urge you/)).toBeInTheDocument();
  });

  it('opens the study sheet when a verse is tapped', async () => {
    render(<BibleReaderClient translation="BSB" book="ROM" chapter={12} />);
    await waitFor(() => expect(screen.getByLabelText('Verse 1')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Verse 1'));
    expect(await screen.findByText('Romans 12:1')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @transformlit/web test -- "app/\(app\)/bible/\[translation\]"`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the redirect page**

Create `apps/web/src/app/(app)/bible/[translation]/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { findCuratedTranslation } from '../../../../lib/bible/config';

export default async function TranslationRedirect({
  params,
}: {
  params: Promise<{ translation: string }>;
}) {
  const { translation } = await params;
  const curated = findCuratedTranslation(translation);
  // Preserve the canonical case (BSB, eng_kjv, tgl_ulb…) and fall back to raw input.
  redirect(`/bible?translation=${encodeURIComponent(curated?.id ?? translation)}`);
}
```

- [ ] **Step 4: Write the reader page**

Create `apps/web/src/app/(app)/bible/[translation]/[book]/[chapter]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getBookName, findCuratedTranslation } from '../../../../../../lib/bible/config';
import BibleReaderClient from './bible-reader-client';

interface PageProps {
  params: Promise<{ translation: string; book: string; chapter: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { translation, book, chapter } = await params;
  const t = findCuratedTranslation(translation);
  return {
    title: `${getBookName(book.toUpperCase())} ${Number(chapter)} — ${t?.label ?? translation} — Transformlit`,
  };
}

export default async function ReaderRoute({ params }: PageProps) {
  const { translation, book, chapter } = await params;
  const t = findCuratedTranslation(translation);
  return (
    <BibleReaderClient
      translation={t?.id ?? translation}
      book={book.toUpperCase()}
      chapter={Number(chapter)}
    />
  );
}
```

- [ ] **Step 5: Write the reader client**

Create `apps/web/src/app/(app)/bible/[translation]/[book]/[chapter]/bible-reader-client.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useChapter } from '../../../../../../lib/hooks/use-chapter';
import { useBibleBooks } from '../../../../../../lib/hooks/use-bible-books';
import { useRequireAuth } from '../../../../../../lib/hooks/use-require-auth';
import { useBibleStore } from '../../../../../../store/bible-store';
import {
  VerseList,
  StudySheet,
  AudioPlayer,
  ChapterNav,
  BookChapterPicker,
} from '../../../../../../components/bible';
import { LoadingSpinner } from '../../../../../../components/ui';
import { flattenVerseText } from '../../../../../../lib/bible/words';
import { formatRef, nextChapter, prevChapter, refToHref } from '../../../../../../lib/bible/refs';
import { getBookName } from '../../../../../../lib/bible/config';
import type { ChapterFootnote, ChapterWord } from '../../../../../../lib/bible/types';

interface ReaderProps {
  translation: string;
  book: string;
  chapter: number;
}

export default function BibleReaderClient({ translation, book, chapter }: ReaderProps) {
  const router = useRouter();
  const { isReady } = useRequireAuth();
  const { chapter: data, words, loading, error } = useChapter(translation, book, chapter);
  const { books } = useBibleBooks(translation);

  const [studyVerse, setStudyVerse] = useState<number | null>(null);
  const [studyFootnote, setStudyFootnote] = useState<ChapterFootnote | null>(null);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeWord, setActiveWord] = useState<{ verse: number; word: ChapterWord } | null>(null);

  const setLastPosition = useBibleStore((s) => s.setLastPosition);

  useEffect(() => {
    setLastPosition(translation, { book, chapter });
  }, [translation, book, chapter, setLastPosition]);

  // #v{n} deep link — scroll AFTER content mounts (hash alone can't target async content)
  useEffect(() => {
    if (!data) return;
    const m = window.location.hash.match(/^#v(\d+)$/);
    if (!m) return;
    const verse = Number(m[1]);
    const el = document.getElementById(`v${verse}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlighted(verse);
      const timer = setTimeout(() => setHighlighted(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [data, book, chapter]);

  const navigate = useCallback(
    (href: string) => {
      router.replace(href);
    },
    [router],
  );

  const openStudyForVerse = useCallback((verse: number) => {
    setStudyFootnote(null);
    setActiveWord(null);
    setStudyVerse(verse);
  }, []);

  const handleFootnote = useCallback(
    (note: ChapterFootnote) => {
      const real = data?.chapter.footnotes.find((f) => f.noteId === note.noteId) ?? null;
      setStudyVerse(null);
      setActiveWord(null);
      setStudyFootnote(real);
    },
    [data],
  );

  const handleWord = useCallback((verse: number, word: ChapterWord) => {
    setStudyFootnote(null);
    setStudyVerse(verse);
    setActiveWord({ verse, word });
  }, []);

  const prev = useMemo(() => {
    if (!books.length) return null;
    const ref = prevChapter(books, book, chapter);
    return ref ? { href: refToHref(translation, ref.book.id, ref.chapter), label: formatRef(ref.book, ref.chapter) } : null;
  }, [books, book, chapter, translation]);

  const next = useMemo(() => {
    if (!books.length) return null;
    const ref = nextChapter(books, book, chapter);
    return ref ? { href: refToHref(translation, ref.book.id, ref.chapter), label: formatRef(ref.book, ref.chapter) } : null;
  }, [books, book, chapter, translation]);

  const studyVerseText =
    studyVerse !== null && data
      ? (data.chapter.content.find((c) => c.type === 'verse' && c.number === studyVerse) as
          | Extract<typeof data.chapter.content[number], { type: 'verse' }>
          | undefined)?.content
      : null;

  const wordsForVerse =
    studyVerse !== null && words?.verses?.[String(studyVerse)]
      ? words.verses[String(studyVerse)]
      : [];

  if (loading || !isReady) return <LoadingSpinner />;
  if (error || !data) {
    return <p className="text-error text-center py-12">Failed to load this chapter.</p>;
  }

  return (
    <>
      {/* Sticky toolbar */}
      <div className="sticky top-16 z-40 bg-surface/95 dark:bg-surface-dark/95 backdrop-blur border-b border-outline-variant">
        <div className="flex items-center justify-between px-1 py-2">
          <button
            type="button"
            onClick={() => router.push('/bible')}
            className="flex items-center gap-1 text-on-surface-variant hover:text-primary transition-colors"
            aria-label="Back to library"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div className="text-center">
            <p className="font-display text-headline-h4 font-bold text-on-surface">
              {formatRef(data.book, chapter)}
            </p>
            <p className="font-micro text-micro text-on-surface-variant">{data.translation.name}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="w-11 h-11 inline-flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors"
              aria-label="Choose book and chapter"
            >
              <span className="material-symbols-outlined">menu_book</span>
            </button>
          </div>
        </div>
      </div>

      {/* Chapter content */}
      <div className="max-w-[720px] mx-auto px-4 py-8">
        <VerseList
          content={data.chapter.content}
          footnotes={data.chapter.footnotes}
          words={words ?? undefined}
          selectedVerse={studyVerse}
          highlightedVerse={highlighted}
          onVerseClick={openStudyForVerse}
          onFootnoteClick={handleFootnote}
          onWordClick={handleWord}
        />

        {data.thisChapterAudioLinks && Object.keys(data.thisChapterAudioLinks).length > 0 && (
          <div className="mt-8">
            <AudioPlayer
              links={data.thisChapterAudioLinks}
              onEnded={() => {
                if (next) navigate(next.href);
              }}
            />
          </div>
        )}

        <ChapterNav prev={prev} next={next} />
      </div>

      {/* Study sheet */}
      <StudySheet
        open={studyVerse !== null || studyFootnote !== null}
        onClose={() => {
          setStudyVerse(null);
          setStudyFootnote(null);
          setActiveWord(null);
        }}
        verse={studyVerse}
        verseText={
          studyVerseText ? flattenVerseText(studyVerseText) : studyFootnote?.text ?? ''
        }
        footnotes={
          studyFootnote ? [studyFootnote] : data.chapter.footnotes.filter((f) =>
            studyVerseText?.some(
              (piece) =>
                typeof piece === 'object' && piece !== null && 'noteId' in piece && piece.noteId === f.noteId,
            ),
          )
        }
        wordsForVerse={wordsForVerse}
        translation={translation}
        book={book}
        chapter={chapter}
        bookName={getBookName(book)}
        onNavigate={navigate}
      />

      <BookChapterPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        books={books}
        translation={translation}
        bookId={book}
        chapter={chapter}
      />
    </>
  );
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @transformlit/web test -- "app/\(app\)/bible"`
Expected: PASS.

- [ ] **Step 7: Run the full suite + build**

Run: `pnpm --filter @transformlit/web test && pnpm --filter @transformlit/web build`
Expected: all specs pass; production build succeeds.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/\(app\)/bible/
git commit -m "feat(bible): add chapter reader route with study sheet, audio, and navigation"
```

---

### Task 22: End-to-end verification (manual + e2e)

**Files:**
- Modify: `apps/web/e2e/` (add `bible.spec.ts` if a Playwright e2e suite exists; otherwise document manual steps)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Manual smoke test (dev)**

Run: `pnpm dev`
Expected:
- `/bible` renders header, translation chip (BSB · Berean Standard Bible), quick tracks, browse grid (OT/NT filtered correctly).
- Click Genesis → `/bible/BSB/GEN/1` renders Genesis 1 with heading "The Creation", superscript verse numbers, footnote markers.
- Tap verse 1 → Study Sheet opens right drawer with verse text, footnotes, cross-references chips.
- Switch translation to ENGWEBP → open John 1 → words are tappable; tap one → word study shows lemma/Strong's/morph.
- Search "love" → indexing progress bar → results; click a result → reader at `#v{verse}` highlighted.
- Audio player on BSB chapter: play, reader select, speed, auto-advance on ended.
- Dark mode: toggle theme — all screens use dark tokens; verse numbers bright teal, footnote markers bright orange; selected verse has orange left border on dark.
- Bottom nav (mobile): 5 items, Bible active on /bible.
- `/bible/eng_kjv/rom/1` (lowercase translation + book) resolves to the canonical `eng_kjv` and renders Romans 1.

- [ ] **Step 2: e2e spec** — the suite EXISTS at `apps/web/e2e/` (`feed`, `auth`, `groups`, `friends` specs; `playwright.config.ts` boots API + web). There are no shared auth helpers — each spec logs in inline. Copy the pattern from `e2e/auth.spec.ts:16-22` (login via UI with `admin@transformlit.com` / `Transformlit123!`). Add `apps/web/e2e/bible.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('bible library → chapter → study sheet', async ({ page }) => {
  // inline login (same as e2e/auth.spec.ts)
  await page.goto('/login');
  await page.getByLabel(/Email/).fill('admin@transformlit.com');
  await page.getByLabel(/Password/).fill('Transformlit123!');
  await page.getByRole('button', { name: /Sign in/i }).click();

  await page.goto('/bible');
  await expect(page.getByRole('heading', { name: 'Bible' })).toBeVisible();
  await page.getByRole('link', { name: /Genesis/ }).first().click();
  await expect(page.getByText('The Creation')).toBeVisible();
  await page.getByLabel('Verse 1').click();
  await expect(page.getByRole('dialog')).toContainText('Genesis 1:1');
});
```

Run: `pnpm --filter @transformlit/web test:e2e`
Expected: PASS.

- [ ] **Step 3: Coverage check**

Run: `pnpm --filter @transformlit/web test:cov`
Expected: global thresholds met (lines 70 / branches 60 / functions 70 / statements 70). Add missing specs for any new `lib/bible` module or component that drops coverage.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/ 2>/dev/null || true
git commit -m "test(bible): add e2e coverage for library, reader, and study sheet"
```

---

## Accepted Deviations (design vs implementation)

These Stitch design elements are intentionally simplified in the implementation — stated so the observer's design review isn't silently contradicted:

1. **OT/NT filter chips (Bible Library):** the design shows toggle chips with the book grid below; the implementation renders both sections stacked (Old Testament section, then New Testament section) — an acceptable simplification, same information, one less interaction.
2. **Reader translation chip:** design v2's toolbar shows a tappable translation chip; the implementation renders the translation name as static text (switching translations happens from the library picker; mid-reader translation switching would require the chapter-count clamp and is deferred). The BookChapterPicker covers chapter navigation.
3. **Audio toolbar button:** design v2 shows a second round icon button in the toolbar to open the audio player; the implementation renders the standalone AudioPlayer card inline (above the footer nav) and drops the toolbar toggle — audio is reachable by scrolling, one less state.

## Self-Review Notes

- **Spec coverage:** All phase-1 requirements map to tasks — nav (2), routes (20-21), data layer (3-7), store (9), search (10-11, 19), study features (8, 16, 18), audio (17), translation picker (14), book grid/picker (15), Sheet primitive (13), dark tokens (1), e2e (22).
- **Placeholders:** none — every step carries real code or an exact command.
- **Type consistency:** `SearchCorpus`/`SearchResult`/`ChapterWord`/`TranslationBook`/`BibleChapter` names are used identically across tasks; `flattenVerseText` exported from `words.ts` and reused by `build-index.ts` (Task 10 imports it — verified); `refToHref`/`formatRef`/`nextChapter`/`prevChapter` signatures stable across Task 7 → 15/17/20/21. `formatRef` no longer referenced by StudySheet (uses the prebuilt `reference` string).
- **Known follow-up (not phase 1):** wire the feed's dead quick-track buttons (`feed-client.tsx:190-192`) and the topbar's search pill (`topbar.tsx:69-73`) to `/bible/...` links; unify `QUICK_TRACKS` (this plan) with `QUICK_TRACK_CHAPTERS` (`constants.ts:75`) — two sources of truth for the same three chapters, reconcile in the follow-up; Adam Clarke commentary; bookmarks/highlights (needs backend).