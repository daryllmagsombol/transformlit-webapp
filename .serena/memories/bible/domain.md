# Bible Domain (Web)

## Data source — NOT our API

Content comes from the free external API **bible.helloao.org** (`BIBLE_API_BASE` in
`lib/bible/config.ts`). Not GraphQL, not our Postgres. Shape mirrors the "standard format".

- Endpoints: `/{translation}/books.json`, `/{translation}/{book}/{chapter}.json`,
  `/{translation}/{book}/{chapter}.words.json` (optional Strong's data), plus
  `/d/open-cross-ref/{book}/{chapter}.json` for cross-references.
- `lib/bible/api.ts` `fetchBible()` does ETag + module-level cache (with inflight dedupe).
  A failed first fetch is dropped from cache deliberately, so retries re-fetch.
- API path is built by **string interpolation** — raw route params must be validated first.

## Curated translations (`lib/bible/config.ts`)

Only these ids are accepted: `BSB` (default, **no Strong's**), `ENGWEBP` (**has Strong's**),
`eng_kjv`, `eng_asv`, `eng_web`, `tgl_ulb`. Ids are **mixed-case**; lookups are
case-insensitive (`findCuratedTranslation`). `hasWords`/`hasAudio` flags drive UI affordances.

## Files that matter

| Concern | File |
|---|---|
| Route param validation (pure, unit-tested) | `lib/bible/chapter-route.ts` → used by the dynamic route's server page |
| Types (`BibleChapter`, `ChapterWord`, `ChapterWords`) | `lib/bible/types.ts` |
| Word span math (flattened-text offsets) | `lib/bible/words.ts` (`mapWordSpans`, `hasWordAnnotations`) |
| Href building (`#v{n}` hash contract) | `lib/bible/refs.ts` (`refToHref`) |
| Local persistence | `lib/bible/storage.ts` (IndexedDB KV, db `transformlit-bible`) |
| Client search index | `lib/bible/search/` (web worker: `build-index`, `matcher`, `client`, `worker-factory`) |
| Data hooks | `lib/hooks/use-chapter.ts`, `use-bible-books.ts`, `use-cross-references.ts`, `use-bible-search.ts` |
| Persisted position | `store/bible-store.ts` (`lastPosition[translation]`, `translation`) |

Components: `components/bible/` — `verse-list` (renders words/verses/footnotes),
`study-sheet` (verse/word panel), `word-study-popover`, `book-chapter-picker`,
`translation-picker`, `book-grid`, `chapter-nav`, `audio-player`, `search-panel`, `cross-ref-list`.

## Invariants & gotchas

- **`ENGWEBP` is the only curated translation with Strong's/word data.** Testing word-study
  on `BSB` will show nothing — that is a data gap, not a bug.
- Words render only when `chapter.thisChapterWordsLink` is truthy (`hasWordAnnotations`);
  a `words.json` failure degrades silently to "no word study".
- `#v{n}` deep links: the reader scrolls via a **bounded rAF retry** and must also scroll
  from its own `navigate()` — Next.js `pushState`/`replaceState` do NOT emit `hashchange`,
  so a `hashchange`-only implementation fails for in-app cross-references.
- `<dialog>` overlays (study sheet) must keep the `open` attribute — see
  `mem:bible-strongs-popup-dialog-pitfall`.

## Related

- Route/component mapping: `mem:web/routes`
- Verifying visually: `mem:verification/browser-and-blindspots`
