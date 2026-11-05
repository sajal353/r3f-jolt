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
import { readBounds, unionBounds, wakeBodiesIn } from "./internal/wakeBodies";
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
   * mesh and the collider cannot drift, and wakes whatever sits on it. Same
   * block-alignment rule as `getHeights`, and the same clamping to `range` as
   * the build.
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

interface Region {
  x: number;
  z: number;
  sizeX: number;
  sizeZ: number;
}

const mergeRegions = (first: Region, second: Region): Region => {
  const x = Math.min(first.x, second.x);
  const z = Math.min(first.z, second.z);

  return {
    x,
    z,
    sizeX: Math.max(first.x + first.sizeX, second.x + second.sizeX) - x,
    sizeZ: Math.max(first.z + first.sizeZ, second.z + second.sizeZ) - z,
  };
};

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
    stateId,
    rotation,
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
      body,
      shape,
      geometry,
      api,
      usable,
      onDispose,
    }: BodyApiContext<Jolt.HeightFieldShape>): HeightFieldExtras => {
      const noCollisionValue =
        jolt.HeightFieldShapeConstantValues.prototype.cNoCollisionValue;
      const { bodyInterface } = api;
      const samples = shape.GetSampleCount();

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

      const readRegion = ({ x, z, sizeX, sizeZ }: Region) =>
        withBuffer(sizeX * sizeZ, (buffer, view) => {
          shape.GetHeights(x, z, sizeX, sizeZ, buffer.data(), sizeX);
          return view.slice();
        });

      const writeRegion = (
        { x, z, sizeX, sizeZ }: Region,
        values: ArrayLike<number>,
      ) => {
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
      };

      /**
       * `SetHeights` changes the shape and nothing that has read it: the body's
       * bounds in the broadphase still end at the old heights, so a new hill
       * collides with nothing above them, and contacts cached against the old
       * surface hold a body in the air.
       */
      const notifyChanged = () => {
        bodyInterface.NotifyShapeChanged(
          body.GetID(),
          body.GetShape().GetCenterOfMass(),
          false,
          jolt.EActivation_DontActivate,
        );
        refillShapeGeometry(jolt, shape, geometry);
      };

      /** A rotated or scaled field wakes everything over it, not just the patch. */
      const isPlain = () =>
        !rotation && jolt.getPointer(body.GetShape()) === jolt.getPointer(shape);

      const wakeOver = (
        { x, z, sizeX, sizeZ }: Region,
        before: ReturnType<typeof readBounds>,
      ) => {
        const box = unionBounds(before, readBounds(body));

        if (isPlain()) {
          const origin = body.GetPosition();
          const left = origin.GetX() + offset[0];
          const back = origin.GetZ() + offset[2];

          // A step further than the samples written: the triangles either side
          // of them moved as well.
          box.min[0] = left + (x - 1) * sampleScale[0];
          box.max[0] = left + (x + sizeX) * sampleScale[0];
          box.min[2] = back + (z - 1) * sampleScale[2];
          box.max[2] = back + (z + sizeZ) * sampleScale[2];
        }

        wakeBodiesIn(jolt, bodyInterface, box);
      };

      // What a snapshot needs on top of Jolt's stream, which knows nothing of a
      // shape's contents. Only a field with a `stateId` can be in one, so only
      // that one pays for keeping its first heights.
      const tracked = stateId !== undefined;
      const whole: Region = { x: 0, z: 0, sizeX: samples, sizeZ: samples };
      let pristine: Float32Array | null = null;
      let edited: Region | null = null;
      let savedValues: number[] | null = null;

      const noteEdit = (region: Region) => {
        if (!tracked) return;
        pristine ??= readRegion(whole);
        edited = edited ? mergeRegions(edited, region) : region;
        savedValues = null;
      };

      const saveHeights = () => {
        if (!edited) return [];

        savedValues ??= [
          edited.x,
          edited.z,
          edited.sizeX,
          edited.sizeZ,
          ...readRegion(edited),
        ];
        return savedValues;
      };

      const restoreHeights = (values: number[]) => {
        const current = saveHeights();
        const unchanged =
          current.length === values.length &&
          current.every((value, index) => value === values[index]);
        if (unchanged) return;

        const firstHeights = pristine ?? readRegion(whole);
        pristine = firstHeights;

        const saved: Region | null =
          values.length > 0
            ? {
                x: values[0],
                z: values[1],
                sizeX: values[2],
                sizeZ: values[3],
              }
            : null;

        // Whatever was edited since has to go back too, so it starts from the
        // first heights and lays the saved patch over them.
        const region =
          edited && saved ? mergeRegions(edited, saved) : (edited ?? saved);

        if (region) {
          const merged = new Float32Array(region.sizeX * region.sizeZ);

          for (let row = 0; row < region.sizeZ; row += 1) {
            for (let column = 0; column < region.sizeX; column += 1) {
              const sampleX = region.x + column;
              const sampleZ = region.z + row;
              const inSaved =
                saved &&
                sampleX >= saved.x &&
                sampleX < saved.x + saved.sizeX &&
                sampleZ >= saved.z &&
                sampleZ < saved.z + saved.sizeZ;

              merged[row * region.sizeX + column] =
                saved && inSaved
                  ? values[
                      4 +
                        (sampleZ - saved.z) * saved.sizeX +
                        (sampleX - saved.x)
                    ]
                  : firstHeights[sampleZ * samples + sampleX];
            }
          }

          writeRegion(region, merged);
          notifyChanged();
        }

        edited = saved;
        savedValues = saved ? values : null;
      };

      if (tracked) {
        onDispose(
          api.snapshots.keep({
            tag: "shape",
            owner: "body",
            id: body.GetID().GetIndexAndSequenceNumber(),
            save: saveHeights,
            restore: restoreHeights,
          }),
        );
      }

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
            samples,
            "getHeights",
          );

          return readRegion({ x, z, sizeX, sizeZ });
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
            samples,
            "setHeights",
          );

          if (values.length !== sizeX * sizeZ) {
            throw new Error(
              `[r3f-jolt] setHeights: expected ${sizeX * sizeZ} heights for a ` +
                `${sizeX}×${sizeZ} region, received ${values.length}.`,
            );
          }

          const region = { x, z, sizeX, sizeZ };
          const before = readBounds(body);

          noteEdit(region);
          writeRegion(region, values);
          notifyChanged();
          wakeOver(region, before);
        },

        noCollisionValue,
        materials: materialsRef.current,
      };
    },
  );
};
