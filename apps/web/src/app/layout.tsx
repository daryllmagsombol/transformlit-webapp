import type { Metadata } from 'next';
import { Space_Grotesk, Newsreader, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { ToastProvider } from '../components/ui';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'Transformlit',
  description: 'A community-driven platform for reading groups, book sharing, and literary engagement.',
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
      <body className={`${spaceGrotesk.variable} ${newsreader.variable} ${jetbrainsMono.variable}`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <ToastProvider>
            {children}
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
