import { Vector3 } from "three";
import type Jolt from "jolt-physics";
import type {
  JoltModule,
  SoftBodyContactHandlers,
  StepRegistry,
} from "../types";

type EventKind = "enter" | "stay" | "exit";

/** What the rigid contact registry lends this one, so both share a queue. */
export interface SoftContactSink {
  /** True while any body listener exists. */
  watching: () => boolean;
  wants: (bodyID: number, kind: EventKind) => boolean;
  emit: (
    kind: "enter" | "stay",
    target: number,
    other: number,
    userData: number,
    shapeUserData: number,
    point: Vector3,
    normal: Vector3,
  ) => void;
  exit: (target: number, other: number) => void;
}

interface SoftPairs {
  body: Jolt.Body;
  /** Other body → the step it was last touched in. */
  others: Map<number, number>;
}

/**
 * Byte offsets in Jolt's 80-byte `SoftBodyVertex`, after the three vectors and
 * the collision plane. Neither is in `SoftBodyVertexTraits`; `tests/softBody`
 * fails if a binding moves them.
 */
export const COLLIDING_SHAPE_BYTE = 64;
export const HAS_CONTACT_BYTE = 68;
const VERTEX_BYTES = 80;

/**
 * Soft-body contacts in the vocabulary the rigid ones use. Jolt calls
 * `OnSoftBodyContactAdded` every step a soft body touches something and never
 * says when it stops, so each pair is stamped with the step it was last seen in
 * and a sweep after the step turns a missed stamp into `onExit`. A soft body
 * that is asleep reports nothing, so its pairs are left alone until it wakes —
 * falling asleep on the floor is not leaving it.
 */
export const createSoftContacts = (
  jolt: JoltModule,
  physicsSystem: Jolt.PhysicsSystem,
  steps: StepRegistry,
  sink: SoftContactSink,
) => {
  const listeners = new Set<SoftBodyContactHandlers>();
  const pairs = new Map<number, SoftPairs>();
  const lock = physicsSystem.GetBodyLockInterfaceNoLock();
  const point = new Vector3();
  const normal = new Vector3();
  const flipped = new Vector3();
  const shapesSeen: number[] = [];

  let listener: Jolt.SoftBodyContactListenerJS | null = null;
  let stopSweeping: (() => void) | null = null;
  let stepIndex = 0;

  const touch = (
    soft: Jolt.Body,
    softID: number,
    otherBodyID: Jolt.BodyID,
  ) => {
    const otherID = otherBodyID.GetIndexAndSequenceNumber();

    let entry = pairs.get(softID);
    if (!entry) {
      entry = { body: soft, others: new Map() };
      pairs.set(softID, entry);
    }

    const last = entry.others.get(otherID);
    if (last === stepIndex) return;
    entry.others.set(otherID, stepIndex);

    const kind = last === undefined ? "enter" : "stay";
    const softSide = sink.wants(softID, kind);
    const otherSide = sink.wants(otherID, kind);
    if (!softSide && !otherSide) return;

    if (softSide) {
      const other = lock.TryGetBody(otherBodyID);
      const valid = jolt.getPointer(other) !== 0;
      sink.emit(
        kind,
        softID,
        otherID,
        valid ? other.GetUserData() : 0,
        valid ? other.GetShape().GetUserData() : 0,
        point,
        normal,
      );
    }

    if (otherSide) {
      flipped.copy(normal).negate();
      sink.emit(kind, otherID, softID, soft.GetUserData(), 0, point, flipped);
    }
  };

  const record = (soft: Jolt.Body, manifold: Jolt.SoftBodyManifold) => {
    const softID = soft.GetID().GetIndexAndSequenceNumber();
    const vertices = manifold.GetVertices();
    const count = vertices.size();
    const origin = soft.GetPosition();
    const originX = origin.GetX();
    const originY = origin.GetY();
    const originZ = origin.GetZ();

    if (count > 0) {
      const base = jolt.getPointer(vertices.at(0));
      shapesSeen.length = 0;

      for (let index = 0; index < count; index += 1) {
        const at = base + index * VERTEX_BYTES;
        if (jolt.HEAPU8[at + HAS_CONTACT_BYTE] === 0) continue;

        // Every vertex touching one shape reports the same body, so one
        // lookup per shape is enough.
        const shape = jolt.HEAP32[(at + COLLIDING_SHAPE_BYTE) >> 2];
        if (shapesSeen.includes(shape)) continue;
        shapesSeen.push(shape);

        const vertex = vertices.at(index);
        const contactNormal = manifold.GetContactNormal(vertex);
        normal.set(
          contactNormal.GetX(),
          contactNormal.GetY(),
          contactNormal.GetZ(),
        );
        const position = (at + jolt.SoftBodyVertexTraits.prototype.mPositionOffset) >> 2;
        point.set(
          jolt.HEAPF32[position] + originX,
          jolt.HEAPF32[position + 1] + originY,
          jolt.HEAPF32[position + 2] + originZ,
        );

        touch(soft, softID, manifold.GetContactBodyID(vertex));
      }
    }

    const sensors = manifold.GetNumSensorContacts();
    if (sensors > 0) {
      point.set(originX, originY, originZ);
      normal.set(0, 0, 0);
      for (let index = 0; index < sensors; index += 1) {
        touch(soft, softID, manifold.GetSensorContactBodyID(index));
      }
    }
  };

  const sweep = () => {
    for (const [softID, entry] of pairs) {
      if (!entry.body.IsActive()) continue;

      for (const [otherID, seen] of entry.others) {
        if (seen === stepIndex) continue;
        entry.others.delete(otherID);
        sink.exit(softID, otherID);
        sink.exit(otherID, softID);
      }

      if (entry.others.size === 0) pairs.delete(softID);
    }

    stepIndex += 1;
  };

  const install = () => {
    listener = new jolt.SoftBodyContactListenerJS();

    listener.OnSoftBodyContactValidate = (
      inSoftBody: number,
      inOtherBody: number,
      ioSettings: number,
    ) => {
      if (listeners.size > 0) {
        const soft = jolt.wrapPointer(inSoftBody, jolt.Body);
        const other = jolt.wrapPointer(inOtherBody, jolt.Body);
        const settings = jolt.wrapPointer(
          ioSettings,
          jolt.SoftBodyContactSettings,
        );

        for (const handlers of listeners) {
          if (
            handlers.onSoftBodyContactValidate?.(soft, other, settings) ===
            false
          ) {
            return jolt.SoftBodyValidateResult_RejectContact;
          }
        }
      }

      return jolt.SoftBodyValidateResult_AcceptContact;
    };

    listener.OnSoftBodyContactAdded = (
      inSoftBody: number,
      inManifold: number,
    ) => {
      const soft = jolt.wrapPointer(inSoftBody, jolt.Body);
      const manifold = jolt.wrapPointer(inManifold, jolt.SoftBodyManifold);

      for (const handlers of listeners) {
        handlers.onSoftBodyContactAdded?.(soft, manifold);
      }

      if (sink.watching()) record(soft, manifold);
    };

    physicsSystem.SetSoftBodyContactListener(listener);
    stopSweeping = steps.add("after", sweep);
  };

  const uninstall = () => {
    if (listener === null) return;

    stopSweeping?.();
    stopSweeping = null;
    physicsSystem.SetSoftBodyContactListener(
      null as unknown as Jolt.SoftBodyContactListener,
    );
    jolt.destroy(listener);
    listener = null;
    pairs.clear();
  };

  const sync = () => {
    const needed = listeners.size > 0 || sink.watching();
    if (needed && listener === null) install();
    if (!needed) uninstall();
  };

  return {
    sync,

    add: (handlers: SoftBodyContactHandlers) => {
      listeners.add(handlers);
      sync();
      return () => {
        listeners.delete(handlers);
        sync();
      };
    },

    forget: (softID: number) => {
      const entry = pairs.get(softID);
      if (!entry) return;
      pairs.delete(softID);

      for (const otherID of entry.others.keys()) {
        sink.exit(otherID, softID);
        sink.exit(softID, otherID);
      }
    },

    destroy: () => {
      listeners.clear();
      uninstall();
    },
  };
};
