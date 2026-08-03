import type Jolt from "jolt-physics";
import type {
  ActivationHandlers,
  ActivationRegistry,
  JoltModule,
} from "../types";

type ActivationKind = "wake" | "sleep";

/**
 * Jolt reports activation from inside `Step()`, where the body lock is held and
 * user code has no business touching the world. Events are queued there and
 * delivered by `flush()` once the step is over, exactly as contacts are.
 */
export const createActivationRegistry = (
  Jolt: JoltModule,
  physicsSystem: Jolt.PhysicsSystem,
): ActivationRegistry => {
  const bodyListeners = new Map<number, Set<ActivationHandlers>>();
  const queue: { kind: ActivationKind; target: number }[] = [];

  let listener: Jolt.BodyActivationListenerJS | null = null;
  let destroyed = false;

  const enqueue = (kind: ActivationKind, inBodyID: number) => {
    if (bodyListeners.size === 0) return;

    const bodyID = Jolt.wrapPointer(
      inBodyID,
      Jolt.BodyID,
    ).GetIndexAndSequenceNumber();

    if (!bodyListeners.has(bodyID)) return;
    queue.push({ kind, target: bodyID });
  };

  const install = () => {
    if (listener !== null) return;

    listener = new Jolt.BodyActivationListenerJS();
    listener.OnBodyActivated = (inBodyID: number) => enqueue("wake", inBodyID);
    listener.OnBodyDeactivated = (inBodyID: number) =>
      enqueue("sleep", inBodyID);

    physicsSystem.SetBodyActivationListener(listener);
  };

  const uninstall = () => {
    if (listener === null) return;

    physicsSystem.SetBodyActivationListener(
      null as unknown as Jolt.BodyActivationListener,
    );
    Jolt.destroy(listener);
    listener = null;
  };

  return {
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
        if (!destroyed && bodyListeners.size === 0) uninstall();
      };
    },

    flush: () => {
      if (queue.length === 0) return;

      const pending = queue.splice(0, queue.length);

      for (const event of pending) {
        const handlers = bodyListeners.get(event.target);
        if (!handlers) continue;

        for (const handler of handlers) {
          if (event.kind === "wake") handler.onWake?.();
          else handler.onSleep?.();
        }
      }
    },

    destroy: () => {
      destroyed = true;
      bodyListeners.clear();
      queue.length = 0;
      uninstall();
    },
  };
};
