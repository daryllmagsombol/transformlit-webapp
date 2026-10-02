import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Transform Lit',
    short_name: 'Transform Lit',
    description: 'A thoughtful place for reading with purpose.',
    start_url: '/offline',
    scope: '/',
    display: 'standalone',
    background_color: '#fff8f4',
    theme_color: '#845400',
    icons: [
      { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
