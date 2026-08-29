import type { Metadata } from 'next';
import { Space_Grotesk, Newsreader, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { ToastProvider } from '../components/ui';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'Transform Lit',
  description:
    'A non-profit organization reaching and preparing the next generation through servant-leadership trainings, moral-recovery-centered literature, and mental-health empowerment.',
  metadataBase: new URL('https://transformlit.com'),
  openGraph: {
    title: 'Transform Lit',
    description:
      'A non-profit organization reaching and preparing the next generation through servant-leadership trainings, moral-recovery-centered literature, and mental-health empowerment.',
    type: 'website',
    siteName: 'Transform Lit',
  },
  twitter: { card: 'summary' },
  alternates: { canonical: 'https://transformlit.com' },
};

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-space-grotesk',
});

const newsreader = Newsreader({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-newsreader',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
        <style>{`
          .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
          }
          .material-symbols-outlined.filled {
            font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24;
          }
        `}</style>
        <style>{`
          @media (prefers-reduced-motion: reduce) {
            [style*="opacity"] { opacity: 1 !important; transform: none !important; }
          }
        `}</style>
        <noscript>
          <style>{`[style*="opacity"] { opacity: 1 !important; transform: none !important; }`}</style>
        </noscript>
      </head>
      <body className={`${spaceGrotesk.variable} ${newsreader.variable} ${jetbrainsMono.variable} bg-background text-on-surface font-body overflow-x-hidden paper-texture`}>
        <ThemeProvider attribute="class" defaultTheme="light" disableTransitionOnChange>
          <ToastProvider>
            {children}
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
