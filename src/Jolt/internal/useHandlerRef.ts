import { useEffect, useRef } from "react";

/**
 * Holds the newest handler object for a subscription that is registered once.
 *
 * The contact registry keeps its subscribers for the lifetime of the component,
 * so the registered functions have to reach the current render's closures
 * without re-subscribing. The assignment lives in an effect rather than in the
 * render body because writing a ref during render is a side effect, and the
 * React Compiler lint rules reject it.
 */
export const useHandlerRef = <T>(handlers: T) => {
  const ref = useRef(handlers);

  useEffect(() => {
    ref.current = handlers;
  });

  return ref;
};
