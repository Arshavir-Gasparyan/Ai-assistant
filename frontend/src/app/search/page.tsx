import { ComingSoon, PageHeader } from '@/components/page-header';

export default function SearchPage() {
  return (
    <>
      <PageHeader title="Search" description="Hybrid search across your documents: semantic plus keyword." />
      <ComingSoon milestone={7}>See retrieved chunks with source information and ranking scores.</ComingSoon>
    </>
  );
}
