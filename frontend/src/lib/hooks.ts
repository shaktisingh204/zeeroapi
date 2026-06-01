"use client";
// Shared data-fetching hooks — replace the repeated
// useState(loading/error/data)+useEffect+setInterval boilerplate across pages.
import { useCallback, useEffect, useRef, useState } from "react";

export interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: (d: T | null) => void;
}

export function useFetch<T>(fn: () => Promise<T>, deps: unknown[] = []): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(() => {
    setLoading(true);
    fnRef
      .current()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "request failed"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => reload(), [reload]);
  return { data, loading, error, reload, setData };
}

/** Like useFetch but also re-fetches every `ms` (live tables/dashboards). */
export function useFetchInterval<T>(fn: () => Promise<T>, ms: number, deps: unknown[] = []): FetchState<T> {
  const state = useFetch<T>(fn, deps);
  const { reload } = state;
  useEffect(() => {
    const t = setInterval(reload, ms);
    return () => clearInterval(t);
  }, [reload, ms]);
  return state;
}
