import { MeshBasicMaterial } from "three";
import type { MotionType } from "../types";

export const debugColors = {
  box: "violet",
  sphere: "yellow",
  capsule: "blue",
  cylinder: "green",
  taperedCapsule: "orange",
  convex: "magenta",
  compound: "crimson",
  trimesh: "hotpink",
  character: "black",
  vehicle: "mediumslateblue",
  wheel: "lawngreen",
} as const;

export type DebugShapeKind = keyof typeof debugColors;

/**
 * A collider is often *inside* the mesh drawn for it — a box's convex radius
 * rounds it in from every corner, a hull is whatever its points allow — so a
 * depth-tested wireframe is hidden by the very thing it exists to describe.
 * These draw as an overlay instead, which is also why the meshes carrying them
 * need `DEBUG_RENDER_ORDER`: without depth writes, anything drawn afterwards
 * would paint straight over them.
 */
const overlay = {
  wireframe: true,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
} as const;

export const DEBUG_RENDER_ORDER = 1000;

export const createDebugMaterial = (kind: DebugShapeKind) =>
  new MeshBasicMaterial({ color: debugColors[kind], ...overlay });

/**
 * `<PhysicsDebug />` draws bodies it did not create, so it has no shape kind to
 * colour by — only what the body does.
 */
export const debugMotionColors: Record<MotionType, string> = {
  static: "seagreen",
  kinematic: "dodgerblue",
  dynamic: "violet",
};

export const createMotionDebugMaterials = (
  overrides?: Partial<Record<MotionType, string>>,
) => {
  const colors = { ...debugMotionColors, ...overrides };

  return {
    static: new MeshBasicMaterial({ color: colors.static, ...overlay }),
    kinematic: new MeshBasicMaterial({ color: colors.kinematic, ...overlay }),
    dynamic: new MeshBasicMaterial({ color: colors.dynamic, ...overlay }),
  } satisfies Record<MotionType, MeshBasicMaterial>;
};

export const disposeDebugMaterial = (mesh: { material: unknown }) => {
  const material = mesh.material;

  if (Array.isArray(material)) {
    for (const entry of material) {
      (entry as MeshBasicMaterial).dispose();
    }
  } else if (material instanceof MeshBasicMaterial) {
    material.dispose();
  }
};
