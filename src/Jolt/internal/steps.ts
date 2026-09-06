import type { StepCallback, StepPhase, StepRegistry } from "../types";

/**
 * Subscribers to the step loop. Unlike contacts and activation this holds no
 * Jolt listener at all: `<Physics>` drives the accumulator itself, so a plain
 * JS call either side of `joltInterface.Step()` is both correct and cheaper
 * than a `PhysicsStepListenerJS` would be.
 *
 * Each phase keeps its subscribers in a `Set` and runs them from an array
 * rebuilt only when that set changes. Iterating the set live would run a
 * callback that another callback had *just* subscribed, and would let one
 * subscriber cancel another out from under the loop; a snapshot avoids both
 * and still allocates nothing in the common case, which matters when this runs
 * several times a frame for the life of the world.
 */
export const createStepRegistry = (): StepRegistry => {
  const subscribers: Record<StepPhase, Set<StepCallback>> = {
    before: new Set(),
    after: new Set(),
  };

  const snapshots: Record<StepPhase, StepCallback[]> = {
    before: [],
    after: [],
  };

  const stale: Record<StepPhase, boolean> = { before: false, after: false };

  let destroyed = false;

  return {
    add: (phase, callback) => {
      if (destroyed) return () => {};

      const set = subscribers[phase];

      // Never `stale ||= set.delete(…)`: the assignment short-circuits when the
      // flag is already set, which is exactly the state a fresh subscription
      // leaves behind, and the delete would then never run at all.
      if (!set.has(callback)) stale[phase] = true;
      set.add(callback);

      return () => {
        if (set.delete(callback)) stale[phase] = true;
      };
    },

    run: (phase, delta, index) => {
      if (stale[phase]) {
        snapshots[phase] = [...subscribers[phase]];
        stale[phase] = false;
      }

      for (const callback of snapshots[phase]) {
        callback(delta, index);
      }
    },

    destroy: () => {
      destroyed = true;
      subscribers.before.clear();
      subscribers.after.clear();
      snapshots.before = [];
      snapshots.after = [];
    },
  };
};
