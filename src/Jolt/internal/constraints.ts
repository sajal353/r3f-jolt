import type { ConstraintEntry, ConstraintRegistry } from "../types";

/**
 * Jolt's JS bindings expose no way to ask a `PhysicsSystem` what constraints it
 * holds — there is no `GetConstraints` and no count. So the library keeps its
 * own list, which is what lets `<PhysicsDebug />` draw joints at all.
 *
 * Only constraints created through the hooks are in here. One built by hand
 * through `useJolt()` is invisible to it, unlike bodies.
 */
export const createConstraintRegistry = (): ConstraintRegistry => {
  const entries = new Set<ConstraintEntry>();
  let destroyed = false;

  const add = (entry: ConstraintEntry) => {
    if (destroyed) return () => {};

    entries.add(entry);
    return () => entries.delete(entry);
  };

  const forEach = (visit: (entry: ConstraintEntry) => void) => {
    for (const entry of entries) visit(entry);
  };

  const destroy = () => {
    destroyed = true;
    entries.clear();
  };

  return {
    add,
    forEach,
    size: () => entries.size,
    destroy,
  };
};
