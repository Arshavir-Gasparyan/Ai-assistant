export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-zinc-500">{description}</p>
    </div>
  );
}

/** Placeholder card for features that arrive in later milestones. */
export function ComingSoon({ milestone, children }: { milestone: number; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-sm text-zinc-500 dark:border-zinc-700">
      <p className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">Coming in Milestone {milestone}</p>
      {children}
    </div>
  );
}
