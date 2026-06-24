import type { Metadata } from 'next';
import { ThemeProvider } from 'next-themes';
import { ToastProvider } from '../components/ui';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'Transformlit',
  description: 'A community-driven platform for reading groups, book sharing, and literary engagement.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <ToastProvider>
            {children}
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
