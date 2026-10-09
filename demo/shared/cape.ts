import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  MathUtils,
  SRGBColorSpace,
} from "three";

/** Across, and from the shoulders down. */
const ACROSS = 16;
const DOWN = 28;

/**
 * Its outline in the mannequin's own space, which faces +Z, measured off the
 * bind pose: the top edge lies across the shoulder tops (1.51–1.53 m) and
 * round the back of the neck, and the cape falls clear of the back (-0.16 m
 * at its deepest) to the calves, widening as it goes.
 */
const TOP = { y: 1.53, halfWidth: 0.22 };
const HEM = { y: 0.45, halfWidth: 0.38 };
/** Over the shoulders at the ends of the top edge, behind the neck between. */
const SHOULDER_Z = -0.06;
const NECK_Z = -0.18;
const BACK_Z = -0.22;
/** The share of rows that wrap from the shoulders round to hanging flat. */
const WRAP = 0.12;

/** How far each row may leave the skin: none at the top, most at the hem. */
const TOP_SLACK = 0.03;
const HEM_SLACK = 1.2;
/**
 * Where the shoulders start under the wrapped rows, for their back stop.
 * Below, the cape hangs clear: a back stop it kept touching would push
 * vertices out hard enough to jitter.
 */
const CLEARANCE = 0.03;

/** Every vertex follows it, held edge included, so the held edge stays rigid. */
export const CAPE_BONE = "spine_03";

/**
 * A cape for the mannequin's upper spine (`skin.bone`). `slack` and
 * `clearance` are per geometry vertex, for `skin.maxDistance` and
 * `skin.backStopDistance`; `pinned` is the top edge.
 *
 * The held edge follows one bone only. Corners leaning on the clavicles
 * stretched and squeezed the edge as the shoulders moved, and rigid edges
 * held to positions they cannot reach shake: worse the more iterations.
 */
export const createCape = () => {
  const columns = ACROSS + 1;
  const count = columns * (DOWN + 1);
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const slack = new Float32Array(count);
  const clearance = new Float32Array(count);

  for (let row = 0; row <= DOWN; row += 1) {
    const t = row / DOWN;
    const y = MathUtils.lerp(TOP.y, HEM.y, t);
    const halfWidth = MathUtils.lerp(TOP.halfWidth, HEM.halfWidth, t);
    const flat = MathUtils.smoothstep(t, 0, WRAP);

    for (let column = 0; column < columns; column += 1) {
      const vertex = row * columns + column;
      const across = (column / ACROSS) * 2 - 1;
      const wrapped = MathUtils.lerp(NECK_Z, SHOULDER_Z, across * across);
      positions[vertex * 3] = across * halfWidth;
      positions[vertex * 3 + 1] = y;
      positions[vertex * 3 + 2] = MathUtils.lerp(wrapped, BACK_Z, flat);
      uvs[vertex * 2] = column / ACROSS;
      uvs[vertex * 2 + 1] = 1 - t;

      slack[vertex] = MathUtils.lerp(TOP_SLACK, HEM_SLACK, t);
      // At the slack, Jolt turns the back stop off.
      clearance[vertex] = t <= WRAP ? CLEARANCE : slack[vertex];
    }
  }

  const indices: number[] = [];
  for (let row = 0; row < DOWN; row += 1) {
    for (let column = 0; column < ACROSS; column += 1) {
      const a = row * columns + column;
      const b = a + columns;
      // Facing away from the back, which the back stop measures from.
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return {
    geometry,
    slack,
    clearance,
    pinned: (index: number) => index < columns,
  };
};

/** Deep red with a gold border down the sides and along the hem. */
export const createCapeTexture = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#d4a017";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#8b1a1a";
    context.fillRect(4, 0, canvas.width - 8, canvas.height - 6);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
};
