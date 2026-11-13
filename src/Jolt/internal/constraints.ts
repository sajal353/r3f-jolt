import type Jolt from "jolt-physics";
import { requireWholeStateId } from "./stateIds";
import type {
  AttachedConstraint,
  ConstraintEntry,
  ConstraintRegistry,
} from "../types";

/**
 * Jolt's JS bindings expose no way to ask a `PhysicsSystem` what constraints it
 * holds — there is no `GetConstraints` and no count. So the library keeps its
 * own list, which is what lets `<PhysicsDebug />` draw joints at all.
 *
 * Only constraints created through the hooks are in here. One built by hand
 * through `useJolt()` is invisible to it, unlike bodies.
 *
 * It also owns adding them to the world. Jolt solves the constraints in an
 * island in the order they were added, and removing one moves the last into
 * its slot, so mount order would decide it. Constraints with a `stateId` are
 * put back in `stateId` order before the next step whenever that changed,
 * which is what lets two worlds mounted differently simulate a snapshot alike.
 */
export const createConstraintRegistry = (
  physicsSystem: Jolt.PhysicsSystem,
): ConstraintRegistry => {
  const entries = new Set<ConstraintEntry>();
  let attached: AttachedConstraint[] = [];
  let keyed = 0;
  let unordered = false;
  let destroyed = false;

  const add = (entry: ConstraintEntry) => {
    if (destroyed) return () => {};

    entries.add(entry);
    return () => entries.delete(entry);
  };

  const forEach = (visit: (entry: ConstraintEntry) => void) => {
    for (const entry of entries) visit(entry);
  };

  const check = (stateId: number, hook: string) => {
    requireWholeStateId(stateId, hook);

    const holder = attached.find((other) => other.stateId === stateId);
    if (holder) {
      throw new Error(
        `r3f-jolt: ${hook} constraint stateId ${stateId} is taken by ` +
          `${holder.hook}. Constraint stateIds are numbered apart from ` +
          "bodies, but each one names a single constraint.",
      );
    }
  };

  const attach = (
    constraint: Jolt.Constraint,
    stateId: number | undefined,
    hook: string,
  ) => {
    if (stateId !== undefined) check(stateId, hook);

    const entry: AttachedConstraint = { constraint, stateId, hook };
    physicsSystem.AddConstraint(constraint);
    attached = [...attached, entry];

    if (stateId !== undefined) {
      keyed += 1;
      unordered = true;
    }

    return () => {
      if (destroyed) return;

      physicsSystem.RemoveConstraint(constraint);
      attached = attached.filter((other) => other !== entry);
      if (stateId !== undefined) keyed -= 1;
      if (keyed > 0) unordered = true;
    };
  };

  const order = () => {
    if (!unordered) return;
    unordered = false;

    const sorted = [
      ...attached
        .filter((entry) => entry.stateId !== undefined)
        .sort((a, b) => (a.stateId ?? 0) - (b.stateId ?? 0)),
      ...attached.filter((entry) => entry.stateId === undefined),
    ];

    for (const entry of attached) physicsSystem.RemoveConstraint(entry.constraint);
    for (const entry of sorted) physicsSystem.AddConstraint(entry.constraint);
    attached = sorted;
  };

  const destroy = () => {
    destroyed = true;
    entries.clear();
    attached = [];
  };

  return {
    add,
    forEach,
    size: () => entries.size,
    check,
    attach,
    order,
    attached: () => attached,
    destroy,
  };
};
