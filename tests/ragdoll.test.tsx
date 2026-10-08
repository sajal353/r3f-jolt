import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { Quaternion, Vector3, type AnimationMixer, type Object3D } from "three";
import { useBox } from "@/Jolt/useBox";
import { useCharacterModel } from "@/Jolt/useCharacterModel";
import {
  useRagdoll,
  type RagdollApi,
  type UseRagdollOptions,
} from "@/Jolt/useRagdoll";
import {
  expectNoAsserts,
  getApi,
  renderPhysics,
  step,
  unmount,
} from "./harness";
import { loadMannequin, playAt } from "./mannequin";

const held: { ragdoll: RagdollApi | undefined } = { ragdoll: undefined };

const Floor = () => {
  useBox({ size: [40, 1, 40], position: [0, -0.5, 0], motionType: "static" });
  return null;
};

const Mannequin = ({
  scene,
  options,
}: {
  scene: Object3D;
  options?: UseRagdollOptions;
}) => {
  const model = useCharacterModel(scene);
  const [ragdoll] = useRagdoll(model, options);

  useEffect(() => {
    held.ragdoll = ragdoll;
  }, [ragdoll]);

  return null;
};

const ragdoll = () => held.ragdoll!;

const bodyPosition = (bone: string) => {
  const id = ragdoll().bodyOf(bone)!;
  const at = getApi().bodyInterface.GetPosition(id);
  return new Vector3(at.GetX(), at.GetY(), at.GetZ());
};

const bodyRotation = (bone: string) => {
  const id = ragdoll().bodyOf(bone)!;
  const facing = getApi().bodyInterface.GetRotation(id);
  return new Quaternion(facing.GetX(), facing.GetY(), facing.GetZ(), facing.GetW());
};

const boneWorld = (scene: Object3D, bone: string) => {
  const node = scene.getObjectByName(bone)!;
  node.updateWorldMatrix(true, false);
  return new Vector3().setFromMatrixPosition(node.matrixWorld);
};

/** Holds the mixer at one frame of `name`, so the target stays put. */
const frozen = (mixer: AnimationMixer) => {
  mixer.timeScale = 0;
  return mixer;
};

const mount = async (
  scene: Object3D,
  options?: UseRagdollOptions,
  gravity: [number, number, number] = [0, -9.81, 0],
) => {
  held.ragdoll = undefined;
  const renderer = await renderPhysics(
    <>
      <Floor />
      <Mannequin scene={scene} options={options} />
    </>,
    { gravity },
  );
  await step(renderer, 1);
  return renderer;
};

describe("useRagdoll", () => {
  it("builds one body per fitted bone and a joint for every one but the root", async () => {
    const { scene } = await loadMannequin();
    const renderer = await mount(scene);

    expect(ragdoll().bones).toHaveLength(16);
    expect(ragdoll().bodies).toHaveLength(16);
    expect(ragdoll().constraints).toHaveLength(15);
    expect(getApi().constraints.size()).toBe(15);

    await unmount(renderer);
    expect(getApi().constraints.size()).toBe(0);
    expectNoAsserts();
  });

  it("returns the world's body count to baseline on unmount", async () => {
    const { scene } = await loadMannequin();
    const renderer = await renderPhysics(<Floor />);
    const baseline = getApi().physicsSystem.GetNumBodies();
    await unmount(renderer);

    const again = await mount(scene);
    expect(getApi().physicsSystem.GetNumBodies()).toBe(baseline + 16);
    const system = getApi().physicsSystem;
    await unmount(again);

    expect(system.GetNumBodies()).toBe(0);
    expectNoAsserts();
  });

  it("starts at rest: neighbouring bodies do not push each other apart", async () => {
    const { scene } = await loadMannequin();
    const renderer = await mount(scene, {}, [0, 0, 0]);
    const before = ragdoll().bones.map(bodyPosition);

    // A straight knee rests on its own limit, and the solver settles it once.
    await step(renderer, 60);
    const settled = ragdoll().bones.map(bodyPosition);
    settled.forEach((position, index) => {
      expect(position.distanceTo(before[index])).toBeLessThan(2e-3);
    });

    await step(renderer, 240);
    ragdoll().bones.forEach((bone, index) => {
      expect(bodyPosition(bone).distanceTo(settled[index])).toBeLessThan(1e-4);
    });

    await unmount(renderer);
    expectNoAsserts();
  });

  it("passive: falls, lands on the floor and poses the bones", async () => {
    const { scene } = await loadMannequin();
    scene.position.y = 1;
    const renderer = await mount(scene, { mode: "passive" });

    await step(renderer, 240);

    const lowest = ragdoll().bounds().min.y;
    expect(lowest).toBeGreaterThan(-0.05);
    expect(lowest).toBeLessThan(0.1);
    expect(boneWorld(scene, "Head").y).toBeLessThan(0.6);
    expect(
      boneWorld(scene, "Head").distanceTo(bodyPosition("Head")),
    ).toBeLessThan(0.02);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("hardKeying: every body sits on its animated bone", async () => {
    const { scene, animations } = await loadMannequin();
    const mixer = frozen(playAt(scene, animations, "Walk_Loop", 0.3));
    const renderer = await mount(scene, { mode: "hardKeying", mixer });

    await step(renderer, 30);

    for (const bone of ragdoll().bones) {
      expect(bodyPosition(bone).distanceTo(boneWorld(scene, bone))).toBeLessThan(
        1e-3,
      );
    }

    scene.position.x = 2;
    await step(renderer, 5);
    expect(bodyPosition("pelvis").x).toBeCloseTo(boneWorld(scene, "pelvis").x, 3);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("softKeying: holds the animation, gives way to a shove and comes back", async () => {
    const { scene, animations } = await loadMannequin();
    scene.position.y = 1;
    const mixer = frozen(playAt(scene, animations, "Idle_Loop", 0.5));
    const animated = boneWorld(scene, "hand_l");
    const renderer = await mount(scene, { mode: "softKeying", mixer });
    await step(renderer, 60);

    expect(bodyPosition("hand_l").distanceTo(animated)).toBeLessThan(0.02);

    const steady = bodyPosition("hand_l");
    ragdoll().applyImpulse([0, 0, 10], "hand_l");
    await step(renderer, 4);
    expect(bodyPosition("hand_l").distanceTo(steady)).toBeGreaterThan(0.02);

    await step(renderer, 60);
    expect(bodyPosition("hand_l").distanceTo(animated)).toBeLessThan(0.02);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("motors: hold the pose against gravity where slack joints let it fall", async () => {
    const headDrift = async (motorTorque?: number) => {
      const { scene, animations } = await loadMannequin();
      const mixer = frozen(playAt(scene, animations, "Idle_Loop", 0.5));
      const renderer = await mount(scene, {
        mode: "motors",
        mixer,
        motorTorque,
        kinematicBones: ["pelvis"],
      });
      const start = bodyPosition("Head");
      await step(renderer, 120);
      const moved = bodyPosition("Head").distanceTo(start);
      await unmount(renderer);
      return moved;
    };

    expect(await headDrift()).toBeLessThan(0.07);
    expect(await headDrift(0)).toBeGreaterThan(0.2);
    expectNoAsserts();
  });

  it("partial: kinematic bones follow the animation while the rest hang limp", async () => {
    const { scene, animations } = await loadMannequin();
    const mixer = frozen(playAt(scene, animations, "A_TPose", 0));
    const chest = boneWorld(scene, "spine_03");
    const renderer = await mount(scene, {
      mode: "motors",
      mixer,
      motorTorque: 0,
      kinematicBones: ["pelvis", "spine_01", "spine_03", "Head"],
    });
    const handStart = bodyPosition("hand_l").y;

    await step(renderer, 120);

    expect(bodyPosition("spine_03").distanceTo(chest)).toBeLessThan(1e-3);
    expect(bodyPosition("hand_l").y).toBeLessThan(handStart - 0.3);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("switches modes at runtime on the same bodies", async () => {
    const { scene, animations } = await loadMannequin();
    scene.position.y = 1;
    const mixer = frozen(playAt(scene, animations, "Idle_Loop", 0.5));
    const renderer = await mount(scene, { mode: "hardKeying", mixer });
    const api = ragdoll();
    const ids = api.bodies.map((id) => id.GetIndexAndSequenceNumber());
    const { bodyInterface, Jolt: jolt } = getApi();
    const motion = () => bodyInterface.GetMotionType(api.bodyOf("thigh_l")!);

    expect(motion()).toBe(jolt.EMotionType_Kinematic);

    for (const mode of ["passive", "softKeying", "motors", "hardKeying"] as const) {
      api.setMode(mode);
      await step(renderer, 10);
      expect(api.mode).toBe(mode);
      expect(motion()).toBe(
        mode === "hardKeying" ? jolt.EMotionType_Kinematic : jolt.EMotionType_Dynamic,
      );
    }

    expect(ragdoll()).toBe(api);
    expect(api.bodies.map((id) => id.GetIndexAndSequenceNumber())).toEqual(ids);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("blendToAnimation gets up from the floor onto the animation", async () => {
    const { scene, animations } = await loadMannequin();
    const mixer = frozen(playAt(scene, animations, "Idle_Loop", 0.5));
    const renderer = await mount(scene, { mode: "passive", mixer });
    await step(renderer, 90);
    expect(bodyPosition("Head").y).toBeLessThan(0.6);

    ragdoll().blendToAnimation(0.5);
    await step(renderer, 20);
    expect(ragdoll().mode).toBe("passive");

    await step(renderer, 25);
    expect(ragdoll().mode).toBe("hardKeying");
    for (const bone of ragdoll().bones) {
      expect(bodyPosition(bone).distanceTo(boneWorld(scene, bone))).toBeLessThan(
        1e-3,
      );
    }

    await unmount(renderer);
    expectNoAsserts();
  });

  it("an api call between frames leaves the bones showing the bodies", async () => {
    const { scene, animations } = await loadMannequin();
    const mixer = playAt(scene, animations, "Walk_Loop", 0.3);
    const renderer = await mount(scene, { mode: "passive", mixer });
    await step(renderer, 60);

    const shown = ragdoll().rig.bones.map((bone) => bone.quaternion.clone());

    ragdoll().blendToAnimation(0.5);
    ragdoll().rig.bones.forEach((bone, index) => {
      expect(bone.quaternion.angleTo(shown[index])).toBeLessThan(1e-3);
    });

    ragdoll().setMode("softKeying");
    ragdoll().rig.bones.forEach((bone, index) => {
      expect(bone.quaternion.angleTo(shown[index])).toBeLessThan(1e-3);
    });

    await unmount(renderer);
    expectNoAsserts();
  });

  it("a mode set mid-get-up cancels the blend", async () => {
    const { scene, animations } = await loadMannequin();
    const mixer = frozen(playAt(scene, animations, "Idle_Loop", 0.5));
    const renderer = await mount(scene, { mode: "passive", mixer });
    await step(renderer, 60);
    const { bodyInterface, Jolt: jolt } = getApi();
    const motion = () => bodyInterface.GetMotionType(ragdoll().bodyOf("thigh_l")!);

    ragdoll().blendToAnimation(0.5);
    await step(renderer, 5);
    expect(motion()).toBe(jolt.EMotionType_Kinematic);

    ragdoll().setMode("passive");
    await step(renderer, 60);
    expect(ragdoll().mode).toBe("passive");
    expect(motion()).toBe(jolt.EMotionType_Dynamic);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("setPose teleports every body onto the bones", async () => {
    const { scene } = await loadMannequin();
    const renderer = await mount(scene, {}, [0, 0, 0]);

    scene.position.set(5, 2, -3);
    scene.rotation.y = 1;
    ragdoll().setPose();
    await step(renderer, 1);

    for (const bone of ragdoll().bones) {
      expect(bodyPosition(bone).distanceTo(boneWorld(scene, bone))).toBeLessThan(
        1e-3,
      );
    }

    await unmount(renderer);
    expectNoAsserts();
  });

  it("maps bones to bodies and back, as a hit reports them", async () => {
    const { scene } = await loadMannequin();
    const renderer = await mount(scene);
    const api = ragdoll();

    for (const bone of api.bones) {
      const id = api.bodyOf(bone)!;
      expect(api.boneOf(id)).toBe(bone);
      expect(api.boneOf(id.GetIndexAndSequenceNumber())).toBe(bone);
    }
    expect(api.bodyOf("index_01_l")).toBeUndefined();

    const box = api.bounds();
    expect(box.min.y).toBeLessThan(0.1);
    expect(box.max.y).toBeGreaterThan(1.7);

    const { position } = api.getRootTransform();
    expect(position.distanceTo(boneWorld(scene, "pelvis"))).toBeLessThan(1e-3);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("knees bend backward and elbows forward, and not the other way", async () => {
    const bendAfterPush = async (bone: string, push: [number, number, number]) => {
      const { scene } = await loadMannequin();
      const renderer = await mount(
        scene,
        {
          mode: "motors",
          motorTorque: 0,
          kinematicBones: [
            "pelvis",
            "spine_01",
            "spine_03",
            "Head",
            "thigh_l",
            "thigh_r",
            "upperarm_l",
            "upperarm_r",
          ],
        },
        [0, 0, 0],
      );
      const rest = bodyRotation(bone);
      ragdoll().applyImpulse(push, bone);
      await step(renderer, 120);
      const angle = rest.angleTo(bodyRotation(bone));
      await unmount(renderer);
      return angle;
    };

    const kneeBack = await bendAfterPush("calf_l", [0, 0, -5]);
    const kneeForward = await bendAfterPush("calf_l", [0, 0, 5]);
    const elbowForward = await bendAfterPush("lowerarm_l", [0, 0, 3]);
    const elbowBack = await bendAfterPush("lowerarm_l", [0, 0, -3]);

    expect(kneeBack).toBeGreaterThan(1);
    expect(kneeForward).toBeLessThan(0.3);
    expect(elbowForward).toBeGreaterThan(1);
    expect(elbowBack).toBeLessThan(0.3);
    expectNoAsserts();
  });
});
