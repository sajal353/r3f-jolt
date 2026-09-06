import { useState } from "react";
import { Controls } from "../../shared/Stage";
import { useHeightField } from "@/Jolt/useHeightField";
import { useSphere } from "@/Jolt/useSphere";
import type { Vec3Tuple } from "@/Jolt/types";

const SAMPLES = 64;
const BLOCK = 4;
const SPACING = 0.5;
const SPAN = (SAMPLES - 1) * SPACING;

const HOLE = { x: 24, z: 24, size: 8 };
const HILL = { x: 8, z: 8, size: 8 };

const terrainAt = (x: number, z: number) => {
  const u = x * 0.11;
  const v = z * 0.11;

  return (
    2.2 * Math.sin(u) * Math.cos(v) +
    0.7 * Math.sin(u * 2.7 + 1.3) * Math.cos(v * 2.3)
  );
};

const heights = (x: number, z: number) => {
  const inHole =
    x >= HOLE.x &&
    x < HOLE.x + HOLE.size &&
    z >= HOLE.z &&
    z < HOLE.z + HOLE.size;

  return inHole ? null : terrainAt(x, z);
};

const worldAt = (index: number) => index * SPACING - SPAN / 2;

const holeCentre: Vec3Tuple = [
  worldAt(HOLE.x + HOLE.size / 2),
  6,
  worldAt(HOLE.z + HOLE.size / 2),
];

/** Flat-topped: an even-sized patch has no centre sample, so a point peak only
 *  ever reaches about 82% of what it asks for. */
const domeHeights = (size: number, peak: number) => {
  const patch = new Float32Array(size * size);

  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - size / 2 + 0.5) / (size / 2);
      const dz = (z - size / 2 + 0.5) / (size / 2);
      patch[z * size + x] =
        peak * Math.max(0, Math.min(1, 1.7 - 1.7 * Math.hypot(dx, dz)));
    }
  }

  return patch;
};

const Ball = ({ start, color }: { start: Vec3Tuple; color: string }) => {
  const [ref] = useSphere({
    radius: 0.45,
    position: start,
    motionType: "dynamic",
    mass: 3,
    material: { friction: 0.4, restitution: 0.2 },
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.45, 20, 20]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

const DROPS: { start: Vec3Tuple; color: string }[] = [
  { start: holeCentre, color: "#e74c3c" },
  { start: [worldAt(HILL.x + HILL.size / 2), 9, worldAt(HILL.z)], color: "#3498db" },
  { start: [4, 8, 5], color: "#f1c40f" },
  { start: [-2, 8, 6], color: "#2ecc71" },
];

export const HeightField = () => {
  const [generation, setGeneration] = useState(0);

  const [ref, api] = useHeightField({
    heights,
    sampleCount: SAMPLES,
    blockSize: BLOCK,
    sampleScale: [SPACING, 1, SPACING],
    offset: [-SPAN / 2, 0, -SPAN / 2],
    // Headroom above what the samples use. Without it the field quantises into
    // the terrain's own range and `setHeights` clamps to the highest hill.
    range: [-6, 10],
    position: [0, 0, 0],
    material: { friction: 0.8 },
  });

  return (
    <>
      {api && (
        <mesh ref={ref} geometry={api.geometry} receiveShadow castShadow>
          <meshStandardMaterial color="#4a6741" flatShading />
        </mesh>
      )}

      {DROPS.map(({ start, color }, index) => (
        <Ball key={`${generation}-${index}`} start={start} color={color} />
      ))}

      <Controls position={[0, 10, 0]}>
        <button onClick={() => setGeneration((n) => n + 1)}>drop again</button>
        <button
          onClick={() =>
            api?.setHeights(
              HILL.x,
              HILL.z,
              HILL.size,
              HILL.size,
              domeHeights(HILL.size, 8),
            )
          }
          disabled={!api}
        >
          raise a hill
        </button>
        <button
          onClick={() =>
            api?.setHeights(
              HILL.x,
              HILL.z,
              HILL.size,
              HILL.size,
              Float32Array.from({ length: HILL.size * HILL.size }, (_, i) =>
                terrainAt(HILL.x + (i % HILL.size), HILL.z + Math.floor(i / HILL.size)),
              ),
            )
          }
          disabled={!api}
        >
          flatten it
        </button>
      </Controls>
    </>
  );
};
