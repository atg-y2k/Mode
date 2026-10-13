/** Small React helpers for the scene panels. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * A callback whose identity never changes but always calls the latest `fn`.
 * Modal's focus effect depends on `onClose`, so handlers passed to it must be
 * stable or every re-render would move focus back to the first field.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}

/** False after unmount — guards async continuations. */
export function useMountedRef(): { readonly current: boolean } {
  const ref = useRef(true);
  useEffect(() => {
    ref.current = true;
    return () => {
      ref.current = false;
    };
  }, []);
  return ref;
}

/** Whole seconds since `running` became true (0 while idle). */
export function useElapsedSeconds(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) {
      setSeconds(0);
      return;
    }
    const start = Date.now();
    setSeconds(0);
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running]);
  return seconds;
}
