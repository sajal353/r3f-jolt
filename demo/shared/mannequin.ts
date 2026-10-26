import { useState } from "react";
import { useGLTF } from "@react-three/drei";
import { Mesh, Vector3 } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { useJolt } from "@/Jolt/useJolt";
import type { RagdollApi } from "@/Jolt/useRagdoll";
import type { Vec3Tuple } from "@/Jolt/types";
import {
  createAnimator,
  getUpStart,
  planGetUp,
  type GetUpPlan,
  type GetUpMove,
} from "./animation";

export const MANNEQUIN = "/models/mannequin/mannequin.glb";

/**
 * A copy of the mannequin with a skeleton of its own, playing `clip`. Each
 * ragdoll needs its own bones, which a plain `scene.clone()` would share.
 * Placed once, at creation, before any ragdoll is built from it.
 */
export const useMannequin = (
  position: Vec3Tuple,
  clip: string,
  rotation: Vec3Tuple = [0, 0, 0],
) => {
  const gltf = useGLTF(MANNEQUIN);
  const { bodyInterface } = useJolt();

  const [character] = useState(() => {
    const copy = cloneSkinned(gltf.scene);
    copy.position.set(...position);
    copy.rotation.set(...rotation);
    copy.traverse(function castShadows(node) {
      if (!(node instanceof Mesh)) return;
      node.castShadow = true;
      // The bones leave the bind-pose bounds as soon as a ragdoll moves them.
      node.frustumCulled = false;
    });
    copy.updateMatrixWorld(true);
    return copy;
  });

  const [animator] = useState(() =>
    createAnimator(character, gltf.animations, clip),
  );

  const [moveTo] = useState(() => (x: number, z: number) => {
    character.position.x = x;
    character.position.z = z;
    character.updateMatrixWorld(true);
  });

  /** Stands the character at `x, y, z` facing `yaw`, as a controller drives it. */
  const [place] = useState(() => (x: number, y: number, z: number, yaw: number) => {
    character.position.set(x, y, z);
    character.rotation.y = yaw;
  });

  /**
   * From lying limp to standing on `then`: picks the get-up for how the
   * ragdoll lies, stands the character where that get-up's first frame matches
   * it, blends the ragdoll in, and calls `onStood` once the clip is done.
   */
  const [getUp] = useState(
    () =>
      (ragdoll: RagdollApi, then: string, onStood?: () => void): GetUpPlan => {
        const at = (bone: string) => {
          const point = bodyInterface.GetPosition(ragdoll.bodyOf(bone)!);
          return new Vector3(point.GetX(), point.GetY(), point.GetZ());
        };

        const plan = planGetUp(
          {
            pelvis: at("pelvis"),
            head: at("Head"),
            leftShoulder: at("upperarm_l"),
            rightShoulder: at("upperarm_r"),
          },
          (move: GetUpMove) => getUpStart(gltf.scene, gltf.animations, move),
        );

        place(plan.position.x, plan.position.y, plan.position.z, plan.yaw);
        character.updateMatrixWorld(true);

        // Straight into the clip, no crossfade: the blend from the ragdoll is
        // the transition, and a crossfade would have it blend toward a pose
        // still half standing.
        animator.playOnce(
          plan.move.clip,
          plan.move,
          function stood() {
            animator.play(then, 0.4);
            onStood?.();
          },
          0,
        );
        ragdoll.blendToAnimation(plan.move.blend, "hardKeying");
        return plan;
      },
  );

  return {
    character,
    mixer: animator.mixer,
    play: animator.play,
    playOnce: animator.playOnce,
    moveTo,
    place,
    getUp,
  };
};

useGLTF.preload(MANNEQUIN);
