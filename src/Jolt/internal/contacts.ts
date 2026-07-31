import { Vector3 } from "three";
import type Jolt from "jolt-physics";
import type {
  BodyContactHandlers,
  ContactHandlers,
  ContactInfo,
  ContactRegistry,
  JoltModule,
} from "../types";

type EventKind = "enter" | "stay" | "exit";

interface QueuedEvent {
  kind: EventKind;
  target: number;
  info: ContactInfo;
}

const createContactInfo = (): ContactInfo => ({
  bodyID: 0,
  userData: 0,
  shapeUserData: 0,
  point: new Vector3(),
  normal: new Vector3(),
  penetrationDepth: 0,
});

export const createContactRegistry = (
  Jolt: JoltModule,
  physicsSystem: Jolt.PhysicsSystem,
): ContactRegistry => {
  const listeners = new Set<ContactHandlers>();
  const bodyListeners = new Map<number, Set<BodyContactHandlers>>();
  const storeSubscribers = new Set<() => void>();

  const pool: ContactInfo[] = [];
  const queue: QueuedEvent[] = [];
  const lastKnownUserData = new Map<number, number>();

  let listener: Jolt.ContactListenerJS | null = null;
  let version = 0;
  let destroyed = false;

  const take = (): ContactInfo => pool.pop() ?? createContactInfo();

  const give = (info: ContactInfo) => {
    if (pool.length < 256) {
      pool.push(info);
    }
  };

  const wantsBodyEvents = (bodyID: number, kind: EventKind) => {
    const handlers = bodyListeners.get(bodyID);
    if (!handlers) return false;
    for (const handler of handlers) {
      if (kind === "enter" && handler.onEnter) return true;
      if (kind === "stay" && handler.onStay) return true;
      if (kind === "exit" && handler.onExit) return true;
    }
    return false;
  };

  const queueBodyEvent = (
    kind: EventKind,
    target: Jolt.Body,
    other: Jolt.Body,
    manifold: Jolt.ContactManifold,
  ) => {
    const targetID = target.GetID().GetIndexAndSequenceNumber();
    if (!wantsBodyEvents(targetID, kind)) return;

    const info = take();
    const otherID = other.GetID().GetIndexAndSequenceNumber();
    const point = manifold.GetWorldSpaceContactPointOn1(0);
    const normal = manifold.mWorldSpaceNormal;

    info.bodyID = otherID;
    info.userData = other.GetUserData();
    info.shapeUserData = other.GetShape().GetUserData();
    info.point.set(point.GetX(), point.GetY(), point.GetZ());
    info.normal.set(normal.GetX(), normal.GetY(), normal.GetZ());
    info.penetrationDepth = manifold.mPenetrationDepth;

    lastKnownUserData.set(otherID, info.userData);
    queue.push({ kind, target: targetID, info });
  };

  const queueExitEvent = (targetID: number, otherID: number) => {
    if (!wantsBodyEvents(targetID, "exit")) return;

    const info = take();
    info.bodyID = otherID;
    info.userData = lastKnownUserData.get(otherID) ?? 0;
    info.shapeUserData = 0;
    info.point.set(0, 0, 0);
    info.normal.set(0, 0, 0);
    info.penetrationDepth = 0;

    queue.push({ kind: "exit", target: targetID, info });
  };

  const install = () => {
    if (listener !== null) return;

    listener = new Jolt.ContactListenerJS();

    listener.OnContactValidate = (
      inBody1: number,
      inBody2: number,
      inBaseOffset: number,
      inCollisionResult: number,
    ) => {
      const body1 = Jolt.wrapPointer(inBody1, Jolt.Body);
      const body2 = Jolt.wrapPointer(inBody2, Jolt.Body);
      const baseOffset = Jolt.wrapPointer(inBaseOffset, Jolt.RVec3);
      const collisionResult = Jolt.wrapPointer(
        inCollisionResult,
        Jolt.CollideShapeResult,
      );

      for (const handlers of listeners) {
        if (
          handlers.onContactValidate?.(
            body1,
            body2,
            baseOffset,
            collisionResult,
          ) === false
        ) {
          return Jolt.ValidateResult_RejectAllContactsForThisBodyPair;
        }
      }

      return Jolt.ValidateResult_AcceptAllContactsForThisBodyPair;
    };

    const dispatchContact = (
      kind: "enter" | "stay",
      inBody1: number,
      inBody2: number,
      inManifold: number,
      ioSettings: number,
    ) => {
      const body1 = Jolt.wrapPointer(inBody1, Jolt.Body);
      const body2 = Jolt.wrapPointer(inBody2, Jolt.Body);
      const manifold = Jolt.wrapPointer(inManifold, Jolt.ContactManifold);
      const settings = Jolt.wrapPointer(ioSettings, Jolt.ContactSettings);

      for (const handlers of listeners) {
        if (kind === "enter") {
          handlers.onContactAdded?.(body1, body2, manifold, settings);
        } else {
          handlers.onContactPersisted?.(body1, body2, manifold, settings);
        }
      }

      if (bodyListeners.size > 0) {
        queueBodyEvent(kind, body1, body2, manifold);
        queueBodyEvent(kind, body2, body1, manifold);
      }
    };

    listener.OnContactAdded = (a, b, manifold, settings) =>
      dispatchContact("enter", a, b, manifold, settings);

    listener.OnContactPersisted = (a, b, manifold, settings) =>
      dispatchContact("stay", a, b, manifold, settings);

    listener.OnContactRemoved = (inSubShapePair: number) => {
      const pair = Jolt.wrapPointer(inSubShapePair, Jolt.SubShapeIDPair);

      for (const handlers of listeners) {
        handlers.onContactRemoved?.(pair);
      }

      if (bodyListeners.size > 0) {
        const id1 = pair.GetBody1ID().GetIndexAndSequenceNumber();
        const id2 = pair.GetBody2ID().GetIndexAndSequenceNumber();
        queueExitEvent(id1, id2);
        queueExitEvent(id2, id1);
      }
    };

    physicsSystem.SetContactListener(listener);
  };

  const uninstallIfIdle = () => {
    if (listener === null) return;
    if (listeners.size > 0 || bodyListeners.size > 0) return;

    physicsSystem.SetContactListener(null as unknown as Jolt.ContactListener);
    Jolt.destroy(listener);
    listener = null;
  };

  return {
    addListener: (handlers) => {
      if (destroyed) return () => {};
      listeners.add(handlers);
      install();

      return () => {
        listeners.delete(handlers);
        if (!destroyed) uninstallIfIdle();
      };
    },

    addBodyListener: (bodyID, handlers) => {
      if (destroyed) return () => {};

      let set = bodyListeners.get(bodyID);
      if (!set) {
        set = new Set();
        bodyListeners.set(bodyID, set);
      }
      set.add(handlers);
      install();

      return () => {
        const current = bodyListeners.get(bodyID);
        if (!current) return;

        current.delete(handlers);
        if (current.size === 0) {
          bodyListeners.delete(bodyID);
          lastKnownUserData.delete(bodyID);
        }
        if (!destroyed) uninstallIfIdle();
      };
    },

    subscribe: (callback) => {
      storeSubscribers.add(callback);
      return () => storeSubscribers.delete(callback);
    },

    getSnapshot: () => version,

    flush: () => {
      if (queue.length === 0) return;

      const pending = queue.splice(0, queue.length);

      for (const event of pending) {
        const handlers = bodyListeners.get(event.target);
        if (handlers) {
          for (const handler of handlers) {
            if (event.kind === "enter") handler.onEnter?.(event.info);
            else if (event.kind === "stay") handler.onStay?.(event.info);
            else handler.onExit?.(event.info);
          }
        }
        give(event.info);
      }

      version += 1;
      for (const callback of storeSubscribers) {
        callback();
      }
    },

    destroy: () => {
      destroyed = true;
      listeners.clear();
      bodyListeners.clear();
      storeSubscribers.clear();
      queue.length = 0;
      lastKnownUserData.clear();

      if (listener !== null) {
        physicsSystem.SetContactListener(null as unknown as Jolt.ContactListener);
        Jolt.destroy(listener);
        listener = null;
      }
    },
  };
};
