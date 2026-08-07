import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { describe, expect, it } from "vitest";
import { LineSegments, Mesh, MeshBasicMaterial } from "three";
import type { Scene } from "three";
import { useBox } from "@/Jolt/useBox";
import { useHingeConstraint } from "@/Jolt/useHingeConstraint";
import { PhysicsDebug } from "@/Jolt/PhysicsDebug";
import { useJolt } from "@/Jolt/useJolt";
import { debugMotionColors } from "@/Jolt/internal/debugMaterial";
import {
  expectNoAsserts,
  getApi,
  loadDebugModule,
  renderPhysics,
  step,
  unmount,
  updatePhysics,
} from "./harness";

const held: { scene: Scene | null } = { scene: null };

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

const wireframes = () => {
  if (!held.scene) throw new Error("scene was never captured");
  return held.scene.children.filter(
    (child): child is Mesh => child instanceof Mesh,
  );
};

const wireframeMaterial = (mesh: Mesh) => {
  const material = Array.isArray(mesh.material)
    ? mesh.material[0]
    : mesh.material;

  if (!(material instanceof MeshBasicMaterial)) {
    throw new Error("debug wireframes should carry a MeshBasicMaterial");
  }

  return material;
};

const jointLines = () => {
  if (!held.scene) throw new Error("scene was never captured");
  return held.scene.children.filter(
    (child): child is LineSegments => child instanceof LineSegments,
  );
};

const drawnJointVertices = () => {
  const [lines] = jointLines();
  if (!lines) return 0;
  return lines.geometry.drawRange.count;
};

const Jointed = ({ joints }: { joints: number }) => {
  const [, anchor] = useBox({
    size: [0.4, 0.4, 0.4],
    position: [0, 6, 0],
    motionType: "static",
  });
  const [, arm] = useBox({
    size: [1, 1, 1],
    position: [1.5, 6, 0],
    motionType: "dynamic",
    mass: 5,
  });

  useHingeConstraint(joints > 0 ? anchor : undefined, arm, {
    point: [0, 6, 0],
    hingeAxis: [0, 0, 1],
    normalAxis: [1, 0, 0],
  });

  useHingeConstraint(joints > 1 ? anchor : undefined, arm, {
    point: [0, 6, 0],
    hingeAxis: [0, 1, 0],
    normalAxis: [1, 0, 0],
  });

  return null;
};

const Hooked = () => {
  useBox({ size: [1, 1, 1], position: [0, 5, 0], motionType: "dynamic" });
  return null;
};

/**
 * A body the library did not create — the case the per-hook `debug` flag cannot
 * see, and the reason `<PhysicsDebug />` exists.
 */
const Handmade = () => {
  const api = useJolt();

  useEffect(() => {
    const { Jolt: jolt, bodyInterface, layers } = api;

    const halfExtent = new jolt.Vec3(0.5, 0.5, 0.5);
    const shape = new jolt.BoxShape(halfExtent, 0.05, undefined);
    jolt.destroy(halfExtent);
    shape.AddRef();

    const position = new jolt.RVec3(4, 0, 0);
    const rotation = new jolt.Quat(0, 0, 0, 1);
    const settings = new jolt.BodyCreationSettings(
      shape,
      position,
      rotation,
      jolt.EMotionType_Static,
      layers.LAYER_NON_MOVING,
    );
    shape.Release();

    const body = bodyInterface.CreateBody(settings);
    jolt.destroy(settings);
    jolt.destroy(position);
    jolt.destroy(rotation);

    bodyInterface.AddBody(body.GetID(), jolt.EActivation_DontActivate);

    return () => {
      if (api.state.destroyed) return;
      bodyInterface.RemoveBody(body.GetID());
      bodyInterface.DestroyBody(body.GetID());
    };
  }, [api]);

  return null;
};

/**
 * Three bodies off **one** shape. Jolt shapes are refcounted and reusable, and
 * the geometry cache is keyed by shape pointer — three separately constructed
 * boxes of identical size are three shapes, and correctly get three geometries.
 */
const SharedShapeTrio = () => {
  const api = useJolt();

  useEffect(() => {
    const { Jolt: jolt, bodyInterface, layers } = api;

    const halfExtent = new jolt.Vec3(0.5, 0.5, 0.5);
    const shape = new jolt.BoxShape(halfExtent, 0.05, undefined);
    jolt.destroy(halfExtent);
    shape.AddRef();

    const rotation = new jolt.Quat(0, 0, 0, 1);
    const ids = [0, 2, 4].map((x) => {
      const position = new jolt.RVec3(x, 0, 0);
      const settings = new jolt.BodyCreationSettings(
        shape,
        position,
        rotation,
        jolt.EMotionType_Static,
        layers.LAYER_NON_MOVING,
      );
      const body = bodyInterface.CreateBody(settings);
      jolt.destroy(settings);
      jolt.destroy(position);
      bodyInterface.AddBody(body.GetID(), jolt.EActivation_DontActivate);
      return body.GetID();
    });

    jolt.destroy(rotation);
    shape.Release();

    return () => {
      if (api.state.destroyed) return;
      for (const id of ids) {
        bodyInterface.RemoveBody(id);
        bodyInterface.DestroyBody(id);
      }
    };
  }, [api]);

  return null;
};

describe("PhysicsDebug", () => {
  it("draws a body the library did not create", async () => {
    const renderer = await renderPhysics(
      <>
        <CaptureScene />
        <Handmade />
        <PhysicsDebug />
      </>,
    );

    await step(renderer, 2);

    expect(getApi().physicsSystem.GetNumBodies()).toBe(1);
    expect(wireframes()).toHaveLength(1);
    expect(wireframes()[0].position.x).toBeCloseTo(4, 5);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("colours by motion type", async () => {
    const renderer = await renderPhysics(
      <>
        <CaptureScene />
        <Hooked />
        <Handmade />
        <PhysicsDebug />
      </>,
    );

    await step(renderer, 2);

    const colors = wireframes().map((mesh) =>
      wireframeMaterial(mesh).color.getHexString(),
    );

    expect(colors).toHaveLength(2);
    expect(new Set(colors).size).toBe(2);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("honours a colour override", async () => {
    const renderer = await renderPhysics(
      <>
        <CaptureScene />
        <Handmade />
        <PhysicsDebug colors={{ static: "red" }} />
      </>,
    );

    await step(renderer, 2);

    expect(wireframeMaterial(wireframes()[0]).color.getHexString()).toBe(
      "ff0000",
    );
    expect(debugMotionColors.static).not.toBe("red");

    await unmount(renderer);
    expectNoAsserts();
  });

  it("shares one geometry between bodies with the same shape", async () => {
    const renderer = await renderPhysics(
      <>
        <CaptureScene />
        <SharedShapeTrio />
        <PhysicsDebug />
      </>,
    );

    await step(renderer, 2);

    const meshes = wireframes();
    expect(meshes).toHaveLength(3);
    expect(new Set(meshes.map((mesh) => mesh.geometry)).size).toBe(1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("drops the wireframe when its body goes away", async () => {
    const renderer = await renderPhysics(
      <>
        <CaptureScene />
        <Hooked />
        <PhysicsDebug />
      </>,
    );

    await step(renderer, 2);
    expect(wireframes()).toHaveLength(1);

    await updatePhysics(
      renderer,
      <>
        <CaptureScene />
        <PhysicsDebug />
      </>,
    );
    await step(renderer, 2);

    expect(wireframes()).toHaveLength(0);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("leaves the heap flat across mount cycles", async () => {
    const module = await loadDebugModule();

    const run = async () => {
      const renderer = await renderPhysics(
        <>
          <CaptureScene />
          <Hooked />
          <Handmade />
          <PhysicsDebug />
        </>,
      );
      await step(renderer, 10);
      await unmount(renderer);
    };

    await run();
    const baseline = module.JoltInterface.prototype.sGetFreeMemory();

    for (let i = 0; i < 3; i += 1) await run();

    expect(module.JoltInterface.prototype.sGetFreeMemory()).toBe(baseline);
    expectNoAsserts();
  });

  it("draws the joints the hooks created", async () => {
    const renderer = await renderPhysics(
      <>
        <CaptureScene />
        <Jointed joints={1} />
        <PhysicsDebug />
      </>,
    );

    await step(renderer, 2);

    // Three segments per joint: centre → anchor → anchor → centre.
    expect(drawnJointVertices()).toBe(6);

    await updatePhysics(
      renderer,
      <>
        <CaptureScene />
        <Jointed joints={2} />
        <PhysicsDebug />
      </>,
    );
    await step(renderer, 2);

    expect(drawnJointVertices()).toBe(12);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("draws nothing once a joint unmounts, and not at all when switched off", async () => {
    const renderer = await renderPhysics(
      <>
        <CaptureScene />
        <Jointed joints={1} />
        <PhysicsDebug />
      </>,
    );

    await step(renderer, 2);
    expect(drawnJointVertices()).toBe(6);

    await updatePhysics(
      renderer,
      <>
        <CaptureScene />
        <Jointed joints={0} />
        <PhysicsDebug />
      </>,
    );
    await step(renderer, 2);

    expect(drawnJointVertices()).toBe(0);

    await unmount(renderer);
    expectNoAsserts();

    const plain = await renderPhysics(
      <>
        <CaptureScene />
        <Jointed joints={1} />
        <PhysicsDebug constraints={false} />
      </>,
    );

    await step(plain, 2);
    expect(jointLines()).toHaveLength(0);

    await unmount(plain);
    expectNoAsserts();
  });
});