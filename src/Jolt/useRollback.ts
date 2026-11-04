import { useEffect, useState } from "react";
import { useJolt } from "./useJolt";
import type { JoltApi } from "./types";

/** @experimental */
export interface UseRollbackOptions {
  /** How many steps back a `rewind` can reach. Read at mount. */
  capacity: number;
}

/** @experimental */
export interface RollbackApi {
  /**
   * Goes back to the start of `toStep` and runs forward to where the world was.
   * Read what should differ by step index in `useBeforePhysicsStep`, so the
   * re-run sees it. True when the world now reflects that step; a step at or
   * past the current one needs nothing and is true too. False, with the world
   * untouched, when `toStep` is older than the history holds.
   */
  rewind: (toStep: number) => boolean;
  /** The world as `step` began, or null if it has left the history. */
  snapshotAt: (step: number) => Uint8Array | null;
}

const createRollback = (api: JoltApi, capacity: number) => {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error(
      `r3f-jolt: useRollback capacity ${capacity} must be a whole number, 1 or more.`,
    );
  }

  const { timing } = api;
  const snapshots = new Array<Uint8Array | null>(capacity).fill(null);
  const stepOf = new Array<number>(capacity).fill(-1);
  let seenRestores = timing.restores;

  const clear = () => {
    snapshots.fill(null);
    stepOf.fill(-1);
  };

  const snapshotAt = (step: number) =>
    stepOf[step % capacity] === step ? snapshots[step % capacity] : null;

  /**
   * Runs at the very start of a step, ahead of anything that step's callbacks
   * apply. A restore from outside `rewind` may have moved the clock anywhere, so
   * nothing already held belongs to the timeline any more.
   */
  const record = (_delta: number, index: number) => {
    if (!timing.resimulating && timing.restores !== seenRestores) clear();
    seenRestores = timing.restores;

    snapshots[index % capacity] = api.saveState();
    stepOf[index % capacity] = index;
  };

  const rollback: RollbackApi = {
    rewind: (toStep) => {
      if (toStep >= timing.stepCount) return true;

      const snapshot = snapshotAt(toStep);
      if (!snapshot) return false;

      api.replay(snapshot, timing.stepCount);
      return true;
    },
    snapshotAt,
  };

  return { rollback, record, clear };
};

/**
 * Keeps a snapshot of the last `capacity` steps, for netcode that predicts and
 * corrects: when an input turns up late, `rewind` to its step and the world is
 * re-simulated with it. Everything in the world needs a `stateId`, and the
 * bodies in it must stay the same across the history.
 *
 * @experimental May change in a minor release.
 */
export const useRollback = ({ capacity }: UseRollbackOptions): RollbackApi => {
  const api = useJolt();
  const [{ rollback, record, clear }] = useState(() =>
    createRollback(api, capacity),
  );

  useEffect(() => {
    const stop = api.steps.add("start", record);

    return () => {
      stop();
      clear();
    };
  }, [api, record, clear]);

  return rollback;
};
