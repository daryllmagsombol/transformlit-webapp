# Transformlit PWA Release Checklist (Tasks 14A/14C)

Evidence path for the release gates in `2026-10-01-pwa-design.md`. Items are grouped by
where the evidence must be produced. **Local-only checks cannot substitute for
live-origin/device checks, and vice versa.** Sources are primary vendor docs; see
the end of this file.

Status legend: `[ ]` not done · `[x]` verified · `[~]` partially verified · `[BLOCKED]` environment blocked.

## P0 — Local (repo + local production build/server)

- [ ] Manifest (`app/manifest.ts`) emits valid name/`start_url`/scope/`display`/icons; maskable icon has safe area.
- [ ] `/sw.js` is served at root with `application/javascript` MIME and `Cache-Control: no-cache, no-store, must-revalidate`.
- [ ] `public/` is actually copied into the standalone output (Next standalone omits it by default); `/offline`, icons, manifest, `pwa-assets.json`, `/_next/static/**` all resolve locally.
- [ ] `Service-Worker-Allowed: /` present where scope is explicitly `/`.
- [ ] Effective CSP on the registration document contains `worker-src 'self'` (fallback chain `child-src`→`script-src`→`default-src` must not silently block registration).
- [ ] `/_next/static/**` responses carry `public, max-age=31536000, immutable`.
- [ ] Generated `sw.js` embeds release ID + inventory digest; mixed worker/inventory install fails; asset-only change yields a waiting worker (unit-covered in Task 3; re-confirm on the built artifact).
- [ ] Each Bible translation has recorded license metadata before its download control can enable; unknown rights stay disabled.

## P0 — Live origin and device (cannot be satisfied locally)

- [ ] `curl -sSI https://<origin>/sw.js` through Cloudflare: `cf-cache-status` is `BYPASS`/`DYNAMIC` (never `HIT`), plus correct `content-type`, `cache-control`, `service-worker-allowed`.
- [ ] Same headers confirmed direct against the ACA origin and a revision-label FQDN (proves Cloudflare is not masking an origin defect).
- [ ] `curl -sSI https://<origin>/` shows CSP `worker-src 'self'`.
- [ ] After a real deploy, an **old** hashed `/_next/static/**` chunk still returns 200/HIT (edge/CDN retention protects open tabs and installed PWAs).
- [ ] ACA revision mode/traffic weights/`maxInactiveRevisions` confirmed; rollout keeps the prior revision until old-hash traffic drains.
- [ ] iOS Safari and Android Chrome: install, go offline, reload, navigate; foreground-only behavior holds and background-sync paths degrade gracefully (iOS has no Background Sync/Periodic Sync/Background Fetch).
- [ ] Deploy pipeline contains no "Purge Everything"; only changed non-hashed URLs are purged.

## P1 — Live config audit

- [ ] Cloudflare Cache Rule matching `http.request.uri.path eq "/sw.js"` → Bypass cache (Cache Rules override Page Rules; last matching rule wins).
- [ ] No Worker/Snippet/Page Rule/Rocket Loader/HTML rewrite intercepting `/sw.js` or the app path.
- [ ] Cache Reserve (or equivalent durable edge storage) enabled for `/_next/static/**` if edge-eviction risk is unacceptable.

## P2 — Rights evidence (external)

- [ ] Written license/permission for each restricted translation that explicitly covers **offline/download storage, redistribution to end users, and format conversion** (not merely verse quotation limits). Store with the content metadata.
- [ ] Public-domain / CC translations may ship first; restricted translations remain online-only until rights are obtained.

## Key operational findings (from Lane D research)

- **Cloudflare caches by file extension, so `/sw.js` is cacheable by default.** Next's `no-store` normally prevents it, but Page Rules `Cache Everything`/Edge Cache TTL, Cache Rules, or Workers can override. Add an explicit **Cache Rule bypass** for `/sw.js`; use a **Cache Rule** (not a Response Header Transform Rule) to change caching behavior.
- **Never "Purge Everything" during a PWA deploy.** Rely on immutable hashed assets + durable edge cache; purge only changed non-hashed URLs.
- **Azure Container Apps `Single` revision mode deprovisions old revisions automatically**, so old hashed chunks disappear from origin. Retention must come from the CDN/edge (or an external static asset origin via `assetPrefix`), not from ACA revision pinning alone. `Multiple` mode + weights/labels can bridge rollouts.
- **Background Sync / Periodic Sync / Background Fetch are not supported on iOS Safari** and are absent in Firefox. Foreground retry is mandatory for correctness; background APIs are enhancements only, and handlers must be idempotent.
- **Bible rights are license-class dependent:** public-domain (e.g. BSB, WEB), CC (CC0/PDM permissive; ND forbids reformatting; NC restricts commercial use), DBL custom/open licenses, and all-rights-reserved with limited quotation permission (e.g. ESV's ~500-verse grant) which is **not** an offline-copy license.

## Sources

Next.js: PWA guide, `output: standalone`, `headers`/Cache-Control, `assetPrefix`.
Cloudflare: default cache behavior, Cache Rules (overview/settings/order/create), Response Header Transform Rules, Workers+cache, Page Rules.
Microsoft Learn: ACA revisions, traffic splitting, blue-green.
MDN/BCD: `Service-Worker-Allowed`, CSP `worker-src`, Background Sync, Background Fetch, offline/background operation.
Licensing: Creative Commons licenses/CC0/PDM, U.S. Copyright Office, Digital Bible Library, Crossway ESV permissions, eBible.

Caveats: cloud defaults vary by plan/location and can change; re-verify on the actual
account before final release. Licensing notes are guidance, not legal advice; the
specific source repository's license record is authoritative.
