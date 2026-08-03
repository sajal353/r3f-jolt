import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { describe, expect, it, vi } from "vitest";
import { Mesh, type Scene } from "three";
import { useBox } from "@/Jolt/useBox";
import { useCompound } from "@/Jolt/useCompound";
import type { CompoundChild } from "@/Jolt/useCompound";
import type Jolt from "jolt-physics";
import type { BodyApi } from "@/Jolt/internal/useBody";
import { roundedBoxGeometry } from "@/Jolt/internal/roundedBoxGeometry";
import { expectNoAsserts, renderPhysics, step, unmount } from "./harness";

const held: { scene: Scene | null; api: BodyApi<Jolt.Shape> | null } = {
  scene: null,
  api: null,
};

const CaptureScene = () => {
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    held.scene = scene;
    return () => {
      held.scene = null;
    };
  }, [scene]);

  return null;
};

/** Assigning `held.api = null` inline would narrow it to `null` for the rest of
 * the test; going through a call leaves the type alone. */
const forgetCaptures = () => {
  held.api = null;
};

const capturedApi = () => {
  if (!held.api) throw new Error("the compound never provided an api");
  return held.api;
};

const debugMeshes = () => {
  if (!held.scene) throw new Error("scene was never captured");
  return held.scene.children.filter(
    (child): child is Mesh => child instanceof Mesh,
  );
};

const Compound = ({ shapes }: { shapes: CompoundChild[] }) => {
  const [, api] = useCompound({
    shapes,
    position: [0, 4, 0],
    motionType: "dynamic",
    mass: 4,
  });

  useEffect(() => {
    held.api = (api as BodyApi<Jolt.Shape>) ?? null;
  }, [api]);

  return null;
};

const DebugBox = ({ convexRadius }: { convexRadius?: number }) => {
  const [, api] = useBox({
    size: [1, 1, 1],
    convexRadius,
    position: [0, 4, 0],
    motionType: "dynamic",
    debug: true,
  });

  useEffect(() => {
    held.api = (api as BodyApi<Jolt.Shape>) ?? null;
  }, [api]);

  return null;
};

describe("compound child validation", () => {
  /**
   * A negative radius passes a "is it present" check but Jolt rejects the shape
   * it produces, and the failure takes the whole compound with it — the child is
   * dropped before it can get that far.
   */
  it("skips a child whose dimension is not a positive number", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    forgetCaptures();

    const renderer = await renderPhysics(
      <Compound
        shapes={[
          { type: "box", position: [0, 0, 0], size: [1, 1, 1] },
          { type: "sphere", position: [0, 0.9, 0], radius: -1 },
          { type: "sphere", position: [0, -0.9, 0], radius: 0 },
        ]}
      />,
    );

    await step(renderer, 2);

    expect(held.api).not.toBeNull();
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls[0][0]).toContain("skipping child 1");
    expect(error.mock.calls[0][0]).toContain("must be a positive number");
    expect(error.mock.calls[1][0]).toContain("skipping child 2");

    await unmount(renderer);
    expectNoAsserts();
    error.mockRestore();
  });

  it("still builds the children that are valid", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    forgetCaptures();

    const renderer = await renderPhysics(
      <Compound
        shapes={[
          { type: "box", position: [0, 0, 0], size: [1, 1, 1] },
          { type: "box", position: [0, 1.2, 0], size: [1, 1, 1] },
          { type: "sphere", position: [0, 0.9, 0], radius: -1 },
        ]}
      />,
    );

    await step(renderer, 2);

    // Two unit boxes, and nothing from the child that was dropped.
    expect(capturedApi().shape.GetVolume()).toBeCloseTo(2, 1);

    await unmount(renderer);
    expectNoAsserts();
    error.mockRestore();
  });
});

describe("box debug geometry", () => {
  type Geometry = Mesh["geometry"];

  const extent = (geometry: Geometry) => {
    const position = geometry.attributes.position;
    let max = 0;

    for (let i = 0; i < position.count; i += 1) {
      max = Math.max(
        max,
        Math.abs(position.getX(i)),
        Math.abs(position.getY(i)),
        Math.abs(position.getZ(i)),
      );
    }

    return max;
  };

  /** A vertex at the limit on all three axes at once — only a sharp box has one. */
  const sharpCorners = (geometry: Geometry) => {
    const position = geometry.attributes.position;
    let count = 0;

    for (let i = 0; i < position.count; i += 1) {
      if (
        Math.abs(position.getX(i)) > 0.49 &&
        Math.abs(position.getY(i)) > 0.49 &&
        Math.abs(position.getZ(i)) > 0.49
      ) {
        count += 1;
      }
    }

    return count;
  };

  /**
   * The rounding is a Minkowski sum, so the collider still reaches the full half
   * extent at the middle of each face — it is the corners that are pulled in.
   */
  it("rounds the corners without changing the extents", () => {
    const geometry = roundedBoxGeometry([1, 1, 1], 0.4);

    expect(extent(geometry)).toBeCloseTo(0.5, 5);
    expect(sharpCorners(geometry)).toBe(0);
  });

  it("leaves a box with no convex radius sharp", () => {
    expect(sharpCorners(roundedBoxGeometry([1, 1, 1], 0))).toBeGreaterThan(0);
  });

  it("draws the rounded collider while the render geometry stays a box", async () => {
    const renderer = await renderPhysics(
      <>
        <CaptureScene />
        <DebugBox convexRadius={0.4} />
      </>,
    );

    const [debugMesh] = debugMeshes();

    expect(debugMesh).toBeDefined();
    // Same outer extents as the box it is drawn for, but no sharp corner left.
    expect(extent(debugMesh.geometry)).toBeCloseTo(0.5, 5);
    expect(sharpCorners(debugMesh.geometry)).toBe(0);
    expect(sharpCorners(capturedApi().geometry)).toBeGreaterThan(0);

    await unmount(renderer);
    expectNoAsserts();
  });
});
