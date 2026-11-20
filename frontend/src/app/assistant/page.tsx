import { ComingSoon, PageHeader } from '@/components/page-header';

export default function AssistantPage() {
  return (
    <>
      <PageHeader title="Assistant" description="Ask questions and get answers grounded in your documents, with citations." />
      <ComingSoon milestone={8}>Chat with streaming answers (M9), clickable citations, and conversation memory (M10).</ComingSoon>
    </>
  );
}
