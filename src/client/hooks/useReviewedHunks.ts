import { useCallback, useEffect, useState } from 'react';

/**
 * Hunk-level coverage ledger.
 *
 * Tracks which hunks the reviewer has marked reviewed, persisted to
 * localStorage per (repo, comparison) so progress survives restarts — the
 * retention half of a review. This is buddy's own state, kept entirely separate
 * from difit's file-level "viewed" set and from the comment session.
 */

interface UseReviewedHunks {
  reviewedHunks: Set<string>;
  /** Toggle a group of hunk keys together (a displayed hunk may cover several). */
  toggleHunks: (keys: string[]) => void;
  clear: () => void;
}

function storageKeyFor(contextKey: string | null): string | null {
  return contextKey ? `buddy.reviewedHunks:${contextKey}` : null;
}

function load(storageKey: string | null): Set<string> {
  if (!storageKey) return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? new Set(parsed.filter((k): k is string => typeof k === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

export function useReviewedHunks(contextKey: string | null): UseReviewedHunks {
  const storageKey = storageKeyFor(contextKey);
  const [reviewedHunks, setReviewedHunks] = useState<Set<string>>(() => load(storageKey));

  // Reload when the comparison context changes.
  useEffect(() => {
    setReviewedHunks(load(storageKey));
  }, [storageKey]);

  const persist = useCallback(
    (next: Set<string>) => {
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify([...next]));
        } catch {
          // storage full / unavailable — keep the in-memory set regardless.
        }
      }
    },
    [storageKey],
  );

  const toggleHunks = useCallback(
    (keys: string[]) => {
      if (keys.length === 0) return;
      setReviewedHunks((prev) => {
        const next = new Set(prev);
        const allReviewed = keys.every((k) => next.has(k));
        for (const key of keys) {
          if (allReviewed) next.delete(key);
          else next.add(key);
        }
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const clear = useCallback(() => {
    setReviewedHunks(new Set());
    if (storageKey) {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
    }
  }, [storageKey]);

  return { reviewedHunks, toggleHunks, clear };
}
