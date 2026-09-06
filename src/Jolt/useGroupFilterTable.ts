import { useEffect, useState } from "react";
import type Jolt from "jolt-physics";
import { useJolt } from "./useJolt";
import { useHandlerRef } from "./internal/useHandlerRef";

export interface GroupFilterTableApi {
  /** The raw filter, for `collisionGroup` and for anything the hook does not wrap. */
  filter: Jolt.GroupFilterTable;
  /** Stop two sub-groups of the same group colliding. Symmetric. */
  disableCollision: (subGroup1: number, subGroup2: number) => void;
  enableCollision: (subGroup1: number, subGroup2: number) => void;
  isCollisionEnabled: (subGroup1: number, subGroup2: number) => boolean;
}

/**
 * A table of which sub-groups within one collision group ignore each other —
 * the ragdoll mechanism, where adjacent bones overlap by design and must not
 * fight.
 *
 * This is **not** the layer `group`/`mask` pair, which decides what a body *is*
 * and what kinds it collides with. Group filters work one level down: two bodies
 * in **different** groups always collide, and only two in the same group consult
 * the table.
 *
 * ```tsx
 * const table = useGroupFilterTable(6, (t) => {
 *   for (let i = 0; i < 5; i += 1) t.disableCollision(i, i + 1);
 * });
 * ```
 *
 * `undefined` until built, like every api here — and a body wants its filter at
 * **creation**, so the bodies using one belong in a child component the owner
 * renders only once the table exists. `api.setCollisionGroup` is the later path.
 */
export const useGroupFilterTable = (
  numGroups: number,
  setup?: (table: GroupFilterTableApi) => void,
): GroupFilterTableApi | undefined => {
  const api = useJolt();
  const [table, setTable] = useState<GroupFilterTableApi>();
  const setupRef = useHandlerRef(setup);
  const [mount] = useState(() => ({ numGroups }));

  useEffect(() => {
    const { state, Jolt: jolt } = api;
    if (state.disposed) return;

    if (!Number.isInteger(mount.numGroups) || mount.numGroups < 1) {
      throw new Error(
        `[r3f-jolt] useGroupFilterTable: numGroups must be a positive integer. ` +
          `Received ${mount.numGroups}.`,
      );
    }

    const filter = new jolt.GroupFilterTable(mount.numGroups);
    // A `CollisionGroup` refs it and so does every body built from one, but a
    // table with no bodies yet has nothing holding it. This is that reference.
    filter.AddRef();

    const built: GroupFilterTableApi = {
      filter,
      disableCollision: (subGroup1, subGroup2) =>
        filter.DisableCollision(subGroup1, subGroup2),
      enableCollision: (subGroup1, subGroup2) =>
        filter.EnableCollision(subGroup1, subGroup2),
      isCollisionEnabled: (subGroup1, subGroup2) =>
        filter.IsCollisionEnabled(subGroup1, subGroup2),
    };

    setupRef.current?.(built);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTable(built);

    return () => {
      setTable(undefined);

      if (state.destroyed) return;
      // `Release`, never `destroy`: the bodies still holding it own references
      // of their own, and freeing it out from under them corrupts the heap.
      filter.Release();
    };
  }, [api, mount, setupRef]);

  return table;
};
