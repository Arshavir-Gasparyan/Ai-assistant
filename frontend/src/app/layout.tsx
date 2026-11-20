import type { Metadata } from 'next';
import { BackendStatus } from '@/components/backend-status';
import { Nav } from '@/components/nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Knowledge Assistant',
  description: 'Ask questions about your documents and get grounded answers with citations.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-6">
              <span className="font-semibold">Knowledge Assistant</span>
              <Nav />
            </div>
            <BackendStatus />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
