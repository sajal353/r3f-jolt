import { useEffect, useState } from "react";
import type Jolt from "jolt-physics";
import { useJolt } from "./useJolt";
import {
  centreOfMassTransform,
  clearOverlapHit,
  createOverlapHit,
  createQueryFilters,
  fillOverlapHit,
  readQuat,
  readVector,
  type OverlapHit,
  type QueryBody,
  type QueryFilterOptions,
  type QueryMode,
} from "./internal/query";
import type { QuatInput, Vec3Input } from "./types";

export interface UseShapeOverlapOptions<
  M extends QueryMode = "closest",
> extends QueryFilterOptions {
  /**
   * The shape to test with — a body's `api.shape`, or one built by hand. It may
   * be `undefined` while the body it comes from is still mounting; the hook
   * waits for it.
   */
  shape: Jolt.Shape | undefined;
  mode?: M;
  position?: Vec3Input;
  rotation?: QuatInput;
  scale?: Vec3Input;
  /** Also report bodies within this distance of touching, not only overlaps. */
  maxSeparationDistance?: number;
  backFaces?: boolean;
  /**
   * Drops the ghost hits a swept shape gets from the interior edges of a
   * triangle mesh, where two triangles meet and neither is really a wall.
   */
  internalEdgeRemoval?: boolean;
}

type OverlapCollector<M extends QueryMode> = M extends "all"
  ? Jolt.CollideShapeAllHitCollisionCollector
  : M extends "any"
    ? Jolt.CollideShapeAnyHitCollisionCollector
    : Jolt.CollideShapeClosestHitCollisionCollector;

type OverlapResult<M extends QueryMode> = M extends "all"
  ? OverlapHit[]
  : OverlapHit;

export interface ShapeOverlapApi<M extends QueryMode = "closest"> {
  collector: OverlapCollector<M>;
  /** Both arguments fall back to the last ones used. */
  overlap: (position?: Vec3Input, rotation?: QuatInput) => OverlapResult<M>;
  setIgnoredBodies: (bodies: QueryBody[]) => void;
}

/**
 * What a shape would be touching if it were placed here — trigger volumes,
 * blast radii, "is this spawn point clear", "select everything in the box".
 * Nothing is added to the world and nothing moves.
 *
 * The hit objects and the array holding them are reused between calls — copy
 * anything you need to keep.
 */
export const useShapeOverlap = <M extends QueryMode = "closest">(
  options: UseShapeOverlapOptions<M>,
) => {
  const api = useJolt();
  const [probe, setProbe] = useState<ShapeOverlapApi<M>>();

  const [mount] = useState(() => options);
  const { shape } = options;

  useEffect(() => {
    if (!shape) return;

    const { Jolt: jolt, layers, physicsSystem, state } = api;
    const {
      mode = "closest" as M,
      position = [0, 0, 0],
      rotation = [0, 0, 0, 1],
      scale = [1, 1, 1],
      layer = layers.LAYER_MOVING,
      maxSeparationDistance = 0,
      backFaces = false,
      internalEdgeRemoval = false,
    } = mount;

    // The shape belongs to the body it came from, and that body may unmount
    // first. A reference of our own is what stops the query reaching into freed
    // memory in the frames before React tears this hook down too.
    shape.AddRef();

    const filters = createQueryFilters(api, layer, mount);
    const settings = new jolt.CollideShapeSettings();

    settings.mMaxSeparationDistance = maxSeparationDistance;

    if (backFaces) {
      settings.mBackFaceMode = jolt.EBackFaceMode_CollideWithBackFaces;
    }

    const [scaleX, scaleY, scaleZ] = readVector(scale);
    const probeScale = new jolt.Vec3(scaleX, scaleY, scaleZ);
    const probeOrigin = new jolt.RVec3(0, 0, 0);
    const probeRotation = new jolt.Quat(0, 0, 0, 1);

    const place = (nextPosition?: Vec3Input, nextRotation?: QuatInput) => {
      if (nextPosition) {
        const [x, y, z] = readVector(nextPosition);
        probeOrigin.Set(x, y, z);
      }

      if (nextRotation) {
        const [x, y, z, w] = readQuat(nextRotation);
        probeRotation.Set(x, y, z, w);
      }
    };

    place(position, rotation);

    const collector =
      mode === "all"
        ? new jolt.CollideShapeAllHitCollisionCollector()
        : mode === "any"
          ? new jolt.CollideShapeAnyHitCollisionCollector()
          : new jolt.CollideShapeClosestHitCollisionCollector();

    const single = createOverlapHit();
    const pool: OverlapHit[] = [];
    const results: OverlapHit[] = [];
    const offset: [number, number, number] = [0, 0, 0];

    const query = physicsSystem.GetNarrowPhaseQuery();

    const collide = internalEdgeRemoval
      ? query.CollideShapeWithInternalEdgeRemoval.bind(query)
      : query.CollideShape.bind(query);

    const run = () => {
      offset[0] = probeOrigin.GetX();
      offset[1] = probeOrigin.GetY();
      offset[2] = probeOrigin.GetZ();

      const transform = centreOfMassTransform(
        jolt,
        shape,
        probeOrigin,
        probeRotation,
      );

      // Collectors accumulate across calls; without the reset a query reports
      // hits from three frames ago.
      collector.Reset();

      collide(
        shape,
        probeScale,
        transform,
        settings,
        probeOrigin,
        collector,
        filters.broadPhaseFilter,
        filters.objectFilter,
        filters.bodyFilter,
        filters.shapeFilter,
      );
    };

    const overlapOne = (nextPosition?: Vec3Input, nextRotation?: QuatInput) => {
      if (state.disposed) return single;

      place(nextPosition, nextRotation);
      run();
      clearOverlapHit(single);

      const hitCollector = collector as
        | Jolt.CollideShapeClosestHitCollisionCollector
        | Jolt.CollideShapeAnyHitCollisionCollector;

      return hitCollector.HadHit()
        ? fillOverlapHit(single, hitCollector.mHit, offset)
        : single;
    };

    const overlapAll = (nextPosition?: Vec3Input, nextRotation?: QuatInput) => {
      results.length = 0;
      if (state.disposed) return results;

      place(nextPosition, nextRotation);
      run();

      const allCollector =
        collector as Jolt.CollideShapeAllHitCollisionCollector;
      if (!allCollector.HadHit()) return results;

      const hits = allCollector.mHits;

      for (let i = 0; i < hits.size(); i += 1) {
        if (pool.length <= i) pool.push(createOverlapHit());
        results.push(fillOverlapHit(pool[i], hits.at(i), offset));
      }

      return results;
    };

    const overlap = (
      mode === "all" ? overlapAll : overlapOne
    ) as ShapeOverlapApi<M>["overlap"];

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProbe({
      collector: collector as OverlapCollector<M>,
      overlap,
      setIgnoredBodies: filters.setIgnoredBodies,
    });

    return () => {
      setProbe(undefined);

      if (state.destroyed) return;

      jolt.destroy(collector);
      jolt.destroy(probeRotation);
      jolt.destroy(probeOrigin);
      jolt.destroy(probeScale);
      jolt.destroy(settings);
      filters.destroy();
      shape.Release();
    };
  }, [api, mount, shape]);

  return [probe] as [ShapeOverlapApi<M> | undefined];
};
