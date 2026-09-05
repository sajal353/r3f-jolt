import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Vector3 } from "three";
import type Jolt from "jolt-physics";
import { useJolt } from "./useJolt";
import { useHandlerRef } from "./internal/useHandlerRef";
import type { BodyContactHandlers, ContactInfo } from "./types";

export interface SensorHandlers {
  onIntersectionEnter?: (contact: ContactInfo) => void;
  onIntersectionStay?: (contact: ContactInfo) => void;
  onIntersectionExit?: (contact: ContactInfo) => void;
}

export interface UseSensorOptions {
  /** Fills `impactSpeed` and `impulse` on every contact. See `ContactInfo`. */
  contactForce?: boolean;
  /**
   * Jolt only keeps a sensor contact while the other body is **awake**, so a
   * crate that settles inside a trigger fires an exit without moving — measured,
   * one step after it falls asleep, and an enter again the moment it wakes.
   *
   * Left on, a body that goes to sleep inside the volume stays in `inside` and
   * its exit is held back until it genuinely leaves or is destroyed. Turn it off
   * for Jolt's raw behaviour.
   *
   * One case survives either way: if the **sensor** moves off a sleeping body,
   * no exit fires until that body wakes, because Jolt has no contact left to
   * remove. Set `allowSleeping: false` on the bodies you track if that matters.
   */
  keepSleeping?: boolean;
}

const copyContact = (contact: ContactInfo): ContactInfo => ({
  ...contact,
  point: new Vector3().copy(contact.point),
  normal: new Vector3().copy(contact.normal),
});

/**
 * Intersection events for a body created with `sensor: true`, plus the set of
 * bodies currently inside it.
 *
 * The set is the reason to reach for this over `useBodyContacts`: keeping one by
 * hand from a pair of enter/exit counters looks right and drifts, because a body
 * can leave by being destroyed or by falling asleep rather than by moving.
 */
export const useSensor = (
  body: Jolt.Body | undefined,
  handlers: SensorHandlers = {},
  options?: UseSensorOptions,
): [readonly number[]] => {
  const api = useJolt();
  const handlersRef = useHandlerRef(handlers);

  const [mount] = useState(() => ({
    contactForce: options?.contactForce === true,
    keepSleeping: options?.keepSleeping !== false,
    wantsStay: handlers.onIntersectionStay !== undefined,
  }));

  const [inside, setInside] = useState<readonly number[]>([]);

  /** `held` carries the exit event of a body asleep inside, ready to deliver. */
  const tracked = useRef<{
    inside: Set<number>;
    held: Map<number, ContactInfo>;
  }>({ inside: new Set(), held: new Map() });

  useEffect(() => {
    if (!body || body.IsSensor()) return;

    console.warn(
      "[r3f-jolt] useSensor: this body is not a sensor, so its contacts are " +
        "solid collisions rather than intersections. Pass `sensor: true` to " +
        "the body hook, or use `useBodyContacts`.",
    );
  }, [body]);

  useEffect(() => {
    if (!body) return;

    const state = tracked.current;
    const bodyID = body.GetID().GetIndexAndSequenceNumber();

    const publish = () => setInside([...state.inside]);

    const isAsleepInWorld = (otherID: number) => {
      const handle = new api.Jolt.BodyID(otherID);
      const added = api.bodyInterface.IsAdded(handle);
      const active = added && api.bodyInterface.IsActive(handle);
      api.Jolt.destroy(handle);
      return added && !active;
    };

    const forwarded: BodyContactHandlers = {
      onEnter: (contact) => {
        // A body waking inside the volume re-adds its contact; it never left.
        const held = state.held.delete(contact.bodyID);
        if (held || state.inside.has(contact.bodyID)) return;

        state.inside.add(contact.bodyID);
        publish();
        handlersRef.current.onIntersectionEnter?.(contact);
      },

      onExit: (contact) => {
        if (!state.inside.has(contact.bodyID)) return;

        if (mount.keepSleeping && isAsleepInWorld(contact.bodyID)) {
          state.held.set(contact.bodyID, copyContact(contact));
          return;
        }

        state.inside.delete(contact.bodyID);
        state.held.delete(contact.bodyID);
        publish();
        handlersRef.current.onIntersectionExit?.(contact);
      },
    };

    if (mount.wantsStay) {
      forwarded.onStay = (contact) =>
        handlersRef.current.onIntersectionStay?.(contact);
    }

    const unsubscribe = api.contacts.addBodyListener(bodyID, forwarded, {
      contactForce: mount.contactForce,
    });

    return () => {
      unsubscribe();
      state.inside.clear();
      state.held.clear();
    };
  }, [api, body, handlersRef, mount]);

  useFrame(() => {
    const state = tracked.current;
    if (state.held.size === 0) return;

    let changed = false;

    for (const [otherID, contact] of state.held) {
      const handle = new api.Jolt.BodyID(otherID);
      const stillHere = api.bodyInterface.IsAdded(handle);
      api.Jolt.destroy(handle);

      if (stillHere) continue;

      // Destroyed while asleep inside: Jolt took the contact away when it slept,
      // so this held event is the only exit the consumer will ever get.
      state.held.delete(otherID);
      state.inside.delete(otherID);
      changed = true;
      handlersRef.current.onIntersectionExit?.(contact);
    }

    if (changed) setInside([...state.inside]);
  });

  return [inside];
};
