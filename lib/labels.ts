/** Pretty display names for content sources — used on cards, detail pages, admin. */
export const SOURCE_LABELS: Record<string, string> = {
  nexwall: 'NexWall',
  animepixels: 'AnimePixels',
  wallhaven: 'Wallhaven',
  manual: 'WALLORA',
  demo: 'WALLORA',
};

export function sourceLabel(source: string | null | undefined): string {
  return SOURCE_LABELS[source ?? ''] ?? (source ? source.charAt(0).toUpperCase() + source.slice(1) : 'Source');
}
