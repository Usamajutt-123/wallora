'use client';

import { useEffect } from 'react';

/** Fires a single view event when the wallpaper page mounts. */
export default function ViewTracker({ id }: { id: string }) {
  useEffect(() => {
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, type: 'view' }),
      keepalive: true,
    }).catch(() => {});
  }, [id]);
  return null;
}
