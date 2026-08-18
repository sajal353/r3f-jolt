import { useEffect, useState } from "react";
import type Jolt from "jolt-physics";
import { useJolt } from "./useJolt";
import {
  createQueryFilters,
  readVector,
  type QueryBody,
  type QueryFilterOptions,
  type QueryMode,
} from "./internal/query";
import type { Vec3Input } from "./types";

export interface UsePointQueryOptions<
  M extends QueryMode = "closest",
> extends QueryFilterOptions {
  mode?: M;
  point?: Vec3Input;
}

/** All a point query can say: which body, and which part of it. */
export interface PointHit {
  hit: boolean;
  bodyID: number;
  subShapeID: number;
}

type PointCollector<M extends QueryMode> = M extends "all"
  ? Jolt.CollidePointAllHitCollisionCollector
  : M extends "any"
    ? Jolt.CollidePointAnyHitCollisionCollector
    : Jolt.CollidePointClosestHitCollisionCollector;

type PointResult<M extends QueryMode> = M extends "all" ? PointHit[] : PointHit;

export interface PointQueryApi<M extends QueryMode = "closest"> {
  collector: PointCollector<M>;
  query: (point?: Vec3Input) => PointResult<M>;
  setIgnoredBodies: (bodies: QueryBody[]) => void;
}

const createPointHit = (): PointHit => ({
  hit: false,
  bodyID: 0,
  subShapeID: 0,
});

const fillPointHit = (result: PointHit, raw: Jolt.CollidePointResult) => {
  result.hit = true;
  result.bodyID = raw.mBodyID.GetIndexAndSequenceNumber();
  result.subShapeID = raw.mSubShapeID2.GetValue();
  return result;
};

/**
 * Which body contains this point. The cheapest question in the library — no
 * shape, no direction, no sweep — and until now it had to be faked with a very
 * short ray, which answers a different question: a ray needs to *enter* a body,
 * so one starting inside reports nothing.
 *
 * Results are reused between calls — copy anything you need to keep.
 */
export const usePointQuery = <M extends QueryMode = "closest">(
  options: UsePointQueryOptions<M> = {},
) => {
  const api = useJolt();
  const [pointQuery, setPointQuery] = useState<PointQueryApi<M>>();

  const [mount] = useState(() => options);

  useEffect(() => {
    const { Jolt: jolt, layers, physicsSystem, state } = api;
    const {
      mode = "closest" as M,
      point = [0, 0, 0],
      layer = layers.LAYER_MOVING,
    } = mount;

    const filters = createQueryFilters(api, layer, mount);

    const [x, y, z] = readVector(point);
    const target = new jolt.RVec3(x, y, z);

    const collector =
      mode === "all"
        ? new jolt.CollidePointAllHitCollisionCollector()
        : mode === "any"
          ? new jolt.CollidePointAnyHitCollisionCollector()
          : new jolt.CollidePointClosestHitCollisionCollector();

    const single = createPointHit();
    const pool: PointHit[] = [];
    const results: PointHit[] = [];

    const run = (next?: Vec3Input) => {
      if (next) {
        const [nextX, nextY, nextZ] = readVector(next);
        target.Set(nextX, nextY, nextZ);
      }

      // Collectors accumulate across calls; without the reset a query reports
      // hits from three frames ago.
      collector.Reset();
      physicsSystem
        .GetNarrowPhaseQuery()
        .CollidePoint(
          target,
          collector,
          filters.broadPhaseFilter,
          filters.objectFilter,
          filters.bodyFilter,
          filters.shapeFilter,
        );
    };

    const queryOne = (next?: Vec3Input) => {
      if (state.disposed) return single;

      run(next);

      single.hit = false;
      single.bodyID = 0;
      single.subShapeID = 0;

      const hitCollector = collector as
        | Jolt.CollidePointClosestHitCollisionCollector
        | Jolt.CollidePointAnyHitCollisionCollector;

      return hitCollector.HadHit()
        ? fillPointHit(single, hitCollector.mHit)
        : single;
    };

    const queryAll = (next?: Vec3Input) => {
      results.length = 0;
      if (state.disposed) return results;

      run(next);

      const allCollector =
        collector as Jolt.CollidePointAllHitCollisionCollector;
      if (!allCollector.HadHit()) return results;

      const hits = allCollector.mHits;

      for (let i = 0; i < hits.size(); i += 1) {
        if (pool.length <= i) pool.push(createPointHit());
        results.push(fillPointHit(pool[i], hits.at(i)));
      }

      return results;
    };

    const query = (
      mode === "all" ? queryAll : queryOne
    ) as PointQueryApi<M>["query"];

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPointQuery({
      collector: collector as PointCollector<M>,
      query,
      setIgnoredBodies: filters.setIgnoredBodies,
    });

    return () => {
      setPointQuery(undefined);

      if (state.destroyed) return;

      jolt.destroy(collector);
      jolt.destroy(target);
      filters.destroy();
    };
  }, [api, mount]);

  return [pointQuery] as [PointQueryApi<M> | undefined];
};
