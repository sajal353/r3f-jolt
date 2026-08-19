import type Jolt from "jolt-physics";
import type { JoltModule } from "../types";

/**
 * `PhysicsMaterial` binds a refcount and nothing else — no friction, no
 * restitution, no name. It is an **identity token**: you hand one to a shape,
 * read it back off a hit, and compare pointers to learn which surface you
 * touched. Friction and restitution live on the body (`material` on any body
 * hook) and are not per-surface.
 *
 * Only `ConvexShape` and `PlaneShape` bind `SetMaterial`, so only `useConvex`
 * and `usePlane` carry this. A mesh's surfaces are identified per triangle
 * instead, through `useTrimesh`'s `perTriangleUserData`.
 */
export interface ShapeMaterialApi {
  /**
   * The shape takes a reference, so a freshly-made material needs no `AddRef`
   * from you and must **not** be destroyed — it is freed when the shape is.
   */
  setMaterial: (material: Jolt.PhysicsMaterial) => void;
  getMaterial: () => Jolt.PhysicsMaterial;
}

interface MaterialShape extends Jolt.Shape {
  SetMaterial: (material: Jolt.PhysicsMaterial) => void;
}

export const createShapeMaterialApi = (
  jolt: JoltModule,
  shape: MaterialShape,
): ShapeMaterialApi => ({
  setMaterial: (material: Jolt.PhysicsMaterial) => {
    shape.SetMaterial(material);
  },

  getMaterial: () => {
    // Any id resolves to the one material a convex or a plane has, and holding
    // one for a body that never asks costs more than making it per call.
    const id = new jolt.SubShapeID();
    const material = shape.GetMaterial(id);
    jolt.destroy(id);
    return material;
  },
});
