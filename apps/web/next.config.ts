import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.blob.core.windows.net' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },
  // Skip type checking during build (TS already checked separately)
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
