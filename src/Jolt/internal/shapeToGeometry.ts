import { BufferAttribute, BufferGeometry } from "three";
import type Jolt from "jolt-physics";
import type { JoltModule } from "../types";

export const shapeToGeometry = (
  JoltModule: JoltModule,
  shape: Jolt.Shape,
): BufferGeometry => {
  const scale = new JoltModule.Vec3(1, 1, 1);
  const triangles = new JoltModule.ShapeGetTriangles(
    shape,
    JoltModule.AABox.prototype.sBiggest(),
    shape.GetCenterOfMass(),
    JoltModule.Quat.prototype.sIdentity(),
    scale,
  );

  const vertices = new Float32Array(
    JoltModule.HEAPF32.buffer,
    triangles.GetVerticesData(),
    triangles.GetVerticesSize() / Float32Array.BYTES_PER_ELEMENT,
  ).slice();

  JoltModule.destroy(triangles);
  JoltModule.destroy(scale);

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();

  return geometry;
};
