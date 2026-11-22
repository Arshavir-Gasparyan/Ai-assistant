import { DocumentsDashboard } from '@/components/dashboard/documents-dashboard';
import { PageHeader } from '@/components/page-header';

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" description="Upload and manage the documents the assistant can answer from." />
      <DocumentsDashboard />
    </>
  );
}
