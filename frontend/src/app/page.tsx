import { ComingSoon, PageHeader } from '@/components/page-header';

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" description="Upload and manage the documents the assistant can answer from." />
      <ComingSoon milestone={5}>Upload PDF and Markdown files, see processing status, inspect and delete documents.</ComingSoon>
    </>
  );
}
