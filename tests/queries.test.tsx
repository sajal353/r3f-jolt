import { useEffect, useState } from "react";
import { describe, expect, it } from "vitest";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useShapeCaster } from "@/Jolt/useShapeCaster";
import { useShapeOverlap } from "@/Jolt/useShapeOverlap";
import { usePointQuery } from "@/Jolt/usePointQuery";
import { useBroadphaseQuery } from "@/Jolt/useBroadphaseQuery";
import { overlapsAABox, overlapsOrientedBox } from "@/Jolt/boxOverlap";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { QueryMode } from "@/Jolt/internal/query";
import type { Vec3Tuple } from "@/Jolt/types";
import {
  expectNoAsserts,
  getApi,
  loadDebugModule,
  renderPhysics,
  step,
  unmount,
} from "./harness";

/** A body whose id the assertions can name. */
const captured: Record<string, number> = {};

const Wall = ({ name, position }: { name: string; position: Vec3Tuple }) => {
  const [, api] = useBox({
    size: [2, 2, 2],
    position,
    motionType: "static",
  });

  useEffect(() => {
    if (api) captured[name] = api.body.GetID().GetIndexAndSequenceNumber();
  }, [api, name]);

  return null;
};

const Orb = ({ name, position }: { name: string; position: Vec3Tuple }) => {
  const [, api] = useSphere({
    radius: 1,
    position,
    motionType: "static",
  });

  useEffect(() => {
    if (api) captured[name] = api.body.GetID().GetIndexAndSequenceNumber();
  }, [api, name]);

  return null;
};

/** The shape a query is run with, published so a test can hand it to a hook. */
const Probe = ({
  onShape,
  radius = 0.5,
}: {
  onShape: (shape: Jolt.Shape) => void;
  radius?: number;
}) => {
  const [, api] = useSphere({
    radius,
    position: [0, -50, 0],
    motionType: "static",
  });

  useEffect(() => {
    if (api) onShape(api.shape);
  }, [api, onShape]);

  return null;
};

const useProbeShape = () => useState<Jolt.Shape>();

describe("shape casting", () => {
  const casters: Record<string, unknown> = {};

  const Caster = <M extends QueryMode>({
    name,
    mode,
    radius,
  }: {
    name: string;
    mode: M;
    radius: number;
  }) => {
    const [shape, setShape] = useProbeShape();
    const [caster] = useShapeCaster({ shape, mode, direction: [0, 0, -10] });

    useEffect(() => {
      casters[name] = caster;
    }, [caster, name]);

    return <Probe onShape={setShape} radius={radius} />;
  };

  it("sweeps a shape and reports where it stops", async () => {
    const renderer = await renderPhysics(
      <>
        <Wall name="near" position={[0, 0, -5]} />
        <Caster name="closest" mode="closest" radius={0.5} />
      </>,
    );
    await step(renderer, 1);

    const caster = casters.closest as
      | {
          cast: (p?: Vec3Tuple) => {
            hit: boolean;
            fraction: number;
            distance: number;
            bodyID: number;
            contactPointOn2: { z: number };
          };
        }
      | undefined;

    const hit = caster!.cast([0, 0, 0]);

    // Sphere of 0.5 sweeping -z from the origin, wall face at z = -4.
    expect(hit.hit).toBe(true);
    expect(hit.bodyID).toBe(captured.near);
    expect(hit.distance).toBeCloseTo(3.5, 1);
    expect(hit.fraction).toBeCloseTo(0.35, 2);
    expect(hit.contactPointOn2.z).toBeCloseTo(-4, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("misses when the swept shape is too wide for the gap", async () => {
    const renderer = await renderPhysics(
      <>
        <Wall name="left" position={[-1.6, 0, -5]} />
        <Wall name="right" position={[1.6, 0, -5]} />
        <Caster name="thin" mode="closest" radius={0.25} />
        <Caster name="fat" mode="closest" radius={0.9} />
      </>,
    );
    await step(renderer, 1);

    type Caster = { cast: (p?: Vec3Tuple) => { hit: boolean } };
    const thin = (casters.thin as Caster).cast([0, 0, 0]);
    const fat = (casters.fat as Caster).cast([0, 0, 0]);

    // The gap between the two walls is 1.2 wide: a 0.5 sphere goes through, a
    // 1.8 one does not. This is the question a ray cannot be asked.
    expect(thin.hit).toBe(false);
    expect(fat.hit).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });

  /**
   * Every other cast here starts at the origin, and a cast that never moves
   * cannot catch this: `ShapeCast` caches the shape's world bounds when it is
   * constructed, so a cast re-aimed by writing to its fields keeps searching
   * where it used to be and quietly finds nothing. Moving the start is the
   * whole test.
   */
  it("re-aims, rather than searching where it last was", async () => {
    const renderer = await renderPhysics(
      <>
        <Wall name="offset" position={[6, 3, -5]} />
        <Caster name="moving" mode="closest" radius={0.5} />
      </>,
    );
    await step(renderer, 1);

    const caster = casters.moving as {
      cast: (p?: Vec3Tuple) => { hit: boolean; bodyID: number };
    };

    // Nothing at the origin, and the wall is nowhere near it.
    expect(caster.cast([0, 0, 0]).hit).toBe(false);

    expect(caster.cast([6, 3, 0])).toMatchObject({
      hit: true,
      bodyID: captured.offset,
    });

    // And back, so a stale cached aim in either direction fails.
    expect(caster.cast([0, 0, 0]).hit).toBe(false);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("returns every body along the sweep, nearest first", async () => {
    const renderer = await renderPhysics(
      <>
        <Wall name="near" position={[0, 0, -5]} />
        <Wall name="far" position={[0, 0, -9]} />
        <Caster name="all" mode="all" radius={0.5} />
      </>,
    );
    await step(renderer, 1);

    const caster = casters.all as {
      cast: (p?: Vec3Tuple) => { bodyID: number; fraction: number }[];
    };
    const hits = caster.cast([0, 0, 0]);

    expect(hits.map((entry) => entry.bodyID)).toEqual([
      captured.near,
      captured.far,
    ]);
    expect(hits[0].fraction).toBeLessThan(hits[1].fraction);

    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("shape overlap", () => {
  const probes: Record<string, unknown> = {};

  const Overlap = <M extends QueryMode>({
    name,
    mode,
    radius = 1.5,
  }: {
    name: string;
    mode: M;
    radius?: number;
  }) => {
    const [shape, setShape] = useProbeShape();
    const [probe] = useShapeOverlap({ shape, mode });

    useEffect(() => {
      probes[name] = probe;
    }, [probe, name]);

    return <Probe onShape={setShape} radius={radius} />;
  };

  it("finds every body a shape would be touching", async () => {
    const renderer = await renderPhysics(
      <>
        <Wall name="left" position={[-1.2, 0, 0]} />
        <Wall name="right" position={[1.2, 0, 0]} />
        <Wall name="away" position={[0, 0, -20]} />
        <Overlap name="all" mode="all" />
      </>,
    );
    await step(renderer, 1);

    const probe = probes.all as {
      overlap: (p?: Vec3Tuple) => { bodyID: number }[];
    };

    const found = probe.overlap([0, 0, 0]).map((entry) => entry.bodyID);

    expect(found).toHaveLength(2);
    expect(found).toContain(captured.left);
    expect(found).toContain(captured.right);
    expect(found).not.toContain(captured.away);

    // Empty space finds nothing, and the array is emptied rather than stale.
    expect(probe.overlap([0, 40, 0])).toHaveLength(0);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("reports contact points in world space", async () => {
    const renderer = await renderPhysics(
      <>
        <Wall name="near" position={[3, 0, 0]} />
        <Overlap name="closest" mode="closest" />
      </>,
    );
    await step(renderer, 1);

    const probe = probes.closest as {
      overlap: (p?: Vec3Tuple) => {
        hit: boolean;
        contactPointOn2: { x: number };
        penetrationDepth: number;
      };
    };

    // Probe of radius 1.5 at x = 2.5 reaches x = 4; the wall face is at x = 2.
    const hit = probe.overlap([2.5, 0, 0]);

    expect(hit.hit).toBe(true);
    expect(hit.contactPointOn2.x).toBeCloseTo(2, 1);
    expect(hit.penetrationDepth).toBeGreaterThan(0);

    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("point queries", () => {
  const queries: Record<string, unknown> = {};

  const Point = ({ name }: { name: string }) => {
    const [query] = usePointQuery({ mode: "closest" });

    useEffect(() => {
      queries[name] = query;
    }, [query, name]);

    return null;
  };

  it("finds the body containing a point, and nothing outside it", async () => {
    const renderer = await renderPhysics(
      <>
        <Wall name="block" position={[4, 0, 0]} />
        <Point name="probe" />
      </>,
    );
    await step(renderer, 1);

    const query = queries.probe as {
      query: (p: Vec3Tuple) => { hit: boolean; bodyID: number };
    };

    expect(query.query([4, 0, 0])).toMatchObject({
      hit: true,
      bodyID: captured.block,
    });
    expect(query.query([4, 6, 0]).hit).toBe(false);

    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("broadphase queries", () => {
  const queries: Record<string, unknown> = {};

  const Broad = ({ name }: { name: string }) => {
    const [query] = useBroadphaseQuery();
    const [exact] = usePointQuery();

    useEffect(() => {
      queries[name] = query;
      queries[`${name}-exact`] = exact;
    }, [query, exact, name]);

    return null;
  };

  it("answers with body ids, and its answer contains the exact one", async () => {
    const renderer = await renderPhysics(
      <>
        <Wall name="inside" position={[0, 0, 0]} />
        <Orb name="orb" position={[6, 0, 0]} />
        <Wall name="away" position={[0, 0, -30]} />
        <Broad name="broad" />
      </>,
    );
    await step(renderer, 1);

    const broad = queries.broad as {
      collideAABox: (min: Vec3Tuple, max: Vec3Tuple) => number[];
      collideSphere: (centre: Vec3Tuple, radius: number) => number[];
      collidePoint: (point: Vec3Tuple) => number[];
      castRay: (origin: Vec3Tuple, direction: Vec3Tuple) => number[];
      castAABox: (
        min: Vec3Tuple,
        max: Vec3Tuple,
        direction: Vec3Tuple,
      ) => number[];
      collideOrientedBox: (
        centre: Vec3Tuple,
        halfExtents: Vec3Tuple,
      ) => number[];
    };

    const box = broad.collideAABox([-2, -2, -2], [2, 2, 2]);
    expect(box).toContain(captured.inside);
    expect(box).not.toContain(captured.away);

    expect(broad.collideSphere([0, 0, 0], 1)).toContain(captured.inside);
    expect(broad.collidePoint([0, 0, 0])).toContain(captured.inside);
    expect(broad.collideOrientedBox([0, 0, 0], [1, 1, 1])).toContain(
      captured.inside,
    );
    expect(broad.castRay([0, 0, 20], [0, 0, -60])).toContain(captured.inside);
    expect(
      broad.castAABox([-0.5, -0.5, 19], [0.5, 0.5, 20], [0, 0, -60]),
    ).toContain(captured.inside);

    // Bounding boxes, not shapes, and that is the whole trade. This region
    // touches the corner of the sphere's bounding box and misses the sphere by
    // 4cm: broadphase says yes, an exact query says no.
    const exact = queries["broad-exact"] as {
      query: (point: Vec3Tuple) => { hit: boolean };
    };

    expect(broad.collideAABox([6.6, 0.6, 0.6], [7.2, 1.2, 1.2])).toContain(
      captured.orb,
    );
    expect(exact.query([6.8, 0.8, 0.8]).hit).toBe(false);
    expect(exact.query([6, 0, 0]).hit).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("ignoring bodies", () => {
  const held: Record<string, unknown> = {};

  const SelfQuery = () => {
    const [shape, setShape] = useProbeShape();
    const [probe] = useShapeOverlap({ shape, mode: "all" });

    const [, selfApi] = useBox({
      size: [2, 2, 2],
      position: [0, 0, 0],
      motionType: "static",
    });

    useEffect(() => {
      held.probe = probe;
      held.self = selfApi;
    }, [selfApi, probe]);

    return <Probe onShape={setShape} radius={1.5} />;
  };

  it("drops the querying body from its own results", async () => {
    const renderer = await renderPhysics(<SelfQuery />);
    await step(renderer, 1);

    const probe = held.probe as {
      overlap: (p?: Vec3Tuple) => { bodyID: number }[];
      setIgnoredBodies: (bodies: BodyApi<Jolt.BoxShape>[]) => void;
    };
    const self = held.self as BodyApi<Jolt.BoxShape>;

    expect(probe.overlap([0, 0, 0])).toHaveLength(1);

    probe.setIgnoredBodies([self]);
    expect(probe.overlap([0, 0, 0])).toHaveLength(0);

    probe.setIgnoredBodies([]);
    expect(probe.overlap([0, 0, 0])).toHaveLength(1);

    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("box overlap helpers", () => {
  it("tests boxes with no world involved", async () => {
    const jolt = await loadDebugModule();

    const unit = {
      centre: [0, 0, 0] as Vec3Tuple,
      halfExtents: [1, 1, 1] as Vec3Tuple,
    };

    expect(
      overlapsAABox(jolt, unit, { min: [0.5, -1, -1], max: [3, 1, 1] }),
    ).toBe(true);
    expect(
      overlapsAABox(jolt, unit, { min: [4, -1, -1], max: [6, 1, 1] }),
    ).toBe(false);

    expect(
      overlapsOrientedBox(jolt, unit, {
        centre: [1.5, 0, 0],
        halfExtents: [1, 1, 1],
      }),
    ).toBe(true);
    expect(
      overlapsOrientedBox(jolt, unit, {
        centre: [5, 0, 0],
        halfExtents: [1, 1, 1],
      }),
    ).toBe(false);
  });
});

describe("query lifetime", () => {
  /**
   * These hooks allocate Jolt objects in an effect, and `<StrictMode>` mounts
   * every effect twice — setup, cleanup, setup. A teardown that frees what the
   * *second* setup is using, or one that frees nothing, both show up here and
   * nowhere else. The demo runs in StrictMode; the rest of this suite does not.
   */
  it("survives the double mount StrictMode does", async () => {
    const strict: { caster: unknown; probe: unknown } = {
      caster: undefined,
      probe: undefined,
    };

    const Strict = () => {
      const [shape, setShape] = useProbeShape();
      const [caster] = useShapeCaster({ shape, direction: [0, 0, -10] });
      const [probe] = useShapeOverlap({ shape, mode: "all" });

      useEffect(() => {
        strict.caster = caster;
        strict.probe = probe;
      }, [caster, probe]);

      return <Probe onShape={setShape} radius={0.5} />;
    };

    const renderer = await renderPhysics(
      <>
        <Wall name="target" position={[0, 0, -5]} />
        <Strict />
      </>,
      { strict: true },
    );
    await step(renderer, 1);

    const caster = strict.caster as {
      cast: (p: Vec3Tuple) => { hit: boolean; bodyID: number };
    };
    const probe = strict.probe as {
      overlap: (p: Vec3Tuple) => { bodyID: number }[];
    };

    expect(caster.cast([0, 0, 0])).toMatchObject({
      hit: true,
      bodyID: captured.target,
    });
    expect(probe.overlap([0, 0, -5])).toHaveLength(1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("waits for a shape that has not mounted yet", async () => {
    const late: { caster: unknown } = { caster: undefined };

    const Late = () => {
      const [shape, setShape] = useProbeShape();
      const [caster] = useShapeCaster({ shape, direction: [0, 0, -5] });

      useEffect(() => {
        late.caster = caster;
      }, [caster]);

      return <Probe onShape={setShape} />;
    };

    const renderer = await renderPhysics(<Late />);

    // The shape only exists once the body hook has published it, so the caster
    // is undefined on the first pass and arrives on the second.
    await step(renderer, 1);
    expect(late.caster).toBeDefined();

    await unmount(renderer);
    expect(getApi).toBeDefined();
    expectNoAsserts();
  });
});
