/**
 * Terrain arrives in three shapes and Jolt takes exactly one: a flat run of
 * floats, row-major, `sampleCount²` long. Resolving all three here keeps the
 * build path in `useHeightField` single, and keeps the row order stated once.
 *
 * **Row order, for all three forms:** index `z * sampleCount + x`. Sample
 * `(0, 0)` sits at the field's `offset`, and `z` grows away from it. An image's
 * first row is its top row, which is the same end — a top-down camera in three
 * looks along −Y with −Z up the screen, so an image row 0 and a `z` of 0 are the
 * far edge either way. Anything whose tooling disagrees passes `flipZ`.
 */
export interface HeightFieldImage {
  /**
   * Greyscale or RGBA bytes. RGBA is detected by an `ImageData` or a length of
   * `4 × sampleCount²`, and only the red channel is read — the convention every
   * heightmap exporter writes.
   */
  data: Uint8ClampedArray | Uint8Array | ImageData;
  /** What byte 0 and byte 255 mean, in world units. */
  heightRange: [number, number];
  /** A byte value that punches a hole rather than setting a height. */
  holeValue?: number;
  flipZ?: boolean;
}

export type HeightFieldSampler = (x: number, z: number) => number | null;

/**
 * A flat array is row-major and `sampleCount²` long; a sampler is called once
 * per sample. Either may return `NaN` — and a sampler `null` — for a hole.
 */
export type HeightFieldSamples =
  | number[]
  | Float32Array
  | HeightFieldSampler
  | HeightFieldImage;

const isImage = (value: HeightFieldSamples): value is HeightFieldImage =>
  typeof value === "object" && value !== null && "data" in value;

const readImageBytes = (image: HeightFieldImage, sampleCount: number) => {
  const source = image.data;
  const bytes = "data" in source ? source.data : source;
  const expected = sampleCount * sampleCount;

  if ("width" in source && source.width !== sampleCount) {
    throw new Error(
      `[r3f-jolt] useHeightField: the ImageData is ${source.width} wide but ` +
        `sampleCount is ${sampleCount}. They have to agree.`,
    );
  }

  if (bytes.length === expected * 4) return { bytes, stride: 4 };
  if (bytes.length === expected) return { bytes, stride: 1 };

  throw new Error(
    `[r3f-jolt] useHeightField: image data is ${bytes.length} bytes, which is ` +
      `neither ${expected} (greyscale) nor ${expected * 4} (RGBA) for a ` +
      `sampleCount of ${sampleCount}.`,
  );
};

/**
 * Writes straight into the heap view the caller acquired. Nothing in here
 * allocates on the WASM side, which matters: a growing heap would detach that
 * view's buffer.
 */
export const writeHeightSamples = (
  target: Float32Array,
  sampleCount: number,
  heights: HeightFieldSamples,
  noCollisionValue: number,
) => {
  const total = sampleCount * sampleCount;

  if (typeof heights === "function") {
    for (let z = 0; z < sampleCount; z += 1) {
      for (let x = 0; x < sampleCount; x += 1) {
        const height = heights(x, z);
        target[z * sampleCount + x] =
          height === null || Number.isNaN(height) ? noCollisionValue : height;
      }
    }
    return;
  }

  if (isImage(heights)) {
    const { bytes, stride } = readImageBytes(heights, sampleCount);
    const [min, max] = heights.heightRange;
    const span = (max - min) / 255;
    const { holeValue, flipZ } = heights;

    for (let z = 0; z < sampleCount; z += 1) {
      const row = flipZ ? sampleCount - 1 - z : z;
      for (let x = 0; x < sampleCount; x += 1) {
        const byte = bytes[(row * sampleCount + x) * stride];
        target[z * sampleCount + x] =
          byte === holeValue ? noCollisionValue : min + byte * span;
      }
    }
    return;
  }

  if (heights.length !== total) {
    throw new Error(
      `[r3f-jolt] useHeightField: expected ${total} samples for a sampleCount ` +
        `of ${sampleCount}, received ${heights.length}.`,
    );
  }

  for (let i = 0; i < total; i += 1) {
    const height = heights[i];
    target[i] = Number.isNaN(height) ? noCollisionValue : height;
  }
};
