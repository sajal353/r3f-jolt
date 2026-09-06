const MAX_GROUP = 0xffff;

const check = (value: number, label: string) => {
  if (!Number.isInteger(value) || value < 0 || value > MAX_GROUP) {
    throw new Error(
      `[r3f-jolt] interactionGroups: ${label} must be a 16-bit unsigned integer ` +
        `(0…${MAX_GROUP}). Received ${value}, whose high half the object layer ` +
        `would drop.`,
    );
  }
};

/**
 * Packs a group and a mask into the object layer the hooks' `layer` option and
 * the query filters take, without needing a `useJolt()` call to reach
 * `api.objectLayer`.
 *
 * The packing is Jolt's own — verified equal to
 * `ObjectLayerPairFilterMask::sGetObjectLayer` across the range, including the
 * `-1` both produce at the 16-bit maximum. Two bodies collide when each one's
 * group appears in the other's mask.
 */
export const interactionGroups = (group: number, mask: number) => {
  check(group, "group");
  check(mask, "mask");

  return (mask << 16) | group;
};
