import type { Vector3 } from "three";
import type { SoftBodyVertices } from "./softBodyVertices";
import type { RodTopology } from "./rodBuild";

/**
 * Air resistance on every segment of a rope, as a velocity change on its free
 * vertices before each step: drag × diameter × length × |air⊥| × air⊥, where
 * air⊥ is the air relative to the segment, across it. Air along a segment
 * slides past. A vertex's change is capped at its share of air⊥, which would
 * stop its motion through the air outright: past that, drag overshoots.
 */
export const dragSegments = (
  heap: Float32Array,
  layout: SoftBodyVertices,
  topology: RodTopology,
  diameter: number,
  wind: Vector3,
  drag: number,
  delta: number,
) => {
  const { stride, position, velocity, inverseMass } = layout;
  const { segmentStart, segmentShare } = topology;

  for (const start of segmentStart) {
    const a = start * stride;
    const b = a + stride;

    let tX = heap[position + b] - heap[position + a];
    let tY = heap[position + b + 1] - heap[position + a + 1];
    let tZ = heap[position + b + 2] - heap[position + a + 2];
    const length = Math.hypot(tX, tY, tZ);
    if (length < 1e-9) continue;
    tX /= length;
    tY /= length;
    tZ /= length;

    const airX = wind.x - (heap[velocity + a] + heap[velocity + b]) / 2;
    const airY = wind.y - (heap[velocity + a + 1] + heap[velocity + b + 1]) / 2;
    const airZ = wind.z - (heap[velocity + a + 2] + heap[velocity + b + 2]) / 2;
    const along = airX * tX + airY * tY + airZ * tZ;
    const acrossX = airX - along * tX;
    const acrossY = airY - along * tY;
    const acrossZ = airZ - along * tZ;
    const speed = Math.hypot(acrossX, acrossY, acrossZ);
    if (speed < 1e-9) continue;

    // Half the force to each end.
    const scale = (drag * diameter * length * speed * delta) / 2;

    for (let end = 0; end < 2; end += 1) {
      const vertex = start + end;
      const offset = vertex * stride;
      const weight = heap[inverseMass + offset];
      if (weight <= 0) continue;
      const push = Math.min(scale * weight, segmentShare[vertex]);
      const at = velocity + offset;
      heap[at] += acrossX * push;
      heap[at + 1] += acrossY * push;
      heap[at + 2] += acrossZ * push;
    }
  }
};
