import { useEffect } from "react";
import { useJolt } from "./useJolt";
import { useHandlerRef } from "./internal/useHandlerRef";
import type { SoftBodyContactHandlers } from "./types";

/**
 * `useContactListener` for soft bodies. Both handlers run inside the step, so
 * they may read the bodies and the manifold but not add or remove anything.
 */
export const useSoftBodyContactListener = (
  handlers: SoftBodyContactHandlers,
) => {
  const api = useJolt();
  const handlersRef = useHandlerRef(handlers);

  useEffect(() => {
    const forwarded: SoftBodyContactHandlers = {};

    if (handlersRef.current.onSoftBodyContactValidate) {
      forwarded.onSoftBodyContactValidate = (...args) =>
        handlersRef.current.onSoftBodyContactValidate?.(...args);
    }

    if (handlersRef.current.onSoftBodyContactAdded) {
      forwarded.onSoftBodyContactAdded = (...args) =>
        handlersRef.current.onSoftBodyContactAdded?.(...args);
    }

    return api.contacts.addSoftBodyListener(forwarded);
  }, [api, handlersRef]);
};
