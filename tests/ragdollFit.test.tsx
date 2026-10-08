import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { Mesh, type Object3D } from "three";
import {
  classifyBone,
  fitRagdoll,
  selectRagdollBones,
  type RagdollBoneConfig,
} from "@/Jolt/internal/ragdollFit";
import {
  useCharacterModel,
  type CharacterModel,
  type UseCharacterModelOptions,
} from "@/Jolt/useCharacterModel";
import { expectNoAsserts, renderPhysics, unmount, updatePhysics } from "./harness";
import { loadMannequin } from "./mannequin";

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

const boneNamed = (bones: RagdollBoneConfig[], name: string) =>
  bones.find((bone) => bone.name === name)!;

describe("ragdoll fit", () => {
  it("picks the 16 bones a humanoid ragdoll is built from", async () => {
    const { mesh } = await loadMannequin();
    const picked = selectRagdollBones(mesh.skeleton.bones).map((bone) => bone.name);

    expect([...picked].sort()).toEqual([...RAGDOLL_BONES].sort());
  });

  it("classifies UE and Mixamo bone names alike", () => {
    expect(classifyBone("mixamorig:Hips")).toBe("pelvis");
    expect(classifyBone("mixamorig:LeftForeArm")).toBe("forearm");
    expect(classifyBone("mixamorig:LeftArm")).toBe("upperarm");
    expect(classifyBone("mixamorig:RightUpLeg")).toBe("thigh");
    expect(classifyBone("mixamorig:RightLeg")).toBe("calf");
    expect(classifyBone("lowerarm_l")).toBe("forearm");
    expect(classifyBone("calf_r")).toBe("calf");
    expect(classifyBone("neck_01")).toBe("neck");
    expect(classifyBone("tail_03")).toBeNull();
  });

  it("spreads the mass by anthropometric share and fits limbs to the skin", async () => {
    const { meshes } = await loadMannequin();
    const { config, excluded } = fitRagdoll(meshes, { mass: 80 });
    const bones = config.bones;

    const total = bones.reduce((sum, bone) => sum + bone.mass, 0);
    expect(total).toBeCloseTo(80, 1);

    const mass = (name: string) => boneNamed(bones, name).mass;
    expect(mass("thigh_l")).toBeGreaterThan(mass("calf_l"));
    expect(mass("calf_l")).toBeGreaterThan(mass("foot_l"));
    expect(mass("upperarm_l")).toBeGreaterThan(mass("hand_l"));
    expect(mass("thigh_l")).toBeCloseTo(mass("thigh_r"), 3);

    const thigh = boneNamed(bones, "thigh_l").shape;
    expect(thigh.type).toBe("capsule");
    if (thigh.type === "capsule") {
      expect(thigh.radius).toBeGreaterThan(0.06);
      expect(thigh.radius).toBeLessThan(0.12);
      expect(thigh.height).toBeGreaterThan(0.15);
    }

    expect(boneNamed(bones, "spine_03").shape.type).toBe("box");
    expect(bones[0].name).toBe("pelvis");
    expect(bones[0].joint).toBeUndefined();
    expect(bones.slice(1).every((bone) => bone.joint)).toBe(true);
    expect(excluded).toContain("index_01_l");
    expect(excluded).toContain("neck_01");
    expect(excluded).toHaveLength(65 - 16);
  });

  it("makes knees and elbows hinge-like, bending one way", async () => {
    const { meshes } = await loadMannequin();
    const { config } = fitRagdoll(meshes);

    for (const name of ["calf_l", "lowerarm_r"]) {
      const joint = boneNamed(config.bones, name).joint!;
      expect(joint.bend).toBeGreaterThan(1);
      expect(joint.normalHalfConeAngle).toBeCloseTo(joint.bend, 5);
      expect(joint.planeHalfConeAngle).toBeLessThan(0.2);
    }

    expect(boneNamed(config.bones, "thigh_l").joint!.bend).toBe(0);
  });

  it("applies overrides and exclusions", async () => {
    const { meshes } = await loadMannequin();
    const { config, excluded } = fitRagdoll(meshes, {
      mass: 70,
      overrides: {
        Head: { mass: 10, joint: { twistMinAngle: -0.1, twistMaxAngle: 0.1 } },
        hand_l: { shape: "box" },
        foot_r: { shape: "convex" },
        hand_r: { exclude: true },
      },
    });

    const head = boneNamed(config.bones, "Head");
    expect(head.mass).toBe(10);
    expect(head.joint!.twistMaxAngle).toBe(0.1);
    expect(boneNamed(config.bones, "hand_l").shape.type).toBe("box");
    expect(boneNamed(config.bones, "foot_r").shape.type).toBe("convex");
    expect(config.bones.some((bone) => bone.name === "hand_r")).toBe(false);
    expect(excluded).toContain("hand_r");

    const total = config.bones.reduce((sum, bone) => sum + bone.mass, 0);
    expect(total).toBeCloseTo(70, 1);
  });

  it("takes an explicit bone list", async () => {
    const { meshes } = await loadMannequin();
    const { config } = fitRagdoll(meshes, {
      bones: ["pelvis", "spine_03", "Head", "thigh_l", "thigh_r"],
    });

    expect(config.bones.map((bone) => bone.name)).toEqual([
      "pelvis",
      "spine_03",
      "thigh_l",
      "thigh_r",
      "Head",
    ]);
  });
});

const held: { model: CharacterModel | undefined } = { model: undefined };

const Fitted = ({
  scene,
  options,
}: {
  scene: Object3D;
  options?: UseCharacterModelOptions;
}) => {
  const model = useCharacterModel(scene, options);

  useEffect(() => {
    held.model = model;
  }, [model]);

  return null;
};

const overlays = (scene: Object3D) => {
  let count = 0;
  scene.traverse((node) => {
    if (node instanceof Mesh && node.parent?.type === "Bone") count += 1;
  });
  return count;
};

describe("useCharacterModel", () => {
  it("round-trips its config through JSON", async () => {
    const { scene } = await loadMannequin();
    const renderer = await renderPhysics(<Fitted scene={scene} />);
    const saved = JSON.parse(JSON.stringify(held.model!.toJSON()));
    await unmount(renderer);

    const { scene: fresh } = await loadMannequin();
    const again = await renderPhysics(
      <Fitted scene={fresh} options={{ config: saved }} />,
    );
    expect(held.model!.config).toEqual(saved);
    expect(held.model!.excluded).toHaveLength(65 - 16);

    await unmount(again);
    expectNoAsserts();
  });

  it("draws the fit on the bones with debug, and follows <Physics debug>", async () => {
    const { scene } = await loadMannequin();
    const renderer = await renderPhysics(
      <Fitted scene={scene} options={{ debug: true }} />,
    );
    expect(overlays(scene)).toBe(16);
    await unmount(renderer);
    expect(overlays(scene)).toBe(0);

    const live = await renderPhysics(<Fitted scene={scene} />);
    expect(overlays(scene)).toBe(0);
    await updatePhysics(live, <Fitted scene={scene} />, { debug: true });
    expect(overlays(scene)).toBe(16);
    await updatePhysics(live, <Fitted scene={scene} />, { debug: false });
    expect(overlays(scene)).toBe(0);

    await unmount(live);
    expectNoAsserts();
  });
});
