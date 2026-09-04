/**
 * WALLORA hardening — tiny, dependency-free in-memory sliding-window limiter.
 *
 * Use it for request throttling where a durable store is not available
 * (Vercel serverless). IMPORTANT: memory is per warm instance, so these
 * limits are defense-in-depth, not a global guarantee. Combine with the
 * platform's edge rate limiting for a hard global ceiling.
 */
export interface WindowLimiter {
  /** Returns true when a request is inside the allowed window, else false. */
  allow(key: string): boolean;
  /** Current distinct keys being tracked (for diagnostics). */
  size(): number;
}

export function createWindowLimiter(opts: {
  windowMs: number;
  max: number;
  maxKeys?: number;
}): WindowLimiter {
  const { windowMs, max, maxKeys = 20_000 } = opts;
  const store = new Map<string, number[]>();

  return {
    allow(key: string): boolean {
      const now = Date.now();
      let stamps = store.get(key);
      if (!stamps) {
        stamps = [];
        store.set(key, stamps);
      }
      // drop timestamps outside the sliding window
      while (stamps.length && stamps[0] <= now - windowMs) stamps.shift();
      if (stamps.length >= max) return false;
      stamps.push(now);
      // memory guard — never let an attacker grow the map unbounded
      if (store.size > maxKeys) {
        const oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
      }
      return true;
    },
    size() {
      return store.size;
    },
  };
}
