import { MeshBasicMaterial } from "three";

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

export const createDebugMaterial = (kind: DebugShapeKind) =>
  new MeshBasicMaterial({ color: debugColors[kind], wireframe: true });

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
