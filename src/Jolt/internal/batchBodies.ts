import type Jolt from "jolt-physics";
import type { JoltApi, JoltModule } from "../types";

/**
 * Adding bodies one at a time re-walks the broadphase on every call. Jolt's
 * batch path walks it once for the whole set, which is the difference between a
 * thousand-body swarm mounting in a frame and mounting in several.
 *
 * **`AddBodiesPrepare` sorts `ioBodies` in place** — measured: twelve ids pushed
 * in descending order came back ascending, and stayed so through `Finalize`. So
 * the array handed to Jolt is a transient built per call and never the source of
 * truth for "which body is instance 7"; the caller keeps its own list in
 * creation order.
 *
 * **`BodyInterface_AddState` is not ours** — `destroy` on one throws "Cannot
 * destroy object", and leaving it alone leaves `sGetFreeMemory()` exactly flat
 * across ten batch cycles.
 */
const withIDArray = (
  jolt: JoltModule,
  ids: number[],
  visit: (array: Jolt.ArrayBodyID, data: Jolt.BodyIDMemRef) => void,
) => {
  const array = new jolt.ArrayBodyID();
  array.reserve(ids.length);

  for (const id of ids) {
    const handle = new jolt.BodyID(id);
    array.push_back(handle);
    jolt.destroy(handle);
  }

  try {
    visit(array, array.data());
  } finally {
    jolt.destroy(array);
  }
};

/**
 * Adds every body in one broadphase walk, and hands back their ids in the order
 * they were given — not the order Jolt sorted them into.
 *
 * `AddBodiesAbort` runs if anything throws between prepare and finalize: a
 * prepared batch that is never finalized leaves the broadphase holding space it
 * will not give back.
 */
export const addBodies = (
  api: JoltApi,
  bodies: Jolt.Body[],
  activate: boolean,
): number[] => {
  const { Jolt: jolt, bodyInterface } = api;

  const ids = bodies.map((body) => body.GetID().GetIndexAndSequenceNumber());
  if (ids.length === 0) return ids;

  withIDArray(jolt, ids, (_array, data) => {
    const state = bodyInterface.AddBodiesPrepare(data, ids.length);

    try {
      bodyInterface.AddBodiesFinalize(
        data,
        ids.length,
        state,
        activate ? jolt.EActivation_Activate : jolt.EActivation_DontActivate,
      );
    } catch (error) {
      bodyInterface.AddBodiesAbort(data, ids.length, state);
      throw error;
    }
  });

  return ids;
};

/** Takes them out of the world in one walk. They still exist afterwards. */
export const removeBodies = (api: JoltApi, ids: number[]) => {
  if (ids.length === 0) return;

  withIDArray(api.Jolt, ids, (_array, data) => {
    api.bodyInterface.RemoveBodies(data, ids.length);
  });
};

/** Frees them. They must already be out of the world. */
export const destroyBodies = (api: JoltApi, ids: number[]) => {
  if (ids.length === 0) return;

  withIDArray(api.Jolt, ids, (_array, data) => {
    api.bodyInterface.DestroyBodies(data, ids.length);
  });
};
