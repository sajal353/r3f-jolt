import { useEffect, useState } from "react";
import type Jolt from "jolt-physics";
import { useJolt } from "./useJolt";
import { useHandlerRef } from "./internal/useHandlerRef";
import type { BodyContactHandlers, BodyContactOptions } from "./types";

export const useBodyContacts = (
  body: Jolt.Body | undefined,
  handlers: BodyContactHandlers,
  options?: BodyContactOptions,
) => {
  const api = useJolt();
  const handlersRef = useHandlerRef(handlers);
  const [mount] = useState(() => ({ contactForce: options?.contactForce }));

  useEffect(() => {
    if (!body) return;

    const forwarded: BodyContactHandlers = {};

    if (handlersRef.current.onEnter) {
      forwarded.onEnter = (contact) => handlersRef.current.onEnter?.(contact);
    }

    if (handlersRef.current.onStay) {
      forwarded.onStay = (contact) => handlersRef.current.onStay?.(contact);
    }

    if (handlersRef.current.onExit) {
      forwarded.onExit = (contact) => handlersRef.current.onExit?.(contact);
    }

    return api.contacts.addBodyListener(
      body.GetID().GetIndexAndSequenceNumber(),
      forwarded,
      mount,
    );
  }, [api, body, handlersRef, mount]);
};
