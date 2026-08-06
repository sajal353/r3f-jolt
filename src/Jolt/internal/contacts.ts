import { Quaternion, Vector3 } from "three";
import type Jolt from "jolt-physics";
import type {
  BodyContactHandlers,
  ContactHandlers,
  ContactInfo,
  ContactRegistry,
  JoltModule,
  SurfaceVelocity,
} from "../types";

type EventKind = "enter" | "stay" | "exit";

const LAST_KNOWN_USER_DATA_LIMIT = 1024;

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
  const surfaceVelocities = new Map<number, SurfaceVelocity>();
  const storeSubscribers = new Set<() => void>();

  const pool: ContactInfo[] = [];
  const queue: QueuedEvent[] = [];
  const lastKnownUserData = new Map<number, number>();

  /**
   * Scratch for the two surface-velocity writes. The `temps` pool is not usable
   * here: this runs inside the step, twice per contact, and its four slots are
   * shared with the imperative body api, which a listener may also be calling.
   */
  const outLinear = new Jolt.Vec3();
  const outAngular = new Jolt.Vec3();

  const relLinear = new Vector3();
  const relAngular = new Vector3();
  const linear = new Vector3();
  const angular = new Vector3();
  const lever = new Vector3();
  const centre = new Vector3();
  const rotation = new Quaternion();
  const rotated = new Vector3();

  let listener: Jolt.ContactListenerJS | null = null;
  let version = 0;
  let destroyed = false;

  const take = (): ContactInfo => pool.pop() ?? createContactInfo();

  const give = (info: ContactInfo) => {
    if (pool.length < 256) {
      pool.push(info);
    }
  };

  /**
   * `onExit` fires from a `SubShapeIDPair` and nothing else — by then the other
   * body may already be gone, so its `userData` has to have been kept from the
   * last contact. The map is keyed by that *other* body, which is why it cannot
   * be cleared when a listener unsubscribes: the key space is not the listener's.
   * Bounded here instead, oldest first.
   */
  const remember = (bodyID: number, userData: number) => {
    lastKnownUserData.set(bodyID, userData);

    while (lastKnownUserData.size > LAST_KNOWN_USER_DATA_LIMIT) {
      const oldest = lastKnownUserData.keys().next();
      if (oldest.done) break;
      lastKnownUserData.delete(oldest.value);
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

    remember(otherID, info.userData);
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

  const readCentre = (target: Vector3, body: Jolt.Body) => {
    const centre = body.GetCenterOfMassPosition();
    return target.set(centre.GetX(), centre.GetY(), centre.GetZ());
  };

  /**
   * Jolt reads the angular term as a rotation about **body 1's** centre of mass,
   * so a spinning body that lands as body 2 would turn whatever it carries on
   * the spot instead of sweeping it round. Re-referencing the same surface
   * motion to body 1 leaves the angular part alone and adds the lever arm
   * between the two centres to the linear part.
   */
  const accumulate = (
    body: Jolt.Body,
    source: SurfaceVelocity,
    sign: number,
    centreOfBody1: Vector3,
  ) => {
    if (source.space === "world") {
      linear.copy(source.linear);
      angular.copy(source.angular);
    } else {
      const quat = body.GetRotation();
      rotation.set(quat.GetX(), quat.GetY(), quat.GetZ(), quat.GetW());

      linear.copy(source.linear).applyQuaternion(rotation);
      angular.copy(source.angular).applyQuaternion(rotation);
    }

    if (angular.lengthSq() > 0) {
      readCentre(lever, body);
      lever.subVectors(centreOfBody1, lever);
      linear.add(rotated.crossVectors(angular, lever));
    }

    relLinear.addScaledVector(linear, sign);
    relAngular.addScaledVector(angular, sign);
  };

  /**
   * Jolt reads these as body 2's world-space surface velocity minus body 1's,
   * and the broadphase decides which body is which — so the same belt has to
   * contribute with the opposite sign depending on where it landed in the pair.
   */
  const applySurfaceVelocity = (
    body1: Jolt.Body,
    body2: Jolt.Body,
    settings: Jolt.ContactSettings,
  ) => {
    const source1 = surfaceVelocities.get(
      body1.GetID().GetIndexAndSequenceNumber(),
    );
    const source2 = surfaceVelocities.get(
      body2.GetID().GetIndexAndSequenceNumber(),
    );

    if (!source1 && !source2) return;

    relLinear.set(0, 0, 0);
    relAngular.set(0, 0, 0);

    readCentre(centre, body1);

    if (source2) accumulate(body2, source2, 1, centre);
    if (source1) accumulate(body1, source1, -1, centre);

    outLinear.Set(relLinear.x, relLinear.y, relLinear.z);
    outAngular.Set(relAngular.x, relAngular.y, relAngular.z);

    settings.set_mRelativeLinearSurfaceVelocity(outLinear);
    settings.set_mRelativeAngularSurfaceVelocity(outAngular);
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

      // Before the user listeners, so a raw listener can still override a belt.
      if (surfaceVelocities.size > 0) {
        applySurfaceVelocity(body1, body2, settings);
      }

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
    if (surfaceVelocities.size > 0) return;

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
        }
        if (!destroyed) uninstallIfIdle();
      };
    },

    addSurfaceVelocity: (bodyID, source) => {
      const existing = surfaceVelocities.get(bodyID);
      if (existing) return { source: existing, release: () => {} };

      if (destroyed) return { source, release: () => {} };

      surfaceVelocities.set(bodyID, source);
      install();

      return {
        source,
        release: () => {
          surfaceVelocities.delete(bodyID);
          if (!destroyed) uninstallIfIdle();
        },
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
      if (destroyed) return;

      destroyed = true;
      listeners.clear();
      bodyListeners.clear();
      surfaceVelocities.clear();
      storeSubscribers.clear();
      queue.length = 0;
      lastKnownUserData.clear();

      Jolt.destroy(outLinear);
      Jolt.destroy(outAngular);

      if (listener !== null) {
        physicsSystem.SetContactListener(
          null as unknown as Jolt.ContactListener,
        );
        Jolt.destroy(listener);
        listener = null;
      }
    },
  };
};
