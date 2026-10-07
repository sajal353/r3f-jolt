import { useContext, useEffect, type RefObject } from "react";
import { physicsDebugContext } from "../context";

/**
 * A hook's debug overlay, built when it is shown and disposed when it is
 * hidden, so a body whose debug stays off never pays for one. Separate from the
 * owner's own lifecycle because `<Physics debug>` can flip while the owner
 * lives on.
 */
export interface DebugView<T> {
  readonly current: T | null;
  show: () => void;
  hide: () => void;
}

export const createDebugView = <T>(
  build: () => T,
  release: (view: T) => void,
): DebugView<T> => {
  let current: T | null = null;

  return {
    get current() {
      return current;
    },

    show: () => {
      current ??= build();
    },

    hide: () => {
      if (current === null) return;
      release(current);
      current = null;
    },
  };
};

/**
 * The hook's own `debug` when it set one — read once, at mount, like every
 * other creation option — and otherwise `<Physics debug>`, which is live.
 */
export const useDebugFlag = (own: boolean | undefined) => {
  const inherited = useContext(physicsDebugContext);
  return own ?? inherited;
};

/**
 * Shows `view` while `enabled`. Keyed on the owner's published api, so a body
 * rebuilt under a new `key` gets a fresh overlay rather than the old one's.
 */
export const useDebugView = (
  owner: object | undefined,
  view: RefObject<DebugView<unknown> | null>,
  enabled: boolean,
) => {
  useEffect(() => {
    const current = view.current;
    if (!owner || !enabled || !current) return;

    current.show();
    return current.hide;
  }, [owner, view, enabled]);
};
