import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { SearchPanel } from '@/components/search/search-panel';

export default function SearchPage() {
  return (
    <>
      <PageHeader title="Search" description="Hybrid search across your documents: semantic plus keyword." />
      {/* SearchPanel reads the URL (useSearchParams). With Cache Components it must sit
          inside Suspense so the rest of the page can be prerendered. */}
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading search…</p>}>
        <SearchPanel />
      </Suspense>
    </>
  );
}
