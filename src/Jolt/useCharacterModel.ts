import { useEffect, useMemo, useRef, useState } from "react";
import {
  Mesh,
  SkinnedMesh,
  Vector3,
  type Bone,
  type Object3D,
} from "three";
import { useJolt } from "./useJolt";
import { createChildShape } from "./internal/colliderShape";
import {
  createDebugMaterial,
  DEBUG_RENDER_ORDER,
  disposeDebugMaterial,
} from "./internal/debugMaterial";
import {
  createDebugView,
  useDebugFlag,
  useDebugView,
  type DebugView,
} from "./internal/debugView";
import {
  fitRagdoll,
  type RagdollConfig,
  type RagdollFitOptions,
} from "./internal/ragdollFit";
import { shapeToGeometry } from "./internal/shapeToGeometry";

export interface CharacterModel {
  /** The skinned mesh the ragdoll is built over. */
  mesh: SkinnedMesh;
  /** Every skinned mesh sharing its skeleton, all of which the fit used. */
  meshes: readonly SkinnedMesh[];
  config: RagdollConfig;
  /** Bones with no body of their own; they ride along with their nearest kept ancestor. */
  excluded: readonly string[];
  /** The config as plain data, to tune once and pass back as `config`. */
  toJSON: () => RagdollConfig;
}

export interface UseCharacterModelOptions extends RagdollFitOptions {
  /** A config from `toJSON()`. Skips the fit. */
  config?: RagdollConfig;
  /** Wireframes of the fitted bodies, riding on the bones. Default `<Physics debug>`. */
  debug?: boolean;
}

const skinnedMeshesOf = (object: Object3D) => {
  const meshes: SkinnedMesh[] = [];
  object.traverse((node) => {
    if (node instanceof SkinnedMesh) meshes.push(node);
  });

  if (meshes.length === 0) {
    throw new Error(
      "[r3f-jolt] useCharacterModel: no SkinnedMesh under the object passed in.",
    );
  }

  return meshes.filter((mesh) => mesh.skeleton === meshes[0].skeleton);
};

const createCharacterModel = (
  object: Object3D,
  options: UseCharacterModelOptions,
): CharacterModel => {
  const meshes = skinnedMeshesOf(object);
  const mesh = meshes[0];
  object.updateWorldMatrix(true, true);

  const fitted = options.config
    ? {
        config: options.config,
        excluded: mesh.skeleton.bones
          .map((bone) => bone.name)
          .filter(
            (name) => !options.config!.bones.some((bone) => bone.name === name),
          ),
      }
    : fitRagdoll(meshes, options);

  const toJSON = () => structuredClone(fitted.config);

  return { mesh, meshes, ...fitted, toJSON };
};

/**
 * Fits a ragdoll to a skinned character: which bones get bodies, their shapes,
 * masses and joint limits, all from the skin in its bind pose. Pass the result
 * to `useRagdoll`.
 *
 * The fit runs once per object; options are read at mount like every other
 * creation option, so refit with `key`.
 */
export const useCharacterModel = (
  object: Object3D,
  options: UseCharacterModelOptions = {},
): CharacterModel => {
  const api = useJolt();
  const [mount] = useState(() => options);
  const overlayRef = useRef<DebugView<Mesh[]> | null>(null);

  const model = useMemo(
    () => createCharacterModel(object, mount),
    [object, mount],
  );

  useEffect(() => {
    const { Jolt: jolt } = api;
    const scale = new Vector3();

    const attach = (bone: Bone, index: number) => {
      const shape = createChildShape(
        jolt,
        model.config.bones[index].shape,
        "useCharacterModel",
      );
      const geometry = shapeToGeometry(jolt, shape);
      shape.Release();

      const overlay = new Mesh(
        geometry,
        createDebugMaterial(model.config.bones[index].shape.type),
      );
      overlay.renderOrder = DEBUG_RENDER_ORDER;
      overlay.frustumCulled = false;

      // The fit is in metres; the bone's frame may be scaled.
      bone.updateWorldMatrix(true, false);
      overlay.scale.setScalar(1 / scale.setFromMatrixScale(bone.matrixWorld).x);
      bone.add(overlay);
      return overlay;
    };

    const buildOverlay = () => {
      if (model.excluded.length > 0) {
        console.info(
          `[r3f-jolt] useCharacterModel: ${model.excluded.length} bones have ` +
            `no body of their own: ${model.excluded.join(", ")}`,
        );
      }

      return model.config.bones.flatMap((entry, index) => {
        const bone = model.mesh.skeleton.getBoneByName(entry.name);
        return bone ? [attach(bone, index)] : [];
      });
    };

    const releaseOverlay = (overlays: Mesh[]) => {
      for (const overlay of overlays) {
        overlay.removeFromParent();
        overlay.geometry.dispose();
        disposeDebugMaterial(overlay);
      }
    };

    const view = createDebugView(buildOverlay, releaseOverlay);
    overlayRef.current = view;

    return () => {
      view.hide();
      overlayRef.current = null;
    };
  }, [api, model]);

  const debug = useDebugFlag(mount.debug);
  useDebugView(model, overlayRef, debug);

  return model;
};
