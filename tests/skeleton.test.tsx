import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
  type Object3D,
} from "three";
import {
  createSkeletonRig,
  isPhysicalBone,
  type SkeletonRig,
} from "@/Jolt/internal/skeleton";
import type { JoltModule } from "@/Jolt/types";
import {
  expectNoAsserts,
  getApi,
  renderPhysics,
  unmount,
  type PhysicsRenderer,
} from "./harness";
import { loadMannequin, playAt } from "./mannequin";

const RAGDOLL_BONES = [
  "pelvis",
  "spine_01",
  "spine_03",
  "Head",
  "upperarm_l",
  "lowerarm_l",
  "hand_l",
  "upperarm_r",
  "lowerarm_r",
  "hand_r",
  "thigh_l",
  "calf_l",
  "foot_l",
  "thigh_r",
  "calf_r",
  "foot_r",
];

let renderer: PhysicsRenderer;
let jolt: JoltModule;

beforeAll(async () => {
  renderer = await renderPhysics(null);
  jolt = getApi().Jolt;
});

afterAll(async () => {
  await unmount(renderer);
});

const freeMemory = () => jolt.JoltInterface.prototype.sGetFreeMemory();

const skinnedMesh = (bones: Bone[]) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0], 3));
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute([0, 0, 0, 0], 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute([1, 0, 0, 0], 4));

  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  mesh.bind(new Skeleton(bones));
  return mesh;
};

const bone = (name: string, parent: Object3D | null, position: number[]) => {
  const created = new Bone();
  created.name = name;
  created.position.fromArray(position);
  parent?.add(created);
  return created;
};

/**
 * Hips → spine → chest → head and arm, plus a leg, under a scaled and turned
 * armature the way a Z-up export arrives. Handed to the skeleton deepest first.
 */
const syntheticRig = (armatureScale = 1) => {
  const armature = new Group();
  armature.scale.setScalar(armatureScale);
  armature.rotation.set(-Math.PI / 2, 0, 0.3);
  armature.position.set(2, 0, -1);

  const hips = bone("hips", armature, [0, 0, 90]);
  const spine = bone("spine", hips, [0, 12, 0]);
  const chest = bone("chest", spine, [0, 14, 0]);
  const head = bone("head", chest, [0, 25, 0]);
  const arm = bone("arm", chest, [15, 20, 0]);
  const forearm = bone("forearm", arm, [0, 27, 0]);
  const leg = bone("leg", hips, [9, -3, 0]);

  const mesh = skinnedMesh([forearm, head, arm, leg, chest, spine, hips]);
  armature.add(mesh);
  armature.updateMatrixWorld(true);

  return { armature, mesh, bones: [hips, spine, chest, head, arm, forearm, leg] };
};

const randomTurn = (target: Bone, seed: number) => {
  target.quaternion
    .setFromAxisAngle(
      new Vector3(Math.sin(seed), Math.cos(seed * 1.7), 0.4).normalize(),
      0.3 + (seed % 1.1),
    )
    .multiply(target.quaternion);
};

const snapshot = (bones: readonly Bone[]) =>
  bones.map((each) => ({
    position: each.position.clone(),
    quaternion: each.quaternion.clone(),
    world: each.matrixWorld.clone(),
  }));

const expectQuaternion = (actual: Quaternion, expected: Quaternion) => {
  expect(Math.abs(actual.dot(expected))).toBeCloseTo(1, 5);
};

const expectMatrix = (actual: Matrix4, expected: Matrix4, digits = 4) => {
  actual.elements.forEach((value, index) => {
    expect(value).toBeCloseTo(expected.elements[index], digits);
  });
};

const withRig = (
  mesh: SkinnedMesh,
  keep: ((candidate: Bone) => boolean) | undefined,
  run: (rig: SkeletonRig) => void,
) => {
  const rig = createSkeletonRig(jolt, mesh, keep);
  try {
    run(rig);
  } finally {
    rig.dispose();
  }
};

describe("skeleton bridge", () => {
  it("orders joints parent first whatever order the bones arrive in", () => {
    const { mesh } = syntheticRig();

    withRig(mesh, undefined, (rig) => {
      expect(rig.skeleton.AreJointsCorrectlyOrdered()).toBe(true);
      expect(rig.skeleton.GetJointCount()).toBe(7);

      rig.parents.forEach((parent, index) => {
        expect(parent).toBeLessThan(index);
        const expected = rig.bones[index].parent;
        expect(parent === -1 ? null : rig.bones[parent]).toBe(
          expected instanceof Bone ? expected : null,
        );
      });

      expect(rig.names[rig.indexOf.get("forearm")!]).toBe("forearm");
    });

    expectNoAsserts();
  });

  it("round-trips a pose back onto the bones", () => {
    for (const armatureScale of [1, 0.01]) {
      const { mesh, bones } = syntheticRig(armatureScale);
      bones.forEach(randomTurn);

      withRig(mesh, undefined, (rig) => {
        rig.readBones();
        const posed = snapshot(rig.bones);

        rig.bones.forEach((each, index) => {
          each.position.multiplyScalar(1.3);
          randomTurn(each, index + 4);
        });

        rig.writeBones();

        rig.bones.forEach((each, index) => {
          expect(each.position.distanceTo(posed[index].position)).toBeLessThan(
            1e-3,
          );
          expectQuaternion(each.quaternion, posed[index].quaternion);
          expectMatrix(each.matrixWorld, posed[index].world);
        });
      });
    }

    expectNoAsserts();
  });

  it("derives joint states that match the bones' local transforms", () => {
    const { mesh, armature, bones } = syntheticRig();
    armature.rotation.set(0, 0, 0);
    armature.position.set(0, 0, 0);
    bones.forEach(randomTurn);

    withRig(mesh, undefined, (rig) => {
      rig.readBones();

      rig.bones.forEach((each, index) => {
        if (rig.parents[index] === -1) return;

        const state = rig.pose.GetJoint(index);
        const translation = state.mTranslation;
        const rotation = state.mRotation;

        expect(translation.GetX()).toBeCloseTo(each.position.x, 3);
        expect(translation.GetY()).toBeCloseTo(each.position.y, 3);
        expect(translation.GetZ()).toBeCloseTo(each.position.z, 3);
        expectQuaternion(
          new Quaternion(
            rotation.GetX(),
            rotation.GetY(),
            rotation.GetZ(),
            rotation.GetW(),
          ),
          each.quaternion,
        );
      });
    });

    expectNoAsserts();
  });

  it("reads the bind pose wherever the mesh has moved to", async () => {
    const { scene, mesh, animations } = await loadMannequin();

    withRig(mesh, undefined, (rig) => {
      scene.position.set(3, 1, -2);
      scene.rotation.y = 1.2;
      mesh.skeleton.pose();
      scene.updateMatrixWorld(true);

      rig.readBones();
      const atRest = Float32Array.from(rig.matrices());

      playAt(scene, animations, "Walk_Loop", 0.5);
      rig.readBindPose();

      rig.matrices().forEach((value, index) => {
        expect(value).toBeCloseTo(atRest[index], 4);
      });
    });

    expectNoAsserts();
  });

  it("round-trips the mannequin's animated pose", async () => {
    const { scene, mesh, animations } = await loadMannequin();

    withRig(mesh, undefined, (rig) => {
      expect(rig.bones).toHaveLength(65);

      for (const [name, time] of [
        ["Walk_Loop", 0.4],
        ["Death01", 1.9],
        ["Swim_Fwd_Loop", 0.7],
      ] as const) {
        playAt(scene, animations, name, time);
        rig.readBones();
        const posed = snapshot(rig.bones);

        mesh.skeleton.pose();
        rig.writeBones();

        rig.bones.forEach((each, index) => {
          expect(each.position.distanceTo(posed[index].position)).toBeLessThan(
            1e-4,
          );
          expectQuaternion(each.quaternion, posed[index].quaternion);
        });
      }
    });

    expectNoAsserts();
  });

  it("maps a 16-bone ragdoll onto the 65-bone rig and back", async () => {
    const { scene, mesh, animations } = await loadMannequin();
    const keep = (candidate: Bone) => RAGDOLL_BONES.includes(candidate.name);

    withRig(mesh, keep, (ragdoll) => {
      expect(ragdoll.bones).toHaveLength(RAGDOLL_BONES.length);
      expect(ragdoll.names[ragdoll.parents[ragdoll.indexOf.get("upperarm_l")!]]).toBe(
        "spine_03",
      );
      expect(ragdoll.names[ragdoll.parents[ragdoll.indexOf.get("Head")!]]).toBe(
        "spine_03",
      );

      playAt(scene, animations, "Hit_Chest", 0.2);
      ragdoll.readBones();
      const struck = snapshot(ragdoll.bones);

      playAt(scene, animations, "Idle_Loop", 1.1);
      scene.updateMatrixWorld(true);
      const fingers = mesh.skeleton.bones.filter(
        (candidate) => !keep(candidate),
      );
      const idle = snapshot(fingers);

      ragdoll.writeBones();
      scene.updateMatrixWorld(true);

      ragdoll.bones.forEach((each, index) => {
        expectMatrix(each.matrixWorld, struck[index].world);
      });

      fingers.forEach((each, index) => {
        expect(each.position.distanceTo(idle[index].position)).toBe(0);
        expect(each.quaternion.equals(idle[index].quaternion)).toBe(true);
      });
    });

    expectNoAsserts();
  });

  it("leaves twist, finger and helper bones out by default", async () => {
    const { mesh } = await loadMannequin();

    withRig(mesh, (candidate) => isPhysicalBone(candidate), (rig) => {
      expect(rig.names).toEqual([
        "pelvis",
        "spine_01",
        "thigh_l",
        "thigh_r",
        "spine_02",
        "calf_l",
        "calf_r",
        "spine_03",
        "foot_l",
        "foot_r",
        "neck_01",
        "upperarm_l",
        "upperarm_r",
        "Head",
        "lowerarm_l",
        "lowerarm_r",
        "hand_l",
        "hand_r",
      ]);
    });

    expectNoAsserts();
  });

  it("rejects repeated bone names", () => {
    const { mesh, bones } = syntheticRig();
    bones[4].name = "spine";

    expect(() => createSkeletonRig(jolt, mesh)).toThrow(/unique/);
    expectNoAsserts();
  });

  it("warns once about a non-uniform bone scale", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { mesh, bones } = syntheticRig();
    bones[1].scale.set(1, 2, 1);

    withRig(mesh, undefined, (rig) => {
      rig.readBones();
      rig.readBones();
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('"spine"');
    warn.mockRestore();
    expectNoAsserts();
  });

  it("reads and writes every frame without allocating", async () => {
    const { scene, mesh, animations } = await loadMannequin();
    const mixer = playAt(scene, animations, "Sprint_Loop", 0);
    const baseline = freeMemory();

    withRig(mesh, undefined, (rig) => {
      const view = rig.matrices();
      const steady = freeMemory();

      for (let frame = 0; frame < 200; frame += 1) {
        mixer.update(1 / 60);
        rig.readBones();
        rig.writeBones();
      }

      expect(freeMemory()).toBe(steady);
      expect(rig.matrices()).toBe(view);
    });

    expect(freeMemory()).toBe(baseline);
    expectNoAsserts();
  });
});
