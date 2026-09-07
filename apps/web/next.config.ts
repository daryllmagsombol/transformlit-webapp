import type { NextConfig } from 'next';

// The CSP is environment-aware: in dev the API runs cross-origin on
// http://localhost:3005 (the Playwright/dev harness), and Next dev + React dev
// need 'unsafe-eval' for Turbopack HMR / call-stack reconstruction. Production
// is same-origin (API under the app domain) so it stays strict. next.config is
// evaluated once per server/start, so NODE_ENV selects the right policy.
const IS_PROD = process.env.NODE_ENV === 'production';

const CSP_DIRECTIVES = [
  // Default: allow the app itself. Everything else must be listed explicitly.
  "default-src 'self'",
  // Next pre-renders with inline <script> for hydration payload + RSC flight data.
  // Without a middleware nonce, Next injects these as inline scripts, so a strict
  // script-src would blank the page. 'unsafe-inline' is the pragmatic tradeoff;
  // upgrading to a per-request nonce (via middleware) would let us drop it.
  // Dev additionally needs 'unsafe-eval' for React/Turbopack dev tooling.
  IS_PROD
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  // Inline <style> (layout fonts variable CSS, app styles) + style attributes.
  // https://fonts.googleapis.com is the <link> stylesheet for Manrope/Material Symbols.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // Web font files (next/font/google + Manrope/Material Symbols).
  "font-src 'self' data: https://fonts.gstatic.com https://fonts.googleapis.com",
  // Bible content/fonts/audio from helloao; seeded group media from GCS +
  // Google avatar CDN; felt-paper background texture from transparenttextures.
  "img-src 'self' data: https://bible.helloao.org https://www.transparenttextures.com https://*.blob.core.windows.net https://lh3.googleusercontent.com",
  // Chapter audio is streamed from the dedicated audio host (see thisChapterAudioLinks).
  "media-src 'self' https://bible.helloao.org https://audio.bible.helloao.org",
  // fetch() / XHR / WS go to the GraphQL API origin. Prod API is same-origin
  // ('self') with https/wss for WS. Dev API is cross-origin on
  // http://localhost:3005, which must be listed explicitly (http: alone is not
  // granted). ws: covers the dev HMR socket.
  IS_PROD
    ? "connect-src 'self' https: wss: ws:"
    : "connect-src 'self' http://localhost:3005 https: wss: ws:",
  // No third-party frames are embedded.
  "frame-src 'none'",
  // base-uri locked to self; prevents <base> hijacking.
  "base-uri 'self'",
  // form-action locked to self.
  "form-action 'self'",
  // No upstream object/worker embedding from other origins.
  "object-src 'none'",
];

/** Split a single CSP string into an object of directive → value arrays for Next. */
function cspDirectives(): Record<string, string[]> {
  const obj: Record<string, string[]> = {};
  for (const directive of CSP_DIRECTIVES) {
    const [name, ...rest] = directive.split(/\s+/);
    obj[name] = rest;
  }
  return obj;
}

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.blob.core.windows.net' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },
  // Build-time type safety is enforced during `next build` (see next build step).
  typescript: { ignoreBuildErrors: false },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Prevent MIME-type sniffing and drive the declared content-type.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Deny embedding this app in any frame/iframe (protects against clickjacking).
          { key: 'X-Frame-Options', value: 'DENY' },
          // Only send the origin on cross-origin navigations, keep full URL same-origin.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Restrict available browser features/permissions.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()',
          },
          {
            key: 'Content-Security-Policy',
            value: Object.entries(cspDirectives())
              .map(([k, v]) => `${k} ${v.join(' ')}`.trim())
              .join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;