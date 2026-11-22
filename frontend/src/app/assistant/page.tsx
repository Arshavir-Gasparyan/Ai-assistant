import { Chat } from '@/components/assistant/chat';
import { PageHeader } from '@/components/page-header';

export default function AssistantPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Assistant" description="Ask questions and get answers grounded in your documents, with citations." />
      <Chat />
    </div>
  );
}
