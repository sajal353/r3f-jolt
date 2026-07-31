import { useEffect } from "react";
import { useJolt } from "./useJolt";
import { useHandlerRef } from "./internal/useHandlerRef";
import type { ContactHandlers } from "./types";

export const useContactListener = (handlers: ContactHandlers) => {
  const api = useJolt();
  const handlersRef = useHandlerRef(handlers);

  useEffect(() => {
    const forwarded: ContactHandlers = {};

    if (handlersRef.current.onContactValidate) {
      forwarded.onContactValidate = (...args) =>
        handlersRef.current.onContactValidate?.(...args);
    }

    if (handlersRef.current.onContactAdded) {
      forwarded.onContactAdded = (...args) =>
        handlersRef.current.onContactAdded?.(...args);
    }

    if (handlersRef.current.onContactPersisted) {
      forwarded.onContactPersisted = (...args) =>
        handlersRef.current.onContactPersisted?.(...args);
    }

    if (handlersRef.current.onContactRemoved) {
      forwarded.onContactRemoved = (...args) =>
        handlersRef.current.onContactRemoved?.(...args);
    }

    return api.contacts.addListener(forwarded);
  }, [api, handlersRef]);
};
