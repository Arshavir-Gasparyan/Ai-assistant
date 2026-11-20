'use client';

import { useEffect, useState } from 'react';
import { getHealth } from '@/lib/api';

type Status = 'checking' | 'online' | 'offline';

const POLL_MS = 15_000;

/**
 * Small indicator in the header that calls GET /health from the BROWSER.
 * It is the first real frontend → backend request, and proves CORS is configured.
 */
export function BackendStatus() {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    const controller = new AbortController();

    const check = async () => {
      try {
        await getHealth(controller.signal);
        setStatus('online');
      } catch {
        if (!controller.signal.aborted) setStatus('offline');
      }
    };

    void check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, []);

  const styles: Record<Status, { dot: string; label: string }> = {
    checking: { dot: 'bg-zinc-400', label: 'Checking API…' },
    online: { dot: 'bg-emerald-500', label: 'API online' },
    offline: { dot: 'bg-red-500', label: 'API offline' },
  };

  return (
    <span className="flex items-center gap-2 text-xs text-zinc-500" role="status">
      <span className={`h-2 w-2 rounded-full ${styles[status].dot}`} aria-hidden />
      {styles[status].label}
    </span>
  );
}
