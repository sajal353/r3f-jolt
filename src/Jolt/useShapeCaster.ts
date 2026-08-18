import { useEffect, useState } from "react";
import type Jolt from "jolt-physics";
import { useJolt } from "./useJolt";
import {
  centreOfMassTransform,
  clearShapeCastHit,
  createQueryFilters,
  createShapeCastHit,
  fillShapeCastHit,
  readQuat,
  readVector,
  type QueryBody,
  type QueryFilterOptions,
  type QueryMode,
  type ShapeCastHit,
} from "./internal/query";
import type { QuatInput, Vec3Input } from "./types";

export interface UseShapeCasterOptions<
  M extends QueryMode = "closest",
> extends QueryFilterOptions {
  /**
   * The shape to sweep — a body's `api.shape`, or one built by hand. It may be
   * `undefined` while the body it comes from is still mounting; the caster
   * waits for it, exactly as a constraint waits for its bodies.
   */
  shape: Jolt.Shape | undefined;
  mode?: M;
  position?: Vec3Input;
  rotation?: QuatInput;
  /** Length matters: it is how far the sweep reaches. */
  direction?: Vec3Input;
  scale?: Vec3Input;
  /** Hit the inside of triangles too. Off by default, as in Jolt. */
  backFaces?: boolean;
  /**
   * For a sweep that starts already overlapping, report the deepest point of
   * that overlap rather than the first touch. Fraction is 0 either way.
   */
  returnDeepestPoint?: boolean;
}

type ShapeCastCollector<M extends QueryMode> = M extends "all"
  ? Jolt.CastShapeAllHitCollisionCollector
  : M extends "any"
    ? Jolt.CastShapeAnyHitCollisionCollector
    : Jolt.CastShapeClosestHitCollisionCollector;

type ShapeCastResult<M extends QueryMode> = M extends "all"
  ? ShapeCastHit[]
  : ShapeCastHit;

export interface ShapeCasterApi<M extends QueryMode = "closest"> {
  shapeCast: Jolt.RShapeCast;
  collector: ShapeCastCollector<M>;
  /**
   * Every argument is optional and falls back to the last one used, so a caster
   * that only changes its start can be called with one.
   */
  cast: (
    position?: Vec3Input,
    rotation?: QuatInput,
    direction?: Vec3Input,
  ) => ShapeCastResult<M>;
  setIgnoredBodies: (bodies: QueryBody[]) => void;
}

/**
 * Sweeps a shape along a direction and reports what it runs into. A ray is a
 * line with no width, so "does this fit through there" is not a question it can
 * answer; this is.
 *
 * The hit objects and the array holding them are reused between casts — copy
 * anything you need to keep. Casting allocates nothing.
 */
export const useShapeCaster = <M extends QueryMode = "closest">(
  options: UseShapeCasterOptions<M>,
) => {
  const api = useJolt();
  const [caster, setCaster] = useState<ShapeCasterApi<M>>();

  // Init-once, like the body hooks: snapshot at mount, rebuild with `key`.
  const [mount] = useState(() => options);
  const { shape } = options;

  useEffect(() => {
    if (!shape) return;

    const { Jolt: jolt, layers, physicsSystem, state } = api;
    const {
      mode = "closest" as M,
      position = [0, 0, 0],
      rotation = [0, 0, 0, 1],
      direction = [0, -1, 0],
      scale = [1, 1, 1],
      layer = layers.LAYER_MOVING,
      backFaces = false,
      returnDeepestPoint = false,
    } = mount;

    // The shape belongs to the body it came from, and that body may unmount
    // first. A reference of our own is what stops the query reaching into freed
    // memory in the frames before React tears this hook down too.
    shape.AddRef();

    const filters = createQueryFilters(api, layer, mount);
    const settings = new jolt.ShapeCastSettings();

    if (backFaces) {
      settings.mBackFaceModeTriangles = jolt.EBackFaceMode_CollideWithBackFaces;
      settings.mBackFaceModeConvex = jolt.EBackFaceMode_CollideWithBackFaces;
    }

    settings.mReturnDeepestPoint = returnDeepestPoint;

    const [scaleX, scaleY, scaleZ] = readVector(scale);
    const castScale = new jolt.Vec3(scaleX, scaleY, scaleZ);
    const castOrigin = new jolt.RVec3(0, 0, 0);
    const castRotation = new jolt.Quat(0, 0, 0, 1);
    const castDirection = new jolt.Vec3(0, -1, 0);
    const zeroOffset = new jolt.RVec3(0, 0, 0);

    /**
     * **`RShapeCast` is immutable in practice.** Its members look writable —
     * the getters even hand back live views into the struct — but the
     * constructor also caches the shape's world bounds, and nothing exposes
     * them. Re-aim one by writing through the views and every readable field
     * is right while the broadphase carries on searching where the cast used
     * to be, so it quietly finds nothing. It is rebuilt instead, which is the
     * one allocation a cast costs.
     */
    const buildCast = () =>
      new jolt.RShapeCast(
        shape,
        castScale,
        centreOfMassTransform(jolt, shape, castOrigin, castRotation),
        castDirection,
      );

    let directionLength = 0;
    let aimed = false;
    let shapeCast = buildCast();

    const aim = (
      nextPosition?: Vec3Input,
      nextRotation?: QuatInput,
      nextDirection?: Vec3Input,
    ) => {
      if (nextPosition) {
        const [x, y, z] = readVector(nextPosition);
        castOrigin.Set(x, y, z);
        aimed = true;
      }

      if (nextRotation) {
        const [x, y, z, w] = readQuat(nextRotation);
        castRotation.Set(x, y, z, w);
        aimed = true;
      }

      if (nextDirection) {
        const [x, y, z] = readVector(nextDirection);
        castDirection.Set(x, y, z);
        directionLength = Math.hypot(x, y, z);
        aimed = true;
      }
    };

    aim(position, rotation, direction);

    const collector =
      mode === "all"
        ? new jolt.CastShapeAllHitCollisionCollector()
        : mode === "any"
          ? new jolt.CastShapeAnyHitCollisionCollector()
          : new jolt.CastShapeClosestHitCollisionCollector();

    const single = createShapeCastHit();
    const pool: ShapeCastHit[] = [];
    const results: ShapeCastHit[] = [];
    const offset: [number, number, number] = [0, 0, 0];

    const run = () => {
      if (aimed) {
        jolt.destroy(shapeCast);
        shapeCast = buildCast();
        aimed = false;
      }

      // Collectors accumulate across calls; without the reset a cast reports
      // hits from three frames ago.
      collector.Reset();
      physicsSystem
        .GetNarrowPhaseQuery()
        .CastShape(
          shapeCast,
          settings,
          zeroOffset,
          collector,
          filters.broadPhaseFilter,
          filters.objectFilter,
          filters.bodyFilter,
          filters.shapeFilter,
        );
    };

    const castOne = (
      nextPosition?: Vec3Input,
      nextRotation?: QuatInput,
      nextDirection?: Vec3Input,
    ) => {
      if (state.disposed) return single;

      aim(nextPosition, nextRotation, nextDirection);
      run();
      clearShapeCastHit(single);

      const hitCollector = collector as
        | Jolt.CastShapeClosestHitCollisionCollector
        | Jolt.CastShapeAnyHitCollisionCollector;

      return hitCollector.HadHit()
        ? fillShapeCastHit(single, hitCollector.mHit, offset, directionLength)
        : single;
    };

    const castAll = (
      nextPosition?: Vec3Input,
      nextRotation?: QuatInput,
      nextDirection?: Vec3Input,
    ) => {
      results.length = 0;
      if (state.disposed) return results;

      aim(nextPosition, nextRotation, nextDirection);
      run();

      const allCollector = collector as Jolt.CastShapeAllHitCollisionCollector;
      if (!allCollector.HadHit()) return results;

      // Jolt collects in traversal order; sorting is what makes "nearest first"
      // true rather than usually-true.
      allCollector.Sort();

      const hits = allCollector.mHits;

      for (let i = 0; i < hits.size(); i += 1) {
        if (pool.length <= i) pool.push(createShapeCastHit());
        results.push(
          fillShapeCastHit(pool[i], hits.at(i), offset, directionLength),
        );
      }

      return results;
    };

    // The mode decides the collector and the return shape together, and the
    // generic proves the pair match at the call site; inside, one cast is what
    // it costs to write both branches once.
    const cast = (
      mode === "all" ? castAll : castOne
    ) as ShapeCasterApi<M>["cast"];

    // Same external-resource publication as `useCar`, and exempt for the same
    // reason: no ref in the published value.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCaster({
      // Rebuilt on every re-aim, so this has to read through rather than
      // capture whichever one existed at mount.
      get shapeCast() {
        return shapeCast;
      },
      collector: collector as ShapeCastCollector<M>,
      cast,
      setIgnoredBodies: filters.setIgnoredBodies,
    });

    return () => {
      setCaster(undefined);

      if (state.destroyed) return;

      jolt.destroy(collector);
      jolt.destroy(shapeCast);
      jolt.destroy(zeroOffset);
      jolt.destroy(castDirection);
      jolt.destroy(castRotation);
      jolt.destroy(castOrigin);
      jolt.destroy(castScale);
      jolt.destroy(settings);
      filters.destroy();
      shape.Release();
    };
  }, [api, mount, shape]);

  return [caster] as [ShapeCasterApi<M> | undefined];
};
