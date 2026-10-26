import { Box3, Vector3 } from "three";
import type Jolt from "jolt-physics";
import type { JoltModule, PhysicsTiming } from "../types";
import type { SoftBodyVertices } from "./softBodyVertices";

/**
 * `createTransformTracker` for a soft body: every vertex is blended between
 * the last two steps, or a cloth judders exactly as an un-interpolated rigid
 * body does.
 *
 * Vertices are kept in world space, so the blend is right while the body's
 * own position moves under them. `origin` is the blended body position and
 * `local` the blended vertices relative to it — what a mesh placed at `origin`
 * draws.
 */
export const createVertexTracker = (count: number) => {
  const previous = new Float32Array(count * 3);
  const current = new Float32Array(count * 3);
  const local = new Float32Array(count * 3);
  const previousOrigin = new Vector3();
  const currentOrigin = new Vector3();
  const origin = new Vector3();
  const bounds = new Box3();

  let lastStepCount = -1;
  let primed = false;
  let resting = false;

  const read = (jolt: JoltModule, body: Jolt.Body, layout: SoftBodyVertices) => {
    const heap = jolt.HEAPF32;
    const at = body.GetPosition();
    const x = at.GetX();
    const y = at.GetY();
    const z = at.GetZ();
    currentOrigin.set(x, y, z);

    for (let index = 0; index < count; index += 1) {
      const source = layout.position + index * layout.stride;
      current[index * 3] = heap[source] + x;
      current[index * 3 + 1] = heap[source + 1] + y;
      current[index * 3 + 2] = heap[source + 2] + z;
    }
  };

  const snap = () => {
    previous.set(current);
    previousOrigin.copy(currentOrigin);
  };

  const blend = (alpha: number) => {
    origin.lerpVectors(previousOrigin, currentOrigin, alpha);
    bounds.makeEmpty();

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (let index = 0; index < count * 3; index += 3) {
      const x = previous[index] + (current[index] - previous[index]) * alpha - origin.x;
      const y =
        previous[index + 1] +
        (current[index + 1] - previous[index + 1]) * alpha -
        origin.y;
      const z =
        previous[index + 2] +
        (current[index + 2] - previous[index + 2]) * alpha -
        origin.z;

      local[index] = x;
      local[index + 1] = y;
      local[index + 2] = z;

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }

    if (count > 0) {
      bounds.min.set(minX, minY, minZ);
      bounds.max.set(maxX, maxY, maxZ);
    }
  };

  return {
    origin: origin as Readonly<Vector3>,
    local: local as Readonly<Float32Array>,
    /** Of `local`, as of the last frame that changed it. */
    bounds: bounds as Readonly<Box3>,

    /** Reads an awake body. Always returns true: the blend moves every frame. */
    update: (
      jolt: JoltModule,
      body: Jolt.Body,
      layout: SoftBodyVertices,
      timing: PhysicsTiming,
    ) => {
      resting = false;

      if (!timing.interpolate) {
        read(jolt, body, layout);
        snap();
        blend(1);
        return true;
      }

      if (!primed) {
        read(jolt, body, layout);
        snap();
        primed = true;
        lastStepCount = timing.stepCount;
      } else if (timing.stepCount !== lastStepCount) {
        snap();
        read(jolt, body, layout);
        lastStepCount = timing.stepCount;
      }

      blend(timing.alpha);
      return true;
    },

    /**
     * For a sleeping body: lands on its pose once and then reports nothing to
     * write until it wakes, so a settled cloth uploads no buffers.
     */
    rest: (jolt: JoltModule, body: Jolt.Body, layout: SoftBodyVertices) => {
      if (resting) return false;

      read(jolt, body, layout);
      snap();
      blend(1);
      primed = true;
      resting = true;
      return true;
    },

    /** Forget the history after a teleport. */
    reset: () => {
      primed = false;
      resting = false;
    },
  };
};

export type VertexTracker = ReturnType<typeof createVertexTracker>;
