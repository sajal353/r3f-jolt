import { useRef } from "react";
import type Jolt from "jolt-physics";
import {
  shapeFromResultAs,
  useBody,
  type BodyApiContext,
  type BodyOptions,
} from "./internal/useBody";
import {
  refillShapeGeometry,
  shapeToGeometry,
} from "./internal/shapeToGeometry";
import { writeHeightSamples } from "./internal/heightFieldSamples";
import type { HeightFieldSamples } from "./internal/heightFieldSamples";
import type { Vec3Tuple } from "./types";

export type {
  HeightFieldImage,
  HeightFieldSampler,
  HeightFieldSamples,
} from "./internal/heightFieldSamples";

export interface UseHeightFieldOptions
  extends Omit<BodyOptions, "motionType"> {
  /**
   * A row-major array, a `(x, z) => number | null` sampler, or greyscale image
   * data. All three index the same way — `z * sampleCount + x`, with `(0, 0)` at
   * `offset` — and a `null` or `NaN` sample is a hole nothing collides with.
   */
  heights: HeightFieldSamples;
  /** Samples per side. Must be a multiple of `blockSize`. */
  sampleCount: number;
  /** World position of sample `(0, 0)`, before the body's own position. */
  offset?: Vec3Tuple;
  /**
   * Distance between samples in X and Z, and the height multiplier in Y. Named
   * apart from the body-wide `scale` because this one is baked into the
   * collider rather than wrapped around it.
   */
  sampleScale?: Vec3Tuple;
  /**
   * Samples per compressed block, a power of two in [2, 8]. Bigger blocks mean
   * a smaller shape and a slower query.
   */
  blockSize?: number;
  /** Bits a sample is quantised to, 1–8. */
  bitsPerSample?: number;
  /**
   * The span of heights the field is able to *store*, which by default is just
   * the span of the samples given. `setHeights` quantises into this range and
   * silently clamps to it — so widen it now for terrain that will be deformed
   * later, or the first crater will not go anywhere.
   */
  range?: [number, number];
  /**
   * One index per cell — `(sampleCount - 1)²` of them, row-major — selecting
   * which of `materialCount` identity tokens that patch of ground carries. Read
   * back off a hit with `bodyInterface.GetMaterial`, and compare against
   * `api.materials`.
   */
  materialIndices?: ArrayLike<number>;
  materialCount?: number;
  /** A heightfield cannot move. */
  motionType?: "static";
}

export interface HeightFieldExtras {
  /** The extremes the shape can represent, after quantisation. */
  getMinHeight: () => number;
  getMaxHeight: () => number;
  /** Shape-local height of one sample, holes included. */
  getHeight: (x: number, z: number) => number;
  isNoCollision: (x: number, z: number) => boolean;
  /**
   * Reads a `sizeX × sizeZ` patch, row-major. `x`, `z` and both sizes must be
   * multiples of `blockSize` — Jolt reads whole blocks and does not check in a
   * release build.
   */
  getHeights: (x: number, z: number, sizeX: number, sizeZ: number) => Float32Array;
  /**
   * Writes a patch back and re-triangulates `api.geometry` in place, so the
   * mesh and the collider cannot drift. Same block-alignment rule as
   * `getHeights`, and the same clamping to `range` as the build.
   */
  setHeights: (
    x: number,
    z: number,
    sizeX: number,
    sizeZ: number,
    heights: ArrayLike<number>,
  ) => void;
  /** Write this into `setHeights` to punch a hole. */
  noCollisionValue: number;
  /** Identity tokens, in `materialIndices` order. Empty without them. */
  materials: Jolt.PhysicsMaterial[];
}

const POWERS_OF_TWO = [2, 4, 8];

const validate = (sampleCount: number, blockSize: number, bits: number) => {
  if (!POWERS_OF_TWO.includes(blockSize)) {
    throw new Error(
      `[r3f-jolt] useHeightField: blockSize must be 2, 4 or 8. Received ${blockSize}.`,
    );
  }

  if (sampleCount % blockSize !== 0) {
    throw new Error(
      `[r3f-jolt] useHeightField: sampleCount (${sampleCount}) must be a ` +
        `multiple of blockSize (${blockSize}).`,
    );
  }

  if (!Number.isInteger(bits) || bits < 1 || bits > 8) {
    throw new Error(
      `[r3f-jolt] useHeightField: bitsPerSample must be an integer in 1…8. ` +
        `Received ${bits}.`,
    );
  }
};

/**
 * Jolt reads and writes heights a block at a time and only asserts on a
 * misaligned region in a debug build. A release build walks off the end of the
 * heap instead — measured. Refusing here is the cheap version of that.
 */
const checkRegion = (
  x: number,
  z: number,
  sizeX: number,
  sizeZ: number,
  blockSize: number,
  sampleCount: number,
  caller: string,
) => {
  for (const [name, value] of [
    ["x", x],
    ["z", z],
    ["sizeX", sizeX],
    ["sizeZ", sizeZ],
  ] as const) {
    if (value % blockSize !== 0) {
      throw new Error(
        `[r3f-jolt] ${caller}: ${name} (${value}) must be a multiple of ` +
          `blockSize (${blockSize}).`,
      );
    }
  }

  if (x + sizeX > sampleCount || z + sizeZ > sampleCount) {
    throw new Error(
      `[r3f-jolt] ${caller}: the region (${x}, ${z}) ${sizeX}×${sizeZ} runs ` +
        `past the field's ${sampleCount}×${sampleCount} samples.`,
    );
  }
};

/**
 * Terrain at a fraction of a triangle mesh's cost: samples are quantised into
 * blocks with a per-block range, so both the shape and the queries walk far less
 * memory than the equivalent `useTrimesh`.
 */
export const useHeightField = (options: UseHeightFieldOptions) => {
  const {
    heights,
    sampleCount,
    offset = [0, 0, 0],
    sampleScale = [1, 1, 1],
    blockSize = 2,
    bitsPerSample = 8,
    range,
    materialIndices,
    materialCount,
  } = options;

  // Filled inside `useBody`'s creation effect and read by the extras factory
  // moments later. A ref because nothing re-renders on it.
  const materialsRef = useRef<Jolt.PhysicsMaterial[]>([]);

  return useBody<Jolt.HeightFieldShape, HeightFieldExtras>(
    (jolt) => {
      validate(sampleCount, blockSize, bitsPerSample);

      const settings = new jolt.HeightFieldShapeSettings();
      const offsetVec = new jolt.Vec3(offset[0], offset[1], offset[2]);
      const scaleVec = new jolt.Vec3(
        sampleScale[0],
        sampleScale[1],
        sampleScale[2],
      );

      settings.mOffset = offsetVec;
      settings.mScale = scaleVec;
      settings.mSampleCount = sampleCount;
      settings.mBlockSize = blockSize;
      settings.mBitsPerSample = bitsPerSample;

      if (range) {
        settings.mMinHeightValue = range[0];
        settings.mMaxHeightValue = range[1];
      }

      const materials: Jolt.PhysicsMaterial[] = [];

      if (materialIndices) {
        const cells = (sampleCount - 1) * (sampleCount - 1);

        if (materialIndices.length !== cells) {
          throw new Error(
            `[r3f-jolt] useHeightField: materialIndices needs one entry per ` +
              `cell — ${cells} for a sampleCount of ${sampleCount} — but has ` +
              `${materialIndices.length}.`,
          );
        }

        let count = materialCount ?? 0;
        for (let i = 0; i < cells; i += 1) {
          count = Math.max(count, materialIndices[i] + 1);
        }

        for (let i = 0; i < count; i += 1) {
          const material = new jolt.PhysicsMaterial();
          settings.mMaterials.push_back(material);
          materials.push(material);
        }

        settings.mMaterialIndices.resize(cells);
        const indexView = new Uint8Array(
          jolt.HEAPU8.buffer,
          jolt.getPointer(settings.mMaterialIndices.data()),
          cells,
        );
        for (let i = 0; i < cells; i += 1) indexView[i] = materialIndices[i];
      }

      settings.mHeightSamples.resize(sampleCount * sampleCount);

      // Acquired after the last WASM allocation above, because growing the heap
      // detaches every existing view of it.
      const samples = new Float32Array(
        jolt.HEAPF32.buffer,
        jolt.getPointer(settings.mHeightSamples.data()),
        sampleCount * sampleCount,
      );

      writeHeightSamples(
        samples,
        sampleCount,
        heights,
        jolt.HeightFieldShapeConstantValues.prototype.cNoCollisionValue,
      );

      const result = settings.Create();
      jolt.destroy(settings);
      jolt.destroy(scaleVec);
      jolt.destroy(offsetVec);

      const shape = shapeFromResultAs(
        jolt,
        result,
        jolt.HeightFieldShape,
        "useHeightField",
      );

      materialsRef.current = materials;

      return { shape, geometry: shapeToGeometry(jolt, shape) };
    },
    { ...options, motionType: "static" },
    "heightField",
    ({
      jolt,
      shape,
      geometry,
      api,
      usable,
    }: BodyApiContext<Jolt.HeightFieldShape>): HeightFieldExtras => {
      const noCollisionValue =
        jolt.HeightFieldShapeConstantValues.prototype.cNoCollisionValue;

      // One scratch buffer per call rather than one held for the body's life:
      // deformation happens on impact, not per frame.
      const withBuffer = <T>(
        size: number,
        visit: (buffer: Jolt.ArrayFloat, view: Float32Array) => T,
      ) => {
        const buffer = new jolt.ArrayFloat();
        buffer.resize(size);
        const view = new Float32Array(
          jolt.HEAPF32.buffer,
          jolt.getPointer(buffer.data()),
          size,
        );
        const value = visit(buffer, view);
        jolt.destroy(buffer);
        return value;
      };

      return {
        getMinHeight: () => shape.GetMinHeightValue(),
        getMaxHeight: () => shape.GetMaxHeightValue(),

        getHeight: (x: number, z: number) => shape.GetPosition(x, z).GetY(),

        isNoCollision: (x: number, z: number) => shape.IsNoCollision(x, z),

        getHeights: (x: number, z: number, sizeX: number, sizeZ: number) => {
          checkRegion(
            x,
            z,
            sizeX,
            sizeZ,
            shape.GetBlockSize(),
            shape.GetSampleCount(),
            "getHeights",
          );

          return withBuffer(sizeX * sizeZ, (buffer, view) => {
            shape.GetHeights(x, z, sizeX, sizeZ, buffer.data(), sizeX);
            return view.slice();
          });
        },

        setHeights: (
          x: number,
          z: number,
          sizeX: number,
          sizeZ: number,
          values: ArrayLike<number>,
        ) => {
          if (!usable()) return;

          checkRegion(
            x,
            z,
            sizeX,
            sizeZ,
            shape.GetBlockSize(),
            shape.GetSampleCount(),
            "setHeights",
          );

          if (values.length !== sizeX * sizeZ) {
            throw new Error(
              `[r3f-jolt] setHeights: expected ${sizeX * sizeZ} heights for a ` +
                `${sizeX}×${sizeZ} region, received ${values.length}.`,
            );
          }

          withBuffer(sizeX * sizeZ, (buffer, view) => {
            for (let i = 0; i < values.length; i += 1) {
              const height = values[i];
              view[i] = Number.isNaN(height) ? noCollisionValue : height;
            }

            shape.SetHeights(
              x,
              z,
              sizeX,
              sizeZ,
              buffer.data(),
              sizeX,
              api.joltInterface.GetTempAllocator(),
            );
          });

          refillShapeGeometry(jolt, shape, geometry);
        },

        noCollisionValue,
        materials: materialsRef.current,
      };
    },
  );
};
