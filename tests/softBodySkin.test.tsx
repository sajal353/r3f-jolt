import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import {
  Bone,
  BufferAttribute,
  Group,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Skeleton,
  SkinnedMesh,
  Vector3,
  type BufferGeometry,
  type Mesh,
} from "three";
import { useSoftBody, type SoftBodyApi, type UseSoftBodyOptions } from "@/Jolt/useSoftBody";
import { bindSkin } from "@/Jolt/internal/softBodySkin";
import { weldGeometry } from "@/Jolt/internal/softBodyBuild";
import {
  expectNoAsserts,
  renderPhysics,
  step,
  unmount,
  updatePhysics,
} from "./harness";
import { loadMannequin, playAt } from "./mannequin";

const held: { soft?: SoftBodyApi; mesh?: Mesh | null } = {};

const Soft = ({
  geometry,
  ...options
}: UseSoftBodyOptions & { geometry: BufferGeometry }) => {
  const [ref, api] = useSoftBody(geometry, options);

  useEffect(() => {
    held.soft = api;
    held.mesh = ref.current;
  }, [api, ref]);

  return <mesh ref={ref} geometry={api?.geometry} />;
};

const soft = () => {
  if (!held.soft) throw new Error("soft body was never created");
  return held.soft;
};

const rendered = (index: number) => {
  const position = soft().geometry.getAttribute("position") as BufferAttribute;
  return new Vector3()
    .fromBufferAttribute(position, index)
    .add(held.mesh?.position ?? new Vector3());
};

const bone = (name: string, parent: Group | Bone, position: number[]) => {
  const created = new Bone();
  created.name = name;
  created.position.fromArray(position);
  parent.add(created);
  return created;
};

/**
 * A chest and an arm under a turned, doubled armature, skinning `geometry`:
 * each vertex is shared between the two by how far right it sits, so every
 * one blends two bones. Three.js's own `applyBoneTransform` is the answer key.
 */
const rig = (geometry: BufferGeometry, weighted = true) => {
  const armature = new Group();
  armature.scale.setScalar(2);
  armature.rotation.set(0, 0.4, 0);
  armature.position.set(1, 0, -1);

  const chest = bone("chest", armature, [0, 1, 0]);
  const arm = bone("arm", chest, [0.5, 0, 0]);

  if (weighted) {
    const position = geometry.getAttribute("position");
    const indices = new Uint16Array(position.count * 4);
    const weights = new Float32Array(position.count * 4);
    for (let index = 0; index < position.count; index += 1) {
      const right = Math.min(1, Math.max(0, position.getX(index) + 0.5));
      indices[index * 4] = 0;
      indices[index * 4 + 1] = 1;
      weights[index * 4] = 1 - right;
      weights[index * 4 + 1] = right;
    }
    geometry.setAttribute("skinIndex", new BufferAttribute(indices, 4));
    geometry.setAttribute("skinWeight", new BufferAttribute(weights, 4));
  }

  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  armature.add(mesh);
  armature.updateMatrixWorld(true);
  mesh.bind(new Skeleton([chest, arm]));

  const point = new Vector3();
  const chestSkin = new Matrix4();

  /** Where three.js draws geometry vertex `index` with the bones as they stand. */
  const skinOf = (index: number) => {
    armature.updateMatrixWorld(true);
    point.fromBufferAttribute(geometry.getAttribute("position"), index);
    if (!weighted) {
      chestSkin
        .multiplyMatrices(chest.matrixWorld, mesh.skeleton.boneInverses[0])
        .multiply(mesh.bindMatrix);
      return point.applyMatrix4(chestSkin).clone();
    }
    return mesh.applyBoneTransform(index, point).applyMatrix4(mesh.matrixWorld).clone();
  };

  return { armature, chest, arm, mesh, skinOf };
};

/** A 1 m sheet hanging in the mesh's XY plane, its top edge at y = 1. */
const hanging = (segments = 6) => {
  const geometry = new PlaneGeometry(1, 1, segments, segments);
  geometry.translate(0, 0.5, 0.2);
  return geometry;
};

/** A 1 m sheet held out flat at y = 1 from its back edge. */
const flat = (segments = 6) => {
  const geometry = new PlaneGeometry(1, 1, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 1, 0.5);
  return geometry;
};

const topRow = (point: Vector3) => point.y > 0.99;

const indicesWhere = (geometry: BufferGeometry, test: (point: Vector3) => boolean) => {
  const position = geometry.getAttribute("position");
  const point = new Vector3();
  const result: number[] = [];
  for (let index = 0; index < position.count; index += 1) {
    if (test(point.fromBufferAttribute(position, index))) result.push(index);
  }
  return result;
};

const allFinite = () => {
  const position = soft().geometry.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    if (!Number.isFinite(soft().getVertex(index).x)) return false;
  }
  return true;
};

describe("useSoftBody skin", () => {
  it("holds pinned vertices to the skin as the bones move and turn", async () => {
    const geometry = hanging();
    const { armature, chest, arm, mesh, skinOf } = rig(geometry);
    const pinned = indicesWhere(geometry, topRow);
    const renderer = await renderPhysics(
      <Soft geometry={geometry} skin={{ mesh }} pinned={topRow} />,
    );

    let worst = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      armature.rotation.y += 0.03;
      armature.position.x += 0.02;
      chest.rotation.z = Math.sin(frame / 10) * 0.4;
      arm.rotation.x = Math.cos(frame / 7) * 0.6;
      await step(renderer, 1);

      for (const index of pinned) {
        worst = Math.max(worst, soft().getVertex(index).distanceTo(skinOf(index)));
      }
    }

    expect(worst).toBeLessThan(1e-4);
    expect(allFinite()).toBe(true);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("holds a vertex with maxDistance 0 exactly, without pinning it", async () => {
    const geometry = hanging();
    const { armature, mesh, skinOf } = rig(geometry);
    const held = indicesWhere(geometry, topRow);
    const renderer = await renderPhysics(
      <Soft
        geometry={geometry}
        skin={{ mesh, maxDistance: (point) => (topRow(point) ? 0 : 1) }}
      />,
    );

    let worst = 0;
    for (let frame = 0; frame < 30; frame += 1) {
      armature.position.x += 0.05;
      await step(renderer, 1);
      for (const index of held) {
        worst = Math.max(worst, soft().getVertex(index).distanceTo(skinOf(index)));
        expect(soft().isPinned(index)).toBe(true);
      }
    }

    expect(worst).toBeLessThan(1e-4);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("draws the held row on the bones as they are now, between steps", async () => {
    const geometry = hanging();
    const { armature, chest, mesh, skinOf } = rig(geometry);
    const pinned = indicesWhere(geometry, topRow);
    const renderer = await renderPhysics(
      <Soft geometry={geometry} skin={{ mesh }} pinned={topRow} />,
      { timeStep: 1 / 60 },
    );
    await step(renderer, 10);

    for (let frame = 0; frame < 12; frame += 1) {
      armature.position.x += 0.1;
      chest.rotation.z += 0.05;
      // Half a step: no step runs on some of these, and the rest are blended.
      await step(renderer, 1, 1 / 120);

      for (const index of pinned) {
        expect(rendered(index).distanceTo(skinOf(index))).toBeLessThan(1e-4);
      }
    }

    await unmount(renderer);
    expectNoAsserts();
  });

  it("keeps free vertices within maxDistance, scaled live, and lets go when off", async () => {
    const geometry = flat();
    const { mesh, skinOf } = rig(geometry);
    const back = (point: Vector3) => point.z < 0.01;
    const free = indicesWhere(geometry, (point) => !back(point));
    const options = { geometry, skin: { mesh, maxDistance: 0.05 }, pinned: back };

    const farthest = () =>
      Math.max(...free.map((index) => soft().getVertex(index).distanceTo(skinOf(index))));

    const renderer = await renderPhysics(<Soft {...options} />);
    await step(renderer, 90);
    expect(farthest()).toBeLessThan(0.05 + 1e-3);
    expect(farthest()).toBeGreaterThan(0.04);

    await updatePhysics(renderer, <Soft {...options} skinnedMaxDistanceMultiplier={0.5} />);
    await step(renderer, 60);
    expect(farthest()).toBeLessThan(0.025 + 1e-3);

    await updatePhysics(
      renderer,
      <Soft {...options} skinnedMaxDistanceMultiplier={0.5} skinConstraints={false} />,
    );
    await step(renderer, 60);
    expect(farthest()).toBeGreaterThan(0.2);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("sleeps while the bones are still and wakes when they move", async () => {
    const geometry = hanging(4);
    const { chest, mesh, skinOf } = rig(geometry);
    const pinned = indicesWhere(geometry, topRow);
    const renderer = await renderPhysics(
      <Soft geometry={geometry} skin={{ mesh, maxDistance: 0.05 }} pinned={topRow} />,
    );

    for (let frame = 0; frame < 900 && !soft().isSleeping(); frame += 1) {
      await step(renderer, 1);
    }
    expect(soft().isSleeping()).toBe(true);

    const position = soft().geometry.getAttribute("position") as BufferAttribute;
    const version = position.version;
    await step(renderer, 30);
    expect(position.version).toBe(version);

    chest.position.x += 0.3;
    await step(renderer, 2);
    expect(soft().isSleeping()).toBe(false);
    for (const index of pinned) {
      expect(soft().getVertex(index).distanceTo(skinOf(index))).toBeLessThan(1e-4);
    }

    await unmount(renderer);
    expectNoAsserts();
  });

  it("snaps every vertex back onto a single bone's skin", async () => {
    const geometry = hanging();
    const { mesh, skinOf } = rig(geometry, false);
    const renderer = await renderPhysics(
      <Soft geometry={geometry} skin={{ mesh, bone: "chest" }} pinned={topRow} />,
    );
    await step(renderer, 30);

    const count = geometry.getAttribute("position").count;
    soft().setVertex(count - 1, [5, 5, 5]);
    soft().snapToSkin();
    await step(renderer, 1);

    // On the skin at the start of the step, then a step's fall under gravity.
    for (let index = 0; index < count; index += 1) {
      expect(soft().getVertex(index).distanceTo(skinOf(index))).toBeLessThan(2e-3);
      expect(rendered(index).distanceTo(skinOf(index))).toBeLessThan(2e-3);
    }

    await unmount(renderer);
    expectNoAsserts();
  });

  it("keeps a garment on the mannequin's spine through a sprint", async () => {
    const { scene, mesh, animations } = await loadMannequin();
    const spine = mesh.skeleton.bones.findIndex((each) => each.name === "spine_03");
    const geometry = new PlaneGeometry(0.4, 0.4, 4, 4);
    geometry.translate(0, 1.2, -0.2);
    const top = (point: Vector3) => point.y > 1.39;
    const pinned = indicesWhere(geometry, top);
    const mixer = playAt(scene, animations, "Sprint_Loop", 0);

    const skin = new Matrix4();
    const point = new Vector3();
    const skinOf = (index: number) => {
      scene.updateMatrixWorld(true);
      skin
        .multiplyMatrices(mesh.skeleton.bones[spine].matrixWorld, mesh.skeleton.boneInverses[spine])
        .multiply(mesh.bindMatrix);
      return point
        .fromBufferAttribute(geometry.getAttribute("position"), index)
        .applyMatrix4(skin)
        .clone();
    };

    const renderer = await renderPhysics(
      <Soft geometry={geometry} skin={{ mesh, bone: "spine_03" }} pinned={top} />,
    );

    let worst = 0;
    for (let frame = 0; frame < 90; frame += 1) {
      mixer.update(1 / 60);
      scene.position.z += 0.1;
      await step(renderer, 1);
      for (const index of pinned) {
        worst = Math.max(
          worst,
          soft().getVertex(index).distanceTo(skinOf(index)),
          rendered(index).distanceTo(skinOf(index)),
        );
      }
    }

    expect(worst).toBeLessThan(1e-3);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("names what is missing from a skin", () => {
    const geometry = hanging();
    const { mesh } = rig(geometry, false);
    const topology = weldGeometry(geometry, 1e-4);

    expect(() => bindSkin(geometry, topology, { mesh, bone: "tail" })).toThrow(
      'no bone "tail"',
    );
    expect(() => bindSkin(geometry, topology, { mesh })).toThrow("skinIndex/skinWeight");
  });
});
