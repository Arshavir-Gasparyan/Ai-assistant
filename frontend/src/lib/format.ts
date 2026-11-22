export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
export const formatDate = (iso: string) => dateFormat.format(new Date(iso));

/** "page 2" or the heading path, used to label where a chunk came from. */
export function chunkLocation(c: { heading: string | null; pageNumber: number | null }): string {
  if (c.heading) return c.heading;
  if (c.pageNumber) return `page ${c.pageNumber}`;
  return 'no section';
}
