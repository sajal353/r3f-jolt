import type { JoltModule, QuatInput, Temps, Vec3Input } from "../types";

/**
 * Borrowed scratch objects, one set per world. The imperative body api converts
 * a `Vector3` or tuple on every call, and allocating a WASM object per call
 * would make `applyImpulse` in a `useFrame` a per-frame leak of heap churn.
 *
 * A returned object is only valid until the next few calls of the same kind —
 * never store one, never destroy one. Four vector slots covers the widest
 * wrapped call (two vectors) with room for a caller that is still holding one.
 */
const VEC3_SLOTS = 4;

export const createTemps = (jolt: JoltModule): Temps => {
  const vec3Slots = Array.from({ length: VEC3_SLOTS }, () => new jolt.Vec3());
  const rvec3Slot = new jolt.RVec3();
  const quatSlot = new jolt.Quat();

  let cursor = 0;

  return {
    vec3: (value: Vec3Input) => {
      const slot = vec3Slots[cursor];
      cursor = (cursor + 1) % VEC3_SLOTS;

      if (Array.isArray(value)) {
        slot.Set(value[0], value[1], value[2]);
      } else {
        slot.Set(value.x, value.y, value.z);
      }

      return slot;
    },

    rvec3: (value: Vec3Input) => {
      if (Array.isArray(value)) {
        rvec3Slot.Set(value[0], value[1], value[2]);
      } else {
        rvec3Slot.Set(value.x, value.y, value.z);
      }

      return rvec3Slot;
    },

    quat: (value: QuatInput) => {
      if (Array.isArray(value)) {
        quatSlot.Set(value[0], value[1], value[2], value[3]);
      } else {
        quatSlot.Set(value.x, value.y, value.z, value.w);
      }

      return quatSlot;
    },

    destroy: () => {
      vec3Slots.forEach((slot) => jolt.destroy(slot));
      jolt.destroy(rvec3Slot);
      jolt.destroy(quatSlot);
    },
  };
};
